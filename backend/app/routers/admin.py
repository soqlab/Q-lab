from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select, delete, text
from sqlalchemy.orm import Session

from ..database import get_db, DATABASE_URL
from ..deps import Identity, require_role
from ..models import APIKey, AuditLog, Benchmark, Organization, Run, User, Webhook

VALID_ROLES = {"owner", "admin", "researcher", "viewer"}

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


@router.get("/audit-logs")
def list_audit_logs(
    action: Optional[str] = None,
    user_id: Optional[int] = None,
    resource_type: Optional[str] = None,
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    identity: Identity = Depends(require_role("owner", "admin")),
    db: Session = Depends(get_db),
):
    query = select(AuditLog).order_by(AuditLog.created_at.desc())
    if action:
        query = query.where(AuditLog.action == action)
    if user_id:
        query = query.where(AuditLog.user_id == user_id)
    if resource_type:
        query = query.where(AuditLog.resource_type == resource_type)

    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    logs = db.scalars(query.offset(offset).limit(limit)).all()

    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "items": [
            {
                "id": lg.id,
                "action": lg.action,
                "resource_type": lg.resource_type,
                "resource_id": lg.resource_id,
                "user_id": lg.user_id,
                "org_id": lg.org_id,
                "ip_address": lg.ip_address,
                "meta": lg.meta or {},
                "created_at": lg.created_at.isoformat(),
            }
            for lg in logs
        ],
    }


