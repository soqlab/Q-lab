"""Unified AI provider — routes completions to Anthropic, OpenAI, Groq, Mistral, Gemini,
any OpenAI-compatible endpoint (Ollama, LM Studio, etc.), or a custom HTTP agent webhook.

Supported providers:
  anthropic   — Claude models via the anthropic SDK
  openai      — GPT models via the openai SDK
  groq        — Fast open models (Llama, Mixtral) via Groq's OpenAI-compatible API
  mistral     — Mistral AI models
  gemini      — Google Gemini via its OpenAI-compatible endpoint
  custom      — Any OpenAI-compatible server; credential stored as "<base_url>|||<api_key>"
  agent       — User's own HTTP agent; credential stored as "<webhook_url>|||<bearer_token>"
               POST {"prompt","system","max_tokens"} → {"content":"..."} (or text/message/response)
"""
from __future__ import annotations

import json
from typing import Generator, Iterator, Optional
from sqlalchemy.orm import Session


# ---------------------------------------------------------------------------
# Provider catalogue
# ---------------------------------------------------------------------------

KNOWN_PROVIDERS: dict[str, dict] = {
    "anthropic": {
        "type": "anthropic",
        "label": "Claude (Anthropic)",
        "models": {"fast": "claude-haiku-4-5-20251001", "smart": "claude-sonnet-4-6"},
    },
    "openai": {
        "type": "openai_compat",
        "label": "GPT (OpenAI)",
        "base_url": "https://api.openai.com/v1",
        "models": {"fast": "gpt-4o-mini", "smart": "gpt-4o"},
    },
    "groq": {
        "type": "openai_compat",
        "label": "Groq",
        "base_url": "https://api.groq.com/openai/v1",
        "models": {"fast": "llama-3.1-8b-instant", "smart": "llama-3.3-70b-versatile"},
    },
    "mistral": {
        "type": "openai_compat",
        "label": "Mistral AI",
        "base_url": "https://api.mistral.ai/v1",
        "models": {"fast": "mistral-small-latest", "smart": "mistral-large-latest"},
    },
    "gemini": {
        "type": "openai_compat",
        "label": "Gemini (Google)",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "models": {"fast": "gemini-2.0-flash", "smart": "gemini-2.5-pro-preview-06-05"},
    },
    "custom": {
        "type": "openai_compat",
        "label": "Custom (OpenAI-compatible)",
        "base_url": None,  # read from credential: "<base_url>|||<api_key>"
        "models": {"fast": "gpt-4o-mini", "smart": "gpt-4o-mini"},
    },
    "agent": {
        "type": "webhook",
        "label": "Custom Agent (webhook)",
        "models": {"fast": "agent", "smart": "agent"},
        # credential stored as "<webhook_url>|||<bearer_token>" (token optional)
    },
}

AI_PROVIDER_NAMES = set(KNOWN_PROVIDERS)
_FALLBACK_ORDER = ["anthropic", "openai", "groq", "mistral", "gemini", "custom", "agent"]


# ---------------------------------------------------------------------------
# Error
# ---------------------------------------------------------------------------

class NoAIProviderError(Exception):
    """Raised when no AI provider credential is found for the user."""


# ---------------------------------------------------------------------------
# Credential helpers
# ---------------------------------------------------------------------------

def _get_raw_credential(db: Session, user_id: int, provider: str) -> Optional[str]:
    """Return the decrypted raw credential string for a provider, or None."""
    from .routers.credentials import get_active_key_for_user
    return get_active_key_for_user(db, provider, user_id)


def _parse_credential(provider: str, raw: str) -> tuple[str, Optional[str]]:
    """Return (api_key_or_token, base_url_or_webhook_url) from the raw credential string.

    For 'custom' and 'agent', the raw string is "<url>|||<api_key_or_token>".
    For all other providers, raw IS the api_key.
    """
    if provider in ("custom", "agent"):
        parts = raw.split("|||", 1)
        url = parts[0].strip() or None
        token = parts[1].strip() if len(parts) > 1 else ""
        return token, url
    return raw, KNOWN_PROVIDERS[provider].get("base_url")


# ---------------------------------------------------------------------------
# Provider resolution
# ---------------------------------------------------------------------------

def resolve_ai_provider(db: Session, user_id: int) -> tuple[str, str, Optional[str], dict]:
    """Return (provider, api_key, base_url, config) for the user's active AI provider.

    Checks user's preferred provider first; falls back through the default priority order.
    Raises NoAIProviderError when no AI credential is configured.
    """
    from .store import store_get

    pref = store_get(db, "user_ai_pref", str(user_id))
    preferred = pref.get("provider") if pref else None

    candidates: list[str] = []
    if preferred and preferred in KNOWN_PROVIDERS:
        candidates.append(preferred)
    for p in _FALLBACK_ORDER:
        if p not in candidates:
            candidates.append(p)

    for provider in candidates:
        raw = _get_raw_credential(db, user_id, provider)
        if raw is None:
            continue
        api_key, base_url = _parse_credential(provider, raw)
        cfg = KNOWN_PROVIDERS[provider]
        resolved_base_url = base_url if base_url else cfg.get("base_url")
        return provider, api_key, resolved_base_url, cfg

    raise NoAIProviderError(
        "No AI provider configured. Add an API key in Settings → Credentials."
    )


# ---------------------------------------------------------------------------
# Public completion functions
# ---------------------------------------------------------------------------

