"""Calculators and simulators (group C): the values returned must follow from the inputs."""
import math
import time

import pytest

from tests.helpers import BELL, client

# ── qec_synthesizer ──────────────────────────────────────────────────────────

def test_qec_synthesis_counts_and_error_suppression():
    r = client.post("/api/v1/qec", json={"logical_qasm": BELL, "code": "surface_d5", "physical_error_rate": 0.001})
    body = r.json()
    assert body["n_logical_qubits"] == 2 and body["n_physical_qubits"] == 50
    assert body["n_syndrome_qubits"] == 48 and body["n_total_qubits"] == 98
    assert body["n_logical_gates"] == 2 and body["estimated_physical_gates"] == 2 * 25 * 3
    # 0.1 · (p / p_th)^((d+1)/2) = 0.1 · 0.1^3
    assert body["estimated_logical_error_rate"] == pytest.approx(1e-4)
    assert body["error_suppression_factor"] == 10.0
    assert body["encoded_qasm"].count("measure q[") == 2
    assert client.post("/api/v1/qec", json={"logical_qasm": BELL, "code": "toric"}).status_code == 400
    assert client.post("/api/v1/qec", json={"logical_qasm": BELL, "physical_error_rate": 0.5}).status_code == 422
    assert {c["id"] for c in client.get("/api/v1/qec/codes").json()} >= {"steane", "shor", "surface_d3"}


# ── quantum_network ──────────────────────────────────────────────────────────

def test_quantum_network_is_reproducible_and_degrades_with_distance():
    req = {"topology": "linear", "n_nodes": 4, "distance_km": 30, "seed": 7}
    a = client.post("/api/v1/quantum-network", json=req).json()
    b = client.post("/api/v1/quantum-network", json=req).json()
    assert a["end_to_end_fidelity"] == b["end_to_end_fidelity"]
    assert a["n_links"] == 3 and a["per_link_distance_km"] == 10.0
    assert [n["role"] for n in a["nodes"]] == ["end_node", "repeater", "repeater", "end_node"]
    assert len(a["fidelity_per_hop"]) == 3
    far = client.post("/api/v1/quantum-network", json={**req, "distance_km": 300}).json()
    assert far["end_to_end_fidelity"] < a["end_to_end_fidelity"]
    assert client.post("/api/v1/quantum-network", json={"n_nodes": 1}).status_code == 422
    assert client.post("/api/v1/quantum-network", json={"link_fidelity": 1.5}).status_code == 422


# ── quantum_rng ──────────────────────────────────────────────────────────────

def test_qrng_seeded_output_is_stored_and_never_certified():
    r = client.post("/api/v1/qrng", json={"n_bits": 64, "n_chsh_shots": 50, "seed": 11}).json()
    again = client.post("/api/v1/qrng", json={"n_bits": 64, "n_chsh_shots": 50, "seed": 11}).json()
    assert r["hex_output"] == again["hex_output"] and len(r["hex_output"]) == 16
    assert r["is_quantum_certified"] is False  # a classical PRNG, and the API says so
    ones = bin(int(r["hex_output"], 16)).count("1")
    assert r["randomness_tests"]["frequency_test"]["ones_ratio"] == round(ones / 64, 4)
    stored = client.get(f"/api/v1/qrng/{r['result_id']}").json()
    assert stored["hex_output"] == r["hex_output"]
    assert client.get("/api/v1/qrng/qrng-missing").status_code == 404
    assert client.post("/api/v1/qrng", json={"n_bits": 4}).status_code == 422


# ── quantum_sensing ──────────────────────────────────────────────────────────

def test_quantum_sensing_limits():
    body = client.post("/api/v1/quantum-sensing", json={
        "protocol": "ghz", "n_sensors": 4, "n_repetitions": 100, "interrogation_time_us": 10,
        "use_entanglement": True}).json()
    assert body["hl_sensitivity_phase"] == pytest.approx(1 / (10 * 10 * 4))
    assert body["sql_sensitivity_phase"] == body["hl_sensitivity_phase"]  # GHZ reaches the HL
    assert body["qfi_advantage_over_classical"] == 4.0
    assert body["decoherence_factor"] == pytest.approx(math.exp(-10 / 100) * math.exp(-10 / 2000), abs=1e-6)
    plain = client.post("/api/v1/quantum-sensing", json={
        "n_sensors": 4, "n_repetitions": 100, "interrogation_time_us": 10}).json()
    assert plain["sql_sensitivity_phase"] == pytest.approx(1 / (10 * 10 * 2))
    assert client.post("/api/v1/quantum-sensing", json={"n_sensors": 0}).status_code == 422


