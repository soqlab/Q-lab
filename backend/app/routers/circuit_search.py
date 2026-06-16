"""Semantic Circuit Similarity Search — WL-GNN Edition.

Two-tier embedding system:

  WL-GNN (primary, cached under "__wl_emb__"):
      Weisfeiler-Lehman message-passing on the circuit DAG.
      Each gate node aggregates predecessor features (mean), 3 rounds.
      Mean-pooled to 60 dims + 4 global scalars = 64 dims total.
      Uses Qiskit DAGCircuit when available; falls back to a regex-based
      causal DAG builder otherwise. Requires QASM.

  Structural (fallback, cached under "__emb__"):
      64-dim hand-crafted feature vector: gate histogram, depth profile,
      qubit activity, 2Q interaction topology, layer statistics.
      Works from fingerprint alone when no QASM is stored.

Similarity search uses WL-GNN when both circuits have a WL embedding;
otherwise falls back to structural. For circuits ≤ 8 qubits the
unitary-fidelity endpoint gives exact semantic equivalence.
"""

from __future__ import annotations

import math
import re
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import SessionLocal, get_db
from ..models import Run

router = APIRouter(prefix="/api/v1", tags=["circuit_search"])

_DIM = 64
_EMB_KEY = "__emb__"     # structural 64-dim (always present)
_WL_KEY  = "__wl_emb__"  # WL-GNN 64-dim (QASM required)
_NODE_DIM = 25           # per-gate WL feature size

# Gate vocabulary — indices 0-19 (20 named gate types)
_GATE_VOCAB = [
    "h", "x", "y", "z", "s", "t", "sdg", "tdg",   # 0-7
    "cx", "cz", "cy", "ecr", "ccx",                 # 8-12
    "rx", "ry", "rz", "u1", "u2", "u3", "sx",       # 13-19
]
_2Q = {"cx", "cz", "cy", "ecr", "rzx", "rxx", "ryy", "rzz", "csx", "swap", "ccx", "ch"}
_NC = {"t", "tdg", "rx", "ry", "rz", "u1", "u2", "u3", "p", "r", "sx", "rxx", "ryy"}


# ---------------------------------------------------------------------------
# QASM parser (shared by both embedding paths)
# ---------------------------------------------------------------------------

def _parse_qasm(qasm: str) -> dict:
    gate_counts: dict[str, int] = {}
    qubit_gates: dict[int, list] = {}
    qubit_pairs: dict[tuple, int] = {}
    total_qubits = 0

    for m in re.finditer(r'qreg\s+\w+\s*\[(\d+)\]', qasm):
        total_qubits += int(m.group(1))
    for m in re.finditer(r'qubit\s*\[(\d+)\]', qasm):
        total_qubits += int(m.group(1))

    q_time: dict[int, int] = {}
    layer_gates: dict[int, list] = {}

    for raw in qasm.splitlines():
        line = raw.strip()
        if not line or line.startswith('//'):
            continue
        lower = line.lower()
        if lower.startswith(('openqasm', 'include', 'qreg', 'creg', 'barrier', 'gate ')):
            continue
        m = re.match(r'^(\w+)\s*(?:\([^)]*\))?\s*([^;]+);', line)
        if not m:
            continue
        gate = m.group(1).lower()
        if gate in ('measure', 'reset', 'if'):
            continue
        qubits = [int(x) for x in re.findall(r'\[(\d+)\]', m.group(2))]
        if not qubits:
            continue

        gate_counts[gate] = gate_counts.get(gate, 0) + 1
        for q in qubits:
            qubit_gates.setdefault(q, []).append(gate)
        if len(qubits) == 2:
            pair = (min(qubits), max(qubits))
            qubit_pairs[pair] = qubit_pairs.get(pair, 0) + 1

        t = max((q_time.get(q, 0) for q in qubits), default=0)
        layer_gates.setdefault(t, []).append(gate)
        for q in qubits:
            q_time[q] = t + 1

    depth = max(layer_gates.keys(), default=0) + 1 if layer_gates else 0
    layers = [layer_gates.get(i, []) for i in range(depth)]
    return {
        "gate_counts": gate_counts,
        "qubit_gates": qubit_gates,
        "qubit_pairs": qubit_pairs,
        "total_qubits": max(total_qubits, 1),
        "layers": layers,
        "total_gates": sum(gate_counts.values()),
    }


