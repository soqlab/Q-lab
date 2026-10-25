#!/usr/bin/env bash
# Runs the API on localhost and the site on $PORT. If either stops, the container exits so the
# platform restarts both together.
set -u

cd /app
# Keep idle connections open longer than the site's proxy pool keeps them (Node: ~5 s), or a
# request can land on a connection uvicorn is closing (ECONNRESET, seen as random 500s).
uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers "${QLAB_WORKERS:-1}" --timeout-keep-alive 75 &
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
