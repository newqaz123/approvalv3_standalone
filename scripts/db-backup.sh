#!/bin/bash
# ==============================================
# Approval App - Database Backup
# ==============================================
# Purpose: Backup PostgreSQL database from Docker container
# Runs on: Target server
# Usage:   bash db-backup.sh
# ==============================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "============================================"
echo "  Approval App - Database Backup"
echo "============================================"
echo ""

# Check if db container is running
if ! docker ps --format '{{.Names}}' | grep -q 'approval-db'; then
    echo -e "${RED}✗ Database container (approval-db) is not running.${NC}"
    exit 1
fi

# Create backup
BACKUP_DIR="$SCRIPT_DIR/backups"
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/db-backup-$TIMESTAMP.sql.gz"

echo "Backing up database..."
docker exec approval-db pg_dump -U "${POSTGRES_USER:-postgres}" "${POSTGRES_DB:-app_db}" | gzip > "$BACKUP_FILE"

BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo -e "${GREEN}✓ Backup complete: $BACKUP_FILE ($BACKUP_SIZE)${NC}"

# Keep only last 10 backups
echo ""
echo "Cleaning old backups (keeping last 10)..."
ls -t "$BACKUP_DIR"/db-backup-*.sql.gz | tail -n +11 | xargs -r rm --
echo -e "${GREEN}✓ Cleanup done${NC}"

echo ""
echo "To restore a backup:"
echo "  gunzip -c $BACKUP_FILE | docker exec -i approval-db psql -U postgres app_db"
echo ""
