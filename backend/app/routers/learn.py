from __future__ import annotations

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import uuid, random, math
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list, store_delete, store_seed

router = APIRouter(prefix="/api/v1/learn", tags=["learn"])

NS_PATHS = "learn_paths"
NS_ENROLLMENTS = "learn_enrollments"
NS_PROGRESS = "learn_progress"


class Module(BaseModel):
    module_id: str
    title: str
    description: str
    type: str
    duration_min: int
    difficulty: str
    tags: List[str]


class LearningPath(BaseModel):
    path_id: str
    title: str
    description: str
    level: str
    modules: List[Module]
    total_duration_min: int
    prerequisites: List[str]
    skills_gained: List[str]
    enrolled_count: int
    completion_rate: float


class UserProgress(BaseModel):
    progress_id: str
    user: str
    path_id: str
    enrolled_at: str
    completed_modules: List[str]
    current_module: Optional[str] = None
    pct_complete: float
    last_active: str
    certificate_url: Optional[str] = None
    completed_at: Optional[str] = None


class EnrollRequest(BaseModel):
    user: str
    path_id: str


class CompleteModuleRequest(BaseModel):
    user: str
    path_id: str
    module_id: str


def _make_modules(specs: List[dict]) -> List[Module]:
    return [
        Module(
            module_id=str(uuid.uuid4()),
            title=s["title"],
            description=s["description"],
            type=s["type"],
            duration_min=s["duration_min"],
            difficulty=s["difficulty"],
            tags=s["tags"],
        )
        for s in specs
    ]


