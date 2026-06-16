"""Department / sub-organisation hierarchy for Q-Lab.

Allows a parent institution to have multiple quantum labs or research groups
(departments) organised in a tree.  Data is persisted via the GenericRecord
store under the namespace ``org_departments``.

Endpoints
---------
GET    /api/v1/departments                          - list all departments
POST   /api/v1/departments                          - create department (admin/owner)
GET    /api/v1/departments/tree                     - full hierarchy tree
GET    /api/v1/departments/{dept_id}                - get one department
PUT    /api/v1/departments/{dept_id}                - update department (admin/owner)
DELETE /api/v1/departments/{dept_id}                - delete department (owner only)
GET    /api/v1/departments/{dept_id}/members        - list members
POST   /api/v1/departments/{dept_id}/members        - add member
DELETE /api/v1/departments/{dept_id}/members/{uid}  - remove member
GET    /api/v1/departments/{dept_id}/analytics      - run stats for department
"""
from __future__ import annotations

import secrets
import string
from datetime import datetime, timezone
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import Identity, get_identity, require_auth
from ..health_score import compute_health_score
from ..models import Run, User
from ..store import store_delete, store_get, store_list, store_put, store_seed

router = APIRouter(prefix="/api/v1/departments", tags=["departments"])

_NAMESPACE = "org_departments"
_ID_CHARS = string.ascii_lowercase + string.digits


def _new_dept_id() -> str:
    return "dept_" + "".join(secrets.choice(_ID_CHARS) for _ in range(12))


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class DepartmentCreate(BaseModel):
    name: str = Field(..., max_length=200)
    description: str = Field(default="", max_length=1000)
    parent_org_id: str = Field(..., max_length=120)
    parent_dept_id: Optional[str] = Field(default=None, max_length=64)
    head_researcher: Optional[str] = Field(default=None, max_length=64)
    color: str = Field(default="#6366f1", max_length=20)
    icon: str = Field(default="🔬", max_length=8)
    metadata: dict = Field(default_factory=dict)


class DepartmentUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=200)
    description: Optional[str] = Field(default=None, max_length=1000)
    parent_dept_id: Optional[str] = Field(default=None, max_length=64)
    head_researcher: Optional[str] = Field(default=None, max_length=64)
    color: Optional[str] = Field(default=None, max_length=20)
    icon: Optional[str] = Field(default=None, max_length=8)
    metadata: Optional[dict] = None


class MemberAdd(BaseModel):
    user_id: str = Field(..., max_length=64)


# ---------------------------------------------------------------------------
# Seeding
# ---------------------------------------------------------------------------

_SEED_ORG_ID = "org_default"

_SEED_DATA: list[tuple[str, dict[str, Any]]] = [
    (
        "dept_qcl000000001",
        {
            "id": "dept_qcl000000001",
            "name": "Quantum Computing Lab",
            "description": "Core quantum computing research and hardware experiments.",
            "parent_org_id": _SEED_ORG_ID,
            "parent_dept_id": None,
            "head_researcher": None,
            "color": "#6366f1",
            "icon": "🔬",
            "member_ids": [],
            "created_at": "2024-01-10T09:00:00+00:00",
            "metadata": {},
        },
    ),
    (
        "dept_qec000000002",
        {
            "id": "dept_qec000000002",
            "name": "Quantum Error Correction Group",
            "description": "Develops and validates quantum error correction codes.",
            "parent_org_id": _SEED_ORG_ID,
            "parent_dept_id": "dept_qcl000000001",
            "head_researcher": None,
            "color": "#10b981",
            "icon": "⚛️",
            "member_ids": [],
            "created_at": "2024-01-11T09:00:00+00:00",
            "metadata": {},
        },
    ),
    (
        "dept_qml000000003",
        {
            "id": "dept_qml000000003",
            "name": "Quantum Machine Learning Team",
            "description": "Applies quantum computing to machine learning tasks.",
            "parent_org_id": _SEED_ORG_ID,
            "parent_dept_id": "dept_qcl000000001",
            "head_researcher": None,
            "color": "#f59e0b",
            "icon": "🧠",
            "member_ids": [],
            "created_at": "2024-01-12T09:00:00+00:00",
            "metadata": {},
        },
    ),
]


def _ensure_seeded(db: Session) -> None:
    store_seed(db, _NAMESPACE, _SEED_DATA)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_or_404(db: Session, dept_id: str) -> dict[str, Any]:
    dept = store_get(db, _NAMESPACE, dept_id)
    if dept is None:
        raise HTTPException(status_code=404, detail="Department not found")
    return dept


