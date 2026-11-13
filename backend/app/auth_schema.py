"""Schema step for sign-in without email: users.email becomes optional on existing databases.

The hosted server and most self-hosted installs never run Alembic; init_db() brings their schema
up to date at startup. create_all() adds the new recovery_codes table but can't relax an existing
NOT NULL column, so this does it, once, and only if it is still needed:

- Postgres: ALTER TABLE users ALTER COLUMN email DROP NOT NULL.
- SQLite can't drop NOT NULL in place. It follows SQLite's own procedure for changing a table
  (https://sqlite.org/lang_altertable.html#otheralter): inside one transaction, create the table
  again from its stored definition with only "NOT NULL" removed from the email column, copy every
  row, drop the old table, rename the new one and recreate its indexes. Nothing else about the
  table changes, ids are kept, and other tables keep referring to it by name. If any step fails
  the transaction rolls back and the old table is untouched.

Alembic 005_usernameless_accounts makes the same change for installs that use Alembic.
"""
from __future__ import annotations

import re

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

_EMAIL_NOT_NULL = re.compile(r'("?email"?\s+VARCHAR(?:\s*\(\s*\d+\s*\))?)\s+NOT\s+NULL', re.IGNORECASE)


def email_is_required(engine: Engine) -> bool:
    cols = {c["name"]: c for c in inspect(engine).get_columns("users")}
    return "email" in cols and not cols["email"]["nullable"]


def relax_users_email(engine: Engine) -> bool:
    """Make users.email nullable if it isn't. Returns True if it changed anything."""
    if "users" not in inspect(engine).get_table_names() or not email_is_required(engine):
        return False
    if engine.dialect.name == "postgresql":
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE users ALTER COLUMN email DROP NOT NULL"))
        return True
    if engine.dialect.name != "sqlite":
        return False  # other databases: use Alembic (005_usernameless_accounts)
    _relax_sqlite(engine)
    return True


def _relax_sqlite(engine: Engine) -> None:
    # The raw sqlite3 connection in autocommit mode, with BEGIN/COMMIT issued here: Python's
    # sqlite3 module would otherwise run the CREATE TABLE outside any transaction.
    with engine.connect() as conn:
        raw = conn.connection.driver_connection
        previous_isolation = raw.isolation_level
        raw.isolation_level = None
        cur = raw.cursor()
        try:
            table_sql = cur.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").fetchone()[0]
            new_sql, n = _EMAIL_NOT_NULL.subn(r"\1", table_sql or "", count=1)
            if n != 1:
                raise RuntimeError("users.email: could not find its NOT NULL definition to relax")
            new_sql = re.sub(r'^\s*CREATE\s+TABLE\s+"?users"?', "CREATE TABLE users__new", new_sql, count=1,
                             flags=re.IGNORECASE)
            index_sql = [r[0] for r in cur.execute(
                "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='users' AND sql IS NOT NULL")]
            columns = [r[1] for r in cur.execute("PRAGMA table_info(users)")]
            col_list = ", ".join(f'"{c}"' for c in columns)
            fk_before = cur.execute("PRAGMA foreign_keys").fetchone()[0]
            cur.execute("PRAGMA foreign_keys=OFF")  # no effect inside a transaction, so set first
            try:
                cur.execute("BEGIN IMMEDIATE")
                try:
                    cur.execute("DROP TABLE IF EXISTS users__new")
                    cur.execute(new_sql)
                    cur.execute(f"INSERT INTO users__new ({col_list}) SELECT {col_list} FROM users")
                    cur.execute("DROP TABLE users")
                    cur.execute("ALTER TABLE users__new RENAME TO users")
                    for sql in index_sql:
                        cur.execute(sql)
                    cur.execute("COMMIT")
                except Exception:
                    cur.execute("ROLLBACK")
                    raise
            finally:
                cur.execute(f"PRAGMA foreign_keys={'ON' if fk_before else 'OFF'}")
        finally:
            cur.close()
            raw.isolation_level = previous_isolation