def _build_seed_paths() -> list[tuple[str, dict]]:
    paths_specs = [
        {
            "title": "Quantum Basics",
            "description": "A ground-up introduction to quantum mechanics and quantum computing primitives, covering qubits, gates, and measurement.",
            "level": "beginner",
            "prerequisites": [],
            "skills_gained": ["qubit manipulation", "quantum gates", "Bloch sphere visualization", "basic circuit construction"],
            "enrolled_count": random.randint(800, 2000),
            "completion_rate": round(random.uniform(0.60, 0.85), 2),
            "modules": [
                {"title": "What is a Qubit?", "description": "Superposition, Bloch sphere, and measurement postulates.", "type": "video", "duration_min": 18, "difficulty": "beginner", "tags": ["qubit", "superposition", "measurement"]},
                {"title": "Single-Qubit Gates", "description": "Pauli gates, Hadamard, phase gates and their matrix representations.", "type": "reading", "duration_min": 25, "difficulty": "beginner", "tags": ["gates", "unitary", "Pauli"]},
                {"title": "Multi-Qubit Systems", "description": "Tensor products, entanglement, and the CNOT gate.", "type": "video", "duration_min": 22, "difficulty": "beginner", "tags": ["entanglement", "CNOT", "tensor product"]},
                {"title": "Your First Quantum Circuit", "description": "Build and simulate a Bell state in Qiskit.", "type": "exercise", "duration_min": 40, "difficulty": "beginner", "tags": ["Qiskit", "Bell state", "simulation"]},
                {"title": "Quantum Basics Quiz", "description": "Test your understanding of qubits, gates, and circuits.", "type": "quiz", "duration_min": 15, "difficulty": "beginner", "tags": ["quiz", "assessment"]},
            ],
        },
        {
            "title": "VQE Mastery",
            "description": "Deep dive into the Variational Quantum Eigensolver — ansatz design, classical optimization loops, and noise mitigation strategies.",
            "level": "intermediate",
            "prerequisites": ["Quantum Basics"],
            "skills_gained": ["ansatz construction", "parameter optimization", "gradient estimation", "energy convergence analysis"],
            "enrolled_count": random.randint(300, 800),
            "completion_rate": round(random.uniform(0.45, 0.70), 2),
            "modules": [
                {"title": "VQE Overview", "description": "Variational principle, Hamiltonian simulation, and the hybrid quantum-classical loop.", "type": "video", "duration_min": 30, "difficulty": "intermediate", "tags": ["VQE", "Hamiltonian", "hybrid"]},
                {"title": "Ansatz Design Patterns", "description": "Hardware-efficient, UCCSD, and symmetry-preserving ansatze.", "type": "reading", "duration_min": 35, "difficulty": "intermediate", "tags": ["ansatz", "UCCSD", "symmetry"]},
                {"title": "Classical Optimizers for VQE", "description": "COBYLA, SPSA, Adam — convergence properties and noise resilience.", "type": "reading", "duration_min": 28, "difficulty": "intermediate", "tags": ["optimizer", "COBYLA", "SPSA"]},
                {"title": "Implementing VQE in Qiskit", "description": "End-to-end H₂ molecule ground state calculation.", "type": "exercise", "duration_min": 90, "difficulty": "intermediate", "tags": ["Qiskit", "VQE", "chemistry"]},
                {"title": "Noise Mitigation in VQE", "description": "Zero-noise extrapolation and probabilistic error cancellation applied to VQE.", "type": "exercise", "duration_min": 60, "difficulty": "advanced", "tags": ["noise mitigation", "ZNE", "PEC"]},
                {"title": "VQE Benchmark Challenge", "description": "Reproduce a published VQE energy landscape and compare optimizers.", "type": "exercise", "duration_min": 120, "difficulty": "advanced", "tags": ["benchmark", "research", "VQE"]},
            ],
        },
        {
            "title": "Error Mitigation",
            "description": "Systematic techniques to suppress and correct errors in NISQ-era quantum computations without full fault tolerance.",
            "level": "intermediate",
            "prerequisites": ["Quantum Basics"],
            "skills_gained": ["readout error mitigation", "zero-noise extrapolation", "probabilistic error cancellation", "dynamical decoupling"],
            "enrolled_count": random.randint(200, 600),
            "completion_rate": round(random.uniform(0.40, 0.65), 2),
            "modules": [
                {"title": "Noise in Quantum Circuits", "description": "Depolarizing, dephasing, amplitude damping — models and characterization.", "type": "video", "duration_min": 25, "difficulty": "intermediate", "tags": ["noise", "decoherence", "T1 T2"]},
                {"title": "Readout Error Mitigation", "description": "Calibration matrices and matrix inversion techniques.", "type": "exercise", "duration_min": 45, "difficulty": "intermediate", "tags": ["readout", "calibration", "mitigation"]},
                {"title": "Zero-Noise Extrapolation", "description": "Richardson extrapolation and gate folding strategies.", "type": "reading", "duration_min": 30, "difficulty": "intermediate", "tags": ["ZNE", "extrapolation", "gate folding"]},
                {"title": "Probabilistic Error Cancellation", "description": "Quasi-probability decompositions and sampling overhead.", "type": "reading", "duration_min": 35, "difficulty": "advanced", "tags": ["PEC", "quasi-probability", "overhead"]},
                {"title": "Dynamical Decoupling", "description": "Pulse-level DD sequences: CPMG, XY-4, and Uhrig.", "type": "exercise", "duration_min": 50, "difficulty": "advanced", "tags": ["dynamical decoupling", "CPMG", "pulse"]},
                {"title": "Error Mitigation Assessment", "description": "Apply three mitigation techniques to a benchmark circuit and compare fidelity gains.", "type": "quiz", "duration_min": 20, "difficulty": "intermediate", "tags": ["quiz", "comparison", "fidelity"]},
            ],
        },
        {
            "title": "QML Fundamentals",
            "description": "Introduction to quantum machine learning — data encoding, parameterized circuits as models, and quantum kernels.",
            "level": "intermediate",
            "prerequisites": ["Quantum Basics"],
            "skills_gained": ["data encoding", "quantum kernels", "variational classifiers", "quantum neural networks"],
            "enrolled_count": random.randint(400, 1000),
            "completion_rate": round(random.uniform(0.38, 0.62), 2),
            "modules": [
                {"title": "Classical ML Refresher", "description": "Supervised learning, loss functions, and gradient descent.", "type": "video", "duration_min": 20, "difficulty": "beginner", "tags": ["ML", "gradient descent", "classification"]},
                {"title": "Quantum Data Encoding", "description": "Amplitude, angle, and IQP encoding strategies.", "type": "reading", "duration_min": 30, "difficulty": "intermediate", "tags": ["encoding", "amplitude", "IQP"]},
                {"title": "Parameterized Quantum Circuits", "description": "PQCs as function approximators and their expressibility.", "type": "video", "duration_min": 28, "difficulty": "intermediate", "tags": ["PQC", "expressibility", "variational"]},
                {"title": "Quantum Kernels & SVMs", "description": "Quantum feature maps and kernel-based classification.", "type": "reading", "duration_min": 32, "difficulty": "intermediate", "tags": ["kernel", "SVM", "feature map"]},
                {"title": "Training a Quantum Classifier", "description": "Implement a variational classifier on the Iris dataset using Qiskit Machine Learning.", "type": "exercise", "duration_min": 80, "difficulty": "intermediate", "tags": ["Qiskit ML", "classifier", "training"]},
                {"title": "QML Concepts Quiz", "description": "Assess understanding of encoding, kernels, and PQC training.", "type": "quiz", "duration_min": 18, "difficulty": "intermediate", "tags": ["quiz", "QML", "assessment"]},
            ],
        },
        {
            "title": "Hardware Characterization",
            "description": "Hands-on methods for characterizing real quantum processors: randomized benchmarking, process tomography, and spectroscopy.",
            "level": "advanced",
            "prerequisites": ["Quantum Basics", "Error Mitigation"],
            "skills_gained": ["randomized benchmarking", "process tomography", "Hamiltonian learning", "cross-entropy benchmarking"],
            "enrolled_count": random.randint(100, 350),
            "completion_rate": round(random.uniform(0.30, 0.55), 2),
            "modules": [
                {"title": "Gate Fidelity Metrics", "description": "Average gate fidelity, entanglement fidelity, and diamond norm.", "type": "reading", "duration_min": 28, "difficulty": "advanced", "tags": ["fidelity", "diamond norm", "metrics"]},
                {"title": "Standard Randomized Benchmarking", "description": "Clifford RB protocol, decay fitting, and error per gate extraction.", "type": "exercise", "duration_min": 60, "difficulty": "advanced", "tags": ["RB", "Clifford", "benchmarking"]},
                {"title": "Interleaved RB", "description": "Isolating individual gate errors with interleaved sequences.", "type": "exercise", "duration_min": 45, "difficulty": "advanced", "tags": ["interleaved RB", "gate error", "characterization"]},
                {"title": "Quantum Process Tomography", "description": "Reconstructing the process matrix χ from measurement data.", "type": "reading", "duration_min": 40, "difficulty": "advanced", "tags": ["QPT", "process matrix", "tomography"]},
                {"title": "Cross-Entropy Benchmarking", "description": "XEB protocol and linear XEB fidelity estimation.", "type": "video", "duration_min": 35, "difficulty": "advanced", "tags": ["XEB", "cross-entropy", "fidelity"]},
                {"title": "Characterization Lab", "description": "Run a full RB + QPT suite on a simulated noisy backend and report gate fidelities.", "type": "exercise", "duration_min": 120, "difficulty": "advanced", "tags": ["lab", "RB", "QPT", "report"]},
            ],
        },
        {
            "title": "Research Methods",
            "description": "Scientific methodology for quantum computing research: reproducibility, statistical analysis, and publication workflows.",
            "level": "advanced",
            "prerequisites": ["Quantum Basics"],
            "skills_gained": ["statistical hypothesis testing", "experimental design", "reproducibility", "scientific writing", "peer review"],
            "enrolled_count": random.randint(150, 450),
            "completion_rate": round(random.uniform(0.50, 0.75), 2),
            "modules": [
                {"title": "Experimental Design in QC", "description": "Controls, confounds, and reproducibility in quantum experiments.", "type": "video", "duration_min": 22, "difficulty": "intermediate", "tags": ["experimental design", "reproducibility", "controls"]},
                {"title": "Statistical Analysis for Quantum Results", "description": "Bootstrap CI, hypothesis testing, and effect sizes for quantum benchmarks.", "type": "reading", "duration_min": 35, "difficulty": "intermediate", "tags": ["statistics", "bootstrap", "hypothesis testing"]},
                {"title": "Tracking Experiments with Q-Lab", "description": "Using Q-Lab's experiment tracker for parameter sweeps and result logging.", "type": "exercise", "duration_min": 30, "difficulty": "beginner", "tags": ["Q-Lab", "tracking", "workflow"]},
                {"title": "Scientific Writing Workshop", "description": "Structure of a quantum computing paper: abstract, methods, results, discussion.", "type": "reading", "duration_min": 40, "difficulty": "intermediate", "tags": ["writing", "publication", "paper structure"]},
                {"title": "Peer Review Simulation", "description": "Review a draft quantum computing paper and provide structured feedback.", "type": "exercise", "duration_min": 60, "difficulty": "advanced", "tags": ["peer review", "feedback", "critical reading"]},
            ],
        },
    ]

    records: list[tuple[str, dict]] = []
    for spec in paths_specs:
        path_id = str(uuid.uuid4())
        modules = _make_modules(spec["modules"])
        total_duration = sum(m.duration_min for m in modules)
        path = LearningPath(
            path_id=path_id,
            title=spec["title"],
            description=spec["description"],
            level=spec["level"],
            modules=modules,
            total_duration_min=total_duration,
            prerequisites=spec["prerequisites"],
            skills_gained=spec["skills_gained"],
            enrolled_count=spec["enrolled_count"],
            completion_rate=spec["completion_rate"],
        )
        records.append((path_id, path.model_dump()))
    return records


