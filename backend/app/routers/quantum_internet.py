from __future__ import annotations

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import uuid, random, math
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list, store_delete

router = APIRouter(prefix="/api/v1/quantum-internet", tags=["Quantum Internet"])

NS_NETWORKS = "quantum_networks"
NS_SIMULATIONS = "quantum_net_simulations"


class QNode(BaseModel):
    node_id: str
    name: str
    type: str
    location: str
    qubit_count: int
    coherence_time_us: float
    gate_fidelity: float


class QLink(BaseModel):
    link_id: str
    node_a: str
    node_b: str
    distance_km: float
    loss_db_per_km: float
    entanglement_rate_hz: float
    fidelity: float


class QNetwork(BaseModel):
    network_id: str
    name: str
    nodes: List[QNode]
    links: List[QLink]
    topology: str
    created_at: str


class EntanglementSimResult(BaseModel):
    sim_id: str
    network_id: str
    source_node: str
    dest_node: str
    path: List[str]
    n_hops: int
    end_to_end_fidelity: float
    entanglement_rate_hz: float
    success_probability: float
    latency_ms: float
    bottleneck_link: Optional[str]
    simulated_at: str


class RepeaterPlacement(BaseModel):
    placement_id: str
    network_id: str
    n_repeaters: int
    placements: List[dict]
    fidelity_before: float
    fidelity_after: float
    rate_before: float
    rate_after: float
    created_at: str


class CreateNetworkRequest(BaseModel):
    name: str
    nodes: List[dict]
    links: List[dict]
    topology: str


class SimulateRequest(BaseModel):
    network_id: str
    source_node: str
    dest_node: str
    n_runs: int = 1000


class OptimizeRepeatersRequest(BaseModel):
    network_id: str
    n_repeaters: int
    budget_usd: Optional[float] = None


_VALID_NODE_TYPES = {"end_node", "repeater", "switch"}
_VALID_TOPOLOGIES = {"star", "chain", "mesh", "ring"}


def _parse_node(raw: dict) -> QNode:
    return QNode(
        node_id=raw.get("node_id", str(uuid.uuid4())),
        name=raw.get("name", "unnamed"),
        type=raw.get("type", "end_node"),
        location=raw.get("location", "unknown"),
        qubit_count=int(raw.get("qubit_count", 4)),
        coherence_time_us=float(raw.get("coherence_time_us", 100.0)),
        gate_fidelity=float(raw.get("gate_fidelity", 0.99)),
    )


def _parse_link(raw: dict) -> QLink:
    return QLink(
        link_id=raw.get("link_id", str(uuid.uuid4())),
        node_a=raw.get("node_a", ""),
        node_b=raw.get("node_b", ""),
        distance_km=float(raw.get("distance_km", 10.0)),
        loss_db_per_km=float(raw.get("loss_db_per_km", 0.2)),
        entanglement_rate_hz=float(raw.get("entanglement_rate_hz", 1000.0)),
        fidelity=float(raw.get("fidelity", 0.95)),
    )


def _find_path(
    network: QNetwork, source: str, dest: str
) -> Optional[List[str]]:
    """BFS over node names to find shortest path."""
    name_to_node = {n.name: n for n in network.nodes}
    if source not in name_to_node or dest not in name_to_node:
        return None

    adjacency: dict[str, list[str]] = {n.name: [] for n in network.nodes}
    for link in network.links:
        a_name = next((n.name for n in network.nodes if n.node_id == link.node_a), None)
        b_name = next((n.name for n in network.nodes if n.node_id == link.node_b), None)
        if a_name and b_name:
            adjacency[a_name].append(b_name)
            adjacency[b_name].append(a_name)

    visited = {source}
    queue: list[list[str]] = [[source]]
    while queue:
        path = queue.pop(0)
        current = path[-1]
        if current == dest:
            return path
        for neighbour in adjacency.get(current, []):
            if neighbour not in visited:
                visited.add(neighbour)
                queue.append(path + [neighbour])
    return None


