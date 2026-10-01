"""Lab Assistant Chatbot — RAG-powered conversational AI over experiment history.

Researchers ask natural-language questions about their quantum experiment history.
Claude answers with context from the most relevant runs, maintaining conversation memory.

Router prefix: /api/v1/assistant
"""

from __future__ import annotations

import os
import re
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from ..ai_provider import resolve_ai_provider, NoAIProviderError, ai_complete
from ..database import get_db
from ..deps import get_identity, Identity
from ..models import Run
from ..store import store_put, store_get, store_list, store_delete

router = APIRouter(prefix="/api/v1/assistant", tags=["lab-assistant"])

_MODEL = "claude-sonnet-4-6"
_NAMESPACE = "assistant_conversations"


# ------------------------------------------------------------------
# Pydantic models
# ------------------------------------------------------------------

class Conversation(BaseModel):
    conversation_id: str
    messages: List[dict]  # {"role": "user"|"assistant", "content": str}
    created_at: str
    last_active: str


class ChatRequest(BaseModel):
    message: str
    conversation_id: Optional[str] = None
    backend_filter: Optional[str] = None


class ChatResponse(BaseModel):
    answer: str
    conversation_id: str
    cited_runs: List[str]
    relevant_run_count: int


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _search_runs(db: Session, query: str, backend_filter: Optional[str], limit: int = 20) -> list:
    q = select(Run).order_by(Run.created_at.desc())
    if backend_filter:
        q = q.where(Run.backend == backend_filter)
    search_terms = query.lower().split()[:5]
    all_runs = db.execute(q.limit(500)).scalars().all()
    scored = []
    for run in all_runs:
        score = 0
        name = (run.circuit_name or "").lower()
        backend = (run.backend or "").lower()
        tags = " ".join(run.tags or []).lower()
        project = (run.project_slug or "").lower()
        for term in search_terms:
            if term in name:
                score += 3
            if term in backend:
                score += 2
            if term in tags:
                score += 2
            if term in project:
                score += 1
        scored.append((score, run))
    scored.sort(key=lambda x: (x[0], x[1].created_at), reverse=True)
    return [r for _, r in scored[:limit]]


def _run_to_context(run) -> str:
    results = run.results or {}
    cal = run.calibration or {}
    exe = run.execution or {}
    health = results.get("health_score") or getattr(run, "health_score", "N/A")
    return (
        f"Run {run.run_id[:8]}... | "
        f"Circuit: {run.circuit_name or 'unknown'} | "
        f"Backend: {run.backend or 'unknown'} | "
        f"Status: {run.status} | "
        f"Health: {health}/100 | "
        f"Shots: {exe.get('shots', '?')} | "
        f"Created: {run.created_at.strftime('%Y-%m-%d %H:%M') if run.created_at else 'unknown'} | "
        f"Project: {run.project_slug or 'none'} | "
        f"Tags: {', '.join(run.tags or []) or 'none'} | "
        f"T1: {cal.get('t1_us', '?')}µs | "
        f"Success prob: {results.get('success_probability', '?')}"
    )


def _get_or_create_conversation(db: Session, conversation_id: Optional[str]) -> tuple[str, Conversation]:
    """Load existing conversation or create a new one. Returns (conversation_id, conversation)."""
    if conversation_id:
        data = store_get(db, _NAMESPACE, conversation_id)
        if data:
            conv = Conversation(**data)
            return conversation_id, conv

    # Create new conversation
    new_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    conv = Conversation(
        conversation_id=new_id,
        messages=[],
        created_at=now,
        last_active=now,
    )
    return new_id, conv


def _save_conversation(db: Session, conv: Conversation) -> None:
    conv.last_active = datetime.now(timezone.utc).isoformat()
    store_put(db, _NAMESPACE, conv.conversation_id, conv.model_dump())


def _extract_cited_runs(answer: str) -> List[str]:
    """Extract run IDs cited in the format [Run abc12345]."""
    pattern = r'\[Run ([a-f0-9]{8})\]'
    return list(set(re.findall(pattern, answer)))


