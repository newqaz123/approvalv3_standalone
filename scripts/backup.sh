#!/usr/bin/env bash
# Create verified database and uploads artifacts for a production deployment.
# This script never removes Docker volumes or mutates application data.
set -e

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
DEPLOY_ROOT="${DEPLOY_ROOT:-$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)}"
BACKUP_DIR="${BACKUP_DIR:-$DEPLOY_ROOT/backups}"
ENV_FILE="${ENV_FILE:-$DEPLOY_ROOT/.env.production}"
PROD_COMPOSE_FILE="${PROD_COMPOSE_FILE:-$DEPLOY_ROOT/docker-compose.prod.yml}"
COMPOSE_PROJECT_NAME="approval-app"
RETENTION_COUNT=10
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
DB_CONTAINER="${DB_CONTAINER:-approval-db}"
APP_CONTAINER="${APP_CONTAINER:-approval-app}"

compose_prod() {
  if docker compose version >/dev/null 2>&1; then
    docker compose -p "$COMPOSE_PROJECT_NAME" --env-file "$ENV_FILE" -f "$PROD_COMPOSE_FILE" "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose -p "$COMPOSE_PROJECT_NAME" --env-file "$ENV_FILE" -f "$PROD_COMPOSE_FILE" "$@"
  else
    printf 'ERROR: Docker Compose is not installed\n' >&2
    return 1
  fi
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    printf 'ERROR: no SHA-256 utility is installed\n' >&2
    return 1
  fi
}

resolve_uploads_volume() {
  local mount_info mount_name mount_destination candidate count candidates
  # Inspect first, including stopped containers. This preserves the actual
  # named volume instead of guessing from the current checkout.
  mount_info="$(docker inspect -f '{{range .Mounts}}{{.Name}} {{.Destination}}{{"\\n"}}{{end}}' "$APP_CONTAINER" 2>/dev/null || true)"
  while read -r mount_name mount_destination; do
    if [ "$mount_destination" = "/app/uploads" ] && [ -n "$mount_name" ]; then
      printf '%s\n' "$mount_name"
      return 0
    fi
  done <<EOF_MOUNTS
$mount_info
EOF_MOUNTS

  count=0
  candidates=''
  while IFS= read -r candidate; do
    [ -n "$candidate" ] || continue
    count=$((count + 1))
    candidates="${candidates}${candidate}
"
  done <<EOF_VOLUMES
$(docker volume ls --format '{{.Name}}' 2>/dev/null | grep -E '(^|_)uploads_data$' || true)
EOF_VOLUMES
  if [ "$count" -eq 1 ]; then
    printf '%s' "$candidates" | sed -n '1p'
    return 0
  fi
  if [ "$count" -gt 1 ]; then
    printf 'ERROR: multiple uploads volumes found; refusing to guess:\n%s' "$candidates" >&2
  else
    printf 'ERROR: no named uploads volume found\n' >&2
  fi
  return 1
}

resolve_uploads_path_in_container() {
  if docker exec "$APP_CONTAINER" test -d /app/uploads 2>/dev/null; then
    printf '%s\n' '/app/uploads'
  elif docker exec "$APP_CONTAINER" test -d /app/public/uploads 2>/dev/null; then
    printf '%s\n' '/app/public/uploads'
  else
    printf 'ERROR: uploads mount is unavailable\n' >&2
    return 1
  fi
}

mkdir -p "$BACKUP_DIR"
chmod 755 "$BACKUP_DIR"

# Ensure the explicit production Compose contract is used whenever Compose is called.
if ! compose_prod ps >/dev/null 2>&1; then
  if ! docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
    printf 'ERROR: production services are not running and %s was not found\n' "$DB_CONTAINER" >&2
    exit 1
  fi
fi

DB_BACKUP_FILE="$BACKUP_DIR/db_$TIMESTAMP.sql"
if docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
  docker exec "$DB_CONTAINER" pg_dump -U "${POSTGRES_USER:-postgres}" "${POSTGRES_DB:-app_db}" >"$DB_BACKUP_FILE"
else
  compose_prod exec -T db pg_dump -U "${POSTGRES_USER:-postgres}" "${POSTGRES_DB:-app_db}" >"$DB_BACKUP_FILE"
fi
[ -s "$DB_BACKUP_FILE" ] || { printf 'ERROR: database backup is empty\n' >&2; exit 1; }
DB_SHA256="$(sha256_file "$DB_BACKUP_FILE")"
[ -n "$DB_SHA256" ] || exit 1

if docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
  USERS_COUNT="$(docker exec "$DB_CONTAINER" psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-app_db}" -tAc 'select count(*) from users;' 2>/dev/null || printf '%s' unknown)"
else
  USERS_COUNT="$(compose_prod exec -T db psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-app_db}" -tAc 'select count(*) from users;' 2>/dev/null || printf '%s' unknown)"
fi
printf 'Users in database: %s\n' "$USERS_COUNT"
if [ "$USERS_COUNT" = "0" ]; then
  printf 'WARNING: Database backup contains 0 users\n' >&2
fi

UPLOADS_BACKUP_FILE="$BACKUP_DIR/uploads_$TIMESTAMP.tar.gz"
if docker ps --format '{{.Names}}' | grep -qx "$APP_CONTAINER"; then
  UPLOADS_PATH="$(resolve_uploads_path_in_container)"
  if ! docker exec "$APP_CONTAINER" tar -czf - -C "$UPLOADS_PATH" . >"$UPLOADS_BACKUP_FILE"; then
    rm -f "$UPLOADS_BACKUP_FILE"
    printf 'ERROR: uploads archive failed in the running app container\n' >&2
    exit 1
  fi
else
  UPLOADS_VOLUME="$(resolve_uploads_volume)"
  APP_IMAGE="$(docker inspect -f '{{.Image}}' "$APP_CONTAINER" 2>/dev/null || true)"
  [ -n "$APP_IMAGE" ] || { printf 'ERROR: app container image is unavailable for offline-safe uploads backup\n' >&2; exit 1; }
  if ! docker run --rm --pull=never -v "$UPLOADS_VOLUME:/data:ro" "$APP_IMAGE" tar -czf - -C /data . >"$UPLOADS_BACKUP_FILE"; then
    rm -f "$UPLOADS_BACKUP_FILE"
    printf 'ERROR: uploads archive failed without pulling an external image\n' >&2
    exit 1
  fi
fi
[ -s "$UPLOADS_BACKUP_FILE" ] || { printf 'ERROR: uploads backup is empty\n' >&2; exit 1; }
UPLOADS_SHA256="$(sha256_file "$UPLOADS_BACKUP_FILE")"
[ -n "$UPLOADS_SHA256" ] || exit 1

# Retain only non-empty artifacts. Use shell loops rather than GNU-only xargs flags.
# The equivalent GNU find predicate is -size +0; zero-byte artifacts are never retained.
for file in "$BACKUP_DIR"/db_*.sql; do
  [ -f "$file" ] || continue
  [ -s "$file" ] || rm -f "$file"
done
for file in "$BACKUP_DIR"/uploads_*.tar.gz; do
  [ -f "$file" ] || continue
  [ -s "$file" ] || rm -f "$file"
done

# The summary is intentionally the final output so callers can capture it safely.
printf 'DB_BACKUP_PATH=%s\n' "$DB_BACKUP_FILE"
printf 'UPLOADS_BACKUP_PATH=%s\n' "$UPLOADS_BACKUP_FILE"
printf 'DB_BACKUP_SHA256=%s\n' "$DB_SHA256"
printf 'UPLOADS_BACKUP_SHA256=%s\n' "$UPLOADS_SHA256"
