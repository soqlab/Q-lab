"""Experiment Template Marketplace — a GitHub-for-quantum-circuits.

Researchers share, fork, star, and run experiment templates containing
real QASM 2.0 circuits and Qiskit Python code.

Router prefix: /api/v1/templates
"""
from __future__ import annotations

import random
import string
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_delete, store_get, store_list, store_put, store_seed

router = APIRouter(prefix="/api/v1/experiment-templates", tags=["templates"])

_NS = "experiment_templates"


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic models
# ─────────────────────────────────────────────────────────────────────────────

class ExperimentTemplate(BaseModel):
    template_id: str
    name: str
    slug: str
    description: str
    algorithm: str
    category: str
    author: str
    institution: Optional[str] = None
    qasm_circuit: str
    python_code: str
    parameters_schema: Dict[str, Any]
    n_qubits_range: List[int]
    tags: List[str]
    paper_reference: Optional[str] = None
    fork_count: int = 0
    run_count: int = 0
    star_count: int = 0
    is_verified: bool = False
    is_featured: bool = False
    created_at: str
    updated_at: str


class TemplateCreate(BaseModel):
    name: str
    slug: Optional[str] = None
    description: str
    algorithm: str
    category: str
    author: str
    institution: Optional[str] = None
    qasm_circuit: str
    python_code: str = ""
    parameters_schema: Dict[str, Any] = {}
    n_qubits_range: List[int] = [1, 10]
    tags: List[str] = []
    paper_reference: Optional[str] = None


class RunTemplateRequest(BaseModel):
    parameters: Dict[str, Any] = {}


# ─────────────────────────────────────────────────────────────────────────────
# Seed data — 10 templates with real OpenQASM 2.0
# ─────────────────────────────────────────────────────────────────────────────

