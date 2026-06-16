# Q-Lab SDK

Passive experiment tracker for Qiskit workflows.

## Installation

```bash
pip install -e .
```

## Quick Start

```python
import qlab
qlab.init(
    api_url="http://localhost:8000",
    api_key="optional-upload-key",
    mask_keys=["api_token", "secret_parameter"],
    project="my-lab",
)

# Your normal Qiskit Sampler/Estimator/backend.run code here.
```

Or configure Q-Lab with `qlab.toml` and keep notebooks clean:

```toml
[qlab]
api_url = "http://127.0.0.1:8000"
project = "my-lab"
tags = ["experiment-a"]
mask_keys = ["api_token", "secret_angle"]
include_pip_freeze = false
zk_qco = false
zk_qco_salt = ""
```

Then:

```python
import qlab
qlab.init()
```

That's it. Q-Lab silently captures circuit metadata when supported Qiskit
primitives submit circuits. For local notebooks or scripts, capture explicitly:

```python
run_id = qlab.track(circuit, backend_name="local-simulator")
print(f"http://localhost:8000/runs/{run_id}")
```

Attach result metadata explicitly:

```python
qlab.log_result(
    run_id,
    {"counts": {"00": 512, "11": 512}, "success_probability": 1.0},
)
qlab.flush()
```

For observer telemetry, include depth-labeled count snapshots in the result
payload. Q-Lab will plot coherence, purity, and correlation trends on the run
detail page:

```python
qlab.log_result(
    run_id,
    {
        "counts": {"00": 512, "11": 512},
        "qoe_snapshots": [
            {"depth": 4, "label": "after entangler", "counts": {"00": 420, "11": 410, "01": 98, "10": 96}},
            {"depth": 12, "label": "before measure", "counts": {"00": 360, "11": 330, "01": 170, "10": 164}},
        ],
    },
)
```

Q-Lab also computes two higher-level run analyses automatically from captured
QASM, fingerprints, calibration, transpiler data, and results:

- UAF-CPT: a provider-agnostic algorithmic fingerprint plus portability and
  estimated fidelity scores for IBM, IonQ, Quantinuum, Rigetti-style targets,
  and any backend already observed in your Q-Lab history.
- AEMD: automated error-mechanism deconvolution that estimates how much of an
  observed fidelity drop is explained by hardware noise versus residual
  algorithmic/model mismatch.

For proprietary circuits, enable Zero-Knowledge Circuit Obfuscation:

```toml
[qlab]
zk_qco = true
zk_qco_salt = "local-secret-salt"
```

In ZK-QCO mode, the SDK uploads depth, gate counts, qubit counts, and salted
circuit hashes, but does not upload raw QASM.

Captured fields include QASM, circuit fingerprint, git/runtime context, masked
parameters, backend name, execution metadata, result metadata, project, tags,
and a shareable dashboard URL.

Failed uploads are queued locally and retried by `qlab.flush()` or the next SDK
startup. Set `QLAB_QUEUE_PATH` or pass `queue_path="..."` to control where the
retry queue is stored.
