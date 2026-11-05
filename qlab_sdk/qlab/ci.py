"""Baseline checks for CI: does a run's measurement distribution still match a baseline run?

The statistic is the total variation distance (TVD) between the two empirical distributions.
Two runs of the same circuit on the same setup never give identical counts, so the pass
threshold is a sampling-noise bound plus a user margin:

    threshold = eps(n_run) + eps(n_baseline) + margin
    eps(n)    = sqrt((k * ln 2 + ln(2 / alpha)) / (2 * n))

eps(n) comes from the concentration bound for an empirical distribution over k outcomes
(Weissman et al. 2003): P(||p_hat - p||_1 >= e) <= (2**k - 2) * exp(-n * e**2 / 2), so with
probability at least 1 - alpha/2 the TVD between p_hat and p is at most eps(n). By the triangle
inequality, if both runs sample the same distribution, their TVD exceeds eps(n_a) + eps(n_b)
with probability at most alpha. k is the number of distinct outcomes seen in either run.

The bound is distribution-free and conservative: a run that fails it has changed beyond what
shot noise explains (at the chosen alpha), plus the margin you allow for drift.
"""

from __future__ import annotations

import math
from typing import Any, Mapping
from xml.etree import ElementTree as ET


def normalize_counts(counts: Any) -> dict[str, int]:
    """{bitstring: count} from a counts dict, or the first dict of a list of them."""
    if isinstance(counts, list):
        counts = next((c for c in counts if isinstance(c, Mapping) and c), None)
    if not isinstance(counts, Mapping):
        return {}
    out: dict[str, int] = {}
    for key, value in counts.items():
        try:
            n = int(value)
        except (TypeError, ValueError):
            continue
        if n > 0:
            k = str(key).replace(" ", "")
            out[k] = out.get(k, 0) + n
    return out


def counts_of_run(run: Mapping[str, Any]) -> dict[str, int]:
    """Counts stored on a Q-Lab run (results.counts), {} when it has none."""
    return normalize_counts((run.get("results") or {}).get("counts"))


def tvd(a: Mapping[str, int], b: Mapping[str, int]) -> float:
    na, nb = sum(a.values()), sum(b.values())
    if na <= 0 or nb <= 0:
        raise ValueError("both distributions need at least one shot")
    return 0.5 * sum(abs(a.get(s, 0) / na - b.get(s, 0) / nb) for s in set(a) | set(b))


def noise_bound(shots: int, outcomes: int, alpha: float) -> float:
    """eps(n): TVD that shot noise alone exceeds with probability at most alpha / 2."""
    if shots <= 0:
        return 1.0
    k = max(int(outcomes), 2)
    return math.sqrt((k * math.log(2) + math.log(2 / alpha)) / (2 * shots))


def check_counts(
    run_counts: Mapping[str, int],
    baseline_counts: Mapping[str, int],
    margin: float = 0.0,
    alpha: float = 0.01,
) -> dict[str, Any]:
    """Compare two count distributions. passed is False when TVD > noise threshold + margin."""
    if not 0 < alpha < 1:
        raise ValueError("alpha must be between 0 and 1")
    if margin < 0:
        raise ValueError("margin must be >= 0")
    run_counts = normalize_counts(dict(run_counts))
    baseline_counts = normalize_counts(dict(baseline_counts))
    n_run, n_base = sum(run_counts.values()), sum(baseline_counts.values())
    distance = tvd(run_counts, baseline_counts)
    k = len(set(run_counts) | set(baseline_counts))
    noise = noise_bound(n_run, k, alpha) + noise_bound(n_base, k, alpha)
    threshold = min(1.0, noise + margin)
    return {
        "passed": distance <= threshold,
        "tvd": distance,
        "threshold": threshold,
        "noise_threshold": noise,
        "margin": margin,
        "alpha": alpha,
        "shots": n_run,
        "baseline_shots": n_base,
        "outcomes": k,
    }


def junit_xml(cases: list[dict[str, Any]], suite: str = "qlab-ci") -> str:
    """JUnit XML for a list of {"name", "passed", "message", "error"?, "time"?} cases."""
    failures = sum(1 for c in cases if c.get("passed") is False and not c.get("error"))
    errors = sum(1 for c in cases if c.get("error"))
    root = ET.Element("testsuites", name=suite, tests=str(len(cases)),
                      failures=str(failures), errors=str(errors))
    ts = ET.SubElement(root, "testsuite", name=suite, tests=str(len(cases)),
                       failures=str(failures), errors=str(errors))
    for case in cases:
        tc = ET.SubElement(ts, "testcase", classname=suite, name=str(case.get("name", "check")),
                           time=f"{float(case.get('time', 0.0)):.3f}")
        message = str(case.get("message", ""))
        if case.get("error"):
            ET.SubElement(tc, "error", message=str(case["error"])).text = message or str(case["error"])
        elif case.get("passed") is False:
            ET.SubElement(tc, "failure", message="distribution regression").text = message
        elif message:
            ET.SubElement(tc, "system-out").text = message
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="unicode")


def describe(result: dict[str, Any], run_label: str, baseline_label: str) -> str:
    verdict = "PASS" if result["passed"] else "FAIL"
    return (
        f"{verdict} {run_label} vs baseline {baseline_label}: TVD {result['tvd']:.4f} "
        f"{'<=' if result['passed'] else '>'} threshold {result['threshold']:.4f} "
        f"(shot noise {result['noise_threshold']:.4f} at alpha={result['alpha']:g} "
        f"+ margin {result['margin']:.4f}; shots {result['shots']} / {result['baseline_shots']}, "
        f"{result['outcomes']} outcomes)"
    )
