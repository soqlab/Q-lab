from __future__ import annotations
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list, store_delete, store_seed

router = APIRouter(prefix="/api/v1/research-graph", tags=["research-graph"])

NS_NODES = "research_graph_nodes"
NS_EDGES = "research_graph_edges"

NODE_TYPES = ["run", "hypothesis", "paper", "circuit", "finding", "experiment", "dataset", "method"]
EDGE_TYPES = ["tests", "confirms", "refutes", "inspired_by", "cites", "uses", "produces", "extends", "compares", "replicates"]

class GraphNode(BaseModel):
    node_id: str
    node_type: str
    label: str
    description: str
    metadata: dict
    created_at: str
    x: float = 0.0
    y: float = 0.0
    color: str = "#6366f1"
    size: float = 1.0

class GraphEdge(BaseModel):
    edge_id: str
    source_id: str
    target_id: str
    edge_type: str
    label: str
    weight: float
    metadata: dict
    created_at: str

class AddNodeRequest(BaseModel):
    node_type: str
    label: str
    description: str = ""
    metadata: dict = {}

class AddEdgeRequest(BaseModel):
    source_id: str
    target_id: str
    edge_type: str
    label: str = ""
    weight: float = 1.0
    metadata: dict = {}

class PathRequest(BaseModel):
    source_id: str
    target_id: str
    max_hops: int = 5

NODE_COLORS = {
    "run": "#6366f1", "hypothesis": "#f59e0b", "paper": "#10b981",
    "circuit": "#3b82f6", "finding": "#ef4444", "experiment": "#8b5cf6",
    "dataset": "#06b6d4", "method": "#84cc16",
}

def _seed_db(db: Session):
    import random; rng = random.Random(42)
    nodes_data = [
        ("hypothesis", "GHZ Heisenberg Limit", "GHZ states achieve 1/N phase sensitivity"),
        ("experiment", "Ramsey Interferometry Study", "Phase estimation with N=1..8 qubits"),
        ("run", "Run #4821 (N=4 GHZ)", "4-qubit GHZ sensing, ibm_brisbane"),
        ("run", "Run #4822 (N=8 GHZ)", "8-qubit GHZ sensing, ibm_brisbane"),
        ("finding", "HL Advantage at N≥6", "Heisenberg limit observed for N=6,7,8"),
        ("paper", "Giovannetti et al. 2004", "Quantum-Enhanced Measurements: Beating the Standard Quantum Limit"),
        ("method", "GHZ State Preparation", "H + cascade CX gates for N-qubit GHZ"),
        ("circuit", "ghz_sensing_v3", "Ramsey sequence with GHZ probe and adaptive phase"),
        ("paper", "Our Draft (2026)", "Heisenberg-limited magnetometry with Q-Lab tracking"),
        ("dataset", "Cal Data Q1 2026", "ibm_brisbane calibration snapshots Jan-Mar 2026"),
    ]
    node_seeds = []
    nids = []
    for i, (ntype, label, desc) in enumerate(nodes_data):
        nid = str(uuid.uuid4())
        angle = 2 * 3.14159 * i / len(nodes_data)
        r = rng.uniform(150, 300)
        node = GraphNode(
            node_id=nid, node_type=ntype, label=label, description=desc,
            metadata={}, created_at=datetime.now(timezone.utc).isoformat(),
            x=round(r * (1 if i % 2 == 0 else -1) * abs(rng.uniform(0.3, 1.0)), 1),
            y=round(r * (1 if i < 5 else -1) * rng.uniform(0.3, 1.0), 1),
            color=NODE_COLORS.get(ntype, "#6366f1"),
            size=1.5 if ntype in ("finding","paper") else 1.0,
        )
        node_seeds.append((nid, node.model_dump()))
        nids.append(nid)
    store_seed(db, NS_NODES, node_seeds)
    edges_data = [
        (0, 1, "tests", "Tests hypothesis"), (1, 2, "produces", "Produced run"),
        (1, 3, "produces", "Produced run"), (2, 4, "produces", "Supports finding"),
        (3, 4, "produces", "Supports finding"), (5, 0, "inspired_by", "Inspired hypothesis"),
        (6, 2, "uses", "Circuit used in run"), (6, 3, "uses", "Circuit used in run"),
        (4, 8, "produces", "Finding → paper"), (9, 2, "produces", "Cal data → run"),
        (0, 8, "produces", "Hypothesis → draft paper"),
    ]
    edge_seeds = []
    for si, ti, etype, label in edges_data:
        if si < len(nids) and ti < len(nids):
            eid = str(uuid.uuid4())
            edge = GraphEdge(
                edge_id=eid, source_id=nids[si], target_id=nids[ti],
                edge_type=etype, label=label, weight=1.0, metadata={},
                created_at=datetime.now(timezone.utc).isoformat(),
            )
            edge_seeds.append((eid, edge.model_dump()))
    store_seed(db, NS_EDGES, edge_seeds)

