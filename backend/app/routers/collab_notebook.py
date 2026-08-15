from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import uuid, random, math
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list, store_delete

router = APIRouter(prefix="/api/v1/collab-notebook", tags=["Collab Notebook"])

NS = "collab_notebooks"


class NotebookCell(BaseModel):
    cell_id: str
    type: str
    content: str
    outputs: List[str]
    executed_at: Optional[str]
    execution_count: Optional[int]


class Notebook(BaseModel):
    notebook_id: str
    title: str
    owner: str
    collaborators: List[str]
    tags: List[str]
    cells: List[NotebookCell]
    kernel: str
    status: str
    created_at: str
    updated_at: str


class NotebookSummary(BaseModel):
    notebook_id: str
    title: str
    owner: str
    collaborators: List[str]
    tags: List[str]
    kernel: str
    status: str
    cell_count: int
    created_at: str
    updated_at: str


class ExecutionResult(BaseModel):
    notebook_id: str
    cell_id: str
    output: List[str]
    execution_time_ms: float
    success: bool
    executed_at: str
    is_simulated: bool = True
    simulation_note: str = "Execution is simulated locally — outputs are template-generated, not from a real kernel"


class CreateNotebookRequest(BaseModel):
    title: str
    owner: str
    collaborators: Optional[List[str]] = None
    tags: Optional[List[str]] = None
    kernel: str = "python"


class AddCellRequest(BaseModel):
    type: str
    content: str


class UpdateCellRequest(BaseModel):
    content: str


class ExecuteRequest(BaseModel):
    cell_id: Optional[str] = None


_VALID_KERNELS = {"python", "julia", "q_sharp"}
_VALID_CELL_TYPES = {"code", "markdown", "output"}


# ---------------------------------------------------------------------------
# Simulated execution engine
# ---------------------------------------------------------------------------

_QUANTUM_OUTPUT_TEMPLATES = [
    # Qiskit / circuit outputs
    lambda c: [
        "Running circuit on statevector simulator...",
        f"Statevector dimension: 2^{random.randint(2,10)} = {2**random.randint(2,10)}",
        "Counts (shots=8192): {{'|00>': " + str(random.randint(3000,5500)) + ", '|11>': " + str(random.randint(2000,4500)) + "}}",
        f"Circuit depth: {random.randint(4, 48)}",
        f"Gate count: {random.randint(10, 200)} (CX: {random.randint(2, 40)}, U3: {random.randint(8, 160)})",
    ],
    # VQE / optimization outputs
    lambda c: [
        f"[VQE] Iteration 0: E = {-1.0 - random.random():.6f} Ha",
        f"[VQE] Iteration {random.randint(20,40)}: E = {-1.1 - random.random()*0.3:.6f} Ha",
        f"[VQE] Iteration {random.randint(80,120)}: E = {-1.136 - random.random()*0.02:.6f} Ha  (converged)",
        f"Ground state energy: {-1.1372 - random.random()*0.001:.6f} Hartree",
        f"Optimizer: COBYLA  |  Function evaluations: {random.randint(200, 900)}",
    ],
    # Noise / T1 outputs
    lambda c: [
        f"T1 measurement (qubit {random.randint(0,5)}): {random.uniform(50,200):.1f} us",
        f"T2 (Ramsey): {random.uniform(30,150):.1f} us",
        f"Readout fidelity: {random.uniform(0.96, 0.999):.4f}",
        f"Gate fidelity (CX): {random.uniform(0.97, 0.999):.4f}",
    ],
    # QML training outputs
    lambda c: [
        f"Epoch 1/50 -- loss: {random.uniform(0.6, 1.0):.4f}  acc: {random.uniform(0.40,0.60):.4f}",
        f"Epoch 10/50 -- loss: {random.uniform(0.3, 0.5):.4f}  acc: {random.uniform(0.65,0.78):.4f}",
        f"Epoch 25/50 -- loss: {random.uniform(0.15, 0.25):.4f}  acc: {random.uniform(0.82,0.90):.4f}",
        f"Epoch 50/50 -- loss: {random.uniform(0.05, 0.12):.4f}  acc: {random.uniform(0.91,0.97):.4f}",
        f"Training complete. Best val_acc: {random.uniform(0.90, 0.97):.4f}",
    ],
    # Generic Python / import outputs
    lambda c: [
        "Qiskit version: 1.3.0",
        "NumPy version: 1.26.4",
        "Available backends: ['ibm_brisbane', 'ibm_kyoto', 'ibm_osaka', 'simulator_statevector']",
    ],
]

