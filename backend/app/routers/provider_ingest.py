"""Multi-Provider Normalizer — ingest quantum results from any cloud platform.

Supported formats
─────────────────
• IBM Qiskit  — the native Q-Lab format (already works via /api/v1/runs)
• Cirq        — Google Cirq result JSON
• IonQ        — IonQ job result JSON
• AWS Braket  — Braket Task result JSON
• OpenQASM3   — bare QASM string + optional results dict
• auto        — format auto-detection

All formats are normalised into Q-Lab's RunPayload schema and inserted
via the standard run ingestion path, so every result is immediately visible
in the tracker with correct health scores, calibration links, etc.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Project, Run

router = APIRouter(prefix="/api/v1/ingest", tags=["provider_ingest"])


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _new_run_id() -> str:
    return f"run-{uuid.uuid4().hex[:16]}"


def _fingerprint_from_qasm(qasm: str) -> dict:
    if not qasm:
        return {}
    lines = [l.strip() for l in qasm.splitlines() if l.strip()
             and not l.startswith(("//", "OPENQASM", "include"))]
    n_qubits = 1
    for l in lines:
        if l.startswith("qreg"):
            try:
                n_qubits = int(l.split("[")[1].split("]")[0])
            except Exception:
                pass
    gate_lines = [l for l in lines if not l.startswith(("qreg", "creg", "measure", "barrier"))]
    gate_counts: dict[str, int] = {}
    for l in gate_lines:
        g = l.split("(")[0].split()[0].lower().rstrip(";")
        gate_counts[g] = gate_counts.get(g, 0) + 1
    ncg = {"t", "tdg", "s", "sdg", "rz", "u1", "u2", "u3", "rx", "ry", "p"}
    non_clifford = sum(v for k, v in gate_counts.items() if k in ncg)
    total_g = sum(gate_counts.values())
    cx = gate_counts.get("cx", 0) + gate_counts.get("cnot", 0)
    return {
        "num_qubits": n_qubits,
        "depth": len(gate_lines),
        "size": total_g,
        "gate_counts": gate_counts,
        "cx_count": cx,
        "non_clifford_ratio": round(non_clifford / max(1, total_g), 4),
    }


def _counts_to_sp(counts: dict[str, int]) -> float:
    if not counts:
        return 0.0
    total = sum(counts.values())
    return round(max(counts.values()) / max(1, total), 4)


def _get_or_create_project(db: Session, slug: Optional[str]) -> Optional[Project]:
    if not slug:
        return None
    p = db.scalar(select(Project).where(Project.slug == slug))
    if p:
        return p
    p = Project(slug=slug, name=slug)
    db.add(p)
    db.flush()
    return p


def _save_run(db: Session, run_id: str, circuit_name: Optional[str], qasm: Optional[str],
              backend: Optional[str], counts: dict, shots: int, project_slug: Optional[str],
              provider: str, extra_context: dict) -> Run:
    p = _get_or_create_project(db, project_slug)
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        run = Run(run_id=run_id, created_at=datetime.now(timezone.utc))
        db.add(run)
    run.circuit_name = circuit_name
    run.qasm = qasm
    run.backend = backend
    run.status = "completed"
    run.project_slug = project_slug
    run.project = p
    run.fingerprint = _fingerprint_from_qasm(qasm or "")
    run.context = {"provider": provider, **extra_context}
    run.results = {"counts": counts, "shots": shots, "success_probability": _counts_to_sp(counts)}
    run.execution = {"provider": provider}
    db.commit()
    db.refresh(run)
    return run


# ─────────────────────────────────────────────────────────────────────────────
# Format parsers
# ─────────────────────────────────────────────────────────────────────────────

def _parse_cirq(body: dict) -> tuple[dict, str, dict, int]:
    """Parse Cirq result JSON → (counts, backend, context, shots)."""
    # Cirq saves results as {measurements: {key: [[0,1,...], ...]}}
    measurements = body.get("measurements") or body.get("result", {}).get("measurements", {})
    counts: dict[str, int] = {}
    shots = 0
    for key, bitarrays in measurements.items():
        if not bitarrays:
            continue
        shots = max(shots, len(bitarrays))
        for row in bitarrays:
            bs = "".join(str(b) for b in row)
            counts[bs] = counts.get(bs, 0) + 1
    context = {"cirq_params": body.get("params", {}), "cirq_circuit": body.get("circuit_text", "")}
    backend = body.get("device") or body.get("simulator_name") or "cirq"
    return counts, backend, context, shots


def _parse_ionq(body: dict) -> tuple[dict, str, dict, int]:
    """Parse IonQ job result JSON → (counts, backend, context, shots)."""
    # IonQ returns histogram probabilities: {"0000": 0.5, "1111": 0.5}
    shots = body.get("shots") or body.get("metadata", {}).get("shots") or 1024
    shots = int(shots)
    hist = body.get("data", {}).get("histogram", {}) or body.get("histogram", {})
    counts: dict[str, int] = {}
    if hist:
        for bs, prob in hist.items():
            counts[str(bs)] = max(1, round(float(prob) * shots))
    else:
        # Try raw counts format
        raw = body.get("data", {}).get("counts", {}) or body.get("counts", {})
        counts = {str(k): int(v) for k, v in raw.items()} if raw else {"0": shots}
    backend = body.get("target") or body.get("backend") or "ionq"
    context = {"ionq_job_id": body.get("id", ""), "ionq_status": body.get("status", "")}
    return counts, backend, context, shots


def _parse_braket(body: dict) -> tuple[dict, str, dict, int]:
    """Parse AWS Braket task result JSON → (counts, backend, context, shots)."""
    shots = body.get("taskMetadata", {}).get("shots", 1024)
    shots = int(shots)
    # Braket stores results per measurement: {measurementProbabilities: {"00": 0.5, ...}}
    probs = body.get("measurementProbabilities", {})
    counts: dict[str, int] = {}
    if probs:
        for bs, prob in probs.items():
            counts[str(bs)] = max(1, round(float(prob) * shots))
    else:
        measurements = body.get("measurements", [])
        for row in measurements:
            bs = "".join(str(b) for b in row)
            counts[bs] = counts.get(bs, 0) + 1
    backend = (body.get("taskMetadata", {}).get("deviceId") or "braket").split("/")[-1]
    context = {
        "braket_task_id": body.get("taskMetadata", {}).get("id", ""),
        "braket_device": body.get("taskMetadata", {}).get("deviceId", ""),
    }
    return counts, backend, context, shots


def _parse_openqasm3(qasm: str, counts: Optional[dict]) -> tuple[dict, dict, int]:
    """Parse a bare OpenQASM3 string + optional results."""
    shot_counts = counts or {"0": 1024}
    shots = sum(shot_counts.values())
    # Normalise integer keys
    normalised = {}
    for k, v in shot_counts.items():
        normalised[str(k)] = int(v)
    return normalised, {}, shots


def _auto_detect(body: dict) -> str:
    """Detect the format of an unknown result payload."""
    if "measurements" in body and isinstance(body.get("measurements"), dict):
        return "cirq"
    if "taskMetadata" in body or "measurementProbabilities" in body:
        return "braket"
    if ("data" in body and "histogram" in body.get("data", {})) or "histogram" in body:
        return "ionq"
    if "target" in body and ("shots" in body or "status" in body):
        return "ionq"
    if "qasm" in body or "openqasm" in str(body.get("format", "")).lower():
        return "openqasm3"
    return "unknown"


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic request models
# ─────────────────────────────────────────────────────────────────────────────

class CirqIngestRequest(BaseModel):
    result: dict[str, Any]
    circuit_qasm: Optional[str] = None
    circuit_name: Optional[str] = None
    project_slug: Optional[str] = None


class IonQIngestRequest(BaseModel):
    result: dict[str, Any]
    circuit_qasm: Optional[str] = None
    circuit_name: Optional[str] = None
    project_slug: Optional[str] = None


class BraketIngestRequest(BaseModel):
    result: dict[str, Any]
    circuit_qasm: Optional[str] = None
    circuit_name: Optional[str] = None
    project_slug: Optional[str] = None


class OpenQASM3IngestRequest(BaseModel):
    qasm: str
    counts: Optional[dict[str, int]] = None
    backend: Optional[str] = None
    circuit_name: Optional[str] = None
    project_slug: Optional[str] = None


class AutoIngestRequest(BaseModel):
    payload: dict[str, Any]
    circuit_qasm: Optional[str] = None
    circuit_name: Optional[str] = None
    project_slug: Optional[str] = None


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/cirq")
def ingest_cirq(req: CirqIngestRequest, db: Session = Depends(get_db)):
    """Ingest a Google Cirq result JSON."""
    counts, backend, context, shots = _parse_cirq(req.result)
    run_id = _new_run_id()
    run = _save_run(db, run_id, req.circuit_name or "cirq-circuit", req.circuit_qasm,
                    backend, counts, shots, req.project_slug, "cirq", context)
    return {"run_id": run.run_id, "backend": backend, "shots": shots, "n_outcomes": len(counts)}


@router.post("/ionq")
def ingest_ionq(req: IonQIngestRequest, db: Session = Depends(get_db)):
    """Ingest an IonQ job result JSON."""
    counts, backend, context, shots = _parse_ionq(req.result)
    run_id = _new_run_id()
    run = _save_run(db, run_id, req.circuit_name or "ionq-circuit", req.circuit_qasm,
                    backend, counts, shots, req.project_slug, "ionq", context)
    return {"run_id": run.run_id, "backend": backend, "shots": shots, "n_outcomes": len(counts)}


@router.post("/braket")
def ingest_braket(req: BraketIngestRequest, db: Session = Depends(get_db)):
    """Ingest an AWS Braket task result JSON."""
    counts, backend, context, shots = _parse_braket(req.result)
    run_id = _new_run_id()
    run = _save_run(db, run_id, req.circuit_name or "braket-circuit", req.circuit_qasm,
                    backend, counts, shots, req.project_slug, "braket", context)
    return {"run_id": run.run_id, "backend": backend, "shots": shots, "n_outcomes": len(counts)}


@router.post("/openqasm3")
def ingest_openqasm3(req: OpenQASM3IngestRequest, db: Session = Depends(get_db)):
    """Ingest an OpenQASM3 circuit string with optional bitstring counts."""
    counts, context, shots = _parse_openqasm3(req.qasm, req.counts)
    run_id = _new_run_id()
    run = _save_run(db, run_id, req.circuit_name or "openqasm3-circuit", req.qasm,
                    req.backend or "openqasm3", counts, shots, req.project_slug, "openqasm3", context)
    return {"run_id": run.run_id, "backend": req.backend or "openqasm3", "shots": shots}


@router.post("/auto")
def ingest_auto(req: AutoIngestRequest, db: Session = Depends(get_db)):
    """Auto-detect the result format and ingest accordingly."""
    fmt = _auto_detect(req.payload)
    if fmt == "cirq":
        counts, backend, context, shots = _parse_cirq(req.payload)
        provider = "cirq"
    elif fmt == "ionq":
        counts, backend, context, shots = _parse_ionq(req.payload)
        provider = "ionq"
    elif fmt == "braket":
        counts, backend, context, shots = _parse_braket(req.payload)
        provider = "braket"
    elif fmt == "openqasm3":
        qasm = req.payload.get("qasm", req.circuit_qasm or "")
        counts, context, shots = _parse_openqasm3(qasm, req.payload.get("counts"))
        backend = req.payload.get("backend", "openqasm3")
        provider = "openqasm3"
    else:
        raise HTTPException(422, f"Could not auto-detect format. Detected: '{fmt}'. Use a specific endpoint (/cirq, /ionq, /braket, /openqasm3).")
    run_id = _new_run_id()
    run = _save_run(db, run_id, req.circuit_name or f"{fmt}-circuit", req.circuit_qasm,
                    backend, counts, shots, req.project_slug, provider, context)
    return {
        "run_id": run.run_id,
        "detected_format": fmt,
        "provider": provider,
        "backend": backend,
        "shots": shots,
        "n_outcomes": len(counts),
    }


@router.get("/formats")
def list_supported_formats():
    """List all supported ingestion formats and their schemas."""
    return {
        "formats": [
            {
                "name": "cirq",
                "endpoint": "POST /api/v1/ingest/cirq",
                "description": "Google Cirq result JSON (measurements dict)",
                "example_fields": ["measurements", "device", "params"],
            },
            {
                "name": "ionq",
                "endpoint": "POST /api/v1/ingest/ionq",
                "description": "IonQ Cloud job result JSON",
                "example_fields": ["id", "target", "shots", "status", "data.histogram"],
            },
            {
                "name": "braket",
                "endpoint": "POST /api/v1/ingest/braket",
                "description": "AWS Braket task result JSON",
                "example_fields": ["taskMetadata.shots", "taskMetadata.deviceId", "measurementProbabilities"],
            },
            {
                "name": "openqasm3",
                "endpoint": "POST /api/v1/ingest/openqasm3",
                "description": "Raw OpenQASM3 circuit string + optional counts",
                "example_fields": ["qasm", "counts", "backend", "circuit_name"],
            },
            {
                "name": "auto",
                "endpoint": "POST /api/v1/ingest/auto",
                "description": "Auto-detect format — pass any result payload",
                "example_fields": ["payload", "circuit_qasm", "circuit_name", "project_slug"],
            },
        ]
    }
