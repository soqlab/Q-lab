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

By default the SDK talks to `http://localhost:8000`, your own server, and never to ours unless you
say so. To use the hosted service, set `api_url="https://qlab.soqlab.com/qlab-api"` and the API key
from your account.


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
and a shareable dashboard URL. In detail:

- **Calibration**: from `backend.properties()` when the backend has it, otherwise
  from `backend.target` (any BackendV2, e.g. `GenericBackendV2`). Stored as
  `t1_us`, `t2_us`, `readout_errors` (per qubit), `gate_errors` and
  `gate_durations_us` (per instruction, keyed `cx_0_1`), and `last_update`.
  Times are in microseconds (the Target's seconds are converted).
- **Shots**: `execution.shots` comes from `backend.run(shots=...)`, a Sampler's
  per-pub shots, `run(shots=...)` or `default_shots`, or the backend's default
  (`execution.shots_source` says which). Estimators record `execution.precision`
  (per pub, `run(precision=...)` or `default_precision`).
- **Setup fingerprint**: `context.setup_fingerprint` is the SHA-256 of a canonical
  JSON (`context.setup`) of the circuit fingerprint, backend name, transpiler
  options (optimization level, seed, layout/routing/translation method, basis
  gates), shots and the versions of qiskit, qiskit-aer, qiskit-ibm-runtime and
  qlab-sdk. The circuit `fingerprint` is unchanged, so the same circuit on two
  devices shares a circuit fingerprint but not a setup fingerprint.
- **Circuit source**: when `transpile()` is used, `transpiler.qpy.before/after`
  hold the circuit before and after transpilation as base64 QPY (with
  `qpy_version`, `qiskit_version`, `sha256`), and `transpiler.qasm.before/after`
  the OpenQASM 3 (or 2) text. Each is capped at 512 KB (`QLAB_SOURCE_MAX_BYTES`);
  over the cap only the size and hash are kept. Nothing is captured in ZK-QCO mode.

## CI baseline checks

`qlab ci check` compares a run's measurement counts with a baseline run and fails
the build when the distribution has moved more than shot noise explains:

```bash
qlab ci check --run $NEW_RUN_ID --baseline $BASELINE_RUN_ID --margin 0.02 --junit reports/qlab.xml
```

The statistic is the total variation distance (TVD) between the two count
distributions. The threshold is `eps(n_run) + eps(n_baseline) + margin`, with
`eps(n) = sqrt((k ln 2 + ln(2/alpha)) / (2n))` for `n` shots and `k` outcomes seen:
a distribution-free concentration bound (Weissman et al.), so two runs of the same
setup exceed it with probability at most `alpha` (`--alpha`, default 0.01). More
shots give a tighter threshold; `--margin` allows for expected drift.

Exit codes: `0` pass, `1` regression, `2` the check could not run (missing run or
counts). `--junit PATH` writes a JUnit XML report for the CI's test view, `--json`
prints the numbers. `--run`/`--baseline` also accept a local `.json` file holding a
counts dict or a run as the API returns it. The command reads runs with
`GET /api/v1/runs/{id}` (set `QLAB_API_URL` and `QLAB_API_KEY`).

Failed uploads are queued locally and retried by `qlab.flush()` or the next SDK
startup. Set `QLAB_QUEUE_PATH` or pass `queue_path="..."` to control where the
retry queue is stored.
