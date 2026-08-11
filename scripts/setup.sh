#!/bin/bash
# ==============================================
# Approval App - Setup Script
# ==============================================
# Purpose: First-time server environment setup
# Usage: ./setup.sh
# ==============================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "============================================"
echo "  Approval App - Environment Setup"
echo "============================================"

# Check if .env.production exists
if [ ! -f .env.production ]; then
    echo -e "${YELLOW}.env.production not found${NC}"
    echo "Copying .env.production.example to .env.production"
    cp .env.production.example .env.production
    echo -e "${GREEN}✓ Created .env.production from template${NC}"
    echo -e "${YELLOW}⚠ IMPORTANT: Edit .env.production with your actual values before running bash scripts/deploy.sh${NC}"
else
    echo -e "${GREEN}✓ .env.production already exists${NC}"
fi

# Make all scripts executable
echo "Making scripts executable..."
chmod +x scripts/*.sh 2>/dev/null || true
echo -e "${GREEN}✓ Made scripts executable${NC}"

# Create backups directory
if [ ! -d "backups" ]; then
    echo "Creating backups directory..."
    mkdir -p backups
    echo -e "${GREEN}✓ Created backups/ directory${NC}"
else
    echo -e "${GREEN}✓ backups/ directory already exists${NC}"
fi

echo ""
echo "============================================"
echo -e "${GREEN}✓ Setup Complete!${NC}"
echo "============================================"
echo ""
echo "Next steps:"
echo "1. Edit .env.production with your actual values"
echo "2. Run: bash scripts/deploy.sh"
echo "3. Choose: Offline intranet package"
echo ""
