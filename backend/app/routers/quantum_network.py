"""Quantum Network Simulator — model repeater chains, star, mesh, and ring topologies.

Simulates end-to-end entanglement distribution with realistic fidelity degradation:
  - Optical transmission loss (exponential with distance, 22 km attenuation length)
  - Entanglement swapping at each repeater (fidelity squared × gate fidelity)
  - Memory decoherence during classical communication wait
  - BB84 secret key rate from end-to-end fidelity
"""
from __future__ import annotations
import math, random, uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/quantum-network", tags=["quantum_network"])

ATTENUATION_LENGTH_KM = 22.0   # standard SMF at 1550 nm
FIDELITY_THRESHOLD    = 2/3    # below this, QKD impossible

TOPOLOGIES = {
    "linear": "Repeater chain — nodes connected in a line, entanglement swapped end-to-end",
    "star":   "Hub-and-spoke — central node entangled with all leaf nodes",
    "mesh":   "Fully-connected — every pair of nodes shares a direct entangled link",
    "ring":   "Ring network — nodes connected in a closed loop",
}


class NetworkRequest(BaseModel):
    topology: str = Field(default="linear", description="linear | star | mesh | ring")
    n_nodes: int = Field(default=5, ge=2, le=20)
    link_fidelity: float = Field(default=0.95, ge=0.5, le=1.0)
    memory_coherence_time_ms: float = Field(default=100.0, gt=0)
    gate_fidelity: float = Field(default=0.99, ge=0.8, le=1.0)
    entanglement_rate_hz: float = Field(default=1000.0, gt=0)
    distance_km: float = Field(default=50.0, gt=0)
    seed: Optional[int] = None


def _optical_fidelity(link_fidelity: float, dist_km: float) -> float:
    """F_link = link_fidelity × exp(-dist / L_att)"""
    return link_fidelity * math.exp(-dist_km / ATTENUATION_LENGTH_KM)


def _swap_fidelity(f_in: float, gate_fidelity: float) -> float:
    """Fidelity after entanglement swapping: F_swap = F_in² × gate_fidelity"""
    return f_in * f_in * gate_fidelity


def _memory_fidelity(f_in: float, t_wait_ms: float, coherence_ms: float) -> float:
    """F_mem = F_in × exp(-t_wait / T_coherence)"""
    return f_in * math.exp(-t_wait_ms / coherence_ms)


def _bb84_key_rate(fidelity: float, raw_rate_hz: float) -> float:
    """Asymptotic BB84 key rate: R_key = R_raw × max(0, 1 - 2*h(e))
    where error rate e = (1 - F)/2 and h is binary entropy."""
    if fidelity <= FIDELITY_THRESHOLD:
        return 0.0
    e = (1 - fidelity) / 2.0
    if e <= 0 or e >= 0.5:
        return max(0.0, raw_rate_hz * fidelity)
    h_e = -e * math.log2(e) - (1 - e) * math.log2(1 - e)
    return max(0.0, raw_rate_hz * (1 - 2 * h_e))


