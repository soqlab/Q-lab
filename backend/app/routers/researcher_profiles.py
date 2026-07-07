"""Researcher Profile Pages — public GitHub-style profiles for quantum researchers.

Endpoints:
  GET  /api/v1/profiles/me              — own profile (auth required)
  POST /api/v1/profiles/me              — create/update own profile (auth required)
  GET  /api/v1/profiles/                — browse public profiles
  GET  /api/v1/profiles/{username}      — public profile page
  GET  /api/v1/profiles/{username}/runs — public runs list
  GET  /api/v1/profiles/{username}/stats — detailed stats
  GET  /api/v1/profiles/{username}/badge — SVG activity badge
"""
from __future__ import annotations

import hashlib
import re
import uuid
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_identity, require_auth, Identity
from ..models import Run, User
from ..store import store_delete, store_get, store_list, store_put, store_seed

router = APIRouter(prefix="/api/v1/profiles", tags=["researcher-profiles"])

NAMESPACE = "researcher_profiles"

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class ResearcherProfile(BaseModel):
    profile_id: str
    username: str
    display_name: str
    title: Optional[str] = None
    institution: Optional[str] = None
    department: Optional[str] = None
    bio: Optional[str] = None
    research_interests: List[str] = []
    orcid_id: Optional[str] = None
    google_scholar_url: Optional[str] = None
    github_username: Optional[str] = None
    website_url: Optional[str] = None
    location: Optional[str] = None
    # Privacy
    public_profile: bool = True
    show_run_count: bool = True
    show_health_scores: bool = True
    show_recent_circuits: bool = True
    # Stats (computed)
    total_runs: Optional[int] = None
    public_runs: Optional[int] = None
    avg_health_score: Optional[float] = None
    top_backends: Optional[List[str]] = None
    top_algorithms: Optional[List[str]] = None
    # Timestamps
    created_at: str
    updated_at: str


class ProfileInput(BaseModel):
    display_name: str
    title: Optional[str] = None
    institution: Optional[str] = None
    department: Optional[str] = None
    bio: Optional[str] = None
    research_interests: List[str] = []
    orcid_id: Optional[str] = None
    google_scholar_url: Optional[str] = None
    github_username: Optional[str] = None
    website_url: Optional[str] = None
    location: Optional[str] = None
    public_profile: bool = True
    show_run_count: bool = True
    show_health_scores: bool = True
    show_recent_circuits: bool = True


# ---------------------------------------------------------------------------
# Seed data
# ---------------------------------------------------------------------------

