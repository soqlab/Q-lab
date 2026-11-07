"""Quantum Key Distribution Protocol Simulator.

Simulates QKD protocols (BB84, E91, B92, Six-State, SARG04) using pure Python.
Models QBER, eavesdropper detection, key rates, and security verdicts.
No real quantum hardware — all outcomes are probabilistic simulation.
"""

from __future__ import annotations

import math
import random
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/protocol-sim", tags=["protocol_sim"])

# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

class ProtocolSimRequest(BaseModel):
    protocol: str = Field("bb84", description="QKD protocol name")
    n_bits: int = Field(1000, ge=10, le=100_000)
    channel_error_rate: float = Field(0.03, ge=0.0, le=0.5)
    eavesdropper: bool = False
    eavesdrop_fraction: float = Field(0.5, ge=0.0, le=1.0)
    seed: Optional[int] = None


# ---------------------------------------------------------------------------
# Constants / configuration
# ---------------------------------------------------------------------------

_PROTOCOLS: Dict[str, Dict[str, Any]] = {
    "bb84": {
        "name": "BB84",
        "full_name": "Bennett-Brassard 1984",
        "n_bases": 2,
        "sift_fraction": 0.5,
        "qber_threshold": 0.11,
        "description": "First QKD protocol; two conjugate bases (Z and X); intercept-resend detection via QBER.",
    },
    "e91": {
        "name": "E91",
        "full_name": "Ekert 1991",
        "n_bases": 3,
        "sift_fraction": 2 / 9,  # matching angles 22.5 or 45 out of 3 x 3
        "qber_threshold": 0.11,
        "description": "Entanglement-based; uses CHSH Bell inequality violation to detect eavesdroppers.",
    },
}

_BASES = ["Z", "X"]


def _binary_entropy(p: float) -> float:
    """H(p) = -p log2(p) - (1-p) log2(1-p)."""
    if p <= 0 or p >= 1:
        return 0.0
    return -p * math.log2(p) - (1 - p) * math.log2(1 - p)


# ---------------------------------------------------------------------------
# BB84 simulation
# ---------------------------------------------------------------------------

