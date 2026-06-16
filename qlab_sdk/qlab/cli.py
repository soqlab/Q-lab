"""Q-Lab CLI — manage experiments from the terminal.

Usage:
    qlab status
    qlab queue retry [--queue-path P]
    qlab runs list [--project P] [--status S] [--backend B] [--limit N] [--json]
    qlab run show <run_id>
    qlab run diff <run_id_1> <run_id_2>
    qlab run qasm <run_id>
    qlab run health <run_id>
    qlab run rca <run_id>
    qlab run budget <run_id>
    qlab run download <run_id> [--output path.zip]
    qlab push <circuit.qasm> [--name N] [--project P] [--backend B] [--shots N]
    qlab circuit-diff <run_id_1> <run_id_2> [--json]
    qlab config show
    qlab config set <key> <value>

Config is stored in ~/.qlab/cli_config.json or read from env:
    QLAB_API_URL   — e.g. http://localhost:8000
    QLAB_API_KEY   — your API key
"""

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

from .client import QLabClient

# ------------------------------------------------------------------
# Config helpers
# ------------------------------------------------------------------

CONFIG_PATH = Path.home() / ".qlab" / "cli_config.json"

def _load_config() -> dict:
    cfg = {}
    if CONFIG_PATH.exists():
        try:
            cfg = json.loads(CONFIG_PATH.read_text())
        except Exception:
            pass
    cfg.setdefault("api_url", os.getenv("QLAB_API_URL", "http://localhost:8000"))
    cfg.setdefault("api_key", os.getenv("QLAB_API_KEY", ""))
    return cfg

def _save_config(cfg: dict) -> None:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2))

def _headers(cfg: dict) -> dict:
    h = {"Content-Type": "application/json"}
    if cfg.get("api_key"):
        h["X-QLab-API-Key"] = cfg["api_key"]
    return h

# ------------------------------------------------------------------
# HTTP helpers (stdlib only)
# ------------------------------------------------------------------

def _get(cfg: dict, path: str, params: dict | None = None) -> dict | list:
    import urllib.request, urllib.parse
    url = cfg["api_url"].rstrip("/") + path
    if params:
        url += "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    req = urllib.request.Request(url, headers=_headers(cfg))
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode())

def _post(cfg: dict, path: str, body: dict) -> dict:
    import urllib.request
    url = cfg["api_url"].rstrip("/") + path
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=_headers(cfg), method="POST")
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode())

def _download_bytes(cfg: dict, path: str) -> bytes:
    import urllib.request
    url = cfg["api_url"].rstrip("/") + path
    req = urllib.request.Request(url, headers=_headers(cfg))
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()

def _get_text(cfg: dict, path: str) -> str:
    import urllib.request
    url = cfg["api_url"].rstrip("/") + path
    req = urllib.request.Request(url, headers=_headers(cfg))
    with urllib.request.urlopen(req, timeout=10) as resp:
        return resp.read().decode(errors="replace")

# ------------------------------------------------------------------
# Table rendering helpers
# ------------------------------------------------------------------

def _col(v, w: int) -> str:
    s = str(v) if v is not None else "—"
    return s[:w].ljust(w)

def _health_char(score) -> str:
    if score is None: return "·"
    if score >= 70: return "▲"
    if score >= 40: return "▶"
    return "▼"

def _status_char(status: str) -> str:
    return {"completed": "✓", "failed": "✗", "submitted": "⏳"}.get(status, "?")

def _age(dt_str: str) -> str:
    try:
        dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
        delta = datetime.now(dt.tzinfo) - dt
        s = int(delta.total_seconds())
        if s < 60: return f"{s}s"
        if s < 3600: return f"{s//60}m"
        if s < 86400: return f"{s//3600}h"
        return f"{s//86400}d"
    except Exception:
        return "?"

# ------------------------------------------------------------------
# Commands
# ------------------------------------------------------------------

