# qlab-sdk

Python SDK for [Q-Lab](https://qlab.soqlab.com) — the quantum experiment tracker.

## Install

```bash
pip install qlab-sdk
```

## Quick start

```python
from qlab import QLabTracker

tracker = QLabTracker(
    api_key="qlab_YOUR_KEY",
    url="https://qlab.soqlab.com",
)

# One-shot log
tracker.log_run(
    circuit_name="bell-state",
    backend="ibm_brisbane",
    results={"00": 512, "11": 512},
    status="completed",
)
```

## With Qiskit

```python
from qlab import QLabTracker
from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

tracker = QLabTracker(api_key="qlab_YOUR_KEY", url="https://qlab.soqlab.com")
sim = AerSimulator()

with tracker.run("bell-circuit", project="my-project") as run:
    qc = QuantumCircuit(2)
    qc.h(0)
    qc.cx(0, 1)
    qc.measure_all()

    run.capture_circuit(qc)
    run.log(parameters={"shots": 1024})

    job = sim.run(qc, shots=1024)
    run.log(results=job.result().get_counts(), status="completed")
```

No external dependencies. Works with Python 3.9+.
