# Offline Deployment Scripts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create scripts to build Docker images locally, export them as .tar files, transfer to an offline Linux server, and deploy with a single command.

**Architecture:** A two-phase approach — a **build script** runs on the dev machine (with internet) to produce a portable deployment package (.tar.gz containing Docker images + config), and a **deploy script** runs on the offline server to load images and start services. The existing docker-compose.yml already defines the production `app` service — we keep using it but load pre-built images instead of building on the server.

**Tech Stack:** Bash, Docker, docker-compose, scp/rsync for transfer

---

## File Structure

| File | Purpose |
|------|---------|
| `scripts/build-package.sh` | **Dev machine** — builds images, exports to .tar, creates deployment package |
| `scripts/deploy-offline.sh` | **Server** — loads images, backs up DB, runs migrations, starts services |
| `scripts/rollback.sh` | **Server** — rolls back to previous image version |
| `scripts/db-backup.sh` | **Server** — standalone DB backup utility (replace existing) |
| `docker-compose.prod.yml` | Production-only compose file that uses pre-built images (no `build:` directives) |

---

### Task 1: Create docker-compose.prod.yml

**Files:**
- Create: `docker-compose.prod.yml`

This is the compose file that runs on the server. Unlike the existing `docker-compose.yml`, it has NO `build:` directives — it references pre-built images loaded from .tar files.

- [ ] **Step 1: Create docker-compose.prod.yml**

```yaml
# Production docker-compose for offline/air-gapped deployment
# Images are pre-built and loaded from .tar files — no build step needed
# Usage: docker compose -f docker-compose.prod.yml up -d

services:
  db:
    image: postgres:15-alpine
    container_name: approval-db
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
      POSTGRES_DB: ${POSTGRES_DB:-app_db}
    volumes:
      - db_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-postgres} -d ${POSTGRES_DB:-app_db}"]
      interval: 10s
      timeout: 5s
      retries: 5
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M
    restart: unless-stopped

  migrate:
    image: approval-app:latest
    container_name: approval-migrate
    command: npx prisma migrate deploy
    environment:
      DATABASE_URL: ${DATABASE_URL}
    depends_on:
      db:
        condition: service_healthy
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
    restart: "no"

  app:
    image: approval-app:latest
    container_name: approval-app
    ports:
      - "3000:3000"
    env_file:
      - .env.production
    environment:
      NODE_ENV: production
    volumes:
      - uploads_data:/app/uploads
    depends_on:
      db:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully
    restart: always
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 1G
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:3000/ || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

volumes:
  db_data:
    driver: local
  uploads_data:
    driver: local
```

- [ ] **Step 2: Commit**

```bash
git add docker-compose.prod.yml
git commit -m "feat(deploy): add production compose file for offline deployment"
```

---

### Task 2: Create build-package.sh

**Files:**
- Create: `scripts/build-package.sh`

This script runs on the **dev machine** (with internet). It builds the Docker image, exports it, and creates a deployment package containing everything the server needs.

- [ ] **Step 1: Write build-package.sh**

```bash
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
echo -e "${GREEN}✓ Image built: approval-app:$VERSION${NC}"

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
```

- [ ] **Step 2: Make executable and test syntax**

Run: `chmod +x scripts/build-package.sh && bash -n scripts/build-package.sh`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add scripts/build-package.sh
git commit -m "feat(deploy): add build-package script for offline deployment"
```

---

### Task 3: Create deploy-offline.sh

**Files:**
- Create: `scripts/deploy-offline.sh`

This script runs on the **offline server**. It loads the Docker images from .tar files, backs up the database, runs migrations, and starts services.

- [ ] **Step 1: Write deploy-offline.sh**

```bash
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
$COMPOSE -f docker-compose.prod.yml down --remove-orphans 2>/dev/null || true
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
$COMPOSE -f docker-compose.prod.yml up -d

# Wait for health
echo "Waiting for services to start..."
sleep 10

echo ""
echo "============================================"
echo "  Service Status"
echo "============================================"
$COMPOSE -f docker-compose.prod.yml ps

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
```

- [ ] **Step 2: Make executable and test syntax**

Run: `chmod +x scripts/deploy-offline.sh && bash -n scripts/deploy-offline.sh`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add scripts/deploy-offline.sh
git commit -m "feat(deploy): add offline deploy script for air-gapped servers"
```

---

### Task 4: Create rollback.sh

**Files:**
- Create: `scripts/rollback.sh`

- [ ] **Step 1: Write rollback.sh**

