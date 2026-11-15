# Self-Hosting Q-Lab

Q-Lab is MIT-licensed and fully self-hostable. Run it on your own servers — your experiment data never leaves your infrastructure.

## Inside a company network, with no internet

[deploy/internal/README.md](deploy/internal/README.md) installs Q-Lab on a server with no internet
access. You get one bundle file with the images and the SDK, a setup script that generates the
secrets, and HTTPS with the company's own certificate. Nothing calls out: the SDK sends no
telemetry to a self-hosted server, and accounts need no email confirmation when no mail server is
configured.

## Requirements

- Docker & Docker Compose
- A database: SQLite or PostgreSQL (see below)

## Database: SQLite or PostgreSQL

Both are supported. Q-Lab picks one from `DATABASE_URL`:

- **SQLite** (`sqlite:///./data/qlab.db`, also the default when `DATABASE_URL` is unset): one file,
  no database server. Keep the `data/` directory on a persistent volume and back that file up. This
  is what the hosted Q-Lab at qlab.soqlab.com runs: SQLite on a persistent disk, in one container
  (`render.yaml`, `deploy/render-single`). It suits one server; it does not suit several backend
  instances writing at once.
- **PostgreSQL** (`postgresql+psycopg://user:pass@host/db`): what `docker-compose.yml` and
  `docker-compose.prod.yml` start, for installs that want a separate database server, its backups
  and replication, or more than one backend instance.

On startup the backend creates any missing tables and columns itself, on either database.
`backend/alembic` holds the same changes as Alembic migrations for those who manage the schema
with Alembic (see `backend/MIGRATIONS.md`). To move an existing PostgreSQL install to SQLite, set
`MIGRATE_FROM_DATABASE_URL` to the PostgreSQL URL and `DATABASE_URL` to the SQLite one; the data is
copied once, on first start.

## Quick Start

```bash
git clone https://github.com/soqlab/Q-lab.git
cd Q-lab
cp .env.example .env
# Edit .env — set QLAB_SECRET_KEY, DATABASE_URL, and SMTP credentials
docker compose up -d
```

