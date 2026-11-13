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
| `QLAB_WEBAUTHN_RP_ID` | No | Passkey domain (default: the host of `QLAB_APP_URL`). Passkeys are bound to it: changing it later strands existing passkeys |
| `QLAB_ERASURE_INTERVAL_SECONDS` | No | How often the backend erases accounts whose 7-day deletion grace period is over (default `3600`). `0` turns the schedule off; an admin can then run `POST /api/v1/gdpr/delete/process` |
| `QLAB_WEBAUTHN_ORIGINS` | No | Extra origins allowed to use passkeys, comma-separated (default: only `QLAB_APP_URL`'s origin) |

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
