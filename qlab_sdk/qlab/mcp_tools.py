"""The read-only tools behind `qlab-mcp` (qlab/mcp_server.py), without the MCP SDK.

Each tool is one GET request to Q-Lab's public API with your own read-only key, so the server applies
the same sign-in and ownership checks as everywhere else, and records the call in its audit log
(the `X-Client: mcp/<tool>` header names the tool). Nothing here can change anything: the client only
issues GET requests, and the server refuses anything else from an assistant.

Whatever comes back is passed on as data: bounded in size, control characters removed, and wrapped
with the request it came from.
"""
from __future__ import annotations

import ipaddress
import json
import os
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import quote, urlsplit

import httpx

DEFAULT_TIMEOUT_S = 30.0
MAX_RESPONSE_BYTES = 2_000_000   # read from the server
MAX_OUTPUT_CHARS = 12_000        # handed to the assistant
MAX_STRING = 1_000
MAX_ITEMS = 25
MAX_KEYS = 60
MAX_DEPTH = 6

RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")
OUTCOME_RE = re.compile(r"^[01 ]{1,200}$")
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{1,60}$")
PROJECT_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _.-]{0,119}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f​-‏‪-‮⁦-⁩]")

RUN_FIELDS = ("run_id", "circuit_name", "backend", "provider", "status", "project", "tags", "created_at",
              "health_score", "dashboard_url")


class ToolInputError(ValueError):
    """An argument that can't be sent (the message says which and why)."""


class QLabMCPError(RuntimeError):
    """Q-Lab refused or could not answer; the message is safe to show."""


@dataclass
class Config:
    api_url: str
    api_key: str
    timeout_s: float = DEFAULT_TIMEOUT_S

    @classmethod
    def from_env(cls, api_url: str | None = None) -> Config:
        url = (api_url or os.getenv("QLAB_API_URL") or "http://localhost:8000").strip().rstrip("/")
        key = (os.getenv("QLAB_API_KEY") or "").strip()
        return cls(api_url=url, api_key=key)

    def problems(self) -> list[str]:
        """What is wrong with this configuration, in words a person can act on."""
        out = []
        parts = urlsplit(self.api_url)
        if parts.scheme not in ("http", "https") or not parts.hostname:
            out.append(f"QLAB_API_URL must be an http(s) address, not {self.api_url!r}.")
        elif parts.scheme == "http" and not _local(parts.hostname) and os.getenv("QLAB_MCP_ALLOW_HTTP") != "1":
            out.append("QLAB_API_URL uses plain http to another machine, which would send your key unencrypted. "
                       "Use https, or set QLAB_MCP_ALLOW_HTTP=1 if this is a trusted private network.")
        if not self.api_key:
            out.append("QLAB_API_KEY is not set. Create a read-only key in Q-Lab (Settings, API keys, "
                       "tick \"Read-only\") and put it in your assistant's MCP settings.")
        elif not self.api_key.startswith("qlab_"):
            out.append("QLAB_API_KEY should be a Q-Lab API key (it starts with qlab_).")
        return out


def _local(host: str) -> bool:
    if host in ("localhost",):
        return True
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        return False
    return addr.is_loopback


def clean(value: Any, depth: int = 0) -> tuple[Any, bool]:
    """A bounded copy of decoded JSON: (value, whether anything was cut)."""
    if isinstance(value, str):
        text = _CONTROL.sub("", value)
        if len(text) > MAX_STRING:
            return text[:MAX_STRING] + " [...]", True
        return text, False
    if value is None or isinstance(value, (bool, int, float)):
        return value, False
    if depth >= MAX_DEPTH:
        return "[nested data left out]", True
    cut = False
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for i, (k, v) in enumerate(value.items()):
            if i >= MAX_KEYS:
                out["[more fields left out]"] = len(value) - MAX_KEYS
                cut = True
                break
            key, _ = clean(str(k)[:100], depth + 1)
            out[key], c = clean(v, depth + 1)
            cut = cut or c
        return out, cut
    if isinstance(value, (list, tuple)):
        items = []
        for v in list(value)[:MAX_ITEMS]:
            item, c = clean(v, depth + 1)
            items.append(item)
            cut = cut or c
        if len(value) > MAX_ITEMS:
            items.append(f"[{len(value) - MAX_ITEMS} more items left out]")
            cut = True
        return items, cut
    return clean(str(value), depth)