def _require_admin(identity: Optional[Identity]) -> None:
    if identity is None:
        return  # open dev mode
    if identity.role not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Requires admin or owner role")


def _require_owner(identity: Optional[Identity]) -> None:
    if identity is None:
        return  # open dev mode
    if identity.role != "owner":
        raise HTTPException(status_code=403, detail="Requires owner role")


def _run_health(run: Run) -> Optional[float]:
    rd = {
        "results": run.results or {},
        "calibration": run.calibration or {},
        "fingerprint": run.fingerprint or {},
    }
    h = compute_health_score(rd)
    return round(h, 1) if h is not None else None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("")
def list_departments(
    db: Session = Depends(get_db),
    identity: Optional[Identity] = Depends(get_identity),
) -> list[dict]:
    _ensure_seeded(db)
    return store_list(db, _NAMESPACE)


@router.post("", status_code=201)
def create_department(
    body: DepartmentCreate,
    db: Session = Depends(get_db),
    identity: Optional[Identity] = Depends(get_identity),
) -> dict:
    _require_admin(identity)
    _ensure_seeded(db)
    dept_id = _new_dept_id()
    now = datetime.now(timezone.utc).isoformat()
    data: dict[str, Any] = {
        "id": dept_id,
        "name": body.name,
        "description": body.description,
        "parent_org_id": body.parent_org_id,
        "parent_dept_id": body.parent_dept_id,
        "head_researcher": body.head_researcher,
        "color": body.color,
        "icon": body.icon,
        "member_ids": [],
        "created_at": now,
        "metadata": body.metadata,
    }
    store_put(db, _NAMESPACE, dept_id, data)
    return data


@router.get("/tree")
def get_tree(
    db: Session = Depends(get_db),
    identity: Optional[Identity] = Depends(get_identity),
) -> dict:
    """Return a hierarchical tree: root departments → children → members."""
    _ensure_seeded(db)
    all_depts = store_list(db, _NAMESPACE)

    # Build id → node map
    by_id: dict[str, dict] = {d["id"]: {**d, "children": []} for d in all_depts}
    roots: list[dict] = []

    for node in by_id.values():
        parent_id = node.get("parent_dept_id")
        if parent_id and parent_id in by_id:
            by_id[parent_id]["children"].append(node)
        else:
            roots.append(node)

    org_ids: set[str] = {d.get("parent_org_id", "org_default") for d in all_depts}
    return {
        "org_id": next(iter(org_ids), "org_default"),
        "departments": roots,
        "total": len(all_depts),
    }


@router.get("/{dept_id}")
def get_department(
    dept_id: str,
    db: Session = Depends(get_db),
    identity: Optional[Identity] = Depends(get_identity),
) -> dict:
    _ensure_seeded(db)
    return _get_or_404(db, dept_id)


@router.put("/{dept_id}")
def update_department(
    dept_id: str,
    body: DepartmentUpdate,
    db: Session = Depends(get_db),
    identity: Optional[Identity] = Depends(get_identity),
) -> dict:
    _require_admin(identity)
    _ensure_seeded(db)
    dept = _get_or_404(db, dept_id)
    if body.name is not None:
        dept["name"] = body.name
    if body.description is not None:
        dept["description"] = body.description
    if body.parent_dept_id is not None:
        dept["parent_dept_id"] = body.parent_dept_id
    if body.head_researcher is not None:
        dept["head_researcher"] = body.head_researcher
    if body.color is not None:
        dept["color"] = body.color
    if body.icon is not None:
        dept["icon"] = body.icon
    if body.metadata is not None:
        dept["metadata"] = body.metadata
    store_put(db, _NAMESPACE, dept_id, dept)
    return dept


@router.delete("/{dept_id}")
def delete_department(
    dept_id: str,
    db: Session = Depends(get_db),
    identity: Optional[Identity] = Depends(get_identity),
) -> dict:
    _require_owner(identity)
    _ensure_seeded(db)
    if not store_delete(db, _NAMESPACE, dept_id):
        raise HTTPException(status_code=404, detail="Department not found")
    return {"deleted": True, "dept_id": dept_id}


# ---------------------------------------------------------------------------
# Member management
# ---------------------------------------------------------------------------


