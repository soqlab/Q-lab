"""Circuit Topology via Persistent Homology — Feature #9.

Builds a qubit interaction graph from stored QASM (or fingerprint) and
computes topological invariants: Betti numbers β₀ (connected components)
and β₁ (independent cycles), 0-dimensional persistence, connectivity
entropy, and the most-connected qubit.

All graph and topology routines are pure Python — no external deps.
"""

from __future__ import annotations

import math
import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run

router = APIRouter(prefix="/api/v1", tags=["circuit_topology"])

# ---------------------------------------------------------------------------
# QASM 2-qubit interaction extractor
# ---------------------------------------------------------------------------

_2Q_GATE_PAT = re.compile(
    r'^(\w+)\s*(?:\([^)]*\))?\s+'     # gate name + optional params
    r'(\w+)\s*\[(\d+)\]\s*,'          # first qubit arg
    r'\s*(\w+)\s*\[(\d+)\]\s*;',      # second qubit arg
    re.MULTILINE,
)

_KNOWN_2Q = {
    "cx", "cz", "cy", "ecr", "rzx", "rxx", "ryy", "rzz",
    "csx", "swap", "iswap", "dcx", "cs", "ccx", "cswap", "ch",
}


def _extract_2q_interactions(qasm: str) -> dict[tuple[int, int], int]:
    """Return {(q1, q2): count} of two-qubit gate interactions.

    Uses a global qubit index derived from qreg declarations so that
    multi-register circuits produce correct absolute qubit numbers.
    """
    # Build register offset map
    reg_offsets: dict[str, int] = {}
    offset = 0
    for m in re.finditer(r'qreg\s+(\w+)\s*\[(\d+)\]', qasm):
        reg_offsets[m.group(1)] = offset
        offset += int(m.group(2))
    # OpenQASM 3 style
    for m in re.finditer(r'qubit(?:\s*\[\d+\])?\s+(\w+)', qasm):
        if m.group(1) not in reg_offsets:
            reg_offsets[m.group(1)] = offset
            offset += 1

    interactions: dict[tuple[int, int], int] = {}

    for raw in qasm.splitlines():
        line = raw.strip()
        if not line or line.startswith("//"):
            continue
        lower = line.lower()
        if lower.startswith(("openqasm", "include", "qreg", "creg", "barrier", "gate ", "measure")):
            continue

        m = re.match(
            r'^(\w+)\s*(?:\([^)]*\))?\s+'
            r'(\w+)\s*\[(\d+)\]\s*,'
            r'\s*(\w+)\s*\[(\d+)\]\s*;',
            line,
        )
        if not m:
            continue
        gate = m.group(1).lower()
        if gate not in _KNOWN_2Q:
            continue
        reg1, idx1 = m.group(2), int(m.group(3))
        reg2, idx2 = m.group(4), int(m.group(5))
        off1 = reg_offsets.get(reg1, 0)
        off2 = reg_offsets.get(reg2, 0)
        q1 = off1 + idx1
        q2 = off2 + idx2
        if q1 == q2:
            continue
        key = (min(q1, q2), max(q1, q2))
        interactions[key] = interactions.get(key, 0) + 1

    return interactions


# ---------------------------------------------------------------------------
# Union-Find (for β₀ and spanning tree)
# ---------------------------------------------------------------------------

class _UF:
    def __init__(self, n: int) -> None:
        self.parent = list(range(n))
        self.rank   = [0] * n

    def find(self, x: int) -> int:
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a: int, b: int) -> bool:
        """Union and return True if they were in different components."""
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return False
        if self.rank[ra] < self.rank[rb]:
            ra, rb = rb, ra
        self.parent[rb] = ra
        if self.rank[ra] == self.rank[rb]:
            self.rank[ra] += 1
        return True

    def components(self) -> int:
        return sum(1 for i in range(len(self.parent)) if self.find(i) == i)


# ---------------------------------------------------------------------------
# Topological analysis
# ---------------------------------------------------------------------------

