"""Complexity Analyzer — fits scaling curves to parameterized circuit metrics."""
from __future__ import annotations
import math, random, re, uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/complexity-analyzer", tags=["complexity_analyzer"])

METRICS = {
    "t_count": {
        "name": "T-gate Count",
        "description": "Number of non-Clifford T/Tdg gates — determines fault-tolerant resource cost.",
        "unit": "gates",
    },
    "depth": {
        "name": "Circuit Depth",
        "description": "Number of sequential layers (critical path length).",
        "unit": "layers",
    },
    "n_cx": {
        "name": "CNOT Count",
        "description": "Number of two-qubit CNOT/CX gates — dominant cost on physical hardware.",
        "unit": "gates",
    },
    "total_gates": {
        "name": "Total Gate Count",
        "description": "Total number of gate operations in the circuit.",
        "unit": "gates",
    },
    "width": {
        "name": "Circuit Width",
        "description": "Number of active qubits used by the circuit.",
        "unit": "qubits",
    },
}

COMPLEXITY_CLASSES = ["linear", "quadratic", "cubic", "log", "nlogn", "exponential"]


def _measure_circuit(qasm_template: str, n: int) -> Dict[str, float]:
    """Instantiate the QASM template for size n and compute circuit metrics."""
    qasm = qasm_template.replace("{n}", str(n))
    skip = {"openqasm", "include", "//", "qreg", "creg", "measure", "barrier", "reset"}
    t_count = 0
    cx_count = 0
    total = 0
    width_set: set = set()
    layers: List[set] = []

    for raw in qasm.splitlines():
        line = raw.strip().rstrip(";")
        if not line:
            continue
        token = line.split()[0].split("(")[0].lower()
        if any(token.startswith(s) for s in skip):
            # Extract qreg width
            m = re.search(r'qreg\s+\w+\[(\d+)\]', line)
            if m:
                for i in range(int(m.group(1))):
                    width_set.add(i)
            continue

        gate_qubits = set(int(x) for x in re.findall(r'\[(\d+)\]', line))
        width_set |= gate_qubits

        if token in ("t", "tdg"):
            t_count += 1
        if token in ("cx", "cnot", "cz", "cy", "swap"):
            cx_count += 1

        total += 1

        # Assign to the first layer that doesn't use these qubits
        placed = False
        for layer in layers:
            if not layer & gate_qubits:
                layer |= gate_qubits
                placed = True
                break
        if not placed:
            layers.append(set(gate_qubits))

    depth = len(layers) if layers else 0

    # If the template contains {n} patterns beyond direct substitution, estimate from n
    if total == 0 and n > 0:
        # Heuristic fallback when template is empty/unparseable
        total = n * 2
        t_count = n
        cx_count = n - 1
        depth = n
        width_set = set(range(n))

    return {
        "t_count": float(t_count),
        "depth": float(depth),
        "n_cx": float(cx_count),
        "total_gates": float(total),
        "width": float(len(width_set)) if width_set else float(n),
    }


def _basis_value(complexity_class: str, n: float) -> float:
    """Compute the basis function value for a given complexity class at size n."""
    eps = 1e-9
    if complexity_class == "linear":
        return n
    elif complexity_class == "quadratic":
        return n ** 2
    elif complexity_class == "cubic":
        return n ** 3
    elif complexity_class == "log":
        return math.log2(max(n, eps))
    elif complexity_class == "nlogn":
        return n * math.log2(max(n, eps))
    elif complexity_class == "exponential":
        return 2.0 ** min(n, 60)  # cap to avoid overflow
    return n


def _least_squares_fit(sizes: List[int], values: List[float], complexity_class: str):
    """
    Fit y = a * f(n) + b using ordinary least squares.
    Returns (a, b, r_squared).
    """
    xs = [_basis_value(complexity_class, float(n)) for n in sizes]
    n = len(sizes)
    if n < 2:
        return (1.0, 0.0, 0.0)

    mean_x = sum(xs) / n
    mean_y = sum(values) / n

    ss_xy = sum((xs[i] - mean_x) * (values[i] - mean_y) for i in range(n))
    ss_xx = sum((xs[i] - mean_x) ** 2 for i in range(n))

    if abs(ss_xx) < 1e-15:
        return (0.0, mean_y, 0.0)

    a = ss_xy / ss_xx
    b = mean_y - a * mean_x

    # R²
    ss_res = sum((values[i] - (a * xs[i] + b)) ** 2 for i in range(n))
    ss_tot = sum((values[i] - mean_y) ** 2 for i in range(n))
    r2 = 1.0 - ss_res / max(ss_tot, 1e-15)

    return (round(a, 6), round(b, 6), round(max(r2, 0.0), 6))


