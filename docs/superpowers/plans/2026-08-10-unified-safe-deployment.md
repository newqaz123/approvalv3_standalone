# Unified Safe Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one interactive, tested deployment flow that safely updates an Ubuntu VPS from GitHub or deploys a prebuilt package to an offline intranet server while preserving PostgreSQL and upload volumes.

**Architecture:** `scripts/deploy.sh` becomes the single operator entry point and delegates shared safety operations to `scripts/lib/deploy-common.sh`. Online mode pulls and builds; offline mode validates and loads a package; both use `docker-compose.prod.yml`, the same environment gate, backup, rollback-tagging, migration, verification, and reporting pipeline. `docker-compose.dev.yml` remains the sole local definition, the ambiguous `docker-compose.yml` is removed, and manager option 2 delegates to the unified script.

**Tech Stack:** Bash 3.2+ compatible shell scripts, Docker Engine, Docker Compose v2 with v1 fallback, Node.js 20 ESM utilities/tests, PostgreSQL 15, Prisma 6, Node test runner, TypeScript regression tests.

## Global Constraints

- Normal server updates run only Compose services `db migrate app`; they never run `seed`.
- Production commands always use project `approval-app`, `.env.production`, and `docker-compose.prod.yml`.
- Local development uses only `docker-compose.dev.yml`.
- Never run `docker compose down -v`, `docker volume prune`, `prisma migrate reset`, or `prisma db push`.
- Never overwrite `.env.production` or print secrets.
- Rollback tags must be captured from running container image IDs before online builds or offline image loading.
- Do not automatically roll back application images after a database migration was applied.
- Existing database and uploads Docker volume identities must be preserved.
- Dirty Git state defaults to abort; stashing requires explicit confirmation and is never automatically popped or dropped.
- Online updates require branch `main` and `git pull --ff-only origin main`.
- Offline packages must contain checksums, image archives, the production Compose file, and the unified deployment scripts.
- Production `seed` is first-install-only through the `first-install` profile.
- Historical plans remain historical; current README/deployment documentation must match tested behavior.
- Preserve unrelated untracked `.pi-subagents/` artifacts and `docs/superpowers/plans/2026-06-14-export-builder-budget-sync.md`.

---

## File Structure

### Create

- `tools/env-check.mjs` — non-interactive, secret-safe production environment validator CLI.
- `scripts/lib/deploy-common.sh` — shared Compose, backup, rollback-tagging, state capture, deployment, and verification functions.
- `tests/tools/deployment-flow.test.mjs` — behavior and source-contract tests using temporary fake executables.

### Modify

- `tools/lib/env.mjs` — HTTPS, Docker upload root, database consistency, and placeholder-secret validation.
- `tools/manage.mjs` — option 2 delegates directly to unified `deploy.sh`.
- `tools/lib/project.mjs` — remove the separate offline deploy path from manager responsibilities.
- `tests/tools/env.test.mjs` — environment failure/success coverage.
- `tests/tools/manage.test.mjs` — manager delegation and script safety contracts.
- `tests/tools/command.test.mjs` — expected manager path contract.
- `scripts/deploy.sh` — interactive online/offline entry point.
- `scripts/deploy-offline.sh` — compatibility shim to unified offline mode.
- `scripts/backup.sh` — project-aware volume resolution and machine-readable artifact summary.
- `scripts/restore.sh` — explicit production Compose/root handling when named containers are unavailable.
- `scripts/rollback.sh` — repository/package root discovery, explicit production Compose invocation, migration warning, and optional `--yes`.
- `scripts/build-package.sh` — package unified scripts/tools and generate `SHA256SUMS`.
- `scripts/setup.sh` — current unified command guidance.
- `docker-compose.prod.yml` — first-install-only seed profile.
- `.dockerignore` — exclude backups and SQL artifacts from build context.
- `tests/regression/upload-runtime-config.test.ts` — assert only dev/prod Compose contracts.
- `README.md` — accurate local, VPS, offline, and manager workflows.
- `DEPLOY.md` — authoritative online/offline server instructions and rollback limits.
- `docs/DEPLOY.md` — mirror operational safety requirements used by regression tests.
- `package.json` — add the `env:check` command and include deployment-flow tests in `test:manage`.

### Delete

- `docker-compose.yml` — remove after every live consumer is migrated.

---

### Task 1: Production Environment Gate

**Files:**

- Create: `tools/env-check.mjs`
- Modify: `tools/lib/env.mjs`
- Modify: `tools/manage.mjs`
- Modify: `tests/tools/env.test.mjs`
- Modify: `package.json`

**Interfaces:**

- Produces: `createRuntimeReport(current: Record<string, string>): { issues: string[]; warnings: string[] }`.
- Produces: `createEnvReport({ current, template })` returning `{ missingRequired: string[]; missingOptional: string[]; unknownKeys: string[]; presentRequired: string[]; originIssues: string[]; runtimeIssues: string[]; runtimeWarnings: string[] }`.
- Produces CLI: `node tools/env-check.mjs --env <path> --template <path>`; exit `0` on valid production config, exit `1` on missing/runtime/origin issues, and never print values for secret keys.
- Consumed by: Task 2 shared deployment helpers and Task 4 manager integration.

- [ ] **Step 1: Add failing HTTPS and runtime validation tests**

Append focused tests to `tests/tools/env.test.mjs`:

