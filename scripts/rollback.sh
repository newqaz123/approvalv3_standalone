#!/bin/bash
# ==============================================
# Approval App - Rollback
# ==============================================
# Purpose: Roll back to the previous Docker image version
# Runs on: Target server
# Usage:   bash rollback.sh
# ==============================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Detect compose command
if docker compose version &> /dev/null 2>&1; then
    COMPOSE="docker compose"
else
    COMPOSE="docker-compose"
fi

echo "============================================"
echo "  Approval App - Rollback"
echo "============================================"
echo ""

# Check if rollback image exists
if ! docker images approval-app:rollback --format '{{.ID}}' | head -1 | grep -q .; then
    echo -e "${RED}✗ No rollback image found. Cannot rollback.${NC}"
    exit 1
fi

# Show what we're rolling back to
ROLLBACK_ID=$(docker images approval-app:rollback --format '{{.ID}}' | head -1)
CURRENT_ID=$(docker images approval-app:latest --format '{{.ID}}' | head -1)
echo -e "${YELLOW}Current image:${NC} approval-app:latest ($CURRENT_ID)"
echo -e "${YELLOW}Rollback to:  ${NC} approval-app:rollback ($ROLLBACK_ID)"
echo ""

# Confirm
read -p "Proceed with rollback? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

# Backup database before rollback
echo -e "${BLUE}[1/3]${NC} Backing up database..."
BACKUP_DIR="$SCRIPT_DIR/backups"
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/db-backup-pre-rollback-$(date +%Y%m%d-%H%M%S).sql.gz"
if docker ps --format '{{.Names}}' | grep -q 'approval-db'; then
    docker exec approval-db pg_dump -U "${POSTGRES_USER:-postgres}" "${POSTGRES_DB:-app_db}" | gzip > "$BACKUP_FILE"
    echo -e "${GREEN}✓ Database backed up${NC}"
else
    echo -e "${YELLOW}⚠ Database not running — skipping backup${NC}"
fi

# Swap image tags
echo -e "${BLUE}[2/3]${NC} Restoring previous image..."
docker tag approval-app:latest approval-app:failed 2>/dev/null || true
docker tag approval-app:rollback approval-app:latest
echo -e "${GREEN}✓ Image restored${NC}"

# Restart services
echo -e "${BLUE}[3/3]${NC} Restarting services..."
cd "$SCRIPT_DIR"
$COMPOSE -f docker-compose.prod.yml up -d --force-recreate app

sleep 10
echo ""
echo "============================================"
echo -e "${GREEN}✓ Rollback Complete!${NC}"
echo "============================================"
echo ""
$COMPOSE -f docker-compose.prod.yml ps
echo ""
echo "The failed image is saved as approval-app:failed"
echo "To retry the failed version: docker tag approval-app:failed approval-app:latest"
echo ""
