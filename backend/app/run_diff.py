"""Why do two runs of the same experiment give different results?

Splits the difference between two runs' measured distributions into three candidate causes,
using only what Q-Lab captured for each run:

- statistical (shot) noise: how far apart two samples of the same distribution land with these
  shot counts, from multinomial resampling with a fixed seed;
- the compiler: whether the circuit that ran on the device changed (hashes, depth, two-qubit gate
  count, layout, transpiler options, Qiskit version);
- calibration drift: per-qubit and per-gate calibration changes, restricted to the qubits and
  gates the circuits used, and a simple fidelity estimate (product of (1 - error) over the gates
  and measurements that ran).

Nothing here is estimated from anything other than the two run records. When a figure needs data
that wasn't captured, it is None and the section says so ("cant_tell").
"""
from __future__ import annotations

import base64
import hashlib
import io
import math
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Optional

import numpy as np

from .calibration_utils import per_qubit

# Multinomial resampling: fixed seed so the same pair always gives the same answer.
SEED = 20240611
N_RESAMPLES = 2000
ALPHA = 0.05
# Keep each resampling batch under ~4M cells so wide distributions don't exhaust memory.
_MAX_BATCH_CELLS = 4_000_000

# Instructions that carry no calibrated error.
_NO_ERROR_OPS = {"barrier", "delay", "snapshot", "save_statevector", "save_probabilities"}


# ---------------------------------------------------------------------------
# Counts and statistics
# ---------------------------------------------------------------------------

def counts_of(run: Any) -> Optional[dict[str, int]]:
    """The measured counts of a run (results.counts), or None if it has none or they aren't counts."""
    results = run.results if isinstance(run.results, dict) else {}
    counts = results.get("counts")
    if not isinstance(counts, dict) or not counts:
        return None
    out: dict[str, int] = {}
    for key, value in counts.items():
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return None
        if isinstance(value, float) and not value.is_integer():
            return None  # quasi-probabilities, not shot counts
        if value < 0:
            return None
        if value:
            out[str(key)] = int(value)
    return out or None


def tvd(p: np.ndarray, q: np.ndarray) -> float:
    return float(0.5 * np.abs(p - q).sum())


def hellinger(p: np.ndarray, q: np.ndarray) -> float:
    bc = float(np.sqrt(p * q).sum())
    return float(math.sqrt(max(0.0, 1.0 - min(1.0, bc))))


def _aligned(a: dict[str, int], b: dict[str, int]) -> tuple[list[str], np.ndarray, np.ndarray]:
    keys = sorted(set(a) | set(b))
    return keys, np.array([a.get(k, 0) for k in keys], float), np.array([b.get(k, 0) for k in keys], float)


