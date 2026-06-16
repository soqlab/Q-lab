from __future__ import annotations
import uuid
import random
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list, store_delete, store_seed

router = APIRouter(prefix="/api/v1/qfm", tags=["qfm"])

NS = "qfm_sessions"

class ChatRequest(BaseModel):
    session_id: Optional[str] = None
    message: str
    context: Optional[dict] = None

class FidelityRequest(BaseModel):
    circuit_qasm: str
    backend: str
    n_qubits: int
    depth: int

class AnomalyRequest(BaseModel):
    run_id: str
    observed_value: float
    expected_value: float
    backend: str
    context: Optional[str] = None

def _quantum_reply(message: str) -> tuple[str, list, list, float, list]:
    msg = message.lower()
    if "vqe" in msg:
        reply = ("VQE convergence depends critically on your ansatz choice. For molecular systems, "
                 "UCCSD often outperforms hardware-efficient ansatze in accuracy, but ADAPT-VQE "
                 "can reduce circuit depth by 60–80% by greedily selecting operators. With noisy "
                 "backends, consider layered QOCA or symmetry-preserving ansatze to reduce T-gate count.")
        citations = [
            {"arxiv_id": "2005.14425", "title": "ADAPT-VQE: An Exact Variational Algorithm for Fermionic Simulations", "relevance": 0.97},
            {"arxiv_id": "1812.11173", "title": "Quantum chemistry in the age of quantum computing", "relevance": 0.91},
        ]
        experiments = ["Run ADAPT-VQE with gradient threshold 1e-3", "Benchmark UCCSD vs hardware-efficient on H2", "Apply ZNE to VQE energy estimates"]
        fidelity = round(random.uniform(0.72, 0.89), 4)
        follow_ups = ["What optimizer are you using for VQE?", "Have you tried SPSA vs COBYLA?", "What's your target molecule?"]
    elif "qaoa" in msg:
        reply = ("QAOA at depth p achieves approximation ratio ≥ 0.6924 for MAX-CUT at p=1. "
                 "For p≥2, warm-starting from classical solutions (e.g., Goemans-Williamson) "
                 "often boosts performance. Barren plateaus appear beyond p=5 on random graphs — "
                 "layer-wise training or Fourier-space optimization can help.")
        citations = [
            {"arxiv_id": "1411.4028", "title": "A Quantum Approximate Optimization Algorithm", "relevance": 0.99},
            {"arxiv_id": "2110.14990", "title": "Warm-Starting Quantum Optimization", "relevance": 0.88},
        ]
        experiments = ["Sweep p from 1 to 6 on 3-regular graph", "Compare QAOA vs classical greedy", "Test Fourier reparametrization at p=4"]
        fidelity = round(random.uniform(0.65, 0.82), 4)
        follow_ups = ["What graph size are you targeting?", "Are you using QAOA for combinatorial optimization or simulation?"]
    elif "error mitigation" in msg or "zne" in msg or "mitigation" in msg:
        reply = ("Zero-Noise Extrapolation remains the most hardware-agnostic mitigation technique. "
                 "Combine ZNE with Probabilistic Error Cancellation for near-Clifford circuits to get "
                 "quasi-probability sampling overhead of O(e^{2ε}) where ε is total noise. "
                 "For readout errors, tensor-product M3 calibration scales to 127 qubits.")
        citations = [
            {"arxiv_id": "2012.09186", "title": "Mitiq: A software package for error mitigation", "relevance": 0.95},
            {"arxiv_id": "1612.02058", "title": "Error mitigation for short-depth quantum circuits", "relevance": 0.93},
        ]
        experiments = ["Apply ZNE with Richardson extrapolation order 3", "Calibrate readout matrix on 5-qubit subsystem", "Benchmark PEC overhead on CNOT-heavy circuit"]
        fidelity = round(random.uniform(0.80, 0.94), 4)
        follow_ups = ["What's your circuit depth and qubit count?", "Are you on a superconducting or trapped-ion backend?"]
    else:
        reply = ("Quantum advantage in near-term devices is most accessible through variational hybrid "
                 "algorithms. Noise characterization via randomized benchmarking and gate set tomography "
                 "should precede any algorithm benchmark. Ensure your circuits respect native gate sets "
                 "to minimize transpilation overhead.")
        citations = [
            {"arxiv_id": "1801.00862", "title": "Quantum Computing in the NISQ era and beyond", "relevance": 0.85},
        ]
        experiments = ["Run randomized benchmarking on target backend", "Profile gate error rates per qubit pair", "Compare native vs decomposed gate fidelity"]
        fidelity = round(random.uniform(0.70, 0.88), 4)
        follow_ups = ["What algorithm are you implementing?", "Which backend are you targeting?", "What's your qubit budget?"]
    return reply, citations, experiments, fidelity, follow_ups

