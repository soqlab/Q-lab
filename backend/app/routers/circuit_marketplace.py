from __future__ import annotations
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list, store_delete, store_seed

router = APIRouter(prefix="/api/v1/circuit-marketplace", tags=["circuit-marketplace"])

CATEGORIES = ["ansatze","error_mitigation","benchmarking","chemistry","optimization","sensing","qec","educational"]

_Q = "OPENQASM 2.0;\ninclude \"qelib1.inc\";\n"

SEED_LISTINGS = [
    {"listing_id":"lst-uccsd-001","title":"UCCSD Ansatz for Molecular Simulation",
     "description":"UCCSD ansatz for VQE on 6-qubit systems. Validated on H2O/LiH, <1 mHartree error.",
     "circuit_qasm":_Q+"qreg q[6];\ncreg c[6];\nh q[0];\ncx q[0],q[1];\nry(0.314) q[2];\nmeasure q -> c;",
     "category":"ansatze","tags":["vqe","chemistry","uccsd","h2o","lih"],"price_usd":29.99,
     "author":"Dr. Elena Vasquez","license":"MIT","downloads":312,"rating":4.8,"review_count":41},
    {"listing_id":"lst-qaoa-002","title":"QAOA p=3 MaxCut Circuit (64-node graphs)",
     "description":"QAOA depth p=3 for MaxCut up to 64 nodes. 0.87 approx ratio on 3-regular graphs.",
     "circuit_qasm":_Q+"qreg q[8];\ncreg c[8];\nh q[0];\nrz(0.628) q[0];\ncx q[0],q[1];\nmeasure q -> c;",
     "category":"optimization","tags":["qaoa","maxcut","graph","approximation"],"price_usd":19.99,
     "author":"Kwame Asante","license":"Apache-2.0","downloads":527,"rating":4.6,"review_count":63},
    {"listing_id":"lst-ghz-003","title":"GHZ State Preparation (up to 50 qubits)",
     "description":"O(log n) depth GHZ prep via binary-tree CNOT. Noise-aware variant for NISQ included.",
     "circuit_qasm":_Q+"qreg q[4];\ncreg c[4];\nh q[0];\ncx q[0],q[1];\ncx q[0],q[2];\ncx q[0],q[3];\nmeasure q -> c;",
     "category":"benchmarking","tags":["ghz","entanglement","benchmark","nisq"],"price_usd":0.0,
     "author":"Q-Lab Community","license":"CC0","downloads":1840,"rating":4.9,"review_count":198},
    {"listing_id":"lst-vqe-h2-004","title":"VQE-H2 Optimized Ansatz (STO-3G)",
     "description":"Pre-optimized VQE ansatz for H2 in STO-3G basis, frozen at R=0.74 Å. Chemical accuracy.",
     "circuit_qasm":_Q+"qreg q[4];\ncreg c[4];\nx q[0];\nx q[2];\nry(0.1102) q[1];\ncx q[1],q[0];\nmeasure q -> c;",
     "category":"chemistry","tags":["vqe","h2","sto-3g","ground-state"],"price_usd":9.99,
     "author":"Prof. Mei Lin","license":"MIT","downloads":744,"rating":4.7,"review_count":89},
    {"listing_id":"lst-zne-005","title":"Zero-Noise Extrapolation Mitigation Routine",
     "description":"ZNE wrapper with Richardson extrapolation and gate-folding. Supports Qiskit/Mitiq/PennyLane.",
     "circuit_qasm":"# ZNE wrapper — gate-folding noise scaling. See docs for usage.",
     "category":"error_mitigation","tags":["zne","mitiq","richardson","noise"],"price_usd":14.99,
     "author":"Arjun Patel","license":"Apache-2.0","downloads":289,"rating":4.5,"review_count":34},
    {"listing_id":"lst-qft-006","title":"Quantum Fourier Transform — Textbook & Optimized",
     "description":"Two QFT variants: pedagogical (Nielsen & Chuang) and depth-optimized approx QFT. 4-20 qubits.",
     "circuit_qasm":_Q+"qreg q[4];\ncreg c[4];\nh q[3];\ncu1(pi/2) q[2],q[3];\nh q[2];\nmeasure q -> c;",
     "category":"educational","tags":["qft","fourier","qpe","shor","educational"],"price_usd":0.0,
     "author":"Q-Lab Community","license":"CC0","downloads":2103,"rating":4.9,"review_count":256},
    {"listing_id":"lst-surface-007","title":"Surface-17 QEC Syndrome Extraction",
     "description":"[[17,1,3]] surface code syndrome extraction with ancilla reset and PyMatching decoder hook.",
     "circuit_qasm":_Q+"qreg data[17];\nqreg anc[8];\ncreg syn[8];\ncx data[0],anc[0];\ncz data[1],anc[0];\nmeasure anc -> syn;",
     "category":"qec","tags":["surface-code","qec","fault-tolerant","syndrome"],"price_usd":49.99,
     "author":"FaultTolerant Labs","license":"Commercial","downloads":103,"rating":4.6,"review_count":17},
    {"listing_id":"lst-ramsey-008","title":"Ramsey Interferometry Sensing Circuit",
     "description":"Parameterized Ramsey protocol for frequency estimation. Includes Fisher info + CRB estimator.",
     "circuit_qasm":_Q+"qreg q[1];\ncreg c[1];\nh q[0];\n// free evolution tau\nh q[0];\nmeasure q[0] -> c[0];",
     "category":"sensing","tags":["ramsey","sensing","nv-center","metrology"],"price_usd":24.99,
     "author":"QuantumSense Inc.","license":"MIT","downloads":176,"rating":4.4,"review_count":22},
]

