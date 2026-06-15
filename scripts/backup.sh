#!/bin/bash
# ==============================================
# Approval App - Backup Script
# ==============================================
# Purpose: Backup database and uploads with retention
# Usage: ./backup.sh
# ==============================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
BACKUP_DIR="./backups"
RETENTION_COUNT=5  # Keep last 5 backups
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DB_CONTAINER="${DB_CONTAINER:-approval-db}"
APP_CONTAINER="${APP_CONTAINER:-approval-app}"

echo "============================================"
echo "  Approval App - Backup"
echo "============================================"
echo ""

# Create backup directory if it doesn't exist
if [ ! -d "$BACKUP_DIR" ]; then
    echo "Creating backup directory..."
    mkdir -p "$BACKUP_DIR"
    chmod 755 "$BACKUP_DIR"
fi

# Check if Docker Compose is running
if ! docker compose ps &>/dev/null && ! docker-compose ps &>/dev/null; then
    if ! docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
        echo -e "${RED}✗ ERROR: Docker Compose services are not running and $DB_CONTAINER was not found${NC}"
        echo "Start services with: ./scripts/deploy.sh"
        exit 1
    fi
fi

# ==============================================
# 1. Backup Database
# ==============================================
echo -e "${BLUE}[1/3]${NC} Backing up database..."

DB_BACKUP_FILE="$BACKUP_DIR/db_$TIMESTAMP.sql"

# Prefer the known container name because some existing VPS installs are not
# visible to `docker compose exec db` from the current checkout.
if docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
    docker exec "$DB_CONTAINER" pg_dump -U "${POSTGRES_USER:-postgres}" "${POSTGRES_DB:-app_db}" > "$DB_BACKUP_FILE"
elif command -v docker-compose &>/dev/null; then
    docker-compose exec -T db pg_dump -U "${POSTGRES_USER:-postgres}" "${POSTGRES_DB:-app_db}" > "$DB_BACKUP_FILE"
else
    docker compose exec -T db pg_dump -U "${POSTGRES_USER:-postgres}" "${POSTGRES_DB:-app_db}" > "$DB_BACKUP_FILE"
fi

if [ -f "$DB_BACKUP_FILE" ] && [ -s "$DB_BACKUP_FILE" ]; then
    echo -e "${GREEN}✓ Database backed up: $DB_BACKUP_FILE${NC}"
else
    echo -e "${RED}✗ ERROR: Database backup failed${NC}"
    exit 1
fi

# ==============================================
# 2. Backup Uploads Volume
# ==============================================
echo -e "${BLUE}[2/3]${NC} Backing up uploads..."

UPLOADS_BACKUP_FILE="$BACKUP_DIR/uploads_$TIMESTAMP.tar.gz"
BACKUP_DIR_ABS="$(cd "$BACKUP_DIR" && pwd)"

if docker ps --format '{{.Names}}' | grep -qx "$APP_CONTAINER"; then
    docker run --rm \
        --volumes-from "$APP_CONTAINER":ro \
        -v "$BACKUP_DIR_ABS:/backup" \
        alpine:latest \
        tar -czf "/backup/$(basename $UPLOADS_BACKUP_FILE)" -C /app/public/uploads .
else
    docker run --rm \
        -v uploads_data:/data:ro \
        -v "$BACKUP_DIR_ABS:/backup" \
        alpine:latest \
        tar -czf "/backup/$(basename $UPLOADS_BACKUP_FILE)" -C /data .
fi

if [ -f "$UPLOADS_BACKUP_FILE" ] && [ -s "$UPLOADS_BACKUP_FILE" ]; then
    echo -e "${GREEN}✓ Uploads backed up: $UPLOADS_BACKUP_FILE${NC}"
else
    echo -e "${YELLOW}⚠ WARNING: Uploads backup may have failed or was empty${NC}"
fi

# ==============================================
# 3. Cleanup Old Backups (Retention Policy)
# ==============================================
echo -e "${BLUE}[3/3]${NC} Applying retention policy (keep last $RETENTION_COUNT)..."

# Remove old database backups (keep last RETENTION_COUNT)
ls -1t "$BACKUP_DIR"/db_*.sql 2>/dev/null | tail -n +$((RETENTION_COUNT + 1)) | xargs -r rm -f
echo -e "${GREEN}✓ Cleaned old database backups${NC}"

# Remove old uploads backups (keep last RETENTION_COUNT)
ls -1t "$BACKUP_DIR"/uploads_*.tar.gz 2>/dev/null | tail -n +$((RETENTION_COUNT + 1)) | xargs -r rm -f
echo -e "${GREEN}✓ Cleaned old uploads backups${NC}"

# ==============================================
# Summary
# ==============================================
echo ""
echo "============================================"
echo -e "${GREEN}✓ Backup Complete!${NC}"
echo "============================================"
echo ""
echo "Backup files created:"
echo "  - $DB_BACKUP_FILE"
echo "  - $UPLOADS_BACKUP_FILE"
echo ""
echo "Total backup size:"
du -sh "$BACKUP_DIR" | tail -1
echo ""
echo "Restore with: ./scripts/restore.sh <backup_file>"
echo ""
