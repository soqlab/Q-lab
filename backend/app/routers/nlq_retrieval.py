"""Semantic Natural Language Circuit Retrieval — Feature #7 of 10.

Allows users to describe a circuit in plain English and returns ranked
matching runs from the database.

Approach
────────
No LLM dependency.  Instead we use a lightweight keyword-to-feature
extraction pipeline that maps natural-language tokens to circuit
fingerprint dimensions, then score every stored run by cosine
similarity of its normalised fingerprint vector against the query
vector.  This gives semantically sensible results without an API key.

Supported query concepts
───────────────────────
Qubit count      : "5-qubit", "5 qubits", "three qubits"
Depth            : "shallow", "deep", "depth 10"
Gate count       : "few gates", "many gates", "100 gates"
Circuit family   : "QAOA", "VQE", "hardware-efficient", "chemistry"
Non-Clifford     : "T-count", "non-clifford", "Clifford", "T gate"
CX count         : "entangled", "few cx", "many cx"
Noise / fidelity : "low noise", "high fidelity", "noisy"
Backend          : "ibm", "ionq", "rigetti", free-text
"""
from __future__ import annotations

import math
import re
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run

router = APIRouter(prefix="/api/v1", tags=["nlq_retrieval"])

# ──────────────────────────────────────────────────────────────────────
# Query → feature vector extraction
# ──────────────────────────────────────────────────────────────────────

_WORD_NUMS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "twelve": 12, "fifteen": 15, "twenty": 20, "thirty": 30,
    "fifty": 50, "hundred": 100,
}

_FAMILY_KEYWORDS: dict[str, list[str]] = {
    "qaoa":                  ["qaoa", "quantum approximate", "max-cut", "maxcut", "combinatorial"],
    "vqe":                   ["vqe", "variational quantum eigensolver", "chemistry", "molecular", "hamiltonian"],
    "hardware_efficient":    ["hardware-efficient", "hardware efficient", "hea", "device-native"],
    "problem_inspired":      ["problem-inspired", "problem inspired", "ising", "heisenberg"],
    "qft":                   ["qft", "quantum fourier", "fourier transform", "shor"],
    "grover":                ["grover", "amplitude amplification", "search algorithm"],
    "bell":                  ["bell", "ghz", "entanglement", "epr"],
}


def _parse_query(q: str) -> dict:
    """
    Returns a dict with optional keys:
      num_qubits, depth, size, cx_count, non_clifford_ratio,
      circuit_family, backend, prefer_low_noise, prefer_high_fidelity
    """
    lower = q.lower()
    tokens = re.findall(r"[\w\-\.]+", lower)
    feat: dict = {}

    # ── Qubit count ──────────────────────────────────────────────────
    m = re.search(r"(\d+)\s*-?\s*qubit", lower)
    if m:
        feat["num_qubits"] = int(m.group(1))
    else:
        for word, n in _WORD_NUMS.items():
            if re.search(rf"\b{word}\s+qubit", lower):
                feat["num_qubits"] = n
                break

    # ── Depth ────────────────────────────────────────────────────────
    m = re.search(r"depth\s+(\d+)", lower)
    if m:
        feat["depth"] = int(m.group(1))
    elif any(t in tokens for t in ["shallow", "short", "compact"]):
        feat["depth"] = 5          # target shallow
    elif any(t in tokens for t in ["deep", "long"]):
        feat["depth"] = 200        # target deep

    # ── Gate / circuit size ──────────────────────────────────────────
    m = re.search(r"(\d+)\s+gates?", lower)
    if m:
        feat["size"] = int(m.group(1))
    elif any(t in tokens for t in ["few", "small", "tiny", "minimal"]):
        feat["size"] = 10
    elif any(t in tokens for t in ["large", "big", "complex", "many"]):
        feat["size"] = 500

    # ── CX / two-qubit gate count ────────────────────────────────────
    m = re.search(r"(\d+)\s+(?:cx|cnot|two-qubit)", lower)
    if m:
        feat["cx_count"] = int(m.group(1))
    elif any(t in tokens for t in ["entangled", "highly-entangled"]):
        feat["cx_count"] = 50

    # ── Non-Clifford / T-count ───────────────────────────────────────
    if any(t in lower for t in ["non-clifford", "non clifford", "t-gate", "t gate", "t-count", "t count"]):
        feat["non_clifford_ratio"] = 0.3
    elif any(t in lower for t in ["clifford", "stabiliser", "stabilizer"]):
        feat["non_clifford_ratio"] = 0.0

    # ── Circuit family ───────────────────────────────────────────────
    for family, keywords in _FAMILY_KEYWORDS.items():
        if any(kw in lower for kw in keywords):
            feat["circuit_family"] = family
            break

    # ── Noise / fidelity preference ──────────────────────────────────
    if any(t in lower for t in ["low noise", "low-noise", "clean", "high fidelity", "high-fidelity"]):
        feat["prefer_low_noise"] = True
    elif any(t in lower for t in ["noisy", "high noise", "tolerant"]):
        feat["prefer_low_noise"] = False

    # ── Backend hint ─────────────────────────────────────────────────
    for be in ["ibm", "ibmq", "ionq", "rigetti", "quantinuum", "aria", "forte", "eagle", "heron"]:
        if be in lower:
            feat["backend"] = be
            break

    return feat


# ──────────────────────────────────────────────────────────────────────
# Run → feature vector
# ──────────────────────────────────────────────────────────────────────

_FEAT_KEYS = ["num_qubits", "depth", "size", "cx_count", "non_clifford_ratio"]