_QUANTUM_KEYWORDS = {
    "QuantumCircuit", "qc.", "qasm", "transpile", "execute", "backend",
    "VQE", "QAOA", "ansatz", "noise", "T1", "T2", "qubit", "measure",
    "statevector", "counts", "qml", "train", "optimizer", "circuit",
    "from qiskit", "import qiskit", "pennylane", "cirq",
}

_JULIA_OUTPUT_TEMPLATES = [
    lambda c: [
        "julia> " + c.strip().split("\n")[0],
        f"{random.uniform(0.0, 5.0):.6f}",
        f"elapsed: {random.uniform(1.0, 500.0):.2f} ms  |  GC: {random.uniform(0, 5):.1f}%",
    ]
]

_QSHARP_OUTPUT_TEMPLATES = [
    lambda c: [
        "Q# kernel ready.",
        f"Result : {random.choice(['Zero', 'One'])}",
        f"Simulation completed in {random.uniform(10, 300):.1f} ms",
    ]
]

_MARKDOWN_OUTPUTS = [
    lambda c: ["[Markdown rendered]"]
]


def _simulate_execution(cell: dict, kernel: str) -> tuple:
    """Simulate execution of a notebook cell and return (outputs, time_ms, success)."""
    success = random.random() > 0.05  # 5% chance of simulated error

    if not success:
        err_msgs = [
            "TranspilerError: Circuit exceeds backend qubit count.",
            "QiskitError: Job timed out after 300 seconds.",
            "ValueError: Invalid parameter angle outside [-pi, pi].",
            "IBMJobFailureError: Backend is in maintenance mode.",
            "numpy.linalg.LinAlgError: Singular matrix in unitary decomposition.",
        ]
        outputs = [f"ERROR: {random.choice(err_msgs)}"]
        time_ms = round(random.uniform(5, 80), 2)
        return outputs, time_ms, False

    if cell["type"] == "markdown":
        outputs = _MARKDOWN_OUTPUTS[0](cell["content"])
        time_ms = round(random.uniform(1, 5), 2)
        return outputs, time_ms, True

    # Pick output template based on kernel and content keywords
    if kernel == "julia":
        template = _JULIA_OUTPUT_TEMPLATES[0]
        time_ms = round(random.uniform(20, 800), 2)
    elif kernel == "q_sharp":
        template = _QSHARP_OUTPUT_TEMPLATES[0]
        time_ms = round(random.uniform(50, 500), 2)
    else:
        # Python kernel: detect quantum vs generic code
        is_quantum = any(kw.lower() in cell["content"].lower() for kw in _QUANTUM_KEYWORDS)
        if is_quantum:
            template = random.choice(_QUANTUM_OUTPUT_TEMPLATES)
        else:
            first_line = cell["content"].strip().split("\n")[0]
            template = lambda c, fl=first_line: [  # noqa: E731
                f">>> {fl}",
                repr(random.choice([None, True, 42, 3.14159, [1, 2, 3], {"key": "value"}])),
            ]
        time_ms = round(random.uniform(30, 3000), 2)

    outputs = template(cell["content"])
    return outputs, time_ms, True


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/notebook", response_model=Notebook)
def create_notebook(req: CreateNotebookRequest, db: Session = Depends(get_db)) -> Notebook:
    if req.kernel not in _VALID_KERNELS:
        raise HTTPException(
            status_code=422,
            detail=f"kernel must be one of {sorted(_VALID_KERNELS)}",
        )

    now = datetime.now(timezone.utc).isoformat()
    notebook_id = str(uuid.uuid4())
    nb = Notebook(
        notebook_id=notebook_id,
        title=req.title,
        owner=req.owner,
        collaborators=req.collaborators or [],
        tags=req.tags or [],
        cells=[],
        kernel=req.kernel,
        status="idle",
        created_at=now,
        updated_at=now,
    )
    store_put(db, NS, notebook_id, nb.model_dump())
    return nb


