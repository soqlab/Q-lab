from __future__ import annotations

import argparse
from datetime import datetime, timezone

import httpx


def assert_ok(response: httpx.Response, label: str) -> None:
    if response.status_code >= 400:
        raise RuntimeError(f"{label} failed: {response.status_code} {response.text}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Smoke test a running Q-Lab service.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--api-key", default=None)
    args = parser.parse_args()

    base_url = args.base_url.rstrip("/")
    headers = {}
    if args.api_key:
        headers["X-QLab-API-Key"] = args.api_key

    with httpx.Client(timeout=10.0, follow_redirects=True) as client:
        health = client.get(f"{base_url}/health")
        assert_ok(health, "health")

        ui = client.get(f"{base_url}/ui")
        assert_ok(ui, "ui")
        if "Q-Lab Dashboard" not in ui.text:
            raise RuntimeError("ui did not return the dashboard HTML")

        run_id = f"smoke-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"
        payload = {
            "run_id": run_id,
            "circuit_name": "Smoke Test Circuit",
            "qasm": "OPENQASM 2.0;\nh q[0];\n",
            "fingerprint": {
                "num_qubits": 1,
                "num_clbits": 0,
                "depth": 1,
                "size": 1,
                "gate_counts": {"h": 1},
                "non_clifford_count": 0,
                "non_clifford_ratio": 0,
            },
            "context": {
                "source": "scripts/smoke_test.py",
                "python_version": "smoke",
            },
            "backend": "smoke-backend",
            "parameters": {"shots": 128},
            "execution": {"job_id": "smoke-job", "provider": "smoke"},
            "results": {"counts": {"0": 64, "1": 64}},
            "project": "smoke",
            "tags": ["smoke"],
            "status": "submitted",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

        created = client.post(f"{base_url}/api/v1/runs", json=payload, headers=headers)
        assert_ok(created, "create run")

        run = client.get(f"{base_url}/api/v1/runs/{run_id}")
        assert_ok(run, "get run")

        updated = client.patch(
            f"{base_url}/api/v1/runs/{run_id}",
            json={
                "status": "completed",
                "execution": {"result_status": "done"},
                "results": {"success_probability": 0.5},
            },
            headers=headers,
        )
        assert_ok(updated, "update run")
        if updated.json()["execution"]["result_status"] != "done":
            raise RuntimeError("run update did not persist execution metadata")
        if updated.json()["results"]["success_probability"] != 0.5:
            raise RuntimeError("run update did not persist result metadata")

        bundle = client.get(f"{base_url}/api/v1/runs/{run_id}/bundle.zip")
        assert_ok(bundle, "bundle")
        if bundle.headers.get("content-type") != "application/zip":
            raise RuntimeError("bundle did not return application/zip")

        compare = client.get(f"{base_url}/api/v1/runs/compare/{run_id}/{run_id}/json")
        assert_ok(compare, "compare")
        if compare.json()["summary"]["same_qasm"] is not True:
            raise RuntimeError("compare summary did not report same_qasm=true")

        metrics = client.get(f"{base_url}/api/v1/metrics/runs?project=smoke")
        assert_ok(metrics, "metrics")
        metrics_json = metrics.json()
        if metrics_json["total_runs"] < 1:
            raise RuntimeError("metrics did not include the smoke run")
        if "smoke-backend" not in metrics_json["by_backend"]:
            raise RuntimeError("metrics did not aggregate backend usage")

        csv_export = client.get(f"{base_url}/api/v1/exports/runs.csv?project=smoke")
        assert_ok(csv_export, "csv export")
        if "run_id" not in csv_export.text or run_id not in csv_export.text:
            raise RuntimeError("csv export did not include the smoke run")

        jsonl_export = client.get(f"{base_url}/api/v1/exports/runs.jsonl?project=smoke")
        assert_ok(jsonl_export, "jsonl export")
        if run_id not in jsonl_export.text:
            raise RuntimeError("jsonl export did not include the smoke run")

        report = client.get(f"{base_url}/api/v1/reports/runs.md?project=smoke")
        assert_ok(report, "markdown report")
        if "# Q-Lab Experiment Report" not in report.text:
            raise RuntimeError("markdown report did not include expected heading")

    print(f"Q-Lab smoke test passed for {base_url}")


if __name__ == "__main__":
    main()
