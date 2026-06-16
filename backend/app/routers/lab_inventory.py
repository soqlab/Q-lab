from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import uuid, random, math
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list, store_delete

router = APIRouter(prefix="/api/v1/lab-inventory", tags=["Lab Inventory"])

NS_ITEMS = "lab_items"
NS_MAINTENANCE = "lab_maintenance"


class EquipmentItem(BaseModel):
    item_id: str
    name: str
    category: str
    model: str
    serial_number: str
    location: str
    status: str
    purchase_date: str
    warranty_expires: Optional[str]
    last_maintenance: Optional[str]
    next_maintenance: Optional[str]
    notes: str
    linked_backends: List[str]
    created_at: str


class MaintenanceLog(BaseModel):
    log_id: str
    item_id: str
    type: str
    description: str
    performed_by: str
    duration_hours: float
    parts_replaced: List[str]
    cost_usd: float
    next_due: Optional[str]
    logged_at: str


class MaintenanceSchedule(BaseModel):
    item_id: str
    item_name: str
    next_due: str
    type: str
    overdue: bool


class CreateItemRequest(BaseModel):
    name: str
    category: str
    model: str
    serial_number: str
    location: str
    status: str
    purchase_date: str
    warranty_expires: Optional[str] = None
    notes: str = ""
    linked_backends: Optional[List[str]] = None


class CreateMaintenanceRequest(BaseModel):
    item_id: str
    type: str
    description: str
    performed_by: str
    duration_hours: float
    parts_replaced: List[str] = []
    cost_usd: float = 0.0
    next_due: Optional[str] = None


_VALID_CATEGORIES = {"cryostat", "microwave", "control_electronics", "software", "consumable"}
_VALID_STATUSES = {"operational", "maintenance", "failed", "decommissioned"}
_VALID_MAINT_TYPES = {"preventive", "corrective", "calibration"}


@router.post("/item", response_model=EquipmentItem)
def create_item(req: CreateItemRequest, db: Session = Depends(get_db)) -> EquipmentItem:
    if req.category not in _VALID_CATEGORIES:
        raise HTTPException(
            status_code=422,
            detail=f"category must be one of {sorted(_VALID_CATEGORIES)}",
        )
    if req.status not in _VALID_STATUSES:
        raise HTTPException(
            status_code=422,
            detail=f"status must be one of {sorted(_VALID_STATUSES)}",
        )

    item_id = str(uuid.uuid4())
    item = EquipmentItem(
        item_id=item_id,
        name=req.name,
        category=req.category,
        model=req.model,
        serial_number=req.serial_number,
        location=req.location,
        status=req.status,
        purchase_date=req.purchase_date,
        warranty_expires=req.warranty_expires,
        last_maintenance=None,
        next_maintenance=None,
        notes=req.notes,
        linked_backends=req.linked_backends or [],
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    store_put(db, NS_ITEMS, item_id, item.model_dump())
    return item


@router.get("/items", response_model=List[EquipmentItem])
def list_items(
    category: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
) -> List[EquipmentItem]:
    results = store_list(db, NS_ITEMS)
    if category:
        results = [i for i in results if i["category"] == category]
    if status:
        results = [i for i in results if i["status"] == status]
    return [EquipmentItem(**i) for i in results]


@router.get("/item/{item_id}", response_model=EquipmentItem)
def get_item(item_id: str, db: Session = Depends(get_db)) -> EquipmentItem:
    item = store_get(db, NS_ITEMS, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Equipment item not found")
    return EquipmentItem(**item)


@router.post("/maintenance", response_model=MaintenanceLog)
def log_maintenance(req: CreateMaintenanceRequest, db: Session = Depends(get_db)) -> MaintenanceLog:
    item = store_get(db, NS_ITEMS, req.item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Equipment item not found")
    if req.type not in _VALID_MAINT_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"type must be one of {sorted(_VALID_MAINT_TYPES)}",
        )

    log_id = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()

    log = MaintenanceLog(
        log_id=log_id,
        item_id=req.item_id,
        type=req.type,
        description=req.description,
        performed_by=req.performed_by,
        duration_hours=req.duration_hours,
        parts_replaced=req.parts_replaced,
        cost_usd=req.cost_usd,
        next_due=req.next_due,
        logged_at=now_iso,
    )
    store_put(db, NS_MAINTENANCE, log_id, log.model_dump())

    # Update the item's maintenance timestamps
    item["last_maintenance"] = now_iso
    item["next_maintenance"] = req.next_due
    store_put(db, NS_ITEMS, req.item_id, item)

    return log


@router.get("/schedule", response_model=List[MaintenanceSchedule])
def get_schedule(db: Session = Depends(get_db)) -> List[MaintenanceSchedule]:
    now_iso = datetime.now(timezone.utc).isoformat()
    schedule: List[MaintenanceSchedule] = []

    all_items = store_list(db, NS_ITEMS)
    all_logs = store_list(db, NS_MAINTENANCE)

    for item in all_items:
        if item.get("next_maintenance"):
            overdue = item["next_maintenance"] < now_iso
            # Determine the type from the most recent log for this item
            item_logs = [log for log in all_logs if log["item_id"] == item["item_id"]]
            maint_type = "preventive"
            if item_logs:
                latest = max(item_logs, key=lambda l: l["logged_at"])
                maint_type = latest["type"] if latest.get("next_due") else "preventive"

            schedule.append(
                MaintenanceSchedule(
                    item_id=item["item_id"],
                    item_name=item["name"],
                    next_due=item["next_maintenance"],
                    type=maint_type,
                    overdue=overdue,
                )
            )

    # Sort by next_due ascending
    schedule.sort(key=lambda s: s.next_due)
    return schedule
