"""Run a paper's circuit: on a replica of an IBM machine as calibrated on a day (Rewind), or, when
no calibration is chosen or stored, on the ideal (noiseless) simulator, labelled as such.

Both go through Rewind's one-at-a-time gate and time limit (rewind.replay.run_limited) and its
shot and work limits. The noiseless run samples the exact distribution with a fixed seed, so the
same inputs give the same counts; a circuit that measures part-way through runs on Aer instead.
"""
from __future__ import annotations

import time
from datetime import date, datetime, timezone
from typing import Any, Optional

from sqlalchemy.orm import Session

from .. import machine_pick as mp
from ..rewind import compare as cmp
from ..rewind import harvest as hv
from ..rewind import replay as rp
from . import circuits

IDEAL_LABEL = ("Ideal (noiseless) simulator: no hardware noise is modelled, so this is the circuit's best case, "
               "not what a real machine gives.")
NO_CALIBRATION = ("This server has no stored IBM calibration, so the paper's machine can't be modelled; "
                  "this run is on the ideal (noiseless) simulator instead.")


def today() -> date:
    return datetime.now(timezone.utc).date()


def _shots(shots: int, signed_in: bool) -> None:
    cap = rp.max_shots(signed_in)
    if not isinstance(shots, int) or shots < 1 or shots > cap:
        raise rp.ReplayError(422, f"shots must be between 1 and {cap}" + ("" if signed_in else " without an account") + ".")


def noiseless(text: str, shots: int, seed: Optional[int], signed_in: bool) -> dict[str, Any]:
    import numpy as np

    _shots(shots, signed_in)
    try:
        _, facts = circuits.check(text)
    except circuits.CircuitProblem as exc:
        raise rp.ReplayError(422, str(exc))
    circuit = cmp.parse_for_ideal(text, "qasm")
    notes = []
    if facts["measured"] == 0:
        notes.append("The circuit measured nothing, so every qubit was measured at the end.")
    seed = rp.SEED_SIMULATOR if seed is None else int(seed)
    started = time.monotonic()
    dist, why = cmp.ideal_distribution(circuit, signed_in)
    if dist is not None:
        keys = sorted(dist)
        p = np.array([dist[k] for k in keys], dtype=float)
        draws = np.random.default_rng(seed).multinomial(shots, p / p.sum())
        counts = {k: int(n) for k, n in zip(keys, draws) if n}
        method = "exact noiseless probabilities (Aer statevector), sampled with a fixed seed"
    else:
        from qiskit import transpile
        from qiskit_aer import AerSimulator

        n = circuit.num_qubits
        ops = sum(1 for i in circuit.data if i.operation.name != "barrier")
        if shots * ops * 2 ** n > rp.max_work(signed_in):
            raise rp.ReplayError(422, f"This would take too long on this server ({n} qubits, {ops} operations, "
                                      f"{shots} shots). Use fewer shots or a smaller circuit.")
        sim = AerSimulator(method="statevector", seed_simulator=seed, max_parallel_threads=1,
                           max_memory_mb=rp.max_memory_mb())
        try:
            result = sim.run(transpile(circuit, sim, optimization_level=0, seed_transpiler=mp.SEED_TRANSPILER),
                             shots=shots).result()
            counts = {str(k): int(v) for k, v in sorted(result.get_counts(0).items())}
        except Exception as exc:
            raise rp.ReplayError(500, f"The simulator failed ({type(exc).__name__}).")
        method = "noiseless Aer statevector, shot by shot (the circuit measures part-way through)"
    return {
        "mode": "ideal",
        "label": IDEAL_LABEL,
        "machine": None,
        "requested_date": None,
        "snapshot": None,
        "counts": counts,
        "shots": shots,
        "seeds": {"simulator": seed, "transpiler": mp.SEED_TRANSPILER},
        "circuit": facts,
        "method": method,
        "ideal": cmp.ideal_summary(circuit, counts, signed_in) if dist is not None else
        {"available": False, "reason": why, "hellinger_fidelity": None, "share_on_ideal_outcomes": None, "top": [], "outcomes": None},
        "software": rp.versions(),
        "seconds": round(time.monotonic() - started, 3),
        "accuracy": None,
        "accuracy_note": None,
        "real_hardware": False,
        "notes": notes,
    }


def run(db: Session, text: str, machine: Optional[str], day: Optional[date], shots: int, seed: Optional[int],
        signed_in: bool) -> dict[str, Any]:
    """The run, gated like a Rewind replay. machine None: the ideal simulator."""
    if not machine:
        return rp.run_limited(lambda: noiseless(text, shots, seed, signed_in))
    try:
        circuits.check(text)
    except circuits.CircuitProblem as exc:
        raise rp.ReplayError(422, str(exc))
    when = day or today()
    out = rp.run_limited(lambda: cmp.replay_with_ideal(db, machine, when, text, "qasm", shots, seed,
                                                       signed_in=signed_in, include_simulated=hv.simulated()))
    out["mode"] = "calibrated"
    if day is None:
        out["notes"] = [*out.get("notes", []), "No date was chosen, so the latest stored calibration was used."]
    return out
