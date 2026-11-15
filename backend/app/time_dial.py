"""The time dial on a run's page: this run's circuit on this run's IBM machine, across time.

    past     replay the run's circuit on a replica of the machine as calibrated on a stored day
             (Rewind: app/rewind/replay.py), with Rewind's measured accuracy for that machine and a
             line saying which calibration values of the qubits the replay used moved most
             between the run's day and that day (drift.hardware_changes' wording and threshold)
    present  the run's own recorded counts
    future   which machine, and roughly when in the day, should do best in the coming days: the
             circuit compiled on each machine's latest stored calibration and scored with
             machine_pick's estimated success probability (ESP) against each of its last
             WINDOW_DAYS stored calibrations. A persistence forecast: it assumes the coming days
             look like those days. The hour is when the machine's calibration usually lands
             (a fresh calibration describes the machine best); Rewind does not measure an
             hour-of-day effect. Whether the same circuit's results already drifted on this
             machine comes from app/drift.py.

Only stored calibrations are used. On a server without an IBM Quantum key nothing is stored, and
the answer says so instead of making anything up. Replays never touch real hardware.
"""
from __future__ import annotations

import statistics
import threading
from collections import Counter, OrderedDict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Optional

from sqlalchemy.orm import Session

from . import drift
from . import machine_pick as mp
from .models import Run
from .rewind import bench
from .rewind import compare as cmp
from .rewind import harvest as hv
from .rewind import replay as rp
from .rewind import store
from .rewind.snapshot import MACHINE_RE, iso
from .run_diff import counts_of

WINDOW_DAYS = 7          # calibrations per machine the forecast scores the circuit against
MAX_MACHINES = 5         # machines the forecast compares (the run's own machine always included)
MAX_DIAL_SHOTS = 4096    # replays on the dial stay quick
NEAR_RUN_DAYS = 2.0      # a calibration this close to the run counts as "the run's day"
_CACHE_MAX = 256
NOT_AFFILIATED = "Simulated from IBM-published calibration. Not affiliated with or endorsed by IBM."


# ---------------------------------------------------------------------------
# Which runs the dial applies to
# ---------------------------------------------------------------------------

def machine_of(run: Run) -> tuple[Optional[str], Optional[str]]:
    """(IBM machine name, None) or (None, why the dial doesn't apply)."""
    backend = (run.backend or "").strip()
    if not backend:
        return None, "no_backend"
    if backend.startswith("rewind:"):
        return None, "replay"
    low = backend.lower()
    if any(w in low for w in ("simulator", "aer", "fake", "statevector", "qasm_sim", "stabilizer")):
        return None, "simulator"
    if not low.startswith("ibm_") or not MACHINE_RE.match(backend):
        return None, "not_ibm"
    return backend, None


REASONS = {
    "no_backend": "This run has no backend recorded, so there is no machine to move through time.",
    "replay": "This run is itself a Rewind replay; the dial works on runs from real IBM machines.",
    "simulator": "This run ran on a simulator, which doesn't change from day to day, so there is nothing to dial through.",
    "not_ibm": "The time dial works on runs from IBM Quantum machines, whose daily calibration Rewind stores. "
               "This run's backend isn't one.",
    "no_circuit": "This run has no circuit recorded, so it can't be replayed.",
}


def circuit_text(run: Run) -> Optional[str]:
    """The circuit given to transpile() when the SDK recorded it, else the circuit that ran."""
    text = drift.logical_text(run) or run.qasm
    return text if isinstance(text, str) and text.strip() else None


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def run_shots(run: Run) -> int:
    counts = counts_of(run)
    if counts:
        return sum(counts.values())
    ex = run.execution if isinstance(run.execution, dict) else {}
    s = ex.get("shots")
    return int(s) if isinstance(s, int) and s > 0 else 1024


def dial_shots(run: Run, signed_in: bool) -> int:
    return max(1, min(run_shots(run), rp.max_shots(signed_in), MAX_DIAL_SHOTS))


def empty_reason(machine: str) -> str:
    if not hv.configured():
        return ("Rewind starts collecting once this server has an IBM Quantum key. Until then there are no stored "
                f"calibrations of {machine} to replay or forecast from, and nothing is made up in their place.")
    return (f"Rewind hasn't stored a calibration of {machine} yet. It collects every {hv.every_hours()} hours; "
            "the dial fills in as days are stored.")


