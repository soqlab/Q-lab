from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import uuid, random, math
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import Identity, require_auth
from ..store import store_put, store_get, store_list, store_delete

router = APIRouter(prefix="/api/v1/talent", tags=["talent"])

NS_PROFILES = "talent_profiles"
NS_JOBS = "talent_jobs"


class ResearcherProfile(BaseModel):
    profile_id: str
    name: str
    # Shown only to the profile's owner; None for everyone else.
    email: Optional[str] = None
    institution: str
    role: str
    expertise: List[str]
    publications: int
    h_index: int
    open_to_opportunities: bool
    bio: str
    website: Optional[str] = None
    orcid: Optional[str] = None
    created_at: str


class JobListing(BaseModel):
    job_id: str
    title: str
    institution: str
    location: str
    type: str
    description: str
    required_skills: List[str]
    preferred_skills: List[str]
    salary_range: Optional[str] = None
    deadline: Optional[str] = None
    contact_email: str
    posted_at: str
    active: bool


class Match(BaseModel):
    profile_id: str
    job_id: str
    match_score: float
    matching_skills: List[str]


class CreateProfileRequest(BaseModel):
    name: str
    email: str
    institution: str
    role: str
    expertise: List[str]
    publications: int
    h_index: int
    open_to_opportunities: bool
    bio: str
    website: Optional[str] = None
    orcid: Optional[str] = None


class CreateJobRequest(BaseModel):
    title: str
    institution: str
    location: str
    type: str
    description: str
    required_skills: List[str]
    preferred_skills: List[str]
    salary_range: Optional[str] = None
    deadline: Optional[str] = None
    contact_email: str


def _skill_overlap(profile_expertise: List[str], job_skills: List[str]) -> List[str]:
    profile_lower = {s.lower() for s in profile_expertise}
    matches = [s for s in job_skills if s.lower() in profile_lower]
    if not matches:
        for p_skill in profile_expertise:
            for j_skill in job_skills:
                p_words = set(p_skill.lower().split())
                j_words = set(j_skill.lower().split())
                if p_words & j_words:
                    matches.append(j_skill)
    return list(dict.fromkeys(matches))


def _public(profile: dict, identity: Identity) -> ResearcherProfile:
    """A profile as the caller may see it: the email address only for its owner."""
    data = dict(profile)
    if data.get("owner_user_id") is None or data.get("owner_user_id") != identity.user_id:
        data["email"] = None
    return ResearcherProfile(**data)


def _match_score(profile: dict, job: dict) -> float:
    required_matches = _skill_overlap(profile["expertise"], job["required_skills"])
    preferred_matches = _skill_overlap(profile["expertise"], job["preferred_skills"])
    required_total = len(job["required_skills"]) or 1
    preferred_total = len(job["preferred_skills"]) or 1
    required_score = len(required_matches) / required_total
    preferred_score = len(preferred_matches) / preferred_total
    role_bonus = 0.0
    role_map = {
        "phd": ["phd_student"],
        "postdoc": ["postdoc"],
        "faculty": ["faculty"],
        "industry": ["industry"],
    }
    if job["type"] in role_map and profile["role"] in role_map[job["type"]]:
        role_bonus = 0.1
    raw = 0.65 * required_score + 0.25 * preferred_score + role_bonus
    return round(min(raw, 1.0), 4)


@router.post("/profile", response_model=ResearcherProfile)
def create_profile(req: CreateProfileRequest, db: Session = Depends(get_db),
                   identity: Identity = Depends(require_auth)) -> ResearcherProfile:
    profile_id = str(uuid.uuid4())
    profile = ResearcherProfile(
        profile_id=profile_id,
        name=req.name,
        email=req.email,
        institution=req.institution,
        role=req.role,
        expertise=req.expertise,
        publications=req.publications,
        h_index=req.h_index,
        open_to_opportunities=req.open_to_opportunities,
        bio=req.bio,
        website=req.website,
        orcid=req.orcid,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    store_put(db, NS_PROFILES, profile_id, {**profile.model_dump(), "owner_user_id": identity.user_id})
    return profile


@router.get("/profiles", response_model=List[ResearcherProfile])
def list_profiles(
    role: Optional[str] = Query(default=None),
    expertise: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    identity: Identity = Depends(require_auth),
) -> List[ResearcherProfile]:
    results = store_list(db, NS_PROFILES)
    if role:
        results = [p for p in results if p["role"] == role]
    if expertise:
        expertise_lower = expertise.lower()
        results = [
            p for p in results
            if any(expertise_lower in e.lower() for e in p["expertise"])
        ]
    return [_public(p, identity) for p in results]


@router.get("/profile/{profile_id}", response_model=ResearcherProfile)
def get_profile(profile_id: str, db: Session = Depends(get_db),
                identity: Identity = Depends(require_auth)) -> ResearcherProfile:
    p = store_get(db, NS_PROFILES, profile_id)
    if not p:
        raise HTTPException(status_code=404, detail=f"Profile {profile_id} not found.")
    return _public(p, identity)


@router.post("/job", response_model=JobListing)
def create_job(req: CreateJobRequest, db: Session = Depends(get_db),
               identity: Identity = Depends(require_auth)) -> JobListing:
    job_id = str(uuid.uuid4())
    job = JobListing(
        job_id=job_id,
        title=req.title,
        institution=req.institution,
        location=req.location,
        type=req.type,
        description=req.description,
        required_skills=req.required_skills,
        preferred_skills=req.preferred_skills,
        salary_range=req.salary_range,
        deadline=req.deadline,
        contact_email=req.contact_email,
        posted_at=datetime.now(timezone.utc).isoformat(),
        active=True,
    )
    store_put(db, NS_JOBS, job_id, job.model_dump())
    return job


@router.get("/jobs", response_model=List[JobListing])
def list_jobs(
    type: Optional[str] = Query(default=None),
    location: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    identity: Identity = Depends(require_auth),
) -> List[JobListing]:
    results = [j for j in store_list(db, NS_JOBS) if j["active"]]
    if type:
        results = [j for j in results if j["type"] == type]
    if location:
        location_lower = location.lower()
        results = [j for j in results if location_lower in j["location"].lower()]
    return [JobListing(**j) for j in results]


@router.get("/matches/{profile_id}", response_model=List[Match])
def get_matches(profile_id: str, db: Session = Depends(get_db),
                identity: Identity = Depends(require_auth)) -> List[Match]:
    profile = store_get(db, NS_PROFILES, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail=f"Profile {profile_id} not found.")
    matches: List[Match] = []
    for job in store_list(db, NS_JOBS):
        if not job["active"]:
            continue
        score = _match_score(profile, job)
        matching_skills = _skill_overlap(
            profile["expertise"],
            job["required_skills"] + job["preferred_skills"],
        )
        matches.append(Match(
            profile_id=profile_id,
            job_id=job["job_id"],
            match_score=score,
            matching_skills=matching_skills,
        ))
    matches.sort(key=lambda m: m.match_score, reverse=True)
    return matches
