"""Genetic Circuit Evolution Engine.

Evolutionary algorithm that mutates quantum circuits across generations
to maximize fidelity (heavy output probability proxy).

Mutation operators:
  - Gate type swap (H → X, CX → SWAP, etc.)
  - Qubit target swap
  - Rotation angle perturbation (Gaussian ±0.3 rad)
  - Gate insertion (random gate at random position)
  - Gate deletion

Selection: top-50% survivors, random mutation to fill the rest.
"""
from __future__ import annotations

import re
import random
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import EvolutionRun

router = APIRouter(prefix="/api/v1/evolver", tags=["circuit_evolver"])

CLIFFORD_GATES_1Q = ["h", "x", "y", "z", "s", "sdg", "t", "tdg"]
CLIFFORD_GATES_2Q = ["cx", "swap"]
ALL_1Q = CLIFFORD_GATES_1Q + ["rx(1.5708)", "ry(1.5708)", "rz(1.5708)"]


def _parse_qasm(qasm: str) -> tuple[list[str], int, list[str]]:
    lines = qasm.strip().split("\n")
    header, gate_lines, n_qubits = [], [], 2
    for line in lines:
        s = line.strip()
        if not s:
            continue
        if s.startswith(("OPENQASM", "include", "//")):
            header.append(line)
        elif s.startswith("qreg"):
            m = re.search(r"\[(\d+)\]", s)
            if m:
                n_qubits = int(m.group(1))
            header.append(line)
        elif s.startswith("creg"):
            header.append(line)
        elif not s.startswith("measure"):
            gate_lines.append(s)
    return gate_lines, n_qubits, header


def _to_qasm(header: list[str], gates: list[str], n_qubits: int) -> str:
    measures = "\n".join(f"measure q[{i}] -> c[{i}];" for i in range(n_qubits))
    return "\n".join(header) + "\n" + "\n".join(gates) + "\n" + measures


