#!/bin/bash
# ==============================================
# Approval App - Deploy Script
# ==============================================
# Purpose: Update application with zero downtime
# Usage: ./deploy.sh
# ==============================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "============================================"
echo "  Approval App - Deployment"
echo "============================================"
echo ""

if docker compose version &>/dev/null; then
    COMPOSE=(docker compose)
elif command -v docker-compose &>/dev/null; then
    COMPOSE=(docker-compose)
else
    echo -e "${RED}✗ ERROR: Docker Compose not found${NC}"
    exit 1
fi

# Check if .env.production exists
if [ ! -f .env.production ]; then
    echo -e "${RED}✗ ERROR: .env.production not found${NC}"
    echo "Run ./scripts/setup.sh first to create it from the template"
    exit 1
fi

# Step 1: Pull latest changes
echo -e "${BLUE}[1/4]${NC} Pulling latest changes from git..."
if git rev-parse --is-inside-work-tree &>/dev/null; then
    CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
    CURRENT_COMMIT="$(git rev-parse --short HEAD)"

    echo "Current branch: $CURRENT_BRANCH"
    echo "Current commit: $CURRENT_COMMIT"

    if [ "$CURRENT_BRANCH" = "HEAD" ] || [ -z "$CURRENT_BRANCH" ]; then
        echo -e "${YELLOW}⚠ Detached HEAD detected; skipping git pull${NC}"
    else
        git pull --ff-only origin "$CURRENT_BRANCH"
    fi
else
    echo -e "${YELLOW}⚠ Not a git checkout; skipping git pull${NC}"
fi

# Step 2: Rebuild Docker images
echo -e "${BLUE}[2/4]${NC} Rebuilding Docker images..."
"${COMPOSE[@]}" build --no-cache
echo -e "${GREEN}✓ Images rebuilt${NC}"

# Step 3: Stop and remove old containers
echo -e "${BLUE}[3/4]${NC} Stopping old containers..."
"${COMPOSE[@]}" down
echo -e "${GREEN}✓ Old containers stopped${NC}"

# Step 4: Start new containers
echo -e "${BLUE}[4/4]${NC} Starting services..."
"${COMPOSE[@]}" up -d

# Wait for services to be healthy
echo "Waiting for services to be healthy..."
sleep 5

# Check service status
echo ""
echo "============================================"
echo "  Service Status"
echo "============================================"
"${COMPOSE[@]}" ps

USERS_AFTER_DEPLOY="unknown"
if docker ps --format '{{.Names}}' | grep -qx approval-db; then
    USERS_AFTER_DEPLOY="$(docker exec approval-db psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-app_db}" -tAc "select count(*) from users;" 2>/dev/null || echo unknown)"
else
    USERS_AFTER_DEPLOY="$("${COMPOSE[@]}" exec -T db psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-app_db}" -tAc "select count(*) from users;" 2>/dev/null || echo unknown)"
fi

echo "Users after deploy: $USERS_AFTER_DEPLOY"
if [ "$USERS_AFTER_DEPLOY" = "0" ]; then
    echo -e "${YELLOW}⚠ WARNING: Database has 0 users after deploy${NC}"
    echo "Check backups before trying to log in or creating new data."
fi

echo ""
echo "============================================"
echo -e "${GREEN}✓ Deployment Complete!${NC}"
echo "============================================"
echo ""
echo "Application is running at: http://localhost:3000"
echo ""
echo "Check logs with: docker compose logs -f"
echo ""

# Optional: Prune old images to save space
read -p "Prune old Docker images to save space? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Pruning old Docker images..."
    docker image prune -f
    echo -e "${GREEN}✓ Old images pruned${NC}"
fi