# ── resource_estimator ───────────────────────────────────────────────────────

def test_resource_estimate_for_a_custom_algorithm():
    body = client.post("/api/v1/resource-estimator", json={
        "algorithm": "custom", "n_logical_qubits": 10, "t_gate_count": 100, "clifford_gate_count": 1000}).json()
    d = body["code_distance"]
    assert d >= 3 and d % 2 == 1
    assert body["physical_per_logical"] == 2 * d * d
    assert body["logical_qubits_with_routing"] == 15
    assert body["total_physical_qubits"] == 15 * 2 * d * d + 900
    assert client.post("/api/v1/resource-estimator", json={"algorithm": "custom"}).status_code == 400
    assert client.post("/api/v1/resource-estimator", json={"algorithm": "nope"}).status_code == 400
    assert client.post("/api/v1/resource-estimator", json={"physical_error_rate": 0.5}).status_code == 422


# ── shot_calculator ──────────────────────────────────────────────────────────

def test_shot_calculator_bernoulli_and_readout():
    body = client.post("/api/v1/shots/calculate", json={
        "mode": "estimate_probability", "expected_probability": 0.5, "margin_of_error": 0.05,
        "confidence_level": 0.95, "readout_error": 0.1}).json()
    # n = 1.96² · 0.25 / 0.05² = 384.16 → 385; readout 10 % → ×1.25
    assert body["recommended_shots"] == 385
    assert body["readout_error_adjustment"] == math.ceil(385 * 1.25)
    tomo = client.post("/api/v1/shots/calculate", json={"mode": "tomography", "n_qubits": 3}).json()
    assert tomo["recommended_shots"] == 27_000
    quick = client.get("/api/v1/shots/quick/2").json()
    assert quick["tiers"]["standard"]["shots"] == 385 and quick["tomography_minimum"] == 9000
    batch = client.post("/api/v1/shots/batch", json=[{"mode": "tomography", "n_qubits": 1},
                                                      {"mode": "tomography", "n_qubits": 2}]).json()
    assert [b["recommended_shots"] for b in batch] == [3000, 9000]


def test_shot_calculator_rejects_unknown_mode():
    """Regression: an unknown mode answered 200 with an {"error": ...} body."""
    r = client.post("/api/v1/shots/calculate", json={"mode": "guess"})
    assert r.status_code == 422 and "Unknown mode" in r.json()["detail"]


# ── speedup_certifier ────────────────────────────────────────────────────────

def test_speedup_certifier():
    body = client.post("/api/v1/speedup-certifier", json={"problem": "sampling", "n_qubits": 2}).json()
    assert body["problem_type"] == "sampling"
    assert body["speedup_ratio"] == round(body["classical_time_estimate_ms"]
                                          / max(body["quantum_time_estimate_ms"], 1e-9), 4)
    assert body["advantage_certified"] is False and body["crossover_n_qubits"] > 2
    assert client.post("/api/v1/speedup-certifier", json={"n_qubits": 1}).status_code == 422
    assert "sampling" in {p["problem_id"] for p in client.get("/api/v1/speedup-certifier/problems").json()}


# ── syndrome_decoder ─────────────────────────────────────────────────────────