# Normalisation scales (90th percentile typical values)
_SCALES = {
    "num_qubits":         50.0,
    "depth":              300.0,
    "size":               1000.0,
    "cx_count":           200.0,
    "non_clifford_ratio": 1.0,
}


def _run_vector(run: Run) -> dict[str, float]:
    fp = run.fingerprint or {}
    vec: dict[str, float] = {}
    for k in _FEAT_KEYS:
        v = fp.get(k)
        try:
            vec[k] = float(v) if v is not None else None  # type: ignore[assignment]
        except (TypeError, ValueError):
            vec[k] = None  # type: ignore[assignment]
    return vec


def _query_vector(feat: dict) -> dict[str, float | None]:
    vec: dict[str, float | None] = {k: None for k in _FEAT_KEYS}
    for k in _FEAT_KEYS:
        if k in feat:
            vec[k] = float(feat[k])
    return vec


def _norm_val(key: str, val: float) -> float:
    scale = _SCALES.get(key, 1.0)
    return math.log1p(val / scale) if scale > 0 else 0.0


def _cosine_score(qvec: dict, rvec: dict) -> float:
    """Cosine similarity between query and run feature vectors (log-scaled)."""
    shared = [k for k in _FEAT_KEYS if qvec.get(k) is not None and rvec.get(k) is not None]
    if not shared:
        return 0.0
    qa = [_norm_val(k, qvec[k]) for k in shared]  # type: ignore[arg-type]
    ra = [_norm_val(k, rvec[k]) for k in shared]  # type: ignore[arg-type]
    dot = sum(x * y for x, y in zip(qa, ra))
    mq  = math.sqrt(sum(x * x for x in qa)) or 1.0
    mr  = math.sqrt(sum(y * y for y in ra)) or 1.0
    return round(min(1.0, max(0.0, dot / (mq * mr))), 4)


def _family_bonus(feat: dict, run: Run) -> float:
    """Extra score when circuit family matches."""
    requested = feat.get("circuit_family")
    if not requested:
        return 0.0
    fp = run.fingerprint or {}
    # Check fingerprint name or gate patterns
    qasm_lower = (run.qasm or "").lower()
    name_lower = (run.circuit_name or "").lower()
    keywords = _FAMILY_KEYWORDS.get(requested, [])
    for kw in keywords:
        if kw in name_lower or kw in qasm_lower:
            return 0.2
    return 0.0


def _noise_bonus(feat: dict, run: Run) -> float:
    prefer_low = feat.get("prefer_low_noise")
    if prefer_low is None:
        return 0.0
    cal = run.calibration or {}
    err = cal.get("avg_gate_error")
    if err is None:
        return 0.0
    err = float(err)
    if prefer_low and err < 0.005:
        return 0.1
    if not prefer_low and err > 0.01:
        return 0.1
    return 0.0


def _backend_bonus(feat: dict, run: Run) -> float:
    be = feat.get("backend")
    if not be:
        return 0.0
    return 0.15 if (run.backend or "").lower().startswith(be) else 0.0


# ──────────────────────────────────────────────────────────────────────
# Endpoint
# ──────────────────────────────────────────────────────────────────────

@router.get("/circuits/search")
def nlq_search(
    q: str = Query(..., description="Natural language circuit description"),
    limit: int = Query(default=10, ge=1, le=50),
    db: Session = Depends(get_db),
):
    """
    Search stored circuits using a plain-English query.
    Returns ranked runs with relevance scores and match explanations.
    """
    feat = _parse_query(q)
    qvec = _query_vector(feat)

    runs = db.execute(select(Run).limit(2000)).scalars().all()
    if not runs:
        return {
            "query": q,
            "parsed_features": feat,
            "results": [],
            "total_searched": 0,
            "searched_at": datetime.now(timezone.utc).isoformat(),
        }

    scored: list[dict] = []
    for run in runs:
        rvec = _run_vector(run)
        base  = _cosine_score(qvec, rvec)
        bonus = (
            _family_bonus(feat, run) +
            _noise_bonus(feat, run) +
            _backend_bonus(feat, run)
        )
        score = round(min(1.0, base + bonus), 4)

        # Build match explanation
        reasons: list[str] = []
        if feat.get("num_qubits") and rvec.get("num_qubits") is not None:
            reasons.append(f"{int(rvec['num_qubits'])} qubits")
        if feat.get("depth") and rvec.get("depth") is not None:
            reasons.append(f"depth {int(rvec['depth'])}")
        if feat.get("circuit_family") and _family_bonus(feat, run) > 0:
            reasons.append(f"matches {feat['circuit_family']}")
        if feat.get("backend") and _backend_bonus(feat, run) > 0:
            reasons.append(f"on {run.backend}")

        scored.append({
            "run_id":       run.run_id,
            "circuit_name": run.circuit_name or run.run_id,
            "backend":      run.backend,
            "created_at":   run.created_at.isoformat() if run.created_at else None,
            "score":        score,
            "match_reasons": reasons,
            "fingerprint_summary": {
                "num_qubits":         (run.fingerprint or {}).get("num_qubits"),
                "depth":              (run.fingerprint or {}).get("depth"),
                "size":               (run.fingerprint or {}).get("size"),
                "cx_count":           (run.fingerprint or {}).get("cx_count"),
                "non_clifford_ratio": (run.fingerprint or {}).get("non_clifford_ratio"),
            },
        })

    scored.sort(key=lambda x: x["score"], reverse=True)
    top = scored[:limit]

    return {
        "query":            q,
        "parsed_features":  feat,
        "results":          top,
        "total_searched":   len(runs),
        "searched_at":      datetime.now(timezone.utc).isoformat(),
    }
