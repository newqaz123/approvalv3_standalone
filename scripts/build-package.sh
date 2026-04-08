#!/bin/bash
# ==============================================
# Approval App - Build Deployment Package
# ==============================================
# Purpose: Build Docker images and create a portable deployment package
# Runs on: Dev machine (with internet access)
# Output:  deploy/approval-app-<version>-<date>.tar.gz
# ==============================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Version from git tag or commit hash
VERSION="${1:-$(git describe --tags --always --dirty 2>/dev/null || echo "dev-$(date +%Y%m%d%H%M)")}"
DATE=$(date +%Y%m%d)
PACKAGE_NAME="approval-app-${VERSION}-${DATE}"
OUTPUT_DIR="$PROJECT_DIR/deploy"
PACKAGE_DIR="$OUTPUT_DIR/$PACKAGE_NAME"

echo "============================================"
echo "  Approval App - Build Package"
echo "============================================"
echo ""
echo -e "${BLUE}Version:${NC} $VERSION"
echo -e "${BLUE}Package: ${NC} $PACKAGE_NAME.tar.gz"
echo ""

# Step 1: Build Docker images
echo -e "${BLUE}[1/5]${NC} Building Docker images..."
cd "$PROJECT_DIR"
docker build -t approval-app:latest -t "approval-app:$VERSION" --target runner .
docker build -t approval-migrate:latest --target migrator .
echo -e "${GREEN}✓ Images built: approval-app:$VERSION, approval-migrate:latest${NC}"

# Pull postgres image (needed for offline server)
echo -e "${BLUE}[2/5]${NC} Pulling PostgreSQL image..."
docker pull postgres:15-alpine
echo -e "${GREEN}✓ postgres:15-alpine pulled${NC}"

# Step 2: Create package directory
echo -e "${BLUE}[3/5]${NC} Creating package directory..."
rm -rf "$PACKAGE_DIR"
mkdir -p "$PACKAGE_DIR/images"
echo -e "${GREEN}✓ Package directory ready${NC}"

# Step 3: Export Docker images
echo -e "${BLUE}[4/5]${NC} Exporting Docker images (this may take a minute)..."
docker save approval-app:latest -o "$PACKAGE_DIR/images/approval-app.tar"
docker save approval-migrate:latest -o "$PACKAGE_DIR/images/approval-migrate.tar"
docker save postgres:15-alpine -o "$PACKAGE_DIR/images/postgres.tar"
echo -e "${GREEN}✓ Images exported${NC}"

# Step 4: Copy config files into package
echo -e "${BLUE}[5/5]${NC} Packaging config files..."
cp "$PROJECT_DIR/docker-compose.prod.yml" "$PACKAGE_DIR/"
cp "$PROJECT_DIR/.env.example" "$PACKAGE_DIR/.env.production.example"
cp "$PROJECT_DIR/scripts/deploy-offline.sh" "$PACKAGE_DIR/"
cp "$PROJECT_DIR/scripts/rollback.sh" "$PACKAGE_DIR/"
cp "$PROJECT_DIR/scripts/db-backup.sh" "$PACKAGE_DIR/"
cp "$PROJECT_DIR/scripts/setup.sh" "$PACKAGE_DIR/"
cp "$PROJECT_DIR/scripts/health-check.sh" "$PACKAGE_DIR/"

# Write version file
cat > "$PACKAGE_DIR/VERSION" <<EOF
version=$VERSION
date=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
git_commit=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
EOF

# Write a quick README for the package
cat > "$PACKAGE_DIR/README.txt" <<EOF
Approval App Deployment Package
================================
Version: $VERSION
Built:   $(date -u +"%Y-%m-%d %H:%M UTC")
Commit:  $(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

Quick Start:
1. Transfer this folder to the server
2. Edit .env.production.example -> .env.production with your values
3. Run: bash deploy-offline.sh
EOF

# Make scripts executable
chmod +x "$PACKAGE_DIR/deploy-offline.sh" 2>/dev/null || true
chmod +x "$PACKAGE_DIR/rollback.sh" 2>/dev/null || true
chmod +x "$PACKAGE_DIR/db-backup.sh" 2>/dev/null || true
chmod +x "$PACKAGE_DIR/health-check.sh" 2>/dev/null || true
chmod +x "$PACKAGE_DIR/setup.sh" 2>/dev/null || true

# Create tarball
echo ""
echo "Compressing package..."
cd "$OUTPUT_DIR"
tar -czf "$PACKAGE_NAME.tar.gz" "$PACKAGE_NAME"
rm -rf "$PACKAGE_DIR"

PACKAGE_SIZE=$(du -h "$PACKAGE_NAME.tar.gz" | cut -f1)

echo ""
echo "============================================"
echo -e "${GREEN}✓ Package Ready!${NC}"
echo "============================================"
echo ""
echo -e "  File:   ${BLUE}deploy/${PACKAGE_NAME}.tar.gz${NC}"
echo -e "  Size:   ${BLUE}$PACKAGE_SIZE${NC}"
echo ""
echo "Transfer to server:"
echo "  scp deploy/${PACKAGE_NAME}.tar.gz user@server:/opt/approval/"
echo ""
echo "Or transfer via USB/external drive from the deploy/ directory."
echo ""