@router.get("/notebooks", response_model=List[NotebookSummary])
def list_notebooks(owner: Optional[str] = Query(None), db: Session = Depends(get_db)) -> List[NotebookSummary]:
    notebooks = store_list(db, NS)
    if owner:
        notebooks = [nb for nb in notebooks if nb["owner"] == owner]
    return [
        NotebookSummary(
            notebook_id=nb["notebook_id"],
            title=nb["title"],
            owner=nb["owner"],
            collaborators=nb["collaborators"],
            tags=nb["tags"],
            kernel=nb["kernel"],
            status=nb["status"],
            cell_count=len(nb["cells"]),
            created_at=nb["created_at"],
            updated_at=nb["updated_at"],
        )
        for nb in notebooks
    ]


@router.get("/notebook/{notebook_id}", response_model=Notebook)
def get_notebook(notebook_id: str, db: Session = Depends(get_db)) -> Notebook:
    nb = store_get(db, NS, notebook_id)
    if not nb:
        raise HTTPException(status_code=404, detail="Notebook not found")
    return Notebook(**nb)


@router.post("/notebook/{notebook_id}/cell", response_model=Notebook)
def add_cell(notebook_id: str, req: AddCellRequest, db: Session = Depends(get_db)) -> Notebook:
    nb = store_get(db, NS, notebook_id)
    if not nb:
        raise HTTPException(status_code=404, detail="Notebook not found")
    if req.type not in _VALID_CELL_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"type must be one of {sorted(_VALID_CELL_TYPES)}",
        )

    cell = NotebookCell(
        cell_id=str(uuid.uuid4()),
        type=req.type,
        content=req.content,
        outputs=[],
        executed_at=None,
        execution_count=None,
    )
    nb["cells"] = nb["cells"] + [cell.model_dump()]
    nb["updated_at"] = datetime.now(timezone.utc).isoformat()
    store_put(db, NS, notebook_id, nb)
    return Notebook(**nb)


@router.put("/notebook/{notebook_id}/cell/{cell_id}", response_model=Notebook)
def update_cell(notebook_id: str, cell_id: str, req: UpdateCellRequest, db: Session = Depends(get_db)) -> Notebook:
    nb = store_get(db, NS, notebook_id)
    if not nb:
        raise HTTPException(status_code=404, detail="Notebook not found")

    cell_ids = [c["cell_id"] for c in nb["cells"]]
    if cell_id not in cell_ids:
        raise HTTPException(status_code=404, detail="Cell not found")

    nb["cells"] = [
        {**c, "content": req.content, "outputs": [], "executed_at": None, "execution_count": None}
        if c["cell_id"] == cell_id
        else c
        for c in nb["cells"]
    ]
    nb["updated_at"] = datetime.now(timezone.utc).isoformat()
    store_put(db, NS, notebook_id, nb)
    return Notebook(**nb)


