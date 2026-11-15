"""A run next to the numbers a paper reports, and the verdict line.

The paper's numbers always come from the user (or, marked "extracted, check it", from a
bitstring table in the paper's own files). Three kinds:

* probability   the share of shots on given outcomes (a success probability). Compared with the
                same share here; agreement within shot noise (two standard errors) and rounding.
* fidelity      a single fidelity. Compared with this run's Hellinger fidelity to the noiseless
                distribution, which is only like-for-like when the paper used that quantity too.
* distribution  a bitstring -> count or probability table. Compared by Hellinger fidelity and
                total variation distance between the two distributions; the reversed bit order is
                tried as well, because papers write bitstrings both ways round.

On the ideal (noiseless) simulator the verdict says that noise isn't modelled, so a paper's
hardware numbers are expected to be lower than Q-Lab's.
"""
from __future__ import annotations

import math
import re
from typing import Any, Optional

BITS = re.compile(r"^[01]{1,32}$")
CLOSE = 0.97
ROUGH = 0.90
ROWS = 16


class CompareError(ValueError):
    pass


def _key(k: str) -> str:
    return str(k).replace(" ", "")


def _dist(table: dict[str, float]) -> dict[str, float]:
    total = float(sum(table.values()))
    if total <= 0:
        raise CompareError("The reported values add up to zero.")
    out: dict[str, float] = {}
    for k, v in table.items():
        out[_key(k)] = out.get(_key(k), 0.0) + float(v) / total
    return out


def _width(counts: dict[str, int]) -> Optional[int]:
    widths = {len(_key(k)) for k in counts}
    return widths.pop() if len(widths) == 1 else None


def tolerance(p: float, shots: int) -> float:
    """Two standard errors of a share measured with `shots` shots, at least 0.02 for rounding."""
    se = math.sqrt(max(p * (1 - p), 1e-4) / max(1, shots))
    return round(max(0.02, 2 * se), 3)


def hellinger(p: dict[str, float], q: dict[str, float]) -> float:
    bc = sum(math.sqrt(p.get(k, 0.0) * q.get(k, 0.0)) for k in set(p) | set(q))
    return round(min(1.0, bc * bc), 6)


def tvd(p: dict[str, float], q: dict[str, float]) -> float:
    return round(0.5 * sum(abs(p.get(k, 0.0) - q.get(k, 0.0)) for k in set(p) | set(q)), 6)


def _f(x: float) -> str:
    return f"{x:.3f}"


def _scalar(ours: float, theirs: float, shots: int, what: str, ideal_mode: bool) -> dict[str, Any]:
    tol = tolerance(ours, shots)
    diff = round(ours - theirs, 6)
    if ideal_mode:
        verdict = "ideal_only"
        line = (f"The noiseless simulator gives {_f(ours)}; the paper reports {_f(theirs)}. "
                + ("The gap is roughly what noise cost the paper's hardware, which this run doesn't model."
                   if ours > theirs + tol else
                   "They agree even without noise, so noise had little effect on this number."
                   if abs(diff) <= tol else
                   "The paper reports more than a noiseless run gives, so check the circuit and the outcomes chosen."))
    elif abs(diff) <= tol:
        verdict = "match"
        line = (f"Matches the paper: {what} {_f(ours)} here, {_f(theirs)} reported "
                f"(a difference of {abs(diff):.3f}, inside the ±{tol:.3f} that {shots:,} shots and rounding allow).")
    else:
        verdict = "lower" if diff < 0 else "higher"
        line = (f"{'Lower' if diff < 0 else 'Higher'} than the paper: {what} {_f(ours)} here, {_f(theirs)} reported "
                f"({abs(diff):.3f} {'lower' if diff < 0 else 'higher'}; shot noise explains about ±{tol:.3f}).")
    return {"ours": round(ours, 6), "reported": theirs, "difference": diff, "tolerance": tol, "verdict": verdict, "line": line}


