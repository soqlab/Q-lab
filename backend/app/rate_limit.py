"""Sliding-window rate limiter as a FastAPI dependency."""
import time
import threading
from collections import deque

from fastapi import HTTPException, Request


class RateLimiter:
    def __init__(self, max_calls: int, period: int = 60):
        self.max_calls = max_calls
        self.period = period
        self._windows: dict[str, deque] = {}
        self._lock = threading.Lock()

    def check(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            if key not in self._windows:
                self._windows[key] = deque()
            window = self._windows[key]
            cutoff = now - self.period
            while window and window[0] < cutoff:
                window.popleft()
            if len(window) >= self.max_calls:
                raise HTTPException(
                    status_code=429,
                    detail="Too many requests — please slow down.",
                    headers={"Retry-After": str(self.period)},
                )
            window.append(now)

    def _cleanup(self) -> None:
        now = time.monotonic()
        cutoff = now - self.period
        empty = [k for k, dq in self._windows.items() if not dq or dq[-1] < cutoff]
        for k in empty:
            del self._windows[k]

    def __call__(self, request: Request) -> None:
        # Respect X-Forwarded-For when behind a reverse proxy (Render, Cloudflare, nginx)
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            ip = forwarded.split(",")[0].strip()
        else:
            ip = request.client.host if request.client else "unknown"
        with self._lock:
            if len(self._windows) > 10000:
                self._cleanup()
        self.check(ip)


# Shared limiter instances
auth_limiter = RateLimiter(max_calls=10, period=60)   # 10 auth attempts / min / IP
write_limiter = RateLimiter(max_calls=300, period=60)  # 300 writes / min / IP
read_limiter = RateLimiter(max_calls=600, period=60)   # 600 reads / min / IP
pick_limiter = RateLimiter(max_calls=12, period=60)  # machine-pick estimates (CPU) / min / IP
rewind_run_limiter = RateLimiter(max_calls=6, period=60)  # Rewind replays without an account / min / IP
rewind_run_user_limiter = RateLimiter(max_calls=20, period=60)  # Rewind replays / min / account
rewind_compare_limiter = RateLimiter(max_calls=2, period=600)  # Rewind comparisons (12 replays each) without an account / 10 min / IP
rewind_compare_user_limiter = RateLimiter(max_calls=6, period=600)  # Rewind comparisons / 10 min / account
rewind_pulse_limiter = RateLimiter(max_calls=60, period=60)  # the soqlab.com pulse line / min / IP
papers_find_limiter = RateLimiter(max_calls=6, period=600)  # papers fetched from arXiv/GitHub without an account / 10 min / IP
papers_find_user_limiter = RateLimiter(max_calls=30, period=600)  # papers fetched / 10 min / account