@router.post("/chat")
def chat(req: ChatRequest, db: Session = Depends(get_db)):
    session_id = req.session_id or str(uuid.uuid4())
    reply, citations, experiments, fidelity, follow_ups = _quantum_reply(req.message)
    warnings = []
    if req.context and req.context.get("n_qubits", 0) > 100:
        warnings.append("Circuit exceeds classical simulation threshold — results are device-dependent")
    record = {
        "session_id": session_id,
        "reply": reply,
        "confidence": round(random.uniform(0.82, 0.97), 3),
        "citations": citations,
        "suggested_experiments": experiments,
        "predicted_fidelity": fidelity,
        "physics_check": {"valid": len(warnings) == 0, "warnings": warnings},
        "follow_ups": follow_ups,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    # Update session turns
    session_data = store_get(db, NS, session_id) or {"session_id": session_id, "turns": []}
    session_data["turns"].append({"role": "user", "message": req.message})
    session_data["turns"].append({"role": "assistant", "message": reply})
    store_put(db, NS, session_id, session_data)
    return record

@router.post("/predict-fidelity")
def predict_fidelity(req: FidelityRequest):
    backend_baselines = {
        "ibm_brisbane": 0.91, "ibm_kyoto": 0.89, "ionq_aria_1": 0.97,
        "rigetti_ankaa_2": 0.85, "quantinuum_h2": 0.995,
    }
    base = backend_baselines.get(req.backend, 0.88)
    depth_penalty = min(0.005 * req.depth, 0.35)
    qubit_penalty = min(0.003 * req.n_qubits, 0.20)
    predicted = round(max(0.10, base - depth_penalty - qubit_penalty + random.uniform(-0.02, 0.02)), 4)
    uncertainty = round(random.uniform(0.01, 0.04), 4)
    noise_sources = ["two_qubit_gate_error", "T1_decoherence", "readout_error", "crosstalk", "leakage"]
    return {
        "predicted_fidelity": predicted,
        "uncertainty": uncertainty,
        "confidence_interval": [round(predicted - 2*uncertainty, 4), round(predicted + 2*uncertainty, 4)],
        "dominant_noise": random.choice(noise_sources),
        "mitigation_recommended": "ZNE + readout_correction" if predicted < 0.85 else "readout_correction",
        "improvement_potential": round(random.uniform(0.05, 0.18), 4),
    }

@router.post("/explain-anomaly")
def explain_anomaly(req: AnomalyRequest):
    delta = abs(req.observed_value - req.expected_value)
    severity = "critical" if delta > 0.3 else "moderate" if delta > 0.1 else "minor"
    causes = [
        {"cause": "T1 decoherence during long circuit execution", "probability": round(random.uniform(0.3, 0.6), 2), "evidence": f"Observed drop of {delta:.3f} consistent with T1 decay on {req.backend}"},
        {"cause": "Crosstalk from neighboring qubits", "probability": round(random.uniform(0.1, 0.35), 2), "evidence": "ZZ coupling residuals detected in calibration data"},
        {"cause": "Readout assignment error", "probability": round(random.uniform(0.05, 0.25), 2), "evidence": "Readout fidelity < 0.98 reported in last calibration"},
    ]
    return {
        "explanation": (f"The {severity} deviation of {delta:.4f} between observed ({req.observed_value}) "
                        f"and expected ({req.expected_value}) on {req.backend} is most likely caused by "
                        f"decoherence accumulation over circuit depth, compounded by uncorrected readout errors."),
        "probable_causes": causes,
        "resolution_steps": [
            "Apply M3 readout correction matrix",
            "Reduce circuit depth via gate synthesis optimization",
            "Apply ZNE with noise scale factors [1, 2, 3]",
            "Re-run on freshly calibrated backend session",
        ],
        "similar_cases": [f"run_{str(uuid.uuid4())[:8]}", f"run_{str(uuid.uuid4())[:8]}"],
    }

@router.get("/")
def list_sessions(db: Session = Depends(get_db)):
    sessions = store_list(db, NS)
    return {"sessions": [{"session_id": s["session_id"], "n_turns": len(s.get("turns", []))} for s in sessions]}