```bash
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
```

- [ ] **Step 2: Make executable and test syntax**

Run: `chmod +x scripts/rollback.sh && bash -n scripts/rollback.sh`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add scripts/rollback.sh
git commit -m "feat(deploy): add rollback script for quick version revert"
```

---

### Task 5: Create db-backup.sh

**Files:**
- Create: `scripts/db-backup.sh`

This replaces the existing `scripts/backup.sh` with a version that works standalone on the offline server.

- [ ] **Step 1: Write db-backup.sh**

```bash
#!/bin/bash
# ==============================================
# Approval App - Database Backup
# ==============================================
# Purpose: Backup PostgreSQL database from Docker container
# Runs on: Target server
# Usage:   bash db-backup.sh
# ==============================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "============================================"
echo "  Approval App - Database Backup"
echo "============================================"
echo ""

# Check if db container is running
if ! docker ps --format '{{.Names}}' | grep -q 'approval-db'; then
    echo -e "${RED}✗ Database container (approval-db) is not running.${NC}"
    exit 1
fi

# Create backup
BACKUP_DIR="$SCRIPT_DIR/backups"
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/db-backup-$TIMESTAMP.sql.gz"

echo "Backing up database..."
docker exec approval-db pg_dump -U "${POSTGRES_USER:-postgres}" "${POSTGRES_DB:-app_db}" | gzip > "$BACKUP_FILE"

BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo -e "${GREEN}✓ Backup complete: $BACKUP_FILE ($BACKUP_SIZE)${NC}"

# Keep only last 10 backups
echo ""
echo "Cleaning old backups (keeping last 10)..."
ls -t "$BACKUP_DIR"/db-backup-*.sql.gz | tail -n +11 | xargs -r rm --
echo -e "${GREEN}✓ Cleanup done${NC}"

echo ""
echo "To restore a backup:"
echo "  gunzip -c $BACKUP_FILE | docker exec -i approval-db psql -U postgres app_db"
echo ""
```

- [ ] **Step 2: Make executable and test syntax**

Run: `chmod +x scripts/db-backup.sh && bash -n scripts/db-backup.sh`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add scripts/db-backup.sh
git commit -m "feat(deploy): add standalone db-backup script for offline server"
```

---

### Task 6: Add deploy convenience script for quick SCP + deploy

**Files:**
- Create: `scripts/deploy-remote.sh`

A convenience script that builds the package locally, transfers it via SCP to the VPS, and triggers the deploy — all in one command.

- [ ] **Step 1: Write deploy-remote.sh**

```bash
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
REMOTE_PATH="${2:-/opt/approval}"

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
```

- [ ] **Step 2: Make executable and test syntax**

Run: `chmod +x scripts/deploy-remote.sh && bash -n scripts/deploy-remote.sh`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add scripts/deploy-remote.sh
git commit -m "feat(deploy): add one-command remote deploy via SCP"
```

---

### Task 7: Test build-package.sh locally

**Files:**
- Modify: `scripts/build-package.sh` (fixes if needed)

- [ ] **Step 1: Run build-package.sh in dry-run mode to verify it works**

Run: `bash scripts/build-package.sh test-v1`
Expected: Creates `deploy/approval-app-test-v1-<date>.tar.gz` containing images and scripts

- [ ] **Step 2: Verify the package contents**

Run: `tar -tzf deploy/approval-app-test-v1-*.tar.gz | head -20`
Expected: Should list docker-compose.prod.yml, images/, scripts, VERSION, README.txt

- [ ] **Step 3: Fix any issues found during test and commit**

```bash
git add -u scripts/
git commit -m "fix(deploy): fixes from build-package test run"
```

---

## Self-Review

**1. Spec coverage:**
- Build Docker images locally → Task 2 (build-package.sh)
- Export as .tar → Task 2
- Transfer to server → Task 6 (deploy-remote.sh handles SCP; manual USB transfer also works via the .tar.gz)
- Load images on offline server → Task 3 (deploy-offline.sh step 2)
- Deploy with single command → Task 3 + Task 6
- DB backup before deploy → Task 3 (step 3) + Task 5 (standalone)
- Rollback → Task 4
- Prisma migrations → Task 3 (docker-compose.prod.yml migrate service)

**2. Placeholder scan:** No TBDs, TODOs, or "implement later" found.

**3. Type consistency:** All scripts reference `approval-app:latest` and `approval-app:rollback` consistently. The compose file uses `approval-app:latest` matching the build script's tag.
