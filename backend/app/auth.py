import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

SECRET_KEY = os.getenv("QLAB_SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("QLAB_SECRET_KEY environment variable must be set")

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24 hours
ENROL_TOKEN_EXPIRE_MINUTES = 15
# A token with this scope only lets a password user register their first passkey.
ENROL_SCOPE = "passkey_enrol"


def passkeys_only() -> bool:
    """QLAB_PASSKEYS_ONLY: no passwords are set, reset or accepted for an account that has a passkey."""
    return os.getenv("QLAB_PASSKEYS_ONLY", "").strip().lower() in {"1", "true", "yes", "on"}


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except Exception:
        return False


def create_access_token(user_id: int, org_id: int | None, role: str, amr: str = "pwd") -> str:
    """A session token. amr records how the user signed in: passkey, oauth or pwd."""
    exp = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode(
        {"sub": str(user_id), "org": str(org_id) if org_id else None, "role": role, "amr": amr, "exp": exp},
        SECRET_KEY,
        algorithm=ALGORITHM,
    )


def create_enrolment_token(user_id: int) -> str:
    """Short-lived token after a password sign-in: good only for registering a first passkey."""
    exp = datetime.now(timezone.utc) + timedelta(minutes=ENROL_TOKEN_EXPIRE_MINUTES)
    return jwt.encode({"sub": str(user_id), "scope": ENROL_SCOPE, "exp": exp}, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])


def generate_api_key() -> tuple[str, str, str]:
    """Returns (full_key, sha256_hash, display_prefix)."""
    key = f"qlab_{secrets.token_urlsafe(32)}"
    return key, hashlib.sha256(key.encode()).hexdigest(), key[:12]


def hash_api_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def hash_link_token(token: str) -> str:
    """Emailed one-time links are stored hashed, so a database read can't use them."""
    return hashlib.sha256(token.encode()).hexdigest()
