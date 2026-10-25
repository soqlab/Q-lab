"""Who may see which runs.

A signed-in user sees the runs they uploaded and the runs of their organisation. A request
without credentials sees only runs uploaded without an account, so a self-hosted install
in open mode (no logins) keeps working, while on a multi-user server it sees nothing.

The rule is applied to every ORM query on Run made while serving a request, through
SQLAlchemy's do_orm_execute event, so routers do not each have to remember it. Code that
runs outside a request (startup, schedulers) is not scoped. A few routes that deliberately
publish data (admin, share links, public badges and gallery) are exempt by path.
"""
from __future__ import annotations

from contextvars import ContextVar
from typing import Any, Optional

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy import and_, event, or_
from sqlalchemy.orm import Session, with_loader_criteria

from .database import get_db
from .models import Run

# Paths that intentionally show runs beyond the caller's own.
UNSCOPED_PREFIXES = (
    "/api/v1/admin",
    "/api/v1/runs/public/",
    "/api/v1/public/",
    "/api/v1/badge/",
)

_UNSCOPED = object()
_ANONYMOUS = object()
_scope: ContextVar[Any] = ContextVar("qlab_run_scope", default=_UNSCOPED)


def scope_of(user_id: Optional[int], org_id: Optional[int]) -> Any:
    """The visibility scope of a caller: anonymous when there is no signed-in user."""
    return _ANONYMOUS if user_id is None else (user_id, org_id)


def _owner(identity: Any) -> Any:
    if identity is None:
        return _ANONYMOUS
    return scope_of(identity.user_id, identity.org_id)


def visible(owner_user_id: Optional[int], owner_org_id: Optional[int], scope: Any) -> bool:
    """The same rule as the query filter, for data that is not a query (the live run stream)."""
    if scope is _UNSCOPED:
        return True
    if scope is _ANONYMOUS:
        return owner_user_id is None and owner_org_id is None
    user_id, org_id = scope
    return owner_user_id == user_id or (org_id is not None and owner_org_id == org_id)


async def scope_runs_to_caller(
    request: Request,
    authorization: Optional[str] = Header(default=None),
    x_qlab_api_key: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> None:
    """App-wide dependency: records who is asking, for the Run query filter below.

    Async on purpose: it runs in the request's own context, so the value it sets is seen by
    the endpoint (sync endpoints run in a thread with a copy of that context).
    """
    path = request.url.path
    # README badges for a single run (/api/v1/runs/<id>/badge.svg) are public by design.
    if path.startswith(UNSCOPED_PREFIXES) or path.endswith("/badge.svg"):
        _scope.set(_UNSCOPED)
        return
    from .deps import get_identity
    try:
        identity = get_identity(authorization=authorization, x_qlab_api_key=x_qlab_api_key, db=db)
    except HTTPException:
        identity = None  # the endpoint's own auth check reports bad credentials
    _scope.set(_owner(identity))


def current_scope() -> Any:
    return _scope.get()


def sql_visibility(alias: str = "runs") -> tuple[str, dict[str, Any]]:
    """The same rule as a SQL condition, for hand-written queries that bypass the ORM filter.

    Returns (condition, params): use it as `WHERE <condition>` and pass the params along.
    """
    scope = _scope.get()
    if scope is _UNSCOPED:
        return "1=1", {}
    if scope is _ANONYMOUS:
        return f"({alias}.created_by_user_id IS NULL AND {alias}.org_id IS NULL)", {}
    user_id, org_id = scope
    if org_id is None:
        return f"({alias}.created_by_user_id = :scope_user_id)", {"scope_user_id": user_id}
    return (f"({alias}.created_by_user_id = :scope_user_id OR {alias}.org_id = :scope_org_id)",
            {"scope_user_id": user_id, "scope_org_id": org_id})


@event.listens_for(Session, "do_orm_execute")
def _limit_runs_to_caller(state) -> None:
    scope = _scope.get()
    if scope is _UNSCOPED or not state.is_select or state.is_column_load or state.is_relationship_load:
        return
    if scope is _ANONYMOUS:
        criteria = and_(Run.created_by_user_id.is_(None), Run.org_id.is_(None))
    else:
        user_id, org_id = scope
        criteria = or_(Run.created_by_user_id == user_id, Run.org_id == org_id) if org_id is not None \
            else (Run.created_by_user_id == user_id)
    state.statement = state.statement.options(with_loader_criteria(Run, criteria, include_aliases=True))


__all__ = ["scope_runs_to_caller", "visible", "current_scope", "scope_of", "sql_visibility", "UNSCOPED_PREFIXES"]
