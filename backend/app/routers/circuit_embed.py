"""Quantum Circuit Semantic Search — vector embeddings for circuit similarity search."""
from __future__ import annotations
import math, uuid, re
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/circuit-embed", tags=["circuit_embed"])

GATE_VOCAB = ["h", "x", "y", "z", "s", "sdg", "t", "tdg", "cx", "cz", "swap",
              "rx", "ry", "rz", "u1", "u2", "u3", "ccx", "id", "sx"]

_index: List[dict] = []


def _embed(qasm: str) -> List[float]:
    lines = [l.strip().lower() for l in qasm.split("\n") if l.strip()]
    gc = {g: 0 for g in GATE_VOCAB}
    total = 0
    for line in lines:
        for g in GATE_VOCAB:
            if line.startswith(g + " ") or line.startswith(g + "("):
                gc[g] += 1
                total += 1
    gate_features = [gc[g] / max(total, 1) for g in GATE_VOCAB]

    m = re.search(r"qreg\s+\w+\[(\d+)\]", qasm)
    n_q = int(m.group(1)) if m else 2
    cx = gc["cx"] + gc["cz"] + gc["swap"]
    t = gc["t"] + gc["tdg"]
    rot = gc["rx"] + gc["ry"] + gc["rz"]

    structural = [
        n_q / 20.0,
        total / 100.0,
        cx / max(total, 1),
        t / max(total, 1),
        gc["h"] / max(total, 1),
        rot / max(total, 1),
    ]
    return gate_features + structural


def _cosine(a: List[float], b: List[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x ** 2 for x in a))
    nb = math.sqrt(sum(x ** 2 for x in b))
    if na < 1e-10 or nb < 1e-10:
        return 0.0
    return round(dot / (na * nb), 4)


def _describe(qasm: str, emb: List[float]) -> str:
    gf, sf = emb[:20], emb[20:]
    n_q = round(sf[0] * 20)
    n_g = round(sf[1] * 100)
    dominant = GATE_VOCAB[max(range(len(GATE_VOCAB)), key=lambda i: gf[i])]
    if sf[2] > 0.2:
        kind = "highly entangled"
    elif sf[4] > 0.3:
        kind = "superposition-heavy"
    elif sf[3] > 0.1:
        kind = "non-Clifford"
    else:
        kind = "Clifford"
    return f"{n_q}-qubit {kind} circuit (~{n_g} gates, dominant: {dominant})"


def _seed_demos() -> None:
    demos = [
        ("Bell State", 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\ncreg c[2];\nh q[0];\ncx q[0],q[1];\nmeasure q -> c;'),
        ("GHZ State", 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[3];\ncreg c[3];\nh q[0];\ncx q[0],q[1];\ncx q[1],q[2];\nmeasure q -> c;'),
        ("QFT-2", 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\ncreg c[2];\nh q[0];\nrz(1.5708) q[1];\ncx q[0],q[1];\nrz(-1.5708) q[1];\ncx q[0],q[1];\nh q[1];\nmeasure q -> c;'),
        ("T-gate test", 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\ncreg c[2];\nh q[0];\nt q[0];\nt q[1];\ncx q[0],q[1];\nmeasure q -> c;'),
        ("VQE Ansatz", 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[4];\ncreg c[4];\nry(1.2) q[0];\nry(0.8) q[1];\nry(1.7) q[2];\nry(0.5) q[3];\ncx q[0],q[1];\ncx q[1],q[2];\ncx q[2],q[3];\nmeasure q -> c;'),
        ("Rotation sweep", 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[3];\ncreg c[3];\nrx(1.047) q[0];\nry(2.094) q[1];\nrz(3.142) q[2];\nmeasure q -> c;'),
        ("W State", 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[3];\ncreg c[3];\nx q[0];\ncx q[0],q[1];\ncx q[0],q[2];\nrx(1.5708) q[0];\nmeasure q -> c;'),
    ]
    for name, qasm in demos:
        emb = _embed(qasm)
        _index.append({
            "embed_id": f"demo-{uuid.uuid4().hex[:8]}",
            "circuit_name": name,
            "tags": ["demo"],
            "run_id": None,
            "embedding": emb,
            "description": _describe(qasm, emb),
            "created_at": datetime.now(timezone.utc).isoformat(),
        })


class IndexRequest(BaseModel):
    qasm: str
    circuit_name: str = ""
    tags: List[str] = []
    run_id: Optional[str] = None


class SearchRequest(BaseModel):
    query_qasm: str
    top_k: int = Field(default=10, ge=1, le=50)
    min_similarity: float = Field(default=0.4, ge=0.0, le=1.0)


@router.post("/index")
def index_circuit(req: IndexRequest):
    emb = _embed(req.qasm)
    entry = {
        "embed_id": f"emb-{uuid.uuid4().hex[:12]}",
        "circuit_name": req.circuit_name or "unnamed",
        "tags": req.tags,
        "run_id": req.run_id,
        "embedding": emb,
        "description": _describe(req.qasm, emb),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    _index.append(entry)
    return {"embed_id": entry["embed_id"], "description": entry["description"], "embedding_dim": len(emb)}


@router.post("/search")
def search_circuits(req: SearchRequest):
    if not _index:
        _seed_demos()
    qe = _embed(req.query_qasm)
    qdesc = _describe(req.query_qasm, qe)
    results = [
        {
            "embed_id": e["embed_id"],
            "circuit_name": e["circuit_name"],
            "tags": e["tags"],
            "run_id": e["run_id"],
            "similarity": _cosine(qe, e["embedding"]),
            "description": e["description"],
            "created_at": e["created_at"],
        }
        for e in _index
        if _cosine(qe, e["embedding"]) >= req.min_similarity
    ]
    results.sort(key=lambda x: -x["similarity"])
    return {
        "query_description": qdesc,
        "embedding_dim": len(qe),
        "total_indexed": len(_index),
        "results": results[:req.top_k],
        "n_results": min(len(results), req.top_k),
    }


@router.get("/index")
def list_indexed():
    if not _index:
        _seed_demos()
    return [{"embed_id": e["embed_id"], "circuit_name": e["circuit_name"],
             "description": e["description"], "created_at": e["created_at"]} for e in _index]
