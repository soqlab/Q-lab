"""Drift alarm: the same circuit ran again on the same machine, and the result moved.

"Same circuit as the run 3 days earlier on ibm_fez; the result moved (TVD 0.12, shot noise alone
about 0.02). Your code didn't change: qubit 5's readout error doubled since then (calibration Tue 11 Nov)."

- Same circuit: a hash of the circuit text with comments and whitespace normalised. The circuit
  passed to transpile() (transpiler.qasm.before, which the SDK records) is preferred, so a different
  layout from the compiler still counts as the same code; otherwise the circuit that was run (runs.qasm).
- Moved: the total variation distance between the two count distributions is tested against shot
  noise with run_diff's resampling test (pooled-multinomial null, fixed seed). The alarm needs
  p < ALPHA (0.01): stricter than the answer sentence's 0.05, because an alarm should be rare.
- Why: code side = the executed circuit, the transpiler settings and the package versions recorded
  with each run (qiskit, qiskit-ibm-runtime, qiskit-aer, qlab-sdk); machine side = the calibration
  snapshots recorded with each run, on the qubits and gates the circuits used (run_diff). When a
  run has no calibration snapshot, the machine side is said to be unknown, never guessed.

Everything is computed from two run records the caller can already see: the earlier run is found
with a Run query, which app/run_scope.py limits to the caller. Results are cached per pair of runs
(and invalidated when either run's results or calibration change).
"""
from __future__ import annotations

import hashlib
import json
import threading
import time
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Any, Callable, Literal, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from .machine_pick import normalize_text, normalized_hash
from .models import Run
from .run_diff import counts_of, explain_difference, shot_noise_analysis

Level = Literal["plain", "standard", "expert"]

ALPHA = 0.01
RESAMPLES = 1000
SEED = 20261113
# A calibration value counts as changed when it moved by at least this factor.
CHANGE_FACTOR = 1.25
_SCAN = 500
_CACHE_MAX = 2048
VERSION_KEYS = ("qiskit", "qiskit-ibm-runtime", "qiskit-aer", "qlab-sdk")


# ---------------------------------------------------------------------------
# Same circuit?
# ---------------------------------------------------------------------------

def logical_text(run: Any) -> Optional[str]:
    tr = run.transpiler if isinstance(run.transpiler, dict) else {}
    q = tr.get("qasm") if isinstance(tr.get("qasm"), dict) else {}
    before = q.get("before") if isinstance(q.get("before"), dict) else {}
    text = before.get("text")
    return text if isinstance(text, str) and text.strip() else None


def circuit_keys(run: Any) -> tuple[Optional[str], Optional[str]]:
    """(logical hash, executed hash): the circuit given to transpile(), and the circuit that ran."""
    logical = logical_text(run)
    lh = normalized_hash(logical) if logical and normalize_text(logical) else None
    if run.qasm and normalize_text(run.qasm):
        eh = normalized_hash(run.qasm)
    else:
        fp = run.fingerprint if isinstance(run.fingerprint, dict) else {}
        eh = fp.get("qasm_sha256") if isinstance(fp.get("qasm_sha256"), str) else None
    return lh, eh


def match_kind(a: Any, b: Any) -> Optional[str]:
    """"logical" when the same code was compiled, "executed" when the same circuit ran, else None."""
    la, ea = circuit_keys(a)
    lb, eb = circuit_keys(b)
    if la and lb:
        return "logical" if la == lb else None
    if ea and eb and ea == eb:
        return "executed"
    return None


def group_key(run: Any) -> Optional[str]:
    """One key per circuit for grouping a timeline (logical when recorded, else executed)."""
    lh, eh = circuit_keys(run)
    return f"L:{lh}" if lh else (f"E:{eh}" if eh else None)


def previous_same(db: Session, run: Run, allowed: Optional[Callable[[Run], bool]] = None) -> Optional[Run]:
    """The latest earlier run of the same circuit on the same backend, with counts, that the caller can see."""
    if not run.backend or run.created_at is None:
        return None
    q = (select(Run).where(Run.backend == run.backend, Run.created_at < run.created_at, Run.id != run.id)
         .order_by(Run.created_at.desc()).limit(_SCAN))
    for r in db.scalars(q):
        if allowed is not None and not allowed(r):
            continue
        if counts_of(r) and match_kind(r, run):
            return r
    return None


# ---------------------------------------------------------------------------
# Did it move?
# ---------------------------------------------------------------------------

_lock = threading.Lock()
_noise_cache: "OrderedDict[tuple, dict]" = OrderedDict()
_facts_cache: "OrderedDict[tuple, dict]" = OrderedDict()


