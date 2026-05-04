#!/bin/bash
# ==============================================
# Approval App - Offline Deploy
# ==============================================
# Purpose: Deploy from pre-built Docker images (no internet needed)
# Runs on: Target server (Linux, offline)
# Usage:   bash deploy-offline.sh [package_dir]
# ==============================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Determine script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# If called from extracted package, use that dir; otherwise use SCRIPT_DIR
PACKAGE_DIR="${1:-$SCRIPT_DIR}"

echo "============================================"
echo "  Approval App - Offline Deploy"
echo "============================================"
echo ""

# Read version info
if [ -f "$PACKAGE_DIR/VERSION" ]; then
    source "$PACKAGE_DIR/VERSION"
    echo -e "${BLUE}Version:${NC} $version"
    echo -e "${BLUE}Built:  ${NC} $date"
    echo ""
fi

# Step 1: Check prerequisites
echo -e "${BLUE}[1/6]${NC} Checking prerequisites..."

if ! command -v docker &> /dev/null; then
    echo -e "${RED}✗ Docker not installed. Install it first.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Docker found${NC}"

if docker compose version &> /dev/null 2>&1; then
    COMPOSE="docker compose"
elif docker-compose version &> /dev/null 2>&1; then
    COMPOSE="docker-compose"
else
    echo -e "${RED}✗ Docker Compose not found.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Docker Compose found ($COMPOSE)${NC}"

# Check .env.production
if [ ! -f "$PACKAGE_DIR/.env.production" ]; then
    if [ -f "$PACKAGE_DIR/.env.production.example" ]; then
        echo -e "${YELLOW}⚠ .env.production not found${NC}"
        echo "Copying from .env.production.example..."
        cp "$PACKAGE_DIR/.env.production.example" "$PACKAGE_DIR/.env.production"
        echo -e "${RED}✗ STOP: Edit .env.production with your actual values, then re-run this script.${NC}"
        exit 1
    else
        echo -e "${RED}✗ .env.production not found and no example file.${NC}"
        exit 1
    fi
fi
echo -e "${GREEN}✓ .env.production found${NC}"

# Step 2: Load Docker images
echo -e "${BLUE}[2/6]${NC} Loading Docker images from .tar files..."

IMAGES_DIR="$PACKAGE_DIR/images"
if [ ! -d "$IMAGES_DIR" ]; then
    echo -e "${RED}✗ Images directory not found: $IMAGES_DIR${NC}"
    exit 1
fi

for image_tar in "$IMAGES_DIR"/*.tar; do
    if [ -f "$image_tar" ]; then
        echo "  Loading $(basename "$image_tar")..."
        docker load -i "$image_tar"
    fi
done
echo -e "${GREEN}✓ Docker images loaded${NC}"

# Step 3: Backup database (if containers exist)
echo -e "${BLUE}[3/6]${NC} Backing up database..."
BACKUP_DIR="$PACKAGE_DIR/backups"
mkdir -p "$BACKUP_DIR"

if docker ps -a --format '{{.Names}}' | grep -q 'approval-db'; then
    BACKUP_FILE="$BACKUP_DIR/db-backup-$(date +%Y%m%d-%H%M%S).sql.gz"
    docker exec approval-db pg_dump -U "${POSTGRES_USER:-postgres}" "${POSTGRES_DB:-app_db}" | gzip > "$BACKUP_FILE"
    BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo -e "${GREEN}✓ Database backed up: $BACKUP_FILE ($BACKUP_SIZE)${NC}"
else
    echo -e "${YELLOW}⚠ No existing database container — skipping backup (first deploy)${NC}"
fi

# Step 4: Stop existing services
echo -e "${BLUE}[4/6]${NC} Stopping existing services..."
cd "$PACKAGE_DIR"
$COMPOSE --env-file .env.production -f docker-compose.prod.yml down --remove-orphans 2>/dev/null || true
echo -e "${GREEN}✓ Services stopped${NC}"

# Step 5: Tag the current image for rollback
echo -e "${BLUE}[5/6]${NC} Tagging current version for rollback..."
if docker images approval-app:latest --format '{{.ID}}' | head -1 | grep -q .; then
    # Check if rollback tag already exists
    if ! docker images approval-app:rollback --format '{{.ID}}' | head -1 | grep -q .; then
        docker tag approval-app:latest approval-app:rollback 2>/dev/null || true
        echo -e "${GREEN}✓ Previous version tagged as approval-app:rollback${NC}"
    else
        docker tag approval-app:rollback approval-app:rollback-prev 2>/dev/null || true
        docker tag approval-app:latest approval-app:rollback 2>/dev/null || true
        echo -e "${GREEN}✓ Rollback tags updated${NC}"
    fi
else
    echo -e "${YELLOW}⚠ No previous image to tag for rollback (first deploy)${NC}"
fi

# Step 6: Start services
echo -e "${BLUE}[6/6]${NC} Starting services..."
cd "$PACKAGE_DIR"
$COMPOSE --env-file .env.production -f docker-compose.prod.yml up -d

# Wait for health
echo "Waiting for services to start..."
sleep 10

echo ""
echo "============================================"
echo "  Service Status"
echo "============================================"
$COMPOSE --env-file .env.production -f docker-compose.prod.yml ps

echo ""
echo "============================================"
echo -e "${GREEN}✓ Deployment Complete!${NC}"
echo "============================================"
echo ""
echo "Application: http://localhost:3000"
echo ""
echo "Useful commands:"
echo "  View logs:   $COMPOSE -f docker-compose.prod.yml logs -f"
echo "  Stop:        $COMPOSE -f docker-compose.prod.yml down"
echo "  Rollback:    bash rollback.sh"
echo "  DB Backup:   bash db-backup.sh"
echo ""
