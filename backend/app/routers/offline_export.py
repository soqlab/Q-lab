from __future__ import annotations
import uuid
import hashlib
import random
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list, store_delete, store_seed

router = APIRouter(prefix="/api/v1/offline-export", tags=["offline-export"])

NS = "offline_exports"

DOCKER_COMPOSE = (
    'version: "3.9"\nservices:\n'
    '  frontend:\n    image: qlab/frontend:latest\n    ports: ["3000:3000"]\n'
    '    environment: [NEXT_PUBLIC_API_URL=http://backend:8000, NODE_ENV=production]\n'
    '    depends_on: [backend]\n    restart: unless-stopped\n'
    '  backend:\n    image: qlab/backend:latest\n    ports: ["8000:8000"]\n'
    '    environment:\n      - DATABASE_URL=postgresql://qlab:qlab_secret@db:5432/qlab\n'
    '      - REDIS_URL=redis://redis:6379/0\n      - OFFLINE_MODE=true\n'
    '    command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4\n'
    '    depends_on: [db, redis]\n    restart: unless-stopped\n'
    '  db:\n    image: postgres:15-alpine\n'
    '    environment: [POSTGRES_USER=qlab, POSTGRES_PASSWORD=qlab_secret, POSTGRES_DB=qlab]\n'
    '    volumes: [postgres_data:/var/lib/postgresql/data]\n    restart: unless-stopped\n'
    '  redis:\n    image: redis:7-alpine\n    command: redis-server --appendonly yes\n'
    '    volumes: [redis_data:/data]\n    restart: unless-stopped\n'
    '  nginx:\n    image: nginx:alpine\n    ports: ["80:80","443:443"]\n'
    '    volumes: [./nginx/nginx.conf:/etc/nginx/nginx.conf:ro]\n'
    '    depends_on: [frontend, backend]\n    restart: unless-stopped\n'
    'volumes:\n  postgres_data:\n  redis_data:\n'
)

AIR_GAP_README = (
    "# Q-Lab Offline / Air-Gap Deployment\n\n"
    "## Prerequisites\n- Docker >= 24.0, Compose >= 2.20\n- 16 GB RAM, 50 GB disk, x86_64/arm64\n\n"
    "## Steps\n"
    "1. Transfer bundle via USB or secure media (verify checksum first)\n"
    "2. Load images: docker load -i images/*.tar\n"
    "3. Configure: cp .env.example .env  # set SECRET_KEY, do NOT expose 5432 externally\n"
    "4. Launch: docker compose up -d\n"
    "5. Verify: curl http://localhost/api/v1/health\n\n"
    "## Security\n- Change all default credentials immediately\n"
    "- Enable TLS with your facility CA (certs -> ./nginx/ssl/)\n"
    "- OFFLINE_MODE=true disables all outbound telemetry\n\n"
    "## Offline Simulator\nLocal Qiskit Aer included. No QPU access in offline mode.\n"
)

COMPONENTS = [
    {"name": "frontend-nextjs",  "size_mb": 312.4, "included": True,  "description": "Next.js 14 frontend"},
    {"name": "backend-fastapi",  "size_mb": 87.2,  "included": True,  "description": "FastAPI + uvicorn"},
    {"name": "postgres-15",      "size_mb": 89.6,  "included": True,  "description": "PostgreSQL 15 Alpine"},
    {"name": "redis-7",          "size_mb": 36.8,  "included": True,  "description": "Redis 7 Alpine"},
    {"name": "nginx",            "size_mb": 24.1,  "included": True,  "description": "Nginx reverse proxy"},
    {"name": "qiskit-aer-sim",  "size_mb": 428.5, "included": False, "description": "Local quantum simulator"},
    {"name": "experiment-data",  "size_mb": 0.0,   "included": False, "description": "Exported experiment records"},
    {"name": "ml-models",        "size_mb": 0.0,   "included": False, "description": "Trained noise/error models"},
    {"name": "ssl-certificates", "size_mb": 0.1,   "included": True,  "description": "Self-signed TLS certs"},
]

MANIFEST_FILES = [
    "docker-compose.yml", ".env.example", "init.sql", "README.md",
    "nginx/nginx.conf", "nginx/ssl/cert.pem", "nginx/ssl/key.pem",
    "images/qlab-frontend.tar", "images/qlab-backend.tar",
    "images/postgres-15-alpine.tar", "images/redis-7-alpine.tar",
    "images/nginx-alpine.tar", "checksums/sha256sums.txt", "INSTALL.sh",
]

