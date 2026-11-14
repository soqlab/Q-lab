"""The key certificates are signed with.

QLAB_CERT_SIGNING_KEY when it is set, otherwise Rewind's QLAB_REWIND_SIGNING_KEY: one server key is
enough, and the ML-DSA context string and the first line of the signed text keep a certificate from
ever being read as a Rewind manifest (or the other way round). Both use the same ``qrk1:`` form
(make one with ``python -m app.rewind keygen``). Without either, certificates are issued unsigned
and say why.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

from ..rewind import signing as rewind_signing

log = logging.getLogger("qlab.provenance")

CERT_KEY_ENV = "QLAB_CERT_SIGNING_KEY"


def _source() -> tuple[str, str]:
    raw = os.getenv(CERT_KEY_ENV, "").strip()
    if raw:
        return CERT_KEY_ENV, raw
    return rewind_signing.KEY_ENV, os.getenv(rewind_signing.KEY_ENV, "").strip()


def status() -> dict[str, Any]:
    """{"enabled", "key_id", "key_env", "reason"}; never exposes the private key."""
    env, raw = _source()
    if not raw:
        return {"enabled": False, "key_id": None, "key_env": None,
                "reason": f"This server has no signing key ({CERT_KEY_ENV} or {rewind_signing.KEY_ENV}), "
                          "so its certificates are unsigned."}
    try:
        s = rewind_signing.parse_key(raw)
    except Exception as exc:
        return {"enabled": False, "key_id": None, "key_env": env,
                "reason": f"The signing key in {env} can't be used: {str(exc).replace(rewind_signing.KEY_ENV, env)}"}
    return {"enabled": True, "key_id": s.key_id, "key_env": env, "reason": None}


def signer() -> Optional[rewind_signing.Signer]:
    env, raw = _source()
    if not raw:
        return None
    try:
        return rewind_signing.parse_key(raw)
    except Exception as exc:
        log.error("certificate signing key in %s: %s", env, exc)
        return None