def cmd_status(args, cfg):
    try:
        data = _get(cfg, "/health")
        print(f"  Q-Lab  {cfg['api_url']}")
        print(f"  Status  {data.get('status', '?').upper()}")
        print(f"  Version {data.get('version', '?')}")
        print(f"  Runs    {data.get('runs', 0)}")
        print(f"  Projects {data.get('projects', 0)}")
        print(f"  Users   {data.get('users', 0)}")
    except Exception as e:
        print(f"  ERROR: {e}", file=sys.stderr)
        sys.exit(1)


def cmd_queue_retry(args, cfg):
    client = QLabClient(
        api_url=cfg["api_url"],
        api_key=cfg.get("api_key") or None,
        queue_path=args.queue_path,
    )
    queue_path = client.queue_path
    before = 0
    if queue_path.exists():
        before = sum(1 for line in queue_path.read_text(encoding="utf-8").splitlines() if line.strip())
    client._retry_pending()
    after = 0
    if queue_path.exists():
        after = sum(1 for line in queue_path.read_text(encoding="utf-8").splitlines() if line.strip())
    uploaded = max(0, before - after)
    print(f"  Queue    : {queue_path}")
    print(f"  Uploaded : {uploaded}")
    print(f"  Remaining: {after}")
    if after:
        sys.exit(1)


def cmd_runs_list(args, cfg):
    params = {}
    if args.project: params["project"] = args.project
    if args.status:  params["status"]  = args.status
    if args.backend: params["backend"] = args.backend
    if args.limit:   params["limit"]   = args.limit
    try:
        runs = _get(cfg, "/api/v1/runs", params)
        if not isinstance(runs, list):
            runs = []
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr); sys.exit(1)

    if args.json:
        print(json.dumps(runs, indent=2))
        return

    if not runs:
        print("No runs found.")
        return

    # Header
    FMT = "{st} {id:<14} {name:<24} {proj:<14} {be:<16} {q:>5} {d:>5} {h:>6} {age:>6}"
    print(FMT.format(st=" ", id="RUN ID", name="CIRCUIT", proj="PROJECT",
                     be="BACKEND", q="QBITS", d="DEPTH", h="HEALTH", age="AGE"))
    print("─" * 96)
    for r in runs[:int(args.limit or 50)]:
        fp = r.get("fingerprint") or {}
        print(FMT.format(
            st=_status_char(r.get("status", "")),
            id=(r.get("run_id") or "")[:14],
            name=_col(r.get("circuit_name"), 24),
            proj=_col(r.get("project"), 14),
            be=_col(r.get("backend"), 16),
            q=_col(fp.get("num_qubits"), 5),
            d=_col(fp.get("depth"), 5),
            h=f"{_health_char(r.get('health_score'))}{r.get('health_score') or '—':>4}",
            age=_age(r.get("created_at", "")),
        ))
    print(f"\n{len(runs)} run(s) shown. ✓=completed ✗=failed ⏳=submitted  ▲=good ▶=warn ▼=poor")


def cmd_run_show(args, cfg):
    run_id = args.run_id
    try:
        r = _get(cfg, f"/api/v1/runs/{run_id}")
        hb = _get(cfg, f"/api/v1/runs/{run_id}/health")
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr); sys.exit(1)

    if args.json:
        print(json.dumps(r, indent=2))
        return

    fp = r.get("fingerprint") or {}
    print(f"\n  Run: {r.get('circuit_name') or run_id}")
    print(f"  ID:      {run_id}")
    print(f"  Status:  {r.get('status')}")
    print(f"  Backend: {r.get('backend') or '—'}")
    print(f"  Project: {r.get('project') or '—'}")
    print(f"  Created: {r.get('created_at', '')[:19]}")
    print(f"  Tags:    {', '.join(r.get('tags') or []) or '—'}")
    print(f"\n  Circuit")
    print(f"    Qubits : {fp.get('num_qubits') or '—'}")
    print(f"    Depth  : {fp.get('depth') or '—'}")
    print(f"    Gates  : {fp.get('size') or '—'}")
    print(f"    non-Cliff: {round((fp.get('non_clifford_ratio') or 0)*100, 1)}%")
    print(f"\n  Health Score: {r.get('health_score') or '—'}")
    for k, v in (hb or {}).items():
        if k != "overall":
            print(f"    {k}: {v}")
    print(f"\n  Dashboard: {r.get('dashboard_url') or cfg['api_url'] + '/runs/' + run_id}")


