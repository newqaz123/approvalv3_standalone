#!/usr/bin/env bash

# Shared, deliberately conservative production deployment primitives.
# This file is sourced by deployment and rollback scripts; keep it Bash 3.2 safe.

COMPOSE_PROJECT_NAME="approval-app"
DEPLOY_ROOT="${DEPLOY_ROOT:-$(pwd)}"
ENV_FILE="${ENV_FILE:-$DEPLOY_ROOT/.env.production}"
if [ -f "$DEPLOY_ROOT/.env.example" ]; then
  DEFAULT_ENV_TEMPLATE="$DEPLOY_ROOT/.env.example"
else
  DEFAULT_ENV_TEMPLATE="$DEPLOY_ROOT/.env.production.example"
fi
ENV_TEMPLATE="${ENV_TEMPLATE:-$DEFAULT_ENV_TEMPLATE}"
PROD_COMPOSE_FILE="${PROD_COMPOSE_FILE:-$DEPLOY_ROOT/docker-compose.prod.yml}"
DEPLOY_STATE_FILE="${DEPLOY_STATE_FILE:-$DEPLOY_ROOT/backups/last-deployment-state.env}"

fail() { printf 'ERROR: %s\n' "$*" >&2; return 1; }

# Print the available Compose implementation without using arrays (Bash 3.2).
detect_compose() {
  if docker compose version >/dev/null 2>&1; then
    printf '%s\n' 'docker compose'
  elif command -v docker-compose >/dev/null 2>&1; then
    printf '%s\n' 'docker-compose'
  else
    fail 'Docker Compose is not installed'
  fi
}

# Invoke this function as: compose_prod up -d db migrate app
compose_prod() {
  if docker compose version >/dev/null 2>&1; then
    docker compose -p "$COMPOSE_PROJECT_NAME" --env-file "$ENV_FILE" -f "$PROD_COMPOSE_FILE" "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose -p "$COMPOSE_PROJECT_NAME" --env-file "$ENV_FILE" -f "$PROD_COMPOSE_FILE" "$@"
  else
    fail 'Docker Compose is not installed'
  fi
}

run_env_gate() {
  [ -f "$ENV_FILE" ] || { fail "Production environment file not found: $ENV_FILE"; return 1; }
  [ -f "$ENV_TEMPLATE" ] || { fail "Environment template not found: $ENV_TEMPLATE"; return 1; }
  node "$DEPLOY_ROOT/tools/env-check.mjs" --env "$ENV_FILE" --template "$ENV_TEMPLATE"
}

capture_running_image() {
  docker inspect -f '{{.Image}}' "$1" 2>/dev/null || true
}

tag_rollback_images() {
  local app_image migrate_image
  app_image="$(capture_running_image approval-app)"
  migrate_image="$(capture_running_image approval-migrate)"
  if [ -n "$app_image" ]; then
    docker image inspect approval-app:rollback >/dev/null 2>&1 && \
      docker image tag approval-app:rollback approval-app:rollback-prev || true
    docker image tag "$app_image" approval-app:rollback
  elif [ "${DEPLOY_MODE:-update}" != "install" ]; then
    fail 'Running approval-app image is unavailable; refusing update without a rollback image'
    return 1
  fi
  if [ -n "$migrate_image" ]; then
    docker image inspect approval-migrate:rollback >/dev/null 2>&1 && \
      docker image tag approval-migrate:rollback approval-migrate:rollback-prev || true
    docker image tag "$migrate_image" approval-migrate:rollback
  fi
}

backup_summary_value() {
  local key="$1" output="$2"
  printf '%s\n' "$output" | sed -n "s/^${key}=//p" | tail -n 1
}

sha256_digest() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    fail 'No SHA-256 utility is installed'
  fi
}

verify_backup_checksum() {
  local path="$1" expected="$2" actual
  actual="$(sha256_digest "$path")" || return 1
  [ "$actual" = "$expected" ] || { fail "Backup checksum mismatch: $path"; return 1; }
}

canonical_directory() {
  [ -d "$1" ] || return 1
  CDPATH= cd -P -- "$1" 2>/dev/null && pwd -P
}