def _get_aggregate_stats(db: Session) -> dict:
    """Compute aggregate stats across all runs."""
    all_runs = db.execute(select(Run).order_by(Run.created_at.asc())).scalars().all()
    if not all_runs:
        return {
            "total_runs": 0,
            "earliest_date": "N/A",
            "latest_date": "N/A",
            "top_backend": "N/A",
            "success_rate": 0.0,
            "avg_health": 0.0,
        }

    total_runs = len(all_runs)
    earliest = all_runs[0].created_at
    latest = all_runs[-1].created_at

    # Top backend by count
    backend_counts: dict[str, int] = {}
    for r in all_runs:
        b = r.backend or "unknown"
        backend_counts[b] = backend_counts.get(b, 0) + 1
    top_backend = max(backend_counts, key=lambda k: backend_counts[k]) if backend_counts else "N/A"

    # Success rate (completed / total)
    completed = sum(1 for r in all_runs if r.status == "completed")
    success_rate = completed / total_runs if total_runs else 0.0

    # Average health score from results JSON
    health_vals = []
    for r in all_runs:
        res = r.results or {}
        hs = res.get("health_score")
        if hs is not None:
            try:
                health_vals.append(float(hs))
            except (TypeError, ValueError):
                pass
    avg_health = sum(health_vals) / len(health_vals) if health_vals else 0.0

    return {
        "total_runs": total_runs,
        "earliest_date": earliest.strftime("%Y-%m-%d") if earliest else "N/A",
        "latest_date": latest.strftime("%Y-%m-%d") if latest else "N/A",
        "top_backend": top_backend,
        "success_rate": success_rate,
        "avg_health": avg_health,
    }


_TOOLS = [
    {
        "name": "estimate_cost",
        "description": "Estimate the cost of running a quantum circuit across cloud providers (IBM, IonQ, Rigetti, Azure). Use when the user asks about cost, pricing, budget, or which provider is cheapest.",
        "input_schema": {
            "type": "object",
            "properties": {
                "n_qubits":      {"type": "integer", "description": "Number of qubits in the circuit"},
                "circuit_depth": {"type": "integer", "description": "Circuit depth (number of gate layers)"},
                "n_shots":       {"type": "integer", "description": "Number of measurement shots"},
                "n_circuits":    {"type": "integer", "description": "Number of circuits to run", "default": 1},
            },
            "required": ["n_qubits", "circuit_depth", "n_shots"],
        },
    },
    {
        "name": "search_runs",
        "description": "Search experiment run history by circuit name, backend, status, or tags. Use when the user asks about specific past experiments.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query":   {"type": "string",  "description": "Search terms (circuit name, backend, tags, project)"},
                "limit":   {"type": "integer", "description": "Max results to return", "default": 10},
            },
            "required": ["query"],
        },
    },
]


def _execute_tool(name: str, inputs: dict, db: Session) -> str:
    """Execute a tool call and return a string result for the model."""
    if name == "estimate_cost":
        from .cost_oracle import PRICING, _ibm_seconds_estimate, _hqc_estimate
        n_qubits      = int(inputs.get("n_qubits", 5))
        circuit_depth = int(inputs.get("circuit_depth", 20))
        n_shots       = int(inputs.get("n_shots", 1024))
        n_circuits    = int(inputs.get("n_circuits", 1))
        lines = [f"Cost estimate for {n_qubits} qubits, depth {circuit_depth}, {n_shots} shots, {n_circuits} circuit(s):\n"]
        results = []
        for pid, p in PRICING.items():
            try:
                if pid == "ibm_quantum_free":
                    cost = 0.0 if n_shots <= 10_000_000 else None
                elif pid == "ibm_quantum_premium":
                    cost = _ibm_seconds_estimate(n_qubits, circuit_depth, n_shots) * n_circuits
                elif pid in ("aws_braket_sv1",):
                    cost = p.get("cost_per_task", 0.075) * n_circuits
                elif pid == "aws_braket_ionq":
                    cost = (p["cost_per_task"] + n_shots * p["cost_per_shot"]) * n_circuits
                elif pid == "aws_braket_rigetti":
                    cost = (p["cost_per_task"] + n_shots * p["cost_per_shot"]) * n_circuits
                elif pid == "azure_ionq":
                    cost = n_shots * p["cost_per_shot"] * n_circuits
                elif pid == "azure_quantinuum":
                    cost = _hqc_estimate(n_qubits, circuit_depth, n_shots) * n_circuits
                elif pid == "iqm_resonance":
                    cost = (p.get("cost_per_circuit", 0.05) + n_shots * p.get("cost_per_shot", 0.0005)) * n_circuits
                else:
                    continue
                results.append((cost if cost is not None else 999999, p["name"], cost))
            except Exception:
                continue
        results.sort()
        for _, name_p, cost in results:
            cost_str = "FREE" if cost == 0 else (f"${cost:.4f}" if cost is not None else "N/A")
            lines.append(f"  • {name_p}: {cost_str}")
        cheapest = next((n for _, n, c in results if c is not None), "unknown")
        lines.append(f"\nCheapest paid option: {cheapest}")
        return "\n".join(lines)

    if name == "search_runs":
        query = inputs.get("query", "")
        limit = int(inputs.get("limit", 10))
        runs = _search_runs(db, query, None, limit)
        if not runs:
            return "No matching runs found."
        return "\n".join(_run_to_context(r) for r in runs)

    return f"Unknown tool: {name}"


