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

# Earlier versions filled every graph with an invented study ("Run #4821 (N=4 GHZ)", "Our Draft
# (2026)", ...). Those nodes and their edges are removed once; no sample graph is created any more.
_OLD_SAMPLE_LABELS = {'Our Draft (2026)', 'Run #4821 (N=4 GHZ)', 'Run #4822 (N=8 GHZ)', 'GHZ Heisenberg Limit', 'Ramsey Interferometry Study', 'Cal Data Q1 2026', 'ghz_sensing_v3', 'HL Advantage at N≥6', 'GHZ State Preparation', 'Giovannetti et al. 2004'}
_CLEANED = "_samples_removed_v1"


def _seed_db(db: Session):
    if store_get(db, NS_NODES + "_meta", _CLEANED):
        return
    old = {n["node_id"] for n in store_list(db, NS_NODES) if n.get("label") in _OLD_SAMPLE_LABELS}
    for nid in old:
        store_delete(db, NS_NODES, nid)
    for e in store_list(db, NS_EDGES):
        if e.get("source_id") in old or e.get("target_id") in old:
            store_delete(db, NS_EDGES, e["edge_id"])
    store_put(db, NS_NODES + "_meta", _CLEANED, {"done": True})

@router.get("")
def get_graph(db: Session = Depends(get_db)):
    _seed_db(db)
    nodes = [GraphNode(**r) for r in store_list(db, NS_NODES)]
    edges = store_list(db, NS_EDGES)
    return {
        "nodes": [n.model_dump() for n in nodes],
        "edges": edges,
        "stats": {"n_nodes": len(nodes), "n_edges": len(edges), "node_types": {t: sum(1 for n in nodes if n.node_type == t) for t in NODE_TYPES}},
    }

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