```js
import { createRuntimeReport } from '../../tools/lib/env.mjs'

test('createOriginReport requires one HTTPS production origin', () => {
  const report = createOriginReport({
    AUTH_URL: 'http://approval.example.com',
    NEXTAUTH_URL: 'http://approval.example.com',
    NEXT_PUBLIC_APP_URL: 'http://approval.example.com',
    AUTH_TRUST_HOST: 'true',
  })
  assert.match(report.issues.join('\n'), /HTTPS/)
})

test('createRuntimeReport accepts the Docker production contract', () => {
  const report = createRuntimeReport({
    DATABASE_URL: 'postgresql://app-user:strong-password@db:5432/app_db?schema=public',
    POSTGRES_USER: 'app-user',
    POSTGRES_PASSWORD: 'strong-password',
    POSTGRES_DB: 'app_db',
    UPLOAD_DIR: '/app/uploads',
    NEXTAUTH_SECRET: 'a-production-secret-with-32-characters',
    CRON_SECRET: 'another-production-secret-value',
  })
  assert.deepEqual(report.issues, [])
})

test('createRuntimeReport rejects unsafe Docker paths and database drift', () => {
  const report = createRuntimeReport({
    DATABASE_URL: 'postgresql://other:wrong@localhost:5432/other_db',
    POSTGRES_USER: 'postgres',
    POSTGRES_PASSWORD: 'expected',
    POSTGRES_DB: 'app_db',
    UPLOAD_DIR: 'public/uploads',
    NEXTAUTH_SECRET: 'changeme',
    CRON_SECRET: 'generate-a-random-secret',
  })
  const issues = report.issues.join('\n')
  assert.match(issues, /UPLOAD_DIR must equal \/app\/uploads/)
  assert.match(issues, /DATABASE_URL must use host db/)
  assert.match(issues, /database name must match POSTGRES_DB/)
  assert.match(issues, /user must match POSTGRES_USER/)
  assert.match(issues, /password must match POSTGRES_PASSWORD/)
  assert.match(issues, /NEXTAUTH_SECRET still uses a placeholder/)
  assert.match(issues, /CRON_SECRET still uses a placeholder/)
})
```

- [ ] **Step 2: Run the environment tests and confirm failure**

Run:

```bash
node --test tests/tools/env.test.mjs
```

Expected: FAIL because `createRuntimeReport` is not exported and HTTP non-local origins are not rejected.

- [ ] **Step 3: Implement runtime validation without exposing secrets**

Add to `tools/lib/env.mjs`:

```js
const SECRET_PLACEHOLDERS = new Set([
  'changeme',
  'generate-with-openssl-rand-base64-32',
  'generate-a-random-secret',
])

export function createRuntimeReport(current) {
  const issues = []
  const warnings = []

  if (current.UPLOAD_DIR !== '/app/uploads') {
    issues.push('UPLOAD_DIR must equal /app/uploads for Docker production')
  }

  let databaseUrl = null
  try {
    databaseUrl = new URL(current.DATABASE_URL)
  } catch {
    issues.push('DATABASE_URL must be a valid PostgreSQL URL')
  }

  if (databaseUrl) {
    const databaseName = databaseUrl.pathname.replace(/^\//, '')
    if (databaseUrl.hostname !== 'db') issues.push('DATABASE_URL must use host db')
    if (decodeURIComponent(databaseUrl.username) !== current.POSTGRES_USER) {
      issues.push('DATABASE_URL user must match POSTGRES_USER')
    }
    if (decodeURIComponent(databaseUrl.password) !== current.POSTGRES_PASSWORD) {
      issues.push('DATABASE_URL password must match POSTGRES_PASSWORD')
    }
    if (databaseName !== current.POSTGRES_DB) {
      issues.push('DATABASE_URL database name must match POSTGRES_DB')
    }
  }

  for (const key of ['NEXTAUTH_SECRET', 'CRON_SECRET']) {
    if (SECRET_PLACEHOLDERS.has(current[key])) {
      issues.push(`${key} still uses a placeholder value`)
    }
  }

  if ((current.POSTGRES_PASSWORD ?? '').length < 16) {
    warnings.push('POSTGRES_PASSWORD is shorter than 16 characters; rotate it with a coordinated database credential change')
  }

  return { issues, warnings }
}
```

Update `createOriginReport()` so each normalized production URL must use `https:`. Update `createEnvReport()` to include:

```js
const runtime = createRuntimeReport(current)
return {
  missingRequired,
  missingOptional,
  unknownKeys: Object.keys(current).filter((key) => !templateKeys.includes(key)),
  presentRequired: REQUIRED_PRODUCTION_KEYS.filter((key) => current[key]),
  originIssues: createOriginReport(current).issues,
  runtimeIssues: runtime.issues,
  runtimeWarnings: runtime.warnings,
}
```

- [ ] **Step 4: Add failing CLI exit-code and secret-redaction tests**

In `tests/tools/env.test.mjs`, spawn the new CLI in temporary directories. The failure assertion must use an actual secret sentinel and verify it is absent:

```js
const result = spawnSync(process.execPath, [
  'tools/env-check.mjs',
  '--env', envPath,
  '--template', templatePath,
], { cwd: process.cwd(), encoding: 'utf8' })

assert.equal(result.status, 1)
assert.match(result.stdout + result.stderr, /UPLOAD_DIR/)
assert.doesNotMatch(result.stdout + result.stderr, /SUPER-SECRET-SENTINEL/)
```

Add a valid fixture and assert exit `0` plus `Environment check passed`.

- [ ] **Step 5: Run the CLI tests and confirm failure**

Run:

```bash
node --test tests/tools/env.test.mjs
```

Expected: FAIL because `tools/env-check.mjs` does not exist.

- [ ] **Step 6: Implement the non-interactive CLI**

Create `tools/env-check.mjs` with exact argument behavior:

```js
#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { createEnvReport, parseEnvText } from './lib/env.mjs'

function valueAfter(flag) {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const envPath = valueAfter('--env') ?? '.env.production'
const templatePath = valueAfter('--template') ?? '.env.example'

try {
  const [currentText, templateText] = await Promise.all([
    readFile(envPath, 'utf8'),
    readFile(templatePath, 'utf8'),
  ])
  const report = createEnvReport({
    current: parseEnvText(currentText),
    template: parseEnvText(templateText),
  })
  const issues = [
    ...report.missingRequired.map((key) => `Missing required key: ${key}`),
    ...report.originIssues,
    ...report.runtimeIssues,
  ]
  for (const warning of report.runtimeWarnings) console.warn(`Warning: ${warning}`)
  if (issues.length > 0) {
    for (const issue of issues) console.error(`Environment error: ${issue}`)
    process.exitCode = 1
  } else {
    console.log('Environment check passed')
  }
} catch (error) {
  console.error(`Environment check failed: ${error?.message ?? String(error)}`)
  process.exitCode = 1
}
```

