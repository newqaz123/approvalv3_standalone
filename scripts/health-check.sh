#!/bin/bash
# ==============================================
# Approval App - Health Check Script
# ==============================================
# Purpose: Verify service health for monitoring and cron
# Usage: ./health-check.sh
# Exit codes: 0 = healthy, non-zero = unhealthy
# ==============================================

set -e

# Colors for output (only for direct execution, suppressed in cron)
if [ -t 1 ]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    NC='\033[0m'
else
    RED=''
    GREEN=''
    YELLOW=''
    BLUE=''
    NC=''
fi

# Configuration
APP_CONTAINER="approval-app"
DB_CONTAINER="approval-db"
APP_PORT=3000
HEALTH_CHECK_URL="http://localhost:$APP_PORT/api/health"

# Health status flag
ALL_HEALTHY=true

# ==============================================
# 1. Check if Docker Compose is available
# ==============================================
if ! command -v docker &>/dev/null; then
    echo -e "${RED}✗ Docker not found${NC}"
    exit 1
fi

if ! docker compose ps &>/dev/null && ! docker-compose ps &>/dev/null; then
    echo -e "${RED}✗ Docker Compose not available${NC}"
    exit 1
fi

# Use appropriate docker compose command
if command -v docker-compose &>/dev/null; then
    DOCKER_COMPOSE="docker-compose"
else
    DOCKER_COMPOSE="docker compose"
fi

# ==============================================
# 2. Check if services are running
# ==============================================
echo "Checking Docker Compose services..."

# Get container status
CONTAINER_STATUS=$($DOCKER_COMPOSE ps --format json 2>/dev/null)

# Check database container
DB_STATUS=$(echo "$CONTAINER_STATUS" | jq -r '.[] | select(.Name=="'$DB_CONTAINER'") | .State' 2>/dev/null || echo "not_found")

if [ "$DB_STATUS" = "running" ]; then
    echo -e "${GREEN}✓${NC} Database ($DB_CONTAINER): running"
else
    echo -e "${RED}✗${NC} Database ($DB_CONTAINER): $DB_STATUS"
    ALL_HEALTHY=false
fi

# Check application container
APP_STATUS=$(echo "$CONTAINER_STATUS" | jq -r '.[] | select(.Name=="'$APP_CONTAINER'") | .State' 2>/dev/null || echo "not_found")

if [ "$APP_STATUS" = "running" ]; then
    echo -e "${GREEN}✓${NC} Application ($APP_CONTAINER): running"
else
    echo -e "${RED}✗${NC} Application ($APP_CONTAINER): $APP_STATUS"
    ALL_HEALTHY=false
fi

# ==============================================
# 3. Check container health status (Docker healthcheck)
# ==============================================
echo ""
echo "Checking container health status..."

# Check database health
DB_HEALTH=$(echo "$CONTAINER_STATUS" | jq -r '.[] | select(.Name=="'$DB_CONTAINER'") | .Health' 2>/dev/null || echo "unknown")

case "$DB_HEALTH" in
    "healthy")
        echo -e "${GREEN}✓${NC} Database health: healthy"
        ;;
    "unhealthy")
        echo -e "${RED}✗${NC} Database health: unhealthy"
        ALL_HEALTHY=false
        ;;
    "starting")
        echo -e "${YELLOW}⚠${NC} Database health: starting"
        ;;
    *)
        echo -e "${YELLOW}⚠${NC} Database health: $DB_HEALTH"
        ;;
esac

# Check application health
APP_HEALTH=$(echo "$CONTAINER_STATUS" | jq -r '.[] | select(.Name=="'$APP_CONTAINER'") | .Health' 2>/dev/null || echo "unknown")

case "$APP_HEALTH" in
    "healthy")
        echo -e "${GREEN}✓${NC} Application health: healthy"
        ;;
    "unhealthy")
        echo -e "${RED}✗${NC} Application health: unhealthy"
        ALL_HEALTHY=false
        ;;
    "starting")
        echo -e "${YELLOW}⚠${NC} Application health: starting"
        ;;
    *)
        echo -e "${YELLOW}⚠${NC} Application health: $APP_HEALTH"
        ;;
esac

# ==============================================
# 4. Check application API endpoint (HTTP health check)
# ==============================================
echo ""
echo "Checking application API endpoint..."

# Check if jq is available for API JSON parsing
if command -v curl &>/dev/null; then
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$HEALTH_CHECK_URL" 2>/dev/null || echo "000")

    case "$HTTP_STATUS" in
        200)
            echo -e "${GREEN}✓${NC} API health endpoint: responding (200 OK)"
            ;;
        000)
            echo -e "${YELLOW}⚠${NC} API health endpoint: no response (may be starting)"
            ALL_HEALTHY=false
            ;;
        *)
            echo -e "${RED}✗${NC} API health endpoint: HTTP $HTTP_STATUS"
            ALL_HEALTHY=false
            ;;
    esac
else
    echo -e "${YELLOW}⚠${NC} curl not available, skipping API health check"
fi

# ==============================================
# Summary
# ==============================================
echo ""

if [ "$ALL_HEALTHY" = true ]; then
    echo "============================================"
    echo -e "${GREEN}✓ All systems healthy${NC}"
    echo "============================================"
    exit 0
else
    echo "============================================"
    echo -e "${RED}✗ Some systems are unhealthy${NC}"
    echo "============================================"
    exit 1
fi
