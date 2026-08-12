"""Billing and usage metering for Q-Lab.

Feature flag: QLAB_BILLING_ENABLED
  - absent / "0" / "false" / "no"  → usage tracked silently, limits NOT enforced
  - "1" / "true" / "yes"           → limits enforced, 429 returned when exceeded

Stripe integration is simulated when STRIPE_SECRET_KEY is absent — plan changes
are simply persisted in GenericRecord without hitting Stripe's API.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import Identity, get_identity, log_audit, require_auth
from ..store import store_delete, store_get, store_list, store_put  # noqa: F401

router = APIRouter(prefix="/api/v1/billing", tags=["billing"])

# ---------------------------------------------------------------------------
# Plan catalogue
# ---------------------------------------------------------------------------

PLANS: dict[str, dict[str, Any]] = {
    "free": {
        "name": "Free",
        "runs": 100,
        "api_calls": 5_000,
        "qpu_seconds": 3_600,
        "ai_insights": 10,
        "price_usd": 0,
        "features": [
            "100 experiment runs / month",
            "5,000 API calls / month",
            "1 hour QPU time / month",
            "10 AI insights / month",
            "Community support",
        ],
    },
    "pro": {
        "name": "Pro",
        "runs": 2_000,
        "api_calls": 50_000,
        "qpu_seconds": 36_000,
        "ai_insights": 200,
        "price_usd": 49,
        "features": [
            "2,000 experiment runs / month",
            "50,000 API calls / month",
            "10 hours QPU time / month",
            "200 AI insights / month",
            "Priority support",
            "Advanced analytics",
            "Team collaboration",
        ],
    },
    "enterprise": {
        "name": "Enterprise",
        "runs": -1,
        "api_calls": -1,
        "qpu_seconds": -1,
        "ai_insights": -1,
        "price_usd": 299,
        "features": [
            "Unlimited experiment runs",
            "Unlimited API calls",
            "Unlimited QPU time",
            "Unlimited AI insights",
            "Dedicated support",
            "SSO & RBAC",
            "Custom integrations",
            "SLA guarantee",
        ],
    },
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_NS_USAGE = "billing_usage"
_NS_SUBSCRIPTION = "billing_subscription"
_NS_INVOICES = "billing_invoices"


def _billing_enabled() -> bool:
    return os.getenv("QLAB_BILLING_ENABLED", "").lower() in ("1", "true", "yes")


def _stripe_configured() -> bool:
    return bool(os.getenv("STRIPE_SECRET_KEY", "").strip())


def _current_month() -> str:
    """Return ISO month key like '2026-06'."""
    return datetime.now(timezone.utc).strftime("%Y-%m")


def _usage_key(user_id: int | str, month: str) -> str:
    return f"u{user_id}:{month}"


def _sub_key(user_id: int | str) -> str:
    return f"u{user_id}"


def _default_usage(user_id: int | str, month: str) -> dict[str, Any]:
    return {
        "user_id": str(user_id),
        "month": month,
        "runs_this_month": 0,
        "api_calls_this_month": 0,
        "qpu_seconds_this_month": 0.0,
        "storage_mb": 0.0,
        "ai_insights_this_month": 0,
    }


def _default_subscription(user_id: int | str) -> dict[str, Any]:
    return {
        "user_id": str(user_id),
        "plan": "free",
        "status": "active",
        "stripe_customer_id": None,
        "stripe_subscription_id": None,
        "current_period_start": None,
        "current_period_end": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def _get_or_create_subscription(db: Session, user_id: int | str) -> dict[str, Any]:
    key = _sub_key(user_id)
    row = store_get(db, _NS_SUBSCRIPTION, key)
    if row is None:
        row = _default_subscription(user_id)
        store_put(db, _NS_SUBSCRIPTION, key, row)
    return row


def _get_or_create_usage(db: Session, user_id: int | str, month: str | None = None) -> dict[str, Any]:
    month = month or _current_month()
    key = _usage_key(user_id, month)
    row = store_get(db, _NS_USAGE, key)
    if row is None:
        row = _default_usage(user_id, month)
        store_put(db, _NS_USAGE, key, row)
    return row


def _plan_limits(plan_name: str) -> dict[str, Any]:
    return PLANS.get(plan_name, PLANS["free"])


def _pct(used: float | int, limit: int) -> float:
    """Return fraction used; -1 limit means 0 (unlimited)."""
    if limit == -1:
        return 0.0
    if limit == 0:
        return 1.0
    return min(round(used / limit, 4), 1.0)


def _check_limit(metric: str, used: float | int, limit: int) -> None:
    """Raise 429 if over limit and billing is enabled."""
    if not _billing_enabled():
        return
    if limit == -1:
        return
    if used >= limit:
        raise HTTPException(
            status_code=429,
            detail=f"Plan limit reached for {metric}: {used}/{limit}. Upgrade your plan to continue.",
        )


# ---------------------------------------------------------------------------
# Public usage-tracking helpers (call from other routers)
# ---------------------------------------------------------------------------

def track_run(db: Session, user_id: int | str) -> None:
    """Increment runs_this_month for a user. Call silently from run submission."""
    month = _current_month()
    row = _get_or_create_usage(db, user_id, month)
    sub = _get_or_create_subscription(db, user_id)
    limits = _plan_limits(sub["plan"])
    _check_limit("runs_this_month", row["runs_this_month"], limits["runs"])
    row["runs_this_month"] = row.get("runs_this_month", 0) + 1
    store_put(db, _NS_USAGE, _usage_key(user_id, month), row)


def track_api_call(db: Session, user_id: int | str) -> None:
    """Increment api_calls_this_month. Call from middleware or per-endpoint."""
    month = _current_month()
    row = _get_or_create_usage(db, user_id, month)
    sub = _get_or_create_subscription(db, user_id)
    limits = _plan_limits(sub["plan"])
    _check_limit("api_calls_this_month", row["api_calls_this_month"], limits["api_calls"])
    row["api_calls_this_month"] = row.get("api_calls_this_month", 0) + 1
    store_put(db, _NS_USAGE, _usage_key(user_id, month), row)


def track_qpu_seconds(db: Session, user_id: int | str, seconds: float) -> None:
    """Accumulate QPU seconds. Call after job completion."""
    month = _current_month()
    row = _get_or_create_usage(db, user_id, month)
    sub = _get_or_create_subscription(db, user_id)
    limits = _plan_limits(sub["plan"])
    current = row.get("qpu_seconds_this_month", 0.0)
    _check_limit("qpu_seconds_this_month", current, limits["qpu_seconds"])
    row["qpu_seconds_this_month"] = round(current + seconds, 2)
    store_put(db, _NS_USAGE, _usage_key(user_id, month), row)


def track_ai_insight(db: Session, user_id: int | str) -> None:
    """Increment ai_insights_this_month. Call when generating Claude analysis."""
    month = _current_month()
    row = _get_or_create_usage(db, user_id, month)
    sub = _get_or_create_subscription(db, user_id)
    limits = _plan_limits(sub["plan"])
    _check_limit("ai_insights_this_month", row["ai_insights_this_month"], limits["ai_insights"])
    row["ai_insights_this_month"] = row.get("ai_insights_this_month", 0) + 1
    store_put(db, _NS_USAGE, _usage_key(user_id, month), row)


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class SubscriptionUpdate(BaseModel):
    plan: str = Field(..., pattern="^(free|pro|enterprise)$")


class CheckoutRequest(BaseModel):
    plan: str = Field(..., pattern="^(pro|enterprise)$")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/usage")
def get_usage(
    request: Request,
    identity: Identity = Depends(require_auth),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Current-month usage stats for the authenticated user."""
    import logging, traceback
    uid = identity.user_id or 0
    month = _current_month()
    billing_on = _billing_enabled()

    def _zero_meter(lim: int) -> dict[str, Any]:
        return {"used": 0, "limit": lim, "unlimited": lim == -1, "pct": 0.0}

    try:
        try:
            db.rollback()
        except Exception:
            pass

        usage = _get_or_create_usage(db, uid, month)
        sub = _get_or_create_subscription(db, uid)
        limits = _plan_limits(sub["plan"])
        plan = sub["plan"]

        def meter(key: str, limit_key: str) -> dict[str, Any]:
            used = usage.get(key, 0)
            lim = limits[limit_key]
            return {"used": used, "limit": lim, "unlimited": lim == -1, "pct": _pct(used, lim)}

        log_audit(db, "billing.viewed", "billing", None, identity=identity, request=request, meta={"plan": plan})
        return {
            "billing_enabled": billing_on,
            "stripe_configured": _stripe_configured(),
            "month": month,
            "plan": plan,
            "runs": meter("runs_this_month", "runs"),
            "api_calls": meter("api_calls_this_month", "api_calls"),
            "qpu_seconds": meter("qpu_seconds_this_month", "qpu_seconds"),
            "storage_mb": {"used": usage.get("storage_mb", 0.0), "limit": -1, "unlimited": True, "pct": 0.0},
            "ai_insights": meter("ai_insights_this_month", "ai_insights"),
        }

    except Exception as exc:
        logging.getLogger("billing").error("get_usage failed for uid=%s: %s\n%s", uid, exc, traceback.format_exc())
        free = PLANS["free"]
        return {
            "billing_enabled": billing_on,
            "stripe_configured": _stripe_configured(),
            "month": month,
            "plan": "free",
            "runs": _zero_meter(free["runs"]),
            "api_calls": _zero_meter(free["api_calls"]),
            "qpu_seconds": _zero_meter(free["qpu_seconds"]),
            "storage_mb": {"used": 0.0, "limit": -1, "unlimited": True, "pct": 0.0},
            "ai_insights": _zero_meter(free["ai_insights"]),
        }


