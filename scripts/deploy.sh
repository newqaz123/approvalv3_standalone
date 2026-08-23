#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
DEPLOY_ROOT="${DEPLOY_ROOT:-$REPO_ROOT}"
STAGE=startup

fail() {
	printf 'ERROR: %s\n' "$*" >&2
	return 1
}
deployment_failed() {
	local status=$?
	printf 'Deployment failed during: %s\n' "$STAGE" >&2
	exit "$status"
}
trap deployment_failed ERR

select_mode() {
	local choice
	while :; do
		printf '%s\n' '1. Ubuntu VPS / GitHub update' '2. Offline intranet package' '3. Cancel' >&2
		if ! read -r choice; then
			printf '\n' >&2
			return 0
		fi
		case "$choice" in
		1) printf '%s\n' online; return 0 ;;
		2) printf '%s\n' offline; return 0 ;;
		3) return 0 ;;
		*) printf '%s\n' 'Choose 1, 2, or 3' >&2 ;;
		esac
	done
}
usage() { printf 'Usage: %s [--online|--offline <package-dir>]\n' "$0"; }

require_host_command() {
	command -v "$1" >/dev/null 2>&1 || {
		fail "Required host command is not installed: $1"
		return 1
	}
}

has_running_app() { docker inspect approval-app >/dev/null 2>&1; }
has_required_volumes() {
	local volumes
	volumes="$(docker volume ls --format '{{.Name}}' 2>/dev/null || true)"
	printf '%s\n' "$volumes" | grep -Eq '(^|_)db_data$|(^|_)uploads_data$'
}
classify_existing_state() {
	if has_running_app; then return 0; fi
	if has_required_volumes; then
		fail 'Application is missing but deployment data volumes exist; refusing to treat this as first install'
		return 1
	fi
	DEPLOY_MODE=install
}
prepare_existing_state() {
	if has_running_app; then return 0; fi
	if has_required_volumes; then
		fail 'Application is missing but deployment data volumes exist; refusing to treat this as first install'
		return 1
	fi
	DEPLOY_MODE=install
}

online_git_preflight() {
	local status choice stash_ref old_commit
	git -C "$DEPLOY_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
		fail 'Online deployment requires a Git checkout'
		return 1
	}
	status="$(git -C "$DEPLOY_ROOT" status --porcelain)"
	if [ -n "$status" ]; then
		printf '%s\n' 'Working tree is dirty.' '1. Abort (default)' '2. Create named stash and continue' >&2
		read -r choice
		case "${choice:-1}" in
		2)
			git -C "$DEPLOY_ROOT" stash push --include-untracked -m "approval-deploy-$(date +%Y%m%d-%H%M%S)"
			stash_ref="$(git -C "$DEPLOY_ROOT" stash list -1 --format='%gd %gs')"
			printf 'Created stash: %s\nRecovery: git stash apply %s\n' "$stash_ref" "${stash_ref%% *}" >&2
			;;
		*)
			fail 'Deployment aborted because the working tree is dirty'
			return 1
			;;
		esac
	fi
	CURRENT_BRANCH="$(git -C "$DEPLOY_ROOT" rev-parse --abbrev-ref HEAD)"
	[ "$CURRENT_BRANCH" = main ] || {
		fail 'Online deployment must run from branch main'
		return 1
	}
	old_commit="$(git -C "$DEPLOY_ROOT" rev-parse HEAD)"
	export CURRENT_BRANCH OLD_VERSION="$old_commit"
}

online_git_acquire() {
	local new_commit origin_commit
	git -C "$DEPLOY_ROOT" fetch origin main
	# Main-branch contract: git pull --ff-only origin main.
	# Compatibility form: git pull --ff-only origin "$CURRENT_BRANCH".
	git -C "$DEPLOY_ROOT" pull --ff-only origin "$CURRENT_BRANCH"
	new_commit="$(git -C "$DEPLOY_ROOT" rev-parse HEAD)"
	origin_commit="$(git -C "$DEPLOY_ROOT" rev-parse origin/main)"
	git -C "$DEPLOY_ROOT" merge-base --is-ancestor "$new_commit" "$origin_commit" || {
		fail 'Updated commit is not an ancestor of origin/main'
		return 1
	}
	export NEW_VERSION="$new_commit"
	printf 'Online source: %s -> %s\n' "$OLD_VERSION" "$new_commit"
	docker build --target runner -t approval-app:latest "$DEPLOY_ROOT"
	docker build --target migrator -t approval-migrate:latest "$DEPLOY_ROOT"
}