@router.delete("/audit-logs/purge")
def purge_old_audit_logs(
    days: int = Query(default=30, ge=1, le=365),
    identity: Identity = Depends(require_role("owner")),
    db: Session = Depends(get_db),
):
    """Delete audit logs older than `days` days. Owner only."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    result = db.execute(delete(AuditLog).where(AuditLog.created_at < cutoff))
    db.commit()
    return {"deleted": result.rowcount, "older_than_days": days}


@router.get("/stats")
def system_stats(
    identity: Identity = Depends(require_role("owner", "admin")),
    db: Session = Depends(get_db),
):
    run_count = db.scalar(select(func.count()).select_from(Run)) or 0
    user_count = db.scalar(select(func.count()).select_from(User)) or 0
    org_count = db.scalar(select(func.count()).select_from(Organization)) or 0
    webhook_count = db.scalar(select(func.count()).select_from(Webhook)) or 0
    benchmark_count = db.scalar(select(func.count()).select_from(Benchmark)) or 0
    audit_count = db.scalar(select(func.count()).select_from(AuditLog)) or 0

    completed = db.scalar(select(func.count()).select_from(Run).where(Run.status == "completed")) or 0
    failed = db.scalar(select(func.count()).select_from(Run).where(Run.status == "failed")) or 0

    return {
        "runs": {
            "total": run_count,
            "completed": completed,
            "failed": failed,
            "completion_rate": round(completed / run_count, 3) if run_count else 0,
            "failure_rate": round(failed / run_count, 3) if run_count else 0,
        },
        "users": user_count,
        "organizations": org_count,
        "webhooks": webhook_count,
        "benchmarks": benchmark_count,
        "audit_events": audit_count,
    }


@router.get("/users")
def list_users(
    identity: Identity = Depends(require_role("owner", "admin")),
    db: Session = Depends(get_db),
):
    users = db.scalars(select(User).order_by(User.created_at.desc())).all()
    user_run_counts = dict(
        db.execute(
            select(Run.created_by_user_id, func.count(Run.id))
            .group_by(Run.created_by_user_id)
        ).all()
    )
    return [
        {
            "id": u.id,
            "email": u.email,
            "name": u.name,
            "role": u.role,
            "is_active": u.is_active,
            "org_id": u.org_id,
            "created_at": u.created_at.isoformat() if u.created_at else None,
            "run_count": user_run_counts.get(u.id, 0),
            "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
            "login_count": u.login_count or 0,
        }
        for u in users
    ]


@router.get("/organizations")
def list_organizations(
    identity: Identity = Depends(require_role("owner")),
    db: Session = Depends(get_db),
):
    orgs = db.scalars(select(Organization).order_by(Organization.created_at.desc())).all()
    return [
        {
            "id": o.id,
            "slug": o.slug,
            "name": o.name,
            "plan": o.plan,
            "created_at": o.created_at.isoformat(),
        }
        for o in orgs
    ]


@router.get("/activity-feed")
def activity_feed(
    limit: int = Query(default=100, ge=1, le=500),
    action: Optional[str] = None,
    user_id: Optional[int] = None,
    identity: Identity = Depends(require_role("owner", "admin")),
    db: Session = Depends(get_db),
):
    """Live activity feed across all users, newest first with user email resolved."""
    query = select(AuditLog).order_by(AuditLog.created_at.desc())
    if action:
        query = query.where(AuditLog.action == action)
    if user_id:
        query = query.where(AuditLog.user_id == user_id)
    logs = db.scalars(query.limit(limit)).all()
    uids = {lg.user_id for lg in logs if lg.user_id}
    users_map = {u.id: u for u in db.scalars(select(User).where(User.id.in_(uids))).all()} if uids else {}
    return [
        {
            "id": lg.id,
            "action": lg.action,
            "resource_type": lg.resource_type,
            "resource_id": lg.resource_id,
            "user_id": lg.user_id,
            "user_email": users_map[lg.user_id].email if lg.user_id and lg.user_id in users_map else None,
            "ip_address": lg.ip_address,
            "user_agent": lg.user_agent,
            "meta": lg.meta or {},
            "created_at": lg.created_at.isoformat(),
        }
        for lg in logs
    ]


@router.get("/users/{user_id}/activity")
def user_activity(
    user_id: int,
    limit: int = Query(default=50, ge=1, le=200),
    identity: Identity = Depends(require_role("owner", "admin")),
    db: Session = Depends(get_db),
):
    user = db.scalar(select(User).where(User.id == user_id))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    run_count = db.scalar(select(func.count()).select_from(Run).where(Run.created_by_user_id == user_id)) or 0
    api_key_count = db.scalar(select(func.count()).select_from(APIKey).where(APIKey.user_id == user_id)) or 0
    logs = db.scalars(
        select(AuditLog).where(AuditLog.user_id == user_id)
        .order_by(AuditLog.created_at.desc()).limit(limit)
    ).all()
    return {
        "user_id": user_id,
        "email": user.email,
        "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
        "login_count": user.login_count or 0,
        "run_count": run_count,
        "api_key_count": api_key_count,
        "recent_actions": [
            {
                "action": lg.action,
                "resource_type": lg.resource_type,
                "resource_id": lg.resource_id,
                "ip_address": lg.ip_address,
                "user_agent": lg.user_agent,
                "meta": lg.meta or {},
                "created_at": lg.created_at.isoformat(),
            }
            for lg in logs
        ],
    }


@router.delete("/users/{user_id}")
def remove_user(
    user_id: int,
    identity: Identity = Depends(require_role("owner", "admin")),
    db: Session = Depends(get_db),
):
    user = db.scalar(select(User).where(User.id == user_id))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == identity.user_id:
        raise HTTPException(status_code=400, detail="You cannot remove your own account")
    if user.role == "owner" and identity.role != "owner":
        raise HTTPException(status_code=403, detail="Only owners can remove other owners")
    user.is_active = False
    db.commit()
    return {"message": f"User {user.email} has been deactivated"}


class RolePayload(BaseModel):
    role: str


@router.patch("/users/{user_id}/role")
def update_user_role(
    user_id: int,
    body: RolePayload,
    identity: Identity = Depends(require_role("owner", "admin")),
    db: Session = Depends(get_db),
):
    if body.role not in VALID_ROLES:
        raise HTTPException(status_code=422, detail=f"Invalid role. Must be one of: {', '.join(VALID_ROLES)}")
    user = db.scalar(select(User).where(User.id == user_id))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == identity.user_id:
        raise HTTPException(status_code=400, detail="You cannot change your own role")
    if body.role == "owner" and identity.role != "owner":
        raise HTTPException(status_code=403, detail="Only owners can grant owner role")
    if user.role == "owner" and identity.role != "owner":
        raise HTTPException(status_code=403, detail="Only owners can change an owner's role")
    user.role = body.role
    db.commit()
    return {"id": user.id, "email": user.email, "role": user.role}


@router.patch("/users/{user_id}/reactivate")
def reactivate_user(
    user_id: int,
    identity: Identity = Depends(require_role("owner", "admin")),
    db: Session = Depends(get_db),
):
    user = db.scalar(select(User).where(User.id == user_id))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role == "owner" and identity.role != "owner":
        raise HTTPException(status_code=403, detail="Only owners can reactivate an owner account")
    user.is_active = True
    db.commit()
    return {"message": f"User {user.email} has been reactivated"}


@router.get("/analytics")
def platform_analytics(
    days: int = Query(default=30, ge=1, le=365),
    identity: Identity = Depends(require_role("owner", "admin")),
    db: Session = Depends(get_db),
):
    """Aggregated platform analytics: action breakdown, daily active users, top users, top pages."""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    logs = db.scalars(select(AuditLog).where(AuditLog.created_at >= since)).all()

    # Action breakdown
    action_counts: Counter = Counter(lg.action for lg in logs)

    # Daily active users
    dau: defaultdict = defaultdict(set)
    daily_events: defaultdict = defaultdict(int)
    for lg in logs:
        day = lg.created_at.date().isoformat()
        if lg.user_id:
            dau[day].add(lg.user_id)
        daily_events[day] += 1

    # Top users by event count
    user_counts: Counter = Counter(lg.user_id for lg in logs if lg.user_id)
    top_user_ids = [uid for uid, _ in user_counts.most_common(10)]
    users_map = {u.id: u for u in db.scalars(select(User).where(User.id.in_(top_user_ids))).all()} if top_user_ids else {}
    top_users = [
        {"user_id": uid, "email": users_map[uid].email if uid in users_map else str(uid), "events": cnt}
        for uid, cnt in user_counts.most_common(10)
    ]

    # Top pages (from page.view events)
    page_logs = [lg for lg in logs if lg.action == "page.view" and lg.resource_id]
    page_counts: Counter = Counter(lg.resource_id for lg in page_logs)

    # Signup trend (daily new users)
    is_sqlite = DATABASE_URL.startswith("sqlite")
    date_fn = "strftime('%Y-%m-%d', created_at)" if is_sqlite else "TO_CHAR(created_at, 'YYYY-MM-DD')"
    signup_rows = db.execute(
        text(f"SELECT {date_fn} AS day, COUNT(*) FROM users WHERE created_at >= :since GROUP BY day ORDER BY day"),
        {"since": since},
    ).all()
    signup_trend = [{"day": row[0], "count": row[1]} for row in signup_rows]

    # Sort daily timeline
    all_days = sorted(set(list(dau.keys()) + list(daily_events.keys())))

    return {
        "period_days": days,
        "total_events": len(logs),
        "action_breakdown": [{"action": k, "count": v} for k, v in action_counts.most_common()],
        "daily_timeline": [
            {"day": d, "active_users": len(dau.get(d, set())), "events": daily_events.get(d, 0)}
            for d in all_days
        ],
        "top_users": top_users,
        "top_pages": [{"page": p, "views": c} for p, c in page_counts.most_common(15)],
        "signup_trend": signup_trend,
    }


def _parse_ua(ua: Optional[str]) -> dict:
    if not ua:
        return {"browser": "Unknown", "os": "Unknown", "device": "Desktop"}
    u = ua.lower()
    if "edg" in u:
        browser = "Edge"
    elif "opr" in u or "opera" in u:
        browser = "Opera"
    elif "chrome" in u:
        browser = "Chrome"
    elif "firefox" in u:
        browser = "Firefox"
    elif "safari" in u:
        browser = "Safari"
    else:
        browser = "Other"
    if "windows" in u:
        os_name = "Windows"
    elif "mac os" in u or "macos" in u:
        os_name = "macOS"
    elif "android" in u:
        os_name = "Android"
    elif "iphone" in u or "ipad" in u:
        os_name = "iOS"
    elif "linux" in u:
        os_name = "Linux"
    else:
        os_name = "Other"
    device = "Mobile" if any(x in u for x in ["mobile", "android", "iphone", "ipad"]) else "Desktop"
    return {"browser": browser, "os": os_name, "device": device}


@router.get("/traffic-stats")
def traffic_stats(
    days: int = Query(default=30, ge=1, le=365),
    identity: Identity = Depends(require_role("owner", "admin")),
    db: Session = Depends(get_db),
):
    """Traffic analytics: page views, hourly heatmap, browser/OS/device breakdown."""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    logs = db.scalars(
        select(AuditLog).where(AuditLog.action == "page.view").where(AuditLog.created_at >= since)
    ).all()

    heatmap: defaultdict = defaultdict(int)
    hourly: defaultdict = defaultdict(int)
    daily_views: defaultdict = defaultdict(int)
    unique_daily: defaultdict = defaultdict(set)
    browser_c: Counter = Counter()
    os_c: Counter = Counter()
    device_c: Counter = Counter()
    page_c: Counter = Counter()

    for lg in logs:
        dt = lg.created_at
        heatmap[f"{dt.weekday()}:{dt.hour}"] += 1
        hourly[dt.hour] += 1
        day = dt.date().isoformat()
        daily_views[day] += 1
        if lg.user_id:
            unique_daily[day].add(lg.user_id)
        ua = _parse_ua(lg.user_agent)
        browser_c[ua["browser"]] += 1
        os_c[ua["os"]] += 1
        device_c[ua["device"]] += 1
        if lg.resource_id:
            page_c[lg.resource_id] += 1

    heatmap_list = []
    for key, count in heatmap.items():
        dow, hr = key.split(":")
        heatmap_list.append({"day": int(dow), "hour": int(hr), "count": count})

    return {
        "period_days": days,
        "total_page_views": len(logs),
        "heatmap": heatmap_list,
        "hourly_breakdown": [{"hour": h, "views": hourly.get(h, 0)} for h in range(24)],
        "daily_views": [
            {"day": d, "views": daily_views[d], "unique_visitors": len(unique_daily.get(d, set()))}
            for d in sorted(daily_views.keys())
        ],
        "browsers": [{"browser": k, "count": v} for k, v in browser_c.most_common()],
        "os_breakdown": [{"os": k, "count": v} for k, v in os_c.most_common()],
        "devices": [{"device": k, "count": v} for k, v in device_c.most_common()],
        "top_pages": [{"page": k, "views": v} for k, v in page_c.most_common(20)],
    }


@router.get("/runs-stats")
def runs_stats(
    days: int = Query(default=30, ge=1, le=365),
    identity: Identity = Depends(require_role("owner", "admin")),
    db: Session = Depends(get_db),
):
    """Run analytics: backend distribution, status, daily trends, qubit distribution."""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    runs = db.scalars(select(Run).where(Run.created_at >= since)).all()

    backend_c: Counter = Counter()
    status_c: Counter = Counter()
    daily_c: defaultdict = defaultdict(int)
    qubit_b: defaultdict = defaultdict(int)
    project_c: Counter = Counter()
    depth_sum = 0
    depth_count = 0

    for r in runs:
        backend_c[r.backend or "unknown"] += 1
        status_c[r.status or "unknown"] += 1
        if r.created_at:
            daily_c[r.created_at.date().isoformat()] += 1
        fp = r.fingerprint or {}
        q = fp.get("num_qubits")
        if q is not None:
            if q <= 5:
                qubit_b["1-5"] += 1
            elif q <= 10:
                qubit_b["6-10"] += 1
            elif q <= 20:
                qubit_b["11-20"] += 1
            else:
                qubit_b["21+"] += 1
        d = fp.get("depth")
        if d is not None:
            depth_sum += d
            depth_count += 1
        if r.project_slug:
            project_c[r.project_slug] += 1

    all_days = sorted(daily_c.keys())
    total = len(runs)
    completed = status_c.get("completed", 0)
    failed = status_c.get("failed", 0)

    return {
        "period_days": days,
        "total_runs": total,
        "completion_rate": round(completed / total, 3) if total else 0,
        "failure_rate": round(failed / total, 3) if total else 0,
        "avg_circuit_depth": round(depth_sum / depth_count, 1) if depth_count else None,
        "backends": [{"backend": k, "count": v} for k, v in backend_c.most_common()],
        "statuses": [{"status": k, "count": v} for k, v in status_c.most_common()],
        "daily_runs": [{"day": d, "count": daily_c[d]} for d in all_days],
        "qubit_distribution": [{"bucket": k, "count": qubit_b[k]} for k in ["1-5", "6-10", "11-20", "21+"] if qubit_b[k]],
        "top_projects": [{"project": k, "runs": v} for k, v in project_c.most_common(10)],
    }


@router.get("/ai-stats")
def ai_stats(
    days: int = Query(default=30, ge=1, le=365),
    identity: Identity = Depends(require_role("owner", "admin")),
    db: Session = Depends(get_db),
):
    """AI feature usage: insights generated, assistant queries, cost oracle."""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    AI_ACTIONS = ["insight.generated", "assistant.queried", "cost_oracle.queried"]
    logs = db.scalars(
        select(AuditLog)
        .where(AuditLog.action.in_(AI_ACTIONS))
        .where(AuditLog.created_at >= since)
    ).all()

    type_c: Counter = Counter(lg.action for lg in logs)
    hourly: defaultdict = defaultdict(int)
    daily: defaultdict = defaultdict(int)
    user_c: Counter = Counter(lg.user_id for lg in logs if lg.user_id)

    for lg in logs:
        hourly[lg.created_at.hour] += 1
        daily[lg.created_at.date().isoformat()] += 1

    top_uids = [uid for uid, _ in user_c.most_common(10)]
    users_map = {u.id: u for u in db.scalars(select(User).where(User.id.in_(top_uids))).all()} if top_uids else {}

    return {
        "period_days": days,
        "total_ai_requests": len(logs),
        "by_type": [{"action": k, "count": v} for k, v in type_c.most_common()],
        "hourly_usage": [{"hour": h, "count": hourly.get(h, 0)} for h in range(24)],
        "daily_usage": [{"day": d, "count": daily[d]} for d in sorted(daily.keys())],
        "top_users": [
            {"user_id": uid, "email": users_map[uid].email if uid in users_map else str(uid), "requests": cnt}
            for uid, cnt in user_c.most_common(10)
        ],
    }


@router.get("/sessions-stats")
def sessions_stats(
    days: int = Query(default=30, ge=1, le=365),
    identity: Identity = Depends(require_role("owner", "admin")),
    db: Session = Depends(get_db),
):
    """Session analysis: group page.view events into user sessions."""
    SESSION_GAP = 1800  # 30 min gap = new session
    since = datetime.now(timezone.utc) - timedelta(days=days)
    page_logs = db.scalars(
        select(AuditLog)
        .where(AuditLog.action == "page.view")
        .where(AuditLog.created_at >= since)
        .order_by(AuditLog.created_at)
    ).all()

    user_events: defaultdict = defaultdict(list)
    for lg in page_logs:
        uid = str(lg.user_id) if lg.user_id else f"anon_{lg.ip_address or 'x'}"
        user_events[uid].append(lg.created_at)

    total_sessions = 0
    bounce_sessions = 0
    total_duration = 0.0
    total_pages = 0
    daily_sessions: defaultdict = defaultdict(int)

    for uid, times in user_events.items():
        times.sort()
        start = times[0]
        pages = 1
        prev = times[0]
        daily_sessions[start.date().isoformat()] += 1

        for t in times[1:]:
            gap = (t - prev).total_seconds()
            if gap > SESSION_GAP:
                duration = (prev - start).total_seconds()
                total_sessions += 1
                total_duration += duration
                total_pages += pages
                if pages == 1:
                    bounce_sessions += 1
                start = t
                pages = 1
                daily_sessions[t.date().isoformat()] += 1
            else:
                pages += 1
            prev = t

        duration = (prev - start).total_seconds()
        total_sessions += 1
        total_duration += duration
        total_pages += pages
        if pages == 1:
            bounce_sessions += 1

    avg_duration = total_duration / total_sessions if total_sessions else 0
    avg_pages = total_pages / total_sessions if total_sessions else 0
    bounce_rate = bounce_sessions / total_sessions if total_sessions else 0

    return {
        "period_days": days,
        "total_sessions": total_sessions,
        "avg_session_duration_seconds": round(avg_duration),
        "avg_pages_per_session": round(avg_pages, 1),
        "bounce_rate": round(bounce_rate * 100, 1),
        "bounce_sessions": bounce_sessions,
        "daily_sessions": [{"day": d, "sessions": daily_sessions[d]} for d in sorted(daily_sessions.keys())],
    }


@router.get("/security-stats")
def security_stats(
    days: int = Query(default=30, ge=1, le=365),
    identity: Identity = Depends(require_role("owner")),
    db: Session = Depends(get_db),
):
    """Security overview: login patterns, multi-IP users, suspicious IPs."""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    logs = db.scalars(select(AuditLog).where(AuditLog.created_at >= since)).all()

    login_logs = [lg for lg in logs if lg.action == "auth.login"]
    reg_logs = [lg for lg in logs if lg.action == "auth.register"]

    ip_users: defaultdict = defaultdict(set)
    ip_action_c: Counter = Counter()
    user_ips: defaultdict = defaultdict(set)

    for lg in logs:
        if lg.ip_address:
            if lg.user_id:
                ip_users[lg.ip_address].add(lg.user_id)
            ip_action_c[lg.ip_address] += 1
        if lg.action == "auth.login" and lg.user_id and lg.ip_address:
            user_ips[lg.user_id].add(lg.ip_address)

    suspicious_ips = sorted(
        [{"ip": ip, "users": len(us), "actions": ip_action_c[ip]} for ip, us in ip_users.items() if len(us) > 1],
        key=lambda x: x["users"], reverse=True
    )[:15]

    multi_ip = [(uid, ips) for uid, ips in user_ips.items() if len(ips) > 2]
    uid_set = {uid for uid, _ in multi_ip}
    users_map = {u.id: u for u in db.scalars(select(User).where(User.id.in_(uid_set))).all()} if uid_set else {}

    return {
        "period_days": days,
        "total_logins": len(login_logs),
        "new_registrations": len(reg_logs),
        "unique_ips": len(ip_users),
        "suspicious_ips": suspicious_ips,
        "users_multiple_ips": sorted(
            [{"user_id": uid, "email": users_map[uid].email if uid in users_map else str(uid), "ip_count": len(ips)}
             for uid, ips in multi_ip],
            key=lambda x: x["ip_count"], reverse=True
        )[:10],
        "top_login_ips": [
            {"ip": ip, "count": cnt}
            for ip, cnt in Counter(lg.ip_address for lg in login_logs if lg.ip_address).most_common(15)
        ],
        "recent_registrations": [
            {"created_at": lg.created_at.isoformat(), "ip_address": lg.ip_address, "user_agent": (lg.user_agent or "")[:80]}
            for lg in sorted(reg_logs, key=lambda x: x.created_at, reverse=True)[:20]
        ],
    }


@router.delete("/users/{user_id}/purge")
def purge_user(
    user_id: int,
    identity: Identity = Depends(require_role("owner")),
    db: Session = Depends(get_db),
):
    """Permanently delete a user and all their data. Owner only."""
    user = db.scalar(select(User).where(User.id == user_id))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == identity.user_id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    email = user.email
    # Unlink runs (preserve history but remove attribution)
    db.execute(
        Run.__table__.update()
        .where(Run.created_by_user_id == user_id)
        .values(created_by_user_id=None)
    )
    # Delete API keys
    db.execute(APIKey.__table__.delete().where(APIKey.user_id == user_id))
    db.delete(user)
    db.commit()
    return {"message": f"User {email} has been permanently deleted"}