The app is now running at `http://localhost:3000`.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `QLAB_SECRET_KEY` | Yes | 32+ char random string. Signs sessions and encrypts saved provider keys and integration secrets (webhook secrets, Slack/Teams/GitHub tokens). Changing it signs everyone out and makes those saved secrets unreadable: they have to be entered again |
| `DATABASE_URL` | No | `sqlite:///./data/qlab.db` (the default) or a PostgreSQL URL (`postgresql+psycopg://user:pass@host/db`); see above |
| `QLAB_APP_URL` | Yes | Your public URL (e.g. `https://qlab.yourdomain.com`) |
| `SMTP_HOST` | No | SMTP server for email verification |
| `SMTP_PORT` | No | SMTP port (default 587) |
| `SMTP_USER` | No | SMTP username |
| `SMTP_PASSWORD` | No | SMTP password (`SMTP_PASS` also works) |
| `SMTP_FROM` | No | From address for outgoing emails |
| `ENVIRONMENT` | No | Set to `production` to disable `/docs` and `/redoc` |
| `QLAB_PASSKEYS_ONLY` | No | `true`: passkeys only. No password is set, reset or accepted; "forgot password" emails a single-use 15-minute link that registers a new passkey; a password user signs in once more with the password and must add a passkey, after which the password is deleted; creating or revoking API keys needs a passkey session. Google and GitHub create no accounts and give no session: an account made with them that has no passkey yet can use them once, to create its passkey, after which they are refused for it. Needs https (or `http://localhost`). Default off. |
| `QLAB_SOQLAB_ID_ISSUER`, `QLAB_SOQLAB_ID_CLIENT_ID`, `QLAB_SOQLAB_ID_CLIENT_SECRET` | No | Sign in with SOQLAB: one passkey (made at the issuer, e.g. `https://id.soqlab.com`) for SOQLAB's products. Off unless all three are set and `QLAB_APP_URL` is too; register `<QLAB_APP_URL>/soqlab-callback` as the redirect URI at the issuer. Accounts link and unlink in Settings; existing Q-Lab passkeys keep working. The issuer must be https (http only for localhost). |
| `QLAB_WEBAUTHN_RP_ID` | No | Passkey domain (default: the host of `QLAB_APP_URL`). Passkeys are bound to it: changing it later strands existing passkeys |
| `QLAB_ERASURE_INTERVAL_SECONDS` | No | How often the backend erases accounts whose 7-day deletion grace period is over (default `3600`). `0` turns the schedule off; an admin can then run `POST /api/v1/gdpr/delete/process` |
| `QLAB_WEBAUTHN_ORIGINS` | No | Extra origins allowed to use passkeys, comma-separated (default: only `QLAB_APP_URL`'s origin) |
| `QISKIT_IBM_TOKEN` | No | IBM Quantum API key (the free open plan is enough). Turns on the hardware board, machine pick and Rewind's calibration harvest. Without it they say so and show nothing |
| `QLAB_REWIND_DIR` | No | Where Rewind keeps calibration snapshots and manifests (default `backend/data/rewind`, on the data disk). Keep it on persistent storage: a day's calibration can't be collected again later |
| `QLAB_REWIND_SIGNING_KEY` | No | Signs Rewind's daily manifests (Ed25519 + ML-DSA-65). Make one with `python -m app.rewind keygen` (from `backend/`); keep it secret. Without it manifests are stored unsigned and the API says so |
| `QLAB_CERT_SIGNING_KEY` | No | Signs provenance certificates (Ed25519 + ML-DSA-65), same `qrk1:` form as the Rewind key (`python -m app.rewind keygen`). Optional: without it certificates are signed with `QLAB_REWIND_SIGNING_KEY`; without either they are issued unsigned and say so. The public key is at `/api/v1/certificates/public-key` |
| `QLAB_REWIND_TRIGGER_TOKEN` | No | Lets the scheduled workflow (`.github/workflows/rewind-harvest.yml`, repository secret of the same name) start a harvest with the `X-Rewind-Trigger` header |
| `QLAB_REWIND_MAX_QUBITS` | No | Rewind replays: most qubits after compiling (default `20`, at most `28`; a statevector needs 16 × 2^n bytes and Aer's shot branching keeps several). Also `QLAB_REWIND_MAX_SHOTS` (`8192`), `QLAB_REWIND_MAX_SHOTS_ANON` (`4096`, without an account), `QLAB_REWIND_MAX_WORK` (`3e9` shots × operations × 2^qubits, half without an account), `QLAB_REWIND_TIME_LIMIT_S` (`60`), `QLAB_REWIND_CONCURRENCY` (`1`, at most `2`), `QLAB_REWIND_MAX_MEMORY_MB` (`256`), `QLAB_REWIND_THREADS` (`1`), `QLAB_REWIND_DENSITY_MAX` (`10`: density matrix up to this many qubits), `QLAB_REWIND_SHOT_BRANCHING` (`on`: Aer's shot branching, about 10x faster but far more memory; off by default) |
| `QLAB_REWIND_EVERY_HOURS` | No | Hours between harvests (default `20`). `QLAB_REWIND_SCHEDULER=off` stops the background harvest; `QLAB_REWIND_AUTO_BACKFILL=off` stops the automatic backfill |
| `QLAB_REWIND_BENCH_MACHINES_PER_WEEK` | No | Rewind's accuracy benchmark ([docs/REWIND_METHOD.md](docs/REWIND_METHOD.md)): machines per weekly run on real hardware, round robin among those with a fresh calibration (default `3`; `0` turns it off). Also `QLAB_REWIND_BENCH_CIRCUITS` (`20`: circuits from the set per run), `QLAB_REWIND_BENCH_SHOTS` (`4000`). Runs on the hardware board's thread, so `QLAB_HARDWARE_BOARD_SCHEDULER=off` stops it too |
| `QLAB_REWIND_BENCH_BUDGET_SECONDS_PER_28D` | No | QPU seconds per rolling 28 days that the hardware board and Rewind's benchmark may use together (default `480` of the open plan's 600). Each job is estimated before submission (2 s + 0.00035 s per shot of each circuit) and refused if it would go over; IBM's reported usage replaces the estimate once the job ends |

## Provenance certificates and the Reproduced badge

Every run has a signed provenance certificate (`GET /api/v1/runs/{id}/certificate`, the run's
Actions menu, "Certificate"): hashes of the circuit as given to the compiler, as compiled and as
stored, the machine, a hash of the calibration recorded with the run (and the matching Rewind
snapshot when one was stored), package versions, transpiler settings, seeds, shots, a hash of the
counts, and how re-runs compared. It holds hashes and settings, never the circuit, counts or
calibration themselves, and nothing about the uploader. Only the owner can fetch it, or anyone
once the run is shared.

A shared run also gets a public page, `/verified/<share token>`, that says whether re-runs agreed
and checks the certificate in the visitor's browser, and a badge, `/verified/<share token>/badge.svg`
("reproduced", "reproduced 2/3", "didn't reproduce", "not yet reproduced"). Re-runs that count are
the owner's own and those other accounts shared. Turning sharing off takes both down (404; the
badge then reads "not shared").