Add `"env:check": "node tools/env-check.mjs"` to `package.json`. Extend `logEnvironmentReport()` in `tools/manage.mjs` to print `runtimeIssues` and `runtimeWarnings` without printing their underlying values, so manager option 6 and the CLI report the same categories.

- [ ] **Step 7: Run focused and manager tests**

Run:

```bash
node --test tests/tools/env.test.mjs tests/tools/manage.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add tools/env-check.mjs tools/lib/env.mjs tools/manage.mjs tests/tools/env.test.mjs package.json
git commit -m "feat: add production environment deployment gate"
```

---

### Task 2: Shared Deployment Safety Library

**Files:**

- Create: `scripts/lib/deploy-common.sh`
- Create: `tests/tools/deployment-flow.test.mjs`
- Modify: `scripts/backup.sh`
- Modify: `package.json`

**Interfaces:**

- Consumes: Task 1 `node tools/env-check.mjs --env ... --template ...`.
- Produces shell functions: `detect_compose`, `compose_prod`, `run_env_gate`, `capture_running_image`, `tag_rollback_images`, `run_verified_backup`, `capture_deployment_state`, `audit_attachment_integrity`, `deploy_production_services`, `wait_for_migration`, `wait_for_health`, and `verify_preserved_state`.
- Produces backup summary lines: `DB_BACKUP_PATH=...`, `UPLOADS_BACKUP_PATH=...`, `DB_BACKUP_SHA256=...`, `UPLOADS_BACKUP_SHA256=...`.
- Consumed by: Task 3 unified deploy script and Task 5 rollback.

- [ ] **Step 1: Write failing source safety-contract tests**

Create `tests/tools/deployment-flow.test.mjs` and assert the common library contract:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(path, 'utf8')

test('deployment common library pins the production compose contract', async () => {
  const source = await read('scripts/lib/deploy-common.sh')
  assert.match(source, /COMPOSE_PROJECT_NAME="approval-app"/)
  assert.match(source, /--env-file "\$ENV_FILE"/)
  assert.match(source, /-f "\$PROD_COMPOSE_FILE"/)
  assert.match(source, /up -d db migrate app/)
  assert.doesNotMatch(source, /down -v|volume prune|migrate reset|db push/)
})

test('rollback tags come from running container image ids', async () => {
  const source = await read('scripts/lib/deploy-common.sh')
  assert.match(source, /docker inspect -f '\{\{\.Image\}\}' "\$1"/)
  assert.match(source, /capture_running_image approval-app/)
  assert.match(source, /docker image tag "\$app_image" approval-app:rollback/)
  assert.doesNotMatch(source, /docker image tag approval-app:latest approval-app:rollback/)
})
```

- [ ] **Step 2: Run the deployment-flow test and confirm failure**

Run:

```bash
node --test tests/tools/deployment-flow.test.mjs
```

Expected: FAIL because `scripts/lib/deploy-common.sh` does not exist.

- [ ] **Step 3: Implement root and Compose command discovery**

Create `scripts/lib/deploy-common.sh` beginning with Bash-safe globals and array-free Compose invocation compatible with Bash 3.2:

```bash
#!/usr/bin/env bash

COMPOSE_PROJECT_NAME="approval-app"
DEPLOY_ROOT="${DEPLOY_ROOT:-$(pwd)}"
ENV_FILE="${ENV_FILE:-$DEPLOY_ROOT/.env.production}"
if [ -f "$DEPLOY_ROOT/.env.example" ]; then
  DEFAULT_ENV_TEMPLATE="$DEPLOY_ROOT/.env.example"
else
  DEFAULT_ENV_TEMPLATE="$DEPLOY_ROOT/.env.production.example"
fi
ENV_TEMPLATE="${ENV_TEMPLATE:-$DEFAULT_ENV_TEMPLATE}"
PROD_COMPOSE_FILE="${PROD_COMPOSE_FILE:-$DEPLOY_ROOT/docker-compose.prod.yml}"
DEPLOY_STATE_FILE="${DEPLOY_STATE_FILE:-$DEPLOY_ROOT/backups/last-deployment-state.env}"

fail() { printf 'ERROR: %s\n' "$*" >&2; return 1; }

# Invoke this function as: compose_prod up -d db migrate app
compose_prod() {
  if docker compose version >/dev/null 2>&1; then
    docker compose -p "$COMPOSE_PROJECT_NAME" --env-file "$ENV_FILE" -f "$PROD_COMPOSE_FILE" "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose -p "$COMPOSE_PROJECT_NAME" --env-file "$ENV_FILE" -f "$PROD_COMPOSE_FILE" "$@"
  else
    fail 'Docker Compose is not installed'
  fi
}
```

Implement `run_env_gate()` to execute Task 1 with explicit file paths and fail before any deployment mutation.

- [ ] **Step 4: Implement backup artifact verification and summary output**

Update `scripts/backup.sh` to compute SHA-256 with `sha256sum` or `shasum -a 256`, verify both files are non-empty, and end with exactly:

```bash
printf 'DB_BACKUP_PATH=%s\n' "$DB_BACKUP_FILE"
printf 'UPLOADS_BACKUP_PATH=%s\n' "$UPLOADS_BACKUP_FILE"
printf 'DB_BACKUP_SHA256=%s\n' "$DB_SHA256"
printf 'UPLOADS_BACKUP_SHA256=%s\n' "$UPLOADS_SHA256"
```

When the app container exists but is stopped, resolve its named uploads mount with `docker inspect` before falling back to name matching. Do not select the first arbitrary `*_uploads_data` volume when more than one candidate exists; fail and list candidate names.

Implement `run_verified_backup()` in the common library to capture the four summary lines, validate paths remain inside `$DEPLOY_ROOT/backups`, and print them in the final report.

- [ ] **Step 5: Implement running-image rollback tagging**

Add:

```bash
capture_running_image() {
  docker inspect -f '{{.Image}}' "$1" 2>/dev/null || true
}