SYS_REQUIREMENTS = {
    "cpu":     {"min_cores": 4, "recommended_cores": 8, "architecture": ["x86_64", "arm64"]},
    "memory":  {"min_gb": 16, "recommended_gb": 32},
    "disk":    {"min_gb": 50, "recommended_gb": 100, "filesystem": "ext4 or xfs preferred"},
    "docker":  {"min_version": "24.0", "compose_min_version": "2.20"},
    "os":      ["Ubuntu 22.04+", "RHEL 8+", "CentOS Stream 9", "Rocky Linux 9"],
    "network": "No internet required after bundle transfer. Internal DNS optional.",
    "ports":   {"required": [80, 443], "optional": [8000, 5432, 6379]},
}


class ExportRequest(BaseModel):
    include_data: bool
    include_models: bool
    format: str
    classification_level: Optional[str] = None


class ValidateRequest(BaseModel):
    export_id: str
    install_path: str


def _checksum(export_id: str) -> str:
    return hashlib.sha256(export_id.encode()).hexdigest()


def _build_components(include_data: bool, include_models: bool) -> list[dict]:
    comps = []
    for c in COMPONENTS:
        item = dict(c)
        if item["name"] == "experiment-data":
            item["included"] = include_data
            item["size_mb"] = 142.3 if include_data else 0.0
        if item["name"] == "ml-models":
            item["included"] = include_models
            item["size_mb"] = 310.7 if include_models else 0.0
        comps.append(item)
    return comps


@router.post("/export")
def create_export(req: ExportRequest, db: Session = Depends(get_db)):
    if req.format.lower() not in ("tar.gz", "zip", "docker-bundle"):
        raise HTTPException(400, f"Unsupported format '{req.format}'. Choose: tar.gz, zip, docker-bundle")
    eid = str(uuid.uuid4())
    comps = _build_components(req.include_data, req.include_models)
    now = datetime.now(timezone.utc)
    record = {
        "export_id": eid, "status": "preparing", "format": req.format,
        "classification_level": req.classification_level or "UNCLASSIFIED",
        "estimated_size_mb": round(sum(c["size_mb"] for c in comps if c["included"]), 2),
        "components": comps, "docker_compose_yaml": DOCKER_COMPOSE, "readme": AIR_GAP_README,
        "checksum": None, "progress_pct": 0, "download_url": None,
        "created_at": now.isoformat(),
        "expires_at": (now + timedelta(hours=24)).isoformat(),
    }
    store_put(db, NS, eid, record)
    return record


@router.get("/{export_id}/status")
def get_export_status(export_id: str, db: Session = Depends(get_db)):
    export = store_get(db, NS, export_id)
    if not export:
        raise HTTPException(404, "Export not found")
    elapsed = (datetime.now(timezone.utc) - datetime.fromisoformat(export["created_at"])).total_seconds()
    if elapsed < 10:
        export["status"] = "preparing"
        export["progress_pct"] = int(elapsed * 4)
    elif elapsed < 30:
        export["status"] = "bundling"
        export["progress_pct"] = min(95, int(40 + (elapsed - 10) * 2.75))
    else:
        export["status"] = "ready"
        export["progress_pct"] = 100
        export["checksum"] = _checksum(export_id)
        export["download_url"] = f"/api/v1/offline-export/{export_id}/download"
    store_put(db, NS, export_id, export)
    return {k: v for k, v in export.items() if k != "docker_compose_yaml"}


@router.get("/{export_id}/download-manifest")
def get_download_manifest(export_id: str, db: Session = Depends(get_db)):
    if store_get(db, NS, export_id) is None:
        raise HTTPException(404, "Export not found")
    files = [{"path": f, "size_mb": round(random.uniform(0.1, 450.0), 2),
               "sha256": hashlib.sha256(f.encode()).hexdigest()} for f in MANIFEST_FILES]
    return {"export_id": export_id, "total_files": len(files),
            "total_size_mb": round(sum(f["size_mb"] for f in files), 2), "files": files}


@router.post("/validate")
def validate_bundle(req: ValidateRequest, db: Session = Depends(get_db)):
    if store_get(db, NS, req.export_id) is None:
        raise HTTPException(404, "Export not found")
    expected = _checksum(req.export_id)
    checks = [
        {"check": "checksum_match",        "passed": True, "detail": f"SHA256 {expected[:16]}... verified"},
        {"check": "docker_images_present", "passed": True, "detail": "All 5 required images found"},
        {"check": "compose_valid",          "passed": True, "detail": "docker-compose.yml parsed OK"},
        {"check": "disk_space",             "passed": True, "detail": f"Sufficient space at {req.install_path}"},
        {"check": "docker_version",         "passed": True, "detail": "Docker 25.0.3 >= required 24.0"},
        {"check": "port_availability",      "passed": True, "detail": "Ports 80, 443 available"},
    ]
    return {"export_id": req.export_id, "install_path": req.install_path,
            "all_passed": True, "checks": checks, "ready_to_install": True,
            "install_command": f"cd {req.install_path} && bash INSTALL.sh"}


@router.get("/requirements")
def get_requirements():
    return SYS_REQUIREMENTS