def _rev(run: Any) -> str:
    """Changes when what the comparison reads changes."""
    material = json.dumps([run.results.get("counts") if isinstance(run.results, dict) else None,
                           (run.calibration or {}).get("snapshot_time") if isinstance(run.calibration, dict) else None,
                           (run.calibration or {}).get("last_update") if isinstance(run.calibration, dict) else None,
                           run.qasm, bool(logical_text(run))], sort_keys=True, default=str)
    return hashlib.sha256(material.encode()).hexdigest()[:16]


def _cached(cache: OrderedDict, key: tuple, make: Callable[[], dict]) -> dict:
    with _lock:
        hit = cache.get(key)
        if hit is not None:
            cache.move_to_end(key)
            return hit
    value = make()
    with _lock:
        cache[key] = value
        while len(cache) > _CACHE_MAX:
            cache.popitem(last=False)
    return value


def shift(prev: Any, run: Any) -> Optional[dict[str, Any]]:
    """Distance between the two runs' counts and whether shot noise explains it. None without counts."""
    ca, cb = counts_of(prev), counts_of(run)
    if not ca or not cb:
        return None

    def make() -> dict:
        n = shot_noise_analysis(ca, cb, seed=SEED, n_resamples=RESAMPLES)
        return {"tvd": n["observed_tvd"], "hellinger": n["observed_hellinger"],
                "expected_tvd": n["expected_tvd_from_shot_noise"], "noise_95": n["shot_noise_tvd_95th_percentile"],
                "p_value": n["p_value"], "shots": n["shots"], "drifted": n["p_value"] < ALPHA, "alpha": ALPHA,
                "resamples": RESAMPLES}

    return _cached(_noise_cache, (prev.run_id, run.run_id, _rev(prev), _rev(run)), make)


def reset_cache() -> None:
    with _lock:
        _noise_cache.clear()
        _facts_cache.clear()


# ---------------------------------------------------------------------------
# Why: code or machine?
# ---------------------------------------------------------------------------

def _versions(run: Any) -> dict[str, str]:
    ctx = run.context if isinstance(run.context, dict) else {}
    raw = ctx.get("library_versions") if isinstance(ctx.get("library_versions"), dict) else ctx.get("versions")
    out = {}
    for k, v in (raw or {}).items() if isinstance(raw, dict) else []:
        out[str(k).replace("_", "-").lower()] = str(v)
    if "qlab-sdk" not in out and isinstance(ctx.get("sdk_version"), str):
        out["qlab-sdk"] = ctx["sdk_version"]
    return out


def _fmt_val(v: Any) -> str:
    if v is None:
        return "not recorded"
    if isinstance(v, list):
        return "[" + ", ".join(str(x) for x in v[:8]) + (", …]" if len(v) > 8 else "]")
    if isinstance(v, dict):
        return ", ".join(f"{k} {n}" for k, n in sorted(v.items())[:6])
    return str(v)


def code_changes(diff: dict[str, Any], prev: Any, run: Any, match: str) -> list[dict[str, Any]]:
    out = []
    skip = {"setup_fingerprint", "qiskit_version", "executed_qpy_sha256"}
    for c in (diff.get("compiler") or {}).get("changes", []):
        if c["field"] in skip:
            continue
        if c["field"] == "executed_circuit_sha256":
            if match == "executed":
                continue
            out.append({"field": c["field"], "label": "The compiled circuit", "a": "", "b": "", "text": "the compiled circuit changed"})
            continue
        if c["a"] is None or c["b"] is None:
            continue  # recorded on one side only: not evidence of a change
        out.append({"field": c["field"], "label": c["label"], "a": _fmt_val(c["a"]), "b": _fmt_val(c["b"]),
                    "text": f"{c['label'].lower()} {_fmt_val(c['a'])} → {_fmt_val(c['b'])}"})
    va, vb = _versions(prev), _versions(run)
    for k in VERSION_KEYS:
        if va.get(k) and vb.get(k) and va[k] != vb[k]:
            out.append({"field": f"version:{k}", "label": k, "a": va[k], "b": vb[k], "text": f"{k} {va[k]} → {vb[k]}"})
    return out


def _ratio_words(factor: float) -> str:
    if factor >= 3.5:
        return f"rose {factor:.0f}×"
    if factor >= 2.5:
        return "tripled"
    if factor >= 1.8:
        return "doubled"
    return f"rose {round((factor - 1) * 100)}%"


def _fmt_num(kind: str, v: float) -> str:
    return f"{v:.0f} µs" if kind in ("t1_us", "t2_us") else (f"{v * 100:.2f}%" if v < 0.1 else f"{v * 100:.1f}%")


