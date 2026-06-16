from __future__ import annotations
import uuid, difflib
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list, store_delete, store_seed

router = APIRouter(prefix="/api/v1/circuit-ancestry", tags=["circuit-ancestry"])

NS_CIRCUITS = "circuit_ancestry_trees"
NS_VERSIONS = "circuit_ancestry_versions"

class CircuitVersion(BaseModel):
    version_id: str
    circuit_id: str
    version_number: int
    commit_message: str
    qasm: str
    n_qubits: int
    depth: int
    gate_count: int
    created_at: str
    created_by: str
    parent_version_id: str | None
    forked_from_circuit_id: str | None
    tags: list[str]
    run_ids: list[str]
    fidelity_at_commit: float | None
    is_head: bool

class CircuitTree(BaseModel):
    circuit_id: str
    name: str
    head_version_id: str
    total_versions: int
    total_forks: int
    created_at: str
    versions: list[CircuitVersion]
    fork_ids: list[str]

class CreateCircuitRequest(BaseModel):
    name: str
    qasm: str
    commit_message: str = "Initial version"
    created_by: str = "researcher"
    tags: list[str] = []

class CommitVersionRequest(BaseModel):
    circuit_id: str
    qasm: str
    commit_message: str
    created_by: str = "researcher"
    tags: list[str] = []
    fidelity: float | None = None

class ForkRequest(BaseModel):
    circuit_id: str
    version_id: str | None = None
    new_name: str = ""
    commit_message: str = "Forked from parent"
    created_by: str = "researcher"

class DiffResult(BaseModel):
    circuit_id: str
    version_a: str
    version_b: str
    unified_diff: str
    lines_added: int
    lines_removed: int
    gates_added: list[str]
    gates_removed: list[str]
    depth_delta: int
    gate_count_delta: int
    similarity_score: float

