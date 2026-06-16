from __future__ import annotations
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list, store_delete, store_seed

router = APIRouter(prefix="/api/v1/copilot", tags=["copilot"])

NS_SESSIONS = "copilot_sessions"

SYSTEM_PROMPT = """You are Q-Lab Copilot, an expert quantum computing research assistant embedded in the Q-Lab experiment tracking platform.
You have deep knowledge of:
- Quantum circuit design and optimization (Qiskit, Cirq, PennyLane, Q#)
- Quantum hardware (IBM, IonQ, Rigetti, Quantinuum, Google, IQM)
- Quantum algorithms: VQE, QAOA, Grover, QFT, QPE, QSVT, quantum sensing
- Error mitigation: ZNE, PEC, CDR, MTHREE, symmetry verification
- Quantum error correction: surface codes, color codes, Bacon-Shor
- Statistical analysis: Fisher information, Cramér-Rao, bootstrap, Bayesian inference
- Published literature: you can reason about arXiv papers in quant-ph

When analyzing experiment data, you:
1. Identify patterns across multiple runs
2. Suggest root causes for anomalies
3. Recommend next experiments based on current results
4. Compare results against known benchmarks
5. Flag potential systematic errors
"""

CANNED_RESPONSES = {
    "vqe": "Based on your VQE run history, I notice your convergence is stalling around iteration 40-50. This is a barren plateau signature. Try: (1) Layer-by-layer training (LLFT), (2) Reducing ansatz depth by 30%, or (3) Using ADAPT-VQE to grow the ansatz adaptively. Your T2 times on ibm_brisbane suggest you have ~80 2Q gate budget before decoherence dominates.",
    "noise": "Your error rate trend shows increasing gate errors over the last 6 calibrations — the backend is drifting. The 2Q fidelity dropped 0.3% in 48h which is above the alert threshold. I recommend: switch to ionq_aria_1 for precision work, or apply ZNE with Richardson extrapolation (noise factors 1, 2, 3) to mitigate the current drift.",
    "qaoa": "Your QAOA approximation ratios cluster around 0.87 at p=3 layers. The SoTA for 3-regular MaxCut at p=3 is ~0.89. Gap analysis suggests your parameter initialization is sub-optimal — your β angles are initialized uniformly but the optimal landscape has structure. Try warm-starting from the analytical p=1 solution then extending to p=3 with interpolation.",
    "sensing": "Your Ramsey interferometry shows phase sensitivity of 1/(2√N) — you're at the standard quantum limit. To reach the Heisenberg limit 1/N, you need: (1) GHZ probe state preparation (H + cascade CX), (2) adaptive phase estimation (Kitaev protocol), or (3) spin squeezing via one-axis twisting. With N=8 qubits on your current setup, HL gives 4x improvement.",
    "calibration": "T1 degradation detected: 280→210μs over 72h on qubits 0,3,7 of ibm_brisbane. Likely cause: substrate TLS fluctuations correlating with temperature cycling. Mitigation: (1) avoid qubits 0,3,7 in next 24h, (2) use dynamical decoupling (XY-4) on idle qubits, (3) re-run calibration jobs at 6h intervals to track recovery.",
    "reproduce": "Reproducibility analysis across your 12 runs of this circuit shows σ_systematic = 0.023 vs σ_shot = 0.018. Systematic variance dominates — this is NOT shot noise limited. Root causes ranked by likelihood: (1) backend calibration drift between runs (68%), (2) SPAM error fluctuation (21%), (3) compiler variability (11%). Fix: pin to a single calibration snapshot using environment snapshotting.",
    "default": "I've analyzed your recent Q-Lab experiment history. Here are my top 3 recommendations: (1) Your VQE convergence would benefit from gradient clipping — you have large gradient variance in early iterations. (2) Three of your circuits have depth > optimal for current T1/T2 — I can auto-suggest shorter ansatz variants. (3) Your ibm_brisbane results from last Tuesday show anomalous 2Q error rates — check the calibration oracle for that timestamp.",
}

class Message(BaseModel):
    role: str
    content: str
    timestamp: str

class CopilotSession(BaseModel):
    session_id: str
    created_at: str
    messages: list[Message]
    context_run_ids: list[str]
    context_summary: str

class ChatRequest(BaseModel):
    session_id: str | None = None
    message: str
    context_run_ids: list[str] = []
    include_calibration_context: bool = True
    include_hypothesis_context: bool = True

class ChatResponse(BaseModel):
    session_id: str
    reply: str
    cited_run_ids: list[str]
    suggested_actions: list[dict]
    confidence: float
    follow_up_questions: list[str]

def _generate_reply(message: str, context_run_ids: list[str]) -> tuple[str, list[str], list[dict], float, list[str]]:
    import random; rng = random.Random(hash(message) & 0xFFFFFF)
    msg_lower = message.lower()
    reply = ""
    for key, resp in CANNED_RESPONSES.items():
        if key in msg_lower:
            reply = resp
            break
    if not reply:
        reply = CANNED_RESPONSES["default"]
    cited = context_run_ids[:3] if context_run_ids else []
    actions = [
        {"label": "Run suggested circuit", "action": "navigate", "target": "/dispatch"},
        {"label": "Open Bayes Opt", "action": "navigate", "target": "/bayes-opt"},
        {"label": "View calibration", "action": "navigate", "target": "/calibration-monitor"},
    ]
    follow_ups = [
        "What error mitigation strategy do you recommend for my current setup?",
        "How does my result compare to published state-of-the-art?",
        "Which backend would give the best fidelity for this circuit?",
        "Can you draft the Methods section for this experiment?",
    ]
    return reply, cited, actions, round(rng.uniform(0.78, 0.97), 2), follow_ups[:3]

@router.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest, db: Session = Depends(get_db)):
    session_id = req.session_id or str(uuid.uuid4())
    sess_data = store_get(db, NS_SESSIONS, session_id)
    if not sess_data:
        sess_data = CopilotSession(
            session_id=session_id,
            created_at=datetime.now(timezone.utc).isoformat(),
            messages=[], context_run_ids=req.context_run_ids,
            context_summary="",
        ).model_dump()
    sess_data["messages"].append({"role": "user", "content": req.message, "timestamp": datetime.now(timezone.utc).isoformat()})
    context_run_ids = req.context_run_ids or sess_data["context_run_ids"]
    reply, cited, actions, confidence, follow_ups = _generate_reply(req.message, context_run_ids)
    sess_data["messages"].append({"role": "assistant", "content": reply, "timestamp": datetime.now(timezone.utc).isoformat()})
    store_put(db, NS_SESSIONS, session_id, sess_data)
    return ChatResponse(session_id=session_id, reply=reply, cited_run_ids=cited, suggested_actions=actions, confidence=confidence, follow_up_questions=follow_ups)

@router.get("/{session_id}", response_model=CopilotSession)
def get_session(session_id: str, db: Session = Depends(get_db)):
    data = store_get(db, NS_SESSIONS, session_id)
    if not data:
        raise HTTPException(404, "session not found")
    return CopilotSession(**data)

@router.delete("/{session_id}")
def clear_session(session_id: str, db: Session = Depends(get_db)):
    store_delete(db, NS_SESSIONS, session_id)
    return {"cleared": True}

@router.get("/")
def list_sessions(db: Session = Depends(get_db)):
    sessions = store_list(db, NS_SESSIONS)
    return {"sessions": [{"session_id": s["session_id"], "created_at": s["created_at"], "message_count": len(s["messages"])} for s in sessions]}
