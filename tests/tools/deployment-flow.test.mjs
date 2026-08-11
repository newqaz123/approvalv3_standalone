import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'

const root = resolve('.')
const read = (path) => readFile(path, 'utf8')

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

async function fakeBin() {
  const dir = await mkdtemp(join(tmpdir(), 'deployment-flow-'))
  const bin = join(dir, 'bin')
  await mkdir(bin)
  for (const [fixture, command] of [['fake-docker.sh', 'docker'], ['fake-git.sh', 'git'], ['fake-curl.sh', 'curl'], ['fake-chown.sh', 'chown'], ['fake-stat.sh', 'stat']]) {
    await copyFile(join(root, 'tests/tools/fixtures', fixture), join(bin, command))
    await chmod(join(bin, command), 0o755)
  }
  return { dir, bin, log: join(dir, 'commands.log') }
}

function runShell(script, env, options = {}) {
  return spawnSync('/bin/bash', ['-c', script], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    ...options,
  })
}

test('fake command deployment uses pinned compose and running image inspection', async () => {
  const fixture = await fakeBin()
  const result = runShell(
    'source scripts/lib/deploy-common.sh; compose_prod up -d db migrate app; tag_rollback_images',
    {
      PATH: `${fixture.bin}:${process.env.PATH}`,
      COMMAND_LOG: fixture.log,
      ENV_FILE: '/tmp/.env.production',
      PROD_COMPOSE_FILE: '/tmp/docker-compose.prod.yml',
    },
  )
  assert.equal(result.status, 0, result.stderr)
  const log = await readFile(fixture.log, 'utf8')
  assert.match(log, /compose\s+-p approval-app\s+--env-file .*\.env\.production\s+-f .*docker-compose\.prod\.yml up -d db migrate app/)
  assert.match(log, /inspect -f \{\{\.Image\}\} approval-app/)
  assert.doesNotMatch(log, /seed|down -v|volume prune/)
})

async function installValidGate(rootDir) {
  await mkdir(join(rootDir, 'tools/lib'), { recursive: true })
  await copyFile(join(root, 'tools/env-check.mjs'), join(rootDir, 'tools/env-check.mjs'))
  await copyFile(join(root, 'tools/lib/env.mjs'), join(rootDir, 'tools/lib/env.mjs'))
  const env = [
    'DATABASE_URL=postgresql://deployuser:deploypassword123456@db/app_db',
    'AUTH_URL=https://approval.example.com',
    'AUTH_TRUST_HOST=true',
    'NEXTAUTH_URL=https://approval.example.com',
    'NEXTAUTH_SECRET=secret-value-for-tests-only',
    'NEXT_PUBLIC_APP_URL=https://approval.example.com',
    'UPLOAD_DIR=/app/uploads',
    'CRON_SECRET=cron-value-for-tests-only',
    'POSTGRES_USER=deployuser',
    'POSTGRES_PASSWORD=deploypassword123456',
    'POSTGRES_DB=app_db',
  ].join('\n') + '\n'
  await writeFile(join(rootDir, '.env.production'), env)
  await writeFile(join(rootDir, '.env.example'), env)
  await writeFile(join(rootDir, 'docker-compose.prod.yml'), 'services: {}\n')
}

async function installDeployRoot(rootDir) {
  await installValidGate(rootDir)
  await mkdir(join(rootDir, 'scripts/lib'), { recursive: true })
  await copyFile(join(root, 'scripts/deploy.sh'), join(rootDir, 'scripts/deploy.sh'))
  await copyFile(join(root, 'scripts/lib/deploy-common.sh'), join(rootDir, 'scripts/lib/deploy-common.sh'))
  await writeFile(join(rootDir, 'scripts/backup.sh'), `#!/usr/bin/env bash\nset -eu\nmkdir -p "$BACKUP_DIR"\necho backup >>"$COMMAND_LOG"\nprintf x >"$BACKUP_DIR/db.sql"\nprintf x >"$BACKUP_DIR/uploads.tar.gz"\nprintf 'DB_BACKUP_PATH=%s\\nUPLOADS_BACKUP_PATH=%s\\nDB_BACKUP_SHA256=x\\nUPLOADS_BACKUP_SHA256=x\\n' "$DEPLOY_ROOT/backups/db.sql" "$DEPLOY_ROOT/backups/uploads.tar.gz"\n`)
  await chmod(join(rootDir, 'scripts/backup.sh'), 0o755)
  await writeFile(join(rootDir, 'Dockerfile'), 'FROM scratch\n')
}