def timeline(db: Session, run: Run) -> dict[str, Any]:
    """What the dial can show for this run: the stored days, the run itself, whether a forecast exists."""
    base: dict[str, Any] = {"run_id": run.run_id, "run_date": _aware(run.created_at).date().isoformat()
                            if run.created_at else None}
    machine, why = machine_of(run)
    if machine is None:
        return {**base, "state": "unavailable", "reason": why, "message": REASONS[why], "machine": None}
    text = circuit_text(run)
    counts = counts_of(run)
    present = {"counts": counts, "shots": sum(counts.values()) if counts else None}
    include_sim = hv.simulated()
    days = cmp.stored_days(db, machine, include_sim)
    accuracy, note = bench.accuracy_for(db, machine, include_simulated=include_sim)
    out = {**base, "machine": machine, "present": present, "past": days, "collecting": hv.configured(),
           "simulated": include_sim, "accuracy": accuracy, "accuracy_note": note, "label": NOT_AFFILIATED,
           "forecast": {"available": bool(days and text),
                        "method": FORECAST_METHOD}}
    if text is None:
        return {**out, "state": "unavailable", "reason": "no_circuit", "message": REASONS["no_circuit"], "past": [],
                "forecast": {"available": False, "method": FORECAST_METHOD}}
    if not days:
        return {**out, "state": "empty", "reason": "no_snapshots", "message": empty_reason(machine)}
    return {**out, "state": "ready", "reason": None, "message": None}


# ---------------------------------------------------------------------------
# Caches: replays and forecasts are deterministic for the same inputs
# ---------------------------------------------------------------------------

_lock = threading.Lock()
_replays: "OrderedDict[tuple, dict]" = OrderedDict()
_forecasts: "OrderedDict[tuple, dict]" = OrderedDict()
_records: "OrderedDict[str, dict]" = OrderedDict()


def _get(cache: OrderedDict, key: Any) -> Optional[dict]:
    with _lock:
        hit = cache.get(key)
        if hit is not None:
            cache.move_to_end(key)
        return hit


def _put(cache: OrderedDict, key: Any, value: dict, cap: int = _CACHE_MAX) -> None:
    with _lock:
        cache[key] = value
        while len(cache) > cap:
            cache.popitem(last=False)


def reset_cache() -> None:
    with _lock:
        _replays.clear()
        _forecasts.clear()
        _records.clear()


def _noise(row) -> dict[str, Any]:
    """A stored calibration's noise view and size (kept small: the raw properties are dropped)."""
    hit = _get(_records, row.sha256)
    if hit is not None:
        return hit
    rec = store.load(row)
    slim = {"machine": rec.get("machine"), "num_qubits": rec.get("num_qubits"), "noise": rec.get("noise") or {},
            "basis_gates": rec.get("basis_gates")}
    _put(_records, row.sha256, slim, cap=24)
    return slim


# ---------------------------------------------------------------------------
# The past: a replay, and what changed
# ---------------------------------------------------------------------------

def _qubit_values(noise: dict[str, Any], q: int) -> dict[str, Optional[float]]:
    def at(xs: list, i: int):
        v = xs[i] if i < len(xs) else None
        return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None
    ro = noise.get("readout") or []
    r = ro[q] if q < len(ro) else None
    return {"t1_us": at(noise.get("t1_us") or [], q), "t2_us": at(noise.get("t2_us") or [], q),
            "readout_errors": float(r[0]) if r and isinstance(r[0], (int, float)) else None}


def calibration_changes(a: dict[str, Any], b: dict[str, Any], physical: list[int]) -> list[dict[str, Any]]:
    """Values on `physical` (and the gates among them) that moved by drift.CHANGE_FACTOR or more from
    calibration a (earlier) to b (later), worst first, in the drift alarm's words."""
    used = set(physical)
    qubits = []
    for q in sorted(used):
        va, vb = _qubit_values(a, q), _qubit_values(b, q)
        qubits.append({"qubit": q, **{k: {"a": va[k], "b": vb[k]} for k in va}})
    gates = []
    ga, gb = a.get("gates") or {}, b.get("gates") or {}
    for name in sorted(set(ga) & set(gb)):
        if name in ("measure", "reset", "delay", "barrier"):
            continue
        for key in sorted(set(ga[name]) & set(gb[name])):
            qs = [int(x) for x in key.split("_")]
            if not set(qs) <= used:
                continue
            ea, eb = (ga[name][key] or [None])[0], (gb[name][key] or [None])[0]
            if ea is None or eb is None or ea >= 1.0 or eb >= 1.0:
                continue
            gates.append({"gate": f"{name}_{key}", "a": ea, "b": eb})
    return drift.hardware_changes({"calibration": {"qubits": qubits, "gates": gates}})