# ---------------------------------------------------------------------------
# Shared utilities
# ---------------------------------------------------------------------------

def _l2(v: list[float]) -> list[float]:
    n = math.sqrt(sum(x * x for x in v))
    return [x / n for x in v] if n > 1e-9 else v


def _safe_angle(s: str) -> float:
    """Parse angle expression such as 'pi/2' or '1.5707' safely."""
    s = s.strip().replace('pi', str(math.pi))
    if not re.match(r'^[\d\s.\+\-\*/\(\)eE]+$', s):
        return 0.0
    try:
        return float(eval(s))  # noqa: S307 — regex above prevents code injection
    except Exception:
        return 0.0


# ---------------------------------------------------------------------------
# WL-GNN: node features + message passing
# ---------------------------------------------------------------------------

def _node_feat(gate: str, params: list[float], n_qubits: int) -> list[float]:
    """25-dim node feature: gate-type one-hot [x20] + angle sin/cos [x2] + arity [x3]."""
    f = [0.0] * _NODE_DIM
    if gate in _GATE_VOCAB:
        f[_GATE_VOCAB.index(gate)] = 1.0
    # unknown gates: all gate dims remain 0 — still distinguishable by arity + context
    if params:
        f[20] = math.sin(params[0])
        f[21] = math.cos(params[0])
    if n_qubits == 1:
        f[22] = 1.0
    elif n_qubits == 2:
        f[23] = 1.0
    else:
        f[24] = 1.0
    return f


def _wl_pool(node_feats: list[list[float]], pred_adj: list[list[int]]) -> list[float]:
    """
    3 rounds of Weisfeiler-Lehman message passing (mean predecessor aggregation).
    After each round: mean-pool all nodes over gate-type dims (0-19) -> 20 dims.
    Returns 60-dim vector (20 dims x 3 rounds).

    Round 0: gate histogram analog.
    Round 1: gate-type co-occurrence along circuit wires (1-hop connectivity).
    Round 2: 2-hop causal topology.
    """
    N = len(node_feats)
    if N == 0:
        return [0.0] * 60

    h = [list(f) for f in node_feats]
    out: list[float] = []

    for _ in range(3):
        new_h = []
        for v in range(N):
            preds = pred_adj[v]
            if preds:
                agg = [sum(h[u][d] for u in preds) / len(preds) for d in range(_NODE_DIM)]
            else:
                agg = [0.0] * _NODE_DIM
            new_h.append([(h[v][d] + agg[d]) / 2 for d in range(_NODE_DIM)])
        h = new_h
        out.extend(sum(h[v][d] for v in range(N)) / N for d in range(20))

    return out  # 60 dims


def _dag_from_qiskit(qasm: str) -> Optional[tuple[list, list, dict]]:
    """
    Build circuit DAG via Qiskit DAGCircuit for accurate gate-wire connectivity.
    Returns (node_feats, pred_adj, stats) or None on failure.
    """
    try:
        from qiskit.converters import circuit_to_dag
        try:
            from qiskit import qasm2
            qc = qasm2.loads(qasm)
        except Exception:
            from qiskit import qasm3
            qc = qasm3.loads(qasm)

        dag = circuit_to_dag(qc)
        op_nodes = list(dag.topological_op_nodes())
        if not op_nodes:
            return None

        node_set = set(op_nodes)
        node_map = {node: i for i, node in enumerate(op_nodes)}

        feats = []
        for node in op_nodes:
            params: list[float] = []
            for p in (getattr(node.op, "params", None) or [])[:2]:
                try:
                    params.append(float(p))
                except (TypeError, ValueError):
                    params.append(0.0)
            feats.append(_node_feat(node.name.lower(), params, len(node.qargs)))

        pred_adj = [
            [node_map[p] for p in dag.predecessors(node) if p in node_set]
            for node in op_nodes
        ]

        return feats, pred_adj, {
            "total_qubits": qc.num_qubits,
            "total_gates": len(op_nodes),
            "two_q": sum(1 for n in op_nodes if len(n.qargs) == 2),
            "depth": dag.depth(),
        }
    except Exception:
        return None


