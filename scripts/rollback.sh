#!/bin/bash
# ==============================================
# Approval App - Rollback
# ==============================================
# Purpose: Roll back to the previous Docker image version
# Runs on: Target server
# Usage:   bash scripts/rollback.sh [--yes]
# ==============================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

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
DEPLOY_STATE_FILE="$PROJECT_ROOT/backups/last-deployment-state.env"
ASSUME_YES=false

case "${1:-}" in
'') ;;
--yes) ASSUME_YES=true ;;
*)
	echo "Usage: $0 [--yes]" >&2
	exit 2
	;;
esac
[ "$#" -le 1 ] || {
	echo "Usage: $0 [--yes]" >&2
	exit 2
}

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

migration_state() {
	local count value
	[ -f "$DEPLOY_STATE_FILE" ] || {
		printf '%s\n' unknown
		return
	}
	count="$(grep -c '^MIGRATIONS_APPLIED=' "$DEPLOY_STATE_FILE" 2>/dev/null || true)"
	[ "$count" = "1" ] || {
		printf '%s\n' unknown
		return
	}
	value="$(sed -n 's/^MIGRATIONS_APPLIED=//p' "$DEPLOY_STATE_FILE")"
	case "$value" in
	none | applied | unknown) printf '%s\n' "$value" ;;
	*) printf '%s\n' unknown ;;
	esac
}

echo "============================================"
echo "  Approval App - Rollback"
echo "============================================"
echo ""

if ! docker images approval-app:rollback --format '{{.ID}}' | head -1 | grep -q .; then
	echo -e "${RED}✗ No rollback image found. Cannot rollback.${NC}"
	exit 1
fi

ROLLBACK_ID="$(docker images approval-app:rollback --format '{{.ID}}' | head -1)"
CURRENT_ID="$(docker images approval-app:latest --format '{{.ID}}' | head -1)"
echo -e "${YELLOW}Current image:${NC} approval-app:latest ($CURRENT_ID)"
echo -e "${YELLOW}Rollback to:  ${NC} approval-app:rollback ($ROLLBACK_ID)"
echo ""

if [ "$ASSUME_YES" != true ]; then
	read -r -p "Proceed with rollback? (y/N) " REPLY
	case "$REPLY" in
	y | Y | yes | YES | Yes) ;;
	*)
		echo "Cancelled."
		exit 0
		;;
	esac
fi

MIGRATIONS_APPLIED="$(migration_state)"
echo "Migrations applied state: $MIGRATIONS_APPLIED"
if [ "$MIGRATIONS_APPLIED" != none ]; then
	echo -e "${YELLOW}⚠ The previous app image may be incompatible with the current database schema.${NC}"
	read -r -p "Type ROLLBACK APP ONLY to continue: " MIGRATION_CONFIRMATION
	if [ "$MIGRATION_CONFIRMATION" != 'ROLLBACK APP ONLY' ]; then
		echo "Rollback cancelled: migration compatibility was not acknowledged." >&2
		exit 1
	fi
fi

echo -e "${BLUE}[1/3]${NC} Backing up database and uploads..."
DB_CONTAINER=approval-db APP_CONTAINER=approval-app \
	bash "$PROJECT_ROOT/scripts/backup.sh"
echo -e "${GREEN}✓ Backup complete${NC}"

echo -e "${BLUE}[2/3]${NC} Restoring previous image..."
docker tag approval-app:latest approval-app:failed 2>/dev/null || true
docker tag approval-app:rollback approval-app:latest
echo -e "${GREEN}✓ Image restored${NC}"

echo -e "${BLUE}[3/3]${NC} Restarting application..."
compose_prod up -d --force-recreate app

sleep "${ROLLBACK_WAIT_SECONDS:-10}"
echo ""
echo "============================================"
echo -e "${GREEN}✓ Rollback Complete!${NC}"
echo "============================================"
echo ""
compose_prod ps
echo ""
echo "The failed image is saved as approval-app:failed"
echo "To retry the failed version: docker tag approval-app:failed approval-app:latest"
echo ""