_SEED_TEMPLATES: list[tuple[str, dict]] = [
    (
        "tpl_bell_state",
        {
            "template_id": "tpl_bell_state",
            "name": "Bell State Preparation",
            "slug": "bell-state-preparation",
            "description": "Prepare a maximally entangled 2-qubit Bell state |Φ+⟩ = (|00⟩ + |11⟩)/√2.",
            "algorithm": "custom",
            "category": "education",
            "author": "Q-Lab Team",
            "institution": "Q-Lab",
            "qasm_circuit": (
                "OPENQASM 2.0;\n"
                'include "qelib1.inc";\n'
                "qreg q[2];\n"
                "creg c[2];\n"
                "h q[0];\n"
                "cx q[0],q[1];\n"
                "measure q -> c;"
            ),
            "python_code": (
                "from qiskit import QuantumCircuit\n"
                "qc = QuantumCircuit(2, 2)\n"
                "qc.h(0)\n"
                "qc.cx(0, 1)\n"
                "qc.measure([0, 1], [0, 1])\n"
            ),
            "parameters_schema": {},
            "n_qubits_range": [2, 2],
            "tags": ["entanglement", "bell-state", "2-qubit"],
            "paper_reference": None,
            "fork_count": 42,
            "run_count": 310,
            "star_count": 88,
            "is_verified": True,
            "is_featured": True,
            "created_at": "2024-01-10T00:00:00+00:00",
            "updated_at": "2024-01-10T00:00:00+00:00",
        },
    ),
    (
        "tpl_vqe_h2",
        {
            "template_id": "tpl_vqe_h2",
            "name": "VQE H₂ Molecule",
            "slug": "vqe-h2-molecule",
            "description": "Variational Quantum Eigensolver for ground state energy of H₂ using UCCSD ansatz on 4 qubits.",
            "algorithm": "vqe",
            "category": "chemistry",
            "author": "Q-Lab Team",
            "institution": "Q-Lab",
            "qasm_circuit": (
                "OPENQASM 2.0;\n"
                'include "qelib1.inc";\n'
                "qreg q[4];\n"
                "creg c[4];\n"
                "x q[0];\n"
                "x q[1];\n"
                "h q[2];\n"
                "cx q[2],q[3];\n"
                "ry(0.5) q[0];\n"
                "ry(0.5) q[1];\n"
                "cx q[0],q[2];\n"
                "cx q[1],q[3];\n"
                "rz(0.1) q[2];\n"
                "rz(0.1) q[3];\n"
                "cx q[0],q[2];\n"
                "cx q[1],q[3];\n"
                "ry(-0.5) q[0];\n"
                "ry(-0.5) q[1];\n"
                "measure q -> c;"
            ),
            "python_code": (
                "from qiskit import QuantumCircuit\n"
                "from qiskit.circuit import Parameter\n"
                "theta = Parameter('theta')\n"
                "qc = QuantumCircuit(4, 4)\n"
                "qc.x([0, 1])\n"
                "qc.h(2)\n"
                "qc.cx(2, 3)\n"
                "qc.ry(theta, 0)\n"
                "qc.ry(theta, 1)\n"
                "qc.cx(0, 2)\n"
                "qc.cx(1, 3)\n"
                "qc.rz(theta / 5, 2)\n"
                "qc.rz(theta / 5, 3)\n"
                "qc.cx(0, 2)\n"
                "qc.cx(1, 3)\n"
                "qc.ry(-theta, 0)\n"
                "qc.ry(-theta, 1)\n"
                "qc.measure_all()\n"
            ),
            "parameters_schema": {
                "theta": {"type": "float", "default": 0.5, "description": "Ansatz rotation angle"},
            },
            "n_qubits_range": [4, 4],
            "tags": ["vqe", "chemistry", "h2", "uccsd"],
            "paper_reference": "arXiv:1704.05018",
            "fork_count": 67,
            "run_count": 512,
            "star_count": 134,
            "is_verified": True,
            "is_featured": True,
            "created_at": "2024-01-15T00:00:00+00:00",
            "updated_at": "2024-01-15T00:00:00+00:00",
        },
    ),
    (
        "tpl_qaoa_maxcut",
        {
            "template_id": "tpl_qaoa_maxcut",
            "name": "QAOA MaxCut 6-node",
            "slug": "qaoa-maxcut-6-node",
            "description": "QAOA p=1 layer for MaxCut on a 6-node ring graph using 6 qubits.",
            "algorithm": "qaoa",
            "category": "optimization",
            "author": "Q-Lab Community",
            "institution": None,
            "qasm_circuit": (
                "OPENQASM 2.0;\n"
                'include "qelib1.inc";\n'
                "qreg q[6];\n"
                "creg c[6];\n"
                "h q[0];\n"
                "h q[1];\n"
                "h q[2];\n"
                "h q[3];\n"
                "h q[4];\n"
                "h q[5];\n"
                "cx q[0],q[1];\n"
                "rz(0.6) q[1];\n"
                "cx q[0],q[1];\n"
                "cx q[1],q[2];\n"
                "rz(0.6) q[2];\n"
                "cx q[1],q[2];\n"
                "cx q[2],q[3];\n"
                "rz(0.6) q[3];\n"
                "cx q[2],q[3];\n"
                "cx q[3],q[4];\n"
                "rz(0.6) q[4];\n"
                "cx q[3],q[4];\n"
                "cx q[4],q[5];\n"
                "rz(0.6) q[5];\n"
                "cx q[4],q[5];\n"
                "cx q[5],q[0];\n"
                "rz(0.6) q[0];\n"
                "cx q[5],q[0];\n"
                "rx(0.8) q[0];\n"
                "rx(0.8) q[1];\n"
                "rx(0.8) q[2];\n"
                "rx(0.8) q[3];\n"
                "rx(0.8) q[4];\n"
                "rx(0.8) q[5];\n"
                "measure q -> c;"
            ),
            "python_code": (
                "from qiskit import QuantumCircuit\n"
                "from qiskit.circuit import Parameter\n"
                "gamma = Parameter('gamma')\n"
                "beta = Parameter('beta')\n"
                "qc = QuantumCircuit(6, 6)\n"
                "qc.h(range(6))\n"
                "edges = [(0,1),(1,2),(2,3),(3,4),(4,5),(5,0)]\n"
                "for u, v in edges:\n"
                "    qc.cx(u, v)\n"
                "    qc.rz(2 * gamma, v)\n"
                "    qc.cx(u, v)\n"
                "for i in range(6):\n"
                "    qc.rx(2 * beta, i)\n"
                "qc.measure_all()\n"
            ),
            "parameters_schema": {
                "gamma": {"type": "float", "default": 0.6, "description": "Phase separator angle"},
                "beta": {"type": "float", "default": 0.4, "description": "Mixer angle"},
            },
            "n_qubits_range": [6, 6],
            "tags": ["qaoa", "maxcut", "optimization", "combinatorial"],
            "paper_reference": "arXiv:1411.4028",
            "fork_count": 29,
            "run_count": 198,
            "star_count": 55,
            "is_verified": False,
            "is_featured": False,
            "created_at": "2024-02-01T00:00:00+00:00",
            "updated_at": "2024-02-01T00:00:00+00:00",
        },
    ),
    (
        "tpl_grover_4q",
        {
            "template_id": "tpl_grover_4q",
            "name": "Grover Search 4-qubit",
            "slug": "grover-search-4-qubit",
            "description": "Grover's search algorithm on 4 qubits with oracle marking |1111⟩.",
            "algorithm": "grover",
            "category": "education",
            "author": "Q-Lab Team",
            "institution": "Q-Lab",
            "qasm_circuit": (
                "OPENQASM 2.0;\n"
                'include "qelib1.inc";\n'
                "qreg q[4];\n"
                "creg c[4];\n"
                "h q[0];\n"
                "h q[1];\n"
                "h q[2];\n"
                "h q[3];\n"
                "ccx q[0],q[1],q[2];\n"
                "cx q[2],q[3];\n"
                "ccx q[0],q[1],q[2];\n"
                "h q[0];\n"
                "h q[1];\n"
                "h q[2];\n"
                "h q[3];\n"
                "x q[0];\n"
                "x q[1];\n"
                "x q[2];\n"
                "x q[3];\n"
                "ccx q[0],q[1],q[2];\n"
                "cx q[2],q[3];\n"
                "ccx q[0],q[1],q[2];\n"
                "x q[0];\n"
                "x q[1];\n"
                "x q[2];\n"
                "x q[3];\n"
                "h q[0];\n"
                "h q[1];\n"
                "h q[2];\n"
                "h q[3];\n"
                "measure q -> c;"
            ),
            "python_code": (
                "from qiskit import QuantumCircuit\n"
                "qc = QuantumCircuit(4, 4)\n"
                "qc.h(range(4))\n"
                "# Oracle: mark |1111>\n"
                "qc.ccx(0, 1, 2)\n"
                "qc.cx(2, 3)\n"
                "qc.ccx(0, 1, 2)\n"
                "# Diffusion\n"
                "qc.h(range(4))\n"
                "qc.x(range(4))\n"
                "qc.ccx(0, 1, 2)\n"
                "qc.cx(2, 3)\n"
                "qc.ccx(0, 1, 2)\n"
                "qc.x(range(4))\n"
                "qc.h(range(4))\n"
                "qc.measure_all()\n"
            ),
            "parameters_schema": {},
            "n_qubits_range": [4, 4],
            "tags": ["grover", "search", "oracle", "amplitude-amplification"],
            "paper_reference": None,
            "fork_count": 38,
            "run_count": 264,
            "star_count": 71,
            "is_verified": True,
            "is_featured": False,
            "created_at": "2024-02-10T00:00:00+00:00",
            "updated_at": "2024-02-10T00:00:00+00:00",
        },
    ),
    (
        "tpl_qft_4q",
        {
            "template_id": "tpl_qft_4q",
            "name": "Quantum Fourier Transform",
            "slug": "quantum-fourier-transform",
            "description": "4-qubit Quantum Fourier Transform — the quantum analog of the discrete Fourier transform.",
            "algorithm": "qft",
            "category": "education",
            "author": "Q-Lab Team",
            "institution": "Q-Lab",
            "qasm_circuit": (
                "OPENQASM 2.0;\n"
                'include "qelib1.inc";\n'
                "qreg q[4];\n"
                "creg c[4];\n"
                "h q[0];\n"
                "cu1(pi/2) q[1],q[0];\n"
                "cu1(pi/4) q[2],q[0];\n"
                "cu1(pi/8) q[3],q[0];\n"
                "h q[1];\n"
                "cu1(pi/2) q[2],q[1];\n"
                "cu1(pi/4) q[3],q[1];\n"
                "h q[2];\n"
                "cu1(pi/2) q[3],q[2];\n"
                "h q[3];\n"
                "swap q[0],q[3];\n"
                "swap q[1],q[2];\n"
                "measure q -> c;"
            ),
            "python_code": (
                "from qiskit import QuantumCircuit\n"
                "import numpy as np\n"
                "qc = QuantumCircuit(4, 4)\n"
                "for j in range(4):\n"
                "    qc.h(j)\n"
                "    for k in range(j+1, 4):\n"
                "        qc.cp(np.pi / 2**(k-j), k, j)\n"
                "qc.swap(0, 3)\n"
                "qc.swap(1, 2)\n"
                "qc.measure_all()\n"
            ),
            "parameters_schema": {
                "n_qubits": {"type": "int", "default": 4, "min": 2, "max": 10, "description": "Number of qubits"},
            },
            "n_qubits_range": [4, 4],
            "tags": ["qft", "fourier", "phase-estimation", "shor"],
            "paper_reference": None,
            "fork_count": 53,
            "run_count": 421,
            "star_count": 112,
            "is_verified": True,
            "is_featured": True,
            "created_at": "2024-02-20T00:00:00+00:00",
            "updated_at": "2024-02-20T00:00:00+00:00",
        },
    ),
    (
        "tpl_qpe_5q",
        {
            "template_id": "tpl_qpe_5q",
            "name": "Quantum Phase Estimation",
            "slug": "quantum-phase-estimation",
            "description": "5-qubit phase estimation to determine eigenphase of a simple unitary.",
            "algorithm": "custom",
            "category": "chemistry",
            "author": "Q-Lab Community",
            "institution": None,
            "qasm_circuit": (
                "OPENQASM 2.0;\n"
                'include "qelib1.inc";\n'
                "qreg q[5];\n"
                "creg c[4];\n"
                "x q[4];\n"
                "h q[0];\n"
                "h q[1];\n"
                "h q[2];\n"
                "h q[3];\n"
                "cu1(pi/2) q[3],q[4];\n"
                "cu1(pi/2) q[2],q[4];\n"
                "cu1(pi/2) q[2],q[4];\n"
                "cu1(pi/2) q[1],q[4];\n"
                "cu1(pi/2) q[1],q[4];\n"
                "cu1(pi/2) q[1],q[4];\n"
                "cu1(pi/2) q[1],q[4];\n"
                "cu1(pi/2) q[0],q[4];\n"
                "h q[3];\n"
                "cu1(-pi/2) q[2],q[3];\n"
                "h q[2];\n"
                "cu1(-pi/4) q[1],q[3];\n"
                "cu1(-pi/2) q[1],q[2];\n"
                "h q[1];\n"
                "cu1(-pi/8) q[0],q[3];\n"
                "cu1(-pi/4) q[0],q[2];\n"
                "cu1(-pi/2) q[0],q[1];\n"
                "h q[0];\n"
                "measure q[0] -> c[0];\n"
                "measure q[1] -> c[1];\n"
                "measure q[2] -> c[2];\n"
                "measure q[3] -> c[3];"
            ),
            "python_code": (
                "from qiskit import QuantumCircuit\n"
                "from qiskit.circuit.library import QFT\n"
                "qc = QuantumCircuit(5, 4)\n"
                "qc.x(4)  # eigenstate\n"
                "qc.h(range(4))\n"
                "for i in range(4):\n"
                "    qc.cp(3.14159 / 2, i, 4)\n"
                "qc.compose(QFT(4, inverse=True), qubits=range(4), inplace=True)\n"
                "qc.measure(range(4), range(4))\n"
            ),
            "parameters_schema": {
                "phase": {"type": "float", "default": 0.25, "description": "Target eigenphase (0 to 1)"},
            },
            "n_qubits_range": [5, 5],
            "tags": ["qpe", "phase-estimation", "eigenvalue", "shor"],
            "paper_reference": "arXiv:quant-ph/9508027",
            "fork_count": 21,
            "run_count": 147,
            "star_count": 44,
            "is_verified": False,
            "is_featured": False,
            "created_at": "2024-03-01T00:00:00+00:00",
            "updated_at": "2024-03-01T00:00:00+00:00",
        },
    ),
    (
        "tpl_ghz_n",
        {
            "template_id": "tpl_ghz_n",
            "name": "GHZ State n-qubit",
            "slug": "ghz-state-n-qubit",
            "description": "Prepare an n-qubit Greenberger-Horne-Zeilinger state — a maximally entangled multi-qubit state.",
            "algorithm": "custom",
            "category": "benchmarking",
            "author": "Q-Lab Team",
            "institution": "Q-Lab",
            "qasm_circuit": (
                "OPENQASM 2.0;\n"
                'include "qelib1.inc";\n'
                "qreg q[5];\n"
                "creg c[5];\n"
                "h q[0];\n"
                "cx q[0],q[1];\n"
                "cx q[1],q[2];\n"
                "cx q[2],q[3];\n"
                "cx q[3],q[4];\n"
                "measure q -> c;"
            ),
            "python_code": (
                "from qiskit import QuantumCircuit\n"
                "n = 5  # configurable\n"
                "qc = QuantumCircuit(n, n)\n"
                "qc.h(0)\n"
                "for i in range(n - 1):\n"
                "    qc.cx(i, i + 1)\n"
                "qc.measure_all()\n"
            ),
            "parameters_schema": {
                "n_qubits": {"type": "int", "default": 5, "min": 2, "max": 20, "description": "Number of qubits"},
            },
            "n_qubits_range": [2, 20],
            "tags": ["ghz", "entanglement", "benchmarking", "fidelity"],
            "paper_reference": None,
            "fork_count": 48,
            "run_count": 389,
            "star_count": 95,
            "is_verified": True,
            "is_featured": False,
            "created_at": "2024-03-10T00:00:00+00:00",
            "updated_at": "2024-03-10T00:00:00+00:00",
        },
    ),
    (
        "tpl_bv_5q",
        {
            "template_id": "tpl_bv_5q",
            "name": "Bernstein-Vazirani",
            "slug": "bernstein-vazirani",
            "description": "Bernstein-Vazirani algorithm to find a hidden bit string with a single oracle query.",
            "algorithm": "custom",
            "category": "cryptography",
            "author": "Q-Lab Community",
            "institution": None,
            "qasm_circuit": (
                "OPENQASM 2.0;\n"
                'include "qelib1.inc";\n'
                "qreg q[6];\n"
                "creg c[5];\n"
                "x q[5];\n"
                "h q[0];\n"
                "h q[1];\n"
                "h q[2];\n"
                "h q[3];\n"
                "h q[4];\n"
                "h q[5];\n"
                "cx q[0],q[5];\n"
                "cx q[2],q[5];\n"
                "cx q[4],q[5];\n"
                "h q[0];\n"
                "h q[1];\n"
                "h q[2];\n"
                "h q[3];\n"
                "h q[4];\n"
                "measure q[0] -> c[0];\n"
                "measure q[1] -> c[1];\n"
                "measure q[2] -> c[2];\n"
                "measure q[3] -> c[3];\n"
                "measure q[4] -> c[4];"
            ),
            "python_code": (
                "from qiskit import QuantumCircuit\n"
                "secret = '10101'  # hidden string\n"
                "n = len(secret)\n"
                "qc = QuantumCircuit(n + 1, n)\n"
                "qc.x(n)\n"
                "qc.h(range(n + 1))\n"
                "for i, bit in enumerate(reversed(secret)):\n"
                "    if bit == '1':\n"
                "        qc.cx(i, n)\n"
                "qc.h(range(n))\n"
                "qc.measure(range(n), range(n))\n"
            ),
            "parameters_schema": {
                "secret_string": {"type": "string", "default": "10101", "description": "Hidden bit string to find"},
            },
            "n_qubits_range": [5, 5],
            "tags": ["bernstein-vazirani", "oracle", "cryptography", "hidden-string"],
            "paper_reference": "doi:10.1145/167088.167097",
            "fork_count": 17,
            "run_count": 123,
            "star_count": 33,
            "is_verified": False,
            "is_featured": False,
            "created_at": "2024-03-20T00:00:00+00:00",
            "updated_at": "2024-03-20T00:00:00+00:00",
        },
    ),
    (
        "tpl_qaoa_8q",
        {
            "template_id": "tpl_qaoa_8q",
            "name": "Quantum Approximate Optimization",
            "slug": "quantum-approximate-optimization",
            "description": "QAOA p=2 for graph partitioning on 8 qubits, suitable for near-term devices.",
            "algorithm": "qaoa",
            "category": "optimization",
            "author": "Q-Lab Community",
            "institution": None,
            "qasm_circuit": (
                "OPENQASM 2.0;\n"
                'include "qelib1.inc";\n'
                "qreg q[8];\n"
                "creg c[8];\n"
                "h q[0];\n"
                "h q[1];\n"
                "h q[2];\n"
                "h q[3];\n"
                "h q[4];\n"
                "h q[5];\n"
                "h q[6];\n"
                "h q[7];\n"
                "cx q[0],q[1];\n"
                "rz(0.5) q[1];\n"
                "cx q[0],q[1];\n"
                "cx q[2],q[3];\n"
                "rz(0.5) q[3];\n"
                "cx q[2],q[3];\n"
                "cx q[4],q[5];\n"
                "rz(0.5) q[5];\n"
                "cx q[4],q[5];\n"
                "cx q[6],q[7];\n"
                "rz(0.5) q[7];\n"
                "cx q[6],q[7];\n"
                "rx(0.7) q[0];\n"
                "rx(0.7) q[1];\n"
                "rx(0.7) q[2];\n"
                "rx(0.7) q[3];\n"
                "rx(0.7) q[4];\n"
                "rx(0.7) q[5];\n"
                "rx(0.7) q[6];\n"
                "rx(0.7) q[7];\n"
                "measure q -> c;"
            ),
            "python_code": (
                "from qiskit import QuantumCircuit\n"
                "from qiskit.circuit import Parameter\n"
                "gamma = Parameter('gamma')\n"
                "beta = Parameter('beta')\n"
                "qc = QuantumCircuit(8, 8)\n"
                "qc.h(range(8))\n"
                "edges = [(0,1),(2,3),(4,5),(6,7),(1,2),(3,4),(5,6)]\n"
                "for u, v in edges:\n"
                "    qc.cx(u, v)\n"
                "    qc.rz(2 * gamma, v)\n"
                "    qc.cx(u, v)\n"
                "for i in range(8):\n"
                "    qc.rx(2 * beta, i)\n"
                "qc.measure_all()\n"
            ),
            "parameters_schema": {
                "gamma": {"type": "float", "default": 0.5, "description": "Phase separator"},
                "beta": {"type": "float", "default": 0.35, "description": "Mixer angle"},
                "p_layers": {"type": "int", "default": 1, "min": 1, "max": 5, "description": "QAOA depth"},
            },
            "n_qubits_range": [8, 8],
            "tags": ["qaoa", "optimization", "graph", "combinatorial"],
            "paper_reference": "arXiv:1411.4028",
            "fork_count": 24,
            "run_count": 176,
            "star_count": 47,
            "is_verified": False,
            "is_featured": False,
            "created_at": "2024-04-01T00:00:00+00:00",
            "updated_at": "2024-04-01T00:00:00+00:00",
        },
    ),
    (
        "tpl_rb_1to5",
        {
            "template_id": "tpl_rb_1to5",
            "name": "Randomized Benchmarking",
            "slug": "randomized-benchmarking",
            "description": "Randomized benchmarking protocol for 1-5 qubits to characterize average gate fidelity.",
            "algorithm": "custom",
            "category": "benchmarking",
            "author": "Q-Lab Team",
            "institution": "Q-Lab",
            "qasm_circuit": (
                "OPENQASM 2.0;\n"
                'include "qelib1.inc";\n'
                "qreg q[1];\n"
                "creg c[1];\n"
                "x q[0];\n"
                "y q[0];\n"
                "z q[0];\n"
                "h q[0];\n"
                "x q[0];\n"
                "h q[0];\n"
                "z q[0];\n"
                "y q[0];\n"
                "x q[0];\n"
                "measure q -> c;"
            ),
            "python_code": (
                "from qiskit import QuantumCircuit\n"
                "import random\n"
                "n_qubits = 1\n"
                "length = 10  # number of Clifford gates\n"
                "gates = ['x', 'y', 'z', 'h', 's', 'sdg']\n"
                "qc = QuantumCircuit(n_qubits, n_qubits)\n"
                "for _ in range(length):\n"
                "    gate = random.choice(gates)\n"
                "    getattr(qc, gate)(0)\n"
                "qc.measure_all()\n"
            ),
            "parameters_schema": {
                "n_qubits": {"type": "int", "default": 1, "min": 1, "max": 5, "description": "Qubits to benchmark"},
                "sequence_length": {"type": "int", "default": 10, "min": 1, "max": 200, "description": "Clifford sequence length"},
                "n_seeds": {"type": "int", "default": 20, "min": 1, "max": 100, "description": "Random seeds"},
            },
            "n_qubits_range": [1, 5],
            "tags": ["randomized-benchmarking", "rb", "fidelity", "characterization"],
            "paper_reference": "arXiv:quant-ph/0702028",
            "fork_count": 61,
            "run_count": 448,
            "star_count": 127,
            "is_verified": True,
            "is_featured": True,
            "created_at": "2024-04-15T00:00:00+00:00",
            "updated_at": "2024-04-15T00:00:00+00:00",
        },
    ),
]


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _slugify(name: str) -> str:
    return name.lower().replace(" ", "-").replace("_", "-")


