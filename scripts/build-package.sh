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

# Step 1: Build Docker images for linux/amd64
echo -e "${BLUE}[1/6]${NC} Building Docker images for linux/amd64..."
cd "$PROJECT_DIR"

# Create a docker-container builder for cross-platform builds
# This is required on ARM Mac to build x86 images that can be exported properly
if ! docker buildx inspect approval-builder &>/dev/null; then
    echo "Creating buildx builder for linux/amd64 cross-platform builds..."
    docker buildx create --name approval-builder --driver docker-container --use
    docker buildx inspect approval-builder --bootstrap
fi
docker buildx use approval-builder

# Build and export directly to tar (avoids docker save manifest issues on ARM Mac)
mkdir -p "$OUTPUT_DIR"
docker buildx build --platform linux/amd64 \
  -t approval-app:latest -t "approval-app:$VERSION" \
  --target runner \
  --output type=docker,dest="$OUTPUT_DIR/approval-app.tar" .
echo -e "${GREEN}✓ approval-app image exported${NC}"

docker buildx build --platform linux/amd64 \
  -t approval-migrate:latest \
  --target migrator \
  --output type=docker,dest="$OUTPUT_DIR/approval-migrate.tar" .
echo -e "${GREEN}✓ approval-migrate image exported${NC}"

# Pull postgres image
echo -e "${BLUE}[2/6]${NC} Pulling PostgreSQL image..."
docker pull --platform linux/amd64 postgres:15-alpine
echo -e "${GREEN}✓ postgres:15-alpine pulled${NC}"

# Step 2: Create package directory
echo -e "${BLUE}[3/6]${NC} Creating package directory..."
rm -rf "$PACKAGE_DIR"
mkdir -p "$PACKAGE_DIR/images"
echo -e "${GREEN}✓ Package directory ready${NC}"

# Step 3: Move exported images into package
echo -e "${BLUE}[4/6]${NC} Moving images into package..."
mv "$OUTPUT_DIR/approval-app.tar" "$PACKAGE_DIR/images/"
mv "$OUTPUT_DIR/approval-migrate.tar" "$PACKAGE_DIR/images/"
docker save postgres:15-alpine -o "$PACKAGE_DIR/images/postgres.tar"
echo -e "${GREEN}✓ Images packaged${NC}"

# Step 4: Copy config files into package
echo -e "${BLUE}[5/6]${NC} Packaging config files..."
cp "$PROJECT_DIR/docker-compose.prod.yml" "$PACKAGE_DIR/"
cp "$PROJECT_DIR/.env.example" "$PACKAGE_DIR/.env.production.example"
cp "$PROJECT_DIR/DEPLOY.md" "$PACKAGE_DIR/"
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