def _simulate_bb84(
    n_bits: int,
    channel_error_rate: float,
    eavesdropper: bool,
    eavesdrop_fraction: float,
    rng: random.Random,
    proto_cfg: Dict[str, Any],
) -> Dict[str, Any]:
    """Full BB84 simulation: generate bits/bases, apply channel + Eve, sift, measure QBER."""

    # Alice generates random bits and bases
    alice_bits  = [rng.randint(0, 1) for _ in range(n_bits)]
    alice_bases = [rng.choice(_BASES) for _ in range(n_bits)]

    # Eavesdropper: intercept-resend on eavesdrop_fraction of bits
    eve_bases: List[Optional[str]] = [None] * n_bits
    if eavesdropper:
        for i in range(n_bits):
            if rng.random() < eavesdrop_fraction:
                eve_bases[i] = rng.choice(_BASES)

    # Bob's random bases
    bob_bases = [rng.choice(_BASES) for _ in range(n_bits)]

    # Bob's measurement
    bob_bits: List[int] = []
    for i in range(n_bits):
        if bob_bases[i] == alice_bases[i]:
            # Correct basis: receive Alice's bit (possibly perturbed by Eve + channel)
            bit = alice_bits[i]
            # Eve measured in the other basis and resent: Bob's result is random.
            if eve_bases[i] is not None and eve_bases[i] != alice_bases[i]:
                bit = rng.randint(0, 1)
            # Apply channel error
            if rng.random() < channel_error_rate:
                bit = 1 - bit
            bob_bits.append(bit)
        else:
            # Wrong basis → random outcome
            bob_bits.append(rng.randint(0, 1))

    # Sifting: keep only matching bases
    sifted_alice: List[int] = []
    sifted_bob:   List[int] = []
    sifted_alice_bases: List[str] = []
    sifted_bob_bases:   List[str] = []

    for i in range(n_bits):
        if alice_bases[i] == bob_bases[i]:
            sifted_alice.append(alice_bits[i])
            sifted_bob.append(bob_bits[i])
            sifted_alice_bases.append(alice_bases[i])
            sifted_bob_bases.append(bob_bases[i])

    n_sifted = len(sifted_alice)

    # QBER on a sample of sifted bits
    sample_size = max(1, min(n_sifted // 4, 200))
    sample_indices = rng.sample(range(n_sifted), min(sample_size, n_sifted))
    errors = sum(1 for i in sample_indices if sifted_alice[i] != sifted_bob[i])
    qber = errors / max(len(sample_indices), 1)

    # Remove sample bits from key
    sample_set = set(sample_indices)
    raw_key_alice = [sifted_alice[i] for i in range(n_sifted) if i not in sample_set]
    n_raw = len(raw_key_alice)

    # Error correction (Cascade-like): removes ~H(QBER) fraction of bits
    h_qber = _binary_entropy(qber)
    error_correction_bits = int(h_qber * n_raw)
    n_after_ec = max(0, n_raw - error_correction_bits)

    # Privacy amplification from the measured QBER alone (Shor-Preskill: r = 1 - 2 h(Q)); Alice and
    # Bob do not know whether Eve was there.
    privacy_amp_bits = int(h_qber * n_raw)
    n_secret = max(0, n_after_ec - privacy_amp_bits)

    # Basis reconciliation sample (first 10)
    reconciliation = []
    for i in range(min(10, n_bits)):
        reconciliation.append({
            "alice_basis": alice_bases[i],
            "bob_basis":   bob_bases[i],
            "match":       alice_bases[i] == bob_bases[i],
            "alice_bit":   alice_bits[i],
            "bob_bit":     bob_bits[i],
        })

    return {
        "n_sifted_bits": n_sifted,
        "n_secret_bits": n_secret,
        "qber": round(qber, 4),
        "error_correction_bits": error_correction_bits,
        "privacy_amplification_bits": privacy_amp_bits,
        "basis_reconciliation": reconciliation,
        "raw_key_rate": round(n_sifted / n_bits, 4),
    }


# ---------------------------------------------------------------------------
# E91 simulation (entanglement-based + CHSH)
# ---------------------------------------------------------------------------

def _simulate_e91(
    n_bits: int,
    channel_error_rate: float,
    eavesdropper: bool,
    eavesdrop_fraction: float,
    rng: random.Random,
    proto_cfg: Dict[str, Any],
) -> Dict[str, Any]:
    """E91 with polarisation-entangled pairs, simulated pair by pair.

    Pairs are in the state whose correlation is E(a, b) = -cos(2(a - b)) for analyser angles a, b.
    Alice measures at 0, 22.5 or 45 degrees, Bob at 22.5, 45 or 67.5. Matching angles (22.5, 45) give
    the key; the CHSH value S = |E(0,22.5) - E(0,67.5) + E(45,22.5) + E(45,67.5)| is estimated from the
    sampled outcomes (2*sqrt(2) for perfect pairs, at most 2 without entanglement). An intercepted
    pair is measured by Eve at a random angle from Alice's set, which leaves the two photons in a
    product state with correlation -cos(2(a - e)) cos(2(b - e)). Channel noise flips Bob's bit.
    """
    alice_set, bob_set = [0.0, 22.5, 45.0], [22.5, 45.0, 67.5]
    alice_bits: List[int] = []
    bob_bits: List[int] = []
    alice_angles: List[float] = []
    bob_angles: List[float] = []
    sums: Dict[tuple, List[int]] = {}
    for _ in range(n_bits):
        a, b = rng.choice(alice_set), rng.choice(bob_set)
        if eavesdropper and rng.random() < eavesdrop_fraction:
            e = rng.choice(alice_set)
            corr = -math.cos(math.radians(2 * (a - e))) * math.cos(math.radians(2 * (b - e)))
        else:
            corr = -math.cos(math.radians(2 * (a - b)))
        a_bit = rng.randint(0, 1)
        b_bit = a_bit if rng.random() < (1 + corr) / 2 else 1 - a_bit
        if rng.random() < channel_error_rate:
            b_bit = 1 - b_bit
        alice_bits.append(a_bit)
        bob_bits.append(b_bit)
        alice_angles.append(a)
        bob_angles.append(b)
        acc = sums.setdefault((a, b), [0, 0])
        acc[0] += (1 - 2 * a_bit) * (1 - 2 * b_bit)
        acc[1] += 1

    def E(a: float, b: float) -> float:
        total, count = sums.get((a, b), [0, 0])
        return total / count if count else 0.0

    chsh_s = abs(E(0.0, 22.5) - E(0.0, 67.5) + E(45.0, 22.5) + E(45.0, 67.5))

    # Key: matching angles; the singlet is anti-correlated, so Bob flips his bit.
    key = [(alice_bits[i], 1 - bob_bits[i]) for i in range(n_bits) if alice_angles[i] == bob_angles[i]]
    n_sifted = len(key)
    sample_n = max(1, min(n_sifted // 4, 200))
    sidxs = rng.sample(range(n_sifted), min(sample_n, n_sifted))
    qber = sum(1 for i in sidxs if key[i][0] != key[i][1]) / max(len(sidxs), 1)
    h_qber = _binary_entropy(qber)
    n_raw = n_sifted - len(sidxs)
    ec_bits = int(h_qber * n_raw)
    pa_bits = int(h_qber * n_raw)
    n_secret = max(0, n_raw - ec_bits - pa_bits)

    reconciliation = [
        {"alice_basis": f"{alice_angles[i]:g}°", "bob_basis": f"{bob_angles[i]:g}°",
         "match": alice_angles[i] == bob_angles[i], "alice_bit": alice_bits[i], "bob_bit": bob_bits[i]}
        for i in range(min(10, n_bits))
    ]
    return {
        "n_sifted_bits": n_sifted,
        "n_secret_bits": n_secret,
        "qber": round(qber, 4),
        "chsh_s": round(chsh_s, 4),
        "error_correction_bits": ec_bits,
        "privacy_amplification_bits": pa_bits,
        "basis_reconciliation": reconciliation,
        "raw_key_rate": round(n_sifted / n_bits, 4),
    }


def _security_verdict(qber: float, qber_threshold: float, channel_error_rate: float,
                      chsh_s: float, protocol: str) -> Dict[str, Any]:
    """Judged from what Alice and Bob measure (QBER, CHSH), never from whether Eve was simulated."""
    qber_ok = qber <= qber_threshold

    if protocol == "e91":
        bell_violated = chsh_s > 2.0
        eve_detected = not bell_violated or not qber_ok
    else:
        bell_violated = False
        eve_detected = not qber_ok

    if not eve_detected and qber_ok:
        verdict = "SECURE"
        level = "high"
    elif qber <= qber_threshold * 1.3:
        verdict = "MARGINAL"
        level = "medium"
    else:
        verdict = "INSECURE"
        level = "low"

    # BB84 intercept-resend: QBER = e + f (1 - 2e) / 4 for channel error e and intercepted fraction f.
    eve_frac_est = None
    if protocol == "bb84" and channel_error_rate < 0.5:
        eve_frac_est = min(1.0, max(0.0, (qber - channel_error_rate) * 4 / (1 - 2 * channel_error_rate)))

    return {
        "eavesdropper_detected": eve_detected,
        "eavesdrop_fraction_estimate": None if eve_frac_est is None else round(eve_frac_est, 3),
        "bell_inequality_violated": bell_violated,
        "security_verdict": verdict,
        "security_level": level,
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("")
def simulate_protocol(req: ProtocolSimRequest) -> Dict[str, Any]:
    proto_key = req.protocol.lower()
    if proto_key not in _PROTOCOLS:
        from fastapi import HTTPException

        raise HTTPException(422, f"protocol must be one of {sorted(_PROTOCOLS)}")
    proto_cfg = _PROTOCOLS[proto_key]

    rng = random.Random(req.seed)

    if proto_key == "bb84":
        result = _simulate_bb84(req.n_bits, req.channel_error_rate,
                                req.eavesdropper, req.eavesdrop_fraction, rng, proto_cfg)
    else:
        result = _simulate_e91(req.n_bits, req.channel_error_rate,
                               req.eavesdropper, req.eavesdrop_fraction, rng, proto_cfg)

    qber = result["qber"]
    qber_threshold = proto_cfg["qber_threshold"]
    chsh_s = result.get("chsh_s", 0.0)

    security = _security_verdict(qber, qber_threshold, req.channel_error_rate, chsh_s, proto_key)

    n_sifted = result["n_sifted_bits"]
    n_secret = result["n_secret_bits"]

    # Key rates
    raw_key_rate   = result["raw_key_rate"]
    h_qber         = _binary_entropy(qber)
    secret_rate    = max(0.0, (1 - 2 * h_qber) * raw_key_rate)  # Shor-Preskill
    efficiency     = round(n_secret / max(req.n_bits, 1), 4)

    return {
        "sim_id": str(uuid.uuid4()),
        "protocol_name": proto_cfg["name"],
        "n_bits_sent": req.n_bits,
        "n_sifted_bits": n_sifted,
        "n_secret_bits": n_secret,
        "qber": qber,
        "qber_threshold": qber_threshold,
        "qber_acceptable": qber <= qber_threshold,
        "eavesdropper_detected": security["eavesdropper_detected"],
        "eavesdrop_fraction_estimate": security["eavesdrop_fraction_estimate"],
        "chsh_s_value": round(chsh_s, 4),
        "bell_inequality_violated": security["bell_inequality_violated"],
        "raw_key_rate": raw_key_rate,
        "secret_key_rate": round(secret_rate, 4),
        "protocol_efficiency": efficiency,
        "privacy_amplification_bits": result["privacy_amplification_bits"],
        "error_correction_bits": result["error_correction_bits"],
        "basis_reconciliation": result["basis_reconciliation"],
        "security_verdict": security["security_verdict"],
        "security_level": security["security_level"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/protocols")
def list_protocols() -> Dict[str, Any]:
    return {
        "protocols": [
            {
                "key": key,
                "name": cfg["name"],
                "full_name": cfg["full_name"],
                "description": cfg["description"],
                "n_bases": cfg["n_bases"],
                "sift_fraction": cfg["sift_fraction"],
                "qber_threshold": cfg["qber_threshold"],
            }
            for key, cfg in _PROTOCOLS.items()
        ]
    }
