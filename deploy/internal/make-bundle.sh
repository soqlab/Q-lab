#!/bin/sh
# Builds the offline bundle: one file a company copies into its network and installs with no
# internet access. Run on a machine WITH internet, from anywhere in the repository:
#   sh deploy/internal/make-bundle.sh
# Output: dist/qlab-offline-<date>-<commit>.tar.gz with the images, this folder and the SDK.
set -eu
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

version="$(date +%Y.%m.%d)-$(git rev-parse --short HEAD 2>/dev/null || echo local)"
name="qlab-offline-$version"
work="dist/$name"
rm -rf "$work"
mkdir -p "$work/sdk"

echo "Building images ($version)..."
docker build --platform linux/amd64 -t qlab-backend:offline backend
docker build --platform linux/amd64 --build-arg QLAB_API_URL=http://backend:8000 -t qlab-frontend:offline frontend
docker pull --platform linux/amd64 postgres:16-alpine
docker pull --platform linux/amd64 caddy:2-alpine

# Refuse to package local secrets or databases (an image is a file people copy around).
leak_check() {
  found="$(docker run --rm --entrypoint sh "$1" -c "find /app \( -name '.env' -o -name '*.db' -o -name '*.sqlite*' \) 2>/dev/null | head -5")"
  if [ -n "$found" ]; then echo "Refusing to bundle $1: it contains $found" >&2; exit 1; fi
}
leak_check qlab-backend:offline
leak_check qlab-frontend:offline

echo "Saving images..."
docker save qlab-backend:offline qlab-frontend:offline postgres:16-alpine caddy:2-alpine | gzip > "$work/images.tar.gz"

echo "Building the SDK wheel..."
# Streamed in and out with tar rather than mounted: no host-path translation (Git Bash on Windows).
tar -C qlab_sdk --exclude=__pycache__ --exclude='*.egg-info' --exclude=build --exclude=dist -cf - .   | docker run --rm -i python:3.12-slim sh -c "mkdir /s /out && tar -xf - -C /s && pip wheel -q --no-deps -w /out /s >&2 && tar -C /out -cf - ."   | tar -C "$work/sdk" -xf -

for f in compose.yml Caddyfile setup.sh README.md; do
  cp "deploy/internal/$f" "$work/"
done
cp LICENSE "$work/LICENSE"
echo "$version" > "$work/VERSION"
(cd "$work" && sha256sum images.tar.gz sdk/*.whl > SHA256SUMS)

tar -C dist -czf "dist/$name.tar.gz" "$name"
rm -rf "$work"
echo "Done: dist/$name.tar.gz"
