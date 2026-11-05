"""Pytest configuration for Q-Lab backend tests.

Sets QLAB_DB_PATH to :memory: before any app import so every test run
starts with a fresh, empty database and never touches the production data file.
"""

import os

import pytest

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")


@pytest.fixture(autouse=True)
def _fresh_rate_limits():
    """Tests sign up many accounts from one address, which the sign-up limiter rightly refuses."""
    from app import rate_limit

    for limiter in vars(rate_limit).values():
        if isinstance(limiter, rate_limit.RateLimiter):
            limiter._windows.clear()
    yield