@router.get("/")
def get_graph(db: Session = Depends(get_db)):
    _seed_db(db)
    nodes = [GraphNode(**r) for r in store_list(db, NS_NODES)]
    edges = store_list(db, NS_EDGES)
    return {"nodes": nodes, "edges": edges, "stats": {"n_nodes": len(nodes), "n_edges": len(edges), "node_types": {t: sum(1 for n in nodes if n.node_type == t) for t in NODE_TYPES}}}

@router.post("/nodes", response_model=GraphNode)
def add_node(req: AddNodeRequest, db: Session = Depends(get_db)):
    import random; rng = random.Random()
    nid = str(uuid.uuid4())
    node = GraphNode(
        node_id=nid, node_type=req.node_type, label=req.label,
        description=req.description, metadata=req.metadata,
        created_at=datetime.now(timezone.utc).isoformat(),
        x=round(rng.uniform(-300, 300), 1), y=round(rng.uniform(-300, 300), 1),
        color=NODE_COLORS.get(req.node_type, "#6366f1"), size=1.0,
    )
    store_put(db, NS_NODES, nid, node.model_dump())
    return node

@router.post("/edges", response_model=GraphEdge)
def add_edge(req: AddEdgeRequest, db: Session = Depends(get_db)):
    if store_get(db, NS_NODES, req.source_id) is None:
        raise HTTPException(404, f"Source node {req.source_id} not found")
    if store_get(db, NS_NODES, req.target_id) is None:
        raise HTTPException(404, f"Target node {req.target_id} not found")
    edge = GraphEdge(
        edge_id=str(uuid.uuid4()), source_id=req.source_id, target_id=req.target_id,
        edge_type=req.edge_type, label=req.label or req.edge_type,
        weight=req.weight, metadata=req.metadata,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    store_put(db, NS_EDGES, edge.edge_id, edge.model_dump())
    return edge

@router.post("/paths")
def find_paths(req: PathRequest, db: Session = Depends(get_db)):
    if store_get(db, NS_NODES, req.source_id) is None or store_get(db, NS_NODES, req.target_id) is None:
        raise HTTPException(404, "node not found")
    nodes_map = {r["node_id"]: r for r in store_list(db, NS_NODES)}
    edges = store_list(db, NS_EDGES)
    adj: dict = {}
    for e in edges:
        adj.setdefault(e["source_id"], []).append((e["target_id"], e["edge_type"]))
        adj.setdefault(e["target_id"], []).append((e["source_id"], e["edge_type"]))
    paths = []
    queue = [([req.source_id], [])]
    visited_paths: set = set()
    while queue and len(paths) < 10:
        path, rels = queue.pop(0)
        curr = path[-1]
        if curr == req.target_id and len(path) > 1:
            key = tuple(path)
            if key not in visited_paths:
                visited_paths.add(key)
                paths.append({"nodes": [{"id": n, "label": nodes_map[n]["label"], "type": nodes_map[n]["node_type"]} for n in path if n in nodes_map], "relations": rels, "hops": len(path) - 1})
            continue
        if len(path) > req.max_hops + 1:
            continue
        for neighbor, rel in adj.get(curr, []):
            if neighbor not in path:
                queue.append((path + [neighbor], rels + [rel]))
    return {"source": req.source_id, "target": req.target_id, "paths_found": len(paths), "paths": paths}

@router.delete("/nodes/{node_id}")
def delete_node(node_id: str, db: Session = Depends(get_db)):
    if store_get(db, NS_NODES, node_id) is None:
        raise HTTPException(404, "node not found")
    store_delete(db, NS_NODES, node_id)
    # Remove edges connected to this node
    edges = store_list(db, NS_EDGES)
    for e in edges:
        if e["source_id"] == node_id or e["target_id"] == node_id:
            store_delete(db, NS_EDGES, e["edge_id"])
    return {"deleted": node_id}

@router.get("/node-types")
def get_node_types():
    return {"node_types": NODE_TYPES, "edge_types": EDGE_TYPES, "colors": NODE_COLORS}
