from __future__ import annotations
import uuid, math
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list, store_delete, store_seed

router = APIRouter(prefix="/api/v1/challenges", tags=["challenges"])

NS_CHALLENGES = "challenges"
NS_SUBMISSIONS = "challenge_submissions"

SEED_CHALLENGES = [
    {
        "title": "QAOA MaxCut 50-Node Champion",
        "description": "Achieve the highest approximation ratio on MaxCut for the fixed 50-node 3-regular graph below. Submit your best ratio after circuit optimization.",
        "problem_type": "optimization", "metric": "approximation_ratio", "higher_is_better": True,
        "target_value": 0.90, "deadline": "2026-12-31T23:59:59Z", "difficulty": "hard",
        "prize": "Co-authorship on benchmark paper", "n_qubits_min": 50, "n_qubits_max": 60,
        "tags": ["qaoa","maxcut","optimization"], "status": "active", "participants": 47,
        "problem_instance": {"n_nodes": 50, "edge_count": 75, "graph_type": "random_3regular", "seed": 12345},
        "baseline_value": 0.878,
    },
    {
        "title": "VQE H₂O Chemical Accuracy Challenge",
        "description": "Compute the ground state energy of H₂O to within chemical accuracy (1.6 mHa) using the fewest circuit parameters. Bonus points for fewest 2Q gates.",
        "problem_type": "chemistry", "metric": "energy_error_mhartree", "higher_is_better": False,
        "target_value": 1.6, "deadline": "2026-09-30T23:59:59Z", "difficulty": "expert",
        "prize": "$500 AWS Braket credits", "n_qubits_min": 8, "n_qubits_max": 20,
        "tags": ["vqe","chemistry","h2o","molecular-simulation"], "status": "active", "participants": 23,
        "problem_instance": {"molecule": "H2O", "basis": "sto-3g", "fci_energy": -75.0123456},
        "baseline_value": 5.0,
    },
    {
        "title": "Fastest Grover Search (100-element database)",
        "description": "Find the marked element in a 100-item oracle database with highest success probability. Circuit depth is the tiebreaker.",
        "problem_type": "search", "metric": "success_probability", "higher_is_better": True,
        "target_value": 0.95, "deadline": "2026-08-01T23:59:59Z", "difficulty": "medium",
        "prize": "Q-Lab Pro subscription (1 year)", "n_qubits_min": 7, "n_qubits_max": 10,
        "tags": ["grover","search","amplitude-amplification"], "status": "active", "participants": 61,
        "problem_instance": {"n_items": 100, "n_marked": 1, "oracle_type": "phase_kickback"},
        "baseline_value": 0.75,
    },
    {
        "title": "Quantum Volume Record Attempt",
        "description": "Demonstrate the highest Quantum Volume on any available hardware backend. Submit your QV circuit results with full calibration data.",
        "problem_type": "benchmarking", "metric": "quantum_volume", "higher_is_better": True,
        "target_value": 4096, "deadline": "2026-12-31T23:59:59Z", "difficulty": "hard",
        "prize": "Recognition in Q-Lab Hall of Fame", "n_qubits_min": 1, "n_qubits_max": 500,
        "tags": ["quantum-volume","benchmarking","qv"], "status": "active", "participants": 15,
        "problem_instance": {"n_trials": 100, "confidence_threshold": 0.95},
        "baseline_value": 512,
    },
]

class Challenge(BaseModel):
    challenge_id: str
    title: str
    description: str
    problem_type: str
    metric: str
    higher_is_better: bool
    target_value: float
    baseline_value: float
    deadline: str
    difficulty: str
    prize: str
    n_qubits_min: int
    n_qubits_max: int
    tags: list[str]
    status: str
    participants: int
    problem_instance: dict
    created_at: str
    leader: str | None
    leader_value: float | None

class Submission(BaseModel):
    submission_id: str
    challenge_id: str
    value: float
    rank: int
    percentile: float
    submitted_at: str
    label: str
    n_qubits: int
    backend: str
    run_ids: list[str]
    notes: str
    verified: bool
    metadata: dict

class SubmitRequest(BaseModel):
    challenge_id: str
    value: float
    label: str = "My Submission"
    n_qubits: int = 1
    backend: str = ""
    run_ids: list[str] = []
    notes: str = ""
    metadata: dict = {}

class CreateChallengeRequest(BaseModel):
    title: str
    description: str
    problem_type: str = "general"
    metric: str = "score"
    higher_is_better: bool = True
    target_value: float = 1.0
    baseline_value: float = 0.0
    deadline: str = "2027-01-01T00:00:00Z"
    difficulty: str = "medium"
    prize: str = ""
    n_qubits_min: int = 1
    n_qubits_max: int = 100
    tags: list[str] = []
    problem_instance: dict = {}

