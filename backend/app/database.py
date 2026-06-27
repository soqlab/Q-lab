import os
from pathlib import Path
from typing import Generator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_DATABASE_URL = f"sqlite:///{DATA_DIR / 'qlab.db'}"
DATABASE_URL = os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)

engine_kwargs: dict = {}
if DATABASE_URL.startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}
    if DATABASE_URL in {"sqlite:///:memory:", "sqlite://"}:
        engine_kwargs["poolclass"] = StaticPool

engine = create_engine(DATABASE_URL, pool_pre_ping=True, **engine_kwargs)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def init_db() -> None:
    from . import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _ensure_compat_columns()
    _ensure_fts()


def _col(name: str, col_type: str, nullable: bool = True) -> str:
    """Build an ALTER TABLE ADD COLUMN statement fragment."""
    if DATABASE_URL.startswith("sqlite"):
        json_type = "JSON"
        return f"ALTER TABLE runs ADD COLUMN {name} {json_type if col_type == 'json' else col_type}"
    else:
        json_type = "JSONB DEFAULT '{}'::jsonb"
        if col_type == "json":
            return f"ALTER TABLE runs ADD COLUMN {name} JSONB DEFAULT '{{}}'"
        return f"ALTER TABLE runs ADD COLUMN {name} {col_type}"


def _ensure_compat_columns() -> None:
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())

    # Add email_verified / verify_token columns to users if missing.
    # Mark ALL existing rows as verified — only new registrations go through the flow.
    if "users" in tables:
        user_cols = {c["name"] for c in inspector.get_columns("users")}
        with engine.begin() as conn:
            if "email_verified" not in user_cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN email_verified BOOLEAN DEFAULT FALSE"))
                conn.execute(text("UPDATE users SET email_verified = TRUE"))
            if "verify_token" not in user_cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN verify_token VARCHAR(128)"))
            if "verify_token_expires" not in user_cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN verify_token_expires REAL"))
            # Any user without a pending verify token was created before the
            # verification feature — mark them as already verified.
            conn.execute(text(
                "UPDATE users SET email_verified = TRUE WHERE verify_token IS NULL AND email_verified = FALSE"
            ))

    if "runs" not in tables:
        return

    columns = {c["name"] for c in inspector.get_columns("runs")}

    json_cols = [
        "execution", "results", "calibration", "transpiler", "timing",
    ]
    nullable_cols = [
        ("org_id", "INTEGER"),
        ("created_by_user_id", "INTEGER"),
        ("benchmark_id", "VARCHAR(64)"),
    ]

    with engine.begin() as conn:
        for col in json_cols:
            if col not in columns:
                if DATABASE_URL.startswith("sqlite"):
                    conn.execute(text(f"ALTER TABLE runs ADD COLUMN {col} JSON DEFAULT '{{}}'"))
                else:
                    conn.execute(text(f"ALTER TABLE runs ADD COLUMN {col} JSONB DEFAULT '{{}}'::jsonb"))

        for col, col_type in nullable_cols:
            if col not in columns:
                conn.execute(text(f"ALTER TABLE runs ADD COLUMN {col} {col_type}"))


def _ensure_fts() -> None:
    """Create SQLite FTS5 virtual tables if they don't exist (no-op for Postgres)."""
    if not DATABASE_URL.startswith("sqlite"):
        return
    try:
        with engine.begin() as conn:
            conn.execute(text("""
                CREATE VIRTUAL TABLE IF NOT EXISTS runs_fts USING fts5(
                    run_id UNINDEXED,
                    circuit_name,
                    backend,
                    project_slug,
                    tags,
                    content='runs',
                    content_rowid='id'
                )
            """))
            # Populate on first create (if runs table has data)
            conn.execute(text("""
                INSERT INTO runs_fts(runs_fts) VALUES('rebuild')
            """))
            # Triggers to keep FTS in sync
            conn.execute(text("""
                CREATE TRIGGER IF NOT EXISTS runs_fts_insert AFTER INSERT ON runs BEGIN
                    INSERT INTO runs_fts(rowid, run_id, circuit_name, backend, project_slug, tags)
                    VALUES (new.id, new.run_id, COALESCE(new.circuit_name,''), COALESCE(new.backend,''), COALESCE(new.project_slug,''), COALESCE(new.tags,''));
                END
            """))
            conn.execute(text("""
                CREATE TRIGGER IF NOT EXISTS runs_fts_delete AFTER DELETE ON runs BEGIN
                    INSERT INTO runs_fts(runs_fts, rowid, run_id, circuit_name, backend, project_slug, tags)
                    VALUES('delete', old.id, old.run_id, COALESCE(old.circuit_name,''), COALESCE(old.backend,''), COALESCE(old.project_slug,''), COALESCE(old.tags,''));
                END
            """))
            conn.execute(text("""
                CREATE TRIGGER IF NOT EXISTS runs_fts_update AFTER UPDATE ON runs BEGIN
                    INSERT INTO runs_fts(runs_fts, rowid, run_id, circuit_name, backend, project_slug, tags)
                    VALUES('delete', old.id, old.run_id, COALESCE(old.circuit_name,''), COALESCE(old.backend,''), COALESCE(old.project_slug,''), COALESCE(old.tags,''));
                    INSERT INTO runs_fts(rowid, run_id, circuit_name, backend, project_slug, tags)
                    VALUES (new.id, new.run_id, COALESCE(new.circuit_name,''), COALESCE(new.backend,''), COALESCE(new.project_slug,''), COALESCE(new.tags,''));
                END
            """))
    except Exception:
        pass  # Never crash startup if FTS setup fails


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