def hardware_changes(diff: dict[str, Any]) -> list[dict[str, Any]]:
    """Calibration values on the used qubits and gates that moved by CHANGE_FACTOR or more, worst first."""
    cal = diff.get("calibration") or {}
    items = []
    names = {"t1_us": "T1", "t2_us": "T2", "readout_errors": "readout error"}
    for row in cal.get("qubits", []):
        q = row["qubit"]
        for kind, label in names.items():
            c = row.get(kind) or {}
            a, b = c.get("a"), c.get("b")
            if not a or not b or a <= 0 or b <= 0:
                continue
            is_time = kind in ("t1_us", "t2_us")
            worse = (b < a) if is_time else (b > a)
            factor = (a / b if is_time else b / a) if worse else (b / a if is_time else a / b)
            if factor < CHANGE_FACTOR:
                continue
            if is_time:
                verb = ("halved" if factor >= 1.8 else f"fell {round((1 - b / a) * 100)}%") if worse else f"rose {round((b / a - 1) * 100)}%"
            else:
                verb = _ratio_words(factor) if worse else f"fell {round((1 - b / a) * 100)}%"
            items.append({"kind": kind, "qubit": q, "a": a, "b": b, "factor": round(factor, 3), "worse": worse,
                          "text": f"qubit {q}'s {label} {verb}",
                          "values": f"{_fmt_num(kind, a)} → {_fmt_num(kind, b)}"})
    for g in cal.get("gates", []):
        a, b = g.get("a"), g.get("b")
        if not a or not b or a <= 0 or b <= 0:
            continue
        worse = b > a
        factor = b / a if worse else a / b
        if factor < CHANGE_FACTOR:
            continue
        parts = g["gate"].split("_")
        name, qs = parts[0], parts[1:]
        where = f"on qubit {qs[0]}" if len(qs) == 1 else "on qubits " + "–".join(qs)
        verb = _ratio_words(factor) if worse else f"fell {round((1 - b / a) * 100)}%"
        items.append({"kind": "gate_error", "gate": g["gate"], "a": a, "b": b, "factor": round(factor, 3), "worse": worse,
                      "text": f"the {name} error {where} {verb}", "values": f"{_fmt_num('err', a)} → {_fmt_num('err', b)}"})
    items.sort(key=lambda x: (not x["worse"], -x["factor"]))
    return items


def _cal_time(run: Any) -> Optional[str]:
    cal = run.calibration if isinstance(run.calibration, dict) else {}
    for k in ("last_update", "snapshot_time"):
        if isinstance(cal.get(k), str) and cal[k]:
            return cal[k]
    return None


def _day(iso: Optional[str]) -> Optional[str]:
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    dt = dt.astimezone(timezone.utc)
    return f"{dt.strftime('%a')} {dt.day} {dt.strftime('%b')}"


def facts(prev: Any, run: Any) -> dict[str, Any]:
    """Everything the alarm says, independent of wording. Cached per pair."""
    def make() -> dict[str, Any]:
        match = match_kind(prev, run) or "executed"
        moved = shift(prev, run)
        out: dict[str, Any] = {
            "previous": {"run_id": prev.run_id, "backend": prev.backend,
                         "created_at": prev.created_at.isoformat() if prev.created_at else None},
            "match": match, "shift": moved,
        }
        if moved is None:
            out.update(state="cant_test", verdict=None, code=None, hardware=None)
            return out
        if not moved["drifted"]:
            out.update(state="steady", verdict=None, code=None, hardware=None)
            return out
        diff = explain_difference(prev, run)
        code = code_changes(diff, prev, run, match)
        snaps = (diff.get("calibration") or {}).get("snapshots") or {}
        recorded = {s: bool((snaps.get(s) or {}).get("recorded")) for s in ("a", "b")}
        cal_ok = recorded["a"] and recorded["b"] and bool((diff.get("calibration") or {}).get("restricted_to_used"))
        hw = hardware_changes(diff) if cal_ok else []
        fid = (diff.get("calibration") or {}).get("fidelity") or {}
        hardware = {
            "available": cal_ok,
            "recorded": recorded,
            "changes": hw[:6],
            "calibrated": {"a": _cal_time(prev), "b": _cal_time(run)},
            "calibration_effect": fid.get("calibration_effect"),
            "compiler_effect": fid.get("compiler_effect"),
        }
        hw_moved = bool(hw)
        if code and hw_moved:
            verdict = "both"
        elif hw_moved:
            verdict = "hardware"
        elif code:
            verdict = "code"
        elif cal_ok:
            verdict = "unexplained"
        else:
            verdict = "unknown"
        out.update(state="drifted", verdict=verdict, code={"changed": bool(code), "changes": code[:8]}, hardware=hardware)
        return out

    return _cached(_facts_cache, (prev.run_id, run.run_id, _rev(prev), _rev(run)), make)


# ---------------------------------------------------------------------------
# Wording
# ---------------------------------------------------------------------------

def _when(prev: Any, run: Any) -> str:
    from .run_answer import _when as when
    return when(prev.created_at, run.created_at)


