"""Alert Rules and Weekly Digest.

Alert rules fire webhooks (including Slack Block Kit) when a run's metric
crosses a threshold. The digest endpoint aggregates experiment activity
with an optional AI narrative.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import Identity, get_identity, require_auth
from ..models import Run
from ..health_score import compute_health_score
from .credentials import get_active_key_for_user

router = APIRouter(prefix="/api/v1/alerts", tags=["alerts"])

_METRICS = {"health_score", "success_probability", "depth", "size", "num_qubits", "non_clifford_ratio", "tvd"}
_OPERATORS = {"lt", "gt", "lte", "gte", "eq"}
_MODEL = os.getenv("QLAB_INSIGHT_MODEL", "claude-haiku-4-5")


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class AlertRuleCreate(BaseModel):
    name: str = Field(..., max_length=200)
    metric: str
    operator: str
    threshold: float
    project: Optional[str] = None
    backend: Optional[str] = None
    webhook_url: Optional[str] = Field(None, max_length=1000)
    is_slack: bool = False
    active: bool = True


# ---------------------------------------------------------------------------
# In-memory store (upgrade to DB table via startup migration in main.py)
# ---------------------------------------------------------------------------
# We store rules in an in-process list AND persist to a JSON sidecar file.
# This avoids a model import cycle while keeping persistence across restarts.

import pathlib
_RULES_FILE = pathlib.Path(os.getenv("QLAB_DATA_DIR", "data")) / "alert_rules.json"


def _load_rules() -> list[dict]:
    try:
        if _RULES_FILE.exists():
            return json.loads(_RULES_FILE.read_text())
        return []
    except Exception:
        return []


def _save_rules(rules: list[dict]) -> None:
    try:
        _RULES_FILE.parent.mkdir(parents=True, exist_ok=True)
        _RULES_FILE.write_text(json.dumps(rules, indent=2))
    except Exception:
        pass


def _next_id(rules: list[dict]) -> int:
    return max((r.get("id", 0) for r in rules), default=0) + 1


# ---------------------------------------------------------------------------
# Webhook delivery
# ---------------------------------------------------------------------------

def _slack_payload(rule: dict, run: dict, metric_value: float) -> dict:
    health = run.get("health_score")
    health_emoji = "🟢" if health and health >= 70 else ("🟡" if health and health >= 40 else "🔴")
    return {
        "blocks": [
            {
                "type": "header",
                "text": {"type": "plain_text", "text": f"⚡ Q-Lab Alert: {rule['name']}"},
            },
            {
                "type": "section",
                "fields": [
                    {"type": "mrkdwn", "text": f"*Run:*\n`{run.get('run_id', '')[:12]}`"},
                    {"type": "mrkdwn", "text": f"*Backend:*\n{run.get('backend') or '—'}"},
                    {"type": "mrkdwn", "text": f"*{rule['metric']}:*\n{metric_value:.4f} ({rule['operator']} {rule['threshold']})"},
                    {"type": "mrkdwn", "text": f"*Health:*\n{health_emoji} {health or '—'}"},
                ],
            },
            {
                "type": "context",
                "elements": [
                    {"type": "mrkdwn", "text": f"Project: {run.get('project') or '—'} | {run.get('created_at', '')[:19]}"},
                ],
            },
        ]
    }


def _generic_payload(rule: dict, run: dict, metric_value: float) -> dict:
    return {
        "event": "qlab.alert",
        "rule_name": rule["name"],
        "metric": rule["metric"],
        "operator": rule["operator"],
        "threshold": rule["threshold"],
        "metric_value": metric_value,
        "run_id": run.get("run_id"),
        "backend": run.get("backend"),
        "project": run.get("project"),
        "health_score": run.get("health_score"),
        "created_at": run.get("created_at"),
    }


def _fire_webhook(rule: dict, run: dict, metric_value: float) -> bool:
    url = rule.get("webhook_url")
    if not url:
        return False
    payload = _slack_payload(rule, run, metric_value) if rule.get("is_slack") else _generic_payload(rule, run, metric_value)
    try:
        resp = httpx.post(url, json=payload, timeout=5.0)
        return resp.status_code < 300
    except Exception:
        return False


def _operator_passes(value: float, op: str, threshold: float) -> bool:
    if op == "lt":  return value < threshold
    if op == "gt":  return value > threshold
    if op == "lte": return value <= threshold
    if op == "gte": return value >= threshold
    if op == "eq":  return abs(value - threshold) < 1e-9
    return False


def _extract_metric(run: Run, metric: str) -> Optional[float]:
    fp = run.fingerprint or {}
    res = run.results or {}
    sr = run.shadow_results or {}
    if metric == "health_score":
        rd = {"results": res, "calibration": run.calibration or {}, "fingerprint": fp}
        h = compute_health_score(rd)
        return float(h) if h is not None else None
    if metric == "tvd":
        v = sr.get("tvd")
        return float(v) if v is not None else None
    for src in [fp, res]:
        v = src.get(metric)
        if v is not None:
            try:
                return float(v)
            except (TypeError, ValueError):
                pass
    return None


def check_run_against_alerts(run: Run) -> list[str]:
    """Fire any matching alert rules for a run. Returns list of fired rule names."""
    rules = [r for r in _load_rules() if r.get("active", True)]
    if not rules:
        return []

    run_dict = {
        "run_id": run.run_id,
        "backend": run.backend,
        "project": run.project_slug,
        "health_score": None,
        "created_at": run.created_at.isoformat() if run.created_at else None,
    }
    # Compute health once
    rd = {"results": run.results or {}, "calibration": run.calibration or {}, "fingerprint": run.fingerprint or {}}
    run_dict["health_score"] = compute_health_score(rd)

    fired = []
    for rule in rules:
        # Filter checks
        if rule.get("project") and rule["project"] != run.project_slug:
            continue
        if rule.get("backend") and rule["backend"] != run.backend:
            continue

        metric_val = _extract_metric(run, rule["metric"])
        if metric_val is None:
            continue

        if _operator_passes(metric_val, rule["operator"], rule["threshold"]):
            _fire_webhook(rule, run_dict, metric_val)
            fired.append(rule["name"])

    return fired


# ---------------------------------------------------------------------------
# CRUD endpoints
# ---------------------------------------------------------------------------

@router.get("/rules")
def list_rules(identity: Optional[Identity] = Depends(get_identity)):
    return _load_rules()


@router.post("/rules")
def create_rule(body: AlertRuleCreate, identity: Identity = Depends(require_auth)):
    if body.metric not in _METRICS:
        raise HTTPException(422, f"metric must be one of: {sorted(_METRICS)}")
    if body.operator not in _OPERATORS:
        raise HTTPException(422, f"operator must be one of: {sorted(_OPERATORS)}")
    rules = _load_rules()
    rule = {
        "id": _next_id(rules),
        "name": body.name,
        "metric": body.metric,
        "operator": body.operator,
        "threshold": body.threshold,
        "project": body.project,
        "backend": body.backend,
        "webhook_url": body.webhook_url,
        "is_slack": body.is_slack,
        "active": body.active,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "fired_count": 0,
    }
    rules.append(rule)
    _save_rules(rules)
    return rule


@router.delete("/rules/{rule_id}")
def delete_rule(rule_id: int, identity: Identity = Depends(require_auth)):
    rules = _load_rules()
    before = len(rules)
    rules = [r for r in rules if r.get("id") != rule_id]
    if len(rules) == before:
        raise HTTPException(404, "Rule not found")
    _save_rules(rules)
    return {"deleted": True}


@router.patch("/rules/{rule_id}/toggle")
def toggle_rule(rule_id: int, identity: Identity = Depends(require_auth)):
    rules = _load_rules()
    for r in rules:
        if r.get("id") == rule_id:
            r["active"] = not r.get("active", True)
            _save_rules(rules)
            return r
    raise HTTPException(404, "Rule not found")


@router.post("/check/{run_id}")
def check_run(run_id: str, db: Session = Depends(get_db), identity: Optional[Identity] = Depends(get_identity)):
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if not run:
        raise HTTPException(404, "Run not found")
    fired = check_run_against_alerts(run)
    return {"run_id": run_id, "fired_rules": fired, "fired_count": len(fired)}


# ---------------------------------------------------------------------------
# Digest
# ---------------------------------------------------------------------------

@router.get("/digest")
def get_digest(
    days: int = Query(7, ge=1, le=90),
    project: Optional[str] = None,
    with_ai: bool = Query(False),
    db: Session = Depends(get_db),
    identity: Optional[Identity] = Depends(get_identity),
):
    since = datetime.now(timezone.utc) - timedelta(days=days)
    q = select(Run).where(Run.created_at >= since)
    if identity and identity.org_id:
        q = q.where(Run.org_id == identity.org_id)
    if project:
        q = q.where(Run.project_slug == project)
    runs = db.scalars(q.order_by(Run.created_at.desc()).limit(500)).all()

    total = len(runs)
    by_status: dict[str, int] = {}
    by_backend: dict[str, int] = {}
    by_project: dict[str, int] = {}
    health_scores: list[float] = []
    best_run = worst_run = None
    best_h = -1.0
    worst_h = 101.0

    for run in runs:
        by_status[run.status] = by_status.get(run.status, 0) + 1
        if run.backend:
            by_backend[run.backend] = by_backend.get(run.backend, 0) + 1
        if run.project_slug:
            by_project[run.project_slug] = by_project.get(run.project_slug, 0) + 1
        rd = {"results": run.results or {}, "calibration": run.calibration or {}, "fingerprint": run.fingerprint or {}}
        h = compute_health_score(rd)
        if h is not None:
            health_scores.append(h)
            if h > best_h:
                best_h = h
                best_run = {"run_id": run.run_id, "circuit_name": run.circuit_name, "backend": run.backend, "health_score": round(h, 1)}
            if h < worst_h:
                worst_h = h
                worst_run = {"run_id": run.run_id, "circuit_name": run.circuit_name, "backend": run.backend, "health_score": round(h, 1)}

    completed = by_status.get("completed", 0)
    avg_health = round(sum(health_scores) / len(health_scores), 1) if health_scores else None

    digest = {
        "period_days": days,
        "project": project,
        "total_runs": total,
        "completed_runs": completed,
        "failed_runs": by_status.get("failed", 0),
        "completion_rate": round(completed / total, 3) if total else 0,
        "avg_health": avg_health,
        "best_run": best_run,
        "worst_run": worst_run,
        "by_status": by_status,
        "by_backend": dict(sorted(by_backend.items(), key=lambda x: -x[1])[:10]),
        "by_project": dict(sorted(by_project.items(), key=lambda x: -x[1])[:10]),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "ai_summary": None,
    }

    ai_key = get_active_key_for_user(db, "anthropic", identity.user_id) if identity else None
    if with_ai and ai_key:
        digest["ai_summary"] = _ai_digest_summary(digest, ai_key)

    return digest


def _ai_digest_summary(digest: dict, api_key: str) -> Optional[str]:
    try:
        import anthropic
        prompt = f"""Write a 3-sentence executive digest of a quantum researcher's experiment activity.

Data:
- Period: last {digest['period_days']} days
- Total runs: {digest['total_runs']} ({digest['completed_runs']} completed, {digest['failed_runs']} failed)
- Completion rate: {digest['completion_rate']*100:.1f}%
- Average health score: {digest['avg_health'] or 'N/A'}/100
- Best run: {digest.get('best_run', {}).get('circuit_name') or 'unknown'} on {digest.get('best_run', {}).get('backend') or 'unknown'} (health: {digest.get('best_run', {}).get('health_score')})
- Top backends: {', '.join(list(digest['by_backend'].keys())[:3]) or 'none'}
- Top projects: {', '.join(list(digest['by_project'].keys())[:3]) or 'none'}

Be specific and scientific. No generic phrases. Reference actual numbers."""
        client = anthropic.Anthropic(api_key=api_key)
        msg = client.messages.create(model=_MODEL, max_tokens=200, temperature=0.1, messages=[{"role": "user", "content": prompt}])
        return msg.content[0].text.strip()
    except Exception:
        return None
