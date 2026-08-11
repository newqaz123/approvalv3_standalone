#!/usr/bin/env bash
# Test fixture: fake `docker` for deployment-flow behavior tests.
# All behavior is driven by environment variables set by the test harness.
# Every invocation is appended to $COMMAND_LOG for later assertions.
echo "docker $*" >>"$COMMAND_LOG"

sub="$1"
shift || true

case "$sub" in
compose)
	rest="$*"
	if printf '%s\n' "$rest" | grep -q 'up -d db migrate app'; then
		echo 'MIGRATION_COMMAND_REACHED' >>"$COMMAND_LOG"
		exit "${COMPOSE_UP_EXIT:-0}"
	fi
	if printf '%s\n' "$rest" | grep -q 'config --volumes'; then
		echo 'uploads_data'
		exit 0
	fi
	# `docker compose version` and anything else succeed.
	exit 0
	;;
inspect)
	fmt=""
	target=""
	while [ $# -gt 0 ]; do
		case "$1" in
		-f)
			fmt="$2"
			shift 2
			;;
		*)
			target="$1"
			shift
			;;
		esac
	done
	case "$fmt" in
	'{{.Image}}')
		case "$target" in
		approval-app)
			echo "${APP_IMAGE_SHA:-sha256:appimage}"
			exit 0
			;;
		approval-migrate)
			echo "${MIGRATE_IMAGE_SHA:-sha256:migrateimage}"
			exit 0
			;;
		*) exit 0 ;;
		esac
		;;
	'{{.State.Status}}')
		case "$target" in
		approval-migrate)
			echo "${MIGRATE_STATE:-exited}"
			exit 0
			;;
		*)
			echo "${CONTAINER_STATE:-running}"
			exit 0
			;;
		esac
		;;
	'{{.State.ExitCode}}')
		case "$target" in
		approval-migrate)
			echo "${MIGRATE_EXIT_CODE:-0}"
			exit 0
			;;
		*)
			echo 0
			exit 0
			;;
		esac
		;;
	'{{.State.Health.Status}}')
		echo "${HEALTH_STATUS:-healthy}"
		exit 0
		;;
	'')
		# Plain existence check (container_exists).
		if [ "${APP_CONTAINER_MISSING:-0}" = "1" ] && [ "$target" = "approval-app" ]; then
			exit 1
		fi
		exit 0
		;;
	*)
		case "$fmt" in
		*Config.Labels*) echo 'approval-app'; exit 0 ;;
		*Mounts*)
			case "$target" in
			approval-db) printf '%s %s\n' "${DB_VOLUME:-approval-app_db_data}" '/var/lib/postgresql/data' ;;
			approval-app) printf '%s %s\n' "${UPLOADS_VOLUME:-approval-app_uploads_data}" '/app/uploads' ;;
			esac
			exit 0
			;;
		esac
		exit 0
		;;
	esac
	;;
image)
	# `docker image tag ...` and `docker image inspect ...` succeed.
	exit 0
	;;
exec)
	container="$1"
	shift || true
	if [ "$container" = "approval-db" ]; then
		has_pgdump=0
		query=""
		prev=""
		for a in "$@"; do
			[ "$a" = "pg_dump" ] && has_pgdump=1
			if [ "$prev" = "-c" ]; then query="$a"; fi
			prev="$a"
		done
		if [ "$has_pgdump" = "1" ]; then
			printf 'PG_DUMP dummy content\n'
			exit 0
		fi
		if [ "${QUERY_FAILURE:-0}" = "1" ]; then
			exit 1
		fi
		case "$query" in
		*filePath*)
			if [ "${ATTACHMENT_QUERY_FAILURE:-0}" = "1" ]; then exit 1; fi
			if [ -n "$ATTACHMENT_ROWS_FILE" ] && [ -f "$ATTACHMENT_ROWS_FILE" ]; then cat "$ATTACHMENT_ROWS_FILE"; fi
			exit 0
			;;
		*from\ users*)
			echo "${USERS_COUNT:-19}"
			exit 0
			;;
		*from\ file_attachments*)
			echo "${ATTACHMENTS_COUNT:-35}"
			exit 0
			;;
		*prisma_migrations*)
			echo "${MIGRATIONS_COUNT:-5}"
			exit 0
			;;
		*)
			echo 0
			exit 0
			;;
		esac
	fi
	if [ "$container" = "approval-app" ]; then
		if [ "${FILES_FAILURE:-0}" = "1" ]; then
			exit 1
		fi
		for a in "$@"; do
			case "$a" in
			*find\ /app/uploads*)
				echo "${FILES_COUNT:-33}"
				exit 0
				;;
			esac
		done
		rel=""
		for a in "$@"; do
			case "$a" in
			*/app/uploads/*)
				rel="${a#*/app/uploads/}"
				rel="${rel%%\"*}"
				rel="${rel%%\'*}"
				;;
			esac
		done
		if [ -n "$rel" ] && [ -n "$MISSING_PATHS_FILE" ] && [ -f "$MISSING_PATHS_FILE" ] && grep -qx -- "$rel" "$MISSING_PATHS_FILE"; then
			exit 1
		fi
		exit 0
	fi
	exit 0
	;;
volume)
	case "$1" in
	ls)
		if [ "${AMBIGUOUS_VOLUMES:-0}" = "1" ]; then
			echo 'projectA_uploads_data'
			echo 'projectB_uploads_data'
		else
			echo "${UPLOADS_VOLUME:-approval-app_uploads_data}"
		fi
		exit 0
		;;
	esac
	exit 0
	;;
run)
	# docker run --rm -v <vol>:/data:ro -v <host>:/backup alpine tar -czf /backup/<name> -C /data .
	backup_host=""
	for a in "$@"; do
		case "$a" in
		*:/backup) backup_host="${a%:/backup}" ;;
		esac
	done
	for a in "$@"; do
		case "$a" in
		/backup/*)
			name="${a#/backup/}"
			if [ -n "$backup_host" ]; then
				printf 'uploads archive dummy content\n' >"$backup_host/$name"
			fi
			;;
		esac
	done
	exit 0
	;;
ps)
	if printf '%s\n' "$*" | grep -q -- '--format'; then
		echo 'approval-db'
		echo 'approval-app'
	fi
	exit 0
	;;
esac
exit 0