def _simulate_linear(req: NetworkRequest, rng: random.Random) -> Dict[str, Any]:
    n = req.n_nodes
    n_links = n - 1
    per_link_dist = req.distance_km / n_links

    # Build per-link optical fidelities
    link_fidelities_optical = []
    for i in range(n_links):
        noise = 1.0 + rng.gauss(0, 0.005)
        f_opt = _optical_fidelity(req.link_fidelity * noise, per_link_dist)
        link_fidelities_optical.append(min(f_opt, 1.0))

    # Classical round-trip time for heralding = distance/c_fiber
    c_fiber_km_per_ms = 200.0   # ~200 km/ms in fiber
    t_classical_ms = (per_link_dist / c_fiber_km_per_ms) * 2  # round trip

    # Entanglement generation time per link
    t_gen_ms = 1000.0 / req.entanglement_rate_hz

    # Each repeater must wait for both neighbors to signal success
    t_wait_ms = t_classical_ms + t_gen_ms

    # Propagate fidelity hop by hop
    fidelity_per_hop: List[float] = []
    f_current = link_fidelities_optical[0]
    fidelity_per_hop.append(round(f_current, 6))

    for i in range(1, n_links):
        f_next_link = link_fidelities_optical[i]
        # Swap: combine current end-to-end with next link
        f_swapped = _swap_fidelity(f_current, req.gate_fidelity) * f_next_link
        # Memory decoherence during wait
        f_current = _memory_fidelity(f_swapped, t_wait_ms, req.memory_coherence_time_ms)
        fidelity_per_hop.append(round(f_current, 6))

    end_to_end_fidelity = f_current

    # Total entanglement generation time for chain
    t_entanglement_ms = t_gen_ms * n_links + t_wait_ms * (n_links - 1)

    # Raw rate derated by chain overhead
    repeater_overhead = n_links
    raw_rate_effective = req.entanglement_rate_hz / repeater_overhead

    skr = _bb84_key_rate(end_to_end_fidelity, raw_rate_effective)

    # Nodes
    nodes = []
    for i in range(n):
        role = "end_node" if i in (0, n - 1) else "repeater"
        nodes.append({
            "node_id": f"node_{i}",
            "role": role,
            "position_km": round(i * per_link_dist, 3),
            "has_memory": True,
            "memory_time_ms": req.memory_coherence_time_ms,
        })

    # Links
    links = []
    for i in range(n_links):
        links.append({
            "from_node": f"node_{i}",
            "to_node": f"node_{i+1}",
            "distance_km": round(per_link_dist, 3),
            "optical_fidelity": round(link_fidelities_optical[i], 6),
        })

    # Bottleneck = link with lowest optical fidelity
    bottleneck_idx = link_fidelities_optical.index(min(link_fidelities_optical))
    bottleneck_link = f"node_{bottleneck_idx} → node_{bottleneck_idx+1}"

    # Suggestions
    suggestions = []
    if end_to_end_fidelity < FIDELITY_THRESHOLD:
        suggestions.append("End-to-end fidelity below QKD threshold (2/3). Add more repeater nodes or use entanglement purification.")
    if req.memory_coherence_time_ms < t_wait_ms * 2:
        suggestions.append(f"Memory coherence time ({req.memory_coherence_time_ms:.1f} ms) is close to wait time ({t_wait_ms:.1f} ms). Improve quantum memories.")
    if req.gate_fidelity < 0.995:
        suggestions.append("Gate fidelity < 99.5%. Higher-fidelity BSM operations would improve end-to-end fidelity significantly.")
    if skr == 0:
        suggestions.append("Secret key rate is zero — fidelity too low for secure QKD. Consider purification protocols.")
    if not suggestions:
        suggestions.append("Network parameters are well-optimised for long-distance QKD.")

    return {
        "n_links": n_links,
        "per_link_distance_km": round(per_link_dist, 3),
        "link_fidelity_optical": round(link_fidelities_optical[0], 6),
        "end_to_end_fidelity": round(end_to_end_fidelity, 6),
        "end_to_end_fidelity_above_threshold": end_to_end_fidelity > FIDELITY_THRESHOLD,
        "fidelity_per_hop": fidelity_per_hop,
        "entanglement_generation_time_ms": round(t_entanglement_ms, 3),
        "memory_wait_time_ms": round(t_wait_ms, 3),
        "secret_key_rate_bits_per_sec": round(skr, 4),
        "raw_entanglement_rate_hz": round(raw_rate_effective, 4),
        "repeater_overhead_factor": repeater_overhead,
        "classical_communication_time_ms": round(t_classical_ms, 4),
        "nodes": nodes,
        "links": links,
        "bottleneck_link": bottleneck_link,
        "improvement_suggestions": suggestions,
    }