@router.get("/paths", response_model=List[LearningPath])
def list_paths(db: Session = Depends(get_db)) -> List[LearningPath]:
    store_seed(db, NS_PATHS, _build_seed_paths())
    return [LearningPath(**p) for p in store_list(db, NS_PATHS)]


@router.get("/path/{path_id}", response_model=LearningPath)
def get_path(path_id: str, db: Session = Depends(get_db)) -> LearningPath:
    p = store_get(db, NS_PATHS, path_id)
    if not p:
        raise HTTPException(status_code=404, detail=f"Learning path {path_id} not found.")
    return LearningPath(**p)


@router.post("/enroll", response_model=UserProgress)
def enroll(req: EnrollRequest, db: Session = Depends(get_db)) -> UserProgress:
    path = store_get(db, NS_PATHS, req.path_id)
    if not path:
        raise HTTPException(status_code=404, detail=f"Learning path {req.path_id} not found.")
    progress_key = f"{req.user}:{req.path_id}"
    existing = store_get(db, NS_PROGRESS, progress_key)
    if existing:
        return UserProgress(**existing)
    first_module_id = path["modules"][0]["module_id"] if path["modules"] else None
    now = datetime.now(timezone.utc).isoformat()
    progress = UserProgress(
        progress_id=str(uuid.uuid4()),
        user=req.user,
        path_id=req.path_id,
        enrolled_at=now,
        completed_modules=[],
        current_module=first_module_id,
        pct_complete=0.0,
        last_active=now,
    )
    store_put(db, NS_PROGRESS, progress_key, progress.model_dump())
    return progress


