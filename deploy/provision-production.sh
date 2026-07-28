#!/usr/bin/env sh
set -eu

: "${IMPORTED_ENV_PATH:?IMPORTED_ENV_PATH is required}"

ROOT_DIR=${ROOT_DIR:-/opt/offerget}
SHARED_DIR="$ROOT_DIR/shared"
ENV_FILE="$SHARED_DIR/.env.production"

sudo mkdir -p "$SHARED_DIR/downloads"
sudo chown -R "$(id -u):$(id -g)" "$ROOT_DIR"

upsert_env() {
  key=$1
  value=$2
  tmp=$(mktemp)
  awk -F= -v key="$key" '$1 != key { print }' "$ENV_FILE" > "$tmp"
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
}

if [ ! -f "$ENV_FILE" ]; then
  cp "$IMPORTED_ENV_PATH" "$ENV_FILE"
  upsert_env APP_SECRET "$(openssl rand -hex 32)"
  upsert_env POSTGRES_PASSWORD "$(openssl rand -hex 24)"
fi

upsert_env SITE_ADDRESS '43.142.15.246'
upsert_env PUBLIC_ORIGIN 'https://43.142.15.246:8443'
upsert_env CERTBOT_DIR '/opt/joblens/certbot'
upsert_env DOWNLOADS_DIR '/opt/offerget/shared/downloads'
upsert_env POSTGRES_DB 'offerget'
upsert_env POSTGRES_USER 'offerget'
upsert_env DEV_EMAIL_CODES 'false'
upsert_env CORS_ORIGIN 'https://43.142.15.246:8443'
upsert_env HOST '0.0.0.0'
upsert_env PORT '3001'

for required in APP_SECRET POSTGRES_PASSWORD SMTP_HOST SMTP_USER SMTP_PASS SMTP_FROM DASHSCOPE_API_KEY SILICONFLOW_API_KEY; do
  value=$(sed -n "s/^${required}=//p" "$ENV_FILE" | tail -1)
  if [ -z "$value" ]; then
    echo "$required is missing from the production environment." >&2
    exit 1
  fi
done

chmod 600 "$ENV_FILE"
rm -f "$IMPORTED_ENV_PATH"
echo "offerGet production environment is provisioned."
