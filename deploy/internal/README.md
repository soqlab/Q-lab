# Q-Lab inside your company network (no internet)

**Written for: the IT team installing Q-Lab on a company server that has no internet access.**

Q-Lab runs entirely on your server. Experiment data stays in its Postgres database. The SDK
reports only to your server, and neither the server nor the SDK sends telemetry or checks for
updates.

## What you need

| | |
|---|---|
| A Linux server | 2 vCPU, 4 GB RAM, 20 GB disk. Any distribution with Docker Engine and the compose plugin. |
| An internal name | For example `qlab.corp.example`, resolving to the server in your internal DNS. |
| A certificate | For that name, from your company certificate authority (`cert.pem` with the full chain, and `key.pem`). |
| The bundle | `qlab-offline-<version>.tar.gz`, copied to the server by whatever route your network allows. |

## Install the server

```sh
tar -xzf qlab-offline-<version>.tar.gz
cd qlab-offline-<version>
sha256sum -c SHA256SUMS        # the files arrived intact
sh setup.sh                    # loads the images, creates .env with new secrets
```

Then:

1. **`.env`**: set `SITE_ADDRESS` to your internal name. Set `QLAB_OWNER_EMAIL` to the email
   of the person who will administer Q-Lab.
2. **`tls/`**: put `cert.pem` and `key.pem` here.
3. Start it:

```sh
docker compose up -d
```

Open `https://<your internal name>` and sign up, first with the owner email, then everyone else.
Without a mail server, accounts work straight away with no email confirmation. With
`SMTP_HOST` set in `.env`, Q-Lab sends confirmation and password-reset emails through it.

Keep a copy of `.env`. `QLAB_SECRET_KEY` also encrypts stored credentials, so a restored
backup needs it.

## Install the SDK on researchers' machines

The bundle contains the SDK as a wheel in `sdk/`. Its only dependency is `httpx`, plus Qiskit,
which researchers usually have already. Install from your internal package mirror, or from
wheels you bring in:

```sh
pip install sdk/qlab_sdk-*.whl
```

Point it at your server:

```python
import qlab
qlab.init(api_url="https://qlab.corp.example/qlab-api", api_key="<key from Settings › API keys>")
```

You can also set `QLAB_API_URL` and `QLAB_API_KEY` as environment variables. If your certificate
comes from a company authority that Python doesn't trust yet, set `SSL_CERT_FILE` to your
company's CA bundle.

## What works without the internet

| Feature | Offline |
|---|---|
| Experiment tracking, runs, projects, comparisons, dashboards | Yes |
| Local simulators (Qiskit Aer) | Yes |
| Accounts, organizations, API keys | Yes |
| Running on IBM Quantum or other cloud hardware | Needs a route to that provider. Only the researcher's machine needs it, not the Q-Lab server. |
| AI features | Yes, with your own model on your network: under **Credentials**, add a **custom** provider with the address of your Ollama, vLLM or LM Studio server. |
| arXiv search, DOI and Zenodo publishing, GitHub, Slack, sign-in with Google/GitHub | Off. These are internet services. |

## Updating

Bring in the new bundle the same way, then:

```sh
tar -xzf qlab-offline-<new version>.tar.gz
cd qlab-offline-<new version>
gunzip -c images.tar.gz | docker load
cp ../qlab-offline-<old version>/.env .
cp -r ../qlab-offline-<old version>/tls .
docker compose up -d
```

Your data is kept: it lives in the `qlab_pgdata` Docker volume, not in the folder.

## Backups

```sh
docker compose exec db pg_dump -U qlab qlab | gzip > qlab-backup-$(date +%F).sql.gz
```

Keep the backup together with `.env`.

## Building the bundle

On a machine with internet and Docker, from the repository:

```sh
sh deploy/internal/make-bundle.sh
```

This writes `dist/qlab-offline-<date>-<commit>.tar.gz`.
