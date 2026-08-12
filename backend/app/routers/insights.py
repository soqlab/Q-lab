"""AI Insight Engine — generate natural language analysis of a run using Claude.

Insights are cached in the `run_insights` table after first generation.
Set ANTHROPIC_API_KEY in the environment to enable.
"""

from __future__ import annotations

import json
import math
import os
import statistics
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from ..ai_rate_limit import check_ai_limit
from ..database import get_db
from ..deps import Identity, log_audit, require_auth
from ..health_score import compute_health_score, health_breakdown
from ..models import Run, RunMetric

router = APIRouter(prefix="/api/v1/runs", tags=["insights"])

_MODEL = os.getenv("QLAB_INSIGHT_MODEL", "claude-sonnet-4-6")
_PROMPT_VERSION = "v4"

# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

_DDL = """
CREATE TABLE IF NOT EXISTS run_insights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id VARCHAR(64) NOT NULL,
    prompt_version VARCHAR(16) NOT NULL,
    model VARCHAR(64) NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(run_id, prompt_version)
)
"""


def _ensure_table(db: Session) -> None:
    try:
        db.execute(text(_DDL))
        db.commit()
    except Exception:
        pass


def _get_cached(db: Session, run_id: str) -> dict | None:
    try:
        row = db.execute(
            text("SELECT content, model, created_at FROM run_insights WHERE run_id = :rid AND prompt_version = :pv"),
            {"rid": run_id, "pv": _PROMPT_VERSION},
        ).mappings().first()
        if row:
            return {"cached": True, "model": row["model"], "created_at": row["created_at"], **json.loads(row["content"])}
    except Exception:
        pass
    return None


def _save_cached(db: Session, run_id: str, model: str, content: dict) -> None:
    try:
        _ensure_table(db)
        db.execute(
            text("""
                INSERT OR REPLACE INTO run_insights (run_id, prompt_version, model, content, created_at)
                VALUES (:rid, :pv, :model, :content, :now)
            """),
            {"rid": run_id, "pv": _PROMPT_VERSION, "model": model,
             "content": json.dumps(content), "now": datetime.now(timezone.utc).isoformat()},
        )
        db.commit()
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Prompt builder
# ---------------------------------------------------------------------------

def _safe_float(v: Any) -> float | None:
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def _get_peer_median(db: Session, run: Run) -> float | None:
    """Compute median health score of last 10 runs on the same backend."""
    if not run.backend:
        return None
    try:
        peer_runs = db.scalars(
            select(Run)
            .where(Run.backend == run.backend)
            .where(Run.run_id != run.run_id)
            .order_by(Run.created_at.desc())
            .limit(10)
        ).all()
        scores = []
        for pr in peer_runs:
            rd = {
                "run_id": pr.run_id, "backend": pr.backend, "status": pr.status,
                "fingerprint": pr.fingerprint or {}, "calibration": pr.calibration or {},
                "results": pr.results or {}, "shadow_results": pr.shadow_results or {},
            }
            s = compute_health_score(rd)
            if s is not None:
                scores.append(s)
        if scores:
            return round(statistics.median(scores), 1)
    except Exception:
        pass
    return None


