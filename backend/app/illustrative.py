"""Marks API responses whose numbers are not measurements.

Many Labs tools began as demonstrations: they generate plausible results from formulas and random
numbers rather than running anything. A scientist must never mistake those for data. Every response
from a router listed here carries `X-QLab-Data: illustrative`, and the dashboard shows a notice on
any page that received one (frontend/app/(main)/IllustrativeNotice.tsx).

To graduate a tool, make it compute from real data or return an honest error, then remove it here.
Routers that are real except for a fallback set the header on that path instead (calibration_oracle).
"""
from __future__ import annotations

ILLUSTRATIVE_HEADER = "X-QLab-Data"
ILLUSTRATIVE_VALUE = "illustrative"

ILLUSTRATIVE_ROUTERS = frozenset({
    # Invented results: nothing is run on the user's input.
    "advantage", "anomaly_physics", "autopilot", "backend_emulator", "bayes_opt", "circuit_ai",
    "circuit_knitting", "collab_notebook", "copilot", "cross_bench",
    "dd_optimizer", "error_mitigate",
    "evo_optimizer", "fair_data", "gate_tomo", "global_cal", "grant_proposal", "institute", "job_scheduler",
    "live_monitor", "methods_gen", "mirror_circuit", "noise_marketplace", "oed", "offline_export",
    "optimizer_hub", "paper_draft", "paper_replication", "process_tomo", "pulse_control", "qaoa_solver", "qfm",
    "qml_datasets", "qml_workbench", "quantum_chem", "qv_runner", "rb_gst", "rb_suite", "research_pipeline",
    "rl_optimizer", "spectral_noise", "synthetic_data", "tensor_network", "tomography", "vqe_landscape",
    "zne_pec",
    # Real calculation with a fallback to invented numbers when something is missing.
    "causal", "clifford_sim", "ensemble_runner", "error_budget", "github_ci", "hamiltonian_studio", "hpc_bridge",
    "protocol_sim", "providers", "quantum_finance", "quantum_internet", "qvbench", "stats_engine",
    # Real flows, showing invented sample records.
    "benchmark_leaderboard", "challenges", "circuit_ancestry", "collab", "learn", "replication", "research_graph",
    "templates",
})


class MarkIllustrativeData:
    """Adds the header once routing has settled which endpoint answered."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        async def send_marked(message):
            if message["type"] == "http.response.start":
                endpoint = scope.get("endpoint")
                module = getattr(endpoint, "__module__", "").rpartition(".")[2]
                if module in ILLUSTRATIVE_ROUTERS:
                    headers = list(message.get("headers", []))
                    headers.append((ILLUSTRATIVE_HEADER.lower().encode(), ILLUSTRATIVE_VALUE.encode()))
                    message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_marked)