def render(request: str, data: Any) -> str:
    """The text an assistant receives: the request it answers, then the bounded data, as JSON."""
    body, cut = clean(data)
    text = json.dumps({"source": "Q-Lab", "request": request, "truncated": cut, "data": body},
                      ensure_ascii=False, separators=(",", ":"), default=str)
    if len(text) > MAX_OUTPUT_CHARS:
        text = json.dumps({"source": "Q-Lab", "request": request, "truncated": True,
                           "data_excerpt": text[:MAX_OUTPUT_CHARS - 300]}, ensure_ascii=False)
    return text


class ReadOnlyClient:
    """GET-only HTTP client for one Q-Lab server. There is no method that sends anything else."""

    def __init__(self, config: Config, transport: httpx.BaseTransport | None = None):
        self.config = config
        self._http = httpx.Client(base_url=config.api_url, timeout=config.timeout_s, follow_redirects=False,
                                  transport=transport)

    def close(self) -> None:
        self._http.close()

    def get(self, tool: str, path: str, params: dict[str, Any] | None = None) -> Any:
        problems = self.config.problems()
        if problems:
            raise QLabMCPError(" ".join(problems))
        headers = {"X-QLab-API-Key": self.config.api_key, "X-Client": f"mcp/{tool}",
                   "Accept": "application/json", "User-Agent": "qlab-mcp"}
        query = {k: v for k, v in (params or {}).items() if v is not None}
        try:
            with self._http.stream("GET", path, params=query, headers=headers) as resp:
                raw = bytearray()
                for chunk in resp.iter_bytes():
                    raw.extend(chunk)
                    if len(raw) > MAX_RESPONSE_BYTES:
                        raise QLabMCPError("Q-Lab's answer was too large to pass on.")
                status = resp.status_code
        except httpx.TimeoutException:
            raise QLabMCPError("Q-Lab did not answer in time.") from None
        except httpx.HTTPError as exc:
            raise QLabMCPError(f"Could not reach Q-Lab at {self.config.api_url} ({type(exc).__name__}).") from None
        try:
            payload = json.loads(bytes(raw).decode("utf-8")) if raw else None
        except (ValueError, UnicodeDecodeError):
            payload = None
        if status >= 400:
            detail = payload.get("detail") if isinstance(payload, dict) else None
            if not isinstance(detail, str):
                detail = f"HTTP {status}"
            raise QLabMCPError(f"Q-Lab refused: {clean(detail)[0][:500]} (HTTP {status})")
        if 300 <= status < 400:
            raise QLabMCPError(f"Q-Lab answered with a redirect (HTTP {status}); check QLAB_API_URL.")
        if payload is None:
            raise QLabMCPError("Q-Lab's answer was not JSON; check QLAB_API_URL points at the API.")
        return payload


def _check(value: str, pattern: re.Pattern[str], what: str) -> str:
    value = (value or "").strip()
    if not pattern.match(value):
        raise ToolInputError(f"{what} {value[:80]!r} is not valid.")
    return value


def _q(value: str) -> str:
    return quote(value, safe="")


# ----------------------------------------------------------------------------------------------
# The tools. Each returns (request description, data); mcp_server.py renders it.
# ----------------------------------------------------------------------------------------------

def list_recent_runs(client: ReadOnlyClient, limit: int = 10, project: str | None = None,
                     backend: str | None = None, status: str | None = None) -> tuple[str, Any]:
    limit = max(1, min(int(limit), 50))
    params = {"limit": limit,
              "project": _check(project, PROJECT_RE, "Project") if project else None,
              "backend": _check(backend, NAME_RE, "Backend") if backend else None,
              "status": _check(status, NAME_RE, "Status") if status else None}
    runs = client.get("list_recent_runs", "/api/v1/runs", params)
    slim = [{k: r.get(k) for k in RUN_FIELDS if k in r} | {
        "num_qubits": (r.get("fingerprint") or {}).get("num_qubits"),
        "shots": (r.get("execution") or {}).get("shots")} for r in (runs if isinstance(runs, list) else [])]
    return "GET /api/v1/runs", slim


def run_summary(client: ReadOnlyClient, run_id: str) -> tuple[str, Any]:
    rid = _check(run_id, RUN_ID_RE, "Run id")
    return f"GET /api/v1/runs/{rid}/answer", client.get("run_summary", f"/api/v1/runs/{_q(rid)}/answer")


def compare_runs(client: ReadOnlyClient, run_a: str, run_b: str) -> tuple[str, Any]:
    a = _check(run_a, RUN_ID_RE, "Run id")
    b = _check(run_b, RUN_ID_RE, "Run id")
    return (f"GET /api/v1/runs/{a}/explain-diff/{b}",
            client.get("compare_runs", f"/api/v1/runs/{_q(a)}/explain-diff/{_q(b)}"))


