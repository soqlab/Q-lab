"""Marks API responses whose numbers are not measurements.

Many Labs tools began as demonstrations: they generate plausible results from formulas and random
numbers rather than running anything. A scientist must never mistake those for data. Every response
from a router listed here carries `X-QLab-Data: illustrative`, and the dashboard shows a notice on
any page that received one (frontend/app/(main)/IllustrativeNotice.tsx).

To graduate a tool, make it compute from real data or return an honest error, then remove it here.
Routers that are real except for a fallback set the header on that path instead (calibration_oracle).
"""
from __future__ import annotations

ILLUSTRATIVE_HEADER = "X-QLab-Data"
ILLUSTRATIVE_VALUE = "illustrative"

# Empty: every tool now computes from a cited source or was removed. A router added here gets the
# header on all its responses; keep it empty unless a tool genuinely cannot avoid sample data.
ILLUSTRATIVE_ROUTERS: frozenset[str] = frozenset()


class MarkIllustrativeData:
    """Adds the header once routing has settled which endpoint answered."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        async def send_marked(message):
            if message["type"] == "http.response.start":
                endpoint = scope.get("endpoint")
                module = getattr(endpoint, "__module__", "").rpartition(".")[2]
                if module in ILLUSTRATIVE_ROUTERS:
                    headers = list(message.get("headers", []))
                    headers.append((ILLUSTRATIVE_HEADER.lower().encode(), ILLUSTRATIVE_VALUE.encode()))
                    message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_marked)
