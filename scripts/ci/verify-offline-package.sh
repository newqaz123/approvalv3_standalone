#!/usr/bin/env bash
# Verify the archive built by this job, never an operator's installation.

fail() {
  printf 'Offline release check: %s\n' "$*" >&2
  exit 1
}

assert_connected_health() {
  node -e '
    try {
      const health = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
      process.exitCode = health?.status === "ok" && health.database === "connected" ? 0 : 1;
    } catch {
      process.exitCode = 1;
    }
  '
}

main() (
  set -euo pipefail
  [[ ${GITHUB_ACTIONS:-} == true ]] || fail 'requires GITHUB_ACTIONS=true'
  [[ ${RUNNER_ENVIRONMENT:-} == github-hosted ]] || fail 'requires a github-hosted runner'
  [[ $(uname -m) == x86_64 ]] || fail 'requires a native x86_64 runner'
  [[ ${GITHUB_RUN_ID:-} =~ ^[0-9]+$ ]] || fail 'requires a numeric GITHUB_RUN_ID'
  [[ ${GITHUB_RUN_ATTEMPT:-} =~ ^[0-9]+$ ]] || fail 'requires a numeric GITHUB_RUN_ATTEMPT'
  [[ -d ${RUNNER_TEMP:-} && -w $RUNNER_TEMP ]] || fail 'requires a writable RUNNER_TEMP directory'
  [[ ${GITHUB_SHA:-} =~ ^[0-9a-f]{40}$ ]] || fail 'requires a full GITHUB_SHA'
  [[ $# == 1 && -f $1 ]] || fail 'usage: bash scripts/ci/verify-offline-package.sh <archive>'

  local project="approval-release-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
  local checkout scratch phase='archive verification' compose_ready=0
  checkout=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
  scratch=$(mktemp -d "$RUNNER_TEMP/approval-release.XXXXXX")
  local compose=(docker compose --project-name "$project" --env-file .env.production
    -f docker-compose.prod.yml -f compose.ci.yml)

  cleanup() {
    local status=$?
    trap - EXIT
    trap '' INT TERM
    if (( status != 0 )); then
      printf 'Offline release check failed during %s (exit %s)\n' "$phase" "$status" >&2
    fi
    if (( compose_ready )); then
      "${compose[@]}" ps --all >&2 || true
      "${compose[@]}" logs --no-color --tail 100 db migrate app >&2 || true
      "${compose[@]}" down --volumes >&2 || status=1
    fi
    cd /
    rm -rf -- "$scratch" || status=1
    if (( status == 0 )); then
      printf 'Offline release verification passed: %s (linux/amd64, connected database)\n' "$GITHUB_SHA"
    fi
    exit "$status"
  }
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  tar -xzf "$1" -C "$scratch"
  shopt -s nullglob dotglob
  local entries=("$scratch"/*)
  [[ ${#entries[@]} == 1 && -d ${entries[0]} && ! -L ${entries[0]} ]] || fail 'expected one extracted package directory'
  cd -- "${entries[0]}"

  local image_archives=(images/approval-app.tar images/approval-migrate.tar images/postgres.tar)
  local images=(approval-app:latest approval-migrate:latest postgres:15-alpine)
  local required
  for required in docs/upgrade-runbook.md scripts/upgrade/precheck.sql scripts/upgrade/postcheck.sql \
    scripts/deploy.sh scripts/deploy-offline.sh scripts/backup.sh scripts/restore.sh scripts/rollback.sh \
    scripts/health-check.sh scripts/setup.sh scripts/lib/deploy-common.sh \
    VERSION docker-compose.prod.yml tools/env-check.mjs tools/lib/env.mjs "${image_archives[@]}"; do
    [[ -f $required ]] || fail "package is missing $required"
    LC_ALL=C awk -v path="$required" '
      length($1) == 64 && $1 !~ /[^0-9a-fA-F]/ &&
        substr($0, 65, 2) ~ /^ [ *]$/ && substr($0, 67) == path { count++ }
      END { exit (count != 1) }
    ' SHA256SUMS || fail "SHA256SUMS must contain one entry for $required"
  done
  sha256sum -c --strict SHA256SUMS
  # VERSION is data; only the version field holds the full SHA.
  [[ $(grep '^version=' VERSION) == "version=$GITHUB_SHA" ]] || fail 'VERSION does not match GITHUB_SHA'
  printf 'Verified archive checksums and release SHA %s\n' "$GITHUB_SHA"

  phase='image load and platform verification'
  local i loaded platform
  for i in "${!images[@]}"; do
    loaded=$(docker load --input "${image_archives[i]}")
    printf '%s\n' "$loaded"
    grep -Fxq -- "Loaded image: ${images[i]}" <<< "$loaded" || fail "archive did not load ${images[i]}"
    platform=$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "${images[i]}")
    [[ $platform == linux/amd64 ]] || fail "${images[i]} is $platform, expected linux/amd64"
  done

  phase='environment and Compose validation'
  # Do not let ambient variables override interpolation or enable optional profiles.
  unset DATABASE_URL POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB COMPOSE_PROFILES
  cat > .env.production <<'ENV'
DATABASE_URL=postgresql://ci_deploy:offline-ci-disposable-password@db:5432/app_deploy_ci?schema=public
POSTGRES_USER=ci_deploy
POSTGRES_PASSWORD=offline-ci-disposable-password
POSTGRES_DB=app_deploy_ci
AUTH_URL=https://approval-ci.example.invalid
NEXTAUTH_URL=https://approval-ci.example.invalid
NEXT_PUBLIC_APP_URL=https://approval-ci.example.invalid
AUTH_TRUST_HOST=true
NEXTAUTH_SECRET=offline-ci-disposable-auth-secret
CRON_SECRET=offline-ci-disposable-cron-secret
UPLOAD_DIR=/app/uploads
ENV
  node tools/env-check.mjs --env .env.production --template .env.production.example
  # The Postgres entrypoint uses a socket-only server while initializing a fresh volume.
  cat > compose.ci.yml <<'YAML'
services:
  db:
    container_name: !reset null
    ports: !reset []
    healthcheck:
      test: ["CMD-SHELL", 'pg_isready -h 127.0.0.1 -p 5432 -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"']
  migrate:
    container_name: !reset null
  seed:
    container_name: !reset null
  app:
    container_name: !reset null
    ports: !reset []
  studio:
    container_name: !reset null
    ports: !reset []
YAML
  # Resolve inactive profiles too, but do not enable them when starting services.
  "${compose[@]}" --profile '*' config --format json | node -e '
    const model = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
    const [project, db, migrate, app] = process.argv.slice(1);
    for (const [name, service] of Object.entries(model.services)) {
      if (service.ports?.length || service.container_name || service.network_mode) {
        throw new Error(`${name} has a port binding, fixed container name, or network override`);
      }
    }
    // Compose can start dependencies in addition to the services named on the command line.
    const startupServices = new Set(["db", "migrate", "app"]);
    for (const name of startupServices) {
      const service = model.services[name];
      if (!service) throw new Error(`Missing Compose service ${name}`);
      const dependencies = [
        ...Object.keys(service.depends_on ?? {}),
        ...(service.links ?? []).map(link => link.split(":")[0]),
        ...(service.volumes_from ?? []).filter(source => !source.startsWith("container:")).map(source => source.split(":")[0]),
        ...[service.ipc, service.pid].filter(mode => mode?.startsWith("service:")).map(mode => mode.slice(8)),
      ];
      for (const dependency of dependencies) {
        if (!startupServices.has(dependency)) {
          throw new Error(`${name} has startup dependency outside db, migrate, app: ${dependency}`);
        }
      }
    }
    for (const resources of [model.volumes, model.networks]) {
      for (const [key, resource] of Object.entries(resources ?? {})) {
        if (resource.external || resource.name !== `${project}_${key}`) {
          throw new Error(`Resource ${key} is not scoped to ${project}`);
        }
      }
    }
    if (model.services.db?.image !== db || model.services.migrate?.image !== migrate ||
        model.services.app?.image !== app) {
      throw new Error("Compose does not use the three packaged images");
    }
  ' "$project" "${images[2]}" "${images[1]}" "${images[0]}"

  phase='migration and unseeded database verification'
  compose_ready=1
  "${compose[@]}" up -d --pull never --no-build db migrate app
  local migrate_container migration_state expected applied users file
  migrate_container=$("${compose[@]}" ps --all --quiet migrate)
  [[ -n $migrate_container ]] || fail 'missing migrate container'
  migration_state=$(docker inspect --format '{{.State.Status}} {{.State.ExitCode}}' "$migrate_container")
  [[ $migration_state == 'exited 0' ]] || fail "migrate container state: $migration_state"

  query_database() {
    "${compose[@]}" exec -T db psql -X -U ci_deploy -d app_deploy_ci -At -v ON_ERROR_STOP=1 -c "$1"
  }
  expected=$(
    for file in "$checkout"/prisma/migrations/*/migration.sql; do
      file=${file%/migration.sql}
      printf '%s\n' "${file##*/}"
    done | LC_ALL=C sort
  )
  applied=$(query_database 'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name COLLATE "C";')
  if [[ -z $expected || $expected != "$applied" ]]; then
    diff -u <(printf '%s\n' "$expected") <(printf '%s\n' "$applied") >&2 || true
    fail 'applied migration names do not match the checkout'
  fi
  users=$(query_database 'SELECT count(*) FROM users;')
  [[ $users == 0 ]] || fail "expected no seed; found $users users"
  printf 'Verified migrate exit 0, all checkout migrations applied, and users count 0\n'

  wait_for_connected_app() {
    local deadline=$((SECONDS + 180)) remaining probe_timeout
    while (( (remaining = deadline - SECONDS) > 0 )); do
      probe_timeout=$((remaining < 5 ? remaining : 5))
      if timeout "${probe_timeout}s" "${compose[@]}" exec -T app node -e '
          (async () => {
            const response = await fetch("http://127.0.0.1:3000/api/health", {
              redirect: "error", signal: AbortSignal.timeout(4000)
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            process.stdout.write(await response.text());
          })().catch(() => { process.exitCode = 1; });
        ' 2>/dev/null | assert_connected_health; then
        return 0
      fi
      remaining=$((deadline - SECONDS))
      if (( remaining > 0 )); then sleep "$((remaining < 3 ? remaining : 3))"; fi
    done
    fail 'no successful /api/health response with a connected database within 180 seconds'
  }

  phase='connected app health verification'
  wait_for_connected_app

  phase='app-only rollback isolation'
  container_id() {
    local id
    id=$("${compose[@]}" ps --all --quiet "$1")
    [[ $id =~ ^[0-9a-f]{12,64}$ ]] || fail "expected exactly one $1 container"
    printf '%s\n' "$id"
  }
  dependency_state() {
    local id
    id=$(container_id "$1") || return 1
    docker inspect --format '{{.Id}} {{.State.StartedAt}} {{.State.Status}} {{.State.ExitCode}}' "$id"
  }
  migration_history() {
    query_database 'SELECT row_to_json(m)::text FROM _prisma_migrations m ORDER BY id;'
  }

  local app_before app_after db_before db_after migrate_before migrate_after history_before history_after
  app_before=$(container_id app)
  db_before=$(dependency_state db)
  migrate_before=$(dependency_state migrate)
  history_before=$(migration_history)
  (
    # Exercise exactly the recreation command used by rollback.sh, but only
    # via the validated disposable project. Do not retag any images here.
    source scripts/lib/deploy-common.sh
    compose_prod() { "${compose[@]}" "$@"; }
    recreate_app_only
  )
  wait_for_connected_app
  app_after=$(container_id app)
  db_after=$(dependency_state db)
  migrate_after=$(dependency_state migrate)
  history_after=$(migration_history)
  [[ $app_after != "$app_before" ]] || fail 'app-only rollback did not replace the app container'
  [[ $db_after == "$db_before" ]] || fail 'app-only rollback changed or restarted the database container'
  [[ $migrate_after == "$migrate_before" ]] || fail 'app-only rollback changed or restarted the migrator container'
  [[ $history_after == "$history_before" ]] || fail 'app-only rollback changed migration history'
  printf 'Verified app-only recreation without restarting db or migrate or changing migration history\n'
)

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  main "$@"
fi