tag_rollback_images() {
  local app_image migrate_image
  app_image="$(capture_running_image approval-app)"
  migrate_image="$(capture_running_image approval-migrate)"
  if [ -n "$app_image" ]; then
    docker image inspect approval-app:rollback >/dev/null 2>&1 && \
      docker image tag approval-app:rollback approval-app:rollback-prev || true
    docker image tag "$app_image" approval-app:rollback
  fi
  if [ -n "$migrate_image" ]; then
    docker image inspect approval-migrate:rollback >/dev/null 2>&1 && \
      docker image tag approval-migrate:rollback approval-migrate:rollback-prev || true
    docker image tag "$migrate_image" approval-migrate:rollback
  fi
}
```

A missing app image is allowed only for first installation; update mode must fail.

- [ ] **Step 6: Implement state capture and preservation checks**

Capture project labels, mount source names, row counts, and physical file count without printing credentials. Store line-oriented keys such as:

```text
PRE_DB_VOLUME=approval-app_db_data
PRE_UPLOADS_VOLUME=approval-app_uploads_data
PRE_USERS=19
PRE_ATTACHMENTS=35
PRE_FILES=33
```

`verify_preserved_state()` must fail if volume identity changes or a post-deploy count is numerically lower. It permits increases during live traffic. It verifies the uploads destination equals `/app/uploads`.

Implement `audit_attachment_integrity <output-file>` as a read-only check: query attachment ID plus `filePath`, normalize leading `/`, `public/`, and `uploads/` prefixes exactly like `normalizeStoredAttachmentPath()`, and write sorted missing attachment IDs to the output file. Capture pre-deploy and post-deploy missing-ID files, report all pre-existing missing IDs, and fail only when `comm -13 pre-missing post-missing` contains a newly missing ID. Never delete a row or physical file.

- [ ] **Step 7: Implement migration and health waits**

`deploy_production_services()` must invoke exactly:

```bash
compose_prod up -d db migrate app
```

`wait_for_migration()` polls `docker inspect approval-migrate` up to 120 seconds and requires exit code `0`. `wait_for_health()` polls database/app health and `http://localhost:3000/api/health` up to 180 seconds. Neither function uses a fixed success sleep.

Record migration outcome in `$DEPLOY_STATE_FILE`, a non-secret root-owned file containing `MIGRATIONS_APPLIED=none`, `MIGRATIONS_APPLIED=applied`, or `MIGRATIONS_APPLIED=unknown`, plus old/new versions and deployment timestamp. Task 5 rollback reads this file; missing state is treated as `unknown`.

- [ ] **Step 8: Add fake-command behavior tests**

In `tests/tools/deployment-flow.test.mjs`, create a temporary `bin/` containing executable fake `docker`, `git`, and `curl` scripts that append arguments to `$COMMAND_LOG`. Spawn Bash functions with that `PATH` and assert:

```js
assert.match(log, /compose .* -p approval-app .* --env-file .* -f .*docker-compose\.prod\.yml up -d db migrate app/)
assert.match(log, /inspect -f \{\{\.Image\}\} approval-app/)
assert.doesNotMatch(log, /seed|down -v|volume prune/)
```

Add a migration exit `1` fixture and assert the shell exits non-zero before reporting success. Add attachment fixtures with one pre-existing missing path and one newly missing post-deploy path; assert the pre-existing ID is reported without repair and the newly missing ID makes verification fail.

- [ ] **Step 9: Run focused tests and shell syntax checks**

Run:

```bash
bash -n scripts/lib/deploy-common.sh scripts/backup.sh
node --test tests/tools/deployment-flow.test.mjs
npm run test:manage
```

Expected: PASS.

- [ ] **Step 10: Commit**

Update `package.json` so `test:manage` includes `tests/tools/deployment-flow.test.mjs`, then commit:

```bash
git add scripts/lib/deploy-common.sh scripts/backup.sh tests/tools/deployment-flow.test.mjs package.json
git commit -m "feat: add shared deployment safety pipeline"
```

---

### Task 3: Unified Interactive Online and Offline Deploy Entry Point

**Files:**

- Modify: `scripts/deploy.sh`
- Modify: `scripts/deploy-offline.sh`
- Modify: `tests/tools/deployment-flow.test.mjs`

**Interfaces:**

- Consumes: Task 2 functions from `scripts/lib/deploy-common.sh`.
- Produces operator CLI: `bash scripts/deploy.sh`, prompting `1. Ubuntu VPS / GitHub update`, `2. Offline intranet package`, `3. Cancel`.
- Produces internal compatibility flags: `--online` and `--offline <package-dir>` for scripts/tests only; interactive mode remains the documented user flow.
- Produces compatibility shim: `scripts/deploy-offline.sh [package-dir]` delegates to `deploy.sh --offline`.
- Consumed by: Task 4 manager and Task 6 package builder.

- [ ] **Step 1: Add failing mode-selection and online safety tests**

Extend `tests/tools/deployment-flow.test.mjs`:

```js
test('deploy entry point offers online and offline modes', async () => {
  const source = await read('scripts/deploy.sh')
  assert.match(source, /Ubuntu VPS \/ GitHub update/)
  assert.match(source, /Offline intranet package/)
  assert.match(source, /--online/)
  assert.match(source, /--offline/)
})

test('online mode requires main and fast-forward-only pull', async () => {
  const source = await read('scripts/deploy.sh')
  assert.match(source, /git pull --ff-only origin main/)
  assert.match(source, /branch.*main/i)
  assert.doesNotMatch(source, /git reset --hard|git checkout --/)
})
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run:

```bash
node --test tests/tools/deployment-flow.test.mjs
```

Expected: FAIL because the current script has no offline mode and deploys through implicit Compose.

- [ ] **Step 3: Replace `deploy.sh` with the interactive coordinator**

Use `set -Eeuo pipefail`, resolve repository root from the script directory, source `scripts/lib/deploy-common.sh`, and implement:

```bash
select_mode() {
  printf '%s\n' '1. Ubuntu VPS / GitHub update' '2. Offline intranet package' '3. Cancel'
  read -r choice
  case "$choice" in
    1) printf '%s\n' online ;;
    2) printf '%s\n' offline ;;
    3) return 2 ;;
    *) fail 'Choose 1, 2, or 3' ;;
  esac
}
```

The main sequence must be:

```text
preflight → environment gate → capture state → verified backup → rollback tags
→ online build OR offline load → production deploy → migration wait
→ health wait → preserved-state verification → report
```

Use a stage variable and `trap` to print `Deployment failed during: <stage>` without claiming rollback occurred.

- [ ] **Step 4: Implement dirty-tree choices without data loss**

Online mode checks `git status --porcelain`. When dirty, prompt:

```text
1. Abort (default)
2. Create named stash and continue
```

On choice 2 run:

```bash
git stash push --include-untracked -m "approval-deploy-$(date +%Y%m%d-%H%M%S)"
```

Do not use `--all`, so ignored `.env.production` and ignored backup files remain in place. Print the resulting stash reference and recovery command. Never call `git stash pop` or `git stash drop`.

- [ ] **Step 5: Implement online acquisition**

Require `git rev-parse --abbrev-ref HEAD` to equal `main`, then:

```bash
git fetch origin main
git pull --ff-only origin main
docker build --target runner -t approval-app:latest .
docker build --target migrator -t approval-migrate:latest .
```

Do not use `--no-cache`. Record full old/new commit hashes; validate the new hash is an ancestor of `origin/main`.

- [ ] **Step 6: Implement offline package validation and acquisition**

Offline mode requires:

```text
VERSION
SHA256SUMS
docker-compose.prod.yml
images/approval-app.tar
images/approval-migrate.tar
images/postgres.tar
scripts/deploy.sh
scripts/lib/deploy-common.sh
tools/env-check.mjs
tools/lib/env.mjs
```

Validate from the package root using `sha256sum -c SHA256SUMS` or `shasum -a 256 -c SHA256SUMS`. Load images only after Task 2 rollback tagging:

```bash
docker load -i "$package_dir/images/postgres.tar"
docker load -i "$package_dir/images/approval-migrate.tar"
docker load -i "$package_dir/images/approval-app.tar"
```

Use the package root as `DEPLOY_ROOT`. Require `.env.production` to exist there before deployment; for an update, the operator copies the existing environment file into the newly extracted package directory before running the script. The package contains only `.env.production.example`, and the deployment script never creates, replaces, or edits `.env.production`.

- [ ] **Step 7: Convert `deploy-offline.sh` into a compatibility shim**

Replace its implementation with root-safe delegation:

```bash
#!/usr/bin/env bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/deploy.sh" --offline "${1:-$(cd "$SCRIPT_DIR/.." && pwd)}"
```

If the package layout places scripts at `scripts/`, this resolves package root consistently.

- [ ] **Step 8: Add command-order and failure behavior tests**

Use the fake command harness to prove:

- rollback image inspection/tagging occurs before `docker build` and before `docker load`;
- backup occurs before image acquisition;
- failed environment validation prevents backup/build/load;
- failed build prevents Compose deployment;
- failed migration prevents success output;
- online mode never invokes offline loading;
- offline mode never invokes Git commands; and
- neither mode invokes seed or destructive volume commands.

- [ ] **Step 9: Run focused tests and syntax checks**

Run:

```bash
bash -n scripts/deploy.sh scripts/deploy-offline.sh scripts/lib/deploy-common.sh
node --test tests/tools/deployment-flow.test.mjs
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add scripts/deploy.sh scripts/deploy-offline.sh scripts/lib/deploy-common.sh tests/tools/deployment-flow.test.mjs
git commit -m "feat: unify online and offline deployments"
```

---

### Task 4: Interactive Manager Delegation

**Files:**

- Modify: `tools/manage.mjs`
- Modify: `tools/lib/project.mjs`
- Modify: `tests/tools/manage.test.mjs`
- Modify: `tests/tools/command.test.mjs`

**Interfaces:**

- Consumes: Task 3 `scripts/deploy.sh` interactive CLI.
- Produces: `updateExistingInstall()` delegates once to `paths.scripts.deploy`; deployment script owns source choice, backup, environment gate, and health verification.
- Removes: manager dependency on `paths.scripts.offlineDeploy`.

- [ ] **Step 1: Write a failing manager delegation test**

Add dependency injection to the planned call and test exact behavior:

```js
test('updateExistingInstall delegates the complete update to deploy.sh once', async () => {
  const { updateExistingInstall } = await import('../../tools/manage.mjs')
  const paths = { scripts: { deploy: '/repo/scripts/deploy.sh' } }
  const calls = []
  await updateExistingInstall({
    paths,
    log: () => {},
    run: async (script, args, options) => calls.push({ script, args, paths: options.paths }),
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].script, '/repo/scripts/deploy.sh')
  assert.deepEqual(calls[0].args, [])
  assert.equal(calls[0].paths, paths)
})
```

Implement this test without comparing function identity: assert call count, script path, and empty args separately.

- [ ] **Step 2: Run the manager tests and confirm failure**

Run:

```bash
node --test tests/tools/manage.test.mjs tests/tools/command.test.mjs
```

Expected: FAIL because `updateExistingInstall()` currently asks for the source, runs backup itself, and runs health itself.

- [ ] **Step 3: Simplify manager update ownership**

Change the function signature to:

```js
export async function updateExistingInstall({
  paths = defaultPaths,
  log = console.log,
  run = runScript,
} = {}) {
  log('\nStarting unified deployment workflow.')
  await run(paths.scripts.deploy, [], { paths, log })
}
```

Remove the duplicate update-source prompt, backup call, offline dispatch, and post-health call. Remove `offlineDeploy` from `resolveManagerPaths()` and its path test. Keep standalone backup, restore, health, and rollback menu options unchanged.

- [ ] **Step 4: Update manager source-contract tests**

Replace old assertions that `deploy.sh` pulls the current arbitrary branch. Assert the manager delegates to the unified script and the unified script enforces `main`.

- [ ] **Step 5: Run manager tests**

Run:

```bash
npm run test:manage
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tools/manage.mjs tools/lib/project.mjs tests/tools/manage.test.mjs tests/tools/command.test.mjs
git commit -m "refactor: route manager updates through unified deploy"
```

---

### Task 5: Production Compose and Rollback Hardening

**Files:**

- Modify: `docker-compose.prod.yml`
- Modify: `scripts/rollback.sh`
- Modify: `scripts/restore.sh`
- Modify: `tests/tools/deployment-flow.test.mjs`
- Modify: `tests/regression/upload-runtime-config.test.ts`

**Interfaces:**

- Consumes: Task 2 `compose_prod` and rollback tags.
- Produces: `seed` service available only with `--profile first-install`.
- Produces CLI: `bash scripts/rollback.sh [--yes]`; works from source checkout and offline package layout.

- [ ] **Step 1: Write failing seed-profile and rollback-root tests**

Add:

```js
test('production seed is first-install only', async () => {
  const compose = await read('docker-compose.prod.yml')
  const seedBlock = compose.slice(compose.indexOf('  seed:'), compose.indexOf('  app:'))
  assert.match(seedBlock, /profiles:\s*\n\s*- first-install/)
})