def _build_context(run: Run, db: Session) -> dict:
    """Assemble all available run data into a compact context dict for the prompt."""
    fp = run.fingerprint or {}
    cal = run.calibration or {}
    shadow = run.shadow_results or {}
    transpiler = run.transpiler or {}

    run_dict = {
        "run_id": run.run_id,
        "backend": run.backend,
        "fingerprint": fp,
        "calibration": cal,
        "shadow_results": shadow,
        "results": run.results or {},
        "status": run.status,
    }
    hs = compute_health_score(run_dict)
    hb = health_breakdown(run_dict)

    # Gather step metrics (convergence / landscape)
    metrics = db.scalars(
        select(RunMetric).where(RunMetric.run_id == run.run_id).order_by(RunMetric.name, RunMetric.step)
    ).all()
    metric_summary: dict[str, dict] = {}
    for m in metrics:
        v = _safe_float(m.value)
        if v is None:
            continue
        s = metric_summary.setdefault(m.name, {"values": [], "steps": []})
        s["values"].append(v)
        if m.step is not None:
            s["steps"].append(m.step)
    metric_stats: dict[str, dict] = {}
    for name, data in metric_summary.items():
        vals = data["values"]
        metric_stats[name] = {
            "count": len(vals),
            "initial": vals[0] if vals else None,
            "final": vals[-1] if vals else None,
            "best": min(vals),
            "has_steps": len(data["steps"]) > 0,
        }

    # Calibration summary
    cal_summary: dict[str, Any] = {}
    ge_1q_list, ge_2q_list, t1_list, t2_list, ro_list = [], [], [], [], []
    for key, val in cal.items():
        if isinstance(val, dict):
            if "gate_error" in val:
                ge_1q_list.append(float(val["gate_error"]))
            if "cx_error" in val or "ecr_error" in val:
                ge_2q_list.append(float(val.get("cx_error") or val.get("ecr_error") or 0))
            if "T1" in val:
                t1_list.append(float(val["T1"]))
            if "T2" in val:
                t2_list.append(float(val["T2"]))
            if "readout_error" in val:
                ro_list.append(float(val["readout_error"]))
    if ge_1q_list:
        cal_summary["avg_gate_error_1q"] = round(sum(ge_1q_list) / len(ge_1q_list), 5)
    if ge_2q_list:
        cal_summary["avg_gate_error_2q"] = round(sum(ge_2q_list) / len(ge_2q_list), 4)
    if t1_list:
        cal_summary["avg_T1_us"] = round(sum(t1_list) / len(t1_list), 1)
    if t2_list:
        cal_summary["avg_T2_us"] = round(sum(t2_list) / len(t2_list), 1)
    if ro_list:
        cal_summary["avg_readout_error"] = round(sum(ro_list) / len(ro_list), 4)

    peer_median = _get_peer_median(db, run)

    return {
        "run_id": run.run_id,
        "circuit_name": run.circuit_name,
        "backend": run.backend,
        "status": run.status,
        "project": run.project_slug,
        "created_at": run.created_at.isoformat() if run.created_at else None,
        # Full raw data for deep-circuit prompt
        "qasm": run.qasm,
        "calibration_raw": cal,
        "transpiler_raw": transpiler,
        "results_raw": run.results or {},
        # Summarised data kept for other consumers
        "fingerprint": {
            "num_qubits": fp.get("num_qubits"),
            "depth": fp.get("depth"),
            "size": fp.get("size"),
            "non_clifford_ratio": fp.get("non_clifford_ratio"),
            "gate_counts": fp.get("gate_counts"),
        },
        "health_score": hs,
        "health_breakdown": {k: v for k, v in (hb or {}).items() if v is not None},
        "calibration_summary": cal_summary,
        "shadow": {
            "tvd": shadow.get("tvd"),
            "fidelity": shadow.get("fidelity"),
            "has_shadow": shadow.get("has_shadow"),
        } if shadow else {},
        "transpiler": {
            "swap_count": transpiler.get("swap_count"),
            "depth_overhead_pct": transpiler.get("depth_overhead_pct"),
            "duration_ms": transpiler.get("duration_ms"),
            "optimization_level": transpiler.get("settings", {}).get("optimization_level") if isinstance(transpiler.get("settings"), dict) else transpiler.get("optimization_level"),
            "basis_gates": transpiler.get("basis_gates") or transpiler.get("settings", {}).get("basis_gates") if isinstance(transpiler.get("settings"), dict) else None,
            "original_depth": transpiler.get("original_depth"),
            "gate_counts_after": transpiler.get("gate_counts"),
        },
        "metrics": metric_stats,
        "parameters": run.parameters or {},
        "tags": run.tags or [],
        "peer_median": peer_median,
    }


