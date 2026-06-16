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
        "sift_fraction": 0.25,
        "qber_threshold": 0.11,
        "description": "Entanglement-based; uses CHSH Bell inequality violation to detect eavesdroppers.",
    },
    "b92": {
        "name": "B92",
        "full_name": "Bennett 1992",
        "n_bases": 1,
        "sift_fraction": 0.25,
        "qber_threshold": 0.09,
        "description": "Two non-orthogonal states; simpler but lower efficiency than BB84.",
    },
    "six_state": {
        "name": "Six-State",
        "full_name": "Six-State Protocol",
        "n_bases": 3,
        "sift_fraction": 1 / 3,
        "qber_threshold": 0.126,
        "description": "Three MUBs; higher security margin; QBER threshold slightly above BB84.",
    },
    "sarg04": {
        "name": "SARG04",
        "full_name": "Scarani-Acín-Ribordy-Gisin 2004",
        "n_bases": 2,
        "sift_fraction": 0.5,
        "qber_threshold": 0.095,
        "description": "More resistant to PNS attacks than BB84; announces two non-orthogonal states.",
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
    eve_bits: List[Optional[int]] = [None] * n_bits
    if eavesdropper:
        for i in range(n_bits):
            if rng.random() < eavesdrop_fraction:
                eve_base = rng.choice(_BASES)
                if eve_base == alice_bases[i]:
                    eve_bits[i] = alice_bits[i]
                else:
                    eve_bits[i] = rng.randint(0, 1)

    # Bob's random bases
    bob_bases = [rng.choice(_BASES) for _ in range(n_bits)]

    # Bob's measurement
    bob_bits: List[int] = []
    for i in range(n_bits):
        if bob_bases[i] == alice_bases[i]:
            # Correct basis: receive Alice's bit (possibly perturbed by Eve + channel)
            bit = alice_bits[i]
            # Apply eavesdropper disturbance
            if eavesdropper and eve_bits[i] is not None and eve_bits[i] != alice_bits[i]:
                # Eve measured wrong base — introduces 50% error rate for these bits
                if rng.random() < 0.5:
                    bit = 1 - bit
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

    # Privacy amplification: removes ~leaked info to Eve
    eve_info = 0.0
    if eavesdropper:
        # Holevo bound approximation for intercept-resend
        eve_info = eavesdrop_fraction * 0.5  # fraction Eve gets right
    privacy_amp_bits = int(eve_info * n_after_ec)
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
    """E91: entangled pairs + CHSH inequality for eavesdropper detection."""

    # Alice chooses from {0°, 45°, 90°}, Bob from {45°, 90°, 135°}
    alice_angles = [rng.choice([0, 45, 90]) for _ in range(n_bits)]
    bob_angles   = [rng.choice([45, 90, 135]) for _ in range(n_bits)]

    # For matched angles (45° or 90°), pairs are anti-correlated (perfect singlet)
    # For CHSH: compute S statistic over non-matching angle pairs
    alice_bits: List[int] = []
    bob_bits:   List[int] = []
    chsh_samples: List[float] = []

    for i in range(n_bits):
        aa, ba = alice_angles[i], bob_angles[i]
        theta = abs(aa - ba) % 180
        # QM correlation: E(a,b) = -cos(2*(a-b)*pi/180)
        corr = -math.cos(2 * (aa - ba) * math.pi / 180)
        # Sample outcomes consistent with correlation
        a_bit = rng.randint(0, 1)
        # b_bit correlated with a_bit via corr
        prob_same = (1 + corr) / 2
        b_bit = a_bit if rng.random() < prob_same else 1 - a_bit

        # Channel errors
        if rng.random() < channel_error_rate:
            b_bit = 1 - b_bit

        alice_bits.append(a_bit)
        bob_bits.append(b_bit)

        # CHSH: only for specific angle combinations (for E computation)
        if (aa, ba) in [(0, 45), (0, 135), (90, 45), (90, 135)]:
            pm_a = 1 - 2 * a_bit
            pm_b = 1 - 2 * b_bit
            chsh_samples.append(pm_a * pm_b * corr)

    # Sifting: only matching angle (45° or 90°)
    sifted_alice = [alice_bits[i] for i in range(n_bits) if alice_angles[i] == bob_angles[i]]
    sifted_bob   = [bob_bits[i]   for i in range(n_bits) if alice_angles[i] == bob_angles[i]]
    n_sifted = len(sifted_alice)

    # QBER
    sample_n = max(1, min(n_sifted // 4, 200))
    sidxs = rng.sample(range(n_sifted), min(sample_n, n_sifted))
    errors = sum(1 for i in sidxs if sifted_alice[i] != sifted_bob[i])
    qber = errors / max(len(sidxs), 1)

    # CHSH S value: ideal = 2√2 ≈ 2.828; Eve degrades it toward 2
    s_ideal = 2 * math.sqrt(2)
    eve_deg = eavesdrop_fraction * 0.6 if eavesdropper else 0.0
    chsh_s = s_ideal - eve_deg - channel_error_rate * 2 + rng.gauss(0, 0.04)
    chsh_s = max(0.0, min(s_ideal, chsh_s))

    # Secret key
    h_qber = _binary_entropy(qber)
    n_raw = n_sifted - max(1, n_sifted // 4)  # remove CHSH test bits
    ec_bits = int(h_qber * n_raw)
    pa_bits = int((eavesdrop_fraction * 0.5 if eavesdropper else 0.0) * n_raw)
    n_secret = max(0, n_raw - ec_bits - pa_bits)

    reconciliation = [
        {
            "alice_basis": f"{alice_angles[i]}°",
            "bob_basis":   f"{bob_angles[i]}°",
            "match":       alice_angles[i] == bob_angles[i],
            "alice_bit":   alice_bits[i],
            "bob_bit":     bob_bits[i],
        }
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


# ---------------------------------------------------------------------------
# Generic protocol simulation (B92, Six-State, SARG04)
# ---------------------------------------------------------------------------

def _simulate_generic(
    n_bits: int,
    channel_error_rate: float,
    eavesdropper: bool,
    eavesdrop_fraction: float,
    rng: random.Random,
    proto_cfg: Dict[str, Any],
) -> Dict[str, Any]:
    """Generic QKD simulation for B92, Six-State, SARG04."""
    sift_frac = proto_cfg["sift_fraction"]
    n_sifted = int(n_bits * sift_frac * rng.uniform(0.88, 1.05))

    # Eve introduces extra QBER
    eve_qber = eavesdrop_fraction * 0.25 if eavesdropper else 0.0
    qber = min(0.5, channel_error_rate + eve_qber + rng.gauss(0, 0.005))
    qber = max(0.0, qber)

    h_qber = _binary_entropy(qber)
    ec_bits = int(h_qber * n_sifted)
    pa_bits = int(eve_qber * n_sifted * 0.5)
    n_secret = max(0, n_sifted - ec_bits - pa_bits)

    alice_bits  = [rng.randint(0, 1) for _ in range(min(10, n_bits))]
    alice_bases = [rng.choice(_BASES) for _ in range(min(10, n_bits))]
    bob_bases   = [rng.choice(_BASES) for _ in range(min(10, n_bits))]
    bob_bits    = [
        ab if abas == bbas and rng.random() > channel_error_rate else rng.randint(0, 1)
        for ab, abas, bbas in zip(alice_bits, alice_bases, bob_bases)
    ]

    reconciliation = [
        {
            "alice_basis": alice_bases[i],
            "bob_basis":   bob_bases[i],
            "match":       alice_bases[i] == bob_bases[i],
            "alice_bit":   alice_bits[i],
            "bob_bit":     bob_bits[i],
        }
        for i in range(len(alice_bits))
    ]

    return {
        "n_sifted_bits": n_sifted,
        "n_secret_bits": n_secret,
        "qber": round(qber, 4),
        "chsh_s": 0.0,
        "error_correction_bits": ec_bits,
        "privacy_amplification_bits": pa_bits,
        "basis_reconciliation": reconciliation,
        "raw_key_rate": round(n_sifted / n_bits, 4),
    }


# ---------------------------------------------------------------------------
# Security analysis
# ---------------------------------------------------------------------------

def _security_verdict(qber: float, qber_threshold: float, eavesdropper: bool,
                      chsh_s: float, protocol: str) -> Dict[str, Any]:
    qber_ok = qber <= qber_threshold

    if protocol == "e91":
        bell_violated = chsh_s > 2.0
        eve_detected = not bell_violated or not qber_ok
    else:
        bell_violated = False
        eve_detected = not qber_ok or eavesdropper and qber > qber_threshold * 0.8

    if not eve_detected and qber_ok:
        verdict = "SECURE"
        level = "high"
    elif qber <= qber_threshold * 1.3:
        verdict = "MARGINAL"
        level = "medium"
    else:
        verdict = "INSECURE"
        level = "low"

    # Estimate eavesdrop fraction from QBER excess
    eve_frac_est = min(1.0, max(0.0, (qber - qber_threshold * 0.5) / 0.25)) if qber > 0 else 0.0

    return {
        "eavesdropper_detected": eve_detected,
        "eavesdrop_fraction_estimate": round(eve_frac_est, 3),
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
    proto_cfg = _PROTOCOLS.get(proto_key, _PROTOCOLS["bb84"])

    rng = random.Random(req.seed)

    if proto_key == "bb84":
        result = _simulate_bb84(req.n_bits, req.channel_error_rate,
                                req.eavesdropper, req.eavesdrop_fraction, rng, proto_cfg)
    elif proto_key == "e91":
        result = _simulate_e91(req.n_bits, req.channel_error_rate,
                               req.eavesdropper, req.eavesdrop_fraction, rng, proto_cfg)
    else:
        result = _simulate_generic(req.n_bits, req.channel_error_rate,
                                   req.eavesdropper, req.eavesdrop_fraction, rng, proto_cfg)

    qber = result["qber"]
    qber_threshold = proto_cfg["qber_threshold"]
    chsh_s = result.get("chsh_s", 0.0)

    security = _security_verdict(qber, qber_threshold, req.eavesdropper, chsh_s, proto_key)

    n_sifted = result["n_sifted_bits"]
    n_secret = result["n_secret_bits"]

    # Key rates
    raw_key_rate   = result["raw_key_rate"]
    h_qber         = _binary_entropy(qber)
    secret_rate    = max(0.0, (1 - h_qber) * raw_key_rate) if qber < qber_threshold else 0.0
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
