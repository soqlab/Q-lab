# Self-Hosting Q-Lab

Q-Lab is MIT-licensed and fully self-hostable. Run it on your own servers — your experiment data never leaves your infrastructure.

## Requirements

- Docker & Docker Compose
- A PostgreSQL database (or use the bundled one)

## Quick Start

```bash
git clone https://github.com/yasseennandally/Q-lab.git
cd Q-lab
cp .env.example .env
# Edit .env — set QLAB_SECRET_KEY, DATABASE_URL, and SMTP credentials
docker compose up -d
```

The app is now running at `http://localhost:3000`.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `QLAB_SECRET_KEY` | Yes | 32+ char random string for JWT signing and credential encryption |
| `DATABASE_URL` | Yes | PostgreSQL connection string (`postgresql+psycopg://user:pass@host/db`) |
| `QLAB_APP_URL` | Yes | Your public URL (e.g. `https://qlab.yourdomain.com`) |
| `SMTP_HOST` | No | SMTP server for email verification |
| `SMTP_PORT` | No | SMTP port (default 587) |
| `SMTP_USER` | No | SMTP username |
| `SMTP_PASSWORD` | No | SMTP password |
| `SMTP_FROM` | No | From address for outgoing emails |
| `ENVIRONMENT` | No | Set to `production` to disable `/docs` and `/redoc` |

## Docker Compose

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

## Data & Privacy

All experiment data is stored in your PostgreSQL database. Nothing is sent to external services unless you explicitly configure integrations (Zenodo, SMTP, etc.).

## Support

- GitHub Issues: https://github.com/yasseennandally/Q-lab/issues
- Email: contact@soqlab.com
