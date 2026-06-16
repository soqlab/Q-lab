"""Jupyter / IPython integration for Q-Lab.

Usage in a Jupyter notebook::

    import qlab
    qlab.init(api_url="http://localhost:8000", api_key="your-key")

    # After capturing a circuit:
    run_id = qlab.track(qc, backend="ibm_brisbane")
    qlab.display(run_id)      # rich HTML card
    qlab.watch(run_id)        # live-updating cell until run finishes
    qlab.runs_table()         # recent runs as HTML table

    # IPython magic (after %load_ext qlab):
    %qlab runs
    %qlab status <run_id>
    %qlab watch <run_id>
"""

from typing import Optional


def _api_url() -> str:
    try:
        from .qiskit_hooks import _CONFIG
        return _CONFIG.get("api_url", "http://localhost:8000").rstrip("/")
    except Exception:
        return "http://localhost:8000"


def _fetch_run(run_id: str) -> dict:
    import urllib.request, json
    url = f"{_api_url()}/api/v1/runs/{run_id}"
    with urllib.request.urlopen(url, timeout=8) as resp:
        return json.loads(resp.read())


def _fetch_runs(limit: int = 20) -> list:
    import urllib.request, json
    url = f"{_api_url()}/api/v1/runs?limit={limit}"
    with urllib.request.urlopen(url, timeout=8) as resp:
        return json.loads(resp.read())


def _health_color(score) -> str:
    if score is None:
        return "#9ca3af"
    if score >= 70:
        return "#22c55e"
    if score >= 40:
        return "#f59e0b"
    return "#ef4444"


_STATUS_COLORS = {
    "completed": "#22c55e",
    "failed": "#ef4444",
    "running": "#f59e0b",
    "submitted": "#3b82f6",
}


def _run_card_html(run: dict) -> str:
    fp = run.get("fingerprint") or {}
    h = run.get("health_score")
    hc = _health_color(h)
    status = run.get("status", "?")
    sc = _STATUS_COLORS.get(status, "#6b7280")
    tags = ", ".join(run.get("tags") or []) or "—"
    api = _api_url()

    rows = [
        ("Run ID", f'<code style="font-size:11px;background:#f3f4f6;padding:1px 5px;border-radius:4px">{run["run_id"]}</code>'),
        ("Circuit", run.get("circuit_name") or "—"),
        ("Backend", run.get("backend") or "—"),
        ("Project", run.get("project") or "—"),
        ("Tags", tags),
        ("Qubits", fp.get("num_qubits", "—")),
        ("Depth", fp.get("depth", "—")),
        ("Gates", fp.get("size", "—")),
        ("Non-Clifford", f'{(fp.get("non_clifford_ratio") or 0) * 100:.1f}%' if fp.get("non_clifford_ratio") is not None else "—"),
        ("Status", f'<span style="color:{sc};font-weight:700">{status}</span>'),
        ("Created", (run.get("created_at") or "")[:19].replace("T", " ")),
    ]
    rows_html = "".join(
        f'<tr>'
        f'<td style="color:#6b7280;padding:5px 10px;white-space:nowrap;font-size:12px;border-bottom:1px solid #f3f4f6">{k}</td>'
        f'<td style="padding:5px 10px;font-size:13px;border-bottom:1px solid #f3f4f6">{v}</td>'
        f'</tr>'
        for k, v in rows
    )

    return f"""<div style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;box-shadow:0 1px 4px rgba(0,0,0,.06)">
  <div style="background:#0d1b2a;color:#fff;padding:11px 16px;display:flex;align-items:center;gap:10px">
    <span style="font-size:16px">⚛</span>
    <span style="font-weight:700;font-size:14px">Q-Lab Run</span>
    <span style="margin-left:auto;background:{hc};color:#fff;border-radius:20px;padding:2px 10px;font-size:11px;font-weight:700">
      Health: {h if h is not None else "n/a"}
    </span>
  </div>
  <table style="border-collapse:collapse;width:100%;background:#fff">{rows_html}</table>
  <div style="background:#f9fafb;padding:10px 14px;display:flex;gap:8px;border-top:1px solid #e5e7eb">
    <a href="{api}/runs/{run['run_id']}" target="_blank"
       style="padding:5px 12px;background:#1d6f8f;color:#fff;text-decoration:none;border-radius:6px;font-size:12px;font-weight:600">
      Open in Q-Lab →
    </a>
    <a href="{api}/api/v1/runs/{run['run_id']}/bundle.zip"
       style="padding:5px 12px;background:#f3f4f6;color:#374151;text-decoration:none;border-radius:6px;font-size:12px;border:1px solid #e5e7eb">
      Bundle ZIP
    </a>
  </div>
</div>"""


def display(run_id: str):
    """Render a Q-Lab run as a rich HTML card in a Jupyter notebook cell.

    Example::

        import qlab
        run_id = qlab.track(qc, backend="ibm_brisbane")
        qlab.display(run_id)
    """
    try:
        from IPython.display import HTML
    except ImportError:
        raise RuntimeError("IPython is required. Install with: pip install ipython")

    try:
        run = _fetch_run(run_id)
        return HTML(_run_card_html(run))
    except Exception as exc:
        return HTML(
            f'<div style="color:#ef4444;font-size:13px;font-family:monospace;padding:8px">'
            f'Failed to fetch run {run_id[:12]}…: {exc}</div>'
        )