def _dag_from_regex(qasm: str) -> tuple[list, list, dict]:
    """
    Build causal gate DAG from QASM via regex (Qiskit-free fallback).
    Each gate's predecessors are the last gates on each of its qubits,
    reproducing the causal wire-dependency structure of the Qiskit DAG.
    """
    feats: list[list[float]] = []
    pred_adj: list[list[int]] = []
    last: dict[int, int] = {}
    q_time: dict[int, int] = {}
    total_qubits = 0
    two_q = 0

    for m in re.finditer(r'qreg\s+\w+\s*\[(\d+)\]', qasm):
        total_qubits += int(m.group(1))
    for m in re.finditer(r'qubit\s*\[(\d+)\]', qasm):
        total_qubits += int(m.group(1))

    for raw in qasm.splitlines():
        line = raw.strip()
        if not line or line.startswith('//'):
            continue
        if line.lower().startswith(('openqasm', 'include', 'qreg', 'creg', 'barrier', 'gate ')):
            continue
        m = re.match(r'^(\w+)\s*(?:\(([^)]*)\))?\s*([^;]+);', line)
        if not m:
            continue
        gate = m.group(1).lower()
        if gate in ('measure', 'reset', 'if'):
            continue
        qubits = [int(x) for x in re.findall(r'\[(\d+)\]', m.group(3))]
        if not qubits:
            continue

        params = [_safe_angle(t) for t in (m.group(2) or "").split(",") if t.strip()][:2]

        idx = len(feats)
        feats.append(_node_feat(gate, params, len(qubits)))

        preds: list[int] = []
        for q in qubits:
            if q in last and last[q] not in preds:
                preds.append(last[q])
            last[q] = idx
        pred_adj.append(preds)

        t = max((q_time.get(q, 0) for q in qubits), default=0)
        for q in qubits:
            q_time[q] = t + 1
        if len(qubits) >= 2:
            two_q += 1

    return feats, pred_adj, {
        "total_qubits": max(total_qubits, 1),
        "total_gates": max(len(feats), 1),
        "two_q": two_q,
        "depth": max(q_time.values(), default=1),
    }


def _wl_embed(qasm: str) -> list[float]:
    """
    Full WL-GNN circuit embedding.
    Builds circuit DAG (Qiskit preferred, regex fallback) then runs
    3 rounds of WL message passing -> 60 dims + 4 global scalars = 64-dim
    L2-normalised vector.
    """
    feats, pred_adj, stats = _dag_from_qiskit(qasm) or _dag_from_regex(qasm)
    wl = _wl_pool(feats, pred_adj)   # 60 dims

    total = max(stats["total_gates"], 1)
    total_q = max(stats["total_qubits"], 1)

    return _l2(wl + [
        min(math.log10(total) / 4, 1.0),
        min(stats["depth"] / max(total_q * 5, 1), 1.0),
        stats["two_q"] / total,
        min(math.log10(max(total_q, 1)) / 2, 1.0),
    ])


# ---------------------------------------------------------------------------
# Structural embedding (fingerprint fallback — backward-compatible)
# ---------------------------------------------------------------------------

