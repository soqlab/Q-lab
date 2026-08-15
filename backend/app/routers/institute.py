from __future__ import annotations
import uuid
import random
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session
from ..database import get_db
from ..store import store_put, store_get, store_list

router = APIRouter(prefix="/api/v1/institute", tags=["institute"])

BACKENDS = ["ibm_kyoto", "ibm_sherbrooke", "ionq_aria", "quantinuum_h2", "simulator"]
ALGORITHMS = ["VQE", "QAOA", "QPE", "Grover", "QSVM", "QFT", "Bernstein-Vazirani", "UCCSD"]
ACTIVITY_TYPES = ["circuit_run", "simulation", "transpilation", "optimization", "error_mitigation", "export"]


def _seed_activities_to_db(db: Session, institute_id: str, members: list[str]):
    now = datetime.now(timezone.utc)
    for day_offset in range(30):
        date = now - timedelta(days=30 - day_offset)
        for member in members:
            n_runs = random.randint(0, 6)
            for _ in range(n_runs):
                act = {
                    "activity_id": str(uuid.uuid4()),
                    "institute_id": institute_id,
                    "member": member,
                    "activity_type": random.choice(ACTIVITY_TYPES),
                    "algorithm": random.choice(ALGORITHMS),
                    "backend": random.choice(BACKENDS),
                    "cost_usd": round(random.uniform(0.05, 4.80), 4),
                    "fidelity": round(random.uniform(0.82, 0.997), 4),
                    "run_id": str(uuid.uuid4()),
                    "timestamp": (date + timedelta(hours=random.randint(0, 23))).isoformat(),
                }
                store_put(db, "institute_activity", act["activity_id"], act)


def _seed_all(db: Session):
    if store_list(db, "institute"):
        return

    inst1_id = "inst-qcl-mit"
    inst1 = {
        "institute_id": inst1_id,
        "name": "MIT Quantum Computing Lab",
        "pi": "Prof. Sarah Chen",
        "members": ["sarah.chen", "james.park", "anika.sharma", "leo.nguyen", "mia.watson"],
        "budget_usd": 50000.0,
        "created_at": (datetime.now(timezone.utc) - timedelta(days=90)).isoformat(),
    }
    store_put(db, "institute", inst1_id, inst1)
    _seed_activities_to_db(db, inst1_id, inst1["members"])

    inst2_id = "inst-qrl-eth"
    inst2 = {
        "institute_id": inst2_id,
        "name": "ETH Quantum Research Lab",
        "pi": "Prof. Klaus Weber",
        "members": ["k.weber", "priya.rao", "tom.fischer", "yuna.kim"],
        "budget_usd": 35000.0,
        "created_at": (datetime.now(timezone.utc) - timedelta(days=60)).isoformat(),
    }
    store_put(db, "institute", inst2_id, inst2)
    _seed_activities_to_db(db, inst2_id, inst2["members"])


class SetupRequest(BaseModel):
    name: str
    pi: str
    members: list[str]
    budget_usd: Optional[float] = None


class LogActivityRequest(BaseModel):
    institute_id: str
    member: str
    activity_type: str
    cost_usd: Optional[float] = None
    backend: Optional[str] = None
    run_id: Optional[str] = None