def cmd_run_diff(args, cfg):
    try:
        result = _get(cfg, f"/api/v1/runs/compare/{args.run_id_1}/{args.run_id_2}/json")
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr); sys.exit(1)

    if args.json:
        print(json.dumps(result, indent=2))
        return

    summary = result.get("summary") or {}
    print(f"\n  Compare: {args.run_id_1[:12]} ↔ {args.run_id_2[:12]}")
    for k, same in summary.items():
        icon = "=" if same else "≠"
        print(f"  {icon} {k}")

    for section, key in [("Fingerprint", "fingerprint_diff"), ("Parameters", "parameter_diff"),
                          ("Results", "result_diff"), ("Calibration", "calibration_diff")]:
        diff = result.get(key) or {}
        if diff:
            print(f"\n  {section} diff:")
            for field, change in diff.items():
                print(f"    {field}: {change.get('left')} → {change.get('right')}")

    qasm_diff = result.get("qasm_diff") or ""
    if qasm_diff.strip():
        lines = qasm_diff.splitlines()
        print(f"\n  QASM diff ({len(lines)} lines):")
        for line in lines[:30]:
            print(f"  {line}")
        if len(lines) > 30:
            print(f"  ... ({len(lines)-30} more lines)")


def cmd_circuit_diff(args, cfg):
    """Gate-level QASM diff between two runs."""
    try:
        result = _get(cfg, f"/api/v1/runs/{args.run_id_1}/diff/{args.run_id_2}")
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr); sys.exit(1)

    if args.json:
        print(json.dumps(result, indent=2)); return

    a = result["run_a"]
    b = result["run_b"]
    ds = result["diff_stats"]
    sim = result["similarity"]

    print(f"\n  Circuit Diff")
    print(f"  A: {a.get('circuit_name') or args.run_id_1[:12]}  ({a['gate_count']} gates)")
    print(f"  B: {b.get('circuit_name') or args.run_id_2[:12]}  ({b['gate_count']} gates)")
    print(f"  Similarity  : {sim*100:.1f}%")
    print(f"  Added gates : {ds['added']}")
    print(f"  Removed     : {ds['removed']}")
    print(f"  Unchanged   : {ds['unchanged']}")

    delta = result.get("gate_histogram_delta") or {}
    changed = {g: v for g, v in delta.items() if v["delta"] != 0}
    if changed:
        print("\n  Gate histogram changes:")
        for g, v in sorted(changed.items(), key=lambda x: abs(x[1]["delta"]), reverse=True):
            sign = "+" if v["delta"] > 0 else ""
            print(f"    {g:<12} {v['a']} → {v['b']}  ({sign}{v['delta']})")

    diff_lines = result.get("unified_diff") or []
    if diff_lines:
        print(f"\n  QASM diff ({len(diff_lines)} lines):")
        for line in diff_lines[:40]:
            prefix = "  "
            if line.startswith("+") and not line.startswith("+++"):
                prefix = "\033[92m+ "
            elif line.startswith("-") and not line.startswith("---"):
                prefix = "\033[91m- "
            elif line.startswith("@@"):
                prefix = "\033[96m  "
            print(f"{prefix}{line}\033[0m")
        if len(diff_lines) > 40:
            print(f"  ... ({len(diff_lines)-40} more lines)")


def cmd_run_qasm(args, cfg):
    try:
        qasm = _get_text(cfg, f"/api/v1/runs/{args.run_id}/qasm")
        print(qasm)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr); sys.exit(1)


def cmd_run_health(args, cfg):
    try:
        hb = _get(cfg, f"/api/v1/runs/{args.run_id}/health")
        if args.json:
            print(json.dumps(hb, indent=2)); return
        for k, v in hb.items():
            print(f"  {k}: {v}")
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr); sys.exit(1)