def _embed_qasm(qasm: str) -> list[float]:
    f = _parse_qasm(qasm)
    v = [0.0] * _DIM
    total = max(f["total_gates"], 1)
    total_q = max(f["total_qubits"], 1)
    gc = f["gate_counts"]
    layers = f["layers"]

    for i, g in enumerate(_GATE_VOCAB):
        v[i] = gc.get(g, 0) / total
    known = sum(gc.get(g, 0) for g in _GATE_VOCAB)
    v[19] = max(0, total - known) / total   # "other" gates slot

    depth = len(layers)
    two_q = sum(gc.get(g, 0) for g in _2Q)
    nc = sum(gc.get(g, 0) for g in _NC)
    v[20] = min(math.log10(max(total, 1)) / 4, 1.0)
    v[21] = min(depth / max(total_q * 5, 1), 1.0)
    v[22] = two_q / total
    v[23] = nc / total
    v[24] = min(math.log10(max(total_q, 1)) / 2, 1.0)
    v[25] = min(total / max(depth * total_q, 1), 1.0)
    v[26] = min(len(gc) / 20, 1.0)
    v[27] = min(math.log10(max(depth, 1)) / 3, 1.0)

    if layers:
        for i in range(10):
            s = int(i * len(layers) / 10)
            e = int((i + 1) * len(layers) / 10)
            cnt = sum(len(layers[j]) for j in range(s, min(e + 1, len(layers))))
            v[28 + i] = cnt / total

    usage = sorted([len(gs) / total for gs in f["qubit_gates"].values()], reverse=True)
    for i, u in enumerate(usage[:10]):
        v[38 + i] = u

    if f["qubit_pairs"]:
        total_2q_pairs = max(sum(f["qubit_pairs"].values()), 1)
        for i, c in enumerate(sorted(f["qubit_pairs"].values(), reverse=True)[:8]):
            v[48 + i] = c / total_2q_pairs

    if layers:
        sizes = [len(layer) for layer in layers]
        mean_s = sum(sizes) / len(sizes)
        v[56] = min(mean_s / max(total_q, 1), 1.0)
        std_s = math.sqrt(sum((s - mean_s) ** 2 for s in sizes) / len(sizes))
        v[57] = min(std_s / max(total_q, 1), 1.0)
        v[58] = max(sizes) / max(total_q, 1)
        div = [len(set(layer)) / max(len(layer), 1) for layer in layers if layer]
        v[59] = sum(div) / len(div) if div else 0
        v[60] = sum(1 for s in sizes if s == 1) / len(sizes)

    return _l2(v)


def _embed_fingerprint(fp: dict) -> list[float]:
    v = [0.0] * _DIM
    gc = fp.get("gate_counts") or {}
    total_q = max(fp.get("num_qubits", 1) or 1, 1)
    size = max(fp.get("size", 1) or 1, 1)
    depth = max(fp.get("depth", 1) or 1, 1)
    total = max(sum(gc.values()), size, 1)

    for i, g in enumerate(_GATE_VOCAB):
        v[i] = gc.get(g, 0) / total
    v[20] = min(math.log10(max(size, 1)) / 4, 1.0)
    v[21] = min(depth / max(total_q * 5, 1), 1.0)
    v[22] = fp.get("two_qubit_ratio") or 0
    v[23] = fp.get("non_clifford_ratio") or 0
    v[24] = min(math.log10(max(total_q, 1)) / 2, 1.0)
    v[25] = min(size / max(depth * total_q, 1), 1.0)
    v[26] = min(len(gc) / 20, 1.0)
    v[27] = min(math.log10(max(depth, 1)) / 3, 1.0)
    return _l2(v)


def compute_embedding(run: Run) -> tuple[list[float], str]:
    """Return (embedding, source) — source is 'wl_gnn', 'qasm', or 'fingerprint'."""
    if run.qasm:
        try:
            return _wl_embed(run.qasm), "wl_gnn"
        except Exception:
            try:
                return _embed_qasm(run.qasm), "qasm"
            except Exception:
                pass
    return _embed_fingerprint(run.fingerprint or {}), "fingerprint"


