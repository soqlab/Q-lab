"""Pytest configuration for Q-Lab backend tests.

Sets QLAB_DB_PATH to :memory: before any app import so every test run
starts with a fresh, empty database and never touches the production data file.
"""

import os

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
