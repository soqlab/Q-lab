# Q-Lab: Passive Quantum Experiment Tracker

A lightweight SDK that automatically captures quantum circuit metadata from Qiskit workflows.

## Philosophy

> Add one line to your Qiskit script and automatically get reproducible experiment history.

```python
import qlab
qlab.init()

# Your normal Qiskit code - Q-Lab captures everything silently
```

## Quick Start

### 1. Create Virtual Environment

```bash
python -m venv .venv
.venv\Scripts\Activate.ps1  # Windows PowerShell
source .venv/bin/activate   # macOS/Linux
```

### 2. Install Dependencies

```bash
pip install fastapi uvicorn httpx pydantic python-dotenv
pip install -e ./qlab_sdk
# In researcher environments that do not already have Qiskit:
pip install "qlab-sdk[qiskit]" qiskit-ibm-runtime
```

### 3. Start Backend

```bash
.\run_dev.ps1
```

Local development uses SQLite automatically at `backend/data/qlab.db`.
Production can use Timescale/Postgres:

```bash
pip install "psycopg[binary]"
set DATABASE_URL=postgresql+psycopg://qlab:qlab@localhost:5432/qlab
set QLAB_API_KEYS=dev-key-1,dev-key-2
```

When `QLAB_API_KEYS` is set, SDK uploads must include a matching key:

```python
qlab.init(api_url="https://your-qlab.example", api_key="dev-key-1")
```

SDK uploads are asynchronous. If the backend is unavailable, failed payloads are
queued locally at `%USERPROFILE%\.qlab\pending_runs.jsonl` on Windows or
`~/.qlab/pending_runs.jsonl` on Unix-like systems. Override with
`QLAB_QUEUE_PATH` or `qlab.init(queue_path="...")`.

### 4. Run Example

```bash
python qlab_sdk/examples/basic_qiskit_example.py
```

### SDK Configuration

Researchers can configure Q-Lab in code:

```python
import qlab
qlab.init(project="my-project", mask_keys=["secret_angle"])
```

or with `qlab.toml`:

```bash
copy qlab.example.toml qlab.toml
```

Then:

```python
import qlab
qlab.init()
```

Config precedence is:

1. explicit `qlab.init(...)` arguments
2. environment variables such as `QLAB_API_URL`, `QLAB_API_KEY`, `QLAB_PROJECT`
3. `qlab.toml`
4. SDK defaults

### 5. View Captured Data

```
http://127.0.0.1:8000/ui
```

### 6. Smoke Test

```bash
.\.venv\Scripts\python.exe scripts\smoke_test.py
```

### Docker

```bash
docker compose up --build
```

The containerized app runs at:

```text
http://127.0.0.1:8000/ui
```

The default container upload key is `dev-key`. Override it with:

```bash
set QLAB_API_KEYS=your-key
docker compose up --build
```

## Project Structure

```
q-lab/
├── qlab_sdk/              # Python SDK package
│   ├── qlab/
│   │   ├── __init__.py
│   │   ├── client.py      # HTTP client to backend
│   │   ├── fingerprint.py # Circuit analysis
│   │   ├── context.py     # Git/environment capture
│   │   └── qiskit_hooks.py # Qiskit integration
│   ├── examples/
│   ├── pyproject.toml
│   └── README.md
│
├── backend/               # FastAPI backend
│   ├── app/
│   │   ├── main.py       # API endpoints
│   │   ├── models.py     # Database models
│   │   └── database.py   # DB connection
│   ├── requirements.txt
│   └── .env
│
├── frontend/              # React dashboard (coming soon)
│   └── README.md
│
├── docker-compose.yml     # TimescaleDB + MinIO
└── README.md
```

## Backend Configuration

- `DATABASE_URL`: SQLAlchemy database URL. Defaults to local SQLite.
- `QLAB_API_KEYS`: comma-separated upload keys. If omitted, local dev accepts uploads without auth.
- `QLAB_QUEUE_PATH`: optional SDK retry queue path for failed uploads.

## Analytics API

```text
GET /api/v1/metrics/runs
```

Supports `backend`, `status`, and `project` filters. Returns completion rate,
failure rate, result capture rate, backend usage, status mix, gate counts, and
timeline data.

## Exports And Reports

```text
GET /api/v1/exports/runs.csv
GET /api/v1/exports/runs.jsonl
GET /api/v1/reports/runs.md
```

All export endpoints support `backend`, `status`, and `project` filters. The
dashboard exposes these as CSV, JSONL, and Report buttons beside the run filters.

## Captured Metadata

- **Circuit Structure**: qubits, classical bits, depth, gate counts
- **Gate Analysis**: non-Clifford ratio, gate breakdown
- **Quantum ASM**: Full QASM3 export
- **Context**: Git commit, branch, Python version
- **Execution**: Backend name, timestamp
- **Job Metadata**: job id, job class/status, and submission errors where available
- **Results**: counts, quasi distributions, result metadata, and success metrics where available
- **Privacy**: Client-side masking for sensitive parameter keys
- **Sharing**: Per-run dashboard URL, QASM download, and rerun helper
- **Reproducibility**: ZIP bundle with metadata, QASM, requirements, and rerun helper

## MVP Roadmap

- ✅ Day 1: Basic SDK + FastAPI receiver
- ⏳ Day 2: Qiskit Sampler/Estimator interception
- ⏳ Day 3: Git commit + environment capture
- ⏳ Day 4: Postgres/TimescaleDB storage
- ⏳ Day 5: Simple web dashboard

## Key Design Principles

1. **Zero-impact to researcher code**: Q-Lab failures never crash Qiskit workflows
2. **Minimal setup**: One import, one function call
3. **Silent operation**: No console spam, async uploads
4. **Passive tracking**: Captures what's already running
5. **Open data**: Export to JSON/QASM

## Deploy

### One-click Deploy

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/yasseennandally/q-lab)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/yasseennandally/q-lab)

### Manual Deploy

**Railway:**
```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

**Fly.io:**
```bash
fly auth login
fly launch --no-deploy
fly deploy
```

**Docker:**
```bash
docker compose up -d
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SECRET_KEY` | Yes | JWT signing key (generate: `openssl rand -hex 32`) |
| `ANTHROPIC_API_KEY` | No | Enables AI insights |
| `RESEND_API_KEY` | No | Enables email (invite, alerts) |
| `CLICKHOUSE_URL` | No | ClickHouse for analytics at scale |
| `IBM_QUANTUM_TOKEN` | No | Real IBM Quantum hardware |
| `IONQ_API_KEY` | No | Real IonQ hardware |

## Later (Not MVP)

- Next.js dashboard
- D3 circuit visualization
- MinIO circuit storage
- protobuf/msgpack compression
- Multi-tenant accounts
- Complex authentication
