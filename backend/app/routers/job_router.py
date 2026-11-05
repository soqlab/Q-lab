from __future__ import annotations
import re
from typing import Optional
from fastapi import APIRouter
from pydantic import BaseModel

from .. import pricing

router = APIRouter(prefix="/api/v1/jobs", tags=["job-router"])

# Backend catalogue — static calibration baselines. Prices come from the shared
# table (app/provider_prices.json) through each entry's price_key.
BACKENDS: dict[str, dict] = {
    "ibm_brisbane": {
        "provider": "ibm", "n_qubits": 127,
        "t1_us": 280, "t2_us": 150, "gate_error": 0.001, "readout_error": 0.015,
        "price_key": "ibm_payg", "queue_speed": "fast",
        "native_gates": ["cx", "id", "rz", "sx", "x"],
    },
    "ibm_kyoto": {
        "provider": "ibm", "n_qubits": 127,
        "t1_us": 260, "t2_us": 140, "gate_error": 0.0012, "readout_error": 0.018,
        "price_key": "ibm_payg", "queue_speed": "fast",
        "native_gates": ["cx", "id", "rz", "sx", "x"],
    },
    "ibm_sherbrooke": {
        "provider": "ibm", "n_qubits": 127,
        "t1_us": 300, "t2_us": 160, "gate_error": 0.0009, "readout_error": 0.012,
        "price_key": "ibm_payg", "queue_speed": "medium",
        "native_gates": ["cx", "id", "rz", "sx", "x"],
    },
    "ionq_aria_1": {
        "provider": "ionq", "n_qubits": 25,
        "t1_us": 10000, "t2_us": 5000, "gate_error": 0.0003, "readout_error": 0.005,
        "price_key": "azure_ionq_aria", "queue_speed": "slow",
        "native_gates": ["rx", "ry", "rz", "cnot"],
    },
    "ionq_forte_1": {
        "provider": "ionq", "n_qubits": 36,
        "t1_us": 12000, "t2_us": 6000, "gate_error": 0.0002, "readout_error": 0.004,
        "price_key": "braket_ionq_forte", "queue_speed": "slow",
        "native_gates": ["rx", "ry", "rz", "cnot"],
    },
    "rigetti_ankaa_2": {
        "provider": "rigetti", "n_qubits": 84,
        "t1_us": 180, "t2_us": 90, "gate_error": 0.002, "readout_error": 0.02,
        "price_key": "braket_rigetti_cepheus", "queue_speed": "medium",
        "native_gates": ["cz", "cnot", "h", "rx", "ry", "rz"],
    },
    "simulator": {
        "provider": "simulator", "n_qubits": 32,
        "t1_us": 99999, "t2_us": 99999, "gate_error": 0.0, "readout_error": 0.0,
        "price_key": "local_simulator", "queue_speed": "fast",
        "native_gates": ["h", "x", "y", "z", "cx", "rz", "rx", "ry", "measure"],
    },
}

QUEUE_SCORE = {"fast": 1.0, "medium": 0.65, "slow": 0.35}


class RouteRequest(BaseModel):
    qasm: str
    shots: int = 1024
    preference: str = "quality"  # quality | speed | cost | balanced


class BackendRecommendation(BaseModel):
    backend: str
    provider: str
    rank: int
    score: float
    estimated_fidelity: float
    estimated_cost_usd: float
    queue_speed: str
    pricing_source: str = ""
    pricing_verified: str = ""
    stale_warning: Optional[str] = None
    n_qubits: int
    reasoning: list[str]


class RouteResult(BaseModel):
    recommended_backend: str
    recommended_provider: str
    preference: str
    circuit_qubits: int
    circuit_depth: int
    circuit_gates: int
    rankings: list[BackendRecommendation]


