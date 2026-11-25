#!/bin/bash
# ==============================================
# Approval App - Build & Deploy to Remote Server
# ==============================================
# Purpose: Build package locally, transfer via SCP, deploy remotely
# Runs on: Dev machine (with internet)
# Usage:   bash scripts/deploy-remote.sh user@host [remote-path] [version]
# ==============================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() {
    printf '%s\n' \
        'Usage: bash scripts/deploy-remote.sh user@host [remote-path] [version]' \
        '  remote-path: absolute, ASCII letters, digits, /, ., _, and - only;' \
        '               no root directory or . or .. components (default: /opt/approval-app).' \
        '  version: a Docker tag matching ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$.'
}

validate_remote_inputs() {
    local LC_ALL=C path_with_slash="$REMOTE_PATH/"
    if [[ $REMOTE_PATH != /* || $REMOTE_PATH != *[!/]* || $REMOTE_PATH == *[!A-Za-z0-9/._-]* ||
          $path_with_slash == */./* || $path_with_slash == */../* ]]; then
        printf 'ERROR: Unsupported remote path.\n' >&2
        usage >&2
        return 1
    fi
    if [[ ! $VERSION =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]]; then
        printf 'ERROR: Version must be a valid Docker tag.\n' >&2
        usage >&2
        return 1
    fi
}

case "${1:-}" in
    -h|--help) usage; exit 0 ;;
    '') usage >&2; exit 1 ;;
esac
REMOTE="$1"
REMOTE_PATH="${2:-/opt/approval-app}"
VERSION="${3:-$(git describe --tags --always --dirty 2>/dev/null || echo "dev-$(date +%Y%m%d%H%M)")}"
validate_remote_inputs

if ! remote_uid="$(ssh -- "$REMOTE" 'id -u' </dev/null)"; then
    printf 'ERROR: Unable to determine remote effective UID over SSH; deployment aborted.\n' >&2
    exit 1
fi
if [ "$remote_uid" != 0 ]; then
    printf 'ERROR: Remote deployment must run as root; transfer the package separately and use an authorized deployment account (see DEPLOY.md).\n' >&2
    exit 1
fi

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
# Isolate same-tag uploads before the atomic release-directory reservation.
staging_name="$(ssh -- "$REMOTE" "mkdir -p '$REMOTE_PATH' && cd '$REMOTE_PATH' && mktemp -d .incoming.XXXXXXXX" </dev/null)"
if [[ ! $staging_name =~ ^\.incoming\.[A-Za-z0-9]{8}$ ]]; then
    printf 'ERROR: Unexpected remote staging directory name; deployment aborted.\n' >&2
    exit 1
fi
staging_dir="${REMOTE_PATH%/}/$staging_name"
cleanup_upload() {
    if ! ssh -- "$REMOTE" "rm -f -- '$staging_dir/${PACKAGE_NAME}.tar.gz' && rmdir -- '$staging_dir'" </dev/null; then
        printf 'WARNING: Could not remove remote upload directory: %s\n' "$staging_dir" >&2
    fi
}
trap cleanup_upload EXIT
scp -- "$PROJECT_DIR/deploy/${PACKAGE_NAME}.tar.gz" "$REMOTE:$staging_dir/"
echo -e "${GREEN}✓ Package transferred${NC}"

# Step 3: Extract and deploy remotely
echo -e "${BLUE}[3/3]${NC} Deploying on server..."
ssh -- "$REMOTE" <<REMOTE_DEPLOY
set -e
cd '$REMOTE_PATH'

# Reserve a fresh release directory before extracting; never overwrite a prior release.
if ! mkdir -- '${PACKAGE_NAME}'; then
    printf 'ERROR: Cannot create release directory %s. If it already exists, use a new version tag.\n' '${PACKAGE_NAME}' >&2
    exit 1
fi
echo "Extracting ${PACKAGE_NAME}.tar.gz..."
tar -xzf '$staging_dir/${PACKAGE_NAME}.tar.gz' --strip-components=1 -C '${PACKAGE_NAME}'

# Copy .env.production if it exists from previous deploy
if [ -f .env.production ] && [ ! -f '${PACKAGE_NAME}/.env.production' ]; then
    cp .env.production '${PACKAGE_NAME}/.env.production'
    echo "Reused existing .env.production"
fi

# Run deploy
cd '${PACKAGE_NAME}'
bash scripts/deploy-offline.sh

# Atomically replace the symlink itself, without following it into the old release.
cd '$REMOTE_PATH'
promotion_dir=\$(mktemp -d ./.current.XXXXXXXX)
trap 'rm -f -- "\$promotion_dir/current"; rmdir -- "\$promotion_dir"' EXIT
ln -s '${PACKAGE_NAME}' "\$promotion_dir/current"
node -e 'require("node:fs").renameSync(process.argv[1], "current")' "\$promotion_dir/current"
echo "Symlink updated: current -> ${PACKAGE_NAME}"
REMOTE_DEPLOY

echo ""
echo "============================================"
echo -e "${GREEN}✓ Remote Deploy Complete!${NC}"
echo "============================================"
echo ""