def _call_claude(
    system: str, messages: list, db: Session | None = None,
    api_key: Optional[str] = None, provider_name: str = "anthropic",
    base_url: Optional[str] = None,
) -> str:
    """Call AI with tool use support (Anthropic) or simple completion (other providers)."""
    if not api_key and provider_name == "anthropic":
        raise HTTPException(503, "Add an AI provider key in Settings → Credentials")

    # Non-Anthropic providers: fall back to plain completion (no tool use)
    if provider_name != "anthropic":
        prompt = "\n".join(
            m["content"] if isinstance(m["content"], str)
            else str(m["content"])
            for m in messages if m.get("role") == "user"
        ) or (messages[-1]["content"] if messages else "")
        try:
            import openai as _openai
            client = _openai.OpenAI(api_key=api_key or "nokey", base_url=base_url)
            msgs = [{"role": "system", "content": system}] if system else []
            msgs += messages
            resp = client.chat.completions.create(model=_MODEL, max_tokens=1500, messages=msgs)
            return (resp.choices[0].message.content or "").strip()
        except Exception as exc:
            raise HTTPException(502, f"AI request failed: {exc}")

    try:
        import anthropic
    except ImportError:
        raise HTTPException(503, "anthropic package not installed. Run: pip install anthropic")

    client = anthropic.Anthropic(api_key=api_key)
    current_messages = list(messages)

    for _ in range(5):  # max tool-use rounds
        response = client.messages.create(
            model=_MODEL,
            max_tokens=1500,
            system=system,
            tools=_TOOLS,
            messages=current_messages,
        )

        # Collect any text content
        text_parts = [b.text for b in response.content if hasattr(b, "text")]

        if response.stop_reason == "end_turn" or not any(b.type == "tool_use" for b in response.content):
            return "\n".join(text_parts).strip() if text_parts else "I wasn't able to find a useful answer."

        # Execute tool calls
        tool_results = []
        for block in response.content:
            if block.type == "tool_use":
                result_text = _execute_tool(block.name, block.input, db) if db else "Tool execution requires DB context."
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": result_text,
                })

        # Append assistant turn + tool results and loop
        current_messages = current_messages + [
            {"role": "assistant", "content": response.content},
            {"role": "user",      "content": tool_results},
        ]

    return "I ran into an issue processing your request after multiple attempts."


# ------------------------------------------------------------------
# Endpoints
# ------------------------------------------------------------------

@router.post("/chat", response_model=ChatResponse)
def chat(body: ChatRequest, db: Session = Depends(get_db), identity: Optional[Identity] = Depends(get_identity)):
    """Main RAG chat endpoint. Retrieves relevant runs, calls Claude, persists conversation."""
    if not body.message.strip():
        raise HTTPException(400, "message cannot be empty")
    if not identity:
        raise HTTPException(401, "Login required to use AI features")
    try:
        _provider_name, api_key, _base_url, _cfg = resolve_ai_provider(db, identity.user_id)
    except NoAIProviderError:
        raise HTTPException(503, "Add an AI provider key in Settings → Credentials")
    provider_name, base_url = _provider_name, _base_url

    # Load or create conversation
    conversation_id, conversation = _get_or_create_conversation(db, body.conversation_id)

    # Get aggregate stats for context
    stats = _get_aggregate_stats(db)

    # Search for relevant runs
    relevant_runs = _search_runs(db, body.message, body.backend_filter, limit=20)

    # Build system prompt
    system = """You are Q-Lab's Lab Assistant — an expert quantum computing research assistant with access to this lab's complete experiment history and live tools.

You have two tools available:
- estimate_cost: call this whenever the user asks about cost, pricing, budget, or which provider is cheapest for their circuit. Extract n_qubits, circuit_depth, and n_shots from context or ask.
- search_runs: call this to find specific past experiments when the user references circuit names, backends, or project names.

When citing specific runs, use the format [Run abc12345] (first 8 chars of run_id).
Be specific with numbers. Provide exact values from the data.
Keep responses concise but complete. Use bullet points for lists.
If you don't have enough data, say so clearly and suggest what parameters would help."""

    # Build user prompt with context
    total_runs = stats["total_runs"]
    earliest_date = stats["earliest_date"]
    latest_date = stats["latest_date"]
    top_backend = stats["top_backend"]
    success_rate = stats["success_rate"]
    avg_health = stats["avg_health"]

    run_context = "\n".join(_run_to_context(r) for r in relevant_runs[:15]) if relevant_runs else "No experiments found."

    user_prompt = f"""Lab Data Summary:
- Total runs in database: {total_runs}
- Date range: {earliest_date} to {latest_date}
- Top backend: {top_backend}
- Overall success rate: {success_rate:.1%}
- Avg health score: {avg_health:.1f}/100

Most Relevant Experiments for This Question:
{run_context}

Conversation history: {len(conversation.messages)} previous messages.

User question: {body.message}"""

    # Build messages array with conversation history (last 10 messages)
    history = conversation.messages[-10:]
    messages = list(history) + [{"role": "user", "content": user_prompt}]

    # Call AI (with tool use for Anthropic; plain completion for others)
    answer = _call_claude(system, messages, db=db, api_key=api_key, provider_name=provider_name, base_url=base_url)

    # Extract cited run IDs
    cited_runs = _extract_cited_runs(answer)

    # Update conversation history (store original message, not the context-enriched one)
    conversation.messages.append({"role": "user", "content": body.message})
    conversation.messages.append({"role": "assistant", "content": answer})
    _save_conversation(db, conversation)

    return ChatResponse(
        answer=answer,
        conversation_id=conversation_id,
        cited_runs=cited_runs,
        relevant_run_count=len(relevant_runs),
    )


