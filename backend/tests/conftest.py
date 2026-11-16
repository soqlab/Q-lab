"""Pytest configuration for Q-Lab backend tests.

Sets QLAB_DB_PATH to :memory: before any app import so every test run
starts with a fresh, empty database and never touches the production data file.
"""

import os
import tempfile

import pytest

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
# Witness signing keys for the test run, never the data directory of a real install.
os.environ.setdefault("QLAB_WITNESS_KEY_DIR", os.path.join(tempfile.mkdtemp(), "witness-keys"))


@pytest.fixture(autouse=True)
def _fresh_rate_limits():
    """Tests sign up many accounts from one address, which the sign-up limiter rightly refuses."""
    from app import rate_limit

    for limiter in vars(rate_limit).values():
        if isinstance(limiter, rate_limit.RateLimiter):
            limiter._windows.clear()
    yield
