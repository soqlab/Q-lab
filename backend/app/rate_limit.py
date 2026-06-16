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

    def __call__(self, request: Request) -> None:
        ip = request.client.host if request.client else "unknown"
        self.check(ip)


# Shared limiter instances
auth_limiter = RateLimiter(max_calls=10, period=60)   # 10 auth attempts / min / IP
write_limiter = RateLimiter(max_calls=300, period=60)  # 300 writes / min / IP
read_limiter = RateLimiter(max_calls=600, period=60)   # 600 reads / min / IP
