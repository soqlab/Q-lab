#!/bin/sh
# First-time setup for Q-Lab inside a company network. Run once, from this folder.
#   1. loads the images from the bundle (if images.tar.gz is here)
#   2. creates .env with fresh secrets
# Then edit .env (address, owner email) and run: docker compose up -d
set -eu
cd "$(dirname "$0")"

if [ -f images.tar.gz ]; then
  echo "Loading images (this takes a minute)..."
  gunzip -c images.tar.gz | docker load
fi

mkdir -p tls

if [ -f .env ]; then
  echo ".env already exists; leaving it as it is."
else
  hex() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }
  cat > .env <<ENV
# The name people type to reach Q-Lab, resolving to this server in your internal DNS.
SITE_ADDRESS=qlab.corp.example

# This email becomes the owner account when it signs up.
QLAB_OWNER_EMAIL=

# Generated. Keep a copy: QLAB_SECRET_KEY also encrypts stored credentials.
POSTGRES_PASSWORD=$(hex 24)
QLAB_SECRET_KEY=$(hex 32)

# Optional: your internal mail server. Without one, accounts need no email confirmation.
# SMTP_HOST=mail.corp.example
# SMTP_PORT=587
# SMTP_USER=
# SMTP_PASSWORD=
# SMTP_FROM=qlab@corp.example
ENV
  chmod 600 .env
  echo "Created .env with new secrets. Keep a copy of it in your password manager."
fi

echo
echo "Next:"
echo "  1. Edit .env: SITE_ADDRESS and QLAB_OWNER_EMAIL."
echo "  2. Put the certificate in tls/cert.pem and tls/key.pem (or see Caddyfile)."
echo "  3. docker compose up -d"
