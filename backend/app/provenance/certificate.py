"""A run's provenance certificate and its reproduction state (the "Reproduced" badge).

The certificate is a signed statement of what Q-Lab recorded about one run: hashes of the circuit
(as given to the compiler, as compiled, as stored), the machine, a hash of the calibration recorded
with the run (and the matching Rewind snapshot when the server stored one), package versions,
transpiler settings, seeds, shots, a hash of the counts, and how its reproductions compared. It
holds hashes and settings, never the circuit, the counts or the calibration themselves, and nothing
about who uploaded it: no account, e-mail, organisation, host name or git details.

Reproductions that count are the run owner's own (same account or organisation) and any other
account's that were themselves shared publicly. A stranger can tag an upload as a reproduction of
any run id; an unshared one from another account is ignored, so nobody can quietly add or remove a
"reproduced" from someone else's run.

Decimals are written as strings (see verify.py: the body is hashed as canonical JSON that has to
come out byte-identical in Python and in the browser).
"""
from __future__ import annotations

import base64
import hashlib
import json
import math
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import drift
from .. import reproduce as rp
from ..models import Run
from ..run_diff import counts_of
from ..run_scope import unscoped
from . import signing
from . import verify as cv

FORMAT = cv.CERT_FORMAT
MAX_REPRODUCTIONS = 50
# How long after its calibration a stored Rewind snapshot is taken to be the one in effect for a run.
IN_EFFECT_HOURS = 36
_SAFE_KEY = re.compile(r"^[A-Za-z0-9_.+-]{1,60}$")

STATES = ("reproduced", "mixed", "not_reproduced", "not_yet")


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def _d(v: Any) -> dict:
    return v if isinstance(v, dict) else {}


def _s(v: Any, limit: int = 300) -> Optional[str]:
    """A plain string for the certificate (no lone surrogates, bounded), or None."""
    if v is None:
        return None
    text = str(v)[:limit]
    return text.encode("utf-8", "replace").decode("utf-8")


def _int(v: Any) -> Optional[int]:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    if isinstance(v, float) and (not math.isfinite(v) or not v.is_integer()):
        return None
    n = int(v)
    return n if abs(n) <= cv.MAX_INT else None


def _dec(v: Any, digits: int = 6) -> Optional[str]:
    """A decimal as a string (certificates hold no floats)."""
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(float(v)):
        return None
    return f"{float(v):.{digits}g}"


def _sha_text(text: Any) -> Optional[str]:
    return hashlib.sha256(text.encode("utf-8")).hexdigest() if isinstance(text, str) and text else None


def _hex(v: Any) -> Optional[str]:
    return v if isinstance(v, str) and re.match(r"^[0-9a-f]{64}$", v) else None


