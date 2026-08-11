#!/bin/bash
# ==============================================
# Approval App - Restore Script
# ==============================================
# Purpose: Restore database and/or uploads from backup
# Usage: ./restore.sh <db_backup.sql> [uploads_backup.tar.gz]
# Examples:
#   ./restore.sh backups/db_20260214_120000.sql
#   ./restore.sh backups/db_20260214_120000.sql backups/uploads_20260214_120000.tar.gz
# ==============================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/../docker-compose.prod.yml" ]; then
    PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
elif [ -f "$SCRIPT_DIR/docker-compose.prod.yml" ]; then
    PROJECT_ROOT="$SCRIPT_DIR"
else
    echo 'Cannot locate docker-compose.prod.yml' >&2
    exit 1
fi

ENV_FILE="$PROJECT_ROOT/.env.production"
PROD_COMPOSE_FILE="$PROJECT_ROOT/docker-compose.prod.yml"
DB_CONTAINER="${DB_CONTAINER:-approval-db}"
APP_CONTAINER="${APP_CONTAINER:-approval-app}"
POSTGRES_USER_VALUE="${POSTGRES_USER:-postgres}"
POSTGRES_DB_VALUE="${POSTGRES_DB:-app_db}"

compose_prod() {
    if docker compose version >/dev/null 2>&1; then
        docker compose -p approval-app --env-file "$ENV_FILE" -f "$PROD_COMPOSE_FILE" "$@"
    elif command -v docker-compose >/dev/null 2>&1; then
        docker-compose -p approval-app --env-file "$ENV_FILE" -f "$PROD_COMPOSE_FILE" "$@"
    else
        echo 'Docker Compose is not installed' >&2
        return 1
    fi
}

# Resolve the actual Docker volume name that backs the uploads mount. Prefers
# the declared `uploads_data` name; otherwise falls back to the project-prefixed
# volume (e.g. <project>_uploads_data) discovered through `docker compose
# config --volumes` and `docker volume ls`. The existing volume is never
# recreated or renamed.
resolve_uploads_volume() {
    local declared resolved
    declared="$(compose_prod config --volumes 2>/dev/null | grep -x 'uploads_data' | head -n1)"
    if [ -n "$declared" ] && docker volume ls --format '{{.Name}}' 2>/dev/null | grep -qx "$declared"; then
        printf '%s\n' "$declared"
        return 0
    fi
    resolved="$(docker volume ls --format '{{.Name}}' 2>/dev/null | grep -Ex '([A-Za-z0-9][A-Za-z0-9_.-]*_)?uploads_data' | head -n1)"
    if [ -n "$resolved" ]; then
        printf '%s\n' "$resolved"
    else
        printf '%s\n' 'uploads_data'
    fi
}

# Resolve the uploads path inside a running app container. Prefers the private
# /app/uploads mount and falls back to the legacy public path only while a
# pre-migration image is still running (transition period).
resolve_uploads_path_in_container() {
    if docker exec "$APP_CONTAINER" test -d /app/uploads 2>/dev/null; then
        printf '%s\n' '/app/uploads'
    elif docker exec "$APP_CONTAINER" test -d /app/public/uploads 2>/dev/null; then
        printf '%s\n' '/app/public/uploads'
    else
        printf '%s\n' '/app/uploads'
    fi
}