def ai_complete(
    prompt: str,
    db: Session,
    user_id: int,
    *,
    system: str = "",
    max_tokens: int = 1000,
    smart: bool = False,
) -> str:
    """Non-streaming completion. Returns plain text."""
    provider, api_key, base_url, cfg = resolve_ai_provider(db, user_id)
    model = cfg["models"]["smart" if smart else "fast"]
    if cfg["type"] == "anthropic":
        return _anthropic_complete(prompt, api_key, system, max_tokens, model)
    if cfg["type"] == "webhook":
        return _webhook_complete(prompt, base_url, api_key, system, max_tokens)
    return _openai_compat_complete(prompt, api_key, base_url, system, max_tokens, model)


def ai_complete_json(
    prompt: str,
    db: Session,
    user_id: int,
    *,
    system: str = "",
    max_tokens: int = 1000,
    smart: bool = False,
) -> dict:
    """Non-streaming completion that strips markdown fences and returns a parsed dict."""
    raw = ai_complete(prompt, db, user_id, system=system, max_tokens=max_tokens, smart=smart)
    # Strip markdown code fences if model wraps in them
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1]
        raw = raw.rsplit("```", 1)[0].strip()
    return json.loads(raw)


def ai_stream(
    prompt: str,
    db: Session,
    user_id: int,
    *,
    system: str = "",
    max_tokens: int = 1000,
    smart: bool = False,
) -> Generator[str, None, None]:
    """Streaming completion; yields SSE-formatted chunks: 'data: {"token": "..."}\n\n'."""
    provider, api_key, base_url, cfg = resolve_ai_provider(db, user_id)
    model = cfg["models"]["smart" if smart else "fast"]
    if cfg["type"] == "anthropic":
        yield from _anthropic_stream(prompt, api_key, system, max_tokens, model)
    elif cfg["type"] == "webhook":
        # Webhook agents don't stream — yield the full response as one chunk
        try:
            text = _webhook_complete(prompt, base_url, api_key, system, max_tokens)
            yield "data: " + json.dumps({"token": text}) + "\n\n"
        except Exception as exc:
            yield "data: " + json.dumps({"error": str(exc)}) + "\n\n"
        yield "data: [DONE]\n\n"
    else:
        yield from _openai_compat_stream(prompt, api_key, base_url, system, max_tokens, model)


# ---------------------------------------------------------------------------
# Webhook agent backend
# ---------------------------------------------------------------------------

def _webhook_complete(
    prompt: str, url: Optional[str], token: str, system: str, max_tokens: int
) -> str:
    """POST prompt to user's agent webhook; accepts several common response shapes."""
    if not url:
        raise NoAIProviderError("Custom agent webhook URL is not configured.")
    import httpx
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    payload = {"prompt": prompt, "max_tokens": max_tokens}
    if system:
        payload["system"] = system
    resp = httpx.post(url, json=payload, headers=headers, timeout=60.0)
    resp.raise_for_status()
    # Accept several common response shapes
    try:
        data = resp.json()
        if isinstance(data, str):
            return data.strip()
        for key in ("content", "text", "message", "response", "output", "result"):
            if key in data and isinstance(data[key], str):
                return data[key].strip()
        # Last resort: stringify whatever came back
        return str(data)
    except Exception:
        return resp.text.strip()


# ---------------------------------------------------------------------------
# Anthropic backend
# ---------------------------------------------------------------------------

def _anthropic_complete(
    prompt: str, api_key: str, system: str, max_tokens: int, model: str
) -> str:
    import anthropic
    client = anthropic.Anthropic(api_key=api_key)
    kwargs: dict = {"model": model, "max_tokens": max_tokens, "messages": [{"role": "user", "content": prompt}]}
    if system:
        kwargs["system"] = system
    msg = client.messages.create(**kwargs)
    return msg.content[0].text.strip()


def _anthropic_stream(
    prompt: str, api_key: str, system: str, max_tokens: int, model: str
) -> Generator[str, None, None]:
    import anthropic
    client = anthropic.Anthropic(api_key=api_key)
    kwargs: dict = {"model": model, "max_tokens": max_tokens, "messages": [{"role": "user", "content": prompt}]}
    if system:
        kwargs["system"] = system
    try:
        with client.messages.stream(**kwargs) as stream:
            for text in stream.text_stream:
                yield "data: " + json.dumps({"token": text}) + "\n\n"
    except Exception as exc:
        yield "data: " + json.dumps({"error": str(exc)}) + "\n\n"
    yield "data: [DONE]\n\n"


# ---------------------------------------------------------------------------
# OpenAI-compatible backend (OpenAI, Groq, Mistral, Gemini, Custom)
# ---------------------------------------------------------------------------

def _openai_compat_complete(
    prompt: str, api_key: str, base_url: Optional[str], system: str, max_tokens: int, model: str
) -> str:
    import openai as _openai
    client = _openai.OpenAI(api_key=api_key or "nokey", base_url=base_url)
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    resp = client.chat.completions.create(model=model, max_tokens=max_tokens, messages=messages)
    return (resp.choices[0].message.content or "").strip()


def _openai_compat_stream(
    prompt: str, api_key: str, base_url: Optional[str], system: str, max_tokens: int, model: str
) -> Generator[str, None, None]:
    import openai as _openai
    client = _openai.OpenAI(api_key=api_key or "nokey", base_url=base_url)
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    try:
        with client.chat.completions.create(
            model=model, max_tokens=max_tokens, messages=messages, stream=True
        ) as stream:
            for chunk in stream:
                delta = chunk.choices[0].delta.content if chunk.choices else None
                if delta:
                    yield "data: " + json.dumps({"token": delta}) + "\n\n"
    except Exception as exc:
        yield "data: " + json.dumps({"error": str(exc)}) + "\n\n"
    yield "data: [DONE]\n\n"
