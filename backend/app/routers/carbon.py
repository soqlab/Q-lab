"""Circuit Carbon Footprint — estimate CO2 emissions per quantum computing run.

Estimates are based on published QPU power consumption data multiplied by
run time, regional grid carbon intensity, and PUE (Power Usage Effectiveness).

Router prefix: /api/v1/carbon
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Project, Run

router = APIRouter(prefix="/api/v1/carbon", tags=["carbon"])


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Carbon intensity by region (gCO2eq/kWh) — approximate 2024 values
REGION_CARBON_INTENSITY: Dict[str, int] = {
    "us-east": 386,       # US East Coast grid mix
    "us-west": 210,       # US West Coast (more renewables)
    "eu-west": 233,       # EU average
    "eu-north": 45,       # Nordic (mostly hydro/wind)
    "asia-pacific": 520,  # Asia Pacific average
    "canada": 140,        # Canada (mostly hydro)
    "default": 386,
}

# Power consumption estimates (kW total) — based on published data
HARDWARE_POWER: Dict[str, Dict[str, Any]] = {
    "ibm": {
        "dilution_refrigerator_w": 25000,
        "control_electronics_w": 5000,
        "cooling_overhead_w": 15000,
        "total_kw": 45,
    },
    "ionq": {
        "laser_systems_w": 3000,
        "vacuum_systems_w": 500,
        "electronics_w": 2000,
        "total_kw": 5.5,
    },
    "rigetti": {
        "dilution_refrigerator_w": 22000,
        "control_electronics_w": 4000,
        "cooling_overhead_w": 12000,
        "total_kw": 38,
    },
    "simulator": {
        "server_w": 500,
        "cooling_w": 200,
        "total_kw": 0.7,
    },
    "default": {
        "total_kw": 45,
    },
}

PUE = 1.6  # typical quantum computing facility Power Usage Effectiveness


# ---------------------------------------------------------------------------
# Core estimation logic
# ---------------------------------------------------------------------------


def _detect_hw(backend: str) -> Dict[str, Any]:
    b = backend.lower()
    if "ibm" in b:
        return HARDWARE_POWER["ibm"]
    if "ionq" in b:
        return HARDWARE_POWER["ionq"]
    if "rigetti" in b or "ankaa" in b:
        return HARDWARE_POWER["rigetti"]
    if "simulator" in b or "fake" in b or "aer" in b or "qasm_simulator" in b:
        return HARDWARE_POWER["simulator"]
    return HARDWARE_POWER["default"]


def _estimate_carbon(backend: str, qpu_time_seconds: float, region: str = "us-east") -> Dict[str, Any]:
    hw = _detect_hw(backend)
    total_kw = hw["total_kw"]
    carbon_intensity = REGION_CARBON_INTENSITY.get(region, REGION_CARBON_INTENSITY["default"])

    # Energy in kWh = power (kW) × time (hours)
    energy_kwh = total_kw * (qpu_time_seconds / 3600)
    co2_grams_raw = energy_kwh * carbon_intensity
    co2_kg = co2_grams_raw / 1000

    # Apply PUE (cooling overhead, etc.)
    co2_kg_with_pue = co2_kg * PUE
    co2_grams_final = co2_kg_with_pue * 1000

    comparisons = {
        "car_meters": round(co2_kg_with_pue / 0.00021, 2),         # meters driven (0.21 kg CO2/km)
        "emails": round(co2_grams_final / 0.004, 0),                # emails (0.004 g CO2 each)
        "led_bulb_hours": round(co2_grams_final / 0.009, 2),        # hours of 10W LED
    }

    return {
        "backend": backend,
        "qpu_time_seconds": qpu_time_seconds,
        "region": region,
        "hardware_power_kw": total_kw,
        "energy_kwh": round(energy_kwh, 6),
        "energy_kwh_with_pue": round(energy_kwh * PUE, 6),
        "carbon_intensity_gco2_kwh": carbon_intensity,
        "co2_grams": round(co2_grams_final, 4),
        "co2_grams_raw": round(co2_grams_raw, 4),
        "pue_factor": PUE,
        "comparisons": comparisons,
        "methodology": (
            "Estimated from published QPU power consumption × run time "
            "× regional grid carbon intensity × PUE factor"
        ),
        "uncertainty": "±200% (QPU power consumption varies by system; utilization share is estimated)",
    }


def _qpu_time_from_run(run: Run) -> float:
    """Extract or estimate QPU time in seconds from a Run record."""
    timing = run.timing or {}

    # Try explicit fields in timing dict
    for key in ("qpu_time", "qpu_time_s", "execution_time", "duration", "total_time"):
        val = timing.get(key)
        if isinstance(val, (int, float)) and val > 0:
            return float(val)

    # Estimate from shot count: ~10,000 shots per second is a rough baseline
    shots = None
    execution = run.execution or {}
    params = run.parameters or {}
    for d in (execution, params, timing):
        for key in ("shots", "n_shots", "num_shots"):
            val = d.get(key)
            if isinstance(val, (int, float)) and val > 0:
                shots = float(val)
                break
        if shots:
            break

    if shots:
        return max(0.001, shots / 10_000)

    # Fallback: 1 second
    return 1.0


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/run/{run_id}")
def carbon_for_run(
    run_id: str,
    region: str = Query(default="us-east", description="Grid region for carbon intensity"),
    db: Session = Depends(get_db),
):
    """Carbon footprint estimate for a single experiment run."""
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(status_code=404, detail="run not found")

    backend = run.backend or "default"
    qpu_time = _qpu_time_from_run(run)
    estimate = _estimate_carbon(backend, qpu_time, region)

    return {
        **estimate,
        "run_metadata": {
            "run_id": run.run_id,
            "circuit_name": run.circuit_name,
            "backend": run.backend,
            "project_slug": run.project_slug,
            "status": run.status,
            "created_at": run.created_at.isoformat() if run.created_at else None,
        },
    }


@router.get("/project/{project_slug}")
def carbon_for_project(
    project_slug: str,
    region: str = Query(default="us-east"),
    db: Session = Depends(get_db),
):
    """Total carbon footprint for all runs in a project."""
    project = db.scalar(select(Project).where(Project.slug == project_slug))
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")

    runs = db.scalars(select(Run).where(Run.project_slug == project_slug)).all()
    if not runs:
        return {
            "project_slug": project_slug,
            "runs_counted": 0,
            "total_co2_grams": 0,
            "by_backend": {},
            "by_month": {},
            "equivalent_car_km": 0,
            "equivalent_transatlantic_flights": 0,
        }

    total_co2 = 0.0
    by_backend: Dict[str, float] = defaultdict(float)
    by_month: Dict[str, float] = defaultdict(float)

    for run in runs:
        backend = run.backend or "default"
        qpu_time = _qpu_time_from_run(run)
        est = _estimate_carbon(backend, qpu_time, region)
        co2 = est["co2_grams"]

        total_co2 += co2
        by_backend[backend] += co2

        # Bucket by YYYY-MM
        if run.created_at:
            month_key = run.created_at.strftime("%Y-%m")
        else:
            month_key = "unknown"
        by_month[month_key] += co2

    # Sort month keys chronologically
    by_month_sorted = dict(sorted(by_month.items()))

    # Transatlantic flight: ~2,000,000 g CO2 per passenger
    TRANSATLANTIC_G = 2_000_000

    return {
        "project_slug": project_slug,
        "runs_counted": len(runs),
        "total_co2_grams": round(total_co2, 4),
        "by_backend": {k: round(v, 4) for k, v in sorted(by_backend.items(), key=lambda x: -x[1])},
        "by_month": {k: round(v, 4) for k, v in by_month_sorted.items()},
        "equivalent_car_km": round(total_co2 / 1000 / 0.21, 2),
        "equivalent_transatlantic_flights": round(total_co2 / TRANSATLANTIC_G, 6),
        "region": region,
    }


@router.get("/summary")
def carbon_summary(
    region: str = Query(default="us-east"),
    db: Session = Depends(get_db),
):
    """Lab-wide carbon footprint across all runs, with monthly trend and suggestions."""
    runs = db.scalars(select(Run)).all()

    if not runs:
        return {
            "total_runs": 0,
            "total_co2_grams": 0,
            "equivalent_car_km": 0,
            "equivalent_transatlantic_flights": 0,
            "by_backend": {},
            "by_month": {},
            "cleanest_backend": None,
            "dirtiest_backend": None,
            "suggestions": [],
        }

    total_co2 = 0.0
    by_backend: Dict[str, float] = defaultdict(float)
    by_backend_runs: Dict[str, int] = defaultdict(int)
    by_month: Dict[str, float] = defaultdict(float)
    simulator_co2 = 0.0
    simulator_count = 0

    for run in runs:
        backend = run.backend or "default"
        qpu_time = _qpu_time_from_run(run)
        est = _estimate_carbon(backend, qpu_time, region)
        co2 = est["co2_grams"]

        total_co2 += co2
        by_backend[backend] += co2
        by_backend_runs[backend] += 1

        if run.created_at:
            month_key = run.created_at.strftime("%Y-%m")
        else:
            month_key = "unknown"
        by_month[month_key] += co2

        hw = _detect_hw(backend)
        if hw is HARDWARE_POWER["simulator"]:
            simulator_co2 += co2
            simulator_count += 1

    by_month_sorted = dict(sorted(by_month.items()))
    backend_items = sorted(by_backend.items(), key=lambda x: x[1])
    cleanest = backend_items[0][0] if backend_items else None
    dirtiest = backend_items[-1][0] if backend_items else None

    TRANSATLANTIC_G = 2_000_000

    # Build suggestions
    suggestions: List[str] = []
    if dirtiest and dirtiest != cleanest:
        dirtiest_pct = (by_backend[dirtiest] / total_co2 * 100) if total_co2 > 0 else 0
        suggestions.append(
            f"'{dirtiest}' accounts for {dirtiest_pct:.0f}% of total CO2. "
            f"Consider routing more runs to '{cleanest}' (lower intensity)."
        )
    if simulator_count > 0 and total_co2 > 0:
        sim_pct = simulator_co2 / total_co2 * 100
        suggestions.append(
            f"{simulator_count} simulator run(s) contribute {sim_pct:.1f}% of lab CO2. "
            "Simulators are already the lowest-carbon option for non-hardware experiments."
        )
    if total_co2 > 1_000_000:
        suggestions.append(
            "Lab total exceeds 1 kg CO2. Consider offsetting via a verified carbon registry."
        )

    return {
        "total_runs": len(runs),
        "total_co2_grams": round(total_co2, 4),
        "equivalent_car_km": round(total_co2 / 1000 / 0.21, 2),
        "equivalent_transatlantic_flights": round(total_co2 / TRANSATLANTIC_G, 6),
        "by_backend": {k: round(v, 4) for k, v in sorted(by_backend.items(), key=lambda x: -x[1])},
        "by_month": {k: round(v, 4) for k, v in by_month_sorted.items()},
        "cleanest_backend": cleanest,
        "dirtiest_backend": dirtiest,
        "suggestions": suggestions,
        "region": region,
    }


@router.get("/comparison/backends")
def compare_backends(
    region: str = Query(default="us-east"),
):
    """Rank all known backends by CO2 for a standard 5-qubit, 100-shot, 1-second run."""
    standard_time_s = 1.0
    standard_shots = 100

    backends_to_test = [
        "ibm_kyoto",
        "ibm_brisbane",
        "ionq_aria",
        "rigetti_ankaa",
        "qasm_simulator",
        "aer_simulator",
    ]

    results = []
    for backend in backends_to_test:
        est = _estimate_carbon(backend, standard_time_s, region)
        results.append({
            "backend": backend,
            "co2_grams": est["co2_grams"],
            "hardware_power_kw": est["hardware_power_kw"],
            "energy_kwh_with_pue": est["energy_kwh_with_pue"],
            "region_assumption": region,
        })

    results.sort(key=lambda x: x["co2_grams"])
    worst = results[-1]["co2_grams"] if results else 1

    for r in results:
        r["relative_to_worst"] = round(r["co2_grams"] / worst, 4) if worst > 0 else 0

    return {
        "standard_run": {
            "qpu_time_seconds": standard_time_s,
            "shots": standard_shots,
            "n_qubits": 5,
            "region": region,
        },
        "backends": results,
        "note": "Power consumption figures are estimates from published data. Actual values vary by system utilization.",
    }


@router.get("/certificate/{run_id}")
def carbon_certificate(
    run_id: str,
    region: str = Query(default="us-east"),
    db: Session = Depends(get_db),
):
    """Generate a carbon footprint certificate for a run (suitable for publication supplementary materials)."""
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(status_code=404, detail="run not found")

    backend = run.backend or "default"
    qpu_time = _qpu_time_from_run(run)
    estimate = _estimate_carbon(backend, qpu_time, region)

    certificate = {
        "certificate_type": "Carbon Footprint Certificate",
        "version": "1.0",
        "issued_at": datetime.now(timezone.utc).isoformat(),
        "experiment": {
            "run_id": run.run_id,
            "circuit_name": run.circuit_name or "unnamed",
            "backend": run.backend,
            "project": run.project_slug,
            "executed_at": run.created_at.isoformat() if run.created_at else None,
        },
        "carbon_footprint": {
            "co2_grams": estimate["co2_grams"],
            "co2_grams_raw": estimate["co2_grams_raw"],
            "co2_kg": round(estimate["co2_grams"] / 1000, 6),
            "energy_kwh": estimate["energy_kwh"],
            "energy_kwh_with_pue": estimate["energy_kwh_with_pue"],
            "pue_factor": estimate["pue_factor"],
        },
        "assumptions": {
            "qpu_time_seconds": estimate["qpu_time_seconds"],
            "hardware_power_kw": estimate["hardware_power_kw"],
            "region": estimate["region"],
            "carbon_intensity_gco2_kwh": estimate["carbon_intensity_gco2_kwh"],
            "methodology": estimate["methodology"],
            "uncertainty": estimate["uncertainty"],
        },
        "comparisons": estimate["comparisons"],
        "data_sources": {
            "carbon_intensity": "Our World in Data / Electricity Maps (2024 averages)",
            "hardware_power": "Published QPU vendor documentation and academic literature",
            "pue_reference": "US DOE data center PUE statistics (2024)",
        },
        "citation_text": (
            f"Carbon footprint of quantum experiment '{run.circuit_name or run.run_id}' "
            f"on {run.backend}: {estimate['co2_grams']:.4f} gCO2eq "
            f"(region: {region}, methodology: {estimate['methodology']}). "
            f"Generated by Q-Lab on {datetime.now(timezone.utc).strftime('%Y-%m-%d')}."
        ),
    }

    return certificate