NS_LISTINGS = "marketplace_listings"
NS_PURCHASES = "marketplace_purchases"


class ListingRequest(BaseModel):
    title: str
    description: str
    circuit_qasm: str
    category: str
    tags: list[str]
    price_usd: float
    author: str
    license: str


class PurchaseRequest(BaseModel):
    buyer: str


class ReviewRequest(BaseModel):
    reviewer: str
    rating: int
    comment: str


@router.post("/listing")
def create_listing(req: ListingRequest, db: Session = Depends(get_db)):
    if req.category not in CATEGORIES:
        raise HTTPException(400, f"Invalid category. Choose from: {CATEGORIES}")
    if req.price_usd < 0:
        raise HTTPException(400, "Price cannot be negative")
    lid = str(uuid.uuid4())
    listing = {**req.model_dump(), "listing_id": lid, "downloads": 0,
               "rating": 0.0, "review_count": 0, "reviews": [], "purchases": 0,
               "created_at": datetime.now(timezone.utc).isoformat()}
    store_put(db, NS_LISTINGS, lid, listing)
    return listing


@router.get("")
def browse_listings(category: Optional[str] = None, tags: Optional[str] = None,
                    max_price: Optional[float] = None, sort: Optional[str] = "rating",
                    db: Session = Depends(get_db)):
    store_seed(db, NS_LISTINGS, [
        (item["listing_id"], dict(item, reviews=[], purchases=0))
        for item in SEED_LISTINGS
    ])
    results = store_list(db, NS_LISTINGS)
    if category:
        results = [l for l in results if l["category"] == category]
    if tags:
        tag_list = [t.strip() for t in tags.split(",")]
        results = [l for l in results if any(t in l["tags"] for t in tag_list)]
    if max_price is not None:
        results = [l for l in results if l["price_usd"] <= max_price]
    key = sort if sort in ("rating", "price_usd", "downloads") else "rating"
    results.sort(key=lambda x: x.get(key, 0), reverse=True)
    return {"total": len(results),
            "listings": [{k: v for k, v in l.items() if k != "reviews"} for l in results]}


@router.get("/categories")
def list_categories(db: Session = Depends(get_db)):
    store_seed(db, NS_LISTINGS, [
        (item["listing_id"], dict(item, reviews=[], purchases=0))
        for item in SEED_LISTINGS
    ])
    all_listings = store_list(db, NS_LISTINGS)
    counts = {c: sum(1 for l in all_listings if l["category"] == c) for c in CATEGORIES}
    return {"categories": [{"name": c, "count": counts[c]} for c in CATEGORIES]}


@router.get("/{listing_id}")
def get_listing(listing_id: str, db: Session = Depends(get_db)):
    store_seed(db, NS_LISTINGS, [
        (item["listing_id"], dict(item, reviews=[], purchases=0))
        for item in SEED_LISTINGS
    ])
    listing = store_get(db, NS_LISTINGS, listing_id)
    if not listing:
        raise HTTPException(404, "Listing not found")
    return listing


@router.post("/{listing_id}/purchase")
def purchase_listing(listing_id: str, req: PurchaseRequest, db: Session = Depends(get_db)):
    store_seed(db, NS_LISTINGS, [
        (item["listing_id"], dict(item, reviews=[], purchases=0))
        for item in SEED_LISTINGS
    ])
    listing = store_get(db, NS_LISTINGS, listing_id)
    if not listing:
        raise HTTPException(404, "Listing not found")
    listing["purchases"] = listing.get("purchases", 0) + 1
    listing["downloads"] = listing.get("downloads", 0) + 1
    store_put(db, NS_LISTINGS, listing_id, listing)
    purchase_id = str(uuid.uuid4())
    purchase = {
        "purchase_id": purchase_id,
        "listing_id": listing_id,
        "title": listing["title"],
        "buyer": req.buyer,
        "price_paid_usd": listing["price_usd"],
        "license": listing["license"],
        "circuit_qasm": listing["circuit_qasm"],
        "purchased_at": datetime.now(timezone.utc).isoformat(),
        "access_token": str(uuid.uuid4()),
    }
    store_put(db, NS_PURCHASES, purchase_id, purchase)
    return purchase


@router.post("/{listing_id}/review")
def add_review(listing_id: str, req: ReviewRequest, db: Session = Depends(get_db)):
    store_seed(db, NS_LISTINGS, [
        (item["listing_id"], dict(item, reviews=[], purchases=0))
        for item in SEED_LISTINGS
    ])
    listing = store_get(db, NS_LISTINGS, listing_id)
    if not listing:
        raise HTTPException(404, "Listing not found")
    if not (1 <= req.rating <= 5):
        raise HTTPException(400, "Rating must be between 1 and 5")
    review = {"review_id": str(uuid.uuid4()), **req.model_dump(),
              "created_at": datetime.now(timezone.utc).isoformat()}
    listing["reviews"].append(review)
    all_ratings = [r["rating"] for r in listing["reviews"]]
    listing["rating"] = round(sum(all_ratings) / len(all_ratings), 2)
    listing["review_count"] = len(all_ratings)
    store_put(db, NS_LISTINGS, listing_id, listing)
    return review