def _build_dashboard(institute_id: str, db: Session) -> dict:
    inst = store_get(db, "institute", institute_id)
    if inst is None:
        raise HTTPException(404, "Institute not found")
    all_acts = store_list(db, "institute_activity")
    acts = [a for a in all_acts if a["institute_id"] == institute_id]

    total_runs = len(acts)
    total_cost = round(sum(a.get("cost_usd", 0) for a in acts), 4)
    avg_fidelity = round(sum(a.get("fidelity", 0.9) for a in acts) / max(1, total_runs), 4)

    by_member: dict[str, dict] = {}
    for m in inst["members"]:
        member_acts = [a for a in acts if a["member"] == m]
        last = max((a["timestamp"] for a in member_acts), default=None)
        by_member[m] = {
            "member": m,
            "runs": len(member_acts),
            "cost": round(sum(a.get("cost_usd", 0) for a in member_acts), 4),
            "last_active": last,
        }

    by_backend: dict[str, int] = {}
    by_algorithm: dict[str, int] = {}
    for a in acts:
        be = a.get("backend", "unknown")
        by_backend[be] = by_backend.get(be, 0) + 1
        alg = a.get("algorithm", "unknown")
        by_algorithm[alg] = by_algorithm.get(alg, 0) + 1

    now = datetime.now(timezone.utc)
    heatmap = []
    for i in range(30):
        day = (now - timedelta(days=29 - i)).date().isoformat()
        count = sum(1 for a in acts if a["timestamp"][:10] == day)
        heatmap.append({"date": day, "count": count})

    productivity_score = min(10.0, round((total_runs / max(1, len(inst["members"]))) * 0.12 + avg_fidelity * 5, 2))
    budget = inst.get("budget_usd")

    return {
        "institute": inst,
        "total_runs": total_runs,
        "total_cost_usd": total_cost,
        "budget_remaining": round(budget - total_cost, 2) if budget else None,
        "by_member": list(by_member.values()),
        "by_backend": by_backend,
        "by_algorithm": by_algorithm,
        "productivity_score": productivity_score,
        "avg_fidelity": avg_fidelity,
        "publications": len(acts),
        "replications": random.randint(1, 4),
        "top_result": "VQE ground state H2O: -76.2394 Hartree (chemical accuracy achieved)",
        "activity_heatmap": heatmap,
    }


@router.post("/setup")
def setup_institute(req: SetupRequest, db: Session = Depends(get_db)):
    iid = str(uuid.uuid4())
    inst = {"institute_id": iid, "name": req.name, "pi": req.pi,
            "members": req.members, "budget_usd": req.budget_usd,
            "created_at": datetime.now(timezone.utc).isoformat()}
    store_put(db, "institute", iid, inst)
    return inst


@router.post("/log-activity")
def log_activity(req: LogActivityRequest, db: Session = Depends(get_db)):
    _seed_all(db)
    inst = store_get(db, "institute", req.institute_id)
    if not inst:
        raise HTTPException(404, "Institute not found")
    if req.member not in inst["members"]:
        raise HTTPException(400, f"Member '{req.member}' not in institute")
    record = {"activity_id": str(uuid.uuid4()), "institute_id": req.institute_id,
              "member": req.member, "activity_type": req.activity_type,
              "algorithm": random.choice(ALGORITHMS), "backend": req.backend or "simulator",
              "cost_usd": req.cost_usd or round(random.uniform(0.1, 2.0), 4),
              "fidelity": round(random.uniform(0.85, 0.99), 4),
              "run_id": req.run_id or str(uuid.uuid4()),
              "timestamp": datetime.now(timezone.utc).isoformat()}
    store_put(db, "institute_activity", record["activity_id"], record)
    return record


@router.get("/{institute_id}/dashboard")
def get_dashboard(institute_id: str, db: Session = Depends(get_db)):
    _seed_all(db)
    if not store_get(db, "institute", institute_id):
        raise HTTPException(404, "Institute not found")
    return _build_dashboard(institute_id, db)


@router.get("/{institute_id}/members")
def get_members(institute_id: str, db: Session = Depends(get_db)):
    _seed_all(db)
    inst = store_get(db, "institute", institute_id)
    if not inst:
        raise HTTPException(404, "Institute not found")
    all_acts = store_list(db, "institute_activity")
    acts = [a for a in all_acts if a["institute_id"] == institute_id]
    result = []
    for m in inst["members"]:
        member_acts = [a for a in acts if a["member"] == m]
        algs = [a.get("algorithm", "") for a in member_acts]
        top_alg = max(set(algs), key=algs.count, default="N/A") if algs else "N/A"
        result.append({"member": m, "runs": len(member_acts),
                        "cost": round(sum(a.get("cost_usd", 0) for a in member_acts), 4),
                        "avg_fidelity": round(sum(a.get("fidelity", 0.9) for a in member_acts) / max(1, len(member_acts)), 4),
                        "top_algorithm": top_alg,
                        "last_active": max((a["timestamp"] for a in member_acts), default=None)})
    return result


@router.get("")
def list_institutes(db: Session = Depends(get_db)):
    _seed_all(db)
    return store_list(db, "institute")