def _day_words(d: str) -> str:
    dt = date.fromisoformat(d)
    return f"{dt.strftime('%a')} {dt.day} {dt.strftime('%b')} {dt.year}"


def what_changed(db: Session, run: Run, machine: str, row, physical: list[int], include_sim: bool) -> dict[str, Any]:
    """One line on how the calibration of the replay's qubits differs between the run's day and this day."""
    when = _aware(run.created_at) or datetime.now(timezone.utc)
    ref = store.nearest(db, machine, when, include_simulated=include_sim)
    out: dict[str, Any] = {"run_calibration": None, "changes": [], "sentence": None}
    if ref is None:
        return out
    ref_cal = _aware(ref.calibrated_at)
    gap = abs((ref_cal - when).total_seconds()) / 86400.0
    out["run_calibration"] = {"calibrated_at": iso(ref_cal), "near_run": gap <= NEAR_RUN_DAYS}
    if ref.sha256 == row.sha256:
        out["sentence"] = ("Same calibration as the run's day: the replay shows what the noise model gives for the "
                           "calibration the run had.")
        return out
    try:
        a, b = _noise(ref)["noise"], _noise(row)["noise"]
    except (store.SnapshotCorrupt, OSError):
        return out
    this_cal = _aware(row.calibrated_at)
    ref_label = "the run's day" if gap <= NEAR_RUN_DAYS else f"the calibration nearest the run ({_day_words(ref_cal.date().isoformat())})"
    earlier_is_ref = ref_cal <= this_cal
    first, second = (a, b) if earlier_is_ref else (b, a)
    changes = calibration_changes(first, second, physical)
    out["changes"] = changes[:6]
    span = (f"from {ref_label} to {_day_words(this_cal.date().isoformat())}" if earlier_is_ref
            else f"from {_day_words(this_cal.date().isoformat())} to {ref_label}")
    if not changes:
        out["sentence"] = (f"On the qubits this replay used, no T1, T2, readout or gate error moved by "
                           f"{round((drift.CHANGE_FACTOR - 1) * 100)}% or more {span}.")
    else:
        top = "; ".join(c["text"] for c in changes[:2])
        more = f" (and {len(changes) - 2} more)" if len(changes) > 2 else ""
        out["sentence"] = f"{span[0].upper()}{span[1:]}: {top}{more}."
    return out


def _tvd(a: dict[str, int], b: dict[str, int]) -> Optional[float]:
    na, nb = sum(a.values()), sum(b.values())
    if not na or not nb:
        return None
    pa = {k.replace(" ", ""): v / na for k, v in a.items()}
    pb = {k.replace(" ", ""): v / nb for k, v in b.items()}
    return round(0.5 * sum(abs(pa.get(k, 0.0) - pb.get(k, 0.0)) for k in set(pa) | set(pb)), 6)


def replay_key(run: Run, day: date, shots: int, sha: str) -> tuple:
    return (run.run_id, drift._rev(run), day.isoformat(), shots, sha)


def snapshot_for(db: Session, machine: str, day: date):
    """The calibration a replay of `day` uses, only when that day has one stored (the dial snaps to them)."""
    include_sim = hv.simulated()
    if day.isoformat() not in {d["date"] for d in cmp.stored_days(db, machine, include_sim)}:
        return None
    return store.nearest(db, machine, rp.requested_time(day), include_simulated=include_sim)