def _simulate_star(req: NetworkRequest, rng: random.Random) -> Dict[str, Any]:
    n = req.n_nodes
    n_links = n - 1  # hub to each leaf
    hub_to_leaf_dist = req.distance_km  # all leaves at same distance from hub

    f_opt = _optical_fidelity(req.link_fidelity, hub_to_leaf_dist)
    c_fiber_km_per_ms = 200.0
    t_classical_ms = (hub_to_leaf_dist / c_fiber_km_per_ms) * 2
    t_gen_ms = 1000.0 / req.entanglement_rate_hz
    t_wait_ms = t_classical_ms + t_gen_ms

    # For star: hub swaps between two leaves → 2-hop path
    f_leaf_leaf = _swap_fidelity(f_opt, req.gate_fidelity) * f_opt
    f_leaf_leaf = _memory_fidelity(f_leaf_leaf, t_wait_ms, req.memory_coherence_time_ms)

    nodes = [{"node_id": "hub", "role": "hub", "position_km": 0.0,
              "has_memory": True, "memory_time_ms": req.memory_coherence_time_ms}]
    links = []
    for i in range(n_links):
        nodes.append({"node_id": f"leaf_{i}", "role": "end_node",
                      "position_km": round(hub_to_leaf_dist, 3),
                      "has_memory": False, "memory_time_ms": 0.0})
        links.append({"from_node": "hub", "to_node": f"leaf_{i}",
                      "distance_km": round(hub_to_leaf_dist, 3),
                      "optical_fidelity": round(f_opt, 6)})

    skr = _bb84_key_rate(f_leaf_leaf, req.entanglement_rate_hz / 2)
    suggestions = []
    if f_leaf_leaf < FIDELITY_THRESHOLD:
        suggestions.append("Leaf-to-leaf fidelity below QKD threshold. Reduce hub-to-leaf distance or improve gate fidelity.")
    else:
        suggestions.append("Star topology is well-suited for hub-centric quantum networks.")

    return {
        "n_links": n_links,
        "per_link_distance_km": round(hub_to_leaf_dist, 3),
        "link_fidelity_optical": round(f_opt, 6),
        "end_to_end_fidelity": round(f_leaf_leaf, 6),
        "end_to_end_fidelity_above_threshold": f_leaf_leaf > FIDELITY_THRESHOLD,
        "fidelity_per_hop": [round(f_opt, 6), round(f_leaf_leaf, 6)],
        "entanglement_generation_time_ms": round(t_gen_ms * 2 + t_wait_ms, 3),
        "memory_wait_time_ms": round(t_wait_ms, 3),
        "secret_key_rate_bits_per_sec": round(skr, 4),
        "raw_entanglement_rate_hz": round(req.entanglement_rate_hz / 2, 4),
        "repeater_overhead_factor": 2,
        "classical_communication_time_ms": round(t_classical_ms, 4),
        "nodes": nodes,
        "links": links,
        "bottleneck_link": "hub → leaf_0 (all links identical)",
        "improvement_suggestions": suggestions,
    }


def _simulate_mesh(req: NetworkRequest, rng: random.Random) -> Dict[str, Any]:
    n = req.n_nodes
    n_links = n * (n - 1) // 2
    # Average pairwise distance in a mesh of n nodes in a circle of diameter d
    avg_dist = req.distance_km / math.sqrt(n)

    f_opt = _optical_fidelity(req.link_fidelity, avg_dist)
    t_gen_ms = 1000.0 / req.entanglement_rate_hz
    c_fiber_km_per_ms = 200.0
    t_classical_ms = (avg_dist / c_fiber_km_per_ms) * 2
    t_wait_ms = t_classical_ms + t_gen_ms

    # Mesh: direct links, no swapping needed for nearest neighbour
    end_to_end = _memory_fidelity(f_opt, t_wait_ms, req.memory_coherence_time_ms)
    skr = _bb84_key_rate(end_to_end, req.entanglement_rate_hz)

    nodes = []
    links = []
    for i in range(n):
        angle = 2 * math.pi * i / n
        pos = round(req.distance_km / 2 * (1 + math.cos(angle)), 3)
        nodes.append({"node_id": f"node_{i}", "role": "end_node",
                      "position_km": pos, "has_memory": True,
                      "memory_time_ms": req.memory_coherence_time_ms})
    for i in range(n):
        for j in range(i + 1, n):
            links.append({"from_node": f"node_{i}", "to_node": f"node_{j}",
                          "distance_km": round(avg_dist, 3),
                          "optical_fidelity": round(f_opt, 6)})

    suggestions = ["Mesh topology maximises connectivity but has O(n²) link cost.",
                   "Suitable for small networks (n ≤ 6) where full connectivity is needed."]

    return {
        "n_links": n_links,
        "per_link_distance_km": round(avg_dist, 3),
        "link_fidelity_optical": round(f_opt, 6),
        "end_to_end_fidelity": round(end_to_end, 6),
        "end_to_end_fidelity_above_threshold": end_to_end > FIDELITY_THRESHOLD,
        "fidelity_per_hop": [round(end_to_end, 6)],
        "entanglement_generation_time_ms": round(t_gen_ms, 3),
        "memory_wait_time_ms": round(t_wait_ms, 3),
        "secret_key_rate_bits_per_sec": round(skr, 4),
        "raw_entanglement_rate_hz": round(req.entanglement_rate_hz, 4),
        "repeater_overhead_factor": 1,
        "classical_communication_time_ms": round(t_classical_ms, 4),
        "nodes": nodes,
        "links": links[:20],   # cap to avoid huge payloads
        "bottleneck_link": "all links equivalent",
        "improvement_suggestions": suggestions,
    }