def _parse_circuit(qasm: str) -> tuple[int, int, int]:
    """Return (n_qubits, depth_estimate, gate_count) from QASM text."""
    qreg = re.findall(r"qreg\s+\w+\[(\d+)\]", qasm)
    n_qubits = sum(int(q) for q in qreg) if qreg else 1

    gate_lines = [
        ln.strip() for ln in qasm.splitlines()
        if ln.strip()
        and not ln.strip().startswith("//")
        and not ln.strip().startswith("OPENQASM")
        and not ln.strip().startswith("include")
        and not ln.strip().startswith("qreg")
        and not ln.strip().startswith("creg")
        and ln.strip()
    ]
    gate_count = len(gate_lines)
    depth_estimate = max(1, gate_count // max(1, n_qubits))
    return n_qubits, depth_estimate, gate_count


def _score_backend(
    backend: str,
    cfg: dict,
    n_qubits: int,
    depth: int,
    shots: int,
    preference: str,
    two_q_gates: int = 0,
    one_q_gates: int = 0,
) -> tuple[float, float, float, list[str]]:
    """Return (score, fidelity, cost_usd, reasoning_list)."""
    reasoning: list[str] = []

    # Hard filter: not enough qubits
    if cfg["n_qubits"] < n_qubits:
        return -1.0, 0.0, 0.0, [f"Only {cfg['n_qubits']} qubits available, circuit needs {n_qubits}"]

    # Fidelity estimate: (1 - gate_error)^depth * (1 - readout_error)^n_qubits
    gate_fidelity = (1 - cfg["gate_error"]) ** depth
    readout_fidelity = (1 - cfg["readout_error"]) ** n_qubits
    fidelity = round(gate_fidelity * readout_fidelity, 4)

    cost = pricing.estimate_amount(
        cfg["price_key"], shots, depth=depth, qubits=n_qubits,
        one_q_gates=one_q_gates, two_q_gates=two_q_gates,
    )
    if cost is None:
        return -1.0, 0.0, 0.0, ["No public price"]
    cost_usd = round(cost, 6)
    queue = QUEUE_SCORE[cfg["queue_speed"]]

    # Normalised component scores (0–1)
    fidelity_score = fidelity
    cost_score = 1.0 - min(cost_usd / 100.0, 1.0)  # $100 or more scores 0
    speed_score = queue

    if fidelity > 0.95:
        reasoning.append(f"Excellent estimated fidelity ({fidelity:.1%})")
    elif fidelity > 0.85:
        reasoning.append(f"Good estimated fidelity ({fidelity:.1%})")
    else:
        reasoning.append(f"Moderate fidelity ({fidelity:.1%}) — noisy backend")

    if cost_usd == 0:
        reasoning.append("Free (simulator)")
    else:
        reasoning.append(f"Estimated cost ${cost_usd:.4f}")

    reasoning.append(f"Queue speed: {cfg['queue_speed']}")

    weights = {
        "quality":  (0.70, 0.15, 0.15),
        "speed":    (0.20, 0.20, 0.60),
        "cost":     (0.20, 0.60, 0.20),
        "balanced": (0.40, 0.30, 0.30),
    }.get(preference, (0.40, 0.30, 0.30))

    score = (
        weights[0] * fidelity_score +
        weights[1] * cost_score +
        weights[2] * speed_score
    )
    return round(score, 4), fidelity, cost_usd, reasoning


@router.post("/route", response_model=RouteResult)
def route_job(req: RouteRequest) -> RouteResult:
    """Analyse a circuit and return a ranked list of backends."""
    n_qubits, depth, gate_count = _parse_circuit(req.qasm)
    two_q = sum(
        1 for ln in req.qasm.splitlines()
        if ln.strip().split("(")[0].split(" ")[0].lower() in pricing.TWO_Q_GATES
    )
    one_q = max(0, gate_count - two_q)

    scored: list[tuple[str, float, float, float, list[str]]] = []
    for name, cfg in BACKENDS.items():
        score, fidelity, cost, reasoning = _score_backend(
            name, cfg, n_qubits, depth, req.shots, req.preference, two_q, one_q,
        )
        if score >= 0:
            scored.append((name, score, fidelity, cost, reasoning))

    scored.sort(key=lambda x: x[1], reverse=True)

    rankings = [
        BackendRecommendation(
            backend=name,
            provider=BACKENDS[name]["provider"],
            rank=i + 1,
            score=score,
            estimated_fidelity=fidelity,
            estimated_cost_usd=cost,
            queue_speed=BACKENDS[name]["queue_speed"],
            n_qubits=BACKENDS[name]["n_qubits"],
            reasoning=reasoning,
            pricing_source=pricing.PRICES[BACKENDS[name]["price_key"]]["source"],
            pricing_verified=pricing.PRICES[BACKENDS[name]["price_key"]]["verified_on"],
            stale_warning=pricing.provenance(BACKENDS[name]["price_key"])["stale_warning"],
        )
        for i, (name, score, fidelity, cost, reasoning) in enumerate(scored)
    ]

    best = rankings[0] if rankings else BackendRecommendation(
        backend="simulator", provider="simulator", rank=1, score=1.0,
        estimated_fidelity=1.0, estimated_cost_usd=0.0,
        queue_speed="fast", n_qubits=32, reasoning=["Fallback"],
    )

    return RouteResult(
        recommended_backend=best.backend,
        recommended_provider=best.provider,
        preference=req.preference,
        circuit_qubits=n_qubits,
        circuit_depth=depth,
        circuit_gates=gate_count,
        rankings=rankings,
    )