def why_outcome(client: ReadOnlyClient, run_id: str, outcome: str) -> tuple[str, Any]:
    rid = _check(run_id, RUN_ID_RE, "Run id")
    bits = _check(outcome, OUTCOME_RE, "Outcome (a measured bitstring such as 0110)")
    return (f"GET /api/v1/runs/{rid}/why",
            client.get("why_outcome", f"/api/v1/runs/{_q(rid)}/why", {"outcome": bits}))


def run_drift(client: ReadOnlyClient, run_id: str) -> tuple[str, Any]:
    rid = _check(run_id, RUN_ID_RE, "Run id")
    return f"GET /api/v1/runs/{rid}/drift", client.get("run_drift", f"/api/v1/runs/{_q(rid)}/drift")


def run_across_time(client: ReadOnlyClient, run_id: str) -> tuple[str, Any]:
    rid = _check(run_id, RUN_ID_RE, "Run id")
    return f"GET /api/v1/runs/{rid}/timeline", client.get("run_across_time", f"/api/v1/runs/{_q(rid)}/timeline")


def run_forecast(client: ReadOnlyClient, run_id: str) -> tuple[str, Any]:
    rid = _check(run_id, RUN_ID_RE, "Run id")
    return (f"GET /api/v1/runs/{rid}/timeline/forecast",
            client.get("run_forecast", f"/api/v1/runs/{_q(rid)}/timeline/forecast"))


def hardware_board(client: ReadOnlyClient, backend: str | None = None) -> tuple[str, Any]:
    if backend:
        name = _check(backend, NAME_RE, "Backend")
        path = f"/api/v1/public/hardware-board/{_q(name)}"
    else:
        path = "/api/v1/public/hardware-board"
    return f"GET {path}", client.get("hardware_board", path)


def machines_available(client: ReadOnlyClient) -> tuple[str, Any]:
    return ("GET /api/v1/machine-pick/calibration",
            client.get("machines_available", "/api/v1/machine-pick/calibration"))


def rewind_status(client: ReadOnlyClient, machine: str | None = None) -> tuple[str, Any]:
    if machine:
        name = _check(machine, NAME_RE, "Machine")
        path = f"/api/v1/rewind/machines/{_q(name)}/days"
    else:
        path = "/api/v1/rewind/machines"
    return f"GET {path}", client.get("rewind_status", path)


@dataclass(frozen=True)
class ToolSpec:
    name: str
    title: str
    description: str
    fn: Callable[..., tuple[str, Any]] = field(compare=False)


# Descriptions say what each tool returns; they never tell the assistant what to do.
TOOLS: tuple[ToolSpec, ...] = (
    ToolSpec("list_recent_runs", "Recent runs",
             "Your most recent Q-Lab runs (newest first): run id, circuit, backend, status, project, time, "
             "health score, qubits and shots. Optional filters: project, backend, status; limit 1-50.",
             list_recent_runs),
    ToolSpec("run_summary", "Run summary",
             "The one-sentence answer for one run and the facts behind it (result, comparison with the "
             "previous similar run).", run_summary),
    ToolSpec("compare_runs", "Compare two runs",
             "How two runs' measured counts differ, and whether shot noise, compiler changes or calibration "
             "drift explains the difference.", compare_runs),
    ToolSpec("why_outcome", "Why this outcome",
             "Which calibrated error sources make a given measured bitstring likely for a run, found by "
             "switching each source off in simulation.", why_outcome),
    ToolSpec("run_drift", "Did it get worse",
             "Whether the same circuit on the same backend gave a different result last time, and which "
             "recorded change explains it.", run_drift),
    ToolSpec("run_across_time", "Run across time",
             "The days with stored calibrations for a run's IBM machine, the run's own result and how "
             "accurate replays have been.", run_across_time),
    ToolSpec("run_forecast", "Run forecast",
             "For a run's circuit: which machine and hour look best over the coming days, from stored "
             "calibrations.", run_forecast),
    ToolSpec("hardware_board", "Hardware board",
             "Q-Lab's public board of IBM machines: live readings and benchmark results; optionally one "
             "backend. Not affiliated with IBM.", hardware_board),
    ToolSpec("machines_available", "Machines with calibration",
             "Which machines currently have calibration data this server can estimate from, with queue "
             "length and calibration time.", machines_available),
    ToolSpec("rewind_status", "Rewind",
             "Rewind's stored calibration history: machines, snapshot counts and first/last day; with a "
             "machine name, the days a replay can use. Replays only; not affiliated with IBM.", rewind_status),
)