def json_sha256(value: Any) -> str:
    """SHA-256 of JSON with sorted keys and no spaces, as Python writes it (stated in the certificate)."""
    text = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _iso(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _parse(text: Any) -> Optional[datetime]:
    if isinstance(text, datetime):
        return text if text.tzinfo else text.replace(tzinfo=timezone.utc)
    if not isinstance(text, str) or not text.strip():
        return None
    try:
        dt = datetime.fromisoformat(text.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


# ---------------------------------------------------------------------------
# Who may see a run's certificate
# ---------------------------------------------------------------------------

def find_for_caller(db: Session, run_id: str) -> Optional[Run]:
    """The run if the caller can open it (its owner), or if it is shared; else None."""
    run = db.scalar(select(Run).where(Run.run_id == run_id))  # scoped to the caller
    if run is not None:
        return run
    with unscoped():
        run = db.scalar(select(Run).where(Run.run_id == run_id))
    return run if run is not None and run.share_token else None


def find_shared(db: Session, token: str) -> Optional[Run]:
    if not token or len(token) > 64:
        return None
    with unscoped():
        return db.scalar(select(Run).where(Run.share_token == token))


# ---------------------------------------------------------------------------
# Reproductions
# ---------------------------------------------------------------------------

def _same_owner(a: Run, b: Run) -> bool:
    if a.created_by_user_id is None and a.org_id is None:
        return b.created_by_user_id is None and b.org_id is None
    return (a.created_by_user_id is not None and b.created_by_user_id == a.created_by_user_id) or \
        (a.org_id is not None and b.org_id == a.org_id)


def _reproductions(db: Session, run: Run) -> list[tuple[Run, bool]]:
    """(reproduction, by_owner) for the reproductions that count, newest first."""
    with unscoped():
        rows = list(db.scalars(select(Run).where(Run.reproduction_of == run.run_id, Run.id != run.id)
                               .order_by(Run.created_at.desc()).limit(MAX_REPRODUCTIONS * 4)))
    out = []
    for r in rows:
        mine = _same_owner(run, r)
        if mine or r.share_token:
            out.append((r, mine))
    return out[:MAX_REPRODUCTIONS]


def reproduction(db: Session, run: Run, app_url: str = "") -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    for r, mine in _reproductions(db, run):
        c = rp.compare(run, r, "expert")
        shift = _d(c.get("shift"))
        shots = _d(shift.get("shots"))
        items.append({
            "state": c["state"],
            "exact": bool(c.get("exact")),
            "tvd": _dec(shift.get("tvd"), 4),
            "expected_tvd": _dec(shift.get("expected_tvd"), 4),
            "p_value": _dec(shift.get("p_value"), 4),
            "shots": _int(shots.get("b")) if shots else _int(r.shots),
            "backend": _s(r.backend, 120),
            "same_machine": not bool(c.get("other_machine")),
            "created_at": _iso(r.created_at),
            "by": "author" if mine else "other",
            # Only a reproduction its owner shared is named; the author's private ones are counted, not linked.
            "run_id": r.run_id if r.share_token else None,
            "public_page": f"{app_url}/share/{r.share_token}" if r.share_token and app_url else None,
        })
    return summarize(items)


def _ceil2(x: float) -> float:
    return math.ceil(x * 100 - 1e-9) / 100


def summarize(items: list[dict[str, Any]]) -> dict[str, Any]:
    agreed = [i for i in items if i["state"] == "reproduced"]
    failed = [i for i in items if i["state"] == "not_reproduced"]
    pending = [i for i in items if i["state"] == "pending"]
    if agreed and not failed:
        state = "reproduced"
    elif agreed and failed:
        state = "mixed"
    elif failed:
        state = "not_reproduced"
    else:
        state = "not_yet"
    tvds = [float(i["tvd"]) for i in agreed if i["tvd"] is not None]
    max_tvd = max(tvds) if tvds else None
    others = sum(1 for i in agreed if i["by"] == "other")
    n = len(agreed)
    plural = "s" if n != 1 else ""
    all_exact = bool(agreed) and all(i["exact"] for i in agreed)

    if state == "reproduced":
        if all_exact:
            plain = standard = f"Reproduced: {n} independent re-run{plural} gave exactly the same counts, shot for shot."
        else:
            plain = f"Reproduced: {n} independent re-run{plural} agreed; the differences are what chance alone gives."
            standard = (f"Reproduced: {n} independent re-run{plural} agreed within shot noise"
                        + (f" (TVD ≤ {_ceil2(max_tvd):.2f})." if max_tvd is not None else "."))
        expert = standard[:-1] + (f"; largest TVD {max_tvd:.4f}" if max_tvd is not None and not all_exact else "") + \
            f"; {n - others} by the author, {others} by others; test level alpha = {drift.ALPHA}."
    elif state == "mixed":
        plain = f"Mixed: {n} of {n + len(failed)} re-runs agreed with this run; {len(failed)} didn't."
        standard = (f"Mixed: {n} of {n + len(failed)} re-runs agreed within shot noise"
                    + (f" (TVD ≤ {_ceil2(max_tvd):.2f})" if max_tvd is not None else "") + f"; {len(failed)} didn't.")
        expert = standard[:-1] + f"; test level alpha = {drift.ALPHA}."
    elif state == "not_reproduced":
        f_tvds = [float(i["tvd"]) for i in failed if i["tvd"] is not None]
        k = len(failed)
        plain = f"Didn't reproduce: {k} re-run{'s' if k != 1 else ''} differed more than chance explains."
        standard = (f"Didn't reproduce: {k} re-run{'s' if k != 1 else ''} differed more than shot noise explains"
                    + (f" (TVD {min(f_tvds):.2f}" + (f"–{max(f_tvds):.2f})" if len(f_tvds) > 1 else ")") if f_tvds else "") + ".")
        expert = standard[:-1] + f"; test level alpha = {drift.ALPHA}."
    else:
        tail = f" {len(pending)} re-run{'s are' if len(pending) != 1 else ' is'} waiting for results." if pending else ""
        plain = standard = expert = "Not yet reproduced: no re-run has been compared with this run." + tail

    return {
        "state": state,
        "agreed": n,
        "disagreed": len(failed),
        "pending": len(pending),
        "not_judged": len(items) - n - len(failed) - len(pending),
        "all_exact": all_exact,
        "max_agreeing_tvd": _dec(max_tvd, 4) if max_tvd is not None else None,
        "alpha": _dec(drift.ALPHA, 4),
        "sentence": standard,
        "sentences": {"plain": plain, "standard": standard, "expert": expert},
        "runs": items,
    }


# ---------------------------------------------------------------------------
# Calibration and the matching Rewind snapshot
# ---------------------------------------------------------------------------

def _rewind_match(db: Session, run: Run, cal_time: Optional[datetime]) -> Optional[dict[str, Any]]:
    if not run.backend:
        return None
    try:
        from ..models import MachineSnapshot as M
        from ..rewind import store
        base = select(M).where(M.machine == run.backend, M.source.in_(("harvest", "backfill")))
        row, how = None, None
        if cal_time is not None:
            row = db.scalar(base.where(M.calibrated_at == store._utc(cal_time)).limit(1))
            how = "same_calibration" if row is not None else None
        if row is None and run.created_at is not None:
            when = store._utc(run.created_at)
            cand = db.scalar(base.where(M.calibrated_at <= when).order_by(M.calibrated_at.desc()).limit(1))
            if cand is not None and when - store._utc(cand.calibrated_at) <= timedelta(hours=IN_EFFECT_HOURS):
                row, how = cand, "in_effect_when_run"
        if row is None:
            return None
        return {"sha256": _hex(row.sha256), "provider": _s(row.provider, 40), "machine": _s(row.machine, 120),
                "calibrated_at": _iso(row.calibrated_at), "manifest_date": _iso(row.captured_at)[:10] if row.captured_at else None,
                "match": how}
    except Exception:
        return None


def _calibration(db: Session, run: Run) -> dict[str, Any]:
    cal = _d(run.calibration)
    when = _parse(cal.get("last_update")) or _parse(cal.get("snapshot_time"))
    return {
        "recorded": bool(cal),
        "sha256": json_sha256(cal) if cal else None,
        "hash_method": "sha256 of the run's calibration as JSON, keys sorted, no spaces "
                       "(Python: json.dumps(c, sort_keys=True, separators=(',', ':'), ensure_ascii=False))",
        "calibrated_at": _iso(when),
        "source": _s(cal.get("source"), 40),
        "rewind_snapshot": _rewind_match(db, run, when),
    }


# ---------------------------------------------------------------------------
# The body
# ---------------------------------------------------------------------------

def _circuit(run: Run) -> dict[str, Any]:
    fp = _d(run.fingerprint)
    tr = _d(run.transpiler)
    qpy, qasm = _d(tr.get("qpy")), _d(tr.get("qasm"))
    return {
        "as_run": {"qasm_sha256": _sha_text(run.qasm), "recorded_qasm_sha256": _hex(fp.get("qasm_sha256"))},
        "logical": {"qpy_sha256": _hex(_d(qpy.get("before")).get("sha256")),
                    "qasm_sha256": _sha_text(_d(qasm.get("before")).get("text"))},
        "compiled": {"qpy_sha256": _hex(_d(qpy.get("after")).get("sha256")),
                     "qasm_sha256": _sha_text(_d(qasm.get("after")).get("text"))},
        "hash_only": bool(fp.get("zk_qco")),
        "num_qubits": _int(fp.get("num_qubits")),
        "depth": _int(fp.get("depth")),
        "size": _int(fp.get("size")),
    }


def _settings(run: Run) -> dict[str, Any]:
    settings, via = rp.transpile_settings(run)
    tr: dict[str, Any] = {}
    for k, v in settings.items():
        if isinstance(v, float):
            tr[k] = _dec(v)
        elif isinstance(v, list):
            tr[k] = [_s(g, 40) for g in v][:64]
        else:
            tr[k] = v if isinstance(v, int) else _s(v, 60)
    prim = rp.primitive(run)
    return {
        "shots": _int(run.shots),
        "transpiler": tr,
        "compiled_with": via if _d(run.transpiler).get("settings") else None,
        "seed_simulator": _int(rp.seed(run)),
        "ran_with": prim["kind"] or None,
    }


def _software(run: Run) -> dict[str, Any]:
    vers = {k: _s(v, 40) for k, v in sorted(rp.versions(run).items()) if _SAFE_KEY.match(k)}
    return {"versions": vers, "python": rp.python_minor(run), "qlab_sdk": vers.get("qlab-sdk")}


def _results(run: Run) -> dict[str, Any]:
    counts = counts_of(run)
    return {
        "counts_sha256": json_sha256(counts) if counts else None,
        "hash_method": "sha256 of the counts as JSON, keys sorted, no spaces",
        "total_shots": sum(counts.values()) if counts else None,
        "outcomes": len(counts) if counts else None,
    }


def body(db: Session, run: Run, *, issued_at: datetime, app_url: str, commit: Optional[str]) -> dict[str, Any]:
    from ..routers.verify_run import record_digest
    prim = rp.primitive(run)
    return {
        "schema": FORMAT,
        "issued_at": _iso(issued_at),
        "issuer": {"name": "Q-Lab", "url": app_url or None, "backend_commit": commit,
                   "source": "https://github.com/soqlab/Q-lab"},
        "run": {
            "run_id": run.run_id,
            "circuit_name": _s(run.circuit_name, 255),
            "status": _s(run.status, 64),
            "created_at": _iso(run.created_at),
            "received_at": _iso(run.received_at),
            "record_sha256": record_digest(run),
            "public_page": f"{app_url}/verified/{run.share_token}" if run.share_token and app_url else None,
        },
        "circuit": _circuit(run),
        "machine": {"backend": _s(run.backend, 255), "kind": rp.backend_kind(run.backend, prim)},
        "calibration": _calibration(db, run),
        "software": _software(run),
        "settings": _settings(run),
        "results": _results(run),
        "reproduction": reproduction(db, run, app_url),
    }


def issue(db: Session, run: Run, *, app_url: str, commit: Optional[str], now: Optional[datetime] = None) -> dict[str, Any]:
    """The certificate document: body, its hash, and the hybrid signature (or why there is none)."""
    issued = (now or now_utc()).replace(microsecond=0)
    b = body(db, run, issued_at=issued, app_url=app_url, commit=commit)
    digest = cv.body_sha256(b)
    s = signing.signer()
    doc: dict[str, Any] = {"format": FORMAT, "certificate": b, "body_sha256": digest}
    if s is None:
        doc["signature"] = None
        doc["unsigned_reason"] = signing.status()["reason"]
        return doc
    signed_at = _iso(issued)
    message = cv.signed_bytes(s.key_id, signed_at, digest)
    doc["signature"] = {
        "key": s.key_id,
        "signed_at": signed_at,
        "ed25519": base64.b64encode(s.ed25519.sign(message)).decode("ascii"),
        "ml_dsa_65": base64.b64encode(s.ml_dsa_65.sign(message, cv.CONTEXT)).decode("ascii"),
        "public_key": s.public_key(),
    }
    return doc


def public_key() -> dict[str, Any]:
    s = signing.signer()
    st = signing.status()
    if s is None:
        return {"enabled": False, "reason": st["reason"], "public_key": None, "format": FORMAT}
    return {"enabled": True, "reason": None, "format": FORMAT, "context": FORMAT, "public_key": s.public_key(),
            "key_env": st["key_env"]}


def app_url() -> str:
    return (os.getenv("QLAB_APP_URL") or "").strip().rstrip("/")


# ---------------------------------------------------------------------------
# The badge
# ---------------------------------------------------------------------------

_BADGE = {
    "reproduced": "#2e7d4f",
    "mixed": "#b7791f",
    "not_reproduced": "#b42318",
    "not_yet": "#6b7280",
}


def badge_text(rep: dict[str, Any]) -> str:
    state = rep["state"]
    if state == "reproduced":
        return "reproduced exactly" if rep.get("all_exact") and rep["agreed"] == 1 else \
            f"reproduced ×{rep['agreed']}" if rep["agreed"] > 1 else "reproduced"
    if state == "mixed":
        return f"reproduced {rep['agreed']}/{rep['agreed'] + rep['disagreed']}"
    if state == "not_reproduced":
        return "didn't reproduce"
    return "not yet reproduced"


def _width(text: str) -> int:
    # Verdana 11px, roughly: narrow letters count less. Good enough for a two-part badge.
    narrow = sum(1 for c in text if c in "ijlt.,'/ ")
    return int(round((len(text) - narrow) * 6.8 + narrow * 3.6)) + 12


def badge_svg(rep: dict[str, Any], message: Optional[str] = None) -> str:
    from html import escape
    label, msg = "Q-Lab", message or badge_text(rep)
    color = _BADGE.get(rep["state"], _BADGE["not_yet"])
    lw, mw = _width(label), _width(msg)
    w = lw + mw
    title = escape(rep.get("sentence") or msg, quote=True)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="20" role="img" aria-label="Q-Lab: {escape(msg, quote=True)}">'
        f"<title>{title}</title>"
        f'<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/>'
        f'<stop offset="1" stop-opacity=".1"/></linearGradient>'
        f'<clipPath id="r"><rect width="{w}" height="20" rx="3" fill="#fff"/></clipPath>'
        f'<g clip-path="url(#r)"><rect width="{lw}" height="20" fill="#1f2328"/>'
        f'<rect x="{lw}" width="{mw}" height="20" fill="{color}"/><rect width="{w}" height="20" fill="url(#s)"/></g>'
        f'<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">'
        f'<text x="{lw / 2:.1f}" y="14">{label}</text>'
        f'<text x="{lw + mw / 2:.1f}" y="14">{escape(msg, quote=False)}</text></g></svg>'
    )
