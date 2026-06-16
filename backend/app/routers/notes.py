from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import Identity, get_identity, require_auth
from ..models import RunNote

run_notes_router = APIRouter(prefix="/api/v1/runs", tags=["notes"])
notes_router = APIRouter(prefix="/api/v1/notes", tags=["notes"])


class NotePayload(BaseModel):
    content: str


def _note_out(n: RunNote) -> dict:
    return {
        "id": n.id,
        "run_id": n.run_id,
        "content": n.content,
        "user_id": n.user_id,
        "author_name": n.user.name if n.user else "Anonymous",
        "author_email": n.user.email if n.user else None,
        "created_at": n.created_at.isoformat(),
        "updated_at": n.updated_at.isoformat(),
    }


@run_notes_router.get("/{run_id}/notes")
def list_notes(
    run_id: str,
    identity: Optional[Identity] = Depends(get_identity),
    db: Session = Depends(get_db),
):
    notes = db.scalars(
        select(RunNote).where(RunNote.run_id == run_id).order_by(RunNote.created_at.asc())
    ).all()
    return [_note_out(n) for n in notes]


@run_notes_router.post("/{run_id}/notes")
def create_note(
    run_id: str,
    payload: NotePayload,
    identity: Identity = Depends(require_auth),
    db: Session = Depends(get_db),
):
    if not payload.content.strip():
        raise HTTPException(status_code=422, detail="Note content cannot be empty")
    note = RunNote(
        run_id=run_id,
        user_id=identity.user_id,
        content=payload.content.strip(),
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    return _note_out(note)


@notes_router.patch("/{note_id}")
def update_note(
    note_id: int,
    payload: NotePayload,
    identity: Identity = Depends(require_auth),
    db: Session = Depends(get_db),
):
    note = db.scalar(select(RunNote).where(RunNote.id == note_id))
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    # Only the author or an admin can edit
    is_admin = identity.user and identity.user.role in ("owner", "admin")
    if note.user_id != identity.user_id and not is_admin:
        raise HTTPException(status_code=403, detail="Cannot edit another user's note")
    if not payload.content.strip():
        raise HTTPException(status_code=422, detail="Note content cannot be empty")
    note.content = payload.content.strip()
    note.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(note)
    return _note_out(note)


@notes_router.delete("/{note_id}")
def delete_note(
    note_id: int,
    identity: Identity = Depends(require_auth),
    db: Session = Depends(get_db),
):
    note = db.scalar(select(RunNote).where(RunNote.id == note_id))
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    is_admin = identity.user and identity.user.role in ("owner", "admin")
    if note.user_id != identity.user_id and not is_admin:
        raise HTTPException(status_code=403, detail="Cannot delete another user's note")
    db.delete(note)
    db.commit()
    return {"deleted": True}