def _build_seed_records():
    import random; rng = random.Random(42)
    challenge_records = []
    submission_records = []
    for c in SEED_CHALLENGES:
        cid = str(uuid.uuid4())
        subs = []
        for i in range(c["participants"]):
            v = c["baseline_value"]
            if c["higher_is_better"]:
                v = rng.uniform(c["baseline_value"], c["target_value"] * rng.uniform(0.9, 1.05))
            else:
                v = rng.uniform(c["target_value"] * rng.uniform(0.8, 1.1), c["baseline_value"])
            subs.append({"label": f"Team {i+1}", "value": round(v, 4), "n_qubits": rng.randint(c["n_qubits_min"], min(c["n_qubits_max"], c["n_qubits_min"]+10)), "backend": rng.choice(["ibm_brisbane","ionq_aria","rigetti_ankaa"]), "submitted_at": datetime.now(timezone.utc).isoformat()})
        subs.sort(key=lambda s: s["value"], reverse=c["higher_is_better"])
        leader = subs[0] if subs else None
        ch = Challenge(
            challenge_id=cid, created_at=datetime.now(timezone.utc).isoformat(),
            leader=leader["label"] if leader else None, leader_value=leader["value"] if leader else None,
            **c,
        )
        challenge_records.append((cid, ch.model_dump()))
        # store seed submissions under a namespace keyed by challenge_id
        for sub in subs:
            sid = str(uuid.uuid4())
            sub_with_meta = {"submission_id": sid, "challenge_id": cid, "seed": True, **sub}
            submission_records.append((f"{cid}:{sid}", sub_with_meta))
    return challenge_records, submission_records


@router.get("/", response_model=dict)
def list_challenges(status: str | None = None, problem_type: str | None = None, db: Session = Depends(get_db)):
    ch_records, sub_records = _build_seed_records()
    store_seed(db, NS_CHALLENGES, ch_records)
    store_seed(db, NS_SUBMISSIONS, sub_records)
    chs = [Challenge(**r) for r in store_list(db, NS_CHALLENGES)]
    if status: chs = [c for c in chs if c.status == status]
    if problem_type: chs = [c for c in chs if c.problem_type == problem_type]
    all_chs = [Challenge(**r) for r in store_list(db, NS_CHALLENGES)]
    return {"challenges": chs, "total": len(chs), "active": sum(1 for c in all_chs if c.status == "active"), "total_participants": sum(c.participants for c in all_chs)}

@router.get("/{challenge_id}", response_model=Challenge)
def get_challenge(challenge_id: str, db: Session = Depends(get_db)):
    ch_records, sub_records = _build_seed_records()
    store_seed(db, NS_CHALLENGES, ch_records)
    store_seed(db, NS_SUBMISSIONS, sub_records)
    data = store_get(db, NS_CHALLENGES, challenge_id)
    if not data:
        raise HTTPException(404, "challenge not found")
    return Challenge(**data)

@router.get("/{challenge_id}/leaderboard")
def get_leaderboard(challenge_id: str, n: int = 20, db: Session = Depends(get_db)):
    ch_records, sub_records = _build_seed_records()
    store_seed(db, NS_CHALLENGES, ch_records)
    store_seed(db, NS_SUBMISSIONS, sub_records)
    ch_data = store_get(db, NS_CHALLENGES, challenge_id)
    if not ch_data:
        raise HTTPException(404, "challenge not found")
    ch = Challenge(**ch_data)
    all_subs = store_list(db, NS_SUBMISSIONS)
    subs = [s for s in all_subs if s.get("challenge_id") == challenge_id]
    subs_sorted = sorted(subs, key=lambda s: s["value"], reverse=ch.higher_is_better)[:n]
    for i, s in enumerate(subs_sorted):
        s["rank"] = i + 1
    return {"challenge_id": challenge_id, "metric": ch.metric, "higher_is_better": ch.higher_is_better, "target_value": ch.target_value, "baseline_value": ch.baseline_value, "entries": subs_sorted, "total_entries": len(subs)}

@router.post("/{challenge_id}/submit", response_model=Submission)
def submit_result(challenge_id: str, req: SubmitRequest, db: Session = Depends(get_db)):
    ch_records, sub_records = _build_seed_records()
    store_seed(db, NS_CHALLENGES, ch_records)
    store_seed(db, NS_SUBMISSIONS, sub_records)
    ch_data = store_get(db, NS_CHALLENGES, challenge_id)
    if not ch_data:
        raise HTTPException(404, "challenge not found")
    ch = Challenge(**ch_data)
    all_subs = store_list(db, NS_SUBMISSIONS)
    vals = [s["value"] for s in all_subs if s.get("challenge_id") == challenge_id]
    n_better = sum(1 for v in vals if (v > req.value if ch.higher_is_better else v < req.value))
    rank = n_better + 1
    percentile = (1 - n_better / max(len(vals), 1)) * 100
    sid = str(uuid.uuid4())
    sub = Submission(
        submission_id=sid, challenge_id=challenge_id, value=req.value, rank=rank,
        percentile=round(percentile, 1), submitted_at=datetime.now(timezone.utc).isoformat(),
        label=req.label, n_qubits=req.n_qubits, backend=req.backend,
        run_ids=req.run_ids, notes=req.notes, verified=False, metadata=req.metadata,
    )
    store_put(db, NS_SUBMISSIONS, f"{challenge_id}:{sid}", sub.model_dump())
    ch_data["participants"] += 1
    if ch.leader_value is None or (req.value > ch.leader_value if ch.higher_is_better else req.value < ch.leader_value):
        ch_data["leader"] = req.label; ch_data["leader_value"] = req.value
    store_put(db, NS_CHALLENGES, challenge_id, ch_data)
    return sub

@router.post("/", response_model=Challenge)
def create_challenge(req: CreateChallengeRequest, db: Session = Depends(get_db)):
    cid = str(uuid.uuid4())
    ch = Challenge(challenge_id=cid, created_at=datetime.now(timezone.utc).isoformat(), participants=0, status="active", leader=None, leader_value=None, **req.model_dump())
    store_put(db, NS_CHALLENGES, cid, ch.model_dump())
    return ch