canonical_existing_path() {
  local path="$1" link dir base hops=0
  [ -e "$path" ] || return 1
  while [ -L "$path" ]; do
    hops=$((hops + 1))
    [ "$hops" -le 40 ] || return 1
    link="$(readlink "$path" 2>/dev/null)" || return 1
    case "$link" in
      /*) path="$link" ;;
      *) path="$(dirname "$path")/$link" ;;
    esac
    [ -e "$path" ] || return 1
  done
  dir="$(CDPATH= cd -P -- "$(dirname "$path")" 2>/dev/null && pwd -P)" || return 1
  base="$(basename "$path")"
  [ -f "$dir/$base" ] || return 1
  printf '%s/%s\n' "$dir" "$base"
}

path_in_backup_dir() {
  local path="$1" backup_root="$2" canonical_root canonical_path
  canonical_root="$(canonical_directory "$backup_root")" || return 1
  case "$path" in
    /*) ;;
    ./*) path="$DEPLOY_ROOT/${path#./}" ;;
    *) path="$DEPLOY_ROOT/$path" ;;
  esac
  canonical_path="$(canonical_existing_path "$path")" || return 1
  case "$canonical_path" in
    "$canonical_root"/*) [ -s "$canonical_path" ] ;;
    *) return 1 ;;
  esac
}

run_verified_backup() {
  local output db_path uploads_path db_sha uploads_sha backup_root backup_output
  backup_root="$DEPLOY_ROOT/backups"
  mkdir -p "$backup_root" || return 1
  output="$(mktemp "${TMPDIR:-/tmp}/approval-backup.XXXXXX")" || return 1
  if ! backup_output="$(DEPLOY_ROOT="$DEPLOY_ROOT" BACKUP_DIR="$backup_root" ENV_FILE="$ENV_FILE" PROD_COMPOSE_FILE="$PROD_COMPOSE_FILE" bash "$DEPLOY_ROOT/scripts/backup.sh" 2>&1)"; then
    printf '%s\n' "$backup_output" >&2
    rm -f "$output"
    fail 'Verified backup failed'
    return 1
  fi
  printf '%s\n' "$backup_output" >"$output"
  db_path="$(backup_summary_value DB_BACKUP_PATH "$backup_output")"
  uploads_path="$(backup_summary_value UPLOADS_BACKUP_PATH "$backup_output")"
  db_sha="$(backup_summary_value DB_BACKUP_SHA256 "$backup_output")"
  uploads_sha="$(backup_summary_value UPLOADS_BACKUP_SHA256 "$backup_output")"
  rm -f "$output"
  [ -n "$db_path" ] && [ -n "$uploads_path" ] && [ -n "$db_sha" ] && [ -n "$uploads_sha" ] || { fail 'Backup summary is incomplete'; return 1; }
  path_in_backup_dir "$db_path" "$backup_root" || { fail 'Database backup is outside the deployment backup directory or empty'; return 1; }
  path_in_backup_dir "$uploads_path" "$backup_root" || { fail 'Uploads backup is outside the deployment backup directory or empty'; return 1; }
  verify_backup_checksum "$db_path" "$db_sha" || return 1
  verify_backup_checksum "$uploads_path" "$uploads_sha" || return 1
  printf 'DB_BACKUP_PATH=%s\n' "$db_path"
  printf 'UPLOADS_BACKUP_PATH=%s\n' "$uploads_path"
  printf 'DB_BACKUP_SHA256=%s\n' "$db_sha"
  printf 'UPLOADS_BACKUP_SHA256=%s\n' "$uploads_sha"
}

container_mounts() {
  docker inspect -f '{{range .Mounts}}{{.Name}} {{.Destination}}{{"\n"}}{{end}}' "$1" 2>/dev/null || true
}

container_project_label() {
  docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$1" 2>/dev/null || true
}

mount_for_destination() {
  local container="$1" destination="$2" mount_name mount_destination
  while read -r mount_name mount_destination; do
    if [ "$mount_destination" = "$destination" ] && [ -n "$mount_name" ]; then
      printf '%s\n' "$mount_name"
      return 0
    fi
  done <<EOF_MOUNTS
$(container_mounts "$container")
EOF_MOUNTS
  return 1
}

state_value() {
  sed -n "s/^$1=//p" "$2" | tail -n 1
}

# Read KEY=VALUE from the production env file (tolerating quotes), so database
# queries use the same credentials the compose file passes to the containers.
env_file_value() {
  local key="$1" line
  [ -f "$ENV_FILE" ] || return 1
  line="$(sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1)" || return 1
  [ -n "$line" ] || return 1
  printf '%s\n' "$line" | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

postgres_user() { env_file_value POSTGRES_USER || printf 'postgres'; }
postgres_db() { env_file_value POSTGRES_DB || printf 'app_db'; }

stat_owner_uid() {
  local uid
  uid="$(stat -c '%u' "$1" 2>/dev/null || true)"
  case "$uid" in
    ''|*[!0-9]*) uid="$(stat -f '%u' "$1" 2>/dev/null || true)" ;;
  esac
  printf '%s\n' "$uid"
}

ensure_root_owned() {
  local path="$1" uid
  chown root:root "$path" 2>/dev/null || { fail "Unable to make deployment state file root-owned: $path"; return 1; }
  uid="$(stat_owner_uid "$path")"
  [ "$uid" = "0" ] || { fail "Deployment state file is not root-owned: $path"; return 1; }
}

query_count() {
  local container="$1" query="$2" value
  if ! value="$(docker exec "$container" psql -U "$(postgres_user)" -d "$(postgres_db)" -Atqc "$query" 2>/dev/null)"; then
    fail "Database count query failed for $container"
    return 1
  fi
  value="$(printf '%s\n' "$value" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  case "$value" in
    ''|*[!0-9]*) fail "Database count query returned a non-negative integer: $value"; return 1 ;;
    *) printf '%s\n' "$value" ;;
  esac
}

query_file_count() {
  local value
  if ! value="$(docker exec approval-app sh -c 'find /app/uploads -type f -print | wc -l' 2>/dev/null)"; then
    fail 'Uploads physical file-count probe failed'
    return 1
  fi
  value="$(printf '%s\n' "$value" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  case "$value" in
    ''|*[!0-9]*) fail "Uploads physical file-count probe returned a non-negative integer: $value"; return 1 ;;
    *) printf '%s\n' "$value" ;;
  esac
}

capture_deployment_state() {
  local output="${1:-$DEPLOY_STATE_FILE}" db_volume uploads_volume db_project app_project users attachments files timestamp
  mkdir -p "$(dirname "$output")" || return 1
  db_volume="$(mount_for_destination approval-db /var/lib/postgresql/data || true)"
  uploads_volume="$(mount_for_destination approval-app /app/uploads || true)"
  db_project="$(container_project_label approval-db)"
  app_project="$(container_project_label approval-app)"
  [ -n "$db_volume" ] || { fail 'Unable to identify the named database volume'; return 1; }
  [ -n "$uploads_volume" ] || { fail 'Unable to identify the named uploads volume'; return 1; }
  [ -n "$db_project" ] || { fail 'Unable to identify the database Compose project label'; return 1; }
  [ -n "$app_project" ] || { fail 'Unable to identify the app Compose project label'; return 1; }
  users="$(query_count approval-db 'select count(*) from users;')" || return 1
  attachments="$(query_count approval-db 'select count(*) from file_attachments;')" || return 1
  files="$(query_file_count)" || return 1
  timestamp="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  {
    printf 'PRE_DB_VOLUME=%s\n' "$db_volume"
    printf 'PRE_UPLOADS_VOLUME=%s\n' "$uploads_volume"
    printf 'PRE_DB_PROJECT=%s\n' "$db_project"
    printf 'PRE_APP_PROJECT=%s\n' "$app_project"
    printf 'PRE_USERS=%s\n' "$users"
    printf 'PRE_ATTACHMENTS=%s\n' "$attachments"
    printf 'PRE_FILES=%s\n' "$files"
    printf 'DEPLOYMENT_TIMESTAMP=%s\n' "$timestamp"
    printf 'MIGRATIONS_APPLIED=none\n'
  } >"$output" || return 1
  chmod 600 "$output"
  if ! ensure_root_owned "$output"; then
    rm -f "$output"
    return 1
  fi
}

capture_current_state() {
  local output="$1" db_volume uploads_volume db_project app_project users attachments files
  db_volume="$(mount_for_destination approval-db /var/lib/postgresql/data || true)"
  uploads_volume="$(mount_for_destination approval-app /app/uploads || true)"
  db_project="$(container_project_label approval-db)"
  app_project="$(container_project_label approval-app)"
  users="$(query_count approval-db 'select count(*) from users;')" || return 1
  attachments="$(query_count approval-db 'select count(*) from file_attachments;')" || return 1
  files="$(query_file_count)" || return 1
  {
    printf 'POST_DB_VOLUME=%s\n' "$db_volume"
    printf 'POST_UPLOADS_VOLUME=%s\n' "$uploads_volume"
    printf 'POST_DB_PROJECT=%s\n' "$db_project"
    printf 'POST_APP_PROJECT=%s\n' "$app_project"
    printf 'POST_USERS=%s\n' "$users"
    printf 'POST_ATTACHMENTS=%s\n' "$attachments"
    printf 'POST_FILES=%s\n' "$files"
  } >"$output"
}

verify_preserved_state() {
  local pre_file="${1:-$DEPLOY_STATE_FILE}" post_file pre_db pre_uploads post_db post_uploads pre_db_project pre_app_project post_db_project post_app_project pre_users pre_attachments pre_files post_users post_attachments post_files
  [ -f "$pre_file" ] || { fail "Deployment state file not found: $pre_file"; return 1; }
  post_file="$(mktemp "${TMPDIR:-/tmp}/approval-state.XXXXXX")" || return 1
  capture_current_state "$post_file" || { rm -f "$post_file"; return 1; }
  pre_db="$(state_value PRE_DB_VOLUME "$pre_file")"; post_db="$(state_value POST_DB_VOLUME "$post_file")"
  pre_uploads="$(state_value PRE_UPLOADS_VOLUME "$pre_file")"; post_uploads="$(state_value POST_UPLOADS_VOLUME "$post_file")"
  pre_db_project="$(state_value PRE_DB_PROJECT "$pre_file")"; post_db_project="$(state_value POST_DB_PROJECT "$post_file")"
  pre_app_project="$(state_value PRE_APP_PROJECT "$pre_file")"; post_app_project="$(state_value POST_APP_PROJECT "$post_file")"
  pre_users="$(state_value PRE_USERS "$pre_file")"; post_users="$(state_value POST_USERS "$post_file")"
  pre_attachments="$(state_value PRE_ATTACHMENTS "$pre_file")"; post_attachments="$(state_value POST_ATTACHMENTS "$post_file")"
  pre_files="$(state_value PRE_FILES "$pre_file")"; post_files="$(state_value POST_FILES "$post_file")"
  if [ "$pre_db" != "$post_db" ] || [ "$pre_uploads" != "$post_uploads" ] || [ "$pre_db_project" != "$post_db_project" ] || [ "$pre_app_project" != "$post_app_project" ]; then
    rm -f "$post_file"; fail 'Named database or uploads volume identity changed'; return 1
  fi
  if [ -z "$post_uploads" ]; then rm -f "$post_file"; fail 'Uploads destination /app/uploads is not mounted'; return 1; fi
  if [ "$post_users" -lt "$pre_users" ] || [ "$post_attachments" -lt "$pre_attachments" ] || [ "$post_files" -lt "$pre_files" ]; then
    rm -f "$post_file"; fail 'Deployment state counts decreased'; return 1
  fi
  rm -f "$post_file"
}

normalize_attachment_path() {
  printf '%s' "$1" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's#^/*##' -e 's#^public/\{1,\}##' -e 's#^uploads/\{1,\}##'
}

audit_attachment_integrity() {
  local output="$1" rows row attachment_id stored_path normalized
  [ -n "$output" ] || { fail 'Attachment audit output file is required'; return 1; }
  mkdir -p "$(dirname "$output")" || return 1
  : >"$output" || return 1
  if ! rows="$(docker exec approval-db psql -U "$(postgres_user)" -d "$(postgres_db)" -Atc 'select id, "filePath" from file_attachments order by id;' 2>/dev/null)"; then
    fail 'Attachment audit database query failed'
    return 1
  fi
  while IFS= read -r row; do
    [ -n "$row" ] || continue
    attachment_id="${row%%$'\t'*}"
    stored_path="${row#*$'\t'}"
    if [ "$attachment_id" = "$row" ]; then
      attachment_id="${row%%|*}"
      stored_path="${row#*|}"
    fi
    normalized="$(normalize_attachment_path "$stored_path")"
    if [ -z "$normalized" ] || ! docker exec approval-app test -f "/app/uploads/$normalized" >/dev/null 2>&1; then
      printf '%s\n' "$attachment_id" >>"$output"
    fi
  done <<EOF_ROWS
$rows
EOF_ROWS
  LC_ALL=C sort -u "$output" -o "$output"
}

verify_new_attachment_integrity() {
  local pre_file="$1" post_file="$2" newly_missing
  [ -f "$pre_file" ] || { fail "Pre-deployment attachment audit not found: $pre_file"; return 1; }
  [ -f "$post_file" ] || { fail "Post-deployment attachment audit not found: $post_file"; return 1; }
  newly_missing="$(comm -13 <(LC_ALL=C sort -u "$pre_file") <(LC_ALL=C sort -u "$post_file"))"
  if [ -s "$pre_file" ]; then
    printf 'Pre-existing missing attachment IDs:\n%s\n' "$(cat "$pre_file")" >&2
  fi
  if [ -n "$newly_missing" ]; then
    printf 'Newly missing attachment IDs:\n%s\n' "$newly_missing" >&2
    return 1
  fi
  return 0
}

verify_attachment_integrity() { verify_new_attachment_integrity "$@"; }

deploy_production_services() {
  run_env_gate || return 1
  if ! record_migration_outcome unknown "${OLD_VERSION:-unknown}" "${NEW_VERSION:-unknown}"; then
    fail 'Migration state could not be marked unknown before deployment'
    return 1
  fi
  compose_prod up -d db migrate app
}

record_migration_outcome() {
  local outcome="$1" old_version="${2:-unknown}" new_version="${3:-unknown}" state_dir temporary
  state_dir="$(dirname "$DEPLOY_STATE_FILE")"
  mkdir -p "$state_dir" || return 1
  temporary="$(mktemp "$state_dir/.migration-state.XXXXXX")" || return 1
  if [ -f "$DEPLOY_STATE_FILE" ]; then
    awk -v outcome="$outcome" '
      BEGIN { written = 0 }
      /^MIGRATIONS_APPLIED=/ {
        if (!written) { print "MIGRATIONS_APPLIED=" outcome; written = 1 }
        next
      }
      { print }
      END { if (!written) print "MIGRATIONS_APPLIED=" outcome }
    ' "$DEPLOY_STATE_FILE" >"$temporary" || { rm -f "$temporary"; return 1; }
  else
    printf 'MIGRATIONS_APPLIED=%s\n' "$outcome" >"$temporary" || { rm -f "$temporary"; return 1; }
  fi
  {
    printf 'MIGRATION_OLD_VERSION=%s\n' "$old_version"
    printf 'MIGRATION_NEW_VERSION=%s\n' "$new_version"
    printf 'MIGRATION_TIMESTAMP=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  } >>"$temporary" || { rm -f "$temporary"; return 1; }
  chmod 600 "$temporary" || { rm -f "$temporary"; return 1; }
  ensure_root_owned "$temporary" || { rm -f "$temporary"; return 1; }
  mv -f "$temporary" "$DEPLOY_STATE_FILE" || { rm -f "$temporary"; return 1; }
  ensure_root_owned "$DEPLOY_STATE_FILE" || return 1
}

wait_for_migration() {
  local timeout="${MIGRATION_TIMEOUT_SECONDS:-120}" elapsed=0 status exit_code
  while [ "$elapsed" -le "$timeout" ]; do
    status="$(docker inspect -f '{{.State.Status}}' approval-migrate 2>/dev/null || true)"
    exit_code="$(docker inspect -f '{{.State.ExitCode}}' approval-migrate 2>/dev/null || true)"
    if [ "$status" = "exited" ]; then
      if [ "$exit_code" = "0" ]; then
        if ! record_migration_outcome applied "${OLD_VERSION:-unknown}" "${NEW_VERSION:-unknown}"; then
          fail 'Migration completed but durable migration state could not be recorded safely'
          return 1
        fi
        return 0
      fi
      if ! record_migration_outcome unknown "${OLD_VERSION:-unknown}" "${NEW_VERSION:-unknown}"; then
        fail 'Migration failed and durable unknown state could not be recorded safely'
        return 1
      fi
      fail "Migration container exited with code ${exit_code:-unknown}"
      return 1
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  if ! record_migration_outcome unknown "${OLD_VERSION:-unknown}" "${NEW_VERSION:-unknown}"; then
    fail 'Migration timed out and durable unknown state could not be recorded safely'
    return 1
  fi
  fail 'Migration did not finish within 120 seconds'
  return 1
}

wait_for_health() {
  local timeout="${HEALTH_TIMEOUT_SECONDS:-180}" elapsed=0 db_health app_health
  while [ "$elapsed" -le "$timeout" ]; do
    db_health="$(docker inspect -f '{{.State.Health.Status}}' approval-db 2>/dev/null || true)"
    app_health="$(docker inspect -f '{{.State.Health.Status}}' approval-app 2>/dev/null || true)"
    if [ "$db_health" = "healthy" ] && [ "$app_health" = "healthy" ] && curl -fsS http://localhost:3000/api/health >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  fail 'Production services did not become healthy within 180 seconds'
  return 1
}
