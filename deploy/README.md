# Deploying Q-Lab on Render

Q-Lab can run on Render in two layouts. Both use the same code; only the Render configuration differs.

| Layout | Config | Services | Cost |
|---|---|---|---|
| **Single** (current) | `render.yaml` | `qlab-backend` runs the site and the API in one container | 1 Starter + disk |
| **Split** | `deploy/render-split.yaml` | `qlab-backend` (API) and `qlab-frontend` (site) | 2 Starter + disk |

In both layouts the API service is called `qlab-backend` and keeps the data disk, so
`https://qlab-backend.onrender.com` (where the SDK sends runs) and the database never move.

## How the single layout works

`deploy/render-single/Dockerfile` builds the Next.js site and the FastAPI backend into one image.
`start.sh` runs the API on `127.0.0.1:8000` with one worker (`QLAB_WORKERS` to change it) and the site
on `$PORT`. The site forwards:

- `/qlab-api/*` to the API, as in every layout;
- every request on the host names in `QLAB_BACKEND_HOSTS` (build argument, default
  `qlab-backend.onrender.com`) to the API untouched, so SDK clients see the same API as before;
- `/health` to the API, for Render's health check.

If either process stops, the container exits and Render restarts both.

## Switching to the split layout

1. Copy `deploy/render-split.yaml` over `render.yaml`, commit and push.
2. In Render, create the `qlab-frontend` service from the Blueprint (or recreate it by hand:
   Docker, `./frontend/Dockerfile`, context `./frontend`, env `QLAB_API_URL=https://qlab-backend.onrender.com`).
   If `qlab-frontend` was only suspended, resume it instead.
3. Move the custom domain `qlab.soqlab.com` from `qlab-backend` to `qlab-frontend` in Render, and
   point the Cloudflare `qlab` CNAME at `qlab-frontend.onrender.com` (DNS only, grey cloud).

## Switching to the single layout

1. Use `render.yaml` as it is in this repository; `qlab-backend` redeploys with the combined image.
2. Once it is live, move the custom domain `qlab.soqlab.com` from `qlab-frontend` to `qlab-backend`
   in Render, and point the Cloudflare `qlab` CNAME at `qlab-backend.onrender.com` (DNS only).
3. Check https://qlab.soqlab.com, then suspend `qlab-frontend` (keep it a few days before deleting).