test('rollback resolves the project root and explicit production compose contract', async () => {
  const source = await read('scripts/rollback.sh')
  assert.match(source, /PROJECT_ROOT=/)
  assert.match(source, /-p approval-app/)
  assert.match(source, /--env-file .*\.env\.production/)
  assert.match(source, /-f .*docker-compose\.prod\.yml/)
  assert.match(source, /--yes/)
})
```

Update `tests/regression/upload-runtime-config.test.ts` to inspect only `docker-compose.dev.yml` and `docker-compose.prod.yml`.

- [ ] **Step 2: Run focused tests and confirm failure**

Run:

```bash
node --test tests/tools/deployment-flow.test.mjs
npx tsx --test tests/regression/upload-runtime-config.test.ts
```

Expected: FAIL because seed has no profile and rollback changes into the scripts directory.

- [ ] **Step 3: Put seed behind the first-install profile**

Add under `seed`:

```yaml
profiles:
  - first-install
```

Normal `up -d db migrate app` must not start seed. Document first installation as:

```bash
docker compose -p approval-app --env-file .env.production \
  -f docker-compose.prod.yml --profile first-install run --rm seed
```

- [ ] **Step 4: Rebuild rollback around explicit roots and production Compose**

Resolve layout using:

```bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/../docker-compose.prod.yml" ]; then
  PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
elif [ -f "$SCRIPT_DIR/docker-compose.prod.yml" ]; then
  PROJECT_ROOT="$SCRIPT_DIR"
else
  echo 'Cannot locate docker-compose.prod.yml' >&2
  exit 1
fi
```

Use `$PROJECT_ROOT/.env.production`, `-p approval-app`, and the production Compose path. Support `--yes` while preserving the interactive confirmation by default. Apply the same root and explicit production Compose resolution to `scripts/restore.sh` for its container-absent startup and Compose fallback paths; it must never rely on deleted `docker-compose.yml`.

Before retagging, read `$PROJECT_ROOT/backups/last-deployment-state.env` without sourcing it: extract only the exact `MIGRATIONS_APPLIED=` line and accept values `none`, `applied`, or `unknown`. Missing, malformed, or duplicate values become `unknown`. Print that state. If it is not `none`, require the operator to type `ROLLBACK APP ONLY`; `--yes` must not bypass this migration compatibility gate.

- [ ] **Step 5: Back up through the canonical backup script**

Replace rollback's database-only backup with:

```bash
DB_CONTAINER=approval-db APP_CONTAINER=approval-app \
  bash "$PROJECT_ROOT/scripts/backup.sh"
```

For offline packages, package `scripts/backup.sh` at the same relative location. Abort rollback if backup fails.

- [ ] **Step 6: Add fake-command rollback tests**

Assert:

- `--yes` skips only the ordinary confirmation;
- migration-warning confirmation remains required;
- rollback uses `approval-app:rollback` and preserves `approval-app:failed`;
- Compose recreates only `app`;
- explicit project/env/compose arguments are present; and
- backup runs before retagging.

- [ ] **Step 7: Validate Compose and tests**

Run:

```bash
bash -n scripts/rollback.sh scripts/restore.sh
docker compose --env-file .env.example -f docker-compose.prod.yml config --quiet
node --test tests/tools/deployment-flow.test.mjs
npx tsx --test tests/regression/upload-runtime-config.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add docker-compose.prod.yml scripts/rollback.sh scripts/restore.sh tests/tools/deployment-flow.test.mjs tests/regression/upload-runtime-config.test.ts
git commit -m "fix: harden production seed and rollback paths"
```

---

### Task 6: Offline Package Contract

**Files:**

- Modify: `scripts/build-package.sh`
- Modify: `scripts/setup.sh`
- Modify: `tests/tools/deployment-flow.test.mjs`
- Modify: `.dockerignore`

**Interfaces:**

- Consumes: Tasks 1–5 deployment scripts, environment checker, Compose file, and rollback flow.
- Produces package layout with `scripts/`, `scripts/lib/`, `tools/`, `images/`, `VERSION`, `SHA256SUMS`, `docker-compose.prod.yml`, `.env.production.example`, and operator docs.

- [ ] **Step 1: Write failing package-content and Docker-context tests**

Add source-contract assertions:

```js
test('offline package includes unified deployment files and checksums', async () => {
  const source = await read('scripts/build-package.sh')
  assert.match(source, /scripts\/deploy\.sh/)
  assert.match(source, /scripts\/lib\/deploy-common\.sh/)
  assert.match(source, /tools\/env-check\.mjs/)
  assert.match(source, /tools\/lib\/env\.mjs/)
  assert.match(source, /SHA256SUMS/)
  assert.doesNotMatch(source, /Run: bash deploy-offline\.sh/)
})