@router.get("/plans")
def list_plans() -> dict[str, Any]:
    """List all available plans with their limits and pricing."""
    billing_on = _billing_enabled()
    stripe_on = _stripe_configured()
    plans_out = {}
    for slug, info in PLANS.items():
        plans_out[slug] = {
            "slug": slug,
            **info,
        }
    return {
        "billing_enabled": billing_on,
        "stripe_configured": stripe_on,
        "plans": plans_out,
    }


@router.get("/subscription")
def get_subscription(
    identity: Identity = Depends(require_auth),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Return the authenticated user's current subscription."""
    uid = identity.user_id or 0
    sub = _get_or_create_subscription(db, uid)
    plan_info = PLANS.get(sub["plan"], PLANS["free"])
    return {
        "billing_enabled": _billing_enabled(),
        "stripe_configured": _stripe_configured(),
        "subscription": sub,
        "plan_details": plan_info,
    }


@router.post("/subscription")
def update_subscription(
    body: SubscriptionUpdate,
    identity: Identity = Depends(require_auth),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Update subscription plan.

    When STRIPE_SECRET_KEY is present this would trigger a real checkout session.
    Without it the plan is simulated (stored directly in GenericRecord).
    """
    uid = identity.user_id or 0
    sub = _get_or_create_subscription(db, uid)
    old_plan = sub["plan"]
    now_iso = datetime.now(timezone.utc).isoformat()

    simulated = not _stripe_configured()
    if simulated:
        # Simulate: just persist the new plan
        sub["plan"] = body.plan
        sub["status"] = "active"
        sub["updated_at"] = now_iso
        sub["simulated"] = True
        store_put(db, _NS_SUBSCRIPTION, _sub_key(uid), sub)

        # Archive current month usage as an invoice record
        month = _current_month()
        usage = _get_or_create_usage(db, uid, month)
        plan_info = PLANS.get(old_plan, PLANS["free"])
        invoice_key = f"u{uid}:{month}:plan_change"
        store_put(db, _NS_INVOICES, invoice_key, {
            "user_id": str(uid),
            "month": month,
            "event": "plan_change",
            "old_plan": old_plan,
            "new_plan": body.plan,
            "usage_snapshot": usage,
            "amount_usd": plan_info["price_usd"],
            "paid": False,
            "simulated": True,
            "created_at": now_iso,
        })

        return {
            "billing_enabled": _billing_enabled(),
            "stripe_configured": False,
            "simulated": True,
            "message": f"Plan updated to {body.plan} (simulation — no charge).",
            "subscription": sub,
        }

    # --- Real Stripe path (skeleton) ---
    # When STRIPE_SECRET_KEY is available you would:
    #   1. Create/retrieve Stripe customer
    #   2. Create checkout session or subscription update
    #   3. Return session URL for redirect
    # For now raise a not-implemented error so callers know to add Stripe SDK.
    raise HTTPException(
        status_code=501,
        detail="Stripe integration skeleton: add stripe-python and implement checkout session creation.",
    )


@router.get("/invoices")
def list_invoices(
    identity: Identity = Depends(require_auth),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """List past monthly usage snapshots treated as invoices."""
    uid = identity.user_id or 0
    billing_on = _billing_enabled()

    # Collect all usage rows for this user across all months
    all_usage = store_list(db, _NS_USAGE)
    user_usage = [u for u in all_usage if u.get("user_id") == str(uid)]

    # Collect plan-change invoice events
    all_invoices = store_list(db, _NS_INVOICES)
    user_events = [i for i in all_invoices if i.get("user_id") == str(uid)]
    events_by_month: dict[str, dict[str, Any]] = {}
    for ev in user_events:
        events_by_month[ev["month"]] = ev

    sub = _get_or_create_subscription(db, uid)

    invoices = []
    for usage in sorted(user_usage, key=lambda u: u.get("month", ""), reverse=True):
        month = usage.get("month", "")
        event = events_by_month.get(month, {})
        plan = event.get("old_plan", sub["plan"])
        plan_info = PLANS.get(plan, PLANS["free"])
        # Show $0.00 cost when billing not enabled
        amount = plan_info["price_usd"] if billing_on else 0
        invoices.append({
            "month": month,
            "plan": plan,
            "runs": usage.get("runs_this_month", 0),
            "api_calls": usage.get("api_calls_this_month", 0),
            "qpu_seconds": usage.get("qpu_seconds_this_month", 0.0),
            "ai_insights": usage.get("ai_insights_this_month", 0),
            "storage_mb": usage.get("storage_mb", 0.0),
            "amount_usd": amount,
            "status": "paid" if billing_on else "tracking_only",
            "simulated": not _stripe_configured(),
        })

    return {
        "billing_enabled": billing_on,
        "stripe_configured": _stripe_configured(),
        "invoices": invoices,
    }


@router.post("/checkout")
def create_checkout_session(
    body: CheckoutRequest,
    identity: Identity = Depends(require_auth),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Create a Stripe Checkout Session and return the hosted payment URL."""
    if not _stripe_configured():
        raise HTTPException(status_code=503, detail="Stripe is not configured. Set STRIPE_SECRET_KEY.")

    try:
        import stripe as stripe_lib  # type: ignore[import]
    except ImportError:
        raise HTTPException(status_code=503, detail="stripe package not installed.")

    stripe_lib.api_key = os.getenv("STRIPE_SECRET_KEY")
    uid = identity.user_id or 0

    # Map plan → Stripe Price ID (set these in Render env vars)
    price_ids: dict[str, str] = {
        "pro": os.getenv("STRIPE_PRO_PRICE_ID", ""),
        "enterprise": os.getenv("STRIPE_ENTERPRISE_PRICE_ID", ""),
    }
    price_id = price_ids.get(body.plan, "")
    if not price_id:
        raise HTTPException(
            status_code=400,
            detail=f"No Stripe price configured for '{body.plan}'. Set STRIPE_PRO_PRICE_ID env var.",
        )

    # Get or create Stripe Customer so payment methods are remembered
    sub = _get_or_create_subscription(db, uid)
    customer_id: str | None = sub.get("stripe_customer_id")
    if not customer_id:
        email = identity.user.email if identity.user else None
        customer = stripe_lib.Customer.create(
            email=email,
            metadata={"qlab_user_id": str(uid)},
        )
        customer_id = customer.id
        sub["stripe_customer_id"] = customer_id
        store_put(db, _NS_SUBSCRIPTION, _sub_key(uid), sub)

    app_url = os.getenv("QLAB_APP_URL", "http://localhost:3000")
    session = stripe_lib.checkout.Session.create(
        customer=customer_id,
        payment_method_types=["card"],
        line_items=[{"price": price_id, "quantity": 1}],
        mode="subscription",
        success_url=f"{app_url}/billing?success=true&session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{app_url}/billing?canceled=true",
        metadata={"qlab_user_id": str(uid), "plan": body.plan},
    )
    return {"checkout_url": session.url}


@router.get("/portal")
def create_portal_session(
    identity: Identity = Depends(require_auth),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Create a Stripe Customer Portal session so users can manage/cancel their subscription."""
    if not _stripe_configured():
        raise HTTPException(status_code=503, detail="Stripe is not configured.")

    try:
        import stripe as stripe_lib  # type: ignore[import]
    except ImportError:
        raise HTTPException(status_code=503, detail="stripe package not installed.")

    stripe_lib.api_key = os.getenv("STRIPE_SECRET_KEY")
    uid = identity.user_id or 0
    sub = _get_or_create_subscription(db, uid)
    customer_id: str | None = sub.get("stripe_customer_id")

    if not customer_id:
        raise HTTPException(status_code=400, detail="No Stripe customer found. Upgrade first to create a subscription.")

    app_url = os.getenv("QLAB_APP_URL", "http://localhost:3000")
    portal = stripe_lib.billing_portal.Session.create(
        customer=customer_id,
        return_url=f"{app_url}/billing",
    )
    return {"portal_url": portal.url}


@router.post("/stripe/webhook")
async def stripe_webhook(
    request: Request,
    stripe_signature: Optional[str] = Header(default=None, alias="stripe-signature"),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Handle Stripe webhook events.

    Verifies the signature when STRIPE_WEBHOOK_SECRET is configured.
    """
    payload = await request.body()
    secret = os.getenv("STRIPE_WEBHOOK_SECRET", "").strip()

    if secret and stripe_signature:
        # Stripe signature format: t=<ts>,v1=<sig>[,v1=<sig2>]
        try:
            parts = dict(item.split("=", 1) for item in stripe_signature.split(",") if "=" in item)
            ts = parts.get("t", "")
            sig = parts.get("v1", "")
            signed_payload = f"{ts}.{payload.decode('utf-8')}"
            mac = hmac.new(  # type: ignore[attr-defined]
                secret.encode("utf-8"),
                signed_payload.encode("utf-8"),
                hashlib.sha256,
            )
            expected = mac.hexdigest()
            if not hmac.compare_digest(expected, sig):
                raise HTTPException(status_code=400, detail="Invalid Stripe webhook signature")
            # Reject events older than 5 minutes
            if abs(int(time.time()) - int(ts)) > 300:
                raise HTTPException(status_code=400, detail="Webhook timestamp too old")
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Signature verification failed: {exc}") from exc
    elif secret and not stripe_signature:
        raise HTTPException(status_code=400, detail="Missing Stripe-Signature header")

    try:
        event = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON payload") from exc

    event_type = event.get("type", "")
    event_data = event.get("data", {}).get("object", {})

    # Handle common subscription events
    if event_type == "checkout.session.completed":
        # Payment succeeded — activate the subscription immediately
        customer_id = event_data.get("customer")
        metadata = event_data.get("metadata", {})
        plan = metadata.get("plan", "pro")
        uid = metadata.get("qlab_user_id")
        if uid:
            sub = _get_or_create_subscription(db, uid)
            sub["plan"] = plan
            sub["status"] = "active"
            sub["stripe_customer_id"] = customer_id
            sub["stripe_subscription_id"] = event_data.get("subscription")
            sub["updated_at"] = datetime.now(timezone.utc).isoformat()
            store_put(db, _NS_SUBSCRIPTION, _sub_key(uid), sub)

    elif event_type == "customer.subscription.updated":
        customer_id = event_data.get("customer")
        status = event_data.get("status", "active")
        plan_id = ""
        items = event_data.get("items", {}).get("data", [])
        if items:
            plan_id = items[0].get("price", {}).get("nickname", "pro").lower()
            if plan_id not in PLANS:
                plan_id = "pro"

        # Look for a subscription record with this customer id
        all_subs = store_list(db, _NS_SUBSCRIPTION)
        for sub in all_subs:
            if sub.get("stripe_customer_id") == customer_id:
                sub["plan"] = plan_id or sub["plan"]
                sub["status"] = status
                sub["updated_at"] = datetime.now(timezone.utc).isoformat()
                store_put(db, _NS_SUBSCRIPTION, _sub_key(sub["user_id"]), sub)
                break

    elif event_type == "customer.subscription.deleted":
        customer_id = event_data.get("customer")
        all_subs = store_list(db, _NS_SUBSCRIPTION)
        for sub in all_subs:
            if sub.get("stripe_customer_id") == customer_id:
                sub["plan"] = "free"
                sub["status"] = "canceled"
                sub["updated_at"] = datetime.now(timezone.utc).isoformat()
                store_put(db, _NS_SUBSCRIPTION, _sub_key(sub["user_id"]), sub)
                break

    elif event_type == "invoice.payment_succeeded":
        customer_id = event_data.get("customer")
        amount_paid = event_data.get("amount_paid", 0) / 100.0  # cents → dollars
        month = datetime.now(timezone.utc).strftime("%Y-%m")
        all_subs = store_list(db, _NS_SUBSCRIPTION)
        for sub in all_subs:
            if sub.get("stripe_customer_id") == customer_id:
                uid = sub["user_id"]
                invoice_key = f"u{uid}:{month}:payment"
                store_put(db, _NS_INVOICES, invoice_key, {
                    "user_id": str(uid),
                    "month": month,
                    "event": "payment_succeeded",
                    "amount_usd": amount_paid,
                    "stripe_invoice_id": event_data.get("id"),
                    "paid": True,
                    "simulated": False,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })
                break

    return {"received": True, "type": event_type}