# ---------------------------------------------------------------------------
# Cache helpers (dual cache: WL-GNN + structural)
# ---------------------------------------------------------------------------

def _get_cached(run: Run, key: str = _EMB_KEY) -> Optional[list[float]]:
    emb = (run.context or {}).get(key)
    if isinstance(emb, list) and len(emb) == _DIM:
        return emb
    return None


def _set_cached(run: Run, db: Session, emb: list[float], key: str = _EMB_KEY) -> None:
    run.context = {**(run.context or {}), key: emb}
    db.commit()


def _ensure_embedded(run: Run, db: Session) -> None:
    """Compute and cache both WL-GNN (when QASM available) and structural embeddings."""
    if run.qasm and not _get_cached(run, _WL_KEY):
        try:
            _set_cached(run, db, _wl_embed(run.qasm), _WL_KEY)
        except Exception:
            pass

    if not _get_cached(run, _EMB_KEY):
        try:
            v = _embed_qasm(run.qasm) if run.qasm else _embed_fingerprint(run.fingerprint or {})
            _set_cached(run, db, v, _EMB_KEY)
        except Exception:
            _set_cached(run, db, _embed_fingerprint(run.fingerprint or {}), _EMB_KEY)


# ---------------------------------------------------------------------------
# Cosine similarity (vectors are L2-normalised so dot == cosine)
# ---------------------------------------------------------------------------