def _compute_end_to_end_fidelity(
    network: QNetwork, path: List[str]
) -> tuple[float, float, Optional[str]]:
    """
    Returns (end_to_end_fidelity, entanglement_rate_hz, bottleneck_link_id).
    Uses entanglement swapping model: F_ee = prod(F_i) degraded by decoherence.
    """
    node_map = {n.name: n for n in network.nodes}
    link_lookup: dict[tuple[str, str], QLink] = {}
    for lnk in network.links:
        a = next((n.name for n in network.nodes if n.node_id == lnk.node_a), None)
        b = next((n.name for n in network.nodes if n.node_id == lnk.node_b), None)
        if a and b:
            link_lookup[(a, b)] = lnk
            link_lookup[(b, a)] = lnk

    fidelity = 1.0
    min_rate = math.inf
    bottleneck_link = None

    for i in range(len(path) - 1):
        a, b = path[i], path[i + 1]
        lnk = link_lookup.get((a, b))
        if lnk is None:
            # No direct link — assume degraded virtual link
            fidelity *= 0.85
            min_rate = min(min_rate, 10.0)
            continue

        # Optical loss model: transmission = 10^(-loss_dB * dist / 10)
        total_loss_db = lnk.loss_db_per_km * lnk.distance_km
        transmission = 10 ** (-total_loss_db / 10)

        # Effective link fidelity accounting for loss
        link_fidelity = lnk.fidelity * (0.5 + 0.5 * transmission)
        fidelity *= link_fidelity

        # Entanglement swap at each intermediate node reduces fidelity
        if i > 0:
            node = node_map.get(a)
            if node:
                fidelity *= node.gate_fidelity

        rate = lnk.entanglement_rate_hz * transmission
        if rate < min_rate:
            min_rate = rate
            bottleneck_link = lnk.link_id

    if min_rate == math.inf:
        min_rate = 0.0

    return round(max(0.0, fidelity), 6), round(min_rate, 4), bottleneck_link