@router.get("/{dept_id}/members")
def list_members(
    dept_id: str,
    db: Session = Depends(get_db),
    identity: Optional[Identity] = Depends(get_identity),
) -> dict:
    _ensure_seeded(db)
    dept = _get_or_404(db, dept_id)
    member_ids: list[str] = dept.get("member_ids", [])

    # Resolve user details if available in DB
    enriched: list[dict] = []
    for uid in member_ids:
        try:
            user_id_int = int(uid)
            user = db.scalar(select(User).where(User.id == user_id_int))
            if user:
                enriched.append({
                    "user_id": uid,
                    "name": user.name,
                    "email": user.email,
                    "role": user.role,
                })
                continue
        except (ValueError, TypeError):
            pass
        enriched.append({"user_id": uid, "name": None, "email": None, "role": None})

    return {"dept_id": dept_id, "members": enriched, "count": len(enriched)}


@router.post("/{dept_id}/members", status_code=201)
def add_member(
    dept_id: str,
    body: MemberAdd,
    db: Session = Depends(get_db),
    identity: Optional[Identity] = Depends(get_identity),
) -> dict:
    _require_admin(identity)
    _ensure_seeded(db)
    dept = _get_or_404(db, dept_id)
    member_ids: list[str] = dept.get("member_ids", [])
    if body.user_id in member_ids:
        raise HTTPException(status_code=409, detail="User already a member")
    member_ids.append(body.user_id)
    dept["member_ids"] = member_ids
    store_put(db, _NAMESPACE, dept_id, dept)
    return {"dept_id": dept_id, "user_id": body.user_id, "added": True}


@router.delete("/{dept_id}/members/{user_id}")
def remove_member(
    dept_id: str,
    user_id: str,
    db: Session = Depends(get_db),
    identity: Optional[Identity] = Depends(get_identity),
) -> dict:
    _require_admin(identity)
    _ensure_seeded(db)
    dept = _get_or_404(db, dept_id)
    member_ids: list[str] = dept.get("member_ids", [])
    if user_id not in member_ids:
        raise HTTPException(status_code=404, detail="User not a member of this department")
    member_ids.remove(user_id)
    dept["member_ids"] = member_ids
    store_put(db, _NAMESPACE, dept_id, dept)
    return {"dept_id": dept_id, "user_id": user_id, "removed": True}


# ---------------------------------------------------------------------------
# Department analytics
# ---------------------------------------------------------------------------


@router.get("/{dept_id}/analytics")
def department_analytics(
    dept_id: str,
    db: Session = Depends(get_db),
    identity: Optional[Identity] = Depends(get_identity),
) -> dict:
    """Aggregate run stats for all members of the department."""
    _ensure_seeded(db)
    dept = _get_or_404(db, dept_id)
    member_ids: list[str] = dept.get("member_ids", [])

    # Collect user integer IDs
    int_ids: list[int] = []
    for uid in member_ids:
        try:
            int_ids.append(int(uid))
        except (ValueError, TypeError):
            pass

    # Fetch runs belonging to those users
    runs: list[Run] = []
    if int_ids:
        runs = list(db.scalars(select(Run).where(Run.created_by_user_id.in_(int_ids))).all())

    total_runs = len(runs)
    completed = [r for r in runs if r.status == "completed"]
    failed = [r for r in runs if r.status == "failed"]

    health_scores: list[float] = []
    total_shots = 0
    qpu_seconds = 0.0
    for r in runs:
        h = _run_health(r)
        if h is not None:
            health_scores.append(h)
        shots = int((r.execution or {}).get("shots", 0))
        total_shots += shots
        # Estimate QPU time: shots * ~10 µs per shot → convert to seconds
        qpu_seconds += shots * 0.00001

    avg_health = round(sum(health_scores) / len(health_scores), 1) if health_scores else None

    # Monthly breakdown (last 12 months)
    from collections import defaultdict
    by_month: dict[str, int] = defaultdict(int)
    for r in runs:
        if r.created_at:
            ts = r.created_at if r.created_at.tzinfo else r.created_at.replace(tzinfo=timezone.utc)
            by_month[ts.strftime("%Y-%m")] += 1
    monthly = [{"month": m, "runs": v} for m, v in sorted(by_month.items())]

    return {
        "dept_id": dept_id,
        "dept_name": dept.get("name"),
        "member_count": len(member_ids),
        "total_runs": total_runs,
        "completed_runs": len(completed),
        "failed_runs": len(failed),
        "success_rate": round(len(completed) / total_runs, 4) if total_runs else 0.0,
        "avg_health_score": avg_health,
        "total_shots": total_shots,
        "estimated_qpu_seconds": round(qpu_seconds, 2),
        "by_month": monthly,
    }
