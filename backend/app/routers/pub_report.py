"""Publication Report Export.

Generates LaTeX and Markdown reports from a run for paper appendices.
Suitable for use in arXiv papers, IEEE/ACM manuscripts, etc.
"""

from __future__ import annotations

import json
import textwrap
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run
from ..health_score import compute_health_score

router = APIRouter(prefix="/api/v1/runs", tags=["pub_report"])


def _fmt(v, decimals: int = 4) -> str:
    if v is None:
        return "N/A"
    try:
        f = float(v)
        return f"{f:.{decimals}f}"
    except (TypeError, ValueError):
        return str(v)


def _escape_latex(s: str) -> str:
    replacements = [
        ("\\", r"\textbackslash{}"),
        ("&", r"\&"), ("%", r"\%"), ("$", r"\$"), ("#", r"\#"),
        ("_", r"\_"), ("{", r"\{"), ("}", r"\}"), ("~", r"\textasciitilde{}"),
        ("^", r"\textasciicircum{}"),
    ]
    for old, new in replacements:
        s = s.replace(old, new)
    return s


def _cal_table_rows_latex(cal: dict) -> list[str]:
    rows = []
    for key, val in list(cal.items())[:20]:
        if not isinstance(val, dict):
            continue
        ge = _fmt(val.get("gate_error") or val.get("cx_error"), 5)
        t1 = _fmt(val.get("T1") or val.get("t1"), 1)
        t2 = _fmt(val.get("T2") or val.get("t2"), 1)
        ro = _fmt(val.get("readout_error"), 4)
        rows.append(f"        {_escape_latex(str(key))} & {ge} & {t1} & {t2} & {ro} \\\\")
    return rows


def _cal_table_rows_md(cal: dict) -> list[str]:
    rows = []
    for key, val in list(cal.items())[:20]:
        if not isinstance(val, dict):
            continue
        ge = _fmt(val.get("gate_error") or val.get("cx_error"), 5)
        t1 = _fmt(val.get("T1") or val.get("t1"), 1)
        t2 = _fmt(val.get("T2") or val.get("t2"), 1)
        ro = _fmt(val.get("readout_error"), 4)
        rows.append(f"| {key} | {ge} | {t1} | {t2} | {ro} |")
    return rows


def _metrics_rows(run: Run) -> list[tuple[str, str]]:
    fp = run.fingerprint or {}
    res = run.results or {}
    transpiler = run.transpiler or {}
    ts = transpiler.get("settings") or transpiler

    rows = []
    if fp.get("depth"):
        rows.append(("Circuit depth", str(fp["depth"])))
    if fp.get("size"):
        rows.append(("Gate count", str(fp["size"])))
    if fp.get("num_qubits"):
        rows.append(("Qubit count", str(fp["num_qubits"])))
    if fp.get("non_clifford_ratio") is not None:
        rows.append(("Non-Clifford ratio", _fmt(fp["non_clifford_ratio"], 3)))
    if res.get("success_probability") is not None:
        rows.append(("Success probability", _fmt(res["success_probability"], 4)))
    run_dict = {"results": res, "calibration": run.calibration or {}, "fingerprint": fp}
    health = compute_health_score(run_dict)
    if health is not None:
        rows.append(("Health score (0–100)", _fmt(health, 1)))
    if ts.get("optimization_level") is not None:
        rows.append(("Transpiler optimization level", str(ts["optimization_level"])))
    if ts.get("routing_method"):
        rows.append(("Routing method", str(ts["routing_method"])))
    if transpiler.get("duration_ms") is not None:
        rows.append(("Transpile time (ms)", _fmt(transpiler["duration_ms"], 1)))
    return rows


def _build_latex(run: Run) -> str:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    backend = run.backend or "unknown"
    tags_str = ", ".join(run.tags or []) or "none"
    metrics = _metrics_rows(run)

    metrics_rows = "\n".join(
        f"        {_escape_latex(k)} & {_escape_latex(v)} \\\\"
        for k, v in metrics
    )

    cal_rows = "\n".join(_cal_table_rows_latex(run.calibration or {})) or "        \\multicolumn{5}{c}{No calibration data captured} \\\\"

    fingerprint_rows = ""
    if run.fingerprint:
        fp = run.fingerprint
        fingerprint_rows = "\n".join(
            f"        {_escape_latex(k)} & {_escape_latex(str(v))} \\\\"
            for k, v in fp.items() if k not in ("id",)
        )

    shadow_rows = ""
    if run.shadow_results:
        sr = run.shadow_results
        tvd = _fmt(sr.get("tvd"), 4)
        shadow_rows = f"        TVD (shadow simulation) & {tvd} \\\\"
        if sr.get("success_probability") is not None:
            shadow_rows += f"\n        Success probability (shadow) & {_fmt(sr['success_probability'], 4)} \\\\"

    notes_section = ""
    if getattr(run, "notes", None):
        notes_section = f"""
\\subsection*{{Notes}}
{_escape_latex(str(getattr(run, "notes", None))[:1000])}
"""

    return textwrap.dedent(f"""\
% Q-Lab experiment report — auto-generated {now}
% Run ID: {run.run_id}
% DO NOT EDIT: regenerate with Q-Lab export API

\\begin{{table}}[htbp]
  \\centering
  \\caption{{Q-Lab Experiment Record: {_escape_latex(run.run_id)}}}
  \\label{{tab:qlab-{_escape_latex(run.run_id)[:16]}}}
  \\begin{{tabular}}{{ll}}
    \\toprule
    \\textbf{{Property}} & \\textbf{{Value}} \\\\
    \\midrule
    Run ID & \\texttt{{{_escape_latex(run.run_id)}}} \\\\
    Backend & {_escape_latex(backend)} \\\\
    Status & {_escape_latex(run.status or "unknown")} \\\\
    Submitted & {_escape_latex(run.created_at.isoformat()[:19] if run.created_at else "N/A")} UTC \\\\
    Tags & {_escape_latex(tags_str)} \\\\
    \\midrule
{metrics_rows}
{shadow_rows}
    \\bottomrule
  \\end{{tabular}}
\\end{{table}}

\\begin{{table}}[htbp]
  \\centering
  \\caption{{Hardware Calibration Snapshot for {_escape_latex(backend)}}}
  \\label{{tab:qlab-cal-{_escape_latex(run.run_id)[:16]}}}
  \\begin{{tabular}}{{lrrrr}}
    \\toprule
    \\textbf{{Qubit/Gate}} & \\textbf{{Gate error}} & \\textbf{{T1 (\\textmu s)}} & \\textbf{{T2 (\\textmu s)}} & \\textbf{{Readout err.}} \\\\
    \\midrule
{cal_rows}
    \\bottomrule
  \\end{{tabular}}
\\end{{table}}
{notes_section}
% BibTeX entry for citing Q-Lab:
% @software{{qlab,
%   title  = {{Q-Lab: Passive Quantum Experiment Tracker}},
%   year   = {{{now[:4]}}},
%   url    = {{https://github.com/your-org/q-lab}},
% }}
""")