def _build_prompt(ctx: dict) -> str:
    """Build a rich, circuit-specific deep-analysis prompt."""
    fp = ctx["fingerprint"]
    cal = ctx["calibration_summary"]
    shadow = ctx["shadow"]
    metrics = ctx["metrics"]
    transpiler = ctx["transpiler"]

    # --- QASM section ---
    qasm = ctx.get("qasm") or ""
    if qasm:
        qasm_excerpt = qasm[:3000] + ("\n... [truncated]" if len(qasm) > 3000 else "")
    else:
        qasm_excerpt = None

    # --- Calibration detail ---
    cal_raw = ctx.get("calibration_raw") or {}
    t1_us = cal.get("avg_T1_us", "N/A")
    t2_us = cal.get("avg_T2_us", "N/A")
    readout_err = cal.get("avg_readout_error", "N/A")
    gate_err_1q = cal.get("avg_gate_error_1q", "N/A")
    gate_err_2q = cal.get("avg_gate_error_2q", "N/A")
    gate_errors_str = f"1Q avg={gate_err_1q}, 2Q avg={gate_err_2q}"

    # --- Transpiler detail ---
    opt_level = transpiler.get("optimization_level", "N/A")
    depth = fp.get("depth", "N/A")
    original_depth = transpiler.get("original_depth", "N/A")
    gate_counts = fp.get("gate_counts") or transpiler.get("gate_counts_after") or {}
    basis_gates = transpiler.get("basis_gates") or "N/A"

    # --- Results ---
    results_raw = ctx.get("results_raw") or {}
    success_prob = results_raw.get("success_probability") or "N/A"

    # --- Metrics ---
    metrics_lines = []
    for name, s in list(metrics.items())[:8]:
        if s["has_steps"]:
            imp = ((s["final"] or 0) - (s["initial"] or 0))
            metrics_lines.append(f"  {name}: initial={s['initial']}, final={s['final']}, best={s['best']}, improvement={imp:+.4f} over {s['count']} steps")
        else:
            metrics_lines.append(f"  {name}: {s['final']} ({s['count']} readings)")

    peer_median = ctx.get("peer_median")
    health_score = ctx.get("health_score", "N/A")
    health_breakdown_data = ctx.get("health_breakdown") or {}

    lines = [
        "You are a quantum computing expert analyzing a specific experiment. Provide deep, circuit-specific insights.",
        "",
    ]

    if qasm_excerpt:
        lines += [
            "CIRCUIT (QASM):",
            qasm_excerpt,
            "",
        ]

    if cal_raw:
        lines += [
            "CALIBRATION (at time of run):",
            f"- T1 coherence: {t1_us}µs, T2: {t2_us}µs",
            f"- Readout error: {readout_err}",
            f"- Gate errors: {gate_errors_str}",
            f"- Backend: {ctx.get('backend') or 'unknown'}",
            "",
        ]

    lines += [
        "TRANSPILER:",
        f"- Optimization level: {opt_level}",
        f"- Circuit depth: {depth} (original: {original_depth})",
        f"- Gate counts: {json.dumps(gate_counts) if gate_counts else 'N/A'}",
        f"- Basis gates: {basis_gates}",
        "",
        "RESULTS:",
        f"- Success probability: {success_prob}",
        f"- Health score: {health_score}/100",
        f"- Health breakdown: {json.dumps(health_breakdown_data)}",
    ]

    if metrics_lines:
        lines.append(f"- Key metrics:")
        lines.extend(metrics_lines)

    if peer_median is not None:
        lines.append(f"- Backend median health (last 10 runs): {peer_median}/100")

    lines += [
        "",
        "Provide analysis in this exact JSON structure (respond ONLY with valid JSON, no markdown fences):",
        '{',
        '  "grade": "A+/A/B/C/D/F",',
        '  "headline": "one sentence summary of this specific circuit\'s performance",',
        '  "circuit_analysis": {',
        '    "algorithm_type": "detected algorithm type (VQE/QAOA/Grover/QFT/Bell/Random/Other)",',
        '    "gate_efficiency": "analysis of gate usage relative to theoretical minimum",',
        '    "depth_assessment": "is this circuit too deep for the T1/T2 coherence times?",',
        '    "entanglement_structure": "description of entanglement pattern"',
        '  },',
        '  "calibration_fit": "does this circuit fit the current backend calibration well?",',
        '  "bottleneck": "the single most impactful factor limiting performance",',
        '  "key_findings": ["finding 1", "finding 2", "finding 3"],',
        '  "recommendations": [',
        '    {"action": "specific action", "expected_improvement": "quantified estimate", "priority": "high/medium/low"}',
        '  ],',
        '  "next_experiment": "specific suggestion for what to run next to improve results",',
        '  "publication_note": "assessment of whether these results are publication-worthy and why",',
        '  "summary": "2-3 sentence executive summary with specific numbers",',
        '  "performance_grade": "A+|A|B+|B|C+|C|D|F",',
        '  "grade_rationale": "one sentence explaining the grade",',
        '  "primary_bottleneck": "the single most limiting factor with magnitude",',
        '  "error_budget_narrative": "2-3 sentences on where error is coming from",',
        '  "next_experiment": "concrete suggestion for what to run next",',
        '  "confidence": "high|medium|low"',
        '}',
        "",
        "Be specific. Reference actual numbers from the data. Do not invent numbers not present in the data.",
    ]

    return "\n".join(lines)