def _parse_qasm(qasm: str) -> tuple[int, int, list[str]]:
    lines = [l.strip() for l in qasm.strip().split("\n") if l.strip() and not l.strip().startswith("//")]
    gate_lines = [l for l in lines if not l.startswith("OPENQASM") and not l.startswith("include") and not l.startswith("qreg") and not l.startswith("creg") and not l.startswith("measure") and l.endswith(";")]
    n_qubits = sum(1 for l in lines if l.startswith("qreg"))
    if n_qubits == 0:
        n_qubits = max(1, qasm.count("[") // 2)
    return n_qubits, len(gate_lines), [l.split("(")[0].split(" ")[0] for l in gate_lines]

def _make_version(circuit_id: str, qasm: str, msg: str, by: str, tags: list, parent_id: str | None, fork_from: str | None, ver_num: int, fidelity: float | None) -> CircuitVersion:
    n_q, depth, gates = _parse_qasm(qasm)
    vid = str(uuid.uuid4())
    return CircuitVersion(
        version_id=vid, circuit_id=circuit_id, version_number=ver_num,
        commit_message=msg, qasm=qasm, n_qubits=max(1, n_q),
        depth=max(1, depth), gate_count=max(1, len(gates)),
        created_at=datetime.now(timezone.utc).isoformat(),
        created_by=by, parent_version_id=parent_id,
        forked_from_circuit_id=fork_from, tags=tags, run_ids=[],
        fidelity_at_commit=fidelity, is_head=True,
    )

DEMO_CIRCUITS = [
    ("Bell State", 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\ncreg c[2];\nh q[0];\ncx q[0],q[1];\nmeasure q -> c;\n'),
    ("GHZ State", 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[4];\ncreg c[4];\nh q[0];\ncx q[0],q[1];\ncx q[1],q[2];\ncx q[2],q[3];\nmeasure q -> c;\n'),
    ("QFT-4", 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[4];\nh q[0];\ncu1(pi/2) q[1],q[0];\ncu1(pi/4) q[2],q[0];\ncu1(pi/8) q[3],q[0];\nh q[1];\ncu1(pi/2) q[2],q[1];\ncu1(pi/4) q[3],q[1];\nh q[2];\ncu1(pi/2) q[3],q[2];\nh q[3];\n'),
]

def _seed_db(db: Session):
    import random
    rng = random.Random(42)
    circuit_seeds = []
    version_seeds = []
    for name, qasm in DEMO_CIRCUITS:
        cid = str(uuid.uuid4())
        v1 = _make_version(cid, qasm, "Initial version", "researcher", ["demo"], None, None, 1, rng.uniform(0.95, 0.999))
        v2_qasm = qasm + f"// optimized pass 1\n"
        v2 = _make_version(cid, v2_qasm, "Add optimization pass", "researcher", ["demo","optimized"], v1.version_id, None, 2, rng.uniform(0.96, 0.999))
        v1_data = v1.model_dump(); v1_data["is_head"] = False
        circuit_data = {"circuit_id": cid, "name": name, "head": v2.version_id, "created_at": v1.created_at, "fork_ids": [], "version_ids": [v1.version_id, v2.version_id]}
        circuit_seeds.append((cid, circuit_data))
        version_seeds.append((v1.version_id, v1_data))
        version_seeds.append((v2.version_id, v2.model_dump()))
    store_seed(db, NS_CIRCUITS, circuit_seeds)
    store_seed(db, NS_VERSIONS, version_seeds)

@router.post("/", response_model=CircuitVersion)
def create_circuit(req: CreateCircuitRequest, db: Session = Depends(get_db)):
    cid = str(uuid.uuid4())
    v = _make_version(cid, req.qasm, req.commit_message, req.created_by, req.tags, None, None, 1, None)
    circuit_data = {"circuit_id": cid, "name": req.name, "head": v.version_id, "created_at": v.created_at, "fork_ids": [], "version_ids": [v.version_id]}
    store_put(db, NS_CIRCUITS, cid, circuit_data)
    store_put(db, NS_VERSIONS, v.version_id, v.model_dump())
    return v

@router.post("/commit", response_model=CircuitVersion)
def commit_version(req: CommitVersionRequest, db: Session = Depends(get_db)):
    circuit_data = store_get(db, NS_CIRCUITS, req.circuit_id)
    if circuit_data is None:
        raise HTTPException(404, "circuit not found")
    version_ids = circuit_data["version_ids"]
    # Mark all existing versions as not head
    for vid in version_ids:
        vd = store_get(db, NS_VERSIONS, vid)
        if vd:
            vd["is_head"] = False
            store_put(db, NS_VERSIONS, vid, vd)
    prev_head_id = version_ids[-1] if version_ids else None
    v = _make_version(req.circuit_id, req.qasm, req.commit_message, req.created_by, req.tags, prev_head_id, None, len(version_ids) + 1, req.fidelity)
    store_put(db, NS_VERSIONS, v.version_id, v.model_dump())
    circuit_data["head"] = v.version_id
    circuit_data["version_ids"].append(v.version_id)
    store_put(db, NS_CIRCUITS, req.circuit_id, circuit_data)
    return v

@router.post("/fork", response_model=CircuitVersion)
def fork_circuit(req: ForkRequest, db: Session = Depends(get_db)):
    src_circuit = store_get(db, NS_CIRCUITS, req.circuit_id)
    if src_circuit is None:
        raise HTTPException(404, "source circuit not found")
    src_version_ids = src_circuit["version_ids"]
    # Get the requested version or last
    src_v_data = None
    if req.version_id:
        src_v_data = store_get(db, NS_VERSIONS, req.version_id)
    if src_v_data is None and src_version_ids:
        src_v_data = store_get(db, NS_VERSIONS, src_version_ids[-1])
    if src_v_data is None:
        raise HTTPException(404, "version not found")
    src_v = CircuitVersion(**src_v_data)
    new_cid = str(uuid.uuid4())
    new_name = req.new_name or f"Fork of {src_circuit['name']}"
    v = _make_version(new_cid, src_v.qasm, req.commit_message, req.created_by, src_v.tags, None, req.circuit_id, 1, src_v.fidelity_at_commit)
    new_circuit_data = {"circuit_id": new_cid, "name": new_name, "head": v.version_id, "created_at": v.created_at, "fork_ids": [], "version_ids": [v.version_id]}
    store_put(db, NS_CIRCUITS, new_cid, new_circuit_data)
    store_put(db, NS_VERSIONS, v.version_id, v.model_dump())
    src_circuit["fork_ids"].append(new_cid)
    store_put(db, NS_CIRCUITS, req.circuit_id, src_circuit)
    return v

@router.get("/{circuit_id}/tree", response_model=CircuitTree)
def get_tree(circuit_id: str, db: Session = Depends(get_db)):
    _seed_db(db)
    circuit_data = store_get(db, NS_CIRCUITS, circuit_id)
    if circuit_data is None:
        raise HTTPException(404, "circuit not found")
    versions = [CircuitVersion(**store_get(db, NS_VERSIONS, vid)) for vid in circuit_data["version_ids"] if store_get(db, NS_VERSIONS, vid)]
    return CircuitTree(
        circuit_id=circuit_id, name=circuit_data["name"], head_version_id=circuit_data["head"],
        total_versions=len(versions),
        total_forks=len(circuit_data["fork_ids"]),
        created_at=circuit_data["created_at"],
        versions=versions,
        fork_ids=circuit_data["fork_ids"],
    )

@router.get("/{circuit_id}/diff/{version_a}/{version_b}", response_model=DiffResult)
def diff_versions(circuit_id: str, version_a: str, version_b: str, db: Session = Depends(get_db)):
    circuit_data = store_get(db, NS_CIRCUITS, circuit_id)
    if circuit_data is None:
        raise HTTPException(404, "circuit not found")
    va_data = store_get(db, NS_VERSIONS, version_a)
    vb_data = store_get(db, NS_VERSIONS, version_b)
    if not va_data or not vb_data:
        raise HTTPException(404, "version not found")
    va = CircuitVersion(**va_data)
    vb = CircuitVersion(**vb_data)
    diff = list(difflib.unified_diff(va.qasm.splitlines(keepends=True), vb.qasm.splitlines(keepends=True), fromfile=f"v{va.version_number}", tofile=f"v{vb.version_number}"))
    lines_added = sum(1 for l in diff if l.startswith("+") and not l.startswith("+++"))
    lines_removed = sum(1 for l in diff if l.startswith("-") and not l.startswith("---"))
    _, _, ga = _parse_qasm(va.qasm); _, _, gb = _parse_qasm(vb.qasm)
    ga_set, gb_set = set(ga), set(gb)
    matcher = difflib.SequenceMatcher(None, va.qasm, vb.qasm)
    sim = matcher.ratio()
    return DiffResult(
        circuit_id=circuit_id, version_a=version_a, version_b=version_b,
        unified_diff="".join(diff), lines_added=lines_added, lines_removed=lines_removed,
        gates_added=list(gb_set - ga_set), gates_removed=list(ga_set - gb_set),
        depth_delta=vb.depth - va.depth, gate_count_delta=vb.gate_count - va.gate_count,
        similarity_score=round(sim, 4),
    )

@router.get("/")
def list_circuits(db: Session = Depends(get_db)):
    _seed_db(db)
    circuits = store_list(db, NS_CIRCUITS)
    return {"circuits": [{"circuit_id": c["circuit_id"], "name": c["name"], "versions": len(c["version_ids"]), "created_at": c["created_at"], "head": c["head"]} for c in circuits]}
