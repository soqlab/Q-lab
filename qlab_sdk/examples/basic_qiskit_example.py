import qlab
qlab.init(
    api_url="http://localhost:8000",
    include_pip_freeze=False,
    mask_keys=["api_token", "secret_angle"],
    project="bell-demo",
    tags=["mvp", "local"],
)

from qiskit import QuantumCircuit

qc = QuantumCircuit(2, 2)
qc.h(0)
qc.cx(0, 1)
qc.measure([0, 1], [0, 1])

run_id = qlab.track(
    qc,
    backend_name="local-test",
    parameters={"shots": 1024, "secret_angle": 0.125},
)
qlab.flush()

print(f"Circuit captured: http://localhost:8000/runs/{run_id}")