### Verify a certificate offline

The verifier is one file that needs only Python and `cryptography` 46 or newer
(`backend/app/provenance/verify.py`, also served at `/api/v1/certificates/verify.py`):

```bash
pip install "cryptography>=46"
curl -o verify_certificate.py https://qlab.soqlab.com/qlab-api/api/v1/certificates/verify.py
python verify_certificate.py --file qlab-certificate-<run>.json --key qrk-<the key id you trust>
python verify_certificate.py --token <share token>             # fetch a shared run's certificate
python verify_certificate.py --file c.json --qasm circuit.qasm  # and check a circuit file against it
```

It prints `VALID` (exit 0) only when the body's SHA-256 matches and both signatures verify. What
is checked: `body_sha256` is the SHA-256 of the `certificate` object as RFC 8785 canonical JSON
(keys sorted, no whitespace, only integers, strings, booleans and null; decimals are strings); the
signed text is

```
qlab-provenance-certificate/1
key <key id>
signed-at <UTC time>
body-sha256 <hex>
```

signed with Ed25519 and with ML-DSA-65 (FIPS 204, context string `qlab-provenance-certificate/1`).
The key id is `qrk-` + the first 32 hex digits of SHA-256(`qlab-rewind-key/1` + newline + ML-DSA-65
public key + Ed25519 public key). A certificate carries its own public key, so pin the key id: the hosted
one is at `https://qlab.soqlab.com/qlab-api/api/v1/certificates/public-key`. The same check runs in
the browser on `/verified/...` and `/certificate` (any saved certificate file), with
@noble/post-quantum 0.7.1 and @noble/curves 2.4.0 served from the site itself
(`frontend/public/vendor/qlab-pq-verify.js`, built by `tools/pq-verify-js`).

## Docker Compose (PostgreSQL)

```yaml
version: "3.9"
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: qlab
      POSTGRES_USER: qlab
      POSTGRES_PASSWORD: changeme
    volumes:
      - pgdata:/var/lib/postgresql/data

  backend:
    build: ./backend
    environment:
      DATABASE_URL: postgresql+psycopg://qlab:changeme@db/qlab
      QLAB_SECRET_KEY: your-secret-key-here
      QLAB_APP_URL: http://localhost:3000
      ENVIRONMENT: production
    depends_on:
      - db
    ports:
      - "8000:8000"

  frontend:
    build: ./frontend
    environment:
      QLAB_API_URL: http://backend:8000
    ports:
      - "3000:3000"
    depends_on:
      - backend

volumes:
  pgdata:
```

## AI Provider

Q-Lab supports any AI provider for AI features (insights, lab assistant, circuit designer, etc.).
Users add their own API key in **Settings → Credentials** and choose their preferred provider:

| Provider | Notes |
|---|---|
| Anthropic (Claude) | [console.anthropic.com](https://console.anthropic.com) |
| OpenAI (GPT-4o) | [platform.openai.com](https://platform.openai.com) |
| Groq | Free tier available — [console.groq.com](https://console.groq.com) |
| Mistral AI | [console.mistral.ai](https://console.mistral.ai) |
| Google Gemini | [aistudio.google.com](https://aistudio.google.com) |
| Custom / local | Any OpenAI-compatible server — Ollama, LM Studio, vLLM, etc. |
| Custom Agent | Your own HTTP endpoint — LangChain, CrewAI, n8n, FastAPI, etc. Q-Lab POSTs `{"prompt","system","max_tokens"}` and reads `{"content":"..."}` from the response. |

No `ANTHROPIC_API_KEY` environment variable is needed. Each user provides their own key.

## SDK Configuration

Point the SDK at your self-hosted instance:

```python
import qlab

qlab.init(
    api_key="your-api-key",
    api_url="https://qlab.yourdomain.com/qlab-api",
)
```

## Telemetry

The Q-Lab SDK sends one anonymous ping when `qlab.init()` is called. It contains only the SDK version and Python version — nothing identifying, no experiment data, no hostnames.

To opt out, set the environment variable before running your code:

```bash
export QLAB_TELEMETRY=off
```

## Data & Privacy

All experiment data is stored in your database (the SQLite file or your PostgreSQL server). Nothing is sent to external services unless you explicitly configure integrations (Zenodo, SMTP, etc.).

## Support

- GitHub Issues: https://github.com/soqlab/Q-lab/issues
- Email: contact@soqlab.com
