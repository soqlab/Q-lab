__version__ = "0.2.0"

# ---------------------------------------------------------------------------
# Framework adapters — lazy imports so that missing optional dependencies
# (pennylane, cirq, qsharp) never prevent `import qlab` from succeeding.
# ---------------------------------------------------------------------------

try:
    from .adapters import pennylane_adapter as pennylane  # noqa: F401
except Exception:
    pennylane = None  # type: ignore[assignment]

try:
    from .adapters import cirq_adapter as cirq  # noqa: F401
except Exception:
    cirq = None  # type: ignore[assignment]

try:
    from .adapters import qsharp_adapter as qsharp  # noqa: F401
except Exception:
    qsharp = None  # type: ignore[assignment]

from .qiskit_hooks import (
    benchmark,
    campaign_combinations,
    check_policy,
    create_campaign,
    expect,
    flush,
    get_campaign,
    get_policy,
    init,
    log_metric,
    log_metrics,
    log_result,
    optimize,
    run,
    RunContext,
    track,
    PolicyViolationError,
)
from .jupyter import display, watch, runs_table

__all__ = [
    "benchmark",
    "campaign_combinations",
    "check_policy",
    "create_campaign",
    "display",
    "expect",
    "flush",
    "get_campaign",
    "get_policy",
    "init",
    "log_metric",
    "log_metrics",
    "log_result",
    "optimize",
    "PolicyViolationError",
    "run",
    "RunContext",
    "runs_table",
    "track",
    "watch",
]