def replay_at(db: Session, run: Run, machine: str, day: date, row, signed_in: bool,
              charge: Callable[[], None]) -> dict[str, Any]:
    """The run's circuit replayed on `machine` as calibrated on `day`. `charge` is called (rate limit)
    only when the answer isn't cached. Raises rp.ReplayError."""
    shots = dial_shots(run, signed_in)
    key = replay_key(run, day, shots, row.sha256)
    hit = _get(_replays, key)
    if hit is not None:
        return {**hit, "cached": True}
    charge()
    text = circuit_text(run)
    if text is None:
        raise rp.ReplayError(422, REASONS["no_circuit"])
    include_sim = hv.simulated()
    out = rp.run_limited(lambda: cmp.replay_with_ideal(db, machine, day, text, None, shots, None,
                                                       signed_in=signed_in, include_simulated=include_sim))
    physical = out["transpiled"]["physical_qubits"]
    real = counts_of(run)
    doc = {
        "date": day.isoformat(), "machine": machine, "label": out["label"], "real_hardware": False,
        "snapshot": out["snapshot"], "counts": out["counts"], "shots": out["shots"],
        "physical_qubits": physical,
        "hellinger_fidelity": (out.get("ideal") or {}).get("hellinger_fidelity"),
        "tvd_vs_run": _tvd(out["counts"], real) if real else None,
        "accuracy": out["accuracy"], "accuracy_note": out["accuracy_note"],
        "not_modelled": out["noise_model"].get("not_modelled"), "notes": out["notes"],
        "changed": what_changed(db, run, machine, row, physical, include_sim),
    }
    _put(_replays, key, doc)
    return {**doc, "cached": False}


# ---------------------------------------------------------------------------
# The future: which machine, and when in the day
# ---------------------------------------------------------------------------

FORECAST_METHOD = (
    f"A persistence forecast, not a prediction of the future machine. The circuit is compiled on each machine's latest "
    f"stored calibration and scored, as Pick-the-machine does (estimated success probability: gate, readout and idle "
    f"errors multiplied), against each of that machine's last {WINDOW_DAYS} stored daily calibrations. The forecast for "
    "the coming days is the median of those scores, with their range; it assumes the coming days look like those days. "
    "The hour is when that machine's calibration has usually landed: a fresh calibration describes the machine best. "
    "Rewind doesn't measure an hour-of-day effect, and queue time isn't included."
)


def _usual_hour(rows: list) -> Optional[int]:
    hours = [_aware(r.calibrated_at).hour for r in rows]
    if not hours:
        return None
    return Counter(hours).most_common(1)[0][0]


def _window_rows(db: Session, machine: str, include_sim: bool) -> list:
    """One calibration per stored day (the one a replay of that day uses), the last WINDOW_DAYS days."""
    days = cmp.stored_days(db, machine, include_sim)[-WINDOW_DAYS:]
    rows = []
    for d in days:
        r = store.nearest(db, machine, rp.requested_time(date.fromisoformat(d["date"])), include_simulated=include_sim)
        if r is not None and (not rows or rows[-1].sha256 != r.sha256):
            rows.append(r)
    return rows


def forecast_machine(db: Session, circuit, machine: str, include_sim: bool) -> dict[str, Any]:
    rows = _window_rows(db, machine, include_sim)
    base: dict[str, Any] = {"machine": machine, "days": len(rows)}
    if not rows:
        return {**base, "esp": None, "reason": "no calibration stored"}
    try:
        latest = _noise(rows[-1])
    except (store.SnapshotCorrupt, OSError):
        return {**base, "esp": None, "reason": "the stored calibration couldn't be read"}
    if circuit.num_qubits > int(latest.get("num_qubits") or 0):
        return {**base, "esp": None, "reason": f"needs {circuit.num_qubits} qubits; {machine} has {latest.get('num_qubits')}"}
    try:
        isa = rp.transpile(circuit, {**latest, "machine": machine})
    except rp.ReplayError as exc:
        return {**base, "esp": None, "reason": exc.message}
    series = []
    weak = None
    for r in rows:
        try:
            noise = rp.usable_view(_noise(r)["noise"])
        except (store.SnapshotCorrupt, OSError):
            continue
        s = mp.score_isa(isa, noise)
        series.append({"date": _aware(r.calibrated_at).date().isoformat(), "calibrated_at": iso(_aware(r.calibrated_at)),
                       "esp": s["esp"]})
        weak = s.get("weak_point")
    if not series:
        return {**base, "esp": None, "reason": "the stored calibrations couldn't be read"}
    esps = [p["esp"] for p in series]
    hour = _usual_hour(rows)
    return {**base, "esp": round(statistics.median(esps), 6), "low": min(esps), "high": max(esps),
            "latest": esps[-1], "series": series, "usual_calibration_hour_utc": hour,
            "weak_point": {k: weak.get(k) for k in ("text", "detail")} if weak else None,
            "physical_qubits": sorted({isa.find_bit(q).index for i in isa.data for q in i.qubits
                                       if i.operation.name != "barrier"})[:40]}