def _build_circuit_prompt(ctx: dict) -> str:
    """Focused prompt for the /insights/circuit endpoint — gate-level analysis only."""
    fp = ctx["fingerprint"]
    cal = ctx["calibration_summary"]
    transpiler = ctx["transpiler"]
    qasm = ctx.get("qasm") or ""
    qasm_excerpt = qasm[:3000] + ("\n... [truncated]" if len(qasm) > 3000 else "") if qasm else "Not available"

    t1_us = cal.get("avg_T1_us", "N/A")
    t2_us = cal.get("avg_T2_us", "N/A")
    depth = fp.get("depth", "N/A")
    num_qubits = fp.get("num_qubits", "N/A")
    gate_counts = fp.get("gate_counts") or {}
    non_clifford_ratio = fp.get("non_clifford_ratio")

    return "\n".join([
        "You are a quantum circuit optimization expert. Analyze this circuit at the gate level.",
        "",
        "CIRCUIT (QASM):",
        qasm_excerpt,
        "",
        f"CIRCUIT STATS: depth={depth}, qubits={num_qubits}, gates={json.dumps(gate_counts)}, non-Clifford ratio={non_clifford_ratio}",
        f"COHERENCE: T1={t1_us}µs, T2={t2_us}µs",
        f"TRANSPILER: optimization level={transpiler.get('optimization_level', 'N/A')}, basis_gates={transpiler.get('basis_gates', 'N/A')}",
        "",
        "Respond ONLY with valid JSON (no markdown fences):",
        '{',
        '  "algorithm_type": "detected algorithm (VQE/QAOA/Grover/QFT/Bell/Random/Other)",',
        '  "gate_efficiency_score": 75,',
        '  "gate_efficiency_rationale": "explanation comparing to theoretical minimum",',
        '  "depth_coherence_ratio": "depth vs T1/T2 analysis — is the circuit too deep?",',
        '  "entanglement_structure": "description of entanglement pattern from CNOT/CX topology",',
        '  "gate_optimizations": [',
        '    {"optimization": "specific gate-level change", "gates_saved": "estimated reduction", "priority": "high/medium/low"},',
        '    {"optimization": "...", "gates_saved": "...", "priority": "..."},',
        '    {"optimization": "...", "gates_saved": "...", "priority": "..."}',
        '  ]',
        '}',
    ])


# ---------------------------------------------------------------------------
# Claude API call
# ---------------------------------------------------------------------------

def _call_claude(prompt: str, max_tokens: int = 2000) -> dict:
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY not set")

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)
        msg = client.messages.create(
            model=_MODEL,
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
        )
        raw = msg.content[0].text.strip()
        # Strip markdown fences if model wraps in them despite instruction
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1]
            raw = raw.rsplit("```", 1)[0].strip()
        return json.loads(raw)
    except (ImportError, ModuleNotFoundError):
        raise ValueError("anthropic package not installed — run: pip install anthropic")


