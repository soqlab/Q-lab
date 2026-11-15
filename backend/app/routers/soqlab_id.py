"""Sign in with SOQLAB: one passkey (made at id.soqlab.com) for Q-Lab and SOQLAB's other products.

Off unless QLAB_SOQLAB_ID_ISSUER, QLAB_SOQLAB_ID_CLIENT_ID and QLAB_SOQLAB_ID_CLIENT_SECRET are all
set (and QLAB_APP_URL, which gives the redirect URI). Off, every route here answers 404 and
/auth/passkeys/config says soqlab_id: false, so the sign-in pages show nothing new.

The protocol is OpenID Connect, authorization code with PKCE (S256):

  POST /auth/soqlab/start        {purpose: login|signup, ...}        where to send the browser
  POST /auth/soqlab/link-ticket  {purpose: link|recover, ...}        id.soqlab.com/link?ticket=…
  POST /auth/soqlab/callback     {code, state, flow}                 a normal Q-Lab session
  GET  /auth/soqlab/status                                           is this account linked
  DELETE /auth/soqlab/link                                           unlink (here and at SOQLAB)

No cookies. A round trip is bound to the tab that started it by `flow`, a random secret the page
keeps in sessionStorage and sends back with the code; only its hash is stored. Each round trip
(state) is claimed once, atomically, so a replayed callback is refused.

The issuer comes only from configuration, never from a request. Q-Lab fetches exactly three kinds
of URL from it, all on the issuer's own origin: the discovery document, the JWKS and the token
endpoint (plus /unlink). Redirects are not followed, bodies are capped at 64 KB, every call times
out after 5 seconds, and app/outbound.py refuses an issuer that resolves to an internal address.

ID tokens: ES256 only (the header's alg is checked before anything else), key by kid from the
issuer's JWKS, and iss, aud (= our client id), exp, iat, nonce and amr ("passkey") are all checked.
id.soqlab.com gives each product a different (pairwise) subject for the same person, and no email
or name: Q-Lab maps that subject to its own account and issues its own token, exactly as a passkey
sign-in does (amr "passkey", idp "soqlab").

Linking needs a recent sign-in (10 minutes), or for recovery a valid recovery code or emailed link,
and goes through a short ticket Q-Lab signs (HS256 with the client secret, 5 minutes, single-use
jti) that id.soqlab.com checks before it makes the passkey.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import quote, urlencode, urlparse

import httpx
import jwt
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from jwt import PyJWTError
from pydantic import BaseModel, Field
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from .. import recovery_codes
from ..auth import ENROL_SCOPE, create_access_token, decode_token, hash_link_token
from ..database import get_db
from ..deps import Identity, log_audit, require_user_session
from ..models import PasskeyCredential, RecoveryCode, SoqlabFlow, SoqlabIdentity, User
from ..outbound import UnsafeURL, require_safe_url
from ..rate_limit import auth_limiter
from .auth_routes import _user_response, finish_signup, new_account

router = APIRouter(prefix="/auth/soqlab", tags=["soqlab-id"])
log = logging.getLogger("qlab.soqlab_id")

FLOW_TTL_SECONDS = 10 * 60
TICKET_TTL_SECONDS = 5 * 60
RECENT_SIGN_IN_SECONDS = 10 * 60
HTTP_TIMEOUT = 5.0
MAX_BODY = 64 * 1024
CACHE_SECONDS = 60 * 60
JWKS_REFETCH_MIN_SECONDS = 60
LEEWAY_SECONDS = 60
NOT_LINKED = "soqlab_not_linked"


# ── Configuration ────────────────────────────────────────────────────────────

def _issuer_ok(issuer: str) -> bool:
    p = urlparse(issuer)
    if p.username or p.password or p.query or p.fragment or p.params or p.path not in ("", "/"):
        return False
    if p.scheme == "https" and p.hostname:
        return True
    return p.scheme == "http" and p.hostname in ("localhost", "127.0.0.1")


def settings() -> Optional[dict[str, str]]:
    """{issuer, client_id, client_secret, redirect_uri}, or None when the feature is off."""
    issuer = os.getenv("QLAB_SOQLAB_ID_ISSUER", "").strip().rstrip("/")
    client_id = os.getenv("QLAB_SOQLAB_ID_CLIENT_ID", "").strip()
    secret = os.getenv("QLAB_SOQLAB_ID_CLIENT_SECRET", "").strip()
    app_url = os.getenv("QLAB_APP_URL", "").strip().rstrip("/")
    if not (issuer and client_id and secret and app_url) or not _issuer_ok(issuer):
        return None
    return {"issuer": issuer, "client_id": client_id, "client_secret": secret,
            "redirect_uri": f"{app_url}/soqlab-callback"}


def enabled() -> bool:
    return settings() is not None


def _cfg() -> dict[str, str]:
    cfg = settings()
    if cfg is None:
        raise HTTPException(status_code=404, detail="Not Found")
    return cfg


# ── Talking to the issuer ────────────────────────────────────────────────────

def _origin(url: str) -> str:
    p = urlparse(url)
    return f"{p.scheme}://{p.netloc}".lower()


def _http(method: str, url: str, *, data: dict | None = None, headers: dict | None = None) -> tuple[int, Any]:
    """One call to the issuer: (status, parsed JSON or None). Tests replace this function."""
    host = urlparse(url).hostname or ""
    if host not in ("localhost", "127.0.0.1"):
        require_safe_url(url)
    with httpx.Client(timeout=HTTP_TIMEOUT, follow_redirects=False) as client:
        with client.stream(method, url, data=data, headers={"Accept": "application/json", **(headers or {})}) as res:
            body = b""
            for chunk in res.iter_bytes():
                body += chunk
                if len(body) > MAX_BODY:
                    raise ValueError("response too large")
            try:
                return res.status_code, json.loads(body or b"null")
            except ValueError:
                return res.status_code, None


def _fetch_json(url: str, cfg: dict[str, str]) -> dict:
    if _origin(url) != _origin(cfg["issuer"]):
        raise ValueError("URL is not on the issuer's origin")
    status, body = _http("GET", url)
    if status != 200 or not isinstance(body, dict):
        raise ValueError(f"{url} answered {status}")
    return body


_discovery: dict[str, tuple[float, dict]] = {}
_jwks: dict[str, tuple[float, dict]] = {}
_jwks_forced: dict[str, float] = {}


def _metadata(cfg: dict[str, str]) -> dict:
    issuer = cfg["issuer"]
    cached = _discovery.get(issuer)
    if cached and time.time() - cached[0] < CACHE_SECONDS:
        return cached[1]
    doc = _fetch_json(f"{issuer}/.well-known/openid-configuration", cfg)
    if doc.get("issuer") != issuer:
        raise ValueError("discovery issuer mismatch")
    for key in ("authorization_endpoint", "token_endpoint", "jwks_uri"):
        if not isinstance(doc.get(key), str) or _origin(doc[key]) != _origin(issuer):
            raise ValueError(f"{key} is missing or not on the issuer's origin")
    _discovery[issuer] = (time.time(), doc)
    return doc


def _signing_key(cfg: dict[str, str], kid: str):
    issuer = cfg["issuer"]
    uri = _metadata(cfg)["jwks_uri"]

    def lookup(keys: dict):
        for k in keys.get("keys") or []:
            if isinstance(k, dict) and k.get("kid") == kid:
                if k.get("kty") != "EC" or k.get("crv") != "P-256" or k.get("alg", "ES256") != "ES256":
                    return None
                return jwt.algorithms.ECAlgorithm.from_jwk(json.dumps(k))
        return None

    cached = _jwks.get(issuer)
    if not cached or time.time() - cached[0] >= CACHE_SECONDS:
        cached = (time.time(), _fetch_json(uri, cfg))
        _jwks[issuer] = cached
    key = lookup(cached[1])
    if key is None and time.time() - _jwks_forced.get(issuer, 0) >= JWKS_REFETCH_MIN_SECONDS:
        _jwks_forced[issuer] = time.time()  # an unknown kid: the issuer may have rotated keys
        cached = (time.time(), _fetch_json(uri, cfg))
        _jwks[issuer] = cached
        key = lookup(cached[1])
    if key is None:
        raise ValueError("unknown signing key")
    return key


def _basic(cfg: dict[str, str]) -> str:
    raw = f"{quote(cfg['client_id'], safe='')}:{quote(cfg['client_secret'], safe='')}".encode()
    return "Basic " + base64.b64encode(raw).decode()


def verify_id_token(cfg: dict[str, str], token: str, nonce: str) -> dict:
    """The checked claims of an ID token from the configured issuer. Raises ValueError."""
    try:
        header = jwt.get_unverified_header(token)
    except PyJWTError as exc:
        raise ValueError("malformed token") from exc
    if header.get("alg") != "ES256":
        raise ValueError("only ES256 is accepted")
    kid = header.get("kid")
    if not isinstance(kid, str) or not kid:
        raise ValueError("no kid")
    key = _signing_key(cfg, kid)
    try:
        claims = jwt.decode(token, key, algorithms=["ES256"], audience=cfg["client_id"], issuer=cfg["issuer"],
                            leeway=LEEWAY_SECONDS,
                            options={"require": ["iss", "aud", "sub", "exp", "iat", "nonce"]})
    except PyJWTError as exc:
        raise ValueError(f"token refused: {type(exc).__name__}") from exc
    aud = claims.get("aud")
    if isinstance(aud, list) and len(aud) > 1 and claims.get("azp") != cfg["client_id"]:
        raise ValueError("azp mismatch")
    if not isinstance(claims.get("iat"), (int, float)) or claims["iat"] > time.time() + LEEWAY_SECONDS:
        raise ValueError("issued in the future")
    if not hmac.compare_digest(str(claims.get("nonce")), nonce):
        raise ValueError("nonce mismatch")
    amr = claims.get("amr")
    if not isinstance(amr, list) or "passkey" not in amr:
        raise ValueError("not a passkey sign-in")
    sub = claims.get("sub")
    if not isinstance(sub, str) or not 1 <= len(sub) <= 255:
        raise ValueError("bad subject")
    return claims


def _exchange(cfg: dict[str, str], code: str, verifier: str) -> str:
    """Code + PKCE verifier for an ID token, at the issuer's token endpoint."""
    status, body = _http("POST", _metadata(cfg)["token_endpoint"], data={
        "grant_type": "authorization_code", "code": code, "redirect_uri": cfg["redirect_uri"],
        "code_verifier": verifier,
    }, headers={"Authorization": _basic(cfg)})
    if status != 200 or not isinstance(body, dict) or not isinstance(body.get("id_token"), str):
        raise ValueError(f"token endpoint answered {status}")
    return body["id_token"]