def watch(run_id: str, interval: float = 2.0, timeout: float = 600.0) -> None:
    """Live-update the current cell with run status until completed or failed.

    Blocks the cell. Use in a dedicated cell so other cells can still run.

    Example::

        import qlab
        run_id = qlab.track(qc)
        qlab.watch(run_id)      # updates in-place every 2 seconds
    """
    try:
        from IPython.display import display as ipy_display, HTML, clear_output
    except ImportError:
        raise RuntimeError("IPython is required. Install with: pip install ipython")

    import time as _time

    elapsed = 0.0
    while elapsed < timeout:
        try:
            run = _fetch_run(run_id)
        except Exception:
            _time.sleep(interval)
            elapsed += interval
            continue

        clear_output(wait=True)
        mins, secs = divmod(int(elapsed), 60)
        elapsed_str = f"{mins}m {secs:02d}s" if mins else f"{secs}s"
        card = _run_card_html(run)
        card += (
            f'<div style="font-size:11px;color:#9ca3af;margin-top:6px;font-family:monospace">'
            f'⏱ Watching… {elapsed_str} elapsed (refreshes every {interval:.0f}s)</div>'
        )
        ipy_display(HTML(card))

        if run.get("status") in ("completed", "failed"):
            break

        _time.sleep(interval)
        elapsed += interval


def runs_table(limit: int = 20):
    """Show recent Q-Lab runs as a rich HTML table.

    Example::

        import qlab
        qlab.runs_table()          # 20 most recent
        qlab.runs_table(limit=50)  # 50 most recent
    """
    try:
        from IPython.display import HTML
    except ImportError:
        raise RuntimeError("IPython is required. Install with: pip install ipython")

    try:
        runs = _fetch_runs(limit=limit)
    except Exception as exc:
        return HTML(f'<div style="color:#ef4444;font-size:13px">Failed to fetch runs: {exc}</div>')

    api = _api_url()
    rows_html = ""
    for r in runs:
        fp = r.get("fingerprint") or {}
        s = r.get("status", "?")
        sc = _STATUS_COLORS.get(s, "#6b7280")
        h = r.get("health_score")
        hc = _health_color(h)
        name = r.get("circuit_name") or r["run_id"][:10]
        rows_html += (
            f'<tr style="border-bottom:1px solid #f3f4f6">'
            f'<td style="padding:6px 10px"><a href="{api}/runs/{r["run_id"]}" target="_blank" '
            f'style="color:#1d6f8f;font-size:13px;text-decoration:none">{name}</a></td>'
            f'<td style="padding:6px 10px;font-size:12px;color:#6b7280">{r.get("project") or "—"}</td>'
            f'<td style="padding:6px 10px;font-size:12px;color:#6b7280">{r.get("backend") or "—"}</td>'
            f'<td style="padding:6px 10px"><span style="color:{sc};font-weight:700;font-size:12px">{s}</span></td>'
            f'<td style="padding:6px 10px;text-align:center;font-size:13px">{fp.get("num_qubits", "—")}</td>'
            f'<td style="padding:6px 10px;text-align:center;font-size:13px">{fp.get("depth", "—")}</td>'
            f'<td style="padding:6px 10px;text-align:center;font-weight:700;color:{hc};font-size:13px">'
            f'{h if h is not None else "—"}</td>'
            f'<td style="padding:6px 10px;font-size:11px;color:#9ca3af">'
            f'{(r.get("created_at") or "")[:19].replace("T", " ")}</td>'
            f'</tr>'
        )

    header_style = "padding:8px 10px;text-align:left;color:#6b7280;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;background:#f9fafb;border-bottom:2px solid #e5e7eb"
    ths = "".join(
        f'<th style="{header_style}{";text-align:center" if c else ""}">{h}</th>'
        for h, c in [
            ("Circuit", False), ("Project", False), ("Backend", False), ("Status", False),
            ("Qubits", True), ("Depth", True), ("Health", True), ("Created", False),
        ]
    )

    return HTML(
        f'<div style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;'
        f'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;max-width:900px;'
        f'box-shadow:0 1px 4px rgba(0,0,0,.06)">'
        f'<div style="background:#0d1b2a;color:#fff;padding:11px 16px;font-weight:700;font-size:14px">'
        f'⚛ Q-Lab — Recent Runs</div>'
        f'<div style="overflow-x:auto">'
        f'<table style="border-collapse:collapse;width:100%;background:#fff">'
        f'<thead><tr>{ths}</tr></thead>'
        f'<tbody>{rows_html}</tbody>'
        f'</table></div></div>'
    )


# ---------------------------------------------------------------------------
# IPython magic registration
# ---------------------------------------------------------------------------

try:
    from IPython.core.magic import Magics, magics_class, line_magic

    @magics_class
    class QLabMagics(Magics):
        """IPython %qlab magic for Q-Lab experiment tracking."""

        @line_magic
        def qlab(self, line: str) -> None:  # type: ignore[override]
            """
            %qlab runs [N]           — recent runs table (default 20)
            %qlab status <run_id>    — display a run card
            %qlab watch <run_id>     — live-watch a run until finished
            """
            from IPython.display import display as ipy_display

            parts = line.strip().split()
            if not parts:
                ipy_display(runs_table())
                return

            cmd = parts[0]
            if cmd == "runs":
                n = int(parts[1]) if len(parts) > 1 else 20
                ipy_display(runs_table(limit=n))
            elif cmd in ("status", "show", "display"):
                if len(parts) < 2:
                    print("Usage: %qlab status <run_id>")
                    return
                ipy_display(display(parts[1]))
            elif cmd == "watch":
                if len(parts) < 2:
                    print("Usage: %qlab watch <run_id>")
                    return
                watch(parts[1])
            else:
                print(f"Unknown command '{cmd}'. Available: runs, status <run_id>, watch <run_id>")

    def load_ipython_extension(ipython) -> None:
        """Called by %load_ext qlab — registers the %qlab magic."""
        ipython.register_magics(QLabMagics)

except ImportError:
    pass  # IPython not installed — skip magic registration
