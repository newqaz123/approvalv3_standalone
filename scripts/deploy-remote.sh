#!/bin/bash
# ==============================================
# Approval App - Build & Deploy to Remote Server
# ==============================================
# Purpose: Build package locally, transfer via SCP, deploy remotely
# Runs on: Dev machine (with internet)
# Usage:   bash scripts/deploy-remote.sh user@hostname [/remote/path]
# ==============================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Arguments
REMOTE="${1:?Usage: bash scripts/deploy-remote.sh user@hostname [/remote/path]}"
REMOTE_PATH="${2:-/opt/approval-app}"

VERSION="${3:-$(git describe --tags --always --dirty 2>/dev/null || echo "dev-$(date +%Y%m%d%H%M)")}"
DATE=$(date +%Y%m%d)
PACKAGE_NAME="approval-app-${VERSION}-${DATE}"

echo "============================================"
echo "  Approval App - Remote Deploy"
echo "============================================"
echo ""
echo -e "${BLUE}Target:${NC}  $REMOTE:$REMOTE_PATH"
echo -e "${BLUE}Version:${NC} $VERSION"
echo ""

# Step 1: Build package
echo -e "${BLUE}[1/3]${NC} Building deployment package..."
bash "$SCRIPT_DIR/build-package.sh" "$VERSION"
echo ""

# Step 2: Transfer to server
echo -e "${BLUE}[2/3]${NC} Transferring to server..."
ssh "$REMOTE" "mkdir -p $REMOTE_PATH"
scp "$PROJECT_DIR/deploy/${PACKAGE_NAME}.tar.gz" "$REMOTE:$REMOTE_PATH/"
echo -e "${GREEN}✓ Package transferred${NC}"

# Step 3: Extract and deploy remotely
echo -e "${BLUE}[3/3]${NC} Deploying on server..."
ssh "$REMOTE" <<REMOTE_DEPLOY
set -e
cd $REMOTE_PATH

# Extract package
echo "Extracting ${PACKAGE_NAME}.tar.gz..."
tar -xzf ${PACKAGE_NAME}.tar.gz

# Copy .env.production if it exists from previous deploy
if [ -f .env.production ] && [ ! -f ${PACKAGE_NAME}/.env.production ]; then
    cp .env.production ${PACKAGE_NAME}/.env.production
    echo "Reused existing .env.production"
fi

# Run deploy
cd ${PACKAGE_NAME}
bash deploy-offline.sh

# Update symlink for current
cd $REMOTE_PATH
rm -f current
ln -s ${PACKAGE_NAME} current
echo "Symlink updated: current -> ${PACKAGE_NAME}"
REMOTE_DEPLOY

echo ""
echo "============================================"
echo -e "${GREEN}✓ Remote Deploy Complete!${NC}"
echo "============================================"
echo ""