def test_syndrome_decoder_without_errors_and_reproducibly():
    clean = client.post("/api/v1/syndrome-decoder", json={"code": "repetition_d3", "error_rate": 0.0, "seed": 1}).json()
    assert clean["syndrome_pattern"] == [0, 0] and clean["n_triggered_syndromes"] == 0
    assert clean["correction_operator"] == "III" and clean["logical_error_rate_estimate"] == 0.0
    assert clean["error_locations"] == []
    req = {"code": "surface_d3", "error_rate": 0.05, "seed": 42}
    a = client.post("/api/v1/syndrome-decoder", json=req).json()
    b = client.post("/api/v1/syndrome-decoder", json=req).json()
    assert a["syndrome_pattern"] == b["syndrome_pattern"]
    assert a["logical_error_rate_estimate"] == b["logical_error_rate_estimate"]
    assert a["decoder_success_rate"] == pytest.approx(1 - a["logical_error_rate_estimate"])
    assert client.post("/api/v1/syndrome-decoder", json={"error_rate": 0.9}).status_code == 422


# ── transpiler ───────────────────────────────────────────────────────────────

def test_transpile_to_ibm_is_equivalent():
    qiskit = pytest.importorskip("qiskit")
    from qiskit.quantum_info import Operator

    src = ('OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\n'
           'h q[0];\ns q[1];\nt q[0];\nz q[1];\ncz q[0],q[1];\nrz(pi/3) q[0];\ncx q[1],q[0];\n')
    body = client.post("/api/v1/transpile/ibm", json={"qasm": src}).json()
    out = body["transpiled_qasm"]
    assert "h q[0]" not in out and "sx q[0];" in out
    native = {line.split("(")[0].split()[0] for line in out.splitlines()[3:] if line.strip()}
    assert native <= {"rz", "sx", "x", "cx", "id"}
    # Angles are written with 6 decimals, so compare to 1e-5.
    assert Operator(qiskit.QuantumCircuit.from_qasm_str(out)).equiv(
        Operator(qiskit.QuantumCircuit.from_qasm_str(src)), atol=1e-5)

    many = client.post("/api/v1/transpile", json={"qasm": src, "providers": ["ibm", "ionq"]}).json()
    assert set(many["results"]) == {"ibm", "ionq"}
    assert client.post("/api/v1/transpile", json={"qasm": src, "providers": ["dwave"]}).status_code == 422
    assert client.post("/api/v1/transpile/dwave", json={"qasm": src}).status_code == 422


def test_transpile_angles_are_not_evaluated_as_code():
    """Regression: gate angles went through eval(), so an angle like 9**9**9**9 tied up a worker."""
    src = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[1];\nrz(9**9**9**9) q[0];\nrz(-pi/2) q[0];\nrz(2*pi/4+1) q[0];\n'
    started = time.monotonic()
    body = client.post("/api/v1/transpile/ibm", json={"qasm": src}).json()
    assert time.monotonic() - started < 30
    lines = [line for line in body["transpiled_qasm"].splitlines() if line.startswith("rz")]
    assert lines == ["rz(0) q[0];", "rz(-1.570796) q[0];", f"rz({math.pi / 2 + 1:.6f}) q[0];"]


# ── trotter_evolution ────────────────────────────────────────────────────────

def test_trotter_without_field_conserves_energy_and_magnetisation():
    """Regression: the default initial state "neel" crashed (str.join called with two arguments)."""
    body = client.post("/api/v1/trotter", json={
        "n_qubits": 4, "h": 0.0, "J": 1.0, "n_steps": 5, "t_total": 1.0, "initial_state": "neel"}).json()
    # Néel state |0101>: every neighbouring pair anti-aligned → E = -J·(-3) = 3, conserved when h = 0.
    assert set(body["energy_evolution"]) == {3.0}
    assert body["energy_conservation_error"] == 0.0
    assert set(body["magnetization_evolution"]) == {0.0}
    assert body["final_probabilities"][0] == pytest.approx(1.0)
    moving = client.post("/api/v1/trotter", json={"n_qubits": 3, "h": 1.0, "initial_state": "all_up"}).json()
    assert sum(moving["final_probabilities"]) == pytest.approx(1.0, abs=1e-6)  # 2^3 = 8 states, all listed
    assert moving["magnetization_evolution"][-1] < 1.0
    assert client.post("/api/v1/trotter", json={"hamiltonian": "hubbard"}).status_code == 400
    assert client.post("/api/v1/trotter", json={"n_qubits": 9}).status_code == 422


# ── unitary_synth ────────────────────────────────────────────────────────────

def _c(m):
    return [[[z.real, z.imag] for z in row] for row in m]