def _random_suffix(n: int = 6) -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=n))


def _get_all(db: Session) -> list[dict]:
    store_seed(db, _NS, _SEED_TEMPLATES)
    return store_list(db, _NS)


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/featured")
def list_featured(db: Session = Depends(get_db)):
    """Return curated featured templates."""
    all_t = _get_all(db)
    return [t for t in all_t if t.get("is_featured")]


@router.get("/categories")
def list_categories(db: Session = Depends(get_db)):
    """Return categories with template counts."""
    all_t = _get_all(db)
    counts: dict[str, int] = {}
    for t in all_t:
        cat = t.get("category", "custom")
        counts[cat] = counts.get(cat, 0) + 1
    return [{"category": k, "count": v} for k, v in sorted(counts.items())]


@router.get("/slug/{slug}")
def get_by_slug(slug: str, db: Session = Depends(get_db)):
    """Fetch a template by its slug."""
    all_t = _get_all(db)
    for t in all_t:
        if t.get("slug") == slug:
            return t
    raise HTTPException(status_code=404, detail="Template not found")


@router.get("/{template_id}")
def get_template(template_id: str, db: Session = Depends(get_db)):
    """Fetch a template by ID."""
    store_seed(db, _NS, _SEED_TEMPLATES)
    data = store_get(db, _NS, template_id)
    if data is None:
        raise HTTPException(status_code=404, detail="Template not found")
    return data