def _evaluate(qasm: str, shots: int, target: Optional[str], rng: random.Random) -> float:
    try:
        from .job_executor import _simulate_qasm
        counts = _simulate_qasm(qasm, shots, seed=rng.randint(0, 2 ** 30))
        if not counts:
            return 0.0
        total = sum(counts.values()) or 1
        if target:
            return counts.get(target, 0) / total
        probs = sorted(v / total for v in counts.values())
        median = probs[len(probs) // 2] if probs else 0
        return sum(v / total for v in counts.values() if (v / total) > median)
    except Exception:
        return 0.0


def _mutate_line(line: str, n_qubits: int, rng: random.Random) -> str:
    op = rng.random()
    if op < 0.25:
        g = rng.choice(CLIFFORD_GATES_1Q)
        return f"{g} q[{rng.randint(0, n_qubits - 1)}];"
    elif op < 0.40 and n_qubits > 1:
        q1, q2 = rng.sample(range(n_qubits), 2)
        return f"cx q[{q1}],q[{q2}];"
    elif op < 0.60:
        m = re.search(r"q\[(\d+)\]", line)
        if m:
            return re.sub(r"q\[\d+\]", f"q[{rng.randint(0, n_qubits - 1)}]", line, count=1)
    elif op < 0.80:
        m = re.search(r"\((-?[\d.]+)\)", line)
        if m:
            angle = float(m.group(1)) + rng.gauss(0, 0.3)
            return re.sub(r"\((-?[\d.]+)\)", f"({angle:.4f})", line, count=1)
    return line


def _run_evolution(
    gate_lines: list[str], n_qubits: int, header: list[str],
    pop_size: int, n_gen: int, shots: int, mut_rate: float,
    target: Optional[str], seed: int,
) -> dict[str, Any]:
    rng = random.Random(seed)
    pop = [gate_lines[:]]
    for _ in range(pop_size - 1):
        ind = gate_lines[:]
        for _ in range(max(1, int(len(ind) * mut_rate))):
            if ind:
                ind[rng.randint(0, len(ind) - 1)] = _mutate_line(ind[rng.randint(0, len(ind) - 1)], n_qubits, rng)
        pop.append(ind)

    best_fit = 0.0
    best_ind = gate_lines[:]
    history: list[dict] = []

    for gen in range(n_gen):
        scored = sorted(
            ((f := _evaluate(_to_qasm(header, ind, n_qubits), shots, target, rng), ind) for ind in pop),
            key=lambda x: -x[0],
        )
        gen_best, gen_avg = scored[0][0], sum(s[0] for s in scored) / len(scored)
        if gen_best > best_fit:
            best_fit = gen_best
            best_ind = scored[0][1][:]
        history.append({"generation": gen, "best": round(gen_best, 4), "avg": round(gen_avg, 4)})

        survivors = [ind for _, ind in scored[: pop_size // 2]]
        new_pop = survivors[:]
        while len(new_pop) < pop_size:
            child = rng.choice(survivors)[:]
            for _ in range(max(1, int(len(child) * mut_rate))):
                if child:
                    child[rng.randint(0, len(child) - 1)] = _mutate_line(child[rng.randint(0, len(child) - 1)], n_qubits, rng)
            if rng.random() < 0.2 and len(child) < 30:
                q = rng.randint(0, n_qubits - 1)
                if n_qubits > 1 and rng.random() < 0.4:
                    q2 = rng.choice([i for i in range(n_qubits) if i != q])
                    child.insert(rng.randint(0, max(0, len(child))), f"cx q[{q}],q[{q2}];")
                else:
                    child.insert(rng.randint(0, max(0, len(child))), f"{rng.choice(CLIFFORD_GATES_1Q)} q[{q}];")
            elif rng.random() < 0.15 and len(child) > 2:
                child.pop(rng.randint(0, len(child) - 1))
            new_pop.append(child)
        pop = new_pop[:pop_size]

    return {
        "evolved_qasm": _to_qasm(header, best_ind, n_qubits),
        "best_fitness": round(best_fit, 4),
        "fitness_history": history,
        "n_gates_original": len(gate_lines),
        "n_gates_evolved": len(best_ind),
        "improvement": round(best_fit - (history[0]["best"] if history else 0), 4),
    }


class EvolveRequest(BaseModel):
    qasm: str
    population_size: int = Field(default=20, ge=4, le=100)
    n_generations: int = Field(default=30, ge=5, le=200)
    shots: int = Field(default=256, ge=64, le=2048)
    mutation_rate: float = Field(default=0.2, ge=0.05, le=0.8)
    target_bitstring: Optional[str] = None
    seed: int = 42
    circuit_name: str = ""


@router.post("")
def evolve_circuit(req: EvolveRequest, db: Session = Depends(get_db)):
    gate_lines, n_qubits, header = _parse_qasm(req.qasm)
    if not gate_lines:
        raise HTTPException(422, "No gate lines found in QASM")
    r = _run_evolution(gate_lines, n_qubits, header, req.population_size, req.n_generations,
                       req.shots, req.mutation_rate, req.target_bitstring, req.seed)
    run_id = f"evo-{uuid.uuid4().hex[:12]}"
    record = EvolutionRun(
        run_id=run_id, circuit_name=req.circuit_name or run_id,
        original_qasm=req.qasm, evolved_qasm=r["evolved_qasm"],
        best_fitness=r["best_fitness"], improvement=r["improvement"],
        n_generations=req.n_generations, population_size=req.population_size,
        fitness_history=r["fitness_history"],
        config={"mutation_rate": req.mutation_rate, "shots": req.shots, "seed": req.seed},
    )
    db.add(record); db.commit(); db.refresh(record)
    return {"run_id": run_id, "circuit_name": record.circuit_name, **r, "created_at": record.created_at.isoformat()}


@router.get("")
def list_evolutions(limit: int = 50, db: Session = Depends(get_db)):
    runs = db.scalars(select(EvolutionRun).order_by(EvolutionRun.created_at.desc()).limit(limit)).all()
    return [{"run_id": r.run_id, "circuit_name": r.circuit_name, "best_fitness": r.best_fitness,
             "improvement": r.improvement, "n_generations": r.n_generations, "n_gates_original": len(r.original_qasm.split("\n")),
             "n_gates_evolved": len(r.evolved_qasm.split("\n")), "created_at": r.created_at.isoformat()} for r in runs]


@router.get("/{run_id}")
def get_evolution(run_id: str, db: Session = Depends(get_db)):
    r = db.scalar(select(EvolutionRun).where(EvolutionRun.run_id == run_id))
    if r is None:
        raise HTTPException(404, "Not found")
    return {"run_id": r.run_id, "circuit_name": r.circuit_name, "original_qasm": r.original_qasm,
            "evolved_qasm": r.evolved_qasm, "best_fitness": r.best_fitness, "improvement": r.improvement,
            "n_generations": r.n_generations, "population_size": r.population_size,
            "fitness_history": r.fitness_history, "config": r.config, "created_at": r.created_at.isoformat()}
