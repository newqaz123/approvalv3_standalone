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
    ls -1ht backups/db_*.sql 2>/dev/null || echo "  (none found)"
    echo ""
    echo "Uploads backups:"
    ls -1ht backups/uploads_*.tar.gz 2>/dev/null || echo "  (none found)"
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

# Check if Docker Compose is running
if ! docker compose ps &>/dev/null && ! docker-compose ps &>/dev/null; then
    echo -e "${YELLOW}⚠ WARNING: Docker Compose services are not running${NC}"
    echo "Starting services for restore..."
    docker compose up -d || docker-compose up -d
    echo "Waiting for database to be ready..."
    sleep 10
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

# Use docker compose exec or docker-compose exec (for compatibility)
if command -v docker-compose &>/dev/null; then
    docker-compose exec -T db psql -U postgres -d app_db < "$DB_BACKUP"
else
    docker compose exec -T db psql -U postgres -d app_db < "$DB_BACKUP"
fi

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Database restored successfully${NC}"
else
    echo -e "${RED}✗ ERROR: Database restore failed${NC}"
    exit 1
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
    docker run --rm \
        -v uploads_data:/data \
        -v "$(pwd)/backups:/backup:ro" \
        alpine:latest \
        sh -c "rm -rf /data/* && tar -xzf '/backup/$(basename $UPLOADS_BACKUP)' -C /data"

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
if command -v docker-compose &>/dev/null; then
    docker-compose restart app
else
    docker compose restart app
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
echo "Check logs with: docker compose logs -f app"
echo ""
echo "Visit: http://localhost:3000"
echo ""