def _build_topology(
    n_qubits: int,
    interactions: dict[tuple[int, int], int],
) -> dict[str, Any]:
    """Compute Betti numbers, persistence diagram, and interaction stats."""

    edges = sorted(interactions.items(), key=lambda x: x[1], reverse=True)
    n_edges = len(edges)
    n_verts = n_qubits

    # β₀ via union-find on all edges
    uf_all = _UF(n_verts)
    for (q1, q2), _ in edges:
        uf_all.union(q1, q2)
    betti_0 = uf_all.components()

    # β₁ = |E| - |V| + β₀  (cycle rank of the graph)
    betti_1 = max(0, n_edges - n_verts + betti_0)

    # 0-dim persistence: process edges in descending weight order
    # Each merge event = a component dying (birth=its weight, death=merge weight)
    uf_pers = _UF(n_verts)
    # Birth times: initially each vertex born at weight=0
    birth: dict[int, float] = {i: 0.0 for i in range(n_verts)}
    persistence_diagram: list[dict] = []

    for (q1, q2), weight in edges:
        r1 = uf_pers.find(q1)
        r2 = uf_pers.find(q2)
        if r1 != r2:
            # The component with the lower birth time "dies"
            b1 = birth.get(r1, 0.0)
            b2 = birth.get(r2, 0.0)
            dying_root = r1 if b1 <= b2 else r2
            surviving_root = r2 if dying_root == r1 else r1
            uf_pers.union(q1, q2)
            new_root = uf_pers.find(q1)
            birth[new_root] = birth[surviving_root]
            lifetime = abs(birth[dying_root] - float(weight))
            persistence_diagram.append({
                "birth":    float(birth[dying_root]),
                "death":    float(weight),
                "lifetime": round(lifetime, 4),
            })

    # Topological complexity
    persistence_threshold = 1.0  # edge count threshold for "significant" feature
    sig_features = [p for p in persistence_diagram if p["lifetime"] > persistence_threshold]
    topological_complexity = betti_1 + len(sig_features)

    # Connectivity entropy (Shannon over normalized edge weights)
    total_weight = sum(interactions.values())
    connectivity_entropy = 0.0
    if total_weight > 0:
        for w in interactions.values():
            p = w / total_weight
            if p > 0:
                connectivity_entropy -= p * math.log2(p)
    connectivity_entropy = round(connectivity_entropy, 4)

    # Most connected qubit (highest total interaction weight)
    qubit_strength: dict[int, int] = {}
    for (q1, q2), w in interactions.items():
        qubit_strength[q1] = qubit_strength.get(q1, 0) + w
        qubit_strength[q2] = qubit_strength.get(q2, 0) + w
    most_connected_qubit = (
        max(qubit_strength, key=lambda q: qubit_strength[q])
        if qubit_strength
        else None
    )

    interaction_graph = [
        {"q1": q1, "q2": q2, "weight": w}
        for (q1, q2), w in sorted(edges, key=lambda x: x[0])
    ]

    return {
        "n_interactions":        n_edges,
        "betti_0":               betti_0,
        "betti_1":               betti_1,
        "connected_components":  betti_0,
        "independent_cycles":    betti_1,
        "persistence_diagram":   persistence_diagram,
        "topological_complexity": topological_complexity,
        "connectivity_entropy":  connectivity_entropy,
        "most_connected_qubit":  most_connected_qubit,
        "interaction_graph":     interaction_graph,
    }


def _chain_topology_from_fingerprint(n_qubits: int) -> dict[str, Any]:
    """Approximate topology for runs with no QASM.

    Models the circuit as a linear chain (nearest-neighbour CX layer),
    giving β₀=1, β₁=0 for a path graph.
    """
    if n_qubits <= 1:
        return {
            "n_interactions": 0,
            "betti_0": max(n_qubits, 1),
            "betti_1": 0,
            "connected_components": max(n_qubits, 1),
            "independent_cycles": 0,
            "persistence_diagram": [],
            "topological_complexity": 0,
            "connectivity_entropy": 0.0,
            "most_connected_qubit": 0 if n_qubits == 1 else None,
            "interaction_graph": [],
        }

    interactions: dict[tuple[int, int], int] = {
        (i, i + 1): 1 for i in range(n_qubits - 1)
    }
    return _build_topology(n_qubits, interactions)


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.get("/runs/{run_id}/topology")
def circuit_topology(run_id: str, db: Session = Depends(get_db)):
    """Compute topological invariants of a run's qubit interaction graph.

    Uses stored QASM when available; falls back to a linear-chain
    approximation derived from the fingerprint.
    """
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(404, "Run not found")

    fp: dict = run.fingerprint or {}
    n_qubits: int = (
        fp.get("num_qubits") or fp.get("n_qubits") or 0
    )
    source = "qasm"

    if run.qasm:
        interactions = _extract_2q_interactions(run.qasm)
        # Infer n_qubits from QASM if fingerprint is missing it
        if n_qubits == 0 and run.qasm:
            for m in re.finditer(r'qreg\s+\w+\s*\[(\d+)\]', run.qasm):
                n_qubits += int(m.group(1))
        topo = _build_topology(max(n_qubits, 1), interactions)
    else:
        source = "fingerprint_chain_approximation"
        topo = _chain_topology_from_fingerprint(n_qubits)

    return {
        "run_id":    run_id,
        "n_qubits":  n_qubits,
        "source":    source,
        **topo,
    }