def _cos(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/runs/{run_id}/embed")
def embed_single(run_id: str, db: Session = Depends(get_db)):
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if not run:
        raise HTTPException(404, "Run not found")
    _ensure_embedded(run, db)
    has_wl = _get_cached(run, _WL_KEY) is not None
    return {
        "run_id": run_id,
        "dim": _DIM,
        "source": "wl_gnn" if has_wl else "structural",
        "wl_gnn": has_wl,
        "cached": True,
    }


@router.get("/runs/{run_id}/similar")
def find_similar(
    run_id: str,
    n: int = Query(10, ge=1, le=50),
    min_sim: float = Query(0.70, ge=0.0, le=1.0),
    project: Optional[str] = None,
    backend: Optional[str] = None,
    same_qubits: bool = False,
    db: Session = Depends(get_db),
):
    anchor = db.scalar(select(Run).where(Run.run_id == run_id))
    if not anchor:
        raise HTTPException(404, "Run not found")

    anchor_fp = anchor.fingerprint or {}
    anchor_q = anchor_fp.get("num_qubits")

    # Compute both anchor embeddings up-front
    anchor_wl: Optional[list[float]] = None
    if anchor.qasm:
        anchor_wl = _get_cached(anchor, _WL_KEY)
        if anchor_wl is None:
            try:
                anchor_wl = _wl_embed(anchor.qasm)
                _set_cached(anchor, db, anchor_wl, _WL_KEY)
            except Exception:
                pass

    anchor_struct = _get_cached(anchor, _EMB_KEY)
    if anchor_struct is None:
        try:
            anchor_struct = _embed_qasm(anchor.qasm) if anchor.qasm else _embed_fingerprint(anchor_fp)
        except Exception:
            anchor_struct = _embed_fingerprint(anchor_fp)
        _set_cached(anchor, db, anchor_struct, _EMB_KEY)

    q = select(Run).where(Run.run_id != run_id)
    if project:
        q = q.where(Run.project_slug == project)
    if backend:
        q = q.where(Run.backend == backend)
    runs = db.scalars(q.order_by(Run.created_at.desc()).limit(2000)).all()

    results = []
    for run in runs:
        fp = run.fingerprint or {}
        if same_qubits and anchor_q and fp.get("num_qubits") != anchor_q:
            continue

        sim: float
        method: str

        # Prefer WL-GNN when both circuits have QASM
        if anchor_wl is not None and run.qasm:
            cand_wl = _get_cached(run, _WL_KEY)
            if cand_wl is None:
                try:
                    cand_wl = _wl_embed(run.qasm)
                    _set_cached(run, db, cand_wl, _WL_KEY)
                except Exception:
                    cand_wl = None
            if cand_wl is not None:
                sim = _cos(anchor_wl, cand_wl)
                method = "wl_gnn"
            else:
                cand_struct = _get_cached(run, _EMB_KEY) or _embed_fingerprint(fp)
                sim = _cos(anchor_struct, cand_struct)
                method = "structural"
        else:
            cand_struct = _get_cached(run, _EMB_KEY)
            if cand_struct is None:
                try:
                    cand_struct = _embed_qasm(run.qasm) if run.qasm else _embed_fingerprint(fp)
                except Exception:
                    cand_struct = _embed_fingerprint(fp)
            sim = _cos(anchor_struct, cand_struct)
            method = "structural"

        if sim < min_sim:
            continue

        from ..health_score import compute_health_score
        rd = {"results": run.results or {}, "calibration": run.calibration or {}, "fingerprint": fp}
        health = compute_health_score(rd)
        results.append({
            "run_id": run.run_id,
            "circuit_name": run.circuit_name,
            "backend": run.backend,
            "project": run.project_slug,
            "status": run.status,
            "created_at": run.created_at.isoformat() if run.created_at else None,
            "similarity": round(sim, 4),
            "embedding_method": method,
            "health_score": round(health, 1) if health is not None else None,
            "has_qasm": bool(run.qasm),
            "tags": run.tags or [],
            "fingerprint_delta": {
                "depth": (fp.get("depth") or 0) - (anchor_fp.get("depth") or 0),
                "size": (fp.get("size") or 0) - (anchor_fp.get("size") or 0),
                "num_qubits": (fp.get("num_qubits") or 0) - (anchor_fp.get("num_qubits") or 0),
                "nc_ratio": round(
                    (fp.get("non_clifford_ratio") or 0.0) - (anchor_fp.get("non_clifford_ratio") or 0.0), 3
                ),
            },
        })

    results.sort(key=lambda x: -x["similarity"])
    return {
        "anchor_run_id": run_id,
        "anchor_circuit_name": anchor.circuit_name,
        "anchor_backend": anchor.backend,
        "anchor_has_qasm": bool(anchor.qasm),
        "anchor_fingerprint": anchor_fp,
        "embedding_source": "wl_gnn" if anchor_wl is not None else "structural",
        "candidates_scanned": len(runs),
        "result_count": min(len(results), n),
        "results": results[:n],
    }


@router.get("/runs/{run_id}/unitary-fidelity/{other_run_id}")
def unitary_fidelity(
    run_id: str,
    other_run_id: str,
    db: Session = Depends(get_db),
):
    """
    Exact semantic equivalence via unitary matrix process fidelity.
    F = |Tr(U† V)| / 2^n equals 1.0 iff circuits implement the same
    unitary up to global phase. Only feasible for n_qubits <= 8.
    """
    r1 = db.scalar(select(Run).where(Run.run_id == run_id))
    r2 = db.scalar(select(Run).where(Run.run_id == other_run_id))
    if not r1:
        raise HTTPException(404, f"Run {run_id} not found")
    if not r2:
        raise HTTPException(404, f"Run {other_run_id} not found")
    if not r1.qasm or not r2.qasm:
        raise HTTPException(422, "Both runs must have QASM stored for unitary comparison")

    try:
        import numpy as np
        from qiskit.quantum_info import Operator

        def _load(qasm: str):
            try:
                from qiskit import qasm2
                return qasm2.loads(qasm)
            except Exception:
                from qiskit import qasm3
                return qasm3.loads(qasm)

        qc1 = _load(r1.qasm)
        qc2 = _load(r2.qasm)
        n1, n2 = qc1.num_qubits, qc2.num_qubits

        if n1 > 8 or n2 > 8:
            raise HTTPException(
                422,
                f"Unitary comparison requires <= 8 qubits (got {n1} and {n2}); "
                "the 2^n x 2^n matrix is too large above this threshold.",
            )
        if n1 != n2:
            return {
                "run_id": run_id,
                "other_run_id": other_run_id,
                "fidelity": 0.0,
                "equivalent": False,
                "note": f"Qubit count mismatch: {n1} vs {n2}",
            }

        U = np.array(Operator(qc1).data)
        V = np.array(Operator(qc2).data)
        fidelity = float(abs(np.trace(U.conj().T @ V)) / (2 ** n1))

        return {
            "run_id": run_id,
            "other_run_id": other_run_id,
            "num_qubits": n1,
            "fidelity": round(fidelity, 6),
            "equivalent": fidelity > 0.9999,
            "method": "unitary_matrix",
        }
    except HTTPException:
        raise
    except ImportError:
        raise HTTPException(501, "numpy and qiskit are required for unitary comparison")
    except Exception as exc:
        raise HTTPException(500, f"Unitary comparison failed: {exc}")


@router.post("/circuits/embed-all")
def embed_all(
    background_tasks: BackgroundTasks,
    limit: int = Query(500, ge=1, le=5000),
    db: Session = Depends(get_db),
):
    runs = db.scalars(select(Run).order_by(Run.created_at.desc()).limit(limit)).all()
    to_embed = [
        r.run_id for r in runs
        if not _get_cached(r, _WL_KEY) or not _get_cached(r, _EMB_KEY)
    ]

    def _bg(run_ids: list[str]) -> None:
        with SessionLocal() as sess:
            for rid in run_ids:
                r = sess.scalar(select(Run).where(Run.run_id == rid))
                if r:
                    try:
                        _ensure_embedded(r, sess)
                    except Exception:
                        pass

    background_tasks.add_task(_bg, to_embed)
    wl_cached = sum(1 for r in runs if _get_cached(r, _WL_KEY) is not None)
    return {
        "total_checked": len(runs),
        "already_embedded": len(runs) - len(to_embed),
        "wl_gnn_cached": wl_cached,
        "queued": len(to_embed),
    }


@router.get("/circuits/search")
def search_by_fingerprint(
    num_qubits: Optional[int] = Query(None, ge=1),
    depth: Optional[int] = Query(None, ge=1),
    backend: Optional[str] = None,
    project: Optional[str] = None,
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """Quick structural search by fingerprint (no embedding needed)."""
    q = select(Run).where(Run.status == "completed")
    if backend:
        q = q.where(Run.backend == backend)
    if project:
        q = q.where(Run.project_slug == project)
    runs = db.scalars(q.order_by(Run.created_at.desc()).limit(500)).all()

    results = []
    for run in runs:
        fp = run.fingerprint or {}
        if num_qubits and fp.get("num_qubits") != num_qubits:
            continue
        if depth and abs((fp.get("depth") or 0) - depth) > depth * 0.2:
            continue
        from ..health_score import compute_health_score
        rd = {"results": run.results or {}, "calibration": run.calibration or {}, "fingerprint": fp}
        health = compute_health_score(rd)
        results.append({
            "run_id": run.run_id,
            "circuit_name": run.circuit_name,
            "backend": run.backend,
            "project": run.project_slug,
            "created_at": run.created_at.isoformat() if run.created_at else None,
            "health_score": round(health, 1) if health is not None else None,
            "depth": fp.get("depth"),
            "num_qubits": fp.get("num_qubits"),
            "size": fp.get("size"),
            "non_clifford_ratio": fp.get("non_clifford_ratio"),
        })

    return {"count": len(results[:limit]), "results": results[:limit]}
