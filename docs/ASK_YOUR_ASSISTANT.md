# Ask your assistant

Ask your own AI assistant about your Q-Lab runs ("why did last night's run get worse?", "compare
run A and run B", "which machine should this circuit run on this week?") without opening the
dashboard. `qlab-mcp` is a small [MCP](https://modelcontextprotocol.io) server that runs on your
machine. Your assistant starts it and talks to it over stdio; it opens no network port.

It can only read. Every tool is one `GET` to Q-Lab's API with your own read-only key, so you see
exactly what the dashboard would show you, and nothing else. It works with the hosted Q-Lab and
with a self-hosted server.

## 1. Make a read-only key

In Q-Lab, open **Settings, API keys**, name the key (for example "assistant"), tick
**Read-only** and create it. Copy it: it is shown once.

Q-Lab refuses an assistant that uses any other key: a full key (the kind the SDK uploads runs
with), a sign-in token, or no key. The refusal says to make a read-only key.

## 2. Install

```bash
pip install "qlab-sdk[mcp]"
QLAB_API_URL=https://qlab.soqlab.com/qlab-api QLAB_API_KEY=qlab_... qlab-mcp --check
```

`--check` tries the address and key once and says whether an assistant can use them. For a
self-hosted server, use its API address (for example `http://localhost:8000`). Plain `http` to
another machine is refused unless you set `QLAB_MCP_ALLOW_HTTP=1`, because the key would travel
unencrypted.

## 3. Add it to your assistant

Most MCP clients (Claude Desktop, Claude Code and others) take a JSON entry like this:

```json
{
  "mcpServers": {
    "qlab": {
      "command": "qlab-mcp",
      "env": {
        "QLAB_API_URL": "https://qlab.soqlab.com/qlab-api",
        "QLAB_API_KEY": "qlab_your_read_only_key"
      }
    }
  }
}
```

If `qlab-mcp` isn't on the assistant's PATH, give the full path (or use `"command": "python",
"args": ["-m", "qlab.mcp_server"]` with the Python you installed it into). The key goes in `env`,
never in `args`, so it doesn't show up in process lists.

## Tools

| Tool | What it reads |
|---|---|
| `list_recent_runs` | your latest runs (filters: project, backend, status; up to 50) |
| `run_summary` | a run's one-sentence answer and the facts behind it |
| `compare_runs` | why two runs differ: shot noise, compiler or calibration drift |
| `why_outcome` | which error sources make a measured bitstring likely for a run |
| `run_drift` | whether the same circuit did better last time, and what changed |
| `run_across_time` | the run's machine across stored calibration days |
| `run_forecast` | which machine and hour look best for the run's circuit |
| `hardware_board` | the public hardware board (one backend or all) |
| `machines_available` | which machines this server has calibration for now |
| `rewind_status` | Rewind's stored history, or one machine's replay days |

Hardware and Rewind data come from IBM-published calibration; Q-Lab is not affiliated with IBM.
On a server with no IBM key those tools say so instead of showing anything.

## What is logged

Every tool call is written to the server's audit log as `mcp.tool_call`, with the tool name, the
key's id and prefix, the method, the path (without query string), the status code, the time and
the address it came from. The key itself and the answers are never logged.

## Limits

- **Read-only, enforced by the server.** A read-only key can only `GET`; anything else is refused
  before it reaches an endpoint, whether or not it comes from an assistant. An assistant-marked
  request (`X-Client: mcp/<tool>`) is refused unless it is a `GET` with a valid read-only key and no
  sign-in token.
- **Bounded answers.** Each answer is cut to about 12,000 characters (long text, long lists and deep
  nesting are shortened and marked), control characters are removed, and the answer is wrapped as
  JSON naming the request it came from. Answers over 2 MB, redirects and non-JSON replies are refused.
- **Your assistant decides what to do with the data.** Run names, notes and tags are text you or your
  team wrote; `qlab-mcp` passes them on as data and does not interpret them.
- To stop access, revoke the key in Settings.
