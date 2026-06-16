"""Submit a complex demo circuit to Q-Lab for visualization."""
import json, httpx
from datetime import datetime, timezone

# Build an 8-qubit QFT + a layered QAOA-style ansatz in QASM2
# We write the QASM by hand so we don't need qiskit installed here.
# This is a realistic 8-qubit Quantum Fourier Transform circuit.

QASM = """OPENQASM 2.0;
include "qelib1.inc";
qreg q[8];
creg c[8];

// === 8-qubit Quantum Fourier Transform ===

// Qubit 0
h q[0];
cp(pi/2) q[1],q[0];
cp(pi/4) q[2],q[0];
cp(pi/8) q[3],q[0];
cp(pi/16) q[4],q[0];
cp(pi/32) q[5],q[0];
cp(pi/64) q[6],q[0];
cp(pi/128) q[7],q[0];

// Qubit 1
h q[1];
cp(pi/2) q[2],q[1];
cp(pi/4) q[3],q[1];
cp(pi/8) q[4],q[1];
cp(pi/16) q[5],q[1];
cp(pi/32) q[6],q[1];
cp(pi/64) q[7],q[1];

// Qubit 2
h q[2];
cp(pi/2) q[3],q[2];
cp(pi/4) q[4],q[2];
cp(pi/8) q[5],q[2];
cp(pi/16) q[6],q[2];
cp(pi/32) q[7],q[2];

// Qubit 3
h q[3];
cp(pi/2) q[4],q[3];
cp(pi/4) q[5],q[3];
cp(pi/8) q[6],q[3];
cp(pi/16) q[7],q[3];

// Qubit 4
h q[4];
cp(pi/2) q[5],q[4];
cp(pi/4) q[6],q[4];
cp(pi/8) q[7],q[4];

// Qubit 5
h q[5];
cp(pi/2) q[6],q[5];
cp(pi/4) q[7],q[5];

// Qubit 6
h q[6];
cp(pi/2) q[7],q[6];

// Qubit 7
h q[7];

// Bit-reversal swaps
swap q[0],q[7];
swap q[1],q[6];
swap q[2],q[5];
swap q[3],q[4];

// === QAOA-style variational layer ===
// Entanglement ring
cx q[0],q[1];
rz(0.314) q[1];
cx q[0],q[1];
cx q[1],q[2];
rz(0.628) q[2];
cx q[1],q[2];
cx q[2],q[3];
rz(0.942) q[3];
cx q[2],q[3];
cx q[3],q[4];
rz(1.257) q[4];
cx q[3],q[4];
cx q[4],q[5];
rz(1.571) q[5];
cx q[4],q[5];
cx q[5],q[6];
rz(1.885) q[6];
cx q[5],q[6];
cx q[6],q[7];
rz(2.199) q[7];
cx q[6],q[7];
cx q[7],q[0];
rz(2.513) q[0];
cx q[7],q[0];

// Mixing layer
rx(0.5) q[0];
rx(0.5) q[1];
rx(0.5) q[2];
rx(0.5) q[3];
rx(0.5) q[4];
rx(0.5) q[5];
rx(0.5) q[6];
rx(0.5) q[7];

// Measurement
measure q -> c;
"""

payload = {
    "run_id": "demo-qft-qaoa-8qubit",
    "circuit_name": "8-qubit QFT + QAOA ansatz",
    "qasm": QASM,
    "fingerprint": {
        "num_qubits": 8,
        "num_clbits": 8,
        "depth": 52,
        "size": 68,
        "gate_counts": {"h": 8, "cp": 28, "swap": 4, "cx": 16, "rz": 8, "rx": 8, "measure": 8},
        "non_clifford_count": 44,
        "non_clifford_ratio": 0.647,
    },
    "context": {"python_version": "3.14.2", "platform": "win32"},
    "backend": "ibm_sherbrooke",
    "parameters": {"optimization_level": 3, "seed_transpiler": 42},
    "execution": {"job_id": "demo-job-001", "job_class": "RuntimeJob"},
    "calibration": {
        "t1_us": {"0": 198.4, "1": 212.1, "2": 187.3, "3": 221.8, "4": 195.6, "5": 208.9, "6": 193.2, "7": 217.4},
        "t2_us": {"0": 156.2, "1": 168.7, "2": 142.9, "3": 174.3, "4": 161.8, "5": 171.2, "6": 148.6, "7": 180.1},
        "readout_errors": {"0": 0.012, "1": 0.008, "2": 0.015, "3": 0.011, "4": 0.009, "5": 0.014, "6": 0.013, "7": 0.010},
        "gate_errors": {"cx_0_1": 0.0032, "cx_1_2": 0.0028, "cx_2_3": 0.0041, "cx_3_4": 0.0035},
        "snapshot_time": "2026-06-07T10:00:00Z",
    },
    "transpiler": {"optimization_level": 3, "routing_method": "sabre", "basis_gates": ["cx", "rz", "sx", "x"], "duration_ms": 1842},
    "timing": {"submit_time": "2026-06-07T10:01:00Z", "result_time": "2026-06-07T10:01:45Z"},
    "results": {"counts": {"00000000": 128, "11111111": 384, "10101010": 256, "01010101": 256}, "success_probability": 0.812},
    "project": "qft-demo",
    "tags": ["qft", "qaoa", "8qubit", "demo"],
    "status": "completed",
    "created_at": datetime.now(timezone.utc).isoformat(),
}

resp = httpx.post("http://127.0.0.1:8000/api/v1/runs", json=payload, timeout=10)
print(f"Status: {resp.status_code}")
print(resp.json())