@router.get("/conversations")
def list_conversations(db: Session = Depends(get_db)):
    """List recent conversations (newest first)."""
    all_data = store_list(db, _NAMESPACE)
    # Sort by last_active descending
    conversations = []
    for data in all_data:
        try:
            conv = Conversation(**data)
            # Build a preview from first user message
            preview = ""
            for msg in conv.messages:
                if msg.get("role") == "user":
                    preview = msg.get("content", "")[:80]
                    break
            conversations.append({
                "conversation_id": conv.conversation_id,
                "preview": preview,
                "message_count": len(conv.messages),
                "created_at": conv.created_at,
                "last_active": conv.last_active,
            })
        except Exception:
            continue

    conversations.sort(key=lambda x: x["last_active"], reverse=True)
    return conversations


@router.get("/conversation/{conversation_id}")
def get_conversation(conversation_id: str, db: Session = Depends(get_db)):
    """Get full conversation history."""
    data = store_get(db, _NAMESPACE, conversation_id)
    if not data:
        raise HTTPException(404, "Conversation not found")
    return Conversation(**data)


@router.delete("/conversation/{conversation_id}")
def delete_conversation(conversation_id: str, db: Session = Depends(get_db)):
    """Delete a conversation."""
    deleted = store_delete(db, _NAMESPACE, conversation_id)
    if not deleted:
        raise HTTPException(404, "Conversation not found")
    return {"deleted": True, "conversation_id": conversation_id}


@router.get("/suggested-questions")
def suggested_questions(db: Session = Depends(get_db)):
    """Return 8 contextual suggested questions based on actual DB data."""
    # Gather DB context to make questions relevant
    total_runs = db.scalar(select(func.count()).select_from(Run)) or 0

    # Get distinct backends
    backends_result = db.execute(
        select(Run.backend).where(Run.backend.isnot(None)).distinct().limit(5)
    ).scalars().all()
    backends = [b for b in backends_result if b]

    # Get distinct projects
    projects_result = db.execute(
        select(Run.project_slug).where(Run.project_slug.isnot(None)).distinct().limit(3)
    ).scalars().all()
    projects = [p for p in projects_result if p]

    # Get some circuit names
    circuits_result = db.execute(
        select(Run.circuit_name).where(Run.circuit_name.isnot(None)).distinct().limit(3)
    ).scalars().all()
    circuits = [c for c in circuits_result if c]

    questions = []

    # Generic always-useful questions
    questions.append("Which experiments had the highest health scores overall?")
    questions.append("What is the overall success rate of my experiments?")

    # Backend-specific questions
    if len(backends) >= 2:
        questions.append(f"Compare health scores between {backends[0]} and {backends[1]}")
        questions.append(f"Which backend performs best for my circuits?")
    elif len(backends) == 1:
        questions.append(f"How have my experiments on {backends[0]} performed over time?")
        questions.append("Which backend should I use for my next experiment?")
    else:
        questions.append("Which backend has the best average success rate?")
        questions.append("What patterns do you see across my experiment history?")

    # Circuit-specific questions
    if circuits:
        questions.append(f"Show me the best results for the {circuits[0]} circuit")
    else:
        questions.append("Which circuit types have the highest success probability?")

    # Project-specific questions
    if projects:
        questions.append(f"Summarize the results for project {projects[0]}")
    else:
        questions.append("What are the most recent failed experiments and why might they have failed?")

    # Volume/trend questions
    if total_runs > 10:
        questions.append("What trends do you see in my health scores over time?")
    else:
        questions.append("What should I focus on to improve my experiment success rate?")

    # Always add a general analytical question
    questions.append("Which experiments should I re-run or investigate further?")

    # Return first 8 unique questions
    seen = set()
    unique_questions = []
    for q in questions:
        if q not in seen:
            seen.add(q)
            unique_questions.append(q)
        if len(unique_questions) == 8:
            break

    return {"questions": unique_questions, "total_runs": total_runs}
