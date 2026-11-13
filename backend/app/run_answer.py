"""The one-sentence answer a run opens with, and the run it is compared against.

"Bell state on ibm_brisbane: 94% of shots landed on the expected outcomes, 3 points worse than
last week's run."

Everything comes from the stored run records:

- the measure is the share of shots on outcomes the noise-free circuit can produce. The ideal
  outcomes come from an exact statevector of the run's own QASM (small circuits whose final
  measurements map qubit k to bit k), or from what the run recorded itself (the hardware board
  stores its ideal distribution). When neither is available the sentence uses the most frequent
  outcome instead and says so;
- the previous comparable run is the latest earlier run of the same circuit (same QASM hash,
  else same circuit name) that the caller can see, preferring the same backend;
- whether the change is real comes from run_diff's shot-noise test, and a cause is named only
  when run_diff finds it large enough to account for the difference from the stored calibration
  or compiled circuit. Otherwise no cause is given.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable, Literal, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Run
from .run_diff import counts_of, explain_difference

Level = Literal["plain", "standard", "expert"]
LEVELS = ("plain", "standard", "expert")

# Earlier runs considered when looking for the previous comparable one.
_SCAN = 1000


def ideal_distribution(run: Run) -> tuple[Optional[dict[str, float]], str]:
    """The noise-free outcome distribution and where it came from, or (None, reason)."""
    recorded = (run.results or {}).get("ideal")
    if isinstance(recorded, dict) and recorded and all(isinstance(v, (int, float)) for v in recorded.values()):
        return {str(k): float(v) for k, v in recorded.items()}, "recorded with the run"
    if not run.qasm:
        return None, "no circuit was recorded"
    try:
        from .local_sim import ideal_probabilities

        return ideal_probabilities(run.qasm), "exact simulation of the recorded circuit"
    except ValueError as exc:
        return None, str(exc)
    except Exception as exc:  # noqa: BLE001 - any simulation failure just means "no ideal"
        return None, f"the circuit couldn't be simulated ({type(exc).__name__})"


def _bits(key: str) -> str:
    """Counts keys as plain bitstrings: Qiskit may put spaces between registers or use hex."""
    k = key.replace(" ", "")
    if k.startswith("0x"):
        try:
            return bin(int(k, 16))[2:]
        except ValueError:
            return k
    return k


def measure(run: Run, ideal_known: Optional[tuple[Optional[dict[str, float]], str]] = None) -> Optional[dict[str, Any]]:
    """The run's headline number: share of shots on ideal outcomes, else the top outcome's share."""
    counts = counts_of(run)
    if not counts:
        return None
    total = sum(counts.values())
    if total <= 0:
        return None
    ideal, source = ideal_known if ideal_known is not None else ideal_distribution(run)
    if ideal:
        width = max(len(k) for k in ideal)
        norm = {_bits(k).zfill(width): v for k, v in counts.items()}
        hits = sum(v for k, v in norm.items() if k in ideal)
        bc = sum((norm.get(k, 0) / total) ** 0.5 * p ** 0.5 for k, p in ideal.items())
        return {
            "kind": "ideal_share", "value": hits / total, "shots": total,
            "hellinger_fidelity": bc * bc, "ideal_outcomes": sorted(ideal), "ideal_source": source,
        }
    top, n = max(counts.items(), key=lambda kv: kv[1])
    return {"kind": "top_share", "value": n / total, "shots": total, "top_outcome": top, "ideal_source": source}


def _hash(run: Run) -> Optional[str]:
    h = (run.fingerprint or {}).get("qasm_sha256")
    return h if isinstance(h, str) and h else None


def previous_comparable(db: Session, run: Run, allowed: Optional[Callable[[Run], bool]] = None) -> Optional[Run]:
    """Latest earlier run of the same circuit the caller can see; same backend preferred.

    Run queries are scoped to the caller (app/run_scope.py), so this never finds someone else's run.
    """
    h = _hash(run)
    if not h and not run.circuit_name:
        return None
    q = select(Run).where(Run.created_at < run.created_at, Run.id != run.id).order_by(Run.created_at.desc()).limit(_SCAN)
    if not h:
        q = q.where(Run.circuit_name == run.circuit_name)
    same = [r for r in db.scalars(q).all() if ((h and _hash(r) == h) or (not h)) and (allowed is None or allowed(r))]
    for r in same:
        if r.backend == run.backend:
            return r
    return same[0] if same else None


def _when(earlier: datetime, later: datetime) -> str:
    a = earlier if earlier.tzinfo else earlier.replace(tzinfo=timezone.utc)
    b = later if later.tzinfo else later.replace(tzinfo=timezone.utc)
    days = (b - a).total_seconds() / 86400
    if days < 1 / 24:
        return "the run just before it"
    if days < 1:
        return "the run earlier the same day"
    if days < 2:
        return "the run the day before"
    if days < 6.5:
        return f"the run {round(days)} days earlier"
    if days < 13:
        return "last week's run"
    if days < 60:
        return f"the run {round(days / 7)} weeks earlier"
    return f"the run {round(days / 30)} months earlier"


def _pct(x: float) -> str:
    return f"{x * 100:.0f}%" if abs(x * 100 - round(x * 100)) < 0.05 or x * 100 >= 10 else f"{x * 100:.1f}%"


def _cause(diff: dict[str, Any], level: Level) -> Optional[str]:
    """A cause, only when run_diff found one big enough to account for the change."""
    fid = (diff.get("calibration") or {}).get("fidelity") or {}
    noise = diff.get("noise") or {}
    excess = noise.get("excess_tvd")
    if not noise.get("significant") or excess is None:
        return None
    from .run_diff import _worst_changes

    for f in (diff.get("attribution") or {}).get("factors", []):
        if f["verdict"] != "plausible":
            continue
        if f["factor"] == "calibration":
            effect = fid.get("calibration_effect")
            if effect is None or abs(effect) < excess:
                continue
            worst = _worst_changes(diff["calibration"], limit=1 if level != "expert" else 3)
            if not worst:
                continue
            if level == "plain":
                return "The machine's calibration changed on the qubits it used, enough to explain it"
            return "Likely cause: calibration drift (" + "; ".join(worst) + ")"
        if f["factor"] == "compiler":
            effect = fid.get("compiler_effect")
            if effect is None or abs(effect) < excess:
                continue
            return ("The circuit was compiled differently this time, enough to explain it" if level == "plain"
                    else "Likely cause: the compiled circuit changed")
    return None


def answer(db: Session, run: Run, level: Level = "standard", allowed: Optional[Callable[[Run], bool]] = None) -> dict[str, Any]:
    name = run.circuit_name or f"Run {run.run_id[:8]}"
    where = f" on {run.backend}" if run.backend else ""
    m = measure(run)
    prev = previous_comparable(db, run, allowed)
    pm = measure(prev) if prev is not None else None
    out: dict[str, Any] = {
        "run_id": run.run_id, "level": level, "measure": m, "previous": None, "change": None, "cause": None,
    }

    if m is None:
        status = run.status or "recorded"
        out["sentence"] = (f"{name}{where}: {status}, with no measured results stored, so there is nothing to score yet."
                           if level != "plain" else f"{name}{where} has no results yet, so there's nothing to compare.")
        return out

    if m["kind"] == "ideal_share":
        if level == "plain":
            head = f"{name}{where}: {_pct(m['value'])} of the shots gave an answer the circuit should give"
        else:
            head = f"{name}{where}: {_pct(m['value'])} of shots landed on the expected outcomes"
        if level == "expert":
            head += f" (Hellinger fidelity {m['hellinger_fidelity']:.3f}, {m['shots']} shots)"
    else:
        head = (f"{name}{where}: the most common result, {m['top_outcome']}, came up in {_pct(m['value'])} of shots"
                + ("" if level == "plain" else f" (no ideal to compare with: {m['ideal_source']})"))

    if prev is None:
        out["sentence"] = head + ". This is the first recorded run of this circuit, so there is nothing to compare it with yet."
        return out

    out["previous"] = {
        "run_id": prev.run_id, "backend": prev.backend, "created_at": prev.created_at.isoformat() if prev.created_at else None,
        "measure": pm, "same_backend": prev.backend == run.backend,
    }
    when = _when(prev.created_at, run.created_at)
    other = "" if prev.backend == run.backend or not prev.backend else f" on {prev.backend}"
    if pm is None or pm["kind"] != m["kind"]:
        out["sentence"] = head + f". {when.capitalize()}{other} can't be scored the same way, so they aren't compared."
        return out

    diff = explain_difference(prev, run)
    noise = diff.get("noise") or {}
    delta = (m["value"] - pm["value"]) * 100
    out["change"] = {"points": round(delta, 2), "significant": bool(noise.get("significant")),
                     "p_value": noise.get("p_value"), "tvd": (diff.get("observed") or {}).get("tvd")}
    if not noise.get("significant"):
        tail = (f", about the same as {when}{other}" + (" (the gap is what shot noise alone gives)" if level != "plain" else ""))
    else:
        pts = abs(delta)
        word = "better" if delta > 0 else "worse"
        shown = f"{pts:.0f}" if pts >= 10 else f"{pts:.1f}".rstrip("0").rstrip(".")
        tail = (f", {shown} point{'' if shown == '1' else 's'} {word} than {when}{other}" if pts >= 0.05
                else f", a real but tiny change from {when}{other}")
        if level == "expert" and noise.get("p_value") is not None:
            tail += f" (TVD {diff['observed']['tvd']:.3f}, p = {noise['p_value']:.3g})"
    sentence = head + tail + "."
    cause = _cause(diff, level)
    if cause:
        out["cause"] = cause
        sentence += f" {cause}."
    out["sentence"] = sentence
    return out
