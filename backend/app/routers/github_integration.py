"""GitHub App integration for Q-Lab.

Links quantum experiments to git commits and auto-comments on PRs.
Router prefix: /api/v1/github
"""

from __future__ import annotations

import hashlib
import hmac
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import Identity, get_identity, require_auth
from ..models import Run
from ..store import store_delete, store_get, store_list, store_put

APP_URL = os.getenv("QLAB_APP_URL", "https://www.soqlab.com")

router = APIRouter(prefix="/api/v1/github", tags=["github"])

_NAMESPACE = "github_configs"
_CONFIG_ID = "default"


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class GitHubConfig(BaseModel):
    config_id: str = _CONFIG_ID
    installation_id: Optional[str] = None
    github_token: str
    repo_owner: str
    repo_name: str
    auto_comment_prs: bool = True
    min_health_score_badge: int = 50
    comment_template: str = "markdown"
    created_at: str = ""


class ConfigSavePayload(BaseModel):
    installation_id: Optional[str] = None
    github_token: str
    repo_owner: str
    repo_name: str
    auto_comment_prs: bool = True
    min_health_score_badge: int = 50
    comment_template: str = "markdown"


class CommentRunBody(BaseModel):
    pr_number: int


class LinkCommitBody(BaseModel):
    commit_sha: str
    repo: Optional[str] = None


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _get_config(db: Session) -> Optional[dict]:
    return store_get(db, _NAMESPACE, _CONFIG_ID)


def _build_pr_comment(runs: list) -> str:
    """Build a markdown comment for a GitHub PR."""
    total = len(runs)
    successful = sum(1 for r in runs if r.status == "completed")
    avg_health = sum((r.results or {}).get("health_score", 0) for r in runs) / max(total, 1)

    emoji = "🟢" if avg_health >= 75 else "🟡" if avg_health >= 50 else "🔴"

    lines = [
        "## ⚛️ Q-Lab Quantum Experiment Results",
        "",
        "| Metric | Value |",
        "|--------|-------|",
        f"| Total Runs | {total} |",
        f"| Successful | {successful}/{total} |",
        f"| Avg Health Score | {emoji} {avg_health:.1f}/100 |",
        "",
        "### Runs",
        "| Circuit | Backend | Health | Status | Link |",
        "|---------|---------|--------|--------|------|",
    ]
    for r in runs[:10]:
        health = (r.results or {}).get("health_score", "N/A")
        if isinstance(health, (int, float)):
            health_emoji = "🟢" if health >= 75 else "🟡" if health >= 50 else "🔴"
        else:
            health_emoji = "🔴"
        lines.append(
            f"| {r.circuit_name or 'unnamed'} | {r.backend or '?'} "
            f"| {health_emoji} {health} | {r.status} "
            f"| [View]({APP_URL}/runs/{r.run_id}) |"
        )

    if total > 10:
        lines.append(f"\n*...and {total - 10} more runs*")

    lines.extend(["", "_Posted by [Q-Lab](https://github.com/qlab)_"])
    return "\n".join(lines)


def _build_single_run_comment(run: Run) -> str:
    """Build a markdown comment for a single run."""
    health = (run.results or {}).get("health_score", "N/A")
    if isinstance(health, (int, float)):
        emoji = "🟢" if health >= 75 else "🟡" if health >= 50 else "🔴"
    else:
        emoji = "🔴"
    lines = [
        "## ⚛️ Q-Lab Quantum Experiment Result",
        "",
        "| Field | Value |",
        "|-------|-------|",
        f"| Run ID | `{run.run_id}` |",
        f"| Circuit | {run.circuit_name or 'unnamed'} |",
        f"| Backend | {run.backend or '?'} |",
        f"| Status | {run.status} |",
        f"| Health Score | {emoji} {health} |",
        f"| Created | {run.created_at.isoformat() if run.created_at else '?'} |",
        "",
        f"[View in Q-Lab]({APP_URL}/runs/{run.run_id})",
        "",
        "_Posted by [Q-Lab](https://github.com/qlab)_",
    ]
    return "\n".join(lines)


async def _post_github_comment(token: str, owner: str, repo: str, pr_number: int, body: str) -> bool:
    url = f"https://api.github.com/repos/{owner}/{repo}/issues/{pr_number}/comments"
    headers = {
        "Authorization": f"token {token}",
        "Accept": "application/vnd.github+json",
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json={"body": body}, headers=headers)
            return resp.status_code in (200, 201)
    except Exception:
        return False


def _verify_github_signature(body: bytes, signature_header: Optional[str], secret: str) -> bool:
    if not signature_header:
        return False
    expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature_header)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/config")
