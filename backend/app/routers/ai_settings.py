"""User AI provider preference — GET/PUT /api/v1/settings/ai-provider."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..ai_provider import KNOWN_PROVIDERS, AI_PROVIDER_NAMES
from ..database import get_db
from ..deps import Identity, require_auth
from ..store import store_get, store_put

router = APIRouter(prefix="/api/v1/settings", tags=["settings"])


class AIProviderPref(BaseModel):
    provider: str


@router.get("/ai-provider")
def get_ai_provider(
    db: Session = Depends(get_db),
    identity: Identity = Depends(require_auth),
):
    pref = store_get(db, "user_ai_pref", str(identity.user_id))
    providers_meta = [
        {"provider": k, "label": v["label"], "models": v["models"]}
        for k, v in KNOWN_PROVIDERS.items()
    ]
    return {
        "preferred_provider": pref.get("provider") if pref else None,
        "available_providers": providers_meta,
    }


@router.put("/ai-provider")
def set_ai_provider(
    req: AIProviderPref,
    db: Session = Depends(get_db),
    identity: Identity = Depends(require_auth),
):
    if req.provider not in AI_PROVIDER_NAMES:
        raise HTTPException(422, f"Unknown AI provider '{req.provider}'. "
                            f"Supported: {', '.join(sorted(AI_PROVIDER_NAMES))}")
    store_put(db, "user_ai_pref", str(identity.user_id), {"provider": req.provider})
    return {"preferred_provider": req.provider}
