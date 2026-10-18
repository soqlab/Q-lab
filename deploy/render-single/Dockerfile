# Q-Lab in one container: the Next.js site in front, the FastAPI backend behind it on localhost.
# Used by render.yaml to run on a single Render service. The two-service layout (backend/Dockerfile +
# frontend/Dockerfile) still works unchanged: see deploy/render-split.yaml and docker-compose.yml.
# Build from the repository root: docker build -f deploy/render-single/Dockerfile .

FROM node:20-bookworm-slim AS web
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
# Requests on these host names go straight to the API (the SDK posts runs to them).
ARG QLAB_BACKEND_HOSTS=qlab-backend.onrender.com
ENV QLAB_API_URL=http://127.0.0.1:8000 \
    QLAB_BACKEND_HOSTS=$QLAB_BACKEND_HOSTS \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM python:3.12-slim
WORKDIR /app

# System deps for Qiskit visualization (as in backend/Dockerfile)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ cmake curl \
    libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=web /usr/local/bin/node /usr/local/bin/node

COPY backend/requirements.txt .
RUN pip install --no-cache-dir --prefer-binary -r requirements.txt

# The backend keeps the same layout as backend/Dockerfile, so the disk at /app/data is unchanged.
COPY backend/ .
COPY --from=web /web/.next/standalone /web
COPY --from=web /web/.next/static /web/.next/static
COPY --from=web /web/public /web/public
COPY deploy/render-single/start.sh /start.sh

ENV NODE_ENV=production PORT=10000
EXPOSE 10000
CMD ["bash", "/start.sh"]