def sentence(f: dict[str, Any], prev: Any, run: Any, level: Level) -> str:
    when = _when(prev, run)
    on = f" on {run.backend}" if run.backend else ""
    s = f["shift"]
    if f["state"] == "cant_test":
        return f"Same circuit as {when}{on}, but one of them has no counts to compare."
    if f["state"] == "steady":
        if level == "plain":
            return f"Same circuit as {when}{on}, and the results agree: the difference is what chance alone gives."
        tail = f" (TVD {s['tvd']:.3f}, within shot noise)" if level == "standard" else \
            f" (TVD {s['tvd']:.3f}; shot noise alone gives about {s['expected_tvd']:.3f}; p = {s['p_value']:.3g})"
        return f"Same circuit as {when}{on}; the result held{tail}."
    if level == "plain":
        head = f"Same circuit as {when}{on}, but the results moved more than chance explains."
    elif level == "standard":
        head = f"Same circuit as {when}{on}; the result moved (TVD {s['tvd']:.2f}, shot noise alone ≈{s['expected_tvd']:.2f})."
    else:
        head = (f"Same circuit as {when}{on}; the result moved: TVD {s['tvd']:.3f}, shot noise alone gives about "
                f"{s['expected_tvd']:.3f} (95% below {s['noise_95']:.3f}), p = {s['p_value']:.3g} with "
                f"{s['shots']['a']} and {s['shots']['b']} shots.")
    same = "Your code didn't change" if f["match"] == "logical" else "The same circuit ran"
    hw = f["hardware"] or {}
    code = (f["code"] or {}).get("changes") or []
    top = (hw.get("changes") or [None])[0]
    day = _day(hw.get("calibrated", {}).get("b"))
    hw_text = None
    if top:
        hw_text = top["text"] + " since then"
        if level == "expert":
            hw_text += f" ({top['values']})"
        if day and level != "plain":
            hw_text += f" (calibration {day})"
    code_text = ", ".join(c["text"] for c in code[:3])
    v = f["verdict"]
    if v == "hardware":
        return f"{head} {same}: {hw_text}."
    if v == "code":
        if level == "plain":
            return f"{head} The machine's calibration barely moved; what changed is on your side: {code_text}."
        return f"{head} The recorded calibration of the qubits it used didn't move much; what changed is on your side: {code_text}."
    if v == "both":
        return f"{head} Both sides changed: {code_text}; and {hw_text}."
    if v == "unexplained":
        return (f"{head} {same}, and the recorded calibration of the qubits it used didn't move enough to explain it: "
                "something not recorded changed (drift between calibrations, crosstalk, leakage).")
    missing = [n for n, ok in (("the earlier run", (hw.get("recorded") or {}).get("a")),
                               ("this run", (hw.get("recorded") or {}).get("b"))) if not ok]
    why = (f"no calibration snapshot was recorded with {' or '.join(missing)}" if missing
           else "the qubits the circuits used couldn't be read from the records")
    return f"{head} {same}; whether the machine changed can't be said: {why}."


def drift_for(db: Session, run: Run, level: Level = "standard",
              allowed: Optional[Callable[[Run], bool]] = None) -> dict[str, Any]:
    """The drift alarm for one run, as served to its page."""
    base: dict[str, Any] = {"run_id": run.run_id, "level": level, "alpha": ALPHA}
    if not run.backend:
        return {**base, "state": "no_previous", "sentence": None, "reason": "no backend recorded"}
    if not counts_of(run):
        return {**base, "state": "no_previous", "sentence": None, "reason": "no counts"}
    prev = previous_same(db, run, allowed)
    if prev is None:
        return {**base, "state": "no_previous", "sentence": None,
                "reason": "no earlier run of this circuit on this backend"}
    f = facts(prev, run)
    return {**base, **f, "sentence": sentence(f, prev, run, level)}


def timeline_marks(runs: list[Run], budget_s: float = 4.0) -> dict[str, dict[str, Any]]:
    """For a list of runs (oldest first): each run's shift from the previous run of the same circuit
    on the same backend in that list. Bounded by budget_s; later pairs come first (they're the ones looked at)."""
    last: dict[tuple, Run] = {}
    pairs: list[tuple[Run, Run]] = []
    for r in runs:
        k = group_key(r)
        if not k or not r.backend or not counts_of(r):
            continue
        prev = last.get((r.backend, k))
        if prev is not None:
            pairs.append((prev, r))
        last[(r.backend, k)] = r
    out: dict[str, dict[str, Any]] = {}
    deadline = time.monotonic() + budget_s
    for prev, r in reversed(pairs):
        if time.monotonic() > deadline:
            break
        s = shift(prev, r)
        if s is not None:
            out[r.run_id] = {"previous_run_id": prev.run_id, "tvd": s["tvd"], "p_value": s["p_value"],
                             "drifted": s["drifted"]}
    return out