@router.post("/{template_id}/fork")
def fork_template(template_id: str, db: Session = Depends(get_db)):
    """Fork a template — creates a copy with a new slug and increments fork count."""
    store_seed(db, _NS, _SEED_TEMPLATES)
    original = store_get(db, _NS, template_id)
    if original is None:
        raise HTTPException(status_code=404, detail="Template not found")

    # Increment original fork count
    original["fork_count"] = original.get("fork_count", 0) + 1
    store_put(db, _NS, template_id, original)

    # Create fork
    new_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    forked = {**original}
    forked["template_id"] = new_id
    forked["slug"] = f"{original.get('slug', 'template')}-fork-{_random_suffix()}"
    forked["fork_count"] = 0
    forked["run_count"] = 0
    forked["star_count"] = 0
    forked["is_verified"] = False
    forked["is_featured"] = False
    forked["created_at"] = now
    forked["updated_at"] = now
    store_put(db, _NS, new_id, forked)
    return forked


@router.post("/{template_id}/star")
def star_template(template_id: str, db: Session = Depends(get_db)):
    """Star a template (increments star_count)."""
    store_seed(db, _NS, _SEED_TEMPLATES)
    data = store_get(db, _NS, template_id)
    if data is None:
        raise HTTPException(status_code=404, detail="Template not found")
    data["star_count"] = data.get("star_count", 0) + 1
    store_put(db, _NS, template_id, data)
    return {"template_id": template_id, "star_count": data["star_count"]}