@router.post("/notebook/{notebook_id}/execute", response_model=List[ExecutionResult])
def execute_notebook(notebook_id: str, req: ExecuteRequest, db: Session = Depends(get_db)) -> List[ExecutionResult]:
    nb = store_get(db, NS, notebook_id)
    if not nb:
        raise HTTPException(status_code=404, detail="Notebook not found")

    # Determine which cells to execute
    if req.cell_id is not None:
        cells_to_run = [c for c in nb["cells"] if c["cell_id"] == req.cell_id]
        if not cells_to_run:
            raise HTTPException(status_code=404, detail="Cell not found")
    else:
        cells_to_run = [c for c in nb["cells"] if c["type"] == "code"]

    results: List[ExecutionResult] = []
    exec_counter = max(
        (c.get("execution_count") or 0 for c in nb["cells"]), default=0
    )

    # Mark notebook as running
    nb["status"] = "running"
    store_put(db, NS, notebook_id, nb)

    any_error = False
    updated_cells = list(nb["cells"])
    for cell in cells_to_run:
        outputs, time_ms, success = _simulate_execution(cell, nb["kernel"])
        exec_counter += 1
        now_iso = datetime.now(timezone.utc).isoformat()

        if not success:
            any_error = True

        # Update the cell in the list
        updated_cells = [
            {**c, "outputs": outputs, "executed_at": now_iso, "execution_count": exec_counter}
            if c["cell_id"] == cell["cell_id"]
            else c
            for c in updated_cells
        ]

        results.append(
            ExecutionResult(
                notebook_id=notebook_id,
                cell_id=cell["cell_id"],
                output=outputs,
                execution_time_ms=time_ms,
                success=success,
                executed_at=now_iso,
                is_simulated=True,
                simulation_note="Execution is simulated locally — outputs are template-generated, not from a real kernel",
            )
        )

    final_status = "error" if any_error else "idle"
    nb["cells"] = updated_cells
    nb["status"] = final_status
    nb["updated_at"] = datetime.now(timezone.utc).isoformat()
    store_put(db, NS, notebook_id, nb)

    return results


@router.delete("/notebook/{notebook_id}", status_code=204)
def delete_notebook(notebook_id: str, db: Session = Depends(get_db)) -> None:
    if not store_delete(db, NS, notebook_id):
        raise HTTPException(status_code=404, detail="Notebook not found")


# ---------------------------------------------------------------------------
# WebSocket — real-time collaboration
# ---------------------------------------------------------------------------

from fastapi import WebSocket, WebSocketDisconnect  # noqa: E402
from ..ws_manager import notebook_ws_manager  # noqa: E402


@router.websocket("/notebook/{notebook_id}/ws")
async def notebook_ws(notebook_id: str, websocket: WebSocket, db: Session = Depends(get_db)):
    """Real-time sync endpoint for a collaborative notebook."""
    # Verify notebook exists
    nb = store_get(db, NS, notebook_id)
    if not nb:
        await websocket.close(code=4004, reason="notebook not found")
        return

    await notebook_ws_manager.connect(notebook_id, websocket)
    try:
        # Send current state to newly connected client
        await websocket.send_json({"type": "init", "notebook": nb, "peers": notebook_ws_manager.room_size(notebook_id)})

        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "cell_update":
                # Client edited a cell — persist and broadcast
                cell_id = data.get("cell_id")
                source = data.get("source", "")
                nb = store_get(db, NS, notebook_id)
                if nb:
                    for cell in nb.get("cells", []):
                        if cell.get("cell_id") == cell_id:
                            cell["source"] = source
                            break
                    store_put(db, NS, notebook_id, nb)
                await notebook_ws_manager.broadcast(notebook_id, {
                    "type": "cell_update",
                    "cell_id": cell_id,
                    "source": source,
                    "sender_id": data.get("sender_id"),
                }, exclude=websocket)

            elif msg_type == "cursor":
                # Broadcast cursor position to peers
                await notebook_ws_manager.broadcast(notebook_id, {
                    "type": "cursor",
                    "cell_id": data.get("cell_id"),
                    "user": data.get("user", "anonymous"),
                    "color": data.get("color", "#6366f1"),
                }, exclude=websocket)

            elif msg_type == "cell_execute":
                # Broadcast that a cell is running
                await notebook_ws_manager.broadcast(notebook_id, {
                    "type": "cell_execute",
                    "cell_id": data.get("cell_id"),
                }, exclude=websocket)

    except WebSocketDisconnect:
        notebook_ws_manager.disconnect(notebook_id, websocket)
        await notebook_ws_manager.broadcast(notebook_id, {
            "type": "peer_left",
            "peers": notebook_ws_manager.room_size(notebook_id),
        })
