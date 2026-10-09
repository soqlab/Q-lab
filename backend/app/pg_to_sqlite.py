"""One-time copy of a Postgres database into the SQLite file Q-Lab is configured to use.

Triggered from init_db() when MIGRATE_FROM_DATABASE_URL is set and the SQLite file does not exist
yet. The copy is written to a temporary file and renamed into place only once every table's row
count matches, so a failed run leaves nothing half-done and the next start simply tries again.
Remove MIGRATE_FROM_DATABASE_URL once the switch is confirmed.
"""
from __future__ import annotations

import datetime as dt
import decimal
import json
import logging
import os
import uuid
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import JSON, MetaData, Table, create_engine, inspect, select, text
from sqlalchemy import types as satypes

log = logging.getLogger("qlab.migrate")
BATCH = 1000


@contextmanager
def _exclusive(lock_path: Path):
    # Two uvicorn workers import the app at the same time; only one may copy.
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    fh = open(lock_path, "w")
    try:
        try:
            import fcntl
            fcntl.flock(fh, fcntl.LOCK_EX)
        except ImportError:  # Windows, for local testing
            import msvcrt
            msvcrt.locking(fh.fileno(), msvcrt.LK_LOCK, 1)
        yield
    finally:
        fh.close()


def _sqlite_type(col_type) -> str:
    if isinstance(col_type, (satypes.Integer, satypes.BigInteger, satypes.SmallInteger)):
        return "INTEGER"
    if isinstance(col_type, (satypes.Float, satypes.Numeric)):
        return "REAL"
    if isinstance(col_type, satypes.Boolean):
        return "BOOLEAN"
    if isinstance(col_type, (satypes.DateTime, satypes.Date, satypes.Time)):
        return "DATETIME"
    if isinstance(col_type, (satypes.JSON, satypes.ARRAY)) or col_type.__class__.__name__ in ("JSONB", "JSON"):
        return "JSON"
    if isinstance(col_type, satypes.LargeBinary):
        return "BLOB"
    return "TEXT"


def _plain(value, target_is_json: bool):
    if isinstance(value, (dict, list)):
        return value if target_is_json else json.dumps(value, default=str)
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, decimal.Decimal):
        return float(value)
    if isinstance(value, dt.datetime) and value.tzinfo is not None:
        return value.astimezone(dt.timezone.utc).replace(tzinfo=None)
    if isinstance(value, memoryview):
        return bytes(value)
    return value


def copy_database(source_url: str, target_path: Path) -> dict[str, int]:
    from .database import Base
    from . import models  # noqa: F401  (registers every ORM table on Base.metadata)

    tmp = target_path.with_suffix(target_path.suffix + ".migrating")
    tmp.unlink(missing_ok=True)
    src = create_engine(source_url, pool_pre_ping=True)
    dst = create_engine(f"sqlite:///{tmp}")
    try:
        Base.metadata.create_all(dst)

        src_meta = MetaData()
        src_meta.reflect(bind=src)
        dst_tables = set(inspect(dst).get_table_names())
        # Tables some features create on first use: same columns, SQLite types.
        with dst.begin() as conn:
            for name, t in src_meta.tables.items():
                if name in dst_tables:
                    continue
                cols = []
                pk = [c.name for c in t.primary_key.columns]
                for c in t.columns:
                    decl = f'"{c.name}" {_sqlite_type(c.type)}'
                    if pk == [c.name] and _sqlite_type(c.type) == "INTEGER":
                        decl += " PRIMARY KEY"
                    cols.append(decl)
                if len(pk) > 1 or (pk and not any("PRIMARY KEY" in d for d in cols)):
                    cols.append("PRIMARY KEY (" + ", ".join(f'"{p}"' for p in pk) + ")")
                conn.execute(text(f'CREATE TABLE "{name}" ({", ".join(cols)})'))

        dst_meta = MetaData()
        dst_meta.reflect(bind=dst)
        counts: dict[str, int] = {}
        with src.connect() as s, dst.begin() as d:
            for name, st in src_meta.tables.items():
                dt_table: Table = dst_meta.tables[name]
                shared = [c.name for c in st.columns if c.name in dt_table.c]
                json_cols = {c.name for c in dt_table.columns if isinstance(c.type, JSON)}
                result = s.execution_options(stream_results=True).execute(select(*[st.c[c] for c in shared]))
                n = 0
                while True:
                    rows = result.fetchmany(BATCH)
                    if not rows:
                        break
                    d.execute(dt_table.insert(), [
                        {c: _plain(v, c in json_cols) for c, v in zip(shared, row)} for row in rows])
                    n += len(rows)
                counts[name] = n

        with src.connect() as s, dst.connect() as d:
            for name in counts:
                a = s.execute(text(f'SELECT COUNT(*) FROM "{name}"')).scalar()
                b = d.execute(text(f'SELECT COUNT(*) FROM "{name}"')).scalar()
                if a != b:
                    raise RuntimeError(f"row count mismatch in {name}: postgres={a} sqlite={b}")
    finally:
        src.dispose()
        dst.dispose()
    os.replace(tmp, target_path)
    return counts


def migrate_once(source_url: str, target_path: Path) -> None:
    with _exclusive(target_path.with_suffix(target_path.suffix + ".lock")):
        if target_path.exists():
            return
        log.warning("[qlab] copying Postgres into %s ...", target_path)
        counts = copy_database(source_url, target_path)
        log.warning("[qlab] migration done: %d tables, %d rows -> %s",
                    len(counts), sum(counts.values()), target_path)
        for name, n in sorted(counts.items()):
            log.warning("[qlab]   %-40s %d", name, n)