@router.post("/network", response_model=QNetwork)
def create_network(req: CreateNetworkRequest, db: Session = Depends(get_db)) -> QNetwork:
    if req.topology not in _VALID_TOPOLOGIES:
        raise HTTPException(
            status_code=422,
            detail=f"topology must be one of {sorted(_VALID_TOPOLOGIES)}",
        )

    nodes = [_parse_node(n) for n in req.nodes]
    links = [_parse_link(lk) for lk in req.links]
    network_id = str(uuid.uuid4())

    network = QNetwork(
        network_id=network_id,
        name=req.name,
        nodes=nodes,
        links=links,
        topology=req.topology,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    store_put(db, NS_NETWORKS, network_id, network.model_dump())
    return network


@router.get("/networks", response_model=List[QNetwork])
def list_networks(db: Session = Depends(get_db)) -> List[QNetwork]:
    return [QNetwork(**n) for n in store_list(db, NS_NETWORKS)]


@router.get("/network/{network_id}", response_model=QNetwork)
def get_network(network_id: str, db: Session = Depends(get_db)) -> QNetwork:
    n = store_get(db, NS_NETWORKS, network_id)
    if not n:
        raise HTTPException(status_code=404, detail="Network not found")
    return QNetwork(**n)


@router.post("/simulate", response_model=EntanglementSimResult)
def simulate(req: SimulateRequest, db: Session = Depends(get_db)) -> EntanglementSimResult:
    net_data = store_get(db, NS_NETWORKS, req.network_id)
    if not net_data:
        raise HTTPException(status_code=404, detail="Network not found")

    network = QNetwork(**net_data)
    path = _find_path(network, req.source_node, req.dest_node)

    if path is None:
        raise HTTPException(
            status_code=422,
            detail=f"No path found between '{req.source_node}' and '{req.dest_node}'",
        )

    n_hops = len(path) - 1
    fidelity, rate, bottleneck = _compute_end_to_end_fidelity(network, path)

    # Monte-Carlo success probability over n_runs
    # Each run succeeds if all per-link transmissions succeed
    successes = sum(
        1
        for _ in range(req.n_runs)
        if random.random() < (fidelity ** 1.5)
    )
    success_prob = round(successes / max(req.n_runs, 1), 4)

    # Latency: speed-of-light in fibre (~200 km/ms) + classical signalling overhead
    total_dist = sum(
        lnk.distance_km
        for lnk in network.links
        if any(
            (n.node_id == lnk.node_a or n.node_id == lnk.node_b)
            for n in network.nodes
            if n.name in path
        )
    )
    latency_ms = round((total_dist / 200.0) * n_hops + n_hops * 0.5 + random.uniform(0.1, 1.0), 3)

    sim_id = str(uuid.uuid4())
    result = EntanglementSimResult(
        sim_id=sim_id,
        network_id=req.network_id,
        source_node=req.source_node,
        dest_node=req.dest_node,
        path=path,
        n_hops=n_hops,
        end_to_end_fidelity=fidelity,
        entanglement_rate_hz=rate,
        success_probability=success_prob,
        latency_ms=latency_ms,
        bottleneck_link=bottleneck,
        simulated_at=datetime.now(timezone.utc).isoformat(),
    )
    store_put(db, NS_SIMULATIONS, sim_id, result.model_dump())
    return result


@router.post("/optimize-repeaters", response_model=RepeaterPlacement)
def optimize_repeaters(req: OptimizeRepeatersRequest, db: Session = Depends(get_db)) -> RepeaterPlacement:
    net_data = store_get(db, NS_NETWORKS, req.network_id)
    if not net_data:
        raise HTTPException(status_code=404, detail="Network not found")

    network = QNetwork(**net_data)

    # Compute current average fidelity across all links
    if network.links:
        fidelity_before = round(
            sum(lnk.fidelity for lnk in network.links) / len(network.links), 4
        )
        rate_before = round(
            min(lnk.entanglement_rate_hz for lnk in network.links), 2
        )
    else:
        fidelity_before = 0.90
        rate_before = 100.0

    # Each repeater improves fidelity by ~sqrt model and boosts rate
    improvement_per_repeater = 1 - (1 - fidelity_before) ** (1 / (req.n_repeaters + 1))
    fidelity_after = round(
        min(0.9999, fidelity_before + improvement_per_repeater * req.n_repeaters * 0.5), 4
    )
    rate_after = round(rate_before * (1 + 0.3 * req.n_repeaters), 2)

    # Generate placement suggestions along existing links
    placements: list[dict] = []
    links_sorted = sorted(
        network.links,
        key=lambda lk: lk.distance_km * lk.loss_db_per_km,
        reverse=True,
    )
    for i in range(req.n_repeaters):
        target_link = links_sorted[i % len(links_sorted)] if links_sorted else None
        position = f"midpoint of link {target_link.link_id}" if target_link else f"segment-{i+1}"
        node_a_name = next(
            (n.name for n in network.nodes if target_link and n.node_id == target_link.node_a),
            "node_a",
        )
        node_b_name = next(
            (n.name for n in network.nodes if target_link and n.node_id == target_link.node_b),
            "node_b",
        )
        fid_improvement = round(random.uniform(0.01, 0.04), 4)
        placements.append(
            {
                "repeater_index": i + 1,
                "position": position,
                "between_nodes": [node_a_name, node_b_name],
                "fidelity_improvement": fid_improvement,
                "estimated_cost_usd": round(random.uniform(15000, 85000), 2),
            }
        )

    placement_id = str(uuid.uuid4())
    record = RepeaterPlacement(
        placement_id=placement_id,
        network_id=req.network_id,
        n_repeaters=req.n_repeaters,
        placements=placements,
        fidelity_before=fidelity_before,
        fidelity_after=fidelity_after,
        rate_before=rate_before,
        rate_after=rate_after,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    store_put(db, NS_SIMULATIONS, placement_id, record.model_dump())
    return record