@router.post("/{template_id}/run")
def run_template(template_id: str, body: RunTemplateRequest, db: Session = Depends(get_db)):
    """Instantiate a template with parameters and return circuit code."""
    store_seed(db, _NS, _SEED_TEMPLATES)
    data = store_get(db, _NS, template_id)
    if data is None:
        raise HTTPException(status_code=404, detail="Template not found")

    # Increment run count
    data["run_count"] = data.get("run_count", 0) + 1
    store_put(db, _NS, template_id, data)

    qasm = data.get("qasm_circuit", "")
    python_code = data.get("python_code", "")

    # Naive parameter substitution in python_code
    for key, val in body.parameters.items():
        python_code = python_code.replace(f"'{key}_default'", str(val))

    return {
        "template_id": template_id,
        "name": data.get("name"),
        "qasm": qasm,
        "python_code": python_code,
        "parameters_used": body.parameters,
        "run_instructions": "POST this QASM to /api/v1/runs",
    }


@router.get("/")
def list_templates(
    category: Optional[str] = Query(None),
    algorithm: Optional[str] = Query(None),
    tags: Optional[str] = Query(None, description="Comma-separated tags"),
    min_qubits: Optional[int] = Query(None),
    max_qubits: Optional[int] = Query(None),
    featured_only: bool = Query(False),
    search: Optional[str] = Query(None),
    sort: str = Query("most_starred", description="most_forked | most_run | newest | most_starred"),
    db: Session = Depends(get_db),
):
    """List templates with filtering and sorting."""
    all_t = _get_all(db)
    results = list(all_t)

    if category:
        results = [t for t in results if t.get("category") == category]
    if algorithm:
        results = [t for t in results if t.get("algorithm") == algorithm]
    if featured_only:
        results = [t for t in results if t.get("is_featured")]
    if tags:
        tag_list = [tag.strip() for tag in tags.split(",")]
        results = [t for t in results if any(tag in (t.get("tags") or []) for tag in tag_list)]
    if min_qubits is not None:
        results = [t for t in results if (t.get("n_qubits_range") or [0, 0])[1] >= min_qubits]
    if max_qubits is not None:
        results = [t for t in results if (t.get("n_qubits_range") or [0, 0])[0] <= max_qubits]
    if search:
        q = search.lower()
        results = [
            t for t in results
            if q in t.get("name", "").lower() or q in t.get("description", "").lower()
        ]

    sort_key = {
        "most_forked": lambda t: t.get("fork_count", 0),
        "most_run": lambda t: t.get("run_count", 0),
        "newest": lambda t: t.get("created_at", ""),
        "most_starred": lambda t: t.get("star_count", 0),
    }.get(sort, lambda t: t.get("star_count", 0))

    results.sort(key=sort_key, reverse=True)
    return results


@router.post("/")
def create_template(payload: TemplateCreate, db: Session = Depends(get_db)):
    """Publish a new experiment template."""
    store_seed(db, _NS, _SEED_TEMPLATES)
    tid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    slug = payload.slug or f"{_slugify(payload.name)}-{_random_suffix()}"

    data: dict = {
        "template_id": tid,
        "name": payload.name,
        "slug": slug,
        "description": payload.description,
        "algorithm": payload.algorithm,
        "category": payload.category,
        "author": payload.author,
        "institution": payload.institution,
        "qasm_circuit": payload.qasm_circuit,
        "python_code": payload.python_code,
        "parameters_schema": payload.parameters_schema,
        "n_qubits_range": payload.n_qubits_range,
        "tags": payload.tags,
        "paper_reference": payload.paper_reference,
        "fork_count": 0,
        "run_count": 0,
        "star_count": 0,
        "is_verified": False,
        "is_featured": False,
        "created_at": now,
        "updated_at": now,
    }
    store_put(db, _NS, tid, data)
    return data