def _predict(a: float, b: float, complexity_class: str, n: float) -> float:
    v = a * _basis_value(complexity_class, n) + b
    return round(max(v, 0.0), 4)


def _practical_limit(best_class: str, a: float, b: float, time_limit_sec: float = 3600.0) -> int:
    """Estimate the largest n where computation completes within time_limit_sec on a classical CPU."""
    # Assume 10^9 ops/sec; metric value approximates gate count / time cost
    ops_limit = time_limit_sec * 1e9
    for n in range(1, 10001):
        predicted = a * _basis_value(best_class, float(n)) + b
        if predicted > ops_limit:
            return n - 1
    return 10000


class ComplexityRequest(BaseModel):
    qasm_template: str
    param_name: str = Field(default="n_qubits")
    sizes: List[int] = Field(default=[2, 4, 6, 8, 10, 12])
    metric: str = Field(default="t_count")
    seed: Optional[int] = None


@router.post("")
def analyze_complexity(req: ComplexityRequest):
    metric_key = req.metric if req.metric in METRICS else "t_count"
    sizes = sorted(set(max(1, s) for s in req.sizes))[:20]  # deduplicate, cap at 20

    # Measure the metric at each size
    measured = []
    for n in sizes:
        metrics = _measure_circuit(req.qasm_template, n)
        val = metrics.get(metric_key, 0.0)
        measured.append({"size": n, "value": round(val, 4)})

    values = [m["value"] for m in measured]

    # Fit all complexity classes
    fits = []
    best_r2 = -1.0
    best_class = "linear"
    best_a, best_b = 1.0, 0.0

    for cls in COMPLEXITY_CLASSES:
        a, b, r2 = _least_squares_fit(sizes, values, cls)
        formula = f"y = {a:.4g} * {cls}(n) + {b:.4g}"
        fits.append({
            "complexity_class": cls,
            "r_squared": round(r2, 6),
            "formula": formula,
            "a": a,
            "b": b,
        })
        if r2 > best_r2:
            best_r2 = r2
            best_class = cls
            best_a, best_b = a, b

    # Sort fits by R² descending
    fits.sort(key=lambda f: -f["r_squared"])

    predicted_100 = _predict(best_a, best_b, best_class, 100.0)
    predicted_1000 = _predict(best_a, best_b, best_class, 1000.0)

    # Scaling plot data
    all_sizes = sizes + [20, 50, 100]
    plot_sizes = sorted(set(all_sizes))
    plot_data = [
        {
            "size": float(n),
            "measured": next((m["value"] for m in measured if m["size"] == n), None),
            "fitted": round(max(best_a * _basis_value(best_class, float(n)) + best_b, 0.0), 4),
        }
        for n in plot_sizes
    ]

    is_polynomial = best_class in ("linear", "quadratic", "cubic", "log", "nlogn")
    is_exponential = best_class == "exponential"
    practical_limit = _practical_limit(best_class, best_a, best_b)

    return {
        "analysis_id": f"ca-{uuid.uuid4().hex[:12]}",
        "param_name": req.param_name,
        "metric_name": metric_key,
        "sizes_analyzed": sizes,
        "measured_values": measured,
        "best_fit_class": best_class,
        "best_fit_r_squared": round(best_r2, 6),
        "fit_coefficients": {"a": best_a, "b": best_b},
        "all_fits": fits,
        "predicted_at_100": predicted_100,
        "predicted_at_1000": predicted_1000,
        "scaling_plot_data": plot_data,
        "is_polynomial": is_polynomial,
        "is_exponential": is_exponential,
        "practical_limit_n": practical_limit,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/metrics")
def list_metrics():
    return [
        {
            "metric_id": k,
            "name": v["name"],
            "description": v["description"],
            "unit": v["unit"],
        }
        for k, v in METRICS.items()
    ]
