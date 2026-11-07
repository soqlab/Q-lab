"""Scientific Citation Tracking — attach arXiv IDs and DOIs to runs."""

from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run

router = APIRouter(prefix="/api/v1/runs", tags=["citations"])

# ------------------------------------------------------------------
# Pydantic models
# ------------------------------------------------------------------

class CitationPayload(BaseModel):
    arxiv_id: Optional[str] = None   # e.g. "2305.14832"
    doi: Optional[str] = None        # e.g. "10.1103/PhysRevLett.127.180501"
    title: Optional[str] = None
    authors: Optional[str] = None    # "First Last, First Last"
    journal: Optional[str] = None
    year: Optional[int] = None
    note: Optional[str] = None


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _citation_table_ddl(dialect: str = "sqlite") -> list[str]:
    id_col = "id SERIAL PRIMARY KEY" if dialect == "postgresql" else "id INTEGER PRIMARY KEY AUTOINCREMENT"
    ts_type = "TIMESTAMP" if dialect == "postgresql" else "DATETIME"
    return [
        f"""CREATE TABLE IF NOT EXISTS run_citations (
            {id_col},
            run_id VARCHAR(64) NOT NULL,
            arxiv_id VARCHAR(32),
            doi VARCHAR(256),
            title TEXT,
            authors TEXT,
            journal VARCHAR(256),
            year INTEGER,
            note TEXT,
            created_at {ts_type} NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""",
        "CREATE INDEX IF NOT EXISTS ix_run_citations_run_id ON run_citations(run_id)",
        "CREATE INDEX IF NOT EXISTS ix_run_citations_arxiv ON run_citations(arxiv_id)",
    ]


def _ensure_table(db: Session) -> None:
    """Create run_citations on first use: no model or migration creates it."""
    for ddl in _citation_table_ddl(db.get_bind().dialect.name):
        db.execute(text(ddl))
    db.commit()


def _find_run(db: Session, run_id: str) -> Run:
    run = db.scalar(select(Run).where(Run.run_id == run_id))  # limited to the caller's runs
    if run is None:
        raise HTTPException(status_code=404, detail="run not found")
    return run


def _fmt_bibtex(row) -> str:
    key = (row["arxiv_id"] or row["doi"] or f"cite{row['id']}").replace("/", "_").replace(".", "_")
    lines = [f"@article{{{key},"]
    if row.get("title"):
        lines.append(f"  title = {{{row['title']}}},")
    if row.get("authors"):
        lines.append(f"  author = {{{row['authors']}}},")
    if row.get("journal"):
        lines.append(f"  journal = {{{row['journal']}}},")
    if row.get("year"):
        lines.append(f"  year = {{{row['year']}}},")
    if row.get("doi"):
        lines.append(f"  doi = {{{row['doi']}}},")
    if row.get("arxiv_id"):
        lines.append(f"  eprint = {{{row['arxiv_id']}}},")
        lines.append("  archivePrefix = {arXiv},")
    lines.append("}")
    return "\n".join(lines)


def _row_to_dict(row) -> dict:
    return {
        "id": row["id"],
        "run_id": row["run_id"],
        "arxiv_id": row["arxiv_id"],
        "doi": row["doi"],
        "title": row["title"],
        "authors": row["authors"],
        "journal": row["journal"],
        "year": row["year"],
        "note": row["note"],
        "created_at": row["created_at"],
        "arxiv_url": f"https://arxiv.org/abs/{row['arxiv_id']}" if row["arxiv_id"] else None,
        "doi_url": f"https://doi.org/{row['doi']}" if row["doi"] else None,
        "bibtex": _fmt_bibtex(row),
    }


# ------------------------------------------------------------------
# Routes
# ------------------------------------------------------------------

@router.get("/{run_id}/citations")
def list_citations(run_id: str, db: Session = Depends(get_db)):
    _find_run(db, run_id)
    _ensure_table(db)
    try:
        rows = db.execute(
            text("SELECT * FROM run_citations WHERE run_id = :rid ORDER BY created_at ASC"),
            {"rid": run_id},
        ).mappings().all()
        return {"run_id": run_id, "count": len(rows), "citations": [_row_to_dict(dict(r)) for r in rows]}
    except Exception:
        return {"run_id": run_id, "count": 0, "citations": []}


@router.post("/{run_id}/citations")
def add_citation(run_id: str, payload: CitationPayload, db: Session = Depends(get_db)):
    _find_run(db, run_id)
    if not payload.arxiv_id and not payload.doi and not payload.title:
        raise HTTPException(status_code=422, detail="Provide at least one of: arxiv_id, doi, title")
    _ensure_table(db)
    try:
        result = db.execute(
            text("""INSERT INTO run_citations (run_id, arxiv_id, doi, title, authors, journal, year, note, created_at)
                    VALUES (:run_id, :arxiv_id, :doi, :title, :authors, :journal, :year, :note, :now)
                    RETURNING id"""),
            {
                "run_id": run_id,
                "arxiv_id": payload.arxiv_id,
                "doi": payload.doi,
                "title": payload.title,
                "authors": payload.authors,
                "journal": payload.journal,
                "year": payload.year,
                "note": payload.note,
                "now": datetime.utcnow().isoformat(),
            },
        )
        new_id = result.scalar_one()
        db.commit()
        row = db.execute(
            text("SELECT * FROM run_citations WHERE id = :id"),
            {"id": new_id},
        ).mappings().one()
        return _row_to_dict(dict(row))
    except Exception:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to save citation.")


@router.delete("/{run_id}/citations/{citation_id}")
def delete_citation(run_id: str, citation_id: int, db: Session = Depends(get_db)):
    _find_run(db, run_id)  # raw SQL below skips the run visibility filter, so check here
    _ensure_table(db)
    try:
        result = db.execute(
            text("DELETE FROM run_citations WHERE id = :id AND run_id = :rid"),
            {"id": citation_id, "rid": run_id},
        )
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to delete citation.")
    if not result.rowcount:
        raise HTTPException(status_code=404, detail="citation not found")
    return {"deleted": True, "id": citation_id}


@router.get("/{run_id}/citations/export.bib")
def export_bibtex(run_id: str, db: Session = Depends(get_db)):
    from fastapi.responses import PlainTextResponse
    _find_run(db, run_id)
    _ensure_table(db)
    try:
        rows = db.execute(
            text("SELECT * FROM run_citations WHERE run_id = :rid ORDER BY created_at ASC"),
            {"rid": run_id},
        ).mappings().all()
        bib = "\n\n".join(_fmt_bibtex(dict(r)) for r in rows)
        return PlainTextResponse(
            content=bib or "% No citations",
            media_type="application/x-bibtex",
            headers={"Content-Disposition": f'attachment; filename="qlab-{run_id[:8]}.bib"'},
        )
    except Exception:
        return PlainTextResponse(content="% No citations", media_type="application/x-bibtex")