# Check arguments
if [ $# -eq 0 ]; then
    echo "============================================"
    echo "  Approval App - Restore"
    echo "============================================"
    echo ""
    echo -e "${RED}✗ ERROR: No backup file specified${NC}"
    echo ""
    echo "Usage: $0 <db_backup.sql> [uploads_backup.tar.gz]"
    echo ""
    echo "Examples:"
    echo "  $0 backups/db_20260214_120000.sql"
    echo "  $0 backups/db_20260214_120000.sql backups/uploads_20260214_120000.tar.gz"
    echo ""
    echo "Available backups:"
    echo ""
    echo "Database backups:"
    find "$PROJECT_ROOT/backups" -maxdepth 1 -name 'db_*.sql' -type f -size +0 -print 2>/dev/null | xargs -r ls -1ht || echo "  (none found)"
    echo ""
    echo "Uploads backups:"
    ls -1ht "$PROJECT_ROOT"/backups/uploads_*.tar.gz 2>/dev/null || echo "  (none found)"
    echo ""
    exit 1
fi

DB_BACKUP="$1"
UPLOADS_BACKUP="$2"

echo "============================================"
echo "  Approval App - Restore"
echo "============================================"
echo ""

# Validate database backup file
if [ ! -f "$DB_BACKUP" ]; then
    echo -e "${RED}✗ ERROR: Database backup file not found: $DB_BACKUP${NC}"
    exit 1
fi

echo -e "${BLUE}[1/4]${NC} Validating database backup: $DB_BACKUP"
if ! grep -q "PostgreSQL database dump" "$DB_BACKUP" 2>/dev/null; then
    echo -e "${RED}✗ ERROR: Invalid PostgreSQL dump file${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Database backup valid${NC}"

# Start only the production database when its container is absent.
if ! docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
    echo -e "${YELLOW}⚠ WARNING: The database container is not running${NC}"
    echo "Starting the production database for restore..."
    compose_prod up -d db
    echo "Waiting for database to be ready..."
    sleep "${RESTORE_WAIT_SECONDS:-10}"
fi

# ==============================================
# Confirmation Prompt
# ==============================================
echo -e "${YELLOW}⚠ WARNING: This will REPLACE the current database!${NC}"
echo ""
read -p "Are you sure you want to restore from $DB_BACKUP? (yes/no): " -r
echo ""

if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
    echo "Restore cancelled."
    exit 0
fi

# ==============================================
# 1. Restore Database
# ==============================================
echo -e "${BLUE}[2/4]${NC} Restoring database..."

if docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
    docker exec -i "$DB_CONTAINER" psql -U "$POSTGRES_USER_VALUE" -d "$POSTGRES_DB_VALUE" -c 'drop schema public cascade; create schema public;'
    docker exec -i "$DB_CONTAINER" psql -U "$POSTGRES_USER_VALUE" -d "$POSTGRES_DB_VALUE" < "$DB_BACKUP"
else
    compose_prod exec -T db psql -U "$POSTGRES_USER_VALUE" -d "$POSTGRES_DB_VALUE" -c 'drop schema public cascade; create schema public;'
    compose_prod exec -T db psql -U "$POSTGRES_USER_VALUE" -d "$POSTGRES_DB_VALUE" < "$DB_BACKUP"
fi

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Database restored successfully${NC}"
else
    echo -e "${RED}✗ ERROR: Database restore failed${NC}"
    exit 1
fi

RESTORED_USERS="unknown"
if docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
    RESTORED_USERS="$(docker exec "$DB_CONTAINER" psql -U "$POSTGRES_USER_VALUE" -d "$POSTGRES_DB_VALUE" -tAc "select count(*) from users;" 2>/dev/null || echo unknown)"
else
    RESTORED_USERS="$(compose_prod exec -T db psql -U "$POSTGRES_USER_VALUE" -d "$POSTGRES_DB_VALUE" -tAc "select count(*) from users;" 2>/dev/null || echo unknown)"
fi

echo "Restored users: $RESTORED_USERS"
if [ "$RESTORED_USERS" = "0" ]; then
    echo -e "${YELLOW}⚠ WARNING: Restored database has 0 users${NC}"
fi

# ==============================================
# 2. Restore Uploads (if specified)
# ==============================================
if [ -n "$UPLOADS_BACKUP" ]; then
    echo -e "${BLUE}[3/4]${NC} Restoring uploads..."

    if [ ! -f "$UPLOADS_BACKUP" ]; then
        echo -e "${RED}✗ ERROR: Uploads backup file not found: $UPLOADS_BACKUP${NC}"
        exit 1
    fi

    # Use a temporary Alpine container to restore to the uploads_data volume
    # This will overwrite existing files in the volume
    BACKUP_DIR_ABS="$(cd "$(dirname "$UPLOADS_BACKUP")" && pwd)"
    if docker ps --format '{{.Names}}' | grep -qx "$APP_CONTAINER"; then
        UPLOADS_PATH="$(resolve_uploads_path_in_container)"
        docker run --rm \
            --volumes-from "$APP_CONTAINER" \
            -v "$BACKUP_DIR_ABS:/backup:ro" \
            alpine:latest \
            sh -c "rm -rf ${UPLOADS_PATH}/* && tar -xzf '/backup/$(basename $UPLOADS_BACKUP)' -C ${UPLOADS_PATH}"
    else
        UPLOADS_VOLUME="$(resolve_uploads_volume)"
        docker run --rm \
            -v "$UPLOADS_VOLUME:/data" \
            -v "$BACKUP_DIR_ABS:/backup:ro" \
            alpine:latest \
            sh -c "rm -rf /data/* && tar -xzf '/backup/$(basename $UPLOADS_BACKUP)' -C /data"
    fi

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Uploads restored successfully${NC}"
    else
        echo -e "${RED}✗ ERROR: Uploads restore failed${NC}"
        exit 1
    fi
else
    echo -e "${BLUE}[3/4]${NC} Skipping uploads restore (no file specified)"
fi

# ==============================================
# 3. Restart Application Services
# ==============================================
echo -e "${BLUE}[4/4]${NC} Restarting application services..."

# Restart app container to ensure clean state
if docker ps --format '{{.Names}}' | grep -qx "$APP_CONTAINER"; then
    docker restart "$APP_CONTAINER" >/dev/null
else
    compose_prod restart app
fi

echo -e "${GREEN}✓ Application services restarted${NC}"

# ==============================================
# Summary
# ==============================================
echo ""
echo "============================================"
echo -e "${GREEN}✓ Restore Complete!${NC}"
echo "============================================"
echo ""
echo "Restored from:"
echo "  - Database: $DB_BACKUP"
if [ -n "$UPLOADS_BACKUP" ]; then
    echo "  - Uploads: $UPLOADS_BACKUP"
fi
echo ""
echo "Application is restarting..."
echo "Check logs with: docker compose -p approval-app --env-file '$ENV_FILE' -f '$PROD_COMPOSE_FILE' logs -f app"
echo ""
echo "Visit: http://localhost:3000"
echo ""