_SEED_PROFILES = [
    ("profile_alice", {
        "profile_id": "profile_alice",
        "username": "alice_vqe",
        "display_name": "Dr. Alice Chen",
        "title": "Research Scientist",
        "institution": "MIT",
        "department": "Physics",
        "bio": "Specialising in variational quantum eigensolvers and near-term quantum algorithms for chemistry.",
        "research_interests": ["VQE", "Quantum Chemistry", "Error Mitigation"],
        "orcid_id": "0000-0001-2345-6789",
        "google_scholar_url": "https://scholar.google.com/citations?user=alice_vqe",
        "github_username": "alice-vqe",
        "website_url": "https://alice-vqe.mit.edu",
        "location": "Cambridge, MA",
        "public_profile": True,
        "show_run_count": True,
        "show_health_scores": True,
        "show_recent_circuits": True,
        "created_at": "2024-01-15T10:00:00Z",
        "updated_at": "2024-06-01T08:30:00Z",
    }),
    ("profile_bob", {
        "profile_id": "profile_bob",
        "username": "bob_qaoa",
        "display_name": "Bob Martinez",
        "title": "PhD Candidate",
        "institution": "Stanford University",
        "department": "Computer Science",
        "bio": "Working on QAOA for combinatorial optimisation. Interested in noise-adaptive compilation.",
        "research_interests": ["QAOA", "Combinatorial Optimisation", "Noise Adaptation"],
        "orcid_id": None,
        "google_scholar_url": None,
        "github_username": "bob-qaoa",
        "website_url": None,
        "location": "Palo Alto, CA",
        "public_profile": True,
        "show_run_count": True,
        "show_health_scores": True,
        "show_recent_circuits": True,
        "created_at": "2024-02-20T14:00:00Z",
        "updated_at": "2024-05-20T09:00:00Z",
    }),
    ("profile_carol", {
        "profile_id": "profile_carol",
        "username": "carol_qec",
        "display_name": "Prof. Carol Nakamura",
        "title": "Associate Professor",
        "institution": "TU Delft",
        "department": "QuTech",
        "bio": "Quantum error correction, topological codes, and fault-tolerant quantum computing.",
        "research_interests": ["Error Correction", "Topological Codes", "Fault Tolerance"],
        "orcid_id": "0000-0002-3456-7890",
        "google_scholar_url": "https://scholar.google.com/citations?user=carol_qec",
        "github_username": "carol-qec",
        "website_url": "https://qutech.nl/carol",
        "location": "Delft, Netherlands",
        "public_profile": True,
        "show_run_count": True,
        "show_health_scores": True,
        "show_recent_circuits": True,
        "created_at": "2023-11-01T08:00:00Z",
        "updated_at": "2024-04-15T11:00:00Z",
    }),
    ("profile_dave", {
        "profile_id": "profile_dave",
        "username": "dave_grover",
        "display_name": "David Kim",
        "title": "Research Engineer",
        "institution": "IBM Quantum",
        "department": "Algorithms",
        "bio": "Amplitude amplification, Grover search variants, and hardware benchmarking.",
        "research_interests": ["Grover Search", "Amplitude Amplification", "Benchmarking"],
        "orcid_id": None,
        "google_scholar_url": None,
        "github_username": "dave-grover",
        "website_url": "https://research.ibm.com/people/david-kim",
        "location": "Yorktown Heights, NY",
        "public_profile": True,
        "show_run_count": True,
        "show_health_scores": False,
        "show_recent_circuits": True,
        "created_at": "2024-03-10T09:00:00Z",
        "updated_at": "2024-05-30T16:00:00Z",
    }),
    ("profile_eve", {
        "profile_id": "profile_eve",
        "username": "eve_tomo",
        "display_name": "Dr. Eve Okonkwo",
        "title": "Postdoctoral Researcher",
        "institution": "Oxford University",
        "department": "Materials",
        "bio": "Quantum state tomography and characterisation of multi-qubit entangled states.",
        "research_interests": ["State Tomography", "Entanglement", "Characterisation"],
        "orcid_id": "0000-0003-4567-8901",
        "google_scholar_url": "https://scholar.google.com/citations?user=eve_tomo",
        "github_username": None,
        "website_url": "https://eve-tomo.physics.ox.ac.uk",
        "location": "Oxford, UK",
        "public_profile": True,
        "show_run_count": True,
        "show_health_scores": True,
        "show_recent_circuits": False,
        "created_at": "2024-01-25T12:00:00Z",
        "updated_at": "2024-06-05T10:00:00Z",
    }),
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_URL_RE = re.compile(r"^https?://", re.IGNORECASE)
_ORCID_RE = re.compile(r"^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$")


def _validate_input(body: ProfileInput) -> None:
    if body.bio and len(body.bio) > 500:
        raise HTTPException(400, "bio must be ≤ 500 characters")
    for field, value in [
        ("google_scholar_url", body.google_scholar_url),
        ("website_url", body.website_url),
    ]:
        if value and not _URL_RE.match(value):
            raise HTTPException(400, f"{field} must start with http:// or https://")
    if body.orcid_id and not _ORCID_RE.match(body.orcid_id):
        raise HTTPException(400, "orcid_id must be in format 0000-0000-0000-000X")


def _utcnow_str() -> str:
    return datetime.now(timezone.utc).isoformat()


def _get_user_by_identity(identity: Identity, db: Session) -> User:
    user = identity.user
    if not user:
        raise HTTPException(401, "Authentication required (legacy keys not supported for profiles)")
    return user


def _find_profile_by_username(username: str, db: Session) -> Optional[dict[str, Any]]:
    all_profiles = store_list(db, NAMESPACE)
    for p in all_profiles:
        if p.get("username") == username:
            return p
    return None


def _compute_stats(username: str, user_id: Optional[int], db: Session) -> dict[str, Any]:
    """Compute live stats from the runs table for a given username / user_id."""
    q = select(Run)
    if user_id:
        q = q.where(Run.created_by_user_id == user_id)
    else:
        # Fall back: filter by circuit names containing username (best-effort when no user found)
        return {
            "total_runs": 0,
            "public_runs": 0,
            "avg_health_score": None,
            "top_backends": [],
            "top_algorithms": [],
            "recent_circuits": [],
            "algorithm_distribution": {},
        }

    runs: list[Run] = db.scalars(q).all()

    total_runs = len(runs)
    public_runs = sum(1 for r in runs if r.share_token)

    health_scores = [
        r.results.get("health_score") or r.results.get("health")
        for r in runs
        if r.results
    ]
    health_scores = [h for h in health_scores if isinstance(h, (int, float))]
    avg_health = round(sum(health_scores) / len(health_scores), 1) if health_scores else None

    backend_counts: Counter = Counter(r.backend for r in runs if r.backend)
    top_backends = [b for b, _ in backend_counts.most_common(3)]

    # Derive algorithm types from circuit names and tags
    algo_keywords = {
        "VQE": ["vqe", "variational"],
        "QAOA": ["qaoa"],
        "Grover": ["grover"],
        "QFT": ["qft", "fourier"],
        "Tomography": ["tomo", "tomography"],
        "Benchmark": ["benchmark", "rb", "xeb"],
    }
    algo_counts: Counter = Counter()
    for r in runs:
        name = (r.circuit_name or "").lower()
        tags = [t.lower() for t in (r.tags or [])]
        combined = name + " " + " ".join(tags)
        for algo, keywords in algo_keywords.items():
            if any(kw in combined for kw in keywords):
                algo_counts[algo] += 1
                break
        else:
            algo_counts["Other"] += 1

    top_algorithms = [a for a, _ in algo_counts.most_common(3)]

    recent = sorted(runs, key=lambda r: r.created_at or datetime.min, reverse=True)
    recent_circuits = [r.circuit_name for r in recent[:5] if r.circuit_name]

    total = sum(algo_counts.values()) or 1
    algo_dist = {k: round(v / total * 100, 1) for k, v in algo_counts.most_common()}

    return {
        "total_runs": total_runs,
        "public_runs": public_runs,
        "avg_health_score": avg_health,
        "top_backends": top_backends,
        "top_algorithms": top_algorithms,
        "recent_circuits": recent_circuits,
        "algorithm_distribution": algo_dist,
    }


def _find_user_by_username(username: str, db: Session) -> Optional[User]:
    """Try to find a DB user whose name matches username (case-insensitive)."""
    all_users: list[User] = db.scalars(select(User)).all()
    for u in all_users:
        # Match on name or email-prefix
        if u.name and u.name.lower().replace(" ", "_") == username.lower():
            return u
        email_prefix = u.email.split("@")[0].lower() if u.email else ""
        if email_prefix == username.lower():
            return u
    return None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/me")
def get_my_profile(
    identity: Identity = Depends(require_auth),
    db: Session = Depends(get_db),
):
    user = _get_user_by_identity(identity, db)
    username = user.name.lower().replace(" ", "_") if user.name else f"user_{user.id}"

    profile = _find_profile_by_username(username, db)
    if not profile:
        raise HTTPException(
            404,
            detail={"message": "No profile yet. Create one.", "username": username},
        )
    return profile


@router.post("/me")
def upsert_my_profile(
    body: ProfileInput,
    identity: Identity = Depends(require_auth),
    db: Session = Depends(get_db),
):
    _validate_input(body)
    user = _get_user_by_identity(identity, db)
    username = user.name.lower().replace(" ", "_") if user.name else f"user_{user.id}"

    existing = _find_profile_by_username(username, db)
    now = _utcnow_str()

    if existing:
        profile_id = existing["profile_id"]
        record = {
            **existing,
            **body.model_dump(),
            "username": username,
            "profile_id": profile_id,
            "updated_at": now,
        }
    else:
        profile_id = f"profile_{uuid.uuid4().hex[:12]}"
        record = {
            "profile_id": profile_id,
            "username": username,
            **body.model_dump(),
            "created_at": now,
            "updated_at": now,
        }

    store_put(db, NAMESPACE, profile_id, record)
    return record


@router.get("")
def list_profiles(
    institution: Optional[str] = Query(default=None),
    research_interest: Optional[str] = Query(default=None),
    sort: str = Query(default="newest", pattern="^(most_runs|best_health|newest)$"),
    db: Session = Depends(get_db),
):
    store_seed(db, NAMESPACE, _SEED_PROFILES)
    profiles = store_list(db, NAMESPACE)
    public = [p for p in profiles if p.get("public_profile", True)]

    if institution:
        public = [p for p in public if institution.lower() in (p.get("institution") or "").lower()]
    if research_interest:
        public = [
            p for p in public
            if any(research_interest.lower() in ri.lower() for ri in p.get("research_interests", []))
        ]

    # Attach computed stats for sorting/display
    for p in public:
        username = p.get("username", "")
        db_user = _find_user_by_username(username, db)
        stats = _compute_stats(username, db_user.id if db_user else None, db)
        p["total_runs"] = stats["total_runs"]
        p["public_runs"] = stats["public_runs"]
        p["avg_health_score"] = stats["avg_health_score"]
        p["top_backends"] = stats["top_backends"]
        p["top_algorithms"] = stats["top_algorithms"]

    if sort == "most_runs":
        public.sort(key=lambda p: p.get("total_runs") or 0, reverse=True)
    elif sort == "best_health":
        public.sort(key=lambda p: p.get("avg_health_score") or 0, reverse=True)
    else:  # newest
        public.sort(key=lambda p: p.get("created_at", ""), reverse=True)

    return {"profiles": public, "total": len(public)}


@router.get("/{username}/runs")
def get_public_runs(
    username: str,
    page: int = Query(default=1, ge=1),
    db: Session = Depends(get_db),
):
    store_seed(db, NAMESPACE, _SEED_PROFILES)
    profile = _find_profile_by_username(username, db)
    if not profile or not profile.get("public_profile", True):
        raise HTTPException(404, "Profile not found")

    db_user = _find_user_by_username(username, db)
    if not db_user:
        return {"runs": [], "total": 0, "page": page}

    runs: list[Run] = db.scalars(
        select(Run)
        .where(Run.created_by_user_id == db_user.id, Run.share_token.isnot(None))
        .order_by(Run.created_at.desc())
    ).all()

    offset = (page - 1) * 20
    page_runs = runs[offset: offset + 20]

    return {
        "runs": [
            {
                "run_id": r.run_id,
                "circuit_name": r.circuit_name,
                "backend": r.backend,
                "health_score": (r.results or {}).get("health_score"),
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "share_token": r.share_token,
            }
            for r in page_runs
        ],
        "total": len(runs),
        "page": page,
    }


@router.get("/{username}/stats")
def get_profile_stats(username: str, db: Session = Depends(get_db)):
    store_seed(db, NAMESPACE, _SEED_PROFILES)
    profile = _find_profile_by_username(username, db)
    if not profile or not profile.get("public_profile", True):
        raise HTTPException(404, "Profile not found")

    db_user = _find_user_by_username(username, db)
    if not db_user:
        return {
            "username": username,
            "monthly_runs": {},
            "backend_distribution": {},
            "health_trend": [],
            "algorithm_distribution": {},
            "activity_streak": 0,
        }

    runs: list[Run] = db.scalars(
        select(Run)
        .where(Run.created_by_user_id == db_user.id)
        .order_by(Run.created_at.desc())
    ).all()

    # Monthly runs (last 12 months)
    now = datetime.now(timezone.utc)
    monthly: dict[str, int] = defaultdict(int)
    for r in runs:
        if r.created_at:
            dt = r.created_at if r.created_at.tzinfo else r.created_at.replace(tzinfo=timezone.utc)
            if (now - dt).days <= 365:
                key = dt.strftime("%Y-%m")
                monthly[key] += 1

    # Backend distribution
    backend_dist: Counter = Counter(r.backend for r in runs if r.backend)

    # Health trend (last 20 runs with scores)
    health_trend = []
    for r in runs[:20]:
        score = (r.results or {}).get("health_score")
        if score is not None:
            health_trend.append({
                "run_id": r.run_id,
                "date": r.created_at.isoformat() if r.created_at else None,
                "health_score": score,
            })

    # Algorithm distribution
    stats = _compute_stats(username, db_user.id, db)

    # Activity streak
    run_dates = set()
    for r in runs:
        if r.created_at:
            dt = r.created_at if r.created_at.tzinfo else r.created_at.replace(tzinfo=timezone.utc)
            run_dates.add(dt.date())

    streak = 0
    check_date = now.date()
    while check_date in run_dates:
        streak += 1
        check_date -= timedelta(days=1)

    return {
        "username": username,
        "monthly_runs": dict(monthly),
        "backend_distribution": dict(backend_dist),
        "health_trend": health_trend,
        "algorithm_distribution": stats["algorithm_distribution"],
        "activity_streak": streak,
        "total_runs": stats["total_runs"],
        "public_runs": stats["public_runs"],
    }


@router.get("/{username}/badge")
def get_profile_badge(username: str, db: Session = Depends(get_db)):
    """SVG activity heatmap — 52-week grid of run activity."""
    store_seed(db, NAMESPACE, _SEED_PROFILES)
    profile = _find_profile_by_username(username, db)
    if not profile or not profile.get("public_profile", True):
        raise HTTPException(404, "Profile not found")

    db_user = _find_user_by_username(username, db)
    run_dates: Counter = Counter()
    if db_user:
        runs: list[Run] = db.scalars(
            select(Run).where(Run.created_by_user_id == db_user.id)
        ).all()
        for r in runs:
            if r.created_at:
                dt = r.created_at if r.created_at.tzinfo else r.created_at.replace(tzinfo=timezone.utc)
                if (datetime.now(timezone.utc) - dt).days <= 364:
                    run_dates[dt.date()] += 1

    # Build 52×7 grid
    now = datetime.now(timezone.utc).date()
    # Start from 52 weeks ago, aligned to Monday
    start = now - timedelta(weeks=52)
    while start.weekday() != 0:
        start -= timedelta(days=1)

    cell_w, cell_h, gap = 11, 11, 2
    cols = 52
    rows = 7
    width = cols * (cell_w + gap) + 2
    height = rows * (cell_h + gap) + 24

    cells_svg = []
    for week in range(cols):
        for day in range(rows):
            date = start + timedelta(days=week * 7 + day)
            count = run_dates.get(date, 0)
            if count == 0:
                color = "#1e293b"
            elif count == 1:
                color = "#0e4429"
            elif count <= 3:
                color = "#006d32"
            elif count <= 6:
                color = "#26a641"
            else:
                color = "#39d353"
            x = week * (cell_w + gap) + 1
            y = day * (cell_h + gap) + 14
            cells_svg.append(
                f'<rect x="{x}" y="{y}" width="{cell_w}" height="{cell_h}" '
                f'rx="2" ry="2" fill="{color}">'
                f'<title>{date.isoformat()}: {count} run{"s" if count != 1 else ""}</title>'
                f'</rect>'
            )

    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'style="background:#0d1b2a;border-radius:8px;padding:4px">'
        f'<text x="1" y="10" font-size="10" fill="#64748b" font-family="monospace">'
        f'{username} — run activity</text>'
        + "".join(cells_svg)
        + "</svg>"
    )

    return Response(content=svg, media_type="image/svg+xml")


@router.get("/{username}")
def get_profile(username: str, db: Session = Depends(get_db)):
    store_seed(db, NAMESPACE, _SEED_PROFILES)
    profile = _find_profile_by_username(username, db)
    if not profile:
        raise HTTPException(404, "Profile not found")
    if not profile.get("public_profile", True):
        raise HTTPException(404, "Profile not found")

    db_user = _find_user_by_username(username, db)
    stats = _compute_stats(username, db_user.id if db_user else None, db)

    result = dict(profile)
    result["total_runs"] = stats["total_runs"] if profile.get("show_run_count") else None
    result["public_runs"] = stats["public_runs"] if profile.get("show_run_count") else None
    result["avg_health_score"] = stats["avg_health_score"] if profile.get("show_health_scores") else None
    result["top_backends"] = stats["top_backends"]
    result["top_algorithms"] = stats["top_algorithms"]
    result["recent_circuits"] = stats["recent_circuits"] if profile.get("show_recent_circuits") else []
    result["algorithm_distribution"] = stats["algorithm_distribution"]

    return result

