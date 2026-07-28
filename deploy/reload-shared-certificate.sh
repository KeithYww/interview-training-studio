#!/usr/bin/env sh
set -eu

ROOT_DIR=${ROOT_DIR:-/opt/offerget}
CERT_PATH=${CERT_PATH:-/opt/joblens/certbot/live/43.142.15.246/fullchain.pem}
STATE_FILE="$ROOT_DIR/shared/tls-certificate.sha256"
ENV_FILE="$ROOT_DIR/shared/.env.production"
COMPOSE_FILE="$ROOT_DIR/current/deploy/docker-compose.yml"

if [ ! -f "$CERT_PATH" ] || [ ! -f "$ENV_FILE" ] || [ ! -f "$COMPOSE_FILE" ]; then
  echo "offerGet certificate reload prerequisites are missing." >&2
  exit 1
fi

current_hash=$(sha256sum "$CERT_PATH" | awk '{print $1}')
previous_hash=$(cat "$STATE_FILE" 2>/dev/null || true)

if [ "$current_hash" = "$previous_hash" ]; then
  exit 0
fi

docker compose --project-name offerget --env-file "$ENV_FILE" -f "$COMPOSE_FILE" restart web
printf '%s\n' "$current_hash" > "$STATE_FILE"

