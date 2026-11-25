#!/bin/bash
# ==============================================
# Approval App - Health Check Script
# ==============================================
# Purpose: Verify service health for monitoring and cron
# Usage: ./health-check.sh
# Exit codes: 0 = healthy, non-zero = unhealthy
# ==============================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib/deploy-common.sh"

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
# 1. Check if Docker is available
# ==============================================
if ! command -v docker &>/dev/null; then
    echo -e "${RED}✗ Docker not found${NC}"
    exit 1
fi

# ==============================================
# 2. Check if services are running
# ==============================================
echo "Checking Docker containers..."

# Check database container by name. Some existing VPS installs are not visible
# as Compose services from the current checkout, but the named containers exist.
DB_STATUS=$(docker inspect -f '{{.State.Status}}' "$DB_CONTAINER" 2>/dev/null || echo "not_found")

if [ "$DB_STATUS" = "running" ]; then
    echo -e "${GREEN}✓${NC} Database ($DB_CONTAINER): running"
else
    echo -e "${RED}✗${NC} Database ($DB_CONTAINER): $DB_STATUS"
    ALL_HEALTHY=false
fi

APP_STATUS=$(docker inspect -f '{{.State.Status}}' "$APP_CONTAINER" 2>/dev/null || echo "not_found")

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
DB_HEALTH=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}unknown{{end}}' "$DB_CONTAINER" 2>/dev/null || echo "unknown")

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
APP_HEALTH=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}unknown{{end}}' "$APP_CONTAINER" 2>/dev/null || echo "unknown")

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

if ! command -v curl &>/dev/null || ! command -v node &>/dev/null; then
    echo -e "${RED}✗${NC} API readiness check requires curl and Node.js"
    ALL_HEALTHY=false
elif api_reports_connected "$HEALTH_CHECK_URL"; then
    echo -e "${GREEN}✓${NC} API readiness: database connected"
else
    echo -e "${RED}✗${NC} API readiness: no successful response with a connected database"
    ALL_HEALTHY=false
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
