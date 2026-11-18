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
  cat > compose.ci.yml <<'YAML'
services:
  db:
    container_name: !reset null
    ports: !reset []
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

  phase='connected app health verification'
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
      exit 0
    fi
    remaining=$((deadline - SECONDS))
    if (( remaining > 0 )); then sleep "$((remaining < 3 ? remaining : 3))"; fi
  done
  fail 'no successful /api/health response with a connected database within 180 seconds'
)

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  main "$@"
fi
