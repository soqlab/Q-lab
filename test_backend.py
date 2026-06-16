#!/usr/bin/env python3
"""
Test the Q-Lab backend API without Qiskit dependencies.
Demonstrates the circuit capture flow with mock data.
"""

import json
import httpx
from datetime import datetime

# Backend API configuration
API_URL = "http://localhost:8000"
HEADERS = {"Content-Type": "application/json"}

def test_health():
    """Test the /health endpoint."""
    print("Testing /health endpoint...")
    response = httpx.get(f"{API_URL}/health", verify=False)
    print(f"Status: {response.status_code}")
    print(f"Response: {response.json()}\n")
    return response.status_code == 200

def test_submit_run():
    """Test submitting a circuit run to the backend."""
    print("Testing POST /api/v1/runs endpoint...")
    
    # Mock circuit data (what the SDK would capture from Qiskit)
    payload = {
        "run_id": "run_20250101_001",
        "circuit_name": "Bell Circuit Test",
        "qasm": """OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
cx q[0],q[1];
measure q[0] -> c[0];
measure q[1] -> c[1];""",
        "fingerprint": {
            "num_qubits": 2,
            "num_clbits": 2,
            "depth": 3,
            "size": 4,
            "gate_counts": {
                "h": 1,
                "cx": 1,
                "measure": 2
            },
            "non_clifford_count": 0,
            "non_clifford_ratio": 0.0
        },
        "context": {
            "python_version": "3.14.2",
            "platform": "Windows-10-10.0.19045-SP1",
            "git_commit": "abc123def456",
            "git_branch": "main"
        },
        "backend": "local-test",
        "created_at": datetime.now().isoformat()
    }
    
    response = httpx.post(
        f"{API_URL}/api/v1/runs",
        json=payload,
        headers=HEADERS,
        verify=False
    )
    print(f"Status: {response.status_code}")
    print(f"Response: {response.json()}\n")
    return response.status_code == 200

def test_list_runs():
    """Test listing all captured runs."""
    print("Testing GET /api/v1/runs endpoint...")
    response = httpx.get(f"{API_URL}/api/v1/runs")
    print(f"Status: {response.status_code}")
    data = response.json()
    print(f"Number of runs: {len(data)}")
    if data:
        print(f"First run: {json.dumps(data[0], indent=2)}\n")
    return response.status_code == 200

def main():
    """Run all tests."""
    print("=" * 60)
    print("Q-Lab Backend API Test Suite")
    print("=" * 60 + "\n")
    
    try:
        # Test health
        health_ok = test_health()
        
        if not health_ok:
            print("❌ Health check failed!")
            return
        
        # Test submit run
        submit_ok = test_submit_run()
        
        # Test list runs
        list_ok = test_list_runs()
        
        print("=" * 60)
        if all([health_ok, submit_ok, list_ok]):
            print("✅ All tests passed!")
            print("\nBackend is ready for SDK integration.")
            print("Next: Install Qiskit SDK and run circuit capture examples.")
        else:
            print("❌ Some tests failed")
        print("=" * 60)
        
    except Exception as e:
        print(f"❌ Error during testing: {e}")

if __name__ == "__main__":
    main()
