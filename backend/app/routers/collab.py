from __future__ import annotations
import uuid, random
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list, store_delete, store_seed

router = APIRouter(prefix="/api/v1/collab", tags=["collab"])

NS_ROOMS = "collab_rooms"

class CollabRoom(BaseModel):
    room_id: str; name: str; experiment_name: str
    created_at: str; updated_at: str; status: str
    participants: list[dict]; owner: str
    current_params: dict; current_circuit: str
    annotations: list[dict]; chat: list[dict]
    shared_analysis: dict; cursor_positions: dict

class JoinRequest(BaseModel):
    room_id: str; username: str; role: str = "observer"

class ParamUpdateRequest(BaseModel):
    room_id: str; username: str; params: dict; circuit: str = ""

class AnnotationRequest(BaseModel):
    room_id: str; username: str; text: str; position: dict = {}; color: str = "#6366f1"

class ChatRequest(BaseModel):
    room_id: str; username: str; message: str

class CreateRoomRequest(BaseModel):
    name: str = "Collaboration Session"; experiment_name: str = "VQE Run"; owner: str = "researcher"
    initial_params: dict = {}; initial_circuit: str = ""

SEED_ROOMS = [
    {"name": "GHZ Sensing Collab", "experiment_name": "8-Qubit GHZ Interferometry", "owner": "alice", "current_params": {"phi": 0.785, "n_qubits": 8, "n_shots": 8192}, "current_circuit": "OPENQASM 2.0;"},
    {"name": "QAOA MaxCut Session", "experiment_name": "50-Node MaxCut QAOA", "owner": "bob", "current_params": {"gamma": [0.4,0.8,1.2], "beta": [0.3,0.6,0.9], "p": 3}, "current_circuit": ""},
]

def _build_seed_records():
    rng = random.Random(42)
    records = []
    for s in SEED_ROOMS:
        rid = str(uuid.uuid4())
        participants = [{"username": s["owner"], "role": "owner", "joined_at": datetime.now(timezone.utc).isoformat(), "color": "#6366f1", "active": True}]
        colors = ["#f59e0b","#10b981","#ef4444"]
        for i, (uname, role) in enumerate([("carol","collaborator"),("dave","observer")]):
            participants.append({"username": uname, "role": role, "joined_at": datetime.now(timezone.utc).isoformat(), "color": colors[i], "active": rng.random()>0.3})
        annotations = [{"id": str(uuid.uuid4()), "username": p["username"], "text": f"Note from {p['username']}: looks promising", "position": {"x": rng.randint(100,700), "y": rng.randint(100,400)}, "color": p["color"], "timestamp": datetime.now(timezone.utc).isoformat()} for p in participants[:2]]
        chat = [{"id": str(uuid.uuid4()), "username": p["username"], "message": f"I see {rng.choice(['convergence','good fidelity','noise issues'])}", "timestamp": datetime.now(timezone.utc).isoformat()} for p in participants[:3]]
        room_data = CollabRoom(room_id=rid, created_at=datetime.now(timezone.utc).isoformat(), updated_at=datetime.now(timezone.utc).isoformat(), status="active", participants=participants, annotations=annotations, chat=chat, shared_analysis={"last_fidelity": round(rng.uniform(0.85,0.99),4), "n_runs": rng.randint(5,20)}, cursor_positions={p["username"]: {"x": rng.randint(0,800), "y": rng.randint(0,600)} for p in participants}, **{k:v for k,v in s.items()}).model_dump()
        records.append((rid, room_data))
    return records


@router.post("/create", response_model=CollabRoom)
def create_room(req: CreateRoomRequest, db: Session = Depends(get_db)):
    rid = str(uuid.uuid4())
    room = CollabRoom(room_id=rid, name=req.name, experiment_name=req.experiment_name, owner=req.owner, created_at=datetime.now(timezone.utc).isoformat(), updated_at=datetime.now(timezone.utc).isoformat(), status="active", participants=[{"username": req.owner, "role": "owner", "joined_at": datetime.now(timezone.utc).isoformat(), "color": "#6366f1", "active": True}], current_params=req.initial_params, current_circuit=req.initial_circuit, annotations=[], chat=[], shared_analysis={}, cursor_positions={req.owner: {"x": 400, "y": 300}})
    store_put(db, NS_ROOMS, rid, room.model_dump())
    return room

@router.post("/join", response_model=CollabRoom)
def join_room(req: JoinRequest, db: Session = Depends(get_db)):
    store_seed(db, NS_ROOMS, _build_seed_records())
    room_data = store_get(db, NS_ROOMS, req.room_id)
    if not room_data:
        raise HTTPException(404, "room not found")
    colors = ["#f59e0b","#10b981","#ef4444","#8b5cf6","#06b6d4"]
    existing = [p["username"] for p in room_data["participants"]]
    if req.username not in existing:
        room_data["participants"].append({"username": req.username, "role": req.role, "joined_at": datetime.now(timezone.utc).isoformat(), "color": colors[len(existing) % len(colors)], "active": True})
    room_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    store_put(db, NS_ROOMS, req.room_id, room_data)
    return CollabRoom(**room_data)

@router.post("/update-params", response_model=CollabRoom)
def update_params(req: ParamUpdateRequest, db: Session = Depends(get_db)):
    store_seed(db, NS_ROOMS, _build_seed_records())
    room_data = store_get(db, NS_ROOMS, req.room_id)
    if not room_data:
        raise HTTPException(404, "room not found")
    room_data["current_params"] = req.params
    if req.circuit:
        room_data["current_circuit"] = req.circuit
    room_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    store_put(db, NS_ROOMS, req.room_id, room_data)
    return CollabRoom(**room_data)

@router.post("/annotate", response_model=CollabRoom)
def add_annotation(req: AnnotationRequest, db: Session = Depends(get_db)):
    store_seed(db, NS_ROOMS, _build_seed_records())
    room_data = store_get(db, NS_ROOMS, req.room_id)
    if not room_data:
        raise HTTPException(404, "room not found")
    room_data["annotations"].append({"id": str(uuid.uuid4()), "username": req.username, "text": req.text, "position": req.position, "color": req.color, "timestamp": datetime.now(timezone.utc).isoformat()})
    room_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    store_put(db, NS_ROOMS, req.room_id, room_data)
    return CollabRoom(**room_data)

@router.post("/chat", response_model=CollabRoom)
def send_chat(req: ChatRequest, db: Session = Depends(get_db)):
    store_seed(db, NS_ROOMS, _build_seed_records())
    room_data = store_get(db, NS_ROOMS, req.room_id)
    if not room_data:
        raise HTTPException(404, "room not found")
    room_data["chat"].append({"id": str(uuid.uuid4()), "username": req.username, "message": req.message, "timestamp": datetime.now(timezone.utc).isoformat()})
    room_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    store_put(db, NS_ROOMS, req.room_id, room_data)
    return CollabRoom(**room_data)

@router.get("/{room_id}", response_model=CollabRoom)
def get_room(room_id: str, db: Session = Depends(get_db)):
    store_seed(db, NS_ROOMS, _build_seed_records())
    room_data = store_get(db, NS_ROOMS, room_id)
    if not room_data:
        raise HTTPException(404, "room not found")
    return CollabRoom(**room_data)

@router.get("")
def list_rooms(db: Session = Depends(get_db)):
    store_seed(db, NS_ROOMS, _build_seed_records())
    rooms = store_list(db, NS_ROOMS)
    return {"rooms": [{"room_id": r["room_id"], "name": r["name"], "status": r["status"], "participants": len(r["participants"])} for r in rooms]}

