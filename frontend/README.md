# Q-Lab Frontend

Dashboard frontend for the Q-Lab research platform.

There are two frontend tracks:

- `static/`: immediate no-build dashboard served by FastAPI at `/ui`.
- `app/`: Next.js source for the fuller frontend once npm dependencies install cleanly.

## Run Locally

Start the FastAPI backend first:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

Immediate frontend:

```text
http://127.0.0.1:8000/ui
```

Next.js frontend:

```powershell
cd frontend
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:3000
```

The frontend proxies API calls through `/qlab-api/*` to the backend. Override
the backend target with:

```powershell
$env:QLAB_API_URL="http://127.0.0.1:8000"
```

## Views

- `/` Run history, filters, metrics, gate-depth chart.
- `/runs/{run_id}` Run detail, QASM, fingerprint, parameters, context, downloads.
- `/compare` Structured comparison between two runs.