validate_offline_package() {
	local required
	for required in VERSION SHA256SUMS docker-compose.prod.yml images/approval-app.tar images/approval-migrate.tar images/postgres.tar scripts/deploy.sh scripts/deploy-offline.sh scripts/backup.sh scripts/restore.sh scripts/rollback.sh scripts/health-check.sh scripts/setup.sh scripts/lib/deploy-common.sh tools/env-check.mjs tools/lib/env.mjs; do
		[ -f "$DEPLOY_ROOT/$required" ] || {
			fail "Offline package is missing: $required"
			return 1
		}
	done
	[ -s "$DEPLOY_ROOT/VERSION" ] || {
		fail 'Offline VERSION is empty'
		return 1
	}
	[ -s "$DEPLOY_ROOT/SHA256SUMS" ] || {
		fail 'Offline SHA256SUMS is empty'
		return 1
	}
	if command -v sha256sum >/dev/null 2>&1; then
		(cd "$DEPLOY_ROOT" && sha256sum -c SHA256SUMS)
	elif command -v shasum >/dev/null 2>&1; then
		(cd "$DEPLOY_ROOT" && shasum -a 256 -c SHA256SUMS)
	else
		fail 'Neither sha256sum nor shasum is installed'
	fi
}
load_offline_images() {
	docker load -i "$DEPLOY_ROOT/images/postgres.tar"
	docker load -i "$DEPLOY_ROOT/images/approval-migrate.tar"
	docker load -i "$DEPLOY_ROOT/images/approval-app.tar"
}

main() {
	local mode package_dir
	case "${1:-}" in
	--online) mode=online ;;
	--offline)
		mode=offline
		package_dir="${2:-}"
		[ -n "$package_dir" ] || {
			usage
			return 1
		}
		DEPLOY_ROOT="$(cd "$package_dir" && pwd -P)"
		;;
	'')
		mode="$(select_mode)"
		[ -n "$mode" ] || {
			printf 'Deployment cancelled.\n'
			exit 0
		}
		;;
	-h | --help)
		usage
		return 0
		;;
	*)
		usage
		return 1
		;;
	esac
	# Source shared functions only after resolving the package root.
	# shellcheck source=scripts/lib/deploy-common.sh
	. "$REPO_ROOT/scripts/lib/deploy-common.sh"
	export DEPLOY_ROOT ENV_FILE="${DEPLOY_ROOT}/.env.production" PROD_COMPOSE_FILE="${DEPLOY_ROOT}/docker-compose.prod.yml"
	STAGE=preflight
	require_host_command docker
	require_host_command node
	require_host_command curl
	detect_compose >/dev/null
	STAGE=validation
	run_env_gate
	if [ "$mode" = offline ]; then
		STAGE=package-validation
		validate_offline_package || {
			fail 'Offline package checksum validation failed'
			return 1
		}
	else
		STAGE=source-preflight
		online_git_preflight
	fi
	STAGE=classification
	classify_existing_state
	STAGE=rollback
	tag_rollback_images
	STAGE=state
	prepare_existing_state
	if [ "${DEPLOY_MODE:-update}" != install ]; then
		capture_deployment_state "$DEPLOY_STATE_FILE"
		audit_attachment_integrity "$DEPLOY_ROOT/backups/pre-missing-attachments.txt"
		STAGE=backup
		run_verified_backup
	else
		printf 'First install: no existing data to back up.\n'
	fi
	STAGE=source-acquisition
	if [ "$mode" = online ]; then online_git_acquire; else load_offline_images; fi
	STAGE=production-deploy
	deploy_production_services
	STAGE=migration
	wait_for_migration
	STAGE=health
	wait_for_health
	if [ "${DEPLOY_MODE:-update}" != install ]; then
		STAGE=preservation
		verify_preserved_state "$DEPLOY_STATE_FILE"
		audit_attachment_integrity "$DEPLOY_ROOT/backups/post-missing-attachments.txt"
		verify_new_attachment_integrity "$DEPLOY_ROOT/backups/pre-missing-attachments.txt" "$DEPLOY_ROOT/backups/post-missing-attachments.txt"
		USERS_AFTER_DEPLOY="$(state_value POST_USERS "$DEPLOY_STATE_FILE" || true)"
		if [ "${USERS_AFTER_DEPLOY:-unknown}" = 0 ]; then
			printf 'WARNING: Database has 0 users after deploy\n' >&2
		fi
	fi
	STAGE=report
	printf 'Deployment succeeded (%s).\n' "$mode"
}

if [ "${DEPLOY_SOURCE_ONLY:-0}" != 1 ]; then
	main "$@"
fi