@pytest.mark.parametrize("name, matrix", [
    ("H", [[1 / math.sqrt(2), 1 / math.sqrt(2)], [1 / math.sqrt(2), -1 / math.sqrt(2)]]),
    ("S", [[1, 0], [0, 1j]]),
    ("X", [[0, 1], [1, 0]]),
    ("Y", [[0, -1j], [1j, 0]]),
    ("U", [[math.cos(0.4), -complex(math.cos(0.7), math.sin(0.7)) * math.sin(0.4)],
           [complex(math.cos(1.1), math.sin(1.1)) * math.sin(0.4),
            complex(math.cos(1.8), math.sin(1.8)) * math.cos(0.4)]]),
])
def test_unitary_synth_single_qubit_reproduces_the_matrix(name, matrix):
    """Regression: the 1-qubit ZYZ angles were wrong (H came out as Rz(π/2)·Ry(π/2)·Rz(π/2))."""
    qiskit = pytest.importorskip("qiskit")
    from qiskit.quantum_info import Operator

    body = client.post("/api/v1/unitary-synth", json={"unitary": _c(matrix)}).json()
    assert body["n_qubits"] == 1 and body["is_unitary"] is True
    qc = qiskit.QuantumCircuit(1)
    for g in body["gate_sequence"]:
        if g["gate"] != "id":
            getattr(qc, g["gate"])(*g["params"], 0)
    assert Operator(qc).equiv(Operator(matrix), atol=1e-5), name  # angles are rounded to 6 decimals


def test_unitary_synth_validation():
    assert client.post("/api/v1/unitary-synth", json={"unitary": _c([[1, 0, 0], [0, 1, 0], [0, 0, 1]])}).status_code == 422
    assert client.post("/api/v1/unitary-synth", json={"unitary": [[[1, 0], [0, 0]], [[0, 0]]]}).status_code == 422
    assert client.post("/api/v1/unitary-synth", json={"unitary": [[[1], [0, 0]], [[0, 0], [1, 0]]]}).status_code == 422
    not_unitary = client.post("/api/v1/unitary-synth", json={"unitary": _c([[2, 0], [0, 1]])}).json()
    assert not_unitary["is_unitary"] is False


# ── sdk_compat ───────────────────────────────────────────────────────────────

def test_sdk_compat_lists_frameworks_and_versions():
    fw = client.get("/api/v1/sdk/frameworks").json()
    assert fw["total"] == len(fw["frameworks"]) == 4
    assert {f["name"]: f["status"] for f in fw["frameworks"]}["qiskit"] == "native"
    v = client.get("/api/v1/sdk/version").json()
    assert v["compatible_frameworks"]["qiskit"] == ">=1.0.0"


# ── vqe_tracker ──────────────────────────────────────────────────────────────

def test_vqe_tracker_convergence_analysis():
    v = client.post("/api/v1/variational", json={"algorithm": "vqe", "n_qubits": 2, "n_parameters": 1}).json()
    vid = v["vrun_id"]
    for i, e in enumerate([-1.0, -1.1, -1.2, -1.3, -1.4]):
        r = client.post(f"/api/v1/variational/{vid}/iterations", json={"energy": e, "params": [0.1 * i]}).json()
    assert r["n_iterations"] == 5 and r["convergence_status"] == "converging"
    assert r["gradient_norm"] == pytest.approx(0.1)
    detail = client.get(f"/api/v1/variational/{vid}").json()
    assert detail["optimal_energy"] == -1.4 and detail["optimal_params"] == [pytest.approx(0.4)]
    a = detail["analysis"]
    assert a["energy_slope"] == pytest.approx(-0.1) and a["estimated_minimum"] == pytest.approx(-2.8)
    done = client.post(f"/api/v1/variational/{vid}/complete", json={"optimal_energy": -1.45}).json()
    assert done["optimal_energy"] == -1.45
    assert vid in {x["vrun_id"] for x in client.get("/api/v1/variational?algorithm=vqe&limit=200").json()}
    assert client.post("/api/v1/variational", json={"algorithm": "grover"}).status_code == 422
    assert client.get("/api/v1/variational/vrun-missing").status_code == 404
