import uuid
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from app.database import init_db
from app.deps import Identity, require_auth
from app.main import app

init_db()
client = TestClient(app, raise_server_exceptions=False)
app.dependency_overrides[require_auth] = lambda: Identity(legacy=True)


def _run_payload(run_id: str | None = None, *, project: str = "phase1-tests", depth: int = 4) -> dict:
    return {
        "run_id": run_id or f"phase1-{uuid.uuid4().hex[:10]}",
        "circuit_name": "phase1_bell",
        "qasm": 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\ncreg c[2];\nh q[0];\ncx q[0],q[1];\nmeasure q -> c;',
        "fingerprint": {
            "num_qubits": 2,
            "num_clbits": 2,
            "depth": depth,
            "size": 4,
            "gate_counts": {"h": 1, "cx": 1, "measure": 1},
            "non_clifford_ratio": 0.0,
        },
        "context": {},
        "backend": "ibm_phase1",
        "parameters": {"shots": 1024},
        "execution": {"shots": 1024},
        "calibration": {
            "t1_us": {"0": 120.0, "1": 130.0},
            "t2_us": {"0": 100.0, "1": 110.0},
            "gate_errors": {"cx_0_1": 0.01},
            "readout_errors": {"0": 0.02, "1": 0.025},
        },
        "transpiler": {"depth_before": depth, "depth_after": depth},
        "results": {
            "counts": {"00": 520, "11": 504},
            "qoe_snapshots": [
                {"depth": 1, "label": "after-h", "counts": {"00": 510, "10": 514}},
                {"depth": depth, "label": "final", "counts": {"00": 520, "11": 504}},
            ],
        },
        "project": project,
        "tags": ["phase1"],
        "status": "completed",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def _push_run(**kwargs) -> str:
    payload = _run_payload(**kwargs)
    resp = client.post("/api/v1/runs", json=payload)
    assert resp.status_code == 200, resp.text
    return payload["run_id"]


def test_cost_budget_summary_and_estimate():
    _push_run(project="cost-phase1")

    estimate = client.get("/api/v1/costs/estimate", params={"provider": "ibm", "backend": "ibm_phase1", "shots": 1024, "depth": 4, "qubits": 2})
    assert estimate.status_code == 200
    assert estimate.json()["estimated_credits"] > 0

    budget = client.post(
        "/api/v1/costs/budget",
        json={"name": "cost-phase1", "budget_type": "project", "project_slug": "cost-phase1", "threshold_credits": 10, "alert_at_pct": 0.8},
    )
    assert budget.status_code == 200, budget.text
    assert budget.json()["project_slug"] == "cost-phase1"

    summary = client.get("/api/v1/costs/summary", params={"period": "monthly"})
    assert summary.status_code == 200
    assert "total_credits" in summary.json()


def test_ci_regression_check_and_gate_listing():
    baseline_id = _push_run(project="ci-phase1", depth=4)
    candidate_id = _push_run(project="ci-phase1", depth=5)

    gate = client.post(
        "/api/v1/ci/regression-gates",
        json={"name": "phase1 gate", "project_slug": "ci-phase1", "baseline_run_id": baseline_id, "fidelity_drop_threshold_pct": 20},
    )
    assert gate.status_code == 200, gate.text

    gates = client.get("/api/v1/ci/regression-gates")
    assert gates.status_code == 200
    assert any(item["baseline_run_id"] == baseline_id for item in gates.json())

    check = client.post(
        "/api/v1/ci/regression-check",
        json={"run_id": candidate_id, "baseline_run_id": baseline_id, "fidelity_drop_threshold_pct": 20},
    )
    assert check.status_code == 200, check.text
    assert "estimated_unitary_fidelity" in check.json()


def test_feedback_uaf_aemd_and_qoet_routes():
    run_id = _push_run(project="analysis-phase1")

    feedback = client.post(
        "/api/v1/feedback",
        json={"run_id": run_id, "feature": "mitigation", "item_id": "zne", "rating": "accepted"},
    )
    assert feedback.status_code == 200, feedback.text

    summary = client.get("/api/v1/feedback/summary")
    assert summary.status_code == 200
    assert summary.json()["mitigation"]["accepted"] >= 1

    uaf = client.get(f"/api/v1/runs/{run_id}/uaf-cpt")
    assert uaf.status_code == 200, uaf.text
    assert uaf.json()["algorithmic_fingerprint"]["n_qubits"] == 2

    aemd = client.get(f"/api/v1/runs/{run_id}/aemd")
    assert aemd.status_code == 200, aemd.text
    assert aemd.json()["dominant_hardware_source"]

    qoe = client.get(f"/api/v1/runs/{run_id}/qoe-telemetry")
    assert qoe.status_code == 200, qoe.text
    assert qoe.json()["snapshot_count"] == 2