async function installOfflinePackage(rootDir, checksum = true) {
  await installDeployRoot(rootDir)
  await mkdir(join(rootDir, 'images'))
  for (const image of ['approval-app.tar', 'approval-migrate.tar', 'postgres.tar']) await writeFile(join(rootDir, 'images', image), 'fake-image')
  await writeFile(join(rootDir, 'VERSION'), 'VERSION=1.0.0\n')
  const files = ['VERSION', 'docker-compose.prod.yml', 'images/approval-app.tar', 'images/approval-migrate.tar', 'images/postgres.tar', 'scripts/deploy.sh', 'scripts/lib/deploy-common.sh', 'tools/env-check.mjs', 'tools/lib/env.mjs']
  const sums = checksum ? execFileSync('sha256sum', files, { cwd: rootDir, encoding: 'utf8' }) : `${'0'.repeat(64)}  VERSION\n`
  await writeFile(join(rootDir, 'SHA256SUMS'), sums)
}

function runDeployment(script, args, env, cwd) {
  return spawnSync('/bin/bash', [script, ...args], { cwd, env: { ...process.env, ...env }, encoding: 'utf8' })
}

test('main online path proves rollback, build, deploy, migration, and health order', async () => {
  const fixture = await fakeBin()
  const deployRoot = join(fixture.dir, 'online-root')
  await installDeployRoot(deployRoot)
  const result = runDeployment(join(root, 'scripts/deploy.sh'), ['--online'], {
    PATH: `${fixture.bin}:${process.env.PATH}`, COMMAND_LOG: fixture.log, DEPLOY_ROOT: deployRoot, APP_CONTAINER_MISSING: '1',
  }, fixture.dir)
  assert.equal(result.status, 0, result.stderr)
  const log = await readFile(fixture.log, 'utf8')
  assert.match(log, /build.*compose.*migrate.*State.Health.Status/s)
  assert.doesNotMatch(log, /seed|down -v|volume prune/)
})

test('main offline checksum failure identifies checksum and stops before load or backup', async () => {
  const fixture = await fakeBin()
  const deployRoot = join(fixture.dir, 'offline-root')
  await installOfflinePackage(deployRoot, false)
  const result = runDeployment(join(root, 'scripts/deploy.sh'), ['--offline', deployRoot], {
    PATH: `${fixture.bin}:${process.env.PATH}`, COMMAND_LOG: fixture.log, DEPLOY_ROOT: deployRoot, APP_CONTAINER_MISSING: '1',
  }, fixture.dir)
  assert.notEqual(result.status, 0)
  assert.match(`${result.stdout}\\n${result.stderr}`, /FAILED|checksum/i)
  const log = await readFile(fixture.log, 'utf8')
  assert.doesNotMatch(log, /load|backup|build/)
})

test('main offline path never invokes Git or network commands', async () => {
  const fixture = await fakeBin()
  const deployRoot = join(fixture.dir, 'offline-root')
  await installOfflinePackage(deployRoot)
  const result = runDeployment(join(root, 'scripts/deploy.sh'), ['--offline', deployRoot], {
    PATH: `${fixture.bin}:${process.env.PATH}`, COMMAND_LOG: fixture.log, DEPLOY_ROOT: deployRoot, APP_CONTAINER_MISSING: '1',
  }, fixture.dir)
  assert.equal(result.status, 0, result.stderr)
  const log = await readFile(fixture.log, 'utf8')
  assert.doesNotMatch(log, /\bgit\b|\bfetch\b|\bpull\b/)
})

test('main migration failure stops health and success without automatic rollback', async () => {
  const fixture = await fakeBin()
  const deployRoot = join(fixture.dir, 'offline-root')
  await installOfflinePackage(deployRoot)
  const result = runDeployment(join(root, 'scripts/deploy.sh'), ['--offline', deployRoot], {
    PATH: `${fixture.bin}:${process.env.PATH}`, COMMAND_LOG: fixture.log, DEPLOY_ROOT: deployRoot,
    MIGRATE_EXIT_CODE: '1', MIGRATE_STATE: 'exited', MIGRATION_TIMEOUT_SECONDS: '1', APP_CONTAINER_MISSING: '1',
  }, fixture.dir)
  assert.notEqual(result.status, 0)
  const log = await readFile(fixture.log, 'utf8')
  assert.match(log, /MIGRATION_COMMAND_REACHED/)
  const postMigration = log.slice(log.indexOf('MIGRATION_COMMAND_REACHED'))
  assert.doesNotMatch(postMigration, /health|healthy|Deployment succeeded|rollback/)
})