test('docker build context excludes operational backups', async () => {
  const source = await read('.dockerignore')
  assert.match(source, /^backups\/$/m)
  assert.match(source, /^\*\.sql$/m)
})
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run:

```bash
node --test tests/tools/deployment-flow.test.mjs
```

Expected: FAIL because package builder does not include unified helpers/checksums and backups are not ignored.

- [ ] **Step 3: Package the unified directory structure**

Create package directories:

```bash
mkdir -p "$PACKAGE_DIR/images" "$PACKAGE_DIR/scripts/lib" "$PACKAGE_DIR/tools/lib"
```

Copy:

```bash
cp "$PROJECT_DIR/scripts/deploy.sh" "$PACKAGE_DIR/scripts/"
cp "$PROJECT_DIR/scripts/deploy-offline.sh" "$PACKAGE_DIR/scripts/"
cp "$PROJECT_DIR/scripts/backup.sh" "$PACKAGE_DIR/scripts/"
cp "$PROJECT_DIR/scripts/restore.sh" "$PACKAGE_DIR/scripts/"
cp "$PROJECT_DIR/scripts/rollback.sh" "$PACKAGE_DIR/scripts/"
cp "$PROJECT_DIR/scripts/health-check.sh" "$PACKAGE_DIR/scripts/"
cp "$PROJECT_DIR/scripts/setup.sh" "$PACKAGE_DIR/scripts/"
cp "$PROJECT_DIR/scripts/lib/deploy-common.sh" "$PACKAGE_DIR/scripts/lib/"
cp "$PROJECT_DIR/tools/env-check.mjs" "$PACKAGE_DIR/tools/"
cp "$PROJECT_DIR/tools/lib/env.mjs" "$PACKAGE_DIR/tools/lib/"
```

Keep production Compose, environment example, deployment guide, and version metadata at package root.

- [ ] **Step 4: Generate package checksums**

Add portable helpers and an internal test-only checksum mode:

```bash
checksum_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1"
  else
    shasum -a 256 "$1"
  fi
}

write_package_checksums() {
  local root="$1"
  (
    cd "$root"
    {
      find images scripts tools -type f -print
      printf '%s\n' docker-compose.prod.yml VERSION
    } | LC_ALL=C sort | while IFS= read -r file; do
      checksum_file "$file"
    done > SHA256SUMS
  )
}

if [ "${1:-}" = "--checksums-only" ]; then
  write_package_checksums "$2"
  exit 0
fi
```

Call `write_package_checksums "$PACKAGE_DIR"` after all files are copied and before compression. In `tests/tools/deployment-flow.test.mjs`, create a temporary miniature package with the required directories/files, run `bash scripts/build-package.sh --checksums-only <fixture>`, then run `sha256sum -c SHA256SUMS` from the fixture and assert exit `0`.

- [ ] **Step 5: Update package quick-start and setup output**

Package README must say:

```text
1. Extract the package on the server.
2. Copy .env.production.example to .env.production and set production values.
3. Run: bash scripts/deploy.sh
4. Choose: Offline intranet package.
```

Update `scripts/setup.sh` to point to the same command and remove guidance that implies a bind-mounted `uploads/` directory is the production persistence mechanism.

- [ ] **Step 6: Exclude backup artifacts from Docker builds**

Add to `.dockerignore`:

```text
backups/
*.sql
*.sql.gz
```

Keep the existing `.env*` rule; do not add a redundant environment-backup pattern.

- [ ] **Step 7: Run package/source tests and shell checks**

Run:

```bash
bash -n scripts/build-package.sh scripts/setup.sh
node --test tests/tools/deployment-flow.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add scripts/build-package.sh scripts/setup.sh tests/tools/deployment-flow.test.mjs .dockerignore
git commit -m "feat: package the unified offline deployment flow"
```

---

### Task 7: Retire Ambiguous Compose and Correct Operator Documentation

**Files:**

- Delete: `docker-compose.yml`
- Modify: `README.md`
- Modify: `DEPLOY.md`
- Modify: `docs/DEPLOY.md`
- Modify: `tests/tools/deployment-flow.test.mjs`
- Modify: `tests/regression/upload-runtime-config.test.ts`

**Interfaces:**

- Consumes: Tasks 1–6 final operator commands.
- Produces: two live Compose modes only—development and production—with no current script or documentation reference to deleted `docker-compose.yml`.

- [ ] **Step 1: Add a failing live-reference test**

Add:

```js
import { existsSync } from 'node:fs'

test('only explicit development and production compose files remain live', async () => {
  assert.equal(existsSync('docker-compose.yml'), false)
  for (const path of [
    'README.md',
    'DEPLOY.md',
    'docs/DEPLOY.md',
    'scripts/deploy.sh',
    'scripts/rollback.sh',
    'scripts/backup.sh',
    'scripts/restore.sh',
    'scripts/setup.sh',
  ]) {
    assert.doesNotMatch(await read(path), /docker-compose\.yml/)
  }
})
```

Historical files under `docs/superpowers/plans/` are deliberately excluded.

- [ ] **Step 2: Run the test and confirm failure**

Run:

```bash
node --test tests/tools/deployment-flow.test.mjs
```

Expected: FAIL because `docker-compose.yml` exists and current documentation references it.

- [ ] **Step 3: Rewrite README deployment entry points**