def remote_unlink(cfg: dict[str, str], subject: str) -> bool:
    """Ask id.soqlab.com to delete its link for this subject. Best effort."""
    try:
        status, _ = _http("POST", f"{cfg['issuer']}/unlink", data={"sub": subject},
                          headers={"Authorization": _basic(cfg)})
        return 200 <= status < 300
    except (httpx.HTTPError, UnsafeURL, ValueError) as exc:
        log.warning("[soqlab-id] unlink at the issuer failed: %s", type(exc).__name__)
        return False


# ── Round trips ──────────────────────────────────────────────────────────────

def _sha(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _new_flow(db: Session, purpose: str, user_id: int | None = None, data: dict | None = None,
              jti: str | None = None) -> dict[str, str]:
    now = time.time()
    db.execute(delete(SoqlabFlow).where(SoqlabFlow.expires_at < now - FLOW_TTL_SECONDS))
    state, binding, nonce = secrets.token_urlsafe(32), secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    db.add(SoqlabFlow(state_hash=_sha(state), binding_hash=_sha(binding), purpose=purpose, user_id=user_id,
                      nonce=nonce, code_verifier=verifier, jti=jti, data=data or {},
                      expires_at=now + FLOW_TTL_SECONDS))
    db.commit()
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return {"state": state, "flow": binding, "nonce": nonce, "code_challenge": challenge}


def _unavailable(exc: Exception) -> HTTPException:
    log.warning("[soqlab-id] issuer unavailable: %s", exc)
    return HTTPException(status_code=503, detail="SOQLAB sign-in is unavailable right now. Try again, or use your Q-Lab passkey.")


def _identity_for(db: Session, issuer: str, subject: str) -> SoqlabIdentity | None:
    return db.scalar(select(SoqlabIdentity).where(SoqlabIdentity.issuer == issuer, SoqlabIdentity.subject == subject))


def _linked(db: Session, user_id: int) -> SoqlabIdentity | None:
    return db.scalar(select(SoqlabIdentity).where(SoqlabIdentity.user_id == user_id))


def _has_passkey(db: Session, user_id: int) -> bool:
    return db.scalar(select(PasskeyCredential.id).where(PasskeyCredential.user_id == user_id).limit(1)) is not None


def _session(db: Session, user: User, request: Request, action: str) -> dict:
    user.last_login_at = datetime.now(timezone.utc)
    user.login_count = (user.login_count or 0) + 1
    db.commit()
    log_audit(db, action, "user", str(user.id), request=request, user_id=user.id, org_id=user.org_id)
    resp = _user_response(user, create_access_token(user.id, user.org_id, user.role, amr="passkey", idp="soqlab"))
    resp["soqlab_linked"] = True
    return resp


# ── Payloads ─────────────────────────────────────────────────────────────────

class StartPayload(BaseModel):
    purpose: str = Field(pattern="^(login|signup)$")
    name: Optional[str] = Field(default=None, max_length=200)
    org_name: Optional[str] = Field(default=None, max_length=200)


class TicketPayload(BaseModel):
    purpose: str = Field(default="link", pattern="^(link|recover)$")
    code: Optional[str] = Field(default=None, max_length=64)     # recover: a recovery code
    token: Optional[str] = Field(default=None, max_length=128)    # recover: an emailed recovery link


class CallbackPayload(BaseModel):
    code: str = Field(min_length=1, max_length=2048)
    state: str = Field(min_length=16, max_length=128)
    flow: str = Field(min_length=16, max_length=128)


# ── Routes ───────────────────────────────────────────────────────────────────

@router.post("/start", dependencies=[Depends(auth_limiter)])
def start(payload: StartPayload, db: Session = Depends(get_db)):
    """Where to send the browser to sign in (or sign up) with a SOQLAB passkey."""
    cfg = _cfg()
    data: dict[str, Any] = {}
    if payload.purpose == "signup":
        name = (payload.name or "").strip()
        if not name:
            raise HTTPException(status_code=422, detail="Enter a name")
        data = {"name": name, "org_name": (payload.org_name or "").strip() or None}
    try:
        endpoint = _metadata(cfg)["authorization_endpoint"]
    except Exception as exc:  # noqa: BLE001 - any issuer failure is "unavailable"
        raise _unavailable(exc) from None
    f = _new_flow(db, payload.purpose, data=data)
    params = {"response_type": "code", "client_id": cfg["client_id"], "redirect_uri": cfg["redirect_uri"],
              "scope": "openid", "state": f["state"], "nonce": f["nonce"], "code_challenge": f["code_challenge"],
              "code_challenge_method": "S256"}
    if payload.purpose == "signup":
        params["prompt"] = "create"
    return {"authorize_url": f"{endpoint}?{urlencode(params)}", "state": f["state"], "flow": f["flow"]}


def _bearer_account(authorization: Optional[str], db: Session) -> tuple[User, bool]:
    """(user, enrolling) from a session token or the enrolment token a password/Google/GitHub
    sign-in gives an account that has no passkey yet."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        claims = decode_token(authorization[7:])
    except PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired token") from exc
    user = db.scalar(select(User).where(User.id == int(claims["sub"]), User.is_active.is_(True)))
    if user is None:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    strong = _has_passkey(db, user.id) or _linked(db, user.id) is not None
    if claims.get("scope") == ENROL_SCOPE:
        if strong:
            raise HTTPException(status_code=403, detail="This account already has a passkey. Sign in with it.")
        return user, True
    if claims.get("scope"):
        raise HTTPException(status_code=401, detail="Invalid token")
    if strong and claims.get("amr") != "passkey":
        raise HTTPException(status_code=403, detail="passkey_session_required")
    auth_time = claims.get("auth_time")
    if not isinstance(auth_time, (int, float)) or time.time() - auth_time > RECENT_SIGN_IN_SECONDS:
        raise HTTPException(status_code=403, detail="recent_sign_in_required")
    return user, False


@router.post("/link-ticket", dependencies=[Depends(auth_limiter)])
def link_ticket(payload: TicketPayload, request: Request, authorization: Optional[str] = Header(default=None),
                db: Session = Depends(get_db)):
    """Where to send the browser to create a SOQLAB passkey for this one Q-Lab account.

    link: a signed-in account (signed in within 10 minutes). recover: a recovery code or emailed
    recovery link, checked here and used up only once the SOQLAB passkey exists. Either way the
    passkey made at id.soqlab.com is attached to this Q-Lab account alone."""
    cfg = _cfg()
    data: dict[str, Any] = {}
    if payload.purpose == "link":
        user, enrolling = _bearer_account(authorization, db)
        if _linked(db, user.id) is not None:
            raise HTTPException(status_code=409, detail="This account is already linked to a SOQLAB passkey.")
        data["enrolling"] = enrolling
    elif payload.code:
        row = recovery_codes.find_unused(db, payload.code)
        user = db.get(User, row.user_id) if row else None
        if row is None or user is None or not user.is_active:
            raise HTTPException(status_code=400, detail="That recovery code is wrong or already used.")
        data = {"code_id": row.id, "code_hash": row.code_hash}
    elif payload.token:
        from .passkeys import _recovery_user
        user = _recovery_user(db, payload.token)
        data = {"token_hash": hash_link_token(payload.token)}
    else:
        raise HTTPException(status_code=422, detail="A recovery code or recovery link is needed.")
    try:
        _metadata(cfg)
    except Exception as exc:  # noqa: BLE001
        raise _unavailable(exc) from None
    jti = uuid.uuid4().hex
    f = _new_flow(db, payload.purpose, user_id=user.id, data=data, jti=jti)
    now = int(time.time())
    ticket = jwt.encode({
        "iss": cfg["client_id"], "aud": cfg["issuer"], "sub": str(user.id), "jti": jti, "iat": now,
        "exp": now + TICKET_TTL_SECONDS, "redirect_uri": cfg["redirect_uri"], "state": f["state"],
        "nonce": f["nonce"], "code_challenge": f["code_challenge"], "code_challenge_method": "S256",
        "purpose": payload.purpose,
    }, cfg["client_secret"], algorithm="HS256", headers={"typ": "JWT"})
    log_audit(db, f"auth.soqlab_{payload.purpose}_started", "user", str(user.id), request=request,
              user_id=user.id, org_id=user.org_id)
    return {"authorize_url": f"{cfg['issuer']}/link?{urlencode({'ticket': ticket})}", "state": f["state"],
            "flow": f["flow"]}


def _claim(db: Session, payload: CallbackPayload) -> SoqlabFlow:
    gone = HTTPException(status_code=400, detail="This SOQLAB sign-in expired or was already used. Start again.")
    row = db.get(SoqlabFlow, _sha(payload.state))
    if row is None or row.used_at is not None:
        raise gone
    if not hmac.compare_digest(row.binding_hash, _sha(payload.flow)):
        raise HTTPException(status_code=400, detail="This SOQLAB sign-in started in another tab or browser. Start again here.")
    claimed = db.execute(update(SoqlabFlow).where(SoqlabFlow.state_hash == row.state_hash,
                                                  SoqlabFlow.used_at.is_(None)).values(used_at=time.time())).rowcount
    db.commit()
    if claimed != 1 or row.expires_at < time.time():
        raise gone
    db.refresh(row)
    return row


@router.post("/callback", dependencies=[Depends(auth_limiter)])
def callback(payload: CallbackPayload, request: Request, db: Session = Depends(get_db)):
    """Finish a round trip: the code is exchanged, the ID token checked, then the Q-Lab account."""
    cfg = _cfg()
    flow = _claim(db, payload)
    try:
        claims = verify_id_token(cfg, _exchange(cfg, payload.code, flow.code_verifier), flow.nonce)
    except (ValueError, httpx.HTTPError, UnsafeURL) as exc:
        log.warning("[soqlab-id] sign-in refused: %s", exc)
        log_audit(db, "auth.soqlab_refused", meta={"purpose": flow.purpose}, request=request)
        raise HTTPException(status_code=401, detail="SOQLAB didn't confirm this sign-in. Start again.") from None
    subject, issuer = claims["sub"], cfg["issuer"]
    linked = _identity_for(db, issuer, subject)

    if flow.purpose in ("login", "signup") and linked is not None:
        user = db.get(User, linked.user_id)
        from .. import erasure
        erasure.cancel_if_pending(db, user)
        if user is None or not user.is_active:
            raise HTTPException(status_code=403, detail="Account disabled")
        linked.last_used_at = datetime.now(timezone.utc)
        return _session(db, user, request, "auth.login_soqlab")

    if flow.purpose == "login":
        log_audit(db, "auth.soqlab_not_linked", request=request)
        raise HTTPException(status_code=404, detail=NOT_LINKED)

    if flow.purpose == "signup":
        data = flow.data or {}
        user = new_account(db, None, data.get("name") or "Q-Lab account", data.get("org_name"), password_hash="")
        db.add(SoqlabIdentity(user_id=user.id, issuer=issuer, subject=subject,
                              last_used_at=datetime.now(timezone.utc)))
        codes = recovery_codes.new_set(db, user.id)
        db.commit()
        db.refresh(user)
        resp = finish_signup(db, user, request, amr="passkey")
        resp["access_token"] = create_access_token(user.id, user.org_id, user.role, amr="passkey", idp="soqlab")
        resp["recovery_codes"] = codes
        resp["soqlab_linked"] = True
        return resp

    # link | recover: the passkey just made belongs to this flow's account, and only to it.
    user = db.get(User, flow.user_id) if flow.user_id else None
    if user is None or not user.is_active:
        raise HTTPException(status_code=403, detail="Account disabled")
    if linked is not None and linked.user_id != user.id:
        raise HTTPException(status_code=409, detail="That SOQLAB passkey is already linked to another Q-Lab account.")
    data = flow.data or {}
    if flow.purpose == "recover":
        if data.get("code_id"):
            used = db.execute(update(RecoveryCode).where(
                RecoveryCode.id == data["code_id"], RecoveryCode.code_hash == data.get("code_hash"),
                RecoveryCode.user_id == user.id, RecoveryCode.used_at.is_(None),
            ).values(used_at=datetime.now(timezone.utc))).rowcount
        else:
            used = db.execute(update(User).where(User.id == user.id, User.reset_token == data.get("token_hash"))
                              .values(reset_token=None, reset_token_expires=None)).rowcount
        if used != 1:
            db.rollback()
            raise HTTPException(status_code=400, detail="That recovery code or link was already used.")
        db.execute(delete(SoqlabIdentity).where(SoqlabIdentity.user_id == user.id, SoqlabIdentity.subject != subject))
    elif _linked(db, user.id) not in (None, linked):
        raise HTTPException(status_code=409, detail="This account is already linked to a SOQLAB passkey.")
    if linked is None:
        db.add(SoqlabIdentity(user_id=user.id, issuer=issuer, subject=subject,
                              last_used_at=datetime.now(timezone.utc)))
    # Like a first passkey: the account signs in with a passkey from now on.
    user.password_hash = ""
    db.commit()
    db.refresh(user)
    log_audit(db, "auth.soqlab_linked", "user", str(user.id), request=request, user_id=user.id,
              org_id=user.org_id, meta={"via": flow.purpose})
    resp = _session(db, user, request, "auth.login_soqlab_recovery" if flow.purpose == "recover" else "auth.login_soqlab")
    if flow.purpose == "recover":
        resp["recovery_codes_remaining"] = recovery_codes.remaining(db, user.id)
    return resp


@router.get("/status")
def status(identity: Identity = Depends(require_user_session), db: Session = Depends(get_db)):
    _cfg()
    row = _linked(db, identity.user_id)
    return {"linked": row is not None, "linked_at": row.created_at.isoformat() if row and row.created_at else None,
            "has_passkey": _has_passkey(db, identity.user_id), "session": identity.idp or identity.amr}


@router.delete("/link")
def unlink(request: Request, identity: Identity = Depends(require_user_session), db: Session = Depends(get_db)):
    """Stop using the SOQLAB passkey for this account (and tell id.soqlab.com to forget the link).
    Refused while it is the account's only way to sign in."""
    cfg = _cfg()
    if identity.amr != "passkey":
        raise HTTPException(status_code=403, detail="passkey_session_required")
    row = _linked(db, identity.user_id)
    if row is None:
        raise HTTPException(status_code=404, detail="This account isn't linked to a SOQLAB passkey.")
    if not _has_passkey(db, identity.user_id):
        raise HTTPException(status_code=409, detail="Add a Q-Lab passkey first: without one you couldn't sign in after unlinking.")
    subject = row.subject
    db.delete(row)
    db.commit()
    remote = remote_unlink(cfg, subject)
    log_audit(db, "auth.soqlab_unlinked", "user", str(identity.user_id), identity=identity, request=request,
              meta={"remote": remote})
    return {"linked": False, "remote_unlinked": remote}