def compare(result: dict[str, Any], reported: dict[str, Any]) -> dict[str, Any]:
    """result: a paper run (counts, shots, mode, ideal). reported: {kind, value | outcomes | distribution}."""
    kind = reported.get("kind")
    counts = {_key(k): int(v) for k, v in (result.get("counts") or {}).items()}
    shots = int(result.get("shots") or sum(counts.values()) or 0)
    if not counts or shots <= 0:
        raise CompareError("The run has no counts to compare.")
    ideal_mode = result.get("mode") == "ideal"
    width = _width(counts)
    notes: list[str] = []
    if ideal_mode:
        notes.append("Run on the noiseless (ideal) simulator: the paper's hardware noise isn't modelled.")
    if reported.get("extracted"):
        notes.append("The reported values were extracted from the paper's files: check them against the paper.")

    if kind == "probability":
        outs = [_key(o) for o in reported.get("outcomes") or []]
        if not outs or not all(BITS.match(o) for o in outs):
            raise CompareError("List the outcomes as bitstrings of 0 and 1, like 000,111.")
        if width and any(len(o) != width for o in outs):
            raise CompareError(f"The run's outcomes have {width} bits; the outcomes given don't.")
        value = float(reported.get("value"))
        ours = sum(counts.get(o, 0) for o in set(outs)) / shots
        out = _scalar(ours, value, shots, f"P({', '.join(sorted(set(outs))[:6])})", ideal_mode)
        return {"kind": kind, "outcomes": sorted(set(outs)), **out, "notes": notes}

    if kind == "fidelity":
        value = float(reported.get("value"))
        ideal = result.get("ideal") or {}
        ours = ideal.get("hellinger_fidelity")
        notes.append("Q-Lab's number is the Hellinger fidelity of the counts to the noiseless distribution. "
                     "If the paper reports a different fidelity (state, process, XEB), the two aren't the same quantity.")
        if ours is None:
            return {"kind": kind, "ours": None, "reported": value, "difference": None, "tolerance": None,
                    "verdict": "cannot", "notes": notes,
                    "line": "No fidelity to compare: " + (ideal.get("reason") or "the noiseless distribution isn't available.")}
        return {"kind": kind, **_scalar(float(ours), value, shots, "fidelity", ideal_mode), "notes": notes}

    if kind == "distribution":
        table = reported.get("distribution") or {}
        if not table or not all(BITS.match(_key(k)) for k in table):
            raise CompareError("Give the distribution as bitstring: value pairs, like 00: 0.48, 11: 0.47.")
        if any(not isinstance(v, (int, float)) or isinstance(v, bool) or v < 0 or not math.isfinite(v) for v in table.values()):
            raise CompareError("The reported values must be numbers of 0 or more.")
        theirs = _dist(table)
        if width and any(len(k) != width for k in theirs):
            raise CompareError(f"The run's outcomes have {width} bits; the reported bitstrings don't.")
        ours = _dist(counts)
        f = hellinger(ours, theirs)
        d = tvd(ours, theirs)
        flipped = hellinger(ours, {k[::-1]: v for k, v in theirs.items()})
        rows = sorted(set(theirs) | set(ours), key=lambda k: (-theirs.get(k, 0.0), -ours.get(k, 0.0), k))[:ROWS]
        if ideal_mode:
            verdict = "ideal_only"
            line = (f"Against the noiseless simulator the paper's distribution has a Hellinger fidelity of {_f(f)} "
                    f"(total variation distance {_f(d)}); "
                    + ("the difference is roughly what noise cost the paper's hardware." if f < CLOSE
                       else "the paper's result is close to noiseless."))
        elif f >= CLOSE:
            verdict = "close"
            line = f"Close to the paper: Hellinger fidelity {_f(f)} between the two distributions (total variation distance {_f(d)})."
        elif f >= ROUGH:
            verdict = "rough"
            line = f"Roughly like the paper: Hellinger fidelity {_f(f)} between the two distributions (total variation distance {_f(d)})."
        else:
            verdict = "differs"
            line = f"Differs from the paper: Hellinger fidelity {_f(f)} between the two distributions (total variation distance {_f(d)})."
        if flipped > f + 0.05 and width and width > 1:
            notes.append(f"With the paper's bitstrings read the other way round (qubit 0 on the left), the fidelity is {_f(flipped)}: "
                         "the paper may write them in the opposite order to Qiskit.")
        return {"kind": kind, "ours": f, "reported": None, "hellinger_fidelity": f, "tvd": d, "reversed_fidelity": flipped,
                "difference": None, "tolerance": None, "verdict": verdict, "line": line, "notes": notes,
                "rows": [[k, round(ours.get(k, 0.0), 6), round(theirs.get(k, 0.0), 6)] for k in rows]}

    raise CompareError("kind must be probability, fidelity or distribution.")
