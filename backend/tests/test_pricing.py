"""The shared price table: arithmetic, provenance, stale warnings and "not public"."""

from datetime import date, timedelta
from urllib.parse import urlparse

import pytest
from fastapi.testclient import TestClient

from app import pricing
from app.database import init_db
from app.main import app

init_db()
client = TestClient(app, raise_server_exceptions=False)


# ── The table itself ──────────────────────────────────────────────────────────

def test_every_entry_has_a_source_and_a_verified_date():
    assert pricing.PRICES
    for key, p in pricing.PRICES.items():
        assert urlparse(p["source"]).scheme == "https", key
        date.fromisoformat(p["verified_on"])  # raises if malformed
        assert p["model"] in {"task_shot", "gate_shot", "time_based", "per_minute", "free", "not_public"}, key


def test_published_braket_prices():
    """Figures from https://aws.amazon.com/braket/pricing/ (checked 2026-11-05)."""
    forte = pricing.PRICES["braket_ionq_forte"]
    assert (forte["per_task_usd"], forte["per_shot_usd"]) == (0.30, 0.08)
    rigetti = pricing.PRICES["braket_rigetti_cepheus"]
    assert (rigetti["per_task_usd"], rigetti["per_shot_usd"]) == (0.30, 0.000425)


# ── Arithmetic ────────────────────────────────────────────────────────────────

def test_task_shot_is_task_fee_plus_shots():
    assert pricing.estimate_amount("braket_ionq_forte", 1000) == pytest.approx(0.30 + 1000 * 0.08)
    assert pricing.estimate_amount("braket_rigetti_cepheus", 1000) == pytest.approx(0.725)
    # Each task pays its own fee.
    assert pricing.estimate_amount("braket_rigetti_cepheus", 1000, tasks=3) == pytest.approx(3 * 0.725)


def test_gate_shot_has_a_minimum_per_program():
    p = pricing.PRICES["azure_ionq_aria"]
    tiny = pricing.estimate_amount("azure_ionq_aria", 100, one_q_gates=2, two_q_gates=1)
    assert tiny == pytest.approx(p["min_usd_per_task"])
    big = pricing.estimate_amount("azure_ionq_aria", 10_000, one_q_gates=50, two_q_gates=20)
    assert big == pytest.approx(10_000 * (50 * 0.000220 + 20 * 0.000975))
    em = pricing.estimate_amount("azure_ionq_aria", 100, one_q_gates=2, two_q_gates=1, error_mitigation=True)
    assert em == pytest.approx(p["min_usd_per_task_error_mitigation"])


def test_time_based_and_per_minute():
    assert pricing.estimate_amount("ibm_payg", 1000, qpu_seconds=10) == pytest.approx(16.0)
    assert pricing.estimate_amount("ibm_payg", 1000, qpu_seconds=0.2) == pytest.approx(1.60)  # 1 s minimum
    assert pricing.estimate_amount("azure_rigetti_cepheus", 1, qpu_seconds=0.01) == pytest.approx(0.02)
    assert pricing.estimate_amount("braket_sv1", 1, qpu_seconds=1) == pytest.approx(3 / 60 * 0.075)  # 3 s minimum


def test_free_and_not_public():
    assert pricing.estimate_amount("local_simulator", 10_000) == 0.0
    assert pricing.estimate_amount("azure_quantinuum_h2", 100) is None
    est = pricing.estimate("quantinuum_direct", 100)
    assert est["amount"] is None and est["price_display"] == "not public"


def test_backend_names_resolve():
    assert pricing.resolve("ibm_brisbane") == "ibm_payg"
    assert pricing.resolve("fake_brisbane") == "local_simulator"
    assert pricing.resolve("aer_simulator") == "local_simulator"
    assert pricing.resolve("ionq") == "braket_ionq_forte"
    assert pricing.resolve("quantinuum_h2") == "quantinuum_direct"
    assert pricing.resolve("oqc_lucy") is None  # no longer sold with a public price


# ── Stale warning ─────────────────────────────────────────────────────────────

def test_stale_after_thirty_days():
    verified = date.fromisoformat(pricing.PRICES["ibm_payg"]["verified_on"])
    fresh = pricing.provenance("ibm_payg", today=verified + timedelta(days=30))
    assert fresh["pricing_stale"] is False and fresh["stale_warning"] is None
    old = pricing.provenance("ibm_payg", today=verified + timedelta(days=31))
    assert old["pricing_stale"] is True
    assert verified.isoformat() in old["stale_warning"] and "ibm.com/quantum/pricing" in old["stale_warning"]


@pytest.fixture
def stale_ibm(monkeypatch):
    entry = dict(pricing.PRICES["ibm_payg"], verified_on="2020-01-01")
    monkeypatch.setitem(pricing.PRICES, "ibm_payg", entry)


# ── Endpoints carry source, date and warning ─────────────────────────────────

