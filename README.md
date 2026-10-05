# Q-Lab — Quantum Experiment Intelligence Platform

> Capture, analyze, and reproduce every quantum circuit execution — with one SDK call and zero configuration.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Self-Hostable](https://img.shields.io/badge/self--hostable-yes-green.svg)](SELF_HOSTING.md)
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/soqlab/Q-lab)

---

## What is Q-Lab?

Q-Lab is an open-source experiment tracker for quantum computing research. It patches Qiskit's Sampler and Estimator transparently — every circuit execution is logged automatically, no code changes required.

```python
import qlab
qlab.auto_track(api_key="YOUR_KEY")

# Your existing Qiskit code — unchanged
sampler = Sampler()
job = sampler.run(circuits, observables)  # Q-Lab captures this silently
```

**What gets captured automatically:**
- Circuit structure (qubits, depth, gate counts, QASM)
- Backend name, calibration snapshot, shot count
- Execution results, fidelity, quasi-distributions
- Git commit, branch, Python version
- Job ID and status

---

## Stack

| Layer | Technology |
|---|---|
| SDK | Python, Qiskit integration |
| Backend | FastAPI + SQLAlchemy (SQLite dev / PostgreSQL prod) |
| Frontend | Next.js 14 (App Router) |
| Auth | JWT, role-based access control |

---

## Quick Start (Local Dev)

### 1. Clone and set up

```bash
git clone https://github.com/soqlab/Q-lab.git
cd Q-lab
```

### 2. Backend

```bash
python -m venv .venv
source .venv/bin/activate        # macOS/Linux
.venv\Scripts\Activate.ps1       # Windows PowerShell

pip install -r backend/requirements.txt
cp .env.example .env             # edit as needed

cd backend
uvicorn app.main:app --reload --port 8000
```

Local dev uses SQLite automatically — no database setup needed.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 4. SDK

```bash
pip install -e ./qlab_sdk
python qlab_sdk/examples/basic_qiskit_example.py
```

---

## Self-Hosting

See [SELF_HOSTING.md](SELF_HOSTING.md) for Docker Compose setup, environment variables, and one-click deploy options.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Project Structure

```
Q-lab/
├── qlab_sdk/          # Python SDK (pip install qlab-sdk)
├── backend/           # FastAPI backend
│   └── app/
│       ├── main.py
│       ├── models.py
│       ├── routers/   # one file per feature
│       └── backends.py  # quantum provider registry
├── frontend/          # Next.js dashboard
│   └── app/
│       ├── (main)/    # authenticated app shell
│       └── (auth)/    # login, register, etc.
├── SELF_HOSTING.md
├── CONTRIBUTING.md
└── docker-compose.yml
```

---

## License

MIT — see [LICENSE](LICENSE).