def _stream_claude(prompt: str):
    """Yield SSE-formatted chunks from a streaming Claude response."""
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        yield 'data: {"error": "ANTHROPIC_API_KEY not set"}\n\n'
        return
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)
        with client.messages.stream(
            model=_MODEL,
            max_tokens=2000,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
        ) as stream:
            for text in stream.text_stream:
                chunk = json.dumps({"delta": text})
                yield f"data: {chunk}\n\n"
        yield 'data: {"done": true}\n\n'
    except Exception as e:
        yield f'data: {json.dumps({"error": str(e)})}\n\n'


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/{run_id}/insights/generate")
def generate_insights(
    run_id: str,
    force: bool = Query(False, description="Re-generate even if cached"),
    db: Session = Depends(get_db),
    identity: Identity = Depends(require_auth),
):
    """Generate AI insights for a run. Cached after first generation."""
    check_ai_limit(identity)
    if not os.getenv("ANTHROPIC_API_KEY"):
        raise HTTPException(status_code=503, detail="AI insights unavailable — ANTHROPIC_API_KEY not configured")

    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")

    _ensure_table(db)

    if not force:
        cached = _get_cached(db, run_id)
        if cached:
            return cached

    ctx = _build_context(run, db)
    prompt = _build_prompt(ctx)

    try:
        result = _call_claude(prompt)
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"AI returned invalid JSON: {e}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI generation failed: {e}")

    _save_cached(db, run_id, _MODEL, result)

    try:
        from .billing import track_ai_insight
        track_ai_insight(db, identity.user_id)
    except Exception:
        pass

    log_audit(db, "insight.generated", "run", run_id, identity=identity, meta={"model": _MODEL})
    return {"cached": False, "model": _MODEL, "created_at": datetime.now(timezone.utc).isoformat(), **result}


@router.get("/{run_id}/insights")
def get_insights(run_id: str, db: Session = Depends(get_db)):
    """Return cached insights, or 404 if not yet generated."""
    if not os.getenv("ANTHROPIC_API_KEY"):
        raise HTTPException(status_code=503, detail="AI insights unavailable — ANTHROPIC_API_KEY not configured")

    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")

    _ensure_table(db)
    cached = _get_cached(db, run_id)
    if not cached:
        raise HTTPException(status_code=404, detail="No insights generated yet. POST /insights/generate first.")
    return cached


@router.post("/{run_id}/insights/stream")
def stream_insights(run_id: str, db: Session = Depends(get_db), identity: Identity = Depends(require_auth)):
    """Stream insight generation as SSE for live display."""
    check_ai_limit(identity)
    if not os.getenv("ANTHROPIC_API_KEY"):
        raise HTTPException(status_code=503, detail="AI insights unavailable — ANTHROPIC_API_KEY not configured")

    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")

    ctx = _build_context(run, db)
    prompt = _build_prompt(ctx)

    return StreamingResponse(
        _stream_claude(prompt),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/{run_id}/insights/circuit")
def circuit_insights(run_id: str, db: Session = Depends(get_db), identity: Identity = Depends(require_auth)):
    """Deep gate-level circuit analysis — always re-runs, no cache. Returns structured JSON."""
    check_ai_limit(identity)
    if not os.getenv("ANTHROPIC_API_KEY"):
        raise HTTPException(status_code=503, detail="AI insights unavailable — ANTHROPIC_API_KEY not configured")

    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")

    ctx = _build_context(run, db)
    prompt = _build_circuit_prompt(ctx)

    try:
        result = _call_claude(prompt, max_tokens=1000)
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"AI returned invalid JSON: {e}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Circuit analysis failed: {e}")

    try:
        from .billing import track_ai_insight
        track_ai_insight(db, identity.user_id)
    except Exception:
        pass

    return {
        "run_id": run_id,
        "model": _MODEL,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        **result,
    }


@router.get("/insights/status")
def insights_status():
    """Check if AI insights are configured."""
    has_key = bool(os.getenv("ANTHROPIC_API_KEY"))
    return {
        "available": has_key,
        "model": _MODEL if has_key else None,
        "message": "Ready" if has_key else "Set ANTHROPIC_API_KEY to enable AI insights",
    }