def test_costs_estimate_carries_source_and_date():
    r = client.get("/api/v1/costs/estimate", params={"provider": "ionq", "backend": "forte", "shots": 1000})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["estimated_usd"] == pytest.approx(80.30)
    assert body["pricing_source"] == "https://aws.amazon.com/braket/pricing/"
    assert body["pricing_verified"] == pricing.PRICES["braket_ionq_forte"]["verified_on"]
    assert "stale_warning" in body


def test_costs_estimate_stale_warning(stale_ibm):
    r = client.get("/api/v1/costs/estimate", params={"provider": "ibm", "backend": "ibm_brisbane", "shots": 100})
    body = r.json()
    assert body["pricing_stale"] is True and "2020-01-01" in body["stale_warning"]


def test_costs_estimate_not_public():
    r = client.get("/api/v1/costs/estimate", params={"provider": "quantinuum", "backend": "h2-1"})
    assert r.status_code == 200, r.text
    assert r.json()["estimated_usd"] is None and r.json()["price_display"] == "not public"


def test_cost_oracle_rows_carry_provenance(stale_ibm):
    r = client.post("/api/v1/cost-oracle/estimate", json={"n_shots": 1000, "n_circuits": 2})
    assert r.status_code == 200, r.text
    body = r.json()
    rows = {p["provider_id"]: p for p in body["providers"]}
    assert rows["braket_ionq_forte"]["cost_total_usd"] == pytest.approx(2 * 80.30)
    assert rows["azure_quantinuum_h2"]["cost_total_usd"] is None
    assert rows["azure_quantinuum_h2"]["price_display"] == "not public"
    assert rows["ibm_payg"]["pricing_stale"] is True
    assert any("2020-01-01" in w for w in body["stale_warnings"])
    assert all(p["pricing_source"].startswith("https://") for p in body["providers"])
    # Cheapest is a USD price that exists.
    assert rows[body["cheapest_provider"]]["cost_total_usd"] is not None


def test_provider_pricing_lists_stale_entries(stale_ibm):
    body = client.get("/api/v1/costs/provider-pricing").json()
    assert "ibm_payg" in body["stale_entries"]
    assert body["providers"]["braket_ionq_forte"]["pricing_source"].startswith("https://aws.amazon.com/")


# ── Every router that quotes a price reads the same table ────────────────────

QASM = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\ncreg c[2];\nh q[0];\ncx q[0],q[1];\nmeasure q -> c;'


def test_job_router_quotes_carry_sources():
    r = client.post("/api/v1/jobs/route", json={"qasm": QASM, "shots": 1000, "preference": "cost"})
    assert r.status_code == 200, r.text
    rankings = {x["backend"]: x for x in r.json()["rankings"]}
    assert rankings["ionq_forte_1"]["estimated_cost_usd"] == pytest.approx(80.30)
    assert all(x["pricing_source"].startswith("https://") for x in rankings.values())


def test_scheduler_skips_backends_without_a_public_price():
    r = client.post("/api/v1/job-scheduler/optimize", json={
        "circuits": [{"circuit_id": "c1", "n_qubits": 2, "circuit_depth": 3, "n_shots": 1000}],
    })
    assert r.status_code == 200, r.text
    assert all(a["backend"] != "quantinuum_h2" for a in r.json()["assignments"])
    assert any("quantinuum_h2" in rec for rec in r.json()["recommendations"])


def test_providers_list_says_not_public():
    rows = {p["id"]: p for p in client.get("/api/v1/providers").json()["providers"]}
    assert rows["google_quantum_ai"]["price_display"] == "not public"
    assert rows["aws_braket_rigetti"]["pricing_source"] == "https://aws.amazon.com/braket/pricing/"


def test_cost_tracker_prices_runs_from_the_table():
    from app.routers.cost_tracker import _estimate_cost

    forte = _estimate_cost({"backend": "ionq_forte", "execution": {"shots": 1000}})
    assert forte["cost_usd"] == pytest.approx(80.30) and forte["pricing_key"] == "braket_ionq_forte"
    sim = _estimate_cost({"backend": "aer_simulator", "execution": {"shots": 1000}})
    assert sim["cost_usd"] == 0.0 and sim["unit"] == "free"
    unknown = _estimate_cost({"backend": "oqc_lucy", "execution": {"shots": 1000}})
    assert unknown["priced"] is False and unknown["cost_usd"] == 0.0
    assert "prices_used" in client.get("/api/v1/cost-tracker/summary").json()


def test_lab_assistant_cost_tool_reports_sources():
    from app.database import SessionLocal
    from app.routers.lab_assistant import _execute_tool

    with SessionLocal() as db:
        out = _execute_tool("estimate_cost", {"n_qubits": 2, "circuit_depth": 3, "n_shots": 1000}, db)
    assert "not public" in out and "https://aws.amazon.com/braket/pricing/" in out