def _resampled_tvds(rng: np.random.Generator, na: int, pa: np.ndarray, nb: int, pb: np.ndarray,
                    n: int) -> np.ndarray:
    batch = max(1, min(n, _MAX_BATCH_CELLS // max(1, len(pa))))
    out: list[np.ndarray] = []
    done = 0
    while done < n:
        k = min(batch, n - done)
        sa = rng.multinomial(na, pa, size=k) / na
        sb = rng.multinomial(nb, pb, size=k) / nb
        out.append(0.5 * np.abs(sa - sb).sum(axis=1))
        done += k
    return np.concatenate(out)


def shot_noise_analysis(a: dict[str, int], b: dict[str, int], *, seed: int = SEED,
                        n_resamples: int = N_RESAMPLES) -> dict[str, Any]:
    """Observed distance between two count distributions, and how much of it shot noise explains.

    Null hypothesis: both runs sampled the same distribution (estimated by pooling the counts).
    Draw both runs' shot counts from the pooled distribution many times; the p-value is the
    share of draws at least as far apart as observed. The interval on the observed TVD resamples
    each run from its own measured distribution.
    """
    keys, ca, cb = _aligned(a, b)
    na, nb = int(ca.sum()), int(cb.sum())
    pa, pb = ca / na, cb / nb
    pooled = (ca + cb) / (na + nb)
    observed = tvd(pa, pb)

    rng = np.random.default_rng(seed)
    null = _resampled_tvds(rng, na, pooled, nb, pooled, n_resamples)
    boot = _resampled_tvds(rng, na, pa, nb, pb, n_resamples)
    exceed = int((null >= observed - 1e-12).sum())
    p_value = (1 + exceed) / (n_resamples + 1)
    # Normal approximation: E|N(0, s^2)| = s*sqrt(2/pi) per outcome, halved for TVD.
    analytic = float(0.5 * np.sqrt(2 / np.pi) * np.sqrt(pooled * (1 - pooled) * (1 / na + 1 / nb)).sum())

    return {
        "shots": {"a": na, "b": nb},
        "outcomes": len(keys),
        "observed_tvd": round(observed, 6),
        "observed_hellinger": round(hellinger(pa, pb), 6),
        "observed_tvd_interval_95": [round(float(np.quantile(boot, 0.025)), 6),
                                     round(float(np.quantile(boot, 0.975)), 6)],
        "expected_tvd_from_shot_noise": round(float(null.mean()), 6),
        "expected_tvd_analytic": round(analytic, 6),
        "shot_noise_tvd_95th_percentile": round(float(np.quantile(null, 0.95)), 6),
        "excess_tvd": round(max(0.0, observed - float(np.quantile(null, 0.95))), 6),
        "p_value": round(p_value, 6),
        "significant": p_value < ALPHA,
        "alpha": ALPHA,
        "method": {
            "test": "parametric bootstrap of TVD under a pooled multinomial null",
            "resamples": n_resamples,
            "seed": seed,
            "interval": "bootstrap of each run from its own counts (2.5%, 97.5%)",
            "analytic": "normal approximation, 0.5 * sum sqrt(2/pi) * sqrt(p(1-p)(1/n_a + 1/n_b))",
        },
    }


# ---------------------------------------------------------------------------
# The circuit that ran
# ---------------------------------------------------------------------------

@dataclass
class Usage:
    """What an executed circuit used on the device, with physical qubit indices."""
    source: str
    gates: Counter = field(default_factory=Counter)       # (name, qubits) -> count
    measured: set[int] = field(default_factory=set)
    initial_layout: Optional[list[int]] = None
    depth: Optional[int] = None
    num_qubits: Optional[int] = None

    @property
    def qubits(self) -> list[int]:
        used = set(self.measured)
        for _, qs in self.gates:
            used.update(qs)
        return sorted(used)

    @property
    def edges(self) -> list[tuple[int, int]]:
        return sorted({tuple(sorted(qs)) for _, qs in self.gates if len(qs) == 2})  # type: ignore[misc]

    @property
    def two_qubit_gates(self) -> int:
        return sum(n for (_, qs), n in self.gates.items() if len(qs) == 2)

    @property
    def gate_keys(self) -> list[str]:
        return sorted(gate_key(name, qs) for name, qs in self.gates)


def gate_key(name: str, qubits: tuple[int, ...]) -> str:
    """The key the SDK uses in calibration.gate_errors, e.g. "cx_0_1"."""
    return f"{name}_{'_'.join(str(q) for q in qubits)}"


def _qpy_after(run: Any) -> dict[str, Any]:
    transpiler = run.transpiler if isinstance(run.transpiler, dict) else {}
    qpy = transpiler.get("qpy") if isinstance(transpiler.get("qpy"), dict) else {}
    after = qpy.get("after")
    return after if isinstance(after, dict) else {}


def _load_qpy(info: dict[str, Any]):
    data = info.get("data")
    if not isinstance(data, str) or not data:
        return None
    try:
        from qiskit import qpy
        circuits = qpy.load(io.BytesIO(base64.b64decode(data)))
        return circuits[0] if circuits else None
    except Exception:
        return None


def _load_qasm(text: Optional[str]):
    if not text:
        return None
    try:
        from qiskit import qasm3
        return qasm3.loads(text)
    except Exception:
        pass
    try:
        from qiskit import qasm2
        return qasm2.loads(text, custom_instructions=qasm2.LEGACY_CUSTOM_INSTRUCTIONS)
    except Exception:
        return None


def _matches_fingerprint(circuit: Any, fingerprint: dict[str, Any]) -> bool:
    """The transpiler's QPY is of the last transpile() before run(); check it is the circuit that ran."""
    counts = fingerprint.get("gate_counts")
    if not isinstance(counts, dict):
        return True  # nothing to check against
    try:
        ops = {str(k): int(v) for k, v in circuit.count_ops().items()}
    except Exception:
        return False
    return ops == {str(k): int(v) for k, v in counts.items()}


def executed_usage(run: Any) -> Optional[Usage]:
    """Gates (with physical qubits) and measurements of the circuit the run executed, or None.

    Prefers the QPY of the transpiled circuit (it keeps the layout), checked against the run's
    fingerprint; falls back to the run's stored QASM.
    """
    fingerprint = run.fingerprint if isinstance(run.fingerprint, dict) else {}
    circuit, source = None, None
    candidate = _load_qpy(_qpy_after(run))
    if candidate is not None and _matches_fingerprint(candidate, fingerprint):
        circuit, source = candidate, "transpiler.qpy.after"
    if circuit is None:
        circuit = _load_qasm(run.qasm)
        source = "qasm"
    if circuit is None:
        return None
    usage = Usage(source=source or "qasm")
    try:
        for inst in circuit.data:
            name = inst.operation.name
            if name in _NO_ERROR_OPS:
                continue
            qubits = tuple(circuit.find_bit(q).index for q in inst.qubits)
            if name == "measure":
                usage.measured.update(qubits)
            else:
                usage.gates[(name, qubits)] += 1
        usage.depth = circuit.depth()
        usage.num_qubits = circuit.num_qubits
    except Exception:
        return None
    layout = getattr(circuit, "layout", None)
    if layout is not None:
        try:
            usage.initial_layout = [int(i) for i in layout.initial_index_layout(filter_ancillas=True)]
        except Exception:
            usage.initial_layout = None
    return usage


# ---------------------------------------------------------------------------
# Compiler
# ---------------------------------------------------------------------------

def _transpiler_settings(run: Any) -> dict[str, Any]:
    transpiler = run.transpiler if isinstance(run.transpiler, dict) else {}
    settings = transpiler.get("settings") if isinstance(transpiler.get("settings"), dict) else {}
    context = run.context if isinstance(run.context, dict) else {}
    setup = context.get("setup") if isinstance(context.get("setup"), dict) else {}
    from_setup = setup.get("transpiler") if isinstance(setup.get("transpiler"), dict) else {}
    return {**from_setup, **settings}


def _normalise(value: Any) -> Any:
    if isinstance(value, (list, tuple, set)):
        return sorted(str(v) for v in value)
    return value


def compiler_facts(run: Any, usage: Optional[Usage]) -> dict[str, Any]:
    """What is known about how a run's circuit was compiled; None where it wasn't captured."""
    fp = run.fingerprint if isinstance(run.fingerprint, dict) else {}
    context = run.context if isinstance(run.context, dict) else {}
    versions = context.get("library_versions") if isinstance(context.get("library_versions"), dict) else {}
    settings = _transpiler_settings(run)
    qpy_after = _qpy_after(run)
    transpiler = run.transpiler if isinstance(run.transpiler, dict) else {}
    qpy_before = (transpiler.get("qpy") or {}).get("before") if isinstance(transpiler.get("qpy"), dict) else None
    gate_counts = fp.get("gate_counts") if isinstance(fp.get("gate_counts"), dict) else None
    qasm_sha = fp.get("qasm_sha256") or (hashlib.sha256(run.qasm.encode("utf-8")).hexdigest() if run.qasm else None)
    return {
        "executed_circuit_sha256": qasm_sha,
        "executed_qpy_sha256": qpy_after.get("sha256"),
        "logical_circuit_qpy_sha256": qpy_before.get("sha256") if isinstance(qpy_before, dict) else None,
        "depth": fp.get("depth") if fp.get("depth") is not None else (usage.depth if usage else None),
        "size": fp.get("size"),
        "gate_counts": gate_counts,
        "two_qubit_gate_count": usage.two_qubit_gates if usage else None,
        "physical_qubits": usage.qubits if usage else None,
        "initial_layout": usage.initial_layout if usage else None,
        "optimization_level": settings.get("optimization_level"),
        "layout_method": settings.get("layout_method"),
        "routing_method": settings.get("routing_method"),
        "seed_transpiler": settings.get("seed_transpiler"),
        "basis_gates": _normalise(settings.get("basis_gates")),
        "gates_used": sorted(gate_counts) if gate_counts else None,
        "qiskit_version": versions.get("qiskit") or qpy_after.get("qiskit_version"),
        "setup_fingerprint": context.get("setup_fingerprint"),
    }


_COMPILER_FIELDS = (
    ("executed_circuit_sha256", "Executed circuit (QASM hash)", "fingerprint.qasm_sha256 / qasm"),
    ("executed_qpy_sha256", "Executed circuit (QPY hash)", "transpiler.qpy.after.sha256"),
    ("depth", "Depth", "fingerprint.depth"),
    ("size", "Gate count", "fingerprint.size"),
    ("two_qubit_gate_count", "Two-qubit gates", "executed circuit (QPY or QASM)"),
    ("gate_counts", "Gates by type", "fingerprint.gate_counts"),
    ("physical_qubits", "Physical qubits used", "executed circuit (QPY or QASM)"),
    ("initial_layout", "Initial layout (virtual -> physical)", "transpiler.qpy.after layout"),
    ("optimization_level", "Optimization level", "transpiler.settings"),
    ("layout_method", "Layout method", "transpiler.settings"),
    ("routing_method", "Routing method", "transpiler.settings"),
    ("seed_transpiler", "Transpiler seed", "transpiler.settings"),
    ("basis_gates", "Basis gates", "transpiler.settings.basis_gates"),
    ("qiskit_version", "Qiskit version", "context.library_versions.qiskit"),
    ("setup_fingerprint", "Setup fingerprint", "context.setup_fingerprint"),
)


def compiler_diff(run_a: Any, run_b: Any, usage_a: Optional[Usage], usage_b: Optional[Usage]) -> dict[str, Any]:
    fa, fb = compiler_facts(run_a, usage_a), compiler_facts(run_b, usage_b)
    changes, unknown = [], []
    for key, label, source in _COMPILER_FIELDS:
        va, vb = fa.get(key), fb.get(key)
        if va is None and vb is None:
            unknown.append(key)
            continue
        if va != vb:
            changes.append({"field": key, "label": label, "a": va, "b": vb, "source": source})

    sha_a, sha_b = fa["executed_circuit_sha256"], fb["executed_circuit_sha256"]
    qpy_a, qpy_b = fa["executed_qpy_sha256"], fb["executed_qpy_sha256"]
    if sha_a and sha_b:
        circuit_changed: Optional[bool] = sha_a != sha_b
    elif qpy_a and qpy_b:
        circuit_changed = qpy_a != qpy_b
    else:
        circuit_changed = None  # no hash of the executed circuit on one side
    # A setup or version change matters even when the circuit text didn't move.
    material = {"optimization_level", "layout_method", "routing_method", "seed_transpiler",
                "basis_gates", "qiskit_version", "initial_layout"}
    setup_changed = any(c["field"] in material for c in changes)

    logical_a, logical_b = fa["logical_circuit_qpy_sha256"], fb["logical_circuit_qpy_sha256"]
    return {
        "a": fa,
        "b": fb,
        "circuit_changed": circuit_changed,
        "setup_changed": setup_changed,
        "changes": changes,
        "not_recorded": unknown,
        "same_logical_circuit": (logical_a == logical_b) if (logical_a and logical_b) else None,
        "circuit_source": {"a": usage_a.source if usage_a else None, "b": usage_b.source if usage_b else None},
    }


# ---------------------------------------------------------------------------
# Calibration
# ---------------------------------------------------------------------------

def _num(value: Any) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    f = float(value)
    return f if math.isfinite(f) else None


def _change(a: Optional[float], b: Optional[float]) -> dict[str, Any]:
    out: dict[str, Any] = {"a": a, "b": b, "delta": None, "relative": None}
    if a is not None and b is not None:
        out["delta"] = b - a
        out["relative"] = (b - a) / a if a else None
    return out


def estimate_fidelity(usage: Usage, calibration: dict[str, Any]) -> dict[str, Any]:
    """Product of (1 - error) over every gate instance and measurement the circuit ran.

    `value` is set only when every operation has a recorded error. Otherwise `upper_bound` is the
    product over the covered ones (missing errors can only lower it) and `missing` lists them.
    """
    gate_errors = per_qubit((calibration or {}).get("gate_errors"))
    readout = per_qubit((calibration or {}).get("readout_errors"))
    log_f, covered, total, missing = 0.0, 0, 0, []
    zero = False

    def take(err: Optional[float], n: int, label: str) -> None:
        nonlocal log_f, covered, total, zero
        total += n
        if err is None or err < 0:
            missing.append(label)
            return
        covered += n
        if err >= 1:
            zero = True
        else:
            log_f += n * math.log1p(-err)

    for (name, qubits), n in sorted(usage.gates.items()):
        key = gate_key(name, qubits)
        take(_num(gate_errors.get(key)), n, key)
    for q in sorted(usage.measured):
        take(_num(readout.get(str(q))), 1, f"readout_{q}")

    product = 0.0 if zero else math.exp(log_f)
    complete = total > 0 and not missing
    return {
        "value": round(product, 6) if complete else None,
        "upper_bound": round(product, 6) if covered else None,
        "covered_operations": covered,
        "total_operations": total,
        "missing": missing[:25],
        "missing_count": len(missing),
    }


def _has_calibration(cal: Any) -> bool:
    if not isinstance(cal, dict):
        return False
    return any(per_qubit(cal.get(k)) for k in ("t1_us", "t2_us", "readout_errors", "gate_errors"))


def _snapshot(cal: dict[str, Any]) -> dict[str, Any]:
    out = {"recorded": _has_calibration(cal), "snapshot_time": cal.get("snapshot_time"), "source": cal.get("source")}
    if cal.get("source") == "target":
        out["note"] = ("Read from backend.target, which has no calibration date: the time is when Q-Lab "
                       "captured it, not when the device was calibrated.")
    return out


def calibration_diff(run_a: Any, run_b: Any, usage_a: Optional[Usage], usage_b: Optional[Usage]) -> dict[str, Any]:
    cal_a = run_a.calibration if isinstance(run_a.calibration, dict) else {}
    cal_b = run_b.calibration if isinstance(run_b.calibration, dict) else {}
    snapshots = {side: _snapshot(cal) for side, cal in (("a", cal_a), ("b", cal_b))}
    out: dict[str, Any] = {"snapshots": snapshots, "qubits": [], "gates": [], "changed": None,
                           "fidelity": None, "restricted_to_used": False}
    if not (snapshots["a"]["recorded"] and snapshots["b"]["recorded"]):
        return out

    if usage_a is None and usage_b is None:
        return out  # no way to know which qubits ran; a device-wide diff would mislead
    out["restricted_to_used"] = True
    out["used"] = {s: ({"qubits": u.qubits, "edges": [list(e) for e in u.edges]} if u else None)
                   for s, u in (("a", usage_a), ("b", usage_b))}
    qubits = sorted(set(usage_a.qubits if usage_a else []) | set(usage_b.qubits if usage_b else []))
    keys = sorted(set(usage_a.gate_keys if usage_a else []) | set(usage_b.gate_keys if usage_b else []))

    maps = {name: (per_qubit(cal_a.get(name)), per_qubit(cal_b.get(name)))
            for name in ("t1_us", "t2_us", "readout_errors", "gate_errors")}
    changed = False
    any_value = False
    for q in qubits:
        row: dict[str, Any] = {"qubit": q,
                               "used_by": [s for s, u in (("a", usage_a), ("b", usage_b)) if u and q in u.qubits]}
        for name in ("t1_us", "t2_us", "readout_errors"):
            ma, mb = maps[name]
            c = _change(_num(ma.get(str(q))), _num(mb.get(str(q))))
            row[name] = c
            any_value = any_value or c["a"] is not None or c["b"] is not None
            changed = changed or (c["a"] != c["b"])
        out["qubits"].append(row)
    ga, gb = maps["gate_errors"]
    for key in keys:
        c = _change(_num(ga.get(key)), _num(gb.get(key)))
        n_qubits = len(key.split("_")) - 1
        used_by = [s for s, u in (("a", usage_a), ("b", usage_b)) if u and key in u.gate_keys]
        out["gates"].append({"gate": key, "qubits": n_qubits, "used_by": used_by, **c})
        any_value = any_value or c["a"] is not None or c["b"] is not None
        changed = changed or (c["a"] != c["b"])
    out["changed"] = changed if any_value else None

    if usage_a is not None and usage_b is not None:
        f_aa = estimate_fidelity(usage_a, cal_a)
        f_bb = estimate_fidelity(usage_b, cal_b)
        f_ab = estimate_fidelity(usage_a, cal_b)  # run A's circuit under run B's calibration
        fid: dict[str, Any] = {"a": f_aa, "b": f_bb, "a_circuit_b_calibration": f_ab,
                               "change": None, "calibration_effect": None, "compiler_effect": None}
        if None not in (f_aa["value"], f_bb["value"], f_ab["value"]):
            fid["change"] = round(f_bb["value"] - f_aa["value"], 6)
            fid["calibration_effect"] = round(f_ab["value"] - f_aa["value"], 6)
            fid["compiler_effect"] = round(f_bb["value"] - f_ab["value"], 6)
        out["fidelity"] = fid
    return out


# ---------------------------------------------------------------------------
# Attribution
# ---------------------------------------------------------------------------

def _fmt(x: float) -> str:
    return f"{x:.4f}".rstrip("0").rstrip(".") if abs(x) >= 1e-4 else f"{x:.2e}"


def _attribute(noise: Optional[dict], compiler: dict, calibration: dict, run_a: Any, run_b: Any) -> dict[str, Any]:
    factors: list[dict[str, Any]] = []
    significant = bool(noise and noise["significant"])
    excess = noise["excess_tvd"] if noise else None

    # Statistical noise
    if noise is None:
        factors.append({"factor": "noise", "verdict": "cant_tell",
                        "text": "Can't tell: one or both runs have no measured counts (results.counts), "
                                "so the observed difference can't be computed or tested against shot noise."})
    elif not significant:
        factors.append({"factor": "noise", "verdict": "explains",
                        "text": f"The difference (TVD {_fmt(noise['observed_tvd'])}) is within what shot noise "
                                f"alone produces with {noise['shots']['a']} and {noise['shots']['b']} shots "
                                f"(expected {_fmt(noise['expected_tvd_from_shot_noise'])}, 95% of samples below "
                                f"{_fmt(noise['shot_noise_tvd_95th_percentile'])}; p = {_fmt(noise['p_value'])}). "
                                "The runs are statistically indistinguishable."})
    else:
        factors.append({"factor": "noise", "verdict": "ruled_out",
                        "text": f"Shot noise alone would put the runs about TVD "
                                f"{_fmt(noise['expected_tvd_from_shot_noise'])} apart (95% of samples below "
                                f"{_fmt(noise['shot_noise_tvd_95th_percentile'])}); they are "
                                f"{_fmt(noise['observed_tvd'])} apart (p = {_fmt(noise['p_value'])}). "
                                "Something besides sampling changed."})

    fid = calibration.get("fidelity") or {}
    scale_note = ("Under a simple model where errors mix the output toward noise, a fidelity change of dF "
                  "moves the distribution by at most |dF| in TVD.")

    def sized(effect: Optional[float]) -> tuple[str, str]:
        if effect is None:
            return "plausible", ("Its size can't be estimated: the captured calibration is missing or doesn't "
                                 "cover every gate and measurement the circuits ran.")
        if not significant or excess is None:
            return "plausible", f"Estimated fidelity effect {effect:+.4f}."
        if abs(effect) >= excess:
            return "plausible", (f"Estimated fidelity effect {effect:+.4f}, large enough to account for the "
                                 f"{_fmt(excess)} of TVD beyond shot noise. {scale_note}")
        return "too_small", (f"Estimated fidelity effect {effect:+.4f} is smaller than the {_fmt(excess)} of TVD "
                             f"beyond shot noise, so on its own it doesn't explain the difference. {scale_note}")

    # Compiler
    if compiler["circuit_changed"] is None and not compiler["changes"]:
        factors.append({"factor": "compiler", "verdict": "cant_tell",
                        "text": "Can't tell: the executed circuit wasn't recorded for both runs "
                                "(no QASM hash or transpiled QPY), so a compiler change can't be checked."})
    else:
        labels = [c["label"] for c in compiler["changes"]
                  if c["field"] not in ("executed_circuit_sha256", "executed_qpy_sha256", "setup_fingerprint")]
        what = ", ".join(labels)
        if compiler["circuit_changed"] is False:
            # The device ran byte-identical circuits: how they were produced can't matter.
            extra = f" The compile setup differs ({what}), but it produced the same circuit." if what else ""
            factors.append({"factor": "compiler", "verdict": "ruled_out",
                            "text": "The same circuit ran both times (identical executed-circuit hash)." + extra})
        else:
            verdict, size = sized(fid.get("compiler_effect"))
            head = ("The compiled circuit changed" if compiler["circuit_changed"]
                    else "The compile setup changed (the executed circuit itself wasn't hashed for both runs)")
            factors.append({"factor": "compiler", "verdict": verdict,
                            "text": f"{head}{': ' + what if what else ''}. {size}"})

    # Calibration
    snaps = calibration["snapshots"]
    if not (snaps["a"]["recorded"] and snaps["b"]["recorded"]):
        missing = [s for s in ("a", "b") if not snaps[s]["recorded"]]
        factors.append({"factor": "calibration", "verdict": "cant_tell",
                        "text": f"Can't tell: no calibration snapshot was captured for run {' and '.join(missing).upper()}."})
    elif not calibration["restricted_to_used"]:
        factors.append({"factor": "calibration", "verdict": "cant_tell",
                        "text": "Can't tell: neither executed circuit could be read, so the qubits and gates "
                                "that ran are unknown and a device-wide calibration diff would not say much."})
    elif calibration["changed"] is None:
        factors.append({"factor": "calibration", "verdict": "cant_tell",
                        "text": "Can't tell: the snapshots have no values for the qubits and gates these circuits used."})
    elif calibration["changed"] is False:
        factors.append({"factor": "calibration", "verdict": "ruled_out",
                        "text": "Calibration of the qubits and gates the circuits used is identical in both snapshots."})
    else:
        worst = _worst_changes(calibration)
        verdict, size = sized(fid.get("calibration_effect"))
        factors.append({"factor": "calibration", "verdict": verdict,
                        "text": f"Calibration of the used qubits/gates changed between the snapshots"
                                f"{': ' + '; '.join(worst) if worst else ''}. {size}"})

    # Things that make it a different experiment rather than a different outcome.
    other: list[str] = []
    if (run_a.backend or None) != (run_b.backend or None):
        other.append(f"The runs used different backends ({run_a.backend} vs {run_b.backend}).")
    if (run_a.parameters or {}) != (run_b.parameters or {}):
        other.append("The recorded parameters differ, so the circuits may not have been asked the same question.")
    if compiler.get("same_logical_circuit") is False:
        other.append("The circuits passed to transpile() differ (logical QPY hash), so these may not be the same experiment.")

    explained = [f for f in factors if f["verdict"] in ("explains", "plausible")]
    if noise is None:
        summary = "Can't tell whether the results differ: one or both runs have no measured counts."
    elif not significant:
        summary = "The difference is consistent with shot noise alone; no other explanation is needed."
    elif explained:
        names = {"compiler": "a compiler/transpilation change", "calibration": "calibration drift"}
        summary = ("The difference is larger than shot noise. Plausible causes from the captured data: "
                   + " and ".join(names[f["factor"]] for f in explained) + ".")
    elif any(f["verdict"] == "cant_tell" for f in factors):
        summary = ("The difference is larger than shot noise, and the captured data can't say why: "
                   "see the factors marked can't tell.")
    else:
        summary = ("The difference is larger than shot noise, and neither the compiled circuit nor the recorded "
                   "calibration explains it. Something not captured changed (drift between calibrations, "
                   "crosstalk, readout or leakage effects, or a different input).")
    return {"summary": summary, "factors": factors, "other_differences": other}


def _worst_changes(calibration: dict[str, Any], limit: int = 3) -> list[str]:
    items: list[tuple[float, str]] = []
    for row in calibration["qubits"]:
        for name, label in (("t1_us", "T1"), ("t2_us", "T2"), ("readout_errors", "readout error")):
            c = row[name]
            if c["relative"] is not None and c["delta"]:
                items.append((abs(c["relative"]), f"{label} on qubit {row['qubit']} {c['a']:.4g} -> {c['b']:.4g}"))
    for g in calibration["gates"]:
        if g["relative"] is not None and g["delta"]:
            items.append((abs(g["relative"]), f"{g['gate']} error {g['a']:.4g} -> {g['b']:.4g}"))
    items.sort(key=lambda t: -t[0])
    return [text for _, text in items[:limit]]


SOURCES = {
    "observed": ["runs.results.counts"],
    "noise": ["runs.results.counts (shot totals are the sum of counts)", "runs.execution.shots (cross-check)"],
    "compiler": ["runs.fingerprint", "runs.qasm", "runs.transpiler.settings", "runs.transpiler.qpy",
                 "runs.context.library_versions", "runs.context.setup_fingerprint"],
    "calibration": ["runs.calibration.t1_us", "runs.calibration.t2_us", "runs.calibration.readout_errors",
                    "runs.calibration.gate_errors", "runs.calibration.snapshot_time"],
}


def explain_difference(run_a: Any, run_b: Any) -> dict[str, Any]:
    counts_a, counts_b = counts_of(run_a), counts_of(run_b)
    noise = shot_noise_analysis(counts_a, counts_b) if counts_a and counts_b else None
    if noise is not None:
        noise["recorded_shots"] = {"a": run_a.shots, "b": run_b.shots}
    usage_a, usage_b = executed_usage(run_a), executed_usage(run_b)
    compiler = compiler_diff(run_a, run_b, usage_a, usage_b)
    calibration = calibration_diff(run_a, run_b, usage_a, usage_b)
    return {
        "a": {"run_id": run_a.run_id, "backend": run_a.backend, "circuit_name": run_a.circuit_name,
              "created_at": run_a.created_at.isoformat() if run_a.created_at else None},
        "b": {"run_id": run_b.run_id, "backend": run_b.backend, "circuit_name": run_b.circuit_name,
              "created_at": run_b.created_at.isoformat() if run_b.created_at else None},
        "observed": None if noise is None else {"tvd": noise["observed_tvd"], "hellinger": noise["observed_hellinger"],
                                                "tvd_interval_95": noise["observed_tvd_interval_95"]},
        "noise": noise,
        "compiler": compiler,
        "calibration": calibration,
        "attribution": _attribute(noise, compiler, calibration, run_a, run_b),
        "sources": SOURCES,
    }