def cmd_run_rca(args, cfg):
    try:
        rca = _get(cfg, f"/api/v1/runs/{args.run_id}/rca")
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr); sys.exit(1)

    if args.json:
        print(json.dumps(rca, indent=2)); return

    sev_icon = {"critical": "🔴", "warning": "🟠", "notice": "🟡", "healthy": "🟢", "degraded": "⚫"}.get(
        rca.get("overall_prognosis", ""), "·")
    print(f"\n  RCA — {rca.get('run_id', '')[:12]}  Prognosis: {sev_icon} {rca.get('overall_prognosis', '?').upper()}")
    for cause in rca.get("causes") or []:
        sev = cause.get("severity", "info")
        icon = {"critical": "✗✗", "high": "✗", "medium": "!", "low": "·", "info": " "}.get(sev, " ")
        print(f"  {icon} [{sev[:4].upper()}] {cause.get('title')}  conf={int(cause.get('confidence',0)*100)}%")
        print(f"       {cause.get('description')}")


def cmd_run_budget(args, cfg):
    try:
        bud = _get(cfg, f"/api/v1/runs/{args.run_id}/error-budget")
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr); sys.exit(1)

    if args.json:
        print(json.dumps(bud, indent=2)); return

    print(f"\n  Error Budget — {args.run_id[:12]}")
    print(f"  Combined fidelity : {bud.get('combined_fidelity', 0)*100:.2f}%")
    print(f"  Total error budget: {bud.get('total_error_budget', 0)*100:.2f}%")
    print(f"  Dominant source   : {bud.get('dominant_source') or '—'}")
    print()
    for comp in bud.get("components") or []:
        bar_w = int(comp.get("pct_of_total", 0) / 2)
        bar = "█" * bar_w
        print(f"  {comp['label']:<20} {bar:<50} {comp['pct_of_total']:.1f}%")


def cmd_run_download(args, cfg):
    run_id = args.run_id
    output = args.output or f"qlab-capsule-{run_id[:8]}.zip"
    try:
        data = _download_bytes(cfg, f"/api/v1/runs/{run_id}/capsule.zip")
        Path(output).write_bytes(data)
        print(f"  Saved {len(data)//1024} KB → {output}")
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr); sys.exit(1)


def cmd_push(args, cfg):
    qasm_path = Path(args.qasm_file)
    if not qasm_path.exists():
        print(f"ERROR: file not found: {qasm_path}", file=sys.stderr); sys.exit(1)
    qasm = qasm_path.read_text(encoding="utf-8")

    import uuid, datetime as _dt
    from .fingerprint import fingerprint_circuit
    fp = {}
    try:
        from qiskit import qasm2
        qc = qasm2.loads(qasm)
        fp = fingerprint_circuit(qc)
    except Exception:
        pass

    payload = {
        "run_id": str(uuid.uuid4()),
        "circuit_name": args.name or qasm_path.stem,
        "qasm": qasm,
        "fingerprint": fp,
        "backend": args.backend or None,
        "project": args.project or None,
        "parameters": {"shots": int(args.shots)} if args.shots else {},
        "status": "submitted",
        "created_at": _dt.datetime.utcnow().isoformat() + "Z",
    }
    try:
        result = _post(cfg, "/api/v1/runs", payload)
        print(f"  Pushed run: {result.get('run_id')}")
        print(f"  Dashboard : {result.get('dashboard_url')}")
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr); sys.exit(1)


def cmd_config_show(args, cfg):
    print(f"  api_url : {cfg['api_url']}")
    print(f"  api_key : {'***' + cfg['api_key'][-4:] if cfg.get('api_key') else '(not set)'}")
    print(f"  config  : {CONFIG_PATH}")


def cmd_config_set(args, cfg):
    key, value = args.key, args.value
    if key not in ("api_url", "api_key"):
        print(f"ERROR: unknown key '{key}'. Valid: api_url, api_key", file=sys.stderr); sys.exit(1)
    cfg[key] = value
    _save_config(cfg)
    print(f"  Set {key} = {value}")