def _pct(x: float) -> str:
    return f"{x * 100:.0f}%"


def forecast_sentence(best: dict[str, Any], run_machine: str, own: Optional[dict[str, Any]]) -> str:
    rng = f"{_pct(best['low'])}–{_pct(best['high'])}" if best["low"] != best["high"] else _pct(best["esp"])
    s = (f"Best bet for the coming days: {best['machine']}, estimated success ≈{_pct(best['esp'])} "
         f"(range {rng} over its last {best['days']} stored day{'s' if best['days'] != 1 else ''})")
    h = best.get("usual_calibration_hour_utc")
    s += f"; its calibration usually lands around {h:02d}:00 UTC, so run soon after that." if h is not None else "."
    if own and best["machine"] != run_machine and own.get("esp") is not None:
        s += f" On {run_machine}, where this run ran, ≈{_pct(own['esp'])}."
    return s


def forecast_key(db: Session, run: Run, machines: list[dict[str, Any]]) -> tuple:
    return (run.run_id, drift._rev(run), tuple((m["machine"], m["last_calibrated_at"], m["snapshots"]) for m in machines))


def candidate_machines(db: Session, machine: str, include_sim: bool) -> list[dict[str, Any]]:
    """The run's machine first, then the machines with the most recent calibration stored."""
    rows = [m for m in store.machines(db, include_simulated=include_sim) if m["provider"] == "ibm"]
    own = [m for m in rows if m["machine"] == machine]
    rest = sorted((m for m in rows if m["machine"] != machine), key=lambda m: m["last_calibrated_at"] or "", reverse=True)
    return (own + rest)[:MAX_MACHINES]


def forecast(db: Session, run: Run, machine: str, charge: Callable[[], None]) -> dict[str, Any]:
    """Which machine and hour should give this circuit the best result in the coming days."""
    include_sim = hv.simulated()
    machines = candidate_machines(db, machine, include_sim)
    base: dict[str, Any] = {"machine": machine, "method": FORECAST_METHOD, "simulated": include_sim,
                            "label": NOT_AFFILIATED, "kind": "forecast"}
    if not machines:
        return {**base, "available": False, "message": empty_reason(machine), "machines": [], "best": None,
                "sentence": None}
    key = forecast_key(db, run, machines)
    hit = _get(_forecasts, key)
    if hit is not None:
        return {**hit, "cached": True}
    text = circuit_text(run)
    if text is None:
        return {**base, "available": False, "message": REASONS["no_circuit"], "machines": [], "best": None,
                "sentence": None}
    charge()
    try:
        circuit = cmp.parse_for_ideal(text, None)
        rp.check_circuit(circuit, mp.MAX_QUBITS)
    except rp.ReplayError as exc:
        return {**base, "available": False, "message": exc.message, "machines": [], "best": None, "sentence": None}

    def work() -> dict[str, Any]:
        return {"rows": [forecast_machine(db, circuit, m["machine"], include_sim) for m in machines]}

    done = mp.run_with_budget(work)
    if done is None:
        raise rp.ReplayError(503, "Two estimates are already running on this server; try again in a few seconds.")
    rows = done["rows"]
    scored = sorted((r for r in rows if r.get("esp") is not None), key=lambda r: -r["esp"])
    own = next((r for r in rows if r["machine"] == machine), None)
    best = scored[0] if scored else None
    try:
        d = drift.drift_for(db, run, "standard")
        drift_note = {"state": d.get("state"), "sentence": d.get("sentence")}
    except Exception:  # the forecast stands without the drift line
        drift_note = None
    doc = {**base, "available": best is not None,
           "message": None if best else "None of the stored machines could be scored for this circuit.",
           "machines": rows, "best": best and {k: best[k] for k in ("machine", "esp", "low", "high", "days",
                                                                    "usual_calibration_hour_utc")},
           "sentence": forecast_sentence(best, machine, own) if best else None,
           "drift": drift_note,
           "computed_at": iso(datetime.now(timezone.utc)),
           "horizon_days": 3,
           "through": (datetime.now(timezone.utc) + timedelta(days=3)).date().isoformat()}
    _put(_forecasts, key, doc, cap=64)
    return {**doc, "cached": False}
