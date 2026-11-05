"""Quantum provider prices: one table, read by every router that quotes a cost.

The numbers live in ``provider_prices.json`` next to this file. Each entry
carries the page it was copied from (``source``) and the day someone checked
that page (``verified_on``). Every estimate returns both, plus a stale warning
once an entry is older than ``stale_after_days`` (30 by default), so nobody
mistakes an old price for a current one.

When a provider publishes no price the entry's model is ``not_public`` and the
estimate amount is ``None``: we say "not public" rather than invent a number.
"""

from __future__ import annotations

import json
import re
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Optional

_PATH = Path(__file__).with_name("provider_prices.json")

with _PATH.open(encoding="utf-8") as _fh:
    _RAW = json.load(_fh)

STALE_AFTER_DAYS: int = int(_RAW.get("stale_after_days", 30))
PRICES: dict[str, dict] = _RAW["entries"]

NOT_PUBLIC = "not public"

# Gates billed as two-qubit gates by gate-shot pricing.
TWO_Q_GATES = frozenset({
    "cx", "cz", "ecr", "swap", "rzz", "rxx", "ryy", "cp",
    "cnot", "ccx", "cswap", "iswap", "dcx", "ch", "crz", "cu", "ms", "zz",
})


def _today(today: Optional[date] = None) -> date:
    return today or datetime.now(timezone.utc).date()


def provenance(key: str, today: Optional[date] = None) -> dict:
    """Source URL, verified date and staleness of one price entry."""
    p = PRICES[key]
    verified = date.fromisoformat(p["verified_on"])
    age = (_today(today) - verified).days
    stale = age > STALE_AFTER_DAYS
    return {
        "pricing_key": key,
        "pricing_name": p["name"],
        "pricing_source": p["source"],
        "pricing_verified": p["verified_on"],
        "pricing_age_days": age,
        "pricing_stale": stale,
        "stale_warning": (
            f"Price last checked {p['verified_on']} ({age} days ago, more than "
            f"{STALE_AFTER_DAYS}). Check {p['source']} before relying on it."
        ) if stale else None,
    }


def resolve(name: Optional[str]) -> Optional[str]:
    """Map a backend or provider name to a price entry key, or None if we hold no price."""
    n = (name or "").lower()
    if not n:
        return None
    azure = "azure" in n
    if "sv1" in n:
        return "braket_sv1"
    if "dm1" in n or "tn1" in n:
        return None
    if any(s in n for s in ("fake", "aer", "simulator", "statevector", "stabilizer", "local", "qvm")):
        return "local_simulator"
    if "ionq" in n or "forte" in n or "aria" in n:
        if "aria" in n:
            return "azure_ionq_aria"
        return "azure_ionq_forte" if azure else "braket_ionq_forte"
    if "rigetti" in n or "ankaa" in n or "cepheus" in n or "aspen" in n:
        return "azure_rigetti_cepheus" if azure else "braket_rigetti_cepheus"
    if "garnet" in n:
        return "braket_iqm_garnet"
    if "emerald" in n:
        return "braket_iqm_emerald"
    if "iqm" in n or "resonance" in n:
        return "iqm_resonance"
    if "aqt" in n or "ibex" in n:
        return "braket_aqt_ibex_q1"
    if "quera" in n or "aquila" in n:
        return "braket_quera_aquila"
    if "pasqal" in n or "fresnel" in n:
        return "azure_pasqal_fresnel"
    if "quantinuum" in n or re.match(r"^h[12](\b|[-_])", n):
        return "azure_quantinuum_h2" if azure else "quantinuum_direct"
    if "ibm" in n:
        return "ibm_payg"
    return None


def estimate_qpu_seconds(shots: int, depth: int = 1, qubits: int = 1) -> float:
    """Rough QPU-time guess for time-billed devices.

    This is Q-Lab's heuristic, not a provider figure: ~0.5 us per circuit layer
    per shot plus 0.1 s of per-qubit overhead, never below half a second.
    """
    return max(0.5, shots * depth * 0.0000005 + 0.1 * qubits)


def estimate_amount(
    key: str,
    shots: int,
    *,
    tasks: int = 1,
    one_q_gates: int = 0,
    two_q_gates: int = 0,
    depth: int = 1,
    qubits: int = 1,
    qpu_seconds: Optional[float] = None,
    error_mitigation: bool = False,
) -> Optional[float]:
    """Price of ``tasks`` identical tasks of ``shots`` shots, in the entry's currency.

    Returns None when the provider publishes no price.
    """
    p = PRICES[key]
    model = p["model"]
    tasks = max(1, int(tasks))
    shots = max(0, int(shots))
    if model == "not_public":
        return None
    if model == "free":
        return 0.0
    if model == "task_shot":
        return round(tasks * (p["per_task_usd"] + shots * p["per_shot_usd"]), 6)
    if model == "gate_shot":
        per_task = shots * (one_q_gates * p["usd_per_1q_gate_shot"] + two_q_gates * p["usd_per_2q_gate_shot"])
        floor = p["min_usd_per_task_error_mitigation"] if error_mitigation else p["min_usd_per_task"]
        return round(tasks * max(floor, per_task), 6)
    if model == "time_based":
        secs = qpu_seconds if qpu_seconds is not None else estimate_qpu_seconds(shots, depth, qubits)
        secs = max(secs, p.get("min_seconds", 0))
        return round(tasks * secs * p["per_second"], 6)
    if model == "per_minute":
        secs = qpu_seconds if qpu_seconds is not None else estimate_qpu_seconds(shots, depth, qubits)
        secs = max(secs, p.get("min_seconds", 0))
        return round(tasks * secs / 60.0 * p["per_minute"], 6)
    raise ValueError(f"unknown billing model {model!r} for {key}")


def estimate(key: str, shots: int, *, today: Optional[date] = None, **kw) -> dict:
    """``estimate_amount`` plus the entry's currency, billing model and provenance."""
    p = PRICES[key]
    amount = estimate_amount(key, shots, **kw)
    return {
        "amount": amount,
        "price_display": NOT_PUBLIC if amount is None else None,
        "currency": p.get("currency", "USD"),
        "billing_model": p["model"],
        "note": p.get("note"),
        **provenance(key, today),
    }


def table(today: Optional[date] = None) -> list[dict]:
    """Every entry with its provenance, for the pricing endpoints and the UI."""
    return [{"id": k, **v, **provenance(k, today)} for k, v in PRICES.items()]
