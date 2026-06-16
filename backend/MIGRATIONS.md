# Database Migrations

Q-Lab uses Alembic for schema migrations.

## Development

`init_db()` in `app/database.py` auto-creates all tables on startup (fine for SQLite dev).

## Production

```bash
# Apply all pending migrations
alembic upgrade head

# Check current migration state
alembic current

# Generate a new migration after model changes
alembic revision --autogenerate -m "describe_change"

# Rollback one step
alembic downgrade -1
```

## SQLite note

`render_as_batch=True` is set in `alembic/env.py` to handle SQLite's limited ALTER TABLE
support. SQLite does not allow adding NOT NULL columns without defaults, renaming columns,
or dropping columns directly — Alembic's batch mode rebuilds the affected table transparently.

## File layout

```
backend/
  alembic.ini                        # Alembic configuration (script_location = alembic)
  alembic/
    env.py                           # Loads DATABASE_URL + Base.metadata, runs migrations
    script.py.mako                   # Template for generated migration files
    versions/
      001_initial_schema.py          # Idempotent initial migration covering all tables
```