@router.post("/complete-module", response_model=UserProgress)
def complete_module(req: CompleteModuleRequest, db: Session = Depends(get_db)) -> UserProgress:
    path = store_get(db, NS_PATHS, req.path_id)
    if not path:
        raise HTTPException(status_code=404, detail=f"Learning path {req.path_id} not found.")
    progress_key = f"{req.user}:{req.path_id}"
    prog = store_get(db, NS_PROGRESS, progress_key)
    if not prog:
        raise HTTPException(status_code=404, detail=f"User {req.user} is not enrolled in path {req.path_id}.")
    module_ids = [m["module_id"] for m in path["modules"]]
    if req.module_id not in module_ids:
        raise HTTPException(status_code=404, detail=f"Module {req.module_id} not found in path {req.path_id}.")
    if req.module_id not in prog["completed_modules"]:
        prog["completed_modules"].append(req.module_id)
    total = len(module_ids)
    completed = len(prog["completed_modules"])
    prog["pct_complete"] = round(completed / total * 100, 1) if total > 0 else 0.0
    now = datetime.now(timezone.utc).isoformat()
    prog["last_active"] = now
    completed_set = set(prog["completed_modules"])
    remaining = [mid for mid in module_ids if mid not in completed_set]
    prog["current_module"] = remaining[0] if remaining else None
    if not remaining:
        prog["completed_at"] = now
        prog["certificate_url"] = f"/api/v1/learn/certificate/{prog['progress_id']}"
    store_put(db, NS_PROGRESS, progress_key, prog)
    return UserProgress(**prog)


@router.get("/progress/{user}", response_model=List[UserProgress])
def get_user_progress(user: str, db: Session = Depends(get_db)) -> List[UserProgress]:
    all_progress = store_list(db, NS_PROGRESS)
    results = [
        UserProgress(**prog)
        for prog in all_progress
        if prog.get("user") == user
    ]
    return results