async def save_config(
    payload: ConfigSavePayload,
    db: Session = Depends(get_db),
    identity: Optional[Identity] = Depends(get_identity),
):
    """Save GitHub integration config; validates the token against GitHub API."""
    headers = {
        "Authorization": f"token {payload.github_token}",
        "Accept": "application/vnd.github+json",
    }
    github_user: Optional[str] = None
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get("https://api.github.com/user", headers=headers)
        if resp.status_code != 200:
            raise HTTPException(status_code=400, detail="Invalid GitHub token — could not authenticate with GitHub API")
        github_user = resp.json().get("login")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Failed to reach GitHub API — check your token and network")

    config: dict[str, Any] = {
        "config_id": _CONFIG_ID,
        "installation_id": payload.installation_id,
        "github_token": payload.github_token,
        "repo_owner": payload.repo_owner,
        "repo_name": payload.repo_name,
        "auto_comment_prs": payload.auto_comment_prs,
        "min_health_score_badge": payload.min_health_score_badge,
        "comment_template": payload.comment_template,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    store_put(db, _NAMESPACE, _CONFIG_ID, config)
    return {**config, "verified": True, "github_user": github_user}


@router.get("/config")
def get_config(
    db: Session = Depends(get_db),
    identity: Optional[Identity] = Depends(get_identity),
):
    """Get current GitHub integration config."""
    config = _get_config(db)
    if not config:
        raise HTTPException(status_code=404, detail="No GitHub integration configured")
    # Mask token for safety
    masked = {**config, "github_token": config["github_token"][:8] + "***" if config.get("github_token") else ""}
    return masked


@router.delete("/config")
def delete_config(
    db: Session = Depends(get_db),
    identity: Identity = Depends(require_auth),
):
    """Remove GitHub integration."""
    deleted = store_delete(db, _NAMESPACE, _CONFIG_ID)
    if not deleted:
        raise HTTPException(status_code=404, detail="No GitHub integration to remove")
    return {"deleted": True}


@router.post("/webhook")
async def github_webhook(
    request: Request,
    x_hub_signature_256: Optional[str] = Header(default=None),
    x_github_event: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    """Receive GitHub webhook payloads (pull_request events)."""
    body = await request.body()

    # Verify HMAC signature if secret env var is set
    webhook_secret = os.getenv("GITHUB_WEBHOOK_SECRET")
    if webhook_secret:
        if not _verify_github_signature(body, x_hub_signature_256, webhook_secret):
            # Return 200 anyway so GitHub doesn't retry with bad signature
            return {"processed": False, "error": "invalid_signature", "runs_found": 0, "comment_posted": False}

    # Parse JSON payload
    try:
        payload = await request.json()
    except Exception:
        return {"processed": False, "error": "invalid_json", "runs_found": 0, "comment_posted": False}

    event_type = x_github_event or payload.get("action", "")
    action = payload.get("action", "")

    # Only handle pull_request open/sync events
    if x_github_event != "pull_request" or action not in ("opened", "synchronize"):
        return {"processed": False, "reason": "not_a_pr_event", "runs_found": 0, "comment_posted": False}

    pr = payload.get("pull_request", {})
    commit_sha: str = pr.get("head", {}).get("sha", "")
    pr_number: int = payload.get("number", 0)

    if not commit_sha or not pr_number:
        return {"processed": False, "reason": "missing_sha_or_pr", "runs_found": 0, "comment_posted": False}

    # Find matching runs
    since = datetime.now(timezone.utc) - timedelta(hours=24)
    q = select(Run).where(Run.created_at >= since).order_by(Run.created_at.desc()).limit(200)
    recent_runs = list(db.scalars(q).all())

    matching_runs = [r for r in recent_runs if commit_sha in (r.tags or [])]
    # Fall back to all recent runs if none tagged with commit
    runs_to_report = matching_runs if matching_runs else recent_runs[:20]

    config = _get_config(db)
    comment_posted = False

    if config and config.get("auto_comment_prs") and config.get("github_token") and runs_to_report:
        comment_body = _build_pr_comment(runs_to_report)
        owner = config["repo_owner"]
        repo = config["repo_name"]
        token = config["github_token"]
        try:
            import asyncio
            comment_posted = await _post_github_comment(token, owner, repo, pr_number, comment_body)
        except Exception:
            comment_posted = False

    return {
        "processed": True,
        "event": event_type,
        "action": action,
        "commit_sha": commit_sha,
        "pr_number": pr_number,
        "runs_found": len(runs_to_report),
        "comment_posted": comment_posted,
    }


@router.post("/comment-run/{run_id}")
async def comment_run(
    run_id: str,
    body: CommentRunBody,
    db: Session = Depends(get_db),
    identity: Optional[Identity] = Depends(get_identity),
):
    """Manually post a comment about a specific run to a PR."""
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    config = _get_config(db)
    if not config or not config.get("github_token"):
        raise HTTPException(status_code=400, detail="GitHub integration not configured")

    comment_body = _build_single_run_comment(run)
    owner = config["repo_owner"]
    repo = config["repo_name"]
    token = config["github_token"]

    posted = await _post_github_comment(token, owner, repo, body.pr_number, comment_body)
    if not posted:
        raise HTTPException(status_code=502, detail="Failed to post comment to GitHub")

    return {"comment_posted": True, "run_id": run_id, "pr_number": body.pr_number}


@router.get("/runs-by-commit/{commit_sha}")
def runs_by_commit(
    commit_sha: str,
    db: Session = Depends(get_db),
    identity: Optional[Identity] = Depends(get_identity),
):
    """Find Q-Lab runs associated with a commit SHA via tags."""
    q = select(Run).order_by(Run.created_at.desc()).limit(1000)
    runs = db.scalars(q).all()
    matching = [r for r in runs if commit_sha in (r.tags or [])]
    return {
        "commit_sha": commit_sha,
        "runs": [
            {
                "run_id": r.run_id,
                "circuit_name": r.circuit_name,
                "backend": r.backend,
                "status": r.status,
                "health_score": (r.results or {}).get("health_score"),
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "tags": r.tags or [],
            }
            for r in matching
        ],
        "count": len(matching),
    }


@router.post("/link-commit/{run_id}")
def link_commit(
    run_id: str,
    body: LinkCommitBody,
    db: Session = Depends(get_db),
    identity: Optional[Identity] = Depends(get_identity),
):
    """Manually link a run to a commit SHA by adding it to the run's tags."""
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    tags: list = list(run.tags or [])
    if body.commit_sha not in tags:
        tags.append(body.commit_sha)
        run.tags = tags
        db.commit()

    return {
        "run_id": run_id,
        "commit_sha": body.commit_sha,
        "tags": run.tags,
        "linked": True,
    }