# ------------------------------------------------------------------
# Main entry point
# ------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        prog="qlab",
        description="Q-Lab CLI — quantum experiment tracking from the terminal",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    sub = parser.add_subparsers(dest="command")

    # status
    sub.add_parser("status", help="Check server status")

    # queue
    queue_p = sub.add_parser("queue", help="Manage local retry queue")
    queue_sub = queue_p.add_subparsers(dest="queue_command")
    retry_p = queue_sub.add_parser("retry", help="Retry queued offline uploads")
    retry_p.add_argument("--queue-path", help="Override pending_runs.jsonl path")

    # runs
    runs_p = sub.add_parser("runs", help="List / search runs")
    runs_sub = runs_p.add_subparsers(dest="runs_command")
    rl = runs_sub.add_parser("list", help="List recent runs")
    rl.add_argument("--project", "-p")
    rl.add_argument("--status", "-s")
    rl.add_argument("--backend", "-b")
    rl.add_argument("--limit", "-n", default=50, type=int)
    rl.add_argument("--json", action="store_true")

    # run
    run_p = sub.add_parser("run", help="Inspect a single run")
    run_sub = run_p.add_subparsers(dest="run_command")

    for cmd_name, help_text in [
        ("show",   "Show run details"),
        ("qasm",   "Print circuit QASM"),
        ("health", "Show health breakdown"),
        ("rca",    "Root-cause analysis"),
        ("budget", "Error budget"),
    ]:
        sp = run_sub.add_parser(cmd_name, help=help_text)
        sp.add_argument("run_id")
        sp.add_argument("--json", action="store_true")

    diff_p = run_sub.add_parser("diff", help="Compare two runs")
    diff_p.add_argument("run_id_1")
    diff_p.add_argument("run_id_2")
    diff_p.add_argument("--json", action="store_true")

    dl_p = run_sub.add_parser("download", help="Download capsule.zip")
    dl_p.add_argument("run_id")
    dl_p.add_argument("--output", "-o")

    # push
    push_p = sub.add_parser("push", help="Push a QASM circuit to Q-Lab")
    push_p.add_argument("qasm_file")
    push_p.add_argument("--name", "-n")
    push_p.add_argument("--project", "-p")
    push_p.add_argument("--backend", "-b")
    push_p.add_argument("--shots", "-s", type=int)

    # circuit-diff
    cdiff_p = sub.add_parser("circuit-diff", help="Gate-level QASM diff between two runs")
    cdiff_p.add_argument("run_id_1")
    cdiff_p.add_argument("run_id_2")
    cdiff_p.add_argument("--json", action="store_true")

    # config
    cfg_p = sub.add_parser("config", help="CLI configuration")
    cfg_sub = cfg_p.add_subparsers(dest="config_command")
    cfg_sub.add_parser("show", help="Show current config")
    set_p = cfg_sub.add_parser("set", help="Set a config value")
    set_p.add_argument("key")
    set_p.add_argument("value")

    args = parser.parse_args()
    cfg = _load_config()

    if args.command == "status":
        cmd_status(args, cfg)
    elif args.command == "queue":
        if args.queue_command == "retry":
            cmd_queue_retry(args, cfg)
        else:
            queue_p.print_help()
    elif args.command == "runs":
        if args.runs_command == "list":
            cmd_runs_list(args, cfg)
        else:
            runs_p.print_help()
    elif args.command == "run":
        if args.run_command == "show":
            cmd_run_show(args, cfg)
        elif args.run_command == "diff":
            cmd_run_diff(args, cfg)
        elif args.run_command == "qasm":
            cmd_run_qasm(args, cfg)
        elif args.run_command == "health":
            cmd_run_health(args, cfg)
        elif args.run_command == "rca":
            cmd_run_rca(args, cfg)
        elif args.run_command == "budget":
            cmd_run_budget(args, cfg)
        elif args.run_command == "download":
            cmd_run_download(args, cfg)
        else:
            run_p.print_help()
    elif args.command == "circuit-diff":
        cmd_circuit_diff(args, cfg)
    elif args.command == "push":
        cmd_push(args, cfg)
    elif args.command == "config":
        if args.config_command == "show":
            cmd_config_show(args, cfg)
        elif args.config_command == "set":
            cmd_config_set(args, cfg)
        else:
            cfg_p.print_help()
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
