#!/usr/bin/env sh
set -eu

: "${DEPLOY_SHA:?DEPLOY_SHA is required}"
: "${ARCHIVE_PATH:?ARCHIVE_PATH is required}"
: "${PUBLIC_ORIGIN:?PUBLIC_ORIGIN is required}"

ROOT_DIR=${ROOT_DIR:-/opt/offerget}
RELEASES_DIR="$ROOT_DIR/releases"
SHARED_DIR="$ROOT_DIR/shared"
BACKUP_DIR="$ROOT_DIR/backups"
RELEASE_DIR="$RELEASES_DIR/$DEPLOY_SHA"
ENV_FILE="$SHARED_DIR/.env.production"
CURRENT_LINK="$ROOT_DIR/current"
PREVIOUS_RELEASE=$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)

sudo mkdir -p "$RELEASES_DIR" "$SHARED_DIR/downloads" "$BACKUP_DIR"
sudo chown -R "$(id -u):$(id -g)" "$ROOT_DIR"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE. Provision production secrets before the first release." >&2
  exit 1
fi
chmod 600 "$ENV_FILE"

for required in POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD APP_SECRET SMTP_HOST SMTP_USER SMTP_PASS SMTP_FROM DASHSCOPE_API_KEY SILICONFLOW_API_KEY; do
  value=$(sed -n "s/^${required}=//p" "$ENV_FILE" | tail -1)
  if [ -z "$value" ] || printf '%s' "$value" | grep -qi 'replace\\|your-'; then
    echo "$required must contain a non-placeholder value." >&2
    exit 1
  fi
done

set -a
. "$ENV_FILE"
set +a

if sudo docker ps --format '{{.Names}}' | grep -qx 'offerget-postgres-1'; then
  timestamp=$(date -u +%Y%m%dT%H%M%SZ)
  sudo docker exec offerget-postgres-1 pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom \
    > "$BACKUP_DIR/offerget-${timestamp}-${DEPLOY_SHA}.dump"
fi

rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"
tar xzf "$ARCHIVE_PATH" -C "$RELEASE_DIR"

compose() {
  BUILD_SHA="$DEPLOY_SHA" sudo -E docker compose --project-name offerget \
    --env-file "$ENV_FILE" -f "$RELEASE_DIR/deploy/docker-compose.yml" "$@"
}

rollback() {
  if [ -z "$PREVIOUS_RELEASE" ] || [ ! -f "$PREVIOUS_RELEASE/deploy/docker-compose.yml" ]; then
    return
  fi
  previous_sha=$(basename "$PREVIOUS_RELEASE")
  BUILD_SHA="$previous_sha" sudo -E docker compose --project-name offerget \
    --env-file "$ENV_FILE" -f "$PREVIOUS_RELEASE/deploy/docker-compose.yml" \
    up -d --no-build --remove-orphans || true
}

compose config --quiet
compose build
compose up -d --remove-orphans

healthy=false
for _ in $(seq 1 60); do
  health=$(curl --silent --show-error --max-time 10 "$PUBLIC_ORIGIN/api/health" || true)
  version=$(printf '%s' "$health" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')
  status=$(printf '%s' "$health" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')
  database=$(printf '%s' "$health" | sed -n 's/.*"database":\([^,}]*\).*/\1/p')
  if [ "$status" = 'ok' ] && [ "$version" = "$DEPLOY_SHA" ] && [ "$database" = 'true' ]; then
    healthy=true
    break
  fi
  sleep 5
done

if [ "$healthy" != 'true' ]; then
  compose logs --tail=150 backend web >&2 || true
  rollback
  echo "offerGet deployment did not become healthy for $DEPLOY_SHA." >&2
  exit 1
fi

ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"
find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +
find "$BACKUP_DIR" -type f -name 'offerget-*.dump' -mtime +14 -delete
rm -f "$ARCHIVE_PATH"

echo "offerGet China deployment is healthy at $DEPLOY_SHA."