test('main missing app with partial or complete data volumes fails closed', async () => {
  const fixture = await fakeBin()
  for (const volumes of ['db_data', 'uploads_data', 'db_data\\nuploads_data']) {
    const deployRoot = join(fixture.dir, `offline-${volumes.replace('\\n', '-')}`)
    await installOfflinePackage(deployRoot)
    const result = runDeployment(join(root, 'scripts/deploy.sh'), ['--offline', deployRoot], {
      PATH: `${fixture.bin}:${process.env.PATH}`, COMMAND_LOG: fixture.log, DEPLOY_ROOT: deployRoot,
      APP_CONTAINER_MISSING: '1', DOCKER_VOLUMES: volumes,
    }, fixture.dir)
    assert.notEqual(result.status, 0, `volumes=${volumes}`)
  }
})

test('main online invocation from another cwd targets resolved deployment root', async () => {
  const fixture = await fakeBin()
  const deployRoot = join(fixture.dir, 'online-root')
  await installDeployRoot(deployRoot)
  const result = runDeployment(join(root, 'scripts/deploy.sh'), ['--online'], {
    PATH: `${fixture.bin}:${process.env.PATH}`, COMMAND_LOG: fixture.log, DEPLOY_ROOT: deployRoot, APP_CONTAINER_MISSING: '1',
  }, fixture.dir)
  assert.equal(result.status, 0, result.stderr)
  const log = await readFile(fixture.log, 'utf8')
  assert.match(log, new RegExp(`git -C ${deployRoot.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}`))
})

test('migration failure reaches the fake migration command and is terminal', async () => {
  const fixture = await fakeBin()
  const gateRoot = join(fixture.dir, 'deployment-root')
  await installValidGate(gateRoot)
  const result = runShell(
    'set -e; source scripts/lib/deploy-common.sh; deploy_production_services; wait_for_migration',
    {
      PATH: `${fixture.bin}:${process.env.PATH}`,
      COMMAND_LOG: fixture.log,
      DEPLOY_ROOT: gateRoot,
      ENV_FILE: join(gateRoot, '.env.production'),
      ENV_TEMPLATE: join(gateRoot, '.env.example'),
      PROD_COMPOSE_FILE: join(gateRoot, 'docker-compose.prod.yml'),
      DEPLOY_STATE_FILE: join(fixture.dir, 'state.env'),
      COMPOSE_UP_EXIT: '0',
      MIGRATE_EXIT_CODE: '1',
      MIGRATE_STATE: 'exited',
      MIGRATION_TIMEOUT_SECONDS: '1',
    },
  )
  assert.notEqual(result.status, 0)
  const log = await readFile(fixture.log, 'utf8')
  assert.match(log, /MIGRATION_COMMAND_REACHED/)
  assert.match(`${result.stdout}\n${result.stderr}`, /Migration container exited with code 1/)
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /Migration succeeded|deployment succeeded/i)
})

test('successful migration cannot report success when durable state ownership fails', async () => {
  const fixture = await fakeBin()
  const result = runShell(
    'source scripts/lib/deploy-common.sh; wait_for_migration',
    {
      PATH: `${fixture.bin}:${process.env.PATH}`,
      COMMAND_LOG: fixture.log,
      DEPLOY_STATE_FILE: join(fixture.dir, 'ownership-failure-state'),
      MIGRATE_EXIT_CODE: '0',
      MIGRATE_STATE: 'exited',
      CHOWN_EXIT: '1',
    },
  )
  assert.notEqual(result.status, 0)
  assert.match(`${result.stdout}\n${result.stderr}`, /root-owned|root ownership/i)
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /Migration succeeded|deployment succeeded/i)
})

test('backup containment rejects an existing artifact outside after canonicalization', async () => {
  const fixture = await fakeBin()
  const backup = join(fixture.dir, 'backups')
  const outside = join(fixture.dir, 'outside.sql')
  await mkdir(backup)
  await writeFile(outside, 'non-empty')
  const result = runShell(
    'source scripts/lib/deploy-common.sh; path_in_backup_dir "$DEPLOY_ROOT/backups/../outside.sql" "$DEPLOY_ROOT/backups"',
    { DEPLOY_ROOT: fixture.dir, PATH: `${fixture.bin}:${process.env.PATH}`, CHOWN_EXIT: '0' },
  )
  assert.notEqual(result.status, 0)
})

