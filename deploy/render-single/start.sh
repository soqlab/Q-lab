#!/usr/bin/env bash
# Runs the API on localhost and the site on $PORT. If either stops, the container exits so the
# platform restarts both together.
set -u

cd /app
uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers "${QLAB_WORKERS:-1}" &
api=$!

cd /web
HOSTNAME=0.0.0.0 node server.js &
web=$!

trap 'kill -TERM "$api" "$web" 2>/dev/null' TERM INT
wait -n "$api" "$web"
status=$?
kill -TERM "$api" "$web" 2>/dev/null
wait
exit "$status"