def _simulate_ring(req: NetworkRequest, rng: random.Random) -> Dict[str, Any]:
    n = req.n_nodes
    n_links = n
    per_link_dist = req.distance_km / n

    f_opt = _optical_fidelity(req.link_fidelity, per_link_dist)
    c_fiber_km_per_ms = 200.0
    t_classical_ms = (per_link_dist / c_fiber_km_per_ms) * 2
    t_gen_ms = 1000.0 / req.entanglement_rate_hz
    t_wait_ms = t_classical_ms + t_gen_ms

    # Worst case: opposite side of ring = n/2 hops
    n_hops = n // 2
    f_current = f_opt
    fidelity_per_hop = [round(f_current, 6)]
    for _ in range(n_hops - 1):
        f_current = _swap_fidelity(f_current, req.gate_fidelity) * f_opt
        f_current = _memory_fidelity(f_current, t_wait_ms, req.memory_coherence_time_ms)
        fidelity_per_hop.append(round(f_current, 6))

    end_to_end = f_current
    skr = _bb84_key_rate(end_to_end, req.entanglement_rate_hz / n_hops)

    nodes = []
    links = []
    for i in range(n):
        angle = 2 * math.pi * i / n
        pos = round(req.distance_km / (2 * math.pi) * angle, 3)
        nodes.append({"node_id": f"node_{i}", "role": "end_node",
                      "position_km": pos, "has_memory": True,
                      "memory_time_ms": req.memory_coherence_time_ms})
    for i in range(n):
        links.append({"from_node": f"node_{i}", "to_node": f"node_{(i+1) % n}",
                      "distance_km": round(per_link_dist, 3),
                      "optical_fidelity": round(f_opt, 6)})

    suggestions = ["Ring topology offers path redundancy (two routes between any pair).",
                   "For worst-case (diametrically opposite) nodes, consider shortest path routing."]

    return {
        "n_links": n_links,
        "per_link_distance_km": round(per_link_dist, 3),
        "link_fidelity_optical": round(f_opt, 6),
        "end_to_end_fidelity": round(end_to_end, 6),
        "end_to_end_fidelity_above_threshold": end_to_end > FIDELITY_THRESHOLD,
        "fidelity_per_hop": fidelity_per_hop,
        "entanglement_generation_time_ms": round(t_gen_ms * n_hops + t_wait_ms * (n_hops - 1), 3),
        "memory_wait_time_ms": round(t_wait_ms, 3),
        "secret_key_rate_bits_per_sec": round(skr, 4),
        "raw_entanglement_rate_hz": round(req.entanglement_rate_hz / n_hops, 4),
        "repeater_overhead_factor": n_hops,
        "classical_communication_time_ms": round(t_classical_ms, 4),
        "nodes": nodes,
        "links": links,
        "bottleneck_link": f"node_0 → node_1 (worst-case path: {n_hops} hops)",
        "improvement_suggestions": suggestions,
    }


_SIMULATORS = {
    "linear": _simulate_linear,
    "star": _simulate_star,
    "mesh": _simulate_mesh,
    "ring": _simulate_ring,
}


@router.post("")
def simulate_network(req: NetworkRequest):
    rng = random.Random(req.seed)
    topology = req.topology if req.topology in _SIMULATORS else "linear"
    result = _SIMULATORS[topology](req, rng)

    return {
        "network_id": str(uuid.uuid4()),
        "topology": topology,
        "n_nodes": req.n_nodes,
        "total_distance_km": req.distance_km,
        **result,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/topologies")
def list_topologies():
    return {
        "topologies": [
            {"name": k, "description": v} for k, v in TOPOLOGIES.items()
        ]
    }