test('state capture fails closed for query and file-count probe errors', async () => {
  const fixture = await fakeBin()
  const queryFailure = runShell(
    'source scripts/lib/deploy-common.sh; capture_deployment_state "$STATE_FILE"',
    { PATH: `${fixture.bin}:${process.env.PATH}`, STATE_FILE: join(fixture.dir, 'query-state'), QUERY_FAILURE: '1' },
  )
  assert.notEqual(queryFailure.status, 0)
  const fileFailure = runShell(
    'source scripts/lib/deploy-common.sh; capture_deployment_state "$STATE_FILE"',
    { PATH: `${fixture.bin}:${process.env.PATH}`, STATE_FILE: join(fixture.dir, 'file-state'), FILES_FAILURE: '1' },
  )
  assert.notEqual(fileFailure.status, 0)
})

test('state capture rejects malformed non-negative integer probe results', async () => {
  const fixture = await fakeBin()
  const queryResult = runShell(
    'source scripts/lib/deploy-common.sh; capture_deployment_state "$STATE_FILE"',
    { PATH: `${fixture.bin}:${process.env.PATH}`, STATE_FILE: join(fixture.dir, 'malformed-query-state'), USERS_COUNT: '-1' },
  )
  assert.notEqual(queryResult.status, 0)
  const fileResult = runShell(
    'source scripts/lib/deploy-common.sh; capture_deployment_state "$STATE_FILE"',
    { PATH: `${fixture.bin}:${process.env.PATH}`, STATE_FILE: join(fixture.dir, 'malformed-file-state'), FILES_COUNT: '3x' },
  )
  assert.notEqual(fileResult.status, 0)
})

test('attachment audit distinguishes empty success from query failure', async () => {
  const fixture = await fakeBin()
  const emptyOutput = join(fixture.dir, 'empty-missing.txt')
  let result = runShell(
    'source scripts/lib/deploy-common.sh; audit_attachment_integrity "$OUTPUT"',
    { PATH: `${fixture.bin}:${process.env.PATH}`, OUTPUT: emptyOutput, ATTACHMENT_ROWS_FILE: '' },
  )
  assert.equal(result.status, 0, result.stderr)
  assert.equal(await readFile(emptyOutput, 'utf8'), '')
  result = runShell(
    'source scripts/lib/deploy-common.sh; audit_attachment_integrity "$OUTPUT"',
    { PATH: `${fixture.bin}:${process.env.PATH}`, OUTPUT: join(fixture.dir, 'failed-missing.txt'), ATTACHMENT_QUERY_FAILURE: '1' },
  )
  assert.notEqual(result.status, 0)
})

test('state capture refuses to continue when root ownership cannot be guaranteed', async () => {
  const fixture = await fakeBin()
  const result = runShell(
    'source scripts/lib/deploy-common.sh; capture_deployment_state "$STATE_FILE"',
    { PATH: `${fixture.bin}:${process.env.PATH}`, STATE_FILE: join(fixture.dir, 'ownership-state'), CHOWN_EXIT: '1' },
  )
  assert.notEqual(result.status, 0)
  assert.match(`${result.stdout}\n${result.stderr}`, /root-owned|root ownership/i)
})

test('attachment audit reports existing gaps and blocks newly missing paths', async () => {
  const fixture = await fakeBin()
  const rows = join(fixture.dir, 'rows.txt')
  const pre = join(fixture.dir, 'pre-missing.txt')
  const post = join(fixture.dir, 'post-missing.txt')
  await writeFile(rows, 'old-id|public/uploads/old.pdf\nnew-id|uploads/new.pdf\n')
  const env = {
    PATH: `${fixture.bin}:${process.env.PATH}`,
    COMMAND_LOG: fixture.log,
    ATTACHMENT_ROWS_FILE: rows,
    MISSING_PATHS_FILE: join(fixture.dir, 'old-only.txt'),
  }
  await writeFile(env.MISSING_PATHS_FILE, 'old.pdf\n')
  let result = runShell(`source scripts/lib/deploy-common.sh; audit_attachment_integrity "${pre}"`, env)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(await readFile(pre, 'utf8'), 'old-id\n')
  await writeFile(env.MISSING_PATHS_FILE, 'old.pdf\nnew.pdf\n')
  result = runShell(`source scripts/lib/deploy-common.sh; audit_attachment_integrity "${post}"; verify_new_attachment_integrity "${pre}" "${post}"`, env)
  assert.notEqual(result.status, 0)
  assert.match(`${result.stdout}\n${result.stderr}`, /new-id/)
  assert.equal(await readFile(pre, 'utf8'), 'old-id\n')
})