def _build_markdown(run: Run) -> str:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    backend = run.backend or "unknown"
    tags_str = ", ".join(run.tags or []) or "none"
    metrics = _metrics_rows(run)

    lines = [
        f"# Q-Lab Experiment Report",
        f"",
        f"*Auto-generated {now} by Q-Lab*",
        f"",
        f"## Experiment Metadata",
        f"",
        f"| Property | Value |",
        f"|----------|-------|",
        f"| Run ID | `{run.run_id}` |",
        f"| Backend | {backend} |",
        f"| Status | {run.status or 'unknown'} |",
        f"| Submitted | {run.created_at.isoformat()[:19] if run.created_at else 'N/A'} UTC |",
        f"| Tags | {tags_str} |",
    ]
    for k, v in metrics:
        lines.append(f"| {k} | {v} |")

    if run.shadow_results:
        sr = run.shadow_results
        if (tvd := sr.get("tvd")) is not None:
            lines.append(f"| TVD (shadow simulation) | {_fmt(tvd, 4)} |")
        if (sp := sr.get("success_probability")) is not None:
            lines.append(f"| Success probability (shadow) | {_fmt(sp, 4)} |")

    lines += ["", "## Hardware Calibration Snapshot", ""]
    cal = run.calibration or {}
    if cal:
        lines += [
            "| Qubit/Gate | Gate error | T1 (µs) | T2 (µs) | Readout err |",
            "|------------|-----------|---------|---------|------------|",
        ]
        lines += _cal_table_rows_md(cal)
    else:
        lines.append("*No calibration data captured.*")

    if run.fingerprint:
        lines += ["", "## Circuit Fingerprint", ""]
        lines += ["| Key | Value |", "|-----|-------|"]
        for k, v in run.fingerprint.items():
            if k != "id":
                lines.append(f"| {k} | {v} |")

    if getattr(run, "notes", None):
        lines += ["", "## Notes", "", str(getattr(run, "notes", None))[:1000]]

    lines += [
        "",
        "---",
        "*Generated by [Q-Lab](https://github.com/your-org/q-lab)*",
    ]
    return "\n".join(lines)


@router.get("/{run_id}/report.tex", response_class=PlainTextResponse)
def export_latex(run_id: str, db: Session = Depends(get_db)):
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if not run:
        raise HTTPException(404, "Run not found")
    content = _build_latex(run)
    return PlainTextResponse(
        content=content,
        media_type="application/x-tex",
        headers={"Content-Disposition": f'attachment; filename="qlab-{run_id}.tex"'},
    )


@router.get("/{run_id}/report.md", response_class=PlainTextResponse)
def export_markdown(run_id: str, db: Session = Depends(get_db)):
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if not run:
        raise HTTPException(404, "Run not found")
    content = _build_markdown(run)
    return PlainTextResponse(
        content=content,
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="qlab-{run_id}.md"'},
    )


@router.get("/{run_id}/report.json")
def export_json_report(run_id: str, db: Session = Depends(get_db)):
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if not run:
        raise HTTPException(404, "Run not found")

    fp = run.fingerprint or {}
    res = run.results or {}
    run_dict = {"results": res, "calibration": run.calibration or {}, "fingerprint": fp}
    health = compute_health_score(run_dict)
    return {
        "run_id": run.run_id,
        "backend": run.backend,
        "status": run.status,
        "created_at": run.created_at.isoformat() if run.created_at else None,
        "tags": run.tags or [],
        "metrics": dict(_metrics_rows(run)),
        "health_score": health,
        "circuit_fingerprint": fp,
        "calibration_summary": {
            k: v for k, v in (run.calibration or {}).items()
            if isinstance(v, dict)
        },
        "shadow_results": run.shadow_results or {},
        "transpiler_settings": run.transpiler or {},
        "notes": getattr(run, "notes", None),
    }