Replace the generic `docker compose up -d` production instructions with:

```bash
bash scripts/deploy.sh
```

Document:

- development: `docker compose -f docker-compose.dev.yml up -d`;
- manager: `npm run manage`, option 2, then choose online/offline in `deploy.sh`;
- routine VPS update from `main`;
- offline package update;
- preservation of `.env.production`, database volume, uploads volume, and backups;
- dirty-tree named stash recovery; and
- first-install seed profile only.

Correct the repository tree description so `docker-compose.prod.yml` is production and `docker-compose.dev.yml` is development.

- [ ] **Step 4: Update deployment guides**

Make `DEPLOY.md` and `docs/DEPLOY.md` use explicit project/env/compose commands. Document that routine updates start only `db migrate app`, rollback does not reverse migrations, and production URL variables must share one HTTPS origin.

Replace unsafe generic commands such as:

```bash
docker compose -f docker-compose.prod.yml up -d
```

with either the unified script or explicit `db migrate app`. Keep the first-install seed command separate and profile-gated.

- [ ] **Step 5: Delete the ambiguous Compose file**

```bash
git rm docker-compose.yml
```

Update any non-historical tests that read it. Do not rewrite historical plans solely to remove historical references.

- [ ] **Step 6: Prove no live consumer remains**

Run:

```bash
rg 'docker-compose\.yml' README.md DEPLOY.md docs/DEPLOY.md scripts tools tests package.json start-dev.sh
```

Expected: no matches. References to `docker-compose.dev.yml` and `docker-compose.prod.yml` remain valid because the pattern above matches only the exact default filename.

- [ ] **Step 7: Run documentation and Compose tests**

Run:

```bash
node --test tests/tools/deployment-flow.test.mjs
npx tsx --test tests/regression/upload-runtime-config.test.ts
docker compose -f docker-compose.dev.yml config --quiet
docker compose --env-file .env.example -f docker-compose.prod.yml config --quiet
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add README.md DEPLOY.md docs/DEPLOY.md tests/tools/deployment-flow.test.mjs tests/regression/upload-runtime-config.test.ts
git add -u docker-compose.yml
git commit -m "docs: standardize development and production compose flows"
```

---

### Task 8: Full Deployment Verification and Graph Refresh

**Files:**

- Modify only if generated and tracked: `graphify-out/*`
- No production environment or production data changes.

**Interfaces:**

- Consumes: complete implementation from Tasks 1–7.
- Produces: release evidence for shell syntax, Node tests, regression tests, type checking, build, Compose validation, disposable volume persistence, and graph freshness.

- [ ] **Step 1: Run every shell syntax check**

Run:

```bash
bash -n scripts/*.sh scripts/lib/*.sh
```

Expected: exit `0`.

- [ ] **Step 2: Run deployment and manager tests**

Run:

```bash
node --test tests/tools/command.test.mjs tests/tools/env.test.mjs tests/tools/manage.test.mjs tests/tools/deployment-flow.test.mjs
```

Expected: all pass.

- [ ] **Step 3: Run the repository verification suite**

Run:

```bash
npm run check
```

Expected: all TypeScript, manager, and regression checks pass.

- [ ] **Step 4: Validate both Compose definitions**

Run:

```bash
docker compose -f docker-compose.dev.yml config --quiet
docker compose --env-file .env.example -f docker-compose.prod.yml config --quiet
```

Expected: both exit `0`. Additionally run `docker compose --env-file .env.example -f docker-compose.prod.yml config --services` and assert `seed` is absent; rerun with `--profile first-install` and assert `seed` is present.

- [ ] **Step 5: Run the production build**

Run:

```bash
npm run build
```

Expected: exit `0`. Record existing warnings separately; no new deployment-related warning is accepted.

- [ ] **Step 6: Run a disposable volume persistence smoke test**

Use unique test resources only:

```bash
TEST_PROJECT="approval-deploy-test-$$"
DB_VOLUME="${TEST_PROJECT}_db_data"
UPLOAD_VOLUME="${TEST_PROJECT}_uploads_data"
docker volume create "$DB_VOLUME"
docker volume create "$UPLOAD_VOLUME"
docker run --rm -v "$DB_VOLUME:/var/lib/postgresql/data" alpine:3.20 sh -c 'printf persisted > /var/lib/postgresql/data/probe.txt'
docker run --rm -v "$UPLOAD_VOLUME:/app/uploads" alpine:3.20 sh -c 'printf persisted > /app/uploads/probe.txt'
docker run --rm -v "$DB_VOLUME:/var/lib/postgresql/data:ro" alpine:3.20 test -s /var/lib/postgresql/data/probe.txt
docker run --rm -v "$UPLOAD_VOLUME:/app/uploads:ro" alpine:3.20 test -s /app/uploads/probe.txt
docker volume rm "$UPLOAD_VOLUME" "$DB_VOLUME"
```

Expected: exit `0`. Use a trap to remove disposable resources on failure. Never reference `approval-app_db_data` or `approval-app_uploads_data` in this test.

- [ ] **Step 7: Verify repository hygiene**

Run:

```bash
git diff --check
git status --short
```

Expected: only intended deployment changes plus preserved unrelated untracked files. No `.env.production`, backup archive, SQL dump, or generated image archive is staged.

- [ ] **Step 8: Refresh Graphify**

Run:

```bash
graphify update .
```

Expected: graph refresh completes. Commit graph outputs only if they are tracked and changed intentionally.

- [ ] **Step 9: Request focused code review**

Review must verify:

- destructive command absence;
- rollback image ordering;
- offline package ordering;
- environment secret redaction;
- production Compose explicitness;
- seed isolation;
- dirty-tree preservation;
- migration rollback warning; and
- no production access or data mutation occurred.

- [ ] **Step 10: Commit final generated graph changes if needed**

```bash
git add graphify-out
git commit -m "chore: refresh deployment workflow graph"
```

Skip this commit when Graphify produces no tracked changes.
