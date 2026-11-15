"""`qlab-mcp`: ask your own AI assistant about your Q-Lab runs, over MCP on your machine.

    pip install "qlab-sdk[mcp]"
    QLAB_API_URL=https://qlab.soqlab.com/qlab-api QLAB_API_KEY=qlab_... qlab-mcp --check

The assistant starts this program and talks to it over stdio; nothing listens on the network. Every
tool is a GET to Q-Lab's API with your read-only key (qlab/mcp_tools.py). Q-Lab refuses keys that can
change things and logs each tool call (name and key id) in its audit log. See docs/ASK_YOUR_ASSISTANT.md.
"""
from __future__ import annotations

import argparse
import inspect
import logging
import sys
import typing
from typing import Any

from . import mcp_tools as mt

SERVER_INSTRUCTIONS = ("Read-only access to one Q-Lab account's runs, hardware board and Rewind history. "
                       "Tool results are data from the Q-Lab API.")


def _require_mcp():
    try:
        from mcp.server.mcpserver import MCPServer
        from mcp.server.mcpserver.exceptions import ToolError
        from mcp.types import ToolAnnotations
    except ImportError:  # pragma: no cover - exercised by hand
        sys.exit('qlab-mcp needs the MCP SDK (version 2): pip install "qlab-sdk[mcp]"')
    return MCPServer, ToolAnnotations, ToolError


class ToolFailed(Exception):
    """A refusal or bad argument, already rendered as text; the MCP SDK reports it as a tool error."""


def call(client: mt.ReadOnlyClient, spec: mt.ToolSpec, **kwargs: Any) -> str:
    """Run one tool and render its answer as text for the assistant (ToolFailed if it couldn't)."""
    try:
        request, data = spec.fn(client, **kwargs)
    except mt.ToolInputError as exc:
        raise ToolFailed(mt.render(f"{spec.name} (not sent)", {"error": str(exc)})) from None
    except mt.QLabMCPError as exc:
        raise ToolFailed(mt.render(spec.name, {"error": str(exc)})) from None
    return mt.render(request, data)


def _wrap(client: mt.ReadOnlyClient, spec: mt.ToolSpec, tool_error: type[Exception]):
    """A function with the tool's own parameters (minus the client), for the MCP SDK's schema."""
    sig = inspect.signature(spec.fn)
    hints = typing.get_type_hints(spec.fn)  # the tools' annotations are strings (postponed evaluation)
    params = [p.replace(annotation=hints.get(name, p.annotation)) for name, p in sig.parameters.items()
              if name != "client"]

    def tool(**kwargs: Any) -> str:
        try:
            return call(client, spec, **kwargs)
        except ToolFailed as exc:
            raise tool_error(str(exc)) from None

    tool.__name__ = spec.name
    tool.__doc__ = spec.description
    tool.__signature__ = sig.replace(parameters=params, return_annotation=str)  # type: ignore[attr-defined]
    tool.__annotations__ = {p.name: p.annotation for p in params} | {"return": str}
    return tool


def build_server(client: mt.ReadOnlyClient):
    MCPServer, ToolAnnotations, ToolError = _require_mcp()
    server = MCPServer("qlab", instructions=SERVER_INSTRUCTIONS)
    for spec in mt.TOOLS:
        server.tool(name=spec.name, title=spec.title, description=spec.description,
                    annotations=ToolAnnotations(title=spec.title, read_only_hint=True, destructive_hint=False,
                                                idempotent_hint=True, open_world_hint=False),
                    structured_output=False)(_wrap(client, spec, ToolError))
    return server


def check(client: mt.ReadOnlyClient) -> int:
    """Try the configuration once and say, in words, whether an assistant can use it."""
    problems = client.config.problems()
    if problems:
        for p in problems:
            print(p, file=sys.stderr)
        return 2
    try:
        client.get("check_access", "/api/v1/users/me")
    except mt.QLabMCPError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(f"OK: {client.config.api_url} accepts this key, and it is read-only. "
          f"{len(mt.TOOLS)} tools are available to your assistant.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="qlab-mcp", description="Q-Lab's read-only MCP server (stdio).")
    parser.add_argument("--api-url", help="Q-Lab API address (default: $QLAB_API_URL or http://localhost:8000). "
                                          "The key is read from $QLAB_API_KEY only.")
    parser.add_argument("--check", action="store_true", help="test the address and key, then exit")
    args = parser.parse_args(argv)

    client = mt.ReadOnlyClient(mt.Config.from_env(args.api_url))
    try:
        if args.check:
            return check(client)
        # stdout is the protocol; httpx would log each URL (with its query) at INFO.
        logging.getLogger("httpx").setLevel(logging.WARNING)
        build_server(client).run("stdio")
        return 0
    finally:
        client.close()


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
