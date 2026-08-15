"""Quantum-Certified Random Number Generator.

Generates random bits from quantum measurement of Bell states.
Verifies quantum origin using the CHSH inequality:
  S = |E(a,b) - E(a,b') + E(a',b) + E(a',b')| > 2 (classical bound)
  Quantum maximum: S = 2√2 ≈ 2.828

A CHSH value > 2 certifies that the randomness is quantum in origin
and cannot be reproduced by any classical (local hidden variable) model.
"""
from __future__ import annotations

import hashlib
import math
import random
import struct
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import QRNGResult

router = APIRouter(prefix="/api/v1/qrng", tags=["quantum_rng"])


def _measure_bell_pair(theta_a: float, theta_b: float, rng: random.Random) -> tuple[int, int]:
    """Simulate measurement of |Φ+⟩ = (|00⟩ + |11⟩)/√2 in rotated bases."""
    # Joint probability: P(++) = P(--) = cos²((θ_a - θ_b)/2) / 2
    p_same = math.cos((theta_a - theta_b) / 2) ** 2
    same = rng.random() < p_same
    a_out = rng.randint(0, 1)
    b_out = a_out if same else 1 - a_out
    return a_out, b_out


def _correlation(theta_a: float, theta_b: float, n_shots: int, rng: random.Random) -> float:
    """E(a, b) = P(same outcome) - P(different outcome)."""
    same = 0
    for _ in range(n_shots):
        pair = _measure_bell_pair(theta_a, theta_b, rng)
        if pair[0] == pair[1]:
            same += 1
    return (2 * same - n_shots) / n_shots


def _compute_chsh(n_shots: int, rng: random.Random) -> float:
    """CHSH angles: a=0, a'=π/4, b=π/8, b'=3π/8 (optimal for Bell violation)."""
    a, ap = 0.0, math.pi / 4
    b, bp = math.pi / 8, 3 * math.pi / 8
    e_ab = _correlation(a, b, n_shots, rng)
    e_abp = _correlation(a, bp, n_shots, rng)
    e_apb = _correlation(ap, b, n_shots, rng)
    e_apbp = _correlation(ap, bp, n_shots, rng)
    S = abs(e_ab - e_abp + e_apb + e_apbp)
    return round(S, 4)


def _generate_quantum_bits(n_bits: int, rng: random.Random) -> list[int]:
    """Generate random bits from Bell state measurements in computational basis."""
    bits: list[int] = []
    while len(bits) < n_bits:
        # Measure |Φ+⟩ in Z basis: both qubits always equal, gives 1 bit per pair
        a, _ = _measure_bell_pair(0, 0, rng)
        bits.append(a)
    return bits[:n_bits]


def _randomness_tests(bits: list[int]) -> dict[str, Any]:
    """Basic NIST SP 800-22 inspired tests."""
    n = len(bits)
    if n == 0:
        return {}
    # Frequency test (monobit)
    ones = sum(bits)
    freq_score = abs(ones / n - 0.5)
    freq_pass = freq_score < 0.05

    # Runs test
    runs = 1 + sum(1 for i in range(1, n) if bits[i] != bits[i - 1])
    expected_runs = (2 * ones * (n - ones) / n) + 1 if n > 1 else 1
    runs_pass = abs(runs - expected_runs) < math.sqrt(expected_runs * 2)

    # Block frequency (block size 8)
    block_size = 8
    n_blocks = n // block_size
    block_proportions = []
    for i in range(n_blocks):
        block = bits[i * block_size:(i + 1) * block_size]
        block_proportions.append(sum(block) / block_size)
    block_var = sum((p - 0.5) ** 2 for p in block_proportions) / max(n_blocks, 1)
    block_pass = block_var < 0.1

    return {
        "frequency_test": {"ones_ratio": round(ones / n, 4), "bias": round(freq_score, 4), "pass": freq_pass},
        "runs_test": {"runs": runs, "expected_runs": round(expected_runs, 1), "pass": runs_pass},
        "block_frequency_test": {"n_blocks": n_blocks, "variance": round(block_var, 4), "pass": block_pass},
        "overall_pass": freq_pass and runs_pass and block_pass,
    }


class QRNGRequest(BaseModel):
    n_bits: int = Field(default=256, ge=8, le=8192)
    n_chsh_shots: int = Field(default=200, ge=50, le=2000, description="Shots per CHSH correlation measurement")
    seed: Optional[int] = None





@router.post("")
def generate_random(req: QRNGRequest, db: Session = Depends(get_db)):
    rng = random.Random(req.seed)  # In production, this would be a true QRNG; here we use a seeded RNG for reproducibility

    # Generate quantum random bits
    bits = _generate_quantum_bits(req.n_bits, rng)

    # CHSH certification
    chsh_rng = random.Random(req.seed if req.seed is not None else rng.randint(0, 2 ** 31))
    chsh_value = _compute_chsh(req.n_chsh_shots, chsh_rng)
    # Always False — this is a classical PRNG simulation, not a real quantum device.
    is_certified = False

    # Convert bits to hex
    bit_str = "".join(str(b) for b in bits)
    # Pad to multiple of 8
    padded = bit_str.ljust((len(bit_str) + 7) // 8 * 8, "0")
    byte_values = [int(padded[i:i+8], 2) for i in range(0, len(padded), 8)]
    hex_output = bytes(byte_values).hex()

    # Randomness tests
    tests = _randomness_tests(bits)

    result_id = f"qrng-{uuid.uuid4().hex[:12]}"
    record = QRNGResult(
        result_id=result_id, n_bits=req.n_bits, hex_output=hex_output,
        chsh_value=chsh_value, is_quantum_certified=is_certified,
    )
    db.add(record); db.commit(); db.refresh(record)

    return {
        "result_id": result_id, "n_bits": req.n_bits,
        "hex_output": hex_output,
        "first_32_bits": bit_str[:32] + ("..." if len(bit_str) > 32 else ""),
        "chsh_value": chsh_value,
        "classical_bound": 2.0, "quantum_bound": round(2 * math.sqrt(2), 4),
        "is_quantum_certified": False,
        "certification_message": "Quantum statistics simulated classically — not from real quantum hardware",
        "randomness_tests": tests,
        "created_at": record.created_at.isoformat(),
    }


@router.get("")
def list_qrng_results(limit: int = 50, db: Session = Depends(get_db)):
    rows = db.scalars(select(QRNGResult).order_by(QRNGResult.created_at.desc()).limit(limit)).all()
    return [{"result_id": r.result_id, "n_bits": r.n_bits, "chsh_value": r.chsh_value,
             "is_quantum_certified": r.is_quantum_certified, "created_at": r.created_at.isoformat()} for r in rows]


@router.get("/{result_id}")
def get_qrng_result(result_id: str, db: Session = Depends(get_db)):
    r = db.scalar(select(QRNGResult).where(QRNGResult.result_id == result_id))
    if r is None:
        raise HTTPException(404, "Not found")
    return {"result_id": r.result_id, "n_bits": r.n_bits, "hex_output": r.hex_output,
            "chsh_value": r.chsh_value, "is_quantum_certified": r.is_quantum_certified,
            "created_at": r.created_at.isoformat()}
