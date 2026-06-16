"""Literature connection — suggests arXiv papers relevant to a specific run.

Calls the real arXiv Atom API. If arXiv is unreachable returns an empty list
rather than raising a 500, so the frontend can degrade gracefully.
"""

from __future__ import annotations

import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run

router = APIRouter(prefix="/api/v1/runs", tags=["literature"])

_ARXIV_API = "https://export.arxiv.org/api/query"
_NS = {"atom": "http://www.w3.org/2005/Atom"}

# ---------------------------------------------------------------------------
# Algorithm detection from QASM patterns
# ---------------------------------------------------------------------------

def _detect_algorithm(qasm: str | None, circuit_name: str | None) -> list[str]:
    """Return a list of algorithm keywords inferred from the circuit."""
    keywords: list[str] = []
    name = (circuit_name or "").lower()
    q = (qasm or "").lower()

    # Circuit name heuristics
    for algo, terms in {
        "vqe": ["vqe", "variational eigensolver"],
        "qaoa": ["qaoa", "approximate optimization"],
        "grover": ["grover", "amplitude amplification"],
        "qft": ["qft", "quantum fourier"],
        "shor": ["shor", "factoring"],
        "hhl": ["hhl", "linear system"],
        "qml": ["qml", "quantum machine learning", "qnn"],
        "bell": ["bell", "ghz", "entanglement"],
    }.items():
        if any(t in name for t in terms):
            keywords.append(algo)

    # QASM gate pattern heuristics (rough but effective)
    if q:
        if re.search(r'\bry\b.*\bry\b.*\bcx\b', q) or re.search(r'\brz\b.*\bry\b', q):
            keywords.extend(["variational", "ansatz"])
        if q.count("cx") > 3 and "ry" in q:
            keywords.append("vqe")
        if re.search(r'\bh q\[', q) and re.search(r'\bcx q\[', q):
            if q.count("cx") <= 3:
                keywords.append("bell")
            else:
                keywords.append("entanglement")
        if re.search(r'swap.*swap.*swap', q) or q.count("swap") >= 3:
            keywords.append("qft")
        if re.search(r'\bccx\b', q):
            keywords.append("grover")
        if re.search(r'\bcp\b|\bcu1\b|\bcrz\b', q):
            keywords.append("qft")

    if not keywords:
        keywords = ["quantum circuit", "nisq"]

    return list(dict.fromkeys(keywords))  # deduplicate, preserve order


def _build_search_terms(run: Run) -> list[str]:
    """Build a prioritised list of arXiv search terms from run metadata."""
    terms: list[str] = []

    algo_keywords = _detect_algorithm(run.qasm, run.circuit_name)
    terms.extend(algo_keywords[:2])

    # Backend type signals hardware context
    backend = (run.backend or "").lower()
    if "ibm" in backend or "fake" in backend:
        terms.append("ibm superconducting")
    elif "ionq" in backend or "ion" in backend:
        terms.append("trapped ion")
    elif "rigetti" in backend:
        terms.append("superconducting transmon")

    # Circuit name keywords
    if run.circuit_name:
        name_words = [w for w in re.split(r'[\s_\-]+', run.circuit_name) if len(w) > 3]
        terms.extend(name_words[:2])

    # Parameter keys can hint at algorithm type
    params = run.parameters or {}
    if any(k in params for k in ["p", "gamma", "beta"]):
        terms.append("qaoa")
    if any(k in params for k in ["theta", "phi", "lambda"]):
        terms.append("variational quantum")

    return list(dict.fromkeys(terms))[:4]  # max 4 unique terms


def _relevance_reason(term: str, circuit_name: str | None, algo_keywords: list[str]) -> str:
    """Generate a human-readable reason why this paper was suggested."""
    if term in algo_keywords:
        return f"Matches detected algorithm pattern: {term.upper()}"
    if circuit_name and term.lower() in (circuit_name or "").lower():
        return f"Matches circuit name '{circuit_name}'"
    return f"Relevant to search term: {term}"


def _query_arxiv(term: str, max_results: int = 5) -> list[dict[str, Any]]:
    """Query arXiv Atom API for a single term and parse results."""
    encoded = urllib.parse.quote(f"ti:{term} AND cat:quant-ph")
    url = f"{_ARXIV_API}?search_query={encoded}&max_results={max_results}&sortBy=relevance"

    req = urllib.request.Request(url, headers={"User-Agent": "Q-Lab/1.0 (quantum experiment tracker)"})
    with urllib.request.urlopen(req, timeout=8) as resp:
        xml_bytes = resp.read()

    root = ET.fromstring(xml_bytes)
    papers = []
    for entry in root.findall("atom:entry", _NS):
        arxiv_id_raw = (entry.findtext("atom:id", "", _NS) or "").strip()
        # Extract the short ID from the full URL
        arxiv_id = re.sub(r"^https?://arxiv\.org/abs/", "", arxiv_id_raw).strip()

        title = re.sub(r'\s+', ' ', (entry.findtext("atom:title", "", _NS) or "").strip())
        abstract_full = re.sub(r'\s+', ' ', (entry.findtext("atom:summary", "", _NS) or "").strip())
        abstract_snippet = abstract_full[:300] + ("..." if len(abstract_full) > 300 else "")

        authors = [
            a.findtext("atom:name", "", _NS)
            for a in entry.findall("atom:author", _NS)
        ]

        if arxiv_id and title:
            papers.append({
                "arxiv_id": arxiv_id,
                "title": title,
                "authors": authors,
                "abstract_snippet": abstract_snippet,
                "url": f"https://arxiv.org/abs/{arxiv_id}",
            })
    return papers


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------

@router.get("/{run_id}/literature")
def suggest_literature(run_id: str, db: Session = Depends(get_db)):
    """Suggest arXiv papers relevant to this specific run based on circuit analysis."""
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")

    search_terms = _build_search_terms(run)
    algo_keywords = _detect_algorithm(run.qasm, run.circuit_name)

    seen_ids: set[str] = set()
    papers: list[dict[str, Any]] = []

    try:
        for term in search_terms:
            if len(papers) >= 5:
                break
            try:
                results = _query_arxiv(term, max_results=3)
            except Exception:
                continue  # individual term failure — skip and try next

            for p in results:
                if p["arxiv_id"] not in seen_ids and len(papers) < 5:
                    seen_ids.add(p["arxiv_id"])
                    papers.append({
                        **p,
                        "relevance_reason": _relevance_reason(term, run.circuit_name, algo_keywords),
                    })
    except Exception as exc:
        return {"papers": [], "error": f"arXiv unavailable: {exc}"}

    return {
        "papers": papers,
        "search_terms": search_terms,
        "detected_algorithms": algo_keywords,
    }
