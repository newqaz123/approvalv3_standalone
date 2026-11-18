import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { appendFile, chmod, mkdtemp, readFile, writeFile, mkdir, copyFile, readdir, readlink, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFile, execFileSync, spawnSync } from 'node:child_process'

const root = resolve('.')
const read = (path) => readFile(path, 'utf8')
const offlineVerifier = join(root, 'scripts/ci/verify-offline-package.sh')
const upgradeArtifacts = [
  'docs/upgrade-runbook.md',
  'scripts/upgrade/precheck.sql',
  'scripts/upgrade/postcheck.sql',
]

test('production seed is first-install only', async () => {
  const compose = await read('docker-compose.prod.yml')
  const seedBlock = compose.slice(compose.indexOf('  seed:'), compose.indexOf('  app:'))
  assert.match(seedBlock, /profiles:\s*\n\s*- first-install/)
})

test('rollback resolves the project root and explicit production compose contract', async () => {
  const source = await read('scripts/rollback.sh')
  assert.match(source, /PROJECT_ROOT=/)
  assert.match(source, /ENV_FILE="\$PROJECT_ROOT\/\.env\.production"/)
  assert.match(source, /PROD_COMPOSE_FILE="\$PROJECT_ROOT\/docker-compose\.prod\.yml"/)
  assert.match(source, /-p approval-app --env-file "\$ENV_FILE" -f "\$PROD_COMPOSE_FILE"/)
  assert.match(source, /--yes/)
})

test('offline package keeps the canonical backup script at scripts/backup.sh', async () => {
  const source = await read('scripts/build-package.sh')
  assert.match(source, /mkdir -p .*"\$PACKAGE_DIR\/scripts\/lib"/)
  assert.match(source, /cp "\$PROJECT_DIR\/scripts\/backup\.sh" "\$PACKAGE_DIR\/scripts\/"/)
})

test('offline package includes the unified deployment runtime', async () => {
  const source = await read('scripts/build-package.sh')
  for (const path of [
    'scripts/deploy.sh',
    'scripts/deploy-offline.sh',
    'scripts/backup.sh',
    'scripts/restore.sh',
    'scripts/rollback.sh',
    'scripts/health-check.sh',
    'scripts/setup.sh',
    'scripts/lib/deploy-common.sh',
    'tools/env-check.mjs',
    'tools/lib/env.mjs',
  ]) {
    assert.ok(source.includes(path), `missing package source path: ${path}`)
  }
  assert.match(source, /SHA256SUMS/)
  assert.doesNotMatch(source, /Run: bash deploy-offline\.sh/)
})

const checksumFixtureFiles = [
  'images/app.tar',
  'scripts/deploy.sh',
  'scripts/backup.sh',
  'scripts/lib/deploy-common.sh',
  'tools/env-check.mjs',
  'tools/lib/env.mjs',
  'docker-compose.prod.yml',
  'VERSION',
  ...upgradeArtifacts,
]

async function installChecksumFixture(t) {
  const fixture = await mkdtemp(join(tmpdir(), 'package-checksums-'))
  t.after(() => rm(fixture, { recursive: true, force: true }))
  for (const directory of ['images', 'scripts/lib', 'scripts/upgrade', 'tools/lib', 'docs']) {
    await mkdir(join(fixture, directory), { recursive: true })
  }
  for (const file of checksumFixtureFiles) await writeFile(join(fixture, file), `fixture:${file}\n`)
  return fixture
}

function generateChecksums(fixture) {
  return runScript(join(root, 'scripts/build-package.sh'), ['--checksums-only', fixture], {}, root)
}

function verifyManifest(fixture) {
  const verifier = spawnSync('sha256sum', ['--version'], { encoding: 'utf8' }).status === 0
    ? ['sha256sum', '-c']
    : ['shasum', '-a', '256', '-c']
  return spawnSync(verifier[0], [...verifier.slice(1), 'SHA256SUMS'], { cwd: fixture, encoding: 'utf8' })
}

function assertManifestEntry(manifest, file) {
  const matches = manifest.split('\n').filter((line) => /^[0-9a-f]{64}  /.test(line) && line.slice(66) === file)
  assert.equal(matches.length, 1, `expected exactly one checksum entry for ${file}\n${manifest}`)
}

function runbookBashBlocks(markdown) {
  return [...markdown.matchAll(/^```bash\n([\s\S]*?)^```$/gm)].map((match) => match[1])
}

test('legacy runbook blocks offline preparation unless the required files are present and verified', async (t) => {
  const [preamble] = (await read('docs/upgrade-runbook.md')).split(/^## /m)
  const prepare = (cwd) => runShell(runbookBashBlocks(preamble).join('\n'), {}, { cwd })

  for (const { name, missing, omitted, aliased, changed, allowed = false } of [
    { name: 'intact package', allowed: true },
    { name: 'missing postcheck and its entry', missing: 'scripts/upgrade/postcheck.sql' },
    { name: 'missing runbook entry', omitted: 'docs/upgrade-runbook.md' },
    { name: 'aliased precheck entry', aliased: 'scripts/upgrade/precheck.sql' },
    { name: 'missing backup script entry', omitted: 'scripts/backup.sh' },
    { name: 'altered precheck', changed: 'scripts/upgrade/precheck.sql' },
  ]) {
    await t.test(name, async (subtest) => {
      const fixture = await installChecksumFixture(subtest)
      const files = checksumFixtureFiles.filter((file) => file !== missing && file !== omitted && file !== aliased)
      if (aliased) files.push(`./${aliased}`)
      await writeFile(join(fixture, 'SHA256SUMS'), portableChecksums(files, fixture))
      if (missing) await rm(join(fixture, missing))
      if (changed) await appendFile(join(fixture, changed), 'changed\n')
      assert.equal(verifyManifest(fixture).status, changed ? 1 : 0, 'stock verifier checks only listed hashes')

      const result = prepare(fixture)
      assert.ifError(result.error)
      assert.equal(result.status, allowed ? 0 : 1, `unexpected preparation result:\n${result.stdout}\n${result.stderr}`)
    })
  }
})

test('legacy runbook checks the freshly fetched online SHA before invoking the coordinator', async (t) => {
  const section = (await read('docs/upgrade-runbook.md')).split(/^## /m).find((part) => part.startsWith('4. '))
  // Also exercise the old inline command if the runbook has no executable guard.
  const command = runbookBashBlocks(section)[0] ?? section.match(/`(bash scripts\/deploy\.sh --online)`/)?.[1]
  assert.ok(command, 'no online deployment command in the runbook')
  const fixture = await mkdtemp(join(tmpdir(), 'legacy-online-release-'))
  t.after(() => rm(fixture, { recursive: true, force: true }))
  const origin = join(fixture, 'origin')
  const checkout = join(fixture, 'checkout')
  const env = {
    ...process.env,
    GIT_ALLOW_PROTOCOL: 'file',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
  }
  const git = (cwd, ...args) => execFileSync('git', [
    '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false',
    '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args,
  ], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(fixture, 'init', '-b', 'fixture', origin)
  await mkdir(join(origin, 'scripts'))
  await writeFile(join(origin, 'scripts/deploy.sh'), 'printf "fixture coordinator called: %s\\n" "$*"\n')
  git(origin, 'add', 'scripts/deploy.sh')
  git(origin, 'commit', '-m', 'installed release')
  git(origin, 'branch', 'main', 'HEAD')
  git(fixture, 'clone', '--branch', 'main', origin, checkout)
  git(origin, 'commit', '--allow-empty', '-m', 'approved release')
  const approved = git(origin, 'rev-parse', 'HEAD')
  git(origin, 'branch', '-f', 'main', approved)
  const deploy = () => runShell(command, {}, { cwd: checkout, env: { ...env, APPROVED_SHA: approved } })

  const matching = deploy()
  assert.equal(matching.status, 0, `${matching.stdout}\n${matching.stderr}`)
  assert.match(matching.stdout, /fixture coordinator called: --online/)

  git(origin, 'commit', '--allow-empty', '-m', 'unrehearsed release')
  git(origin, 'branch', '-f', 'main', 'HEAD')
  assert.equal(git(checkout, 'rev-parse', 'origin/main'), approved, 'cached tracking ref must still be approved')
  const moved = deploy()
  assert.ifError(moved.error)
  assert.equal(moved.status, 1, `advanced origin passed the online gate:\n${moved.stdout}\n${moved.stderr}`)
  assert.doesNotMatch(moved.stdout, /fixture coordinator called/)
})

test('package checksum-only mode writes a portable verifiable manifest', async (t) => {
  const fixture = await installChecksumFixture(t)
  const generated = generateChecksums(fixture)
  assert.equal(generated.status, 0, generated.stderr)

  const manifest = await read(join(fixture, 'SHA256SUMS'))
  for (const file of checksumFixtureFiles) assertManifestEntry(manifest, file)
  const verified = verifyManifest(fixture)
  assert.equal(verified.status, 0, `${verified.stdout}\n${verified.stderr}`)
})

test('package checksum generation fails if a runtime directory cannot be enumerated', async (t) => {
  const fixture = await installChecksumFixture(t)
  await rm(join(fixture, 'images'), { recursive: true })
  const result = generateChecksums(fixture)
  assert.notEqual(result.status, 0, `checksum generation ignored find failure: ${result.stderr}`)
})

test('package checksum generation fails if the runbook cannot be hashed', async (t) => {
  const fixture = await installChecksumFixture(t)
  await rm(join(fixture, 'docs/upgrade-runbook.md'))
  const result = generateChecksums(fixture)
  assert.notEqual(result.status, 0, 'checksum generation accepted a missing runbook')
})

test('offline setup and Docker context preserve the production package contract', async () => {
  const setup = await read('scripts/setup.sh')
  assert.match(setup, /bash scripts\/deploy\.sh/)
  assert.match(setup, /Offline intranet package/)
  assert.doesNotMatch(setup, /bind mount|Creating uploads directory|chmod 755 uploads/i)

  const dockerignore = await read('.dockerignore')
  assert.match(dockerignore, /^backups\/$/m)
  assert.match(dockerignore, /^\*\.sql$/m)
  assert.match(dockerignore, /^\*\.sql\.gz$/m)
  assert.match(dockerignore, /^\.env\*$/m)
  assert.match(dockerignore, /^\.pi-subagents\/$/m)
})

test('only explicit development and production compose files remain live', async () => {
  const ambiguousCompose = ['docker-compose', 'yml'].join('.')
  assert.equal(existsSync(ambiguousCompose), false)
  for (const path of [
    'README.md',
    'DEPLOY.md',
    'DEPLOYMENT.md',
    'docs/DEPLOY.md',
    'scripts/deploy.sh',
    'scripts/rollback.sh',
    'scripts/backup.sh',
    'scripts/restore.sh',
    'scripts/setup.sh',
  ]) {
    assert.doesNotMatch(await read(path), /docker-compose\.yml/, path)
  }
})

test('operator docs teach the unified safe production workflow', async () => {
  const documents = await Promise.all(['README.md', 'DEPLOY.md', 'DEPLOYMENT.md', 'docs/DEPLOY.md'].map(read))
  const combined = documents.join('\n')
  assert.match(combined, /bash scripts\/deploy\.sh/)
  assert.match(combined, /docker compose -f docker-compose\.dev\.yml up -d/)
  assert.match(combined, /db migrate app/)
  assert.match(combined, /first-install/)
  assert.match(combined, /ROLLBACK APP ONLY/)
  assert.match(combined, /HTTPS origin/i)
  assert.doesNotMatch(combined, /docker compose down -v|docker volume prune|prisma migrate reset|prisma db push/)
})

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
  for (const [fixture, command] of [['fake-docker.sh', 'docker'], ['fake-git.sh', 'git'], ['fake-curl.sh', 'curl'], ['fake-chown.sh', 'chown'], ['fake-stat.sh', 'stat'], ['fake-id.sh', 'id']]) {
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

async function installRollbackFixture(packageRoot = false) {
  const fixture = await mkdtemp(join(tmpdir(), 'rollback-flow-'))
  const project = join(fixture, 'package')
  const scriptDir = packageRoot ? project : join(project, 'scripts')
  await mkdir(join(project, 'scripts'), { recursive: true })
  await mkdir(join(project, 'backups'))
  await mkdir(join(fixture, 'elsewhere'))
  await writeFile(join(project, '.env.production'), 'DATABASE_URL=postgresql://test\n')
  await writeFile(join(project, 'docker-compose.prod.yml'), 'services: {}\n')
  await copyFile(join(root, 'scripts/rollback.sh'), join(scriptDir, 'rollback.sh'))
  await copyFile(join(root, 'scripts/restore.sh'), join(scriptDir, 'restore.sh'))
  await writeFile(join(project, 'scripts', 'backup.sh'), '#!/bin/sh\nprintf \'backup\\n\' >>"$COMMAND_LOG"\nexit "${BACKUP_EXIT:-0}"\n')
  await chmod(join(project, 'scripts', 'backup.sh'), 0o755)
  const bin = join(fixture, 'bin')
  await mkdir(bin)
  await writeFile(join(bin, 'docker'), `#!/bin/sh
printf 'docker %s\\n' "$*" >>"$COMMAND_LOG"
case "$1" in
  compose)
    [ "\${2:-}" = version ] && exit 0
    exit 0
    ;;
  image)
    [ "\${2:-}" = inspect ] && [ "\${3:-}" = approval-app:rollback ] && exit 0
    exit 0
    ;;
  images)
    case "$2" in
      approval-app:rollback) printf 'rollback-id\\n' ;;
      approval-app:latest) printf 'latest-id\\n' ;;
    esac
    exit 0
    ;;
  tag|ps|restart|exec|run|volume)
    exit 0
    ;;
esac
exit 0
`)
  await chmod(join(bin, 'docker'), 0o755)
  return { fixture, project, scriptDir, bin, log: join(fixture, 'commands.log') }
}

function runScript(script, args, env, cwd, input = '') {
  return spawnSync('/bin/bash', [script, ...args], {
    cwd,
    env: { ...process.env, ...env },
    input,
    encoding: 'utf8',
  })
}

test('rollback uses canonical backup before retagging and explicit production compose from repository scripts', async () => {
  const fixture = await installRollbackFixture()
  await writeFile(join(fixture.project, 'backups/last-deployment-state.env'), 'MIGRATIONS_APPLIED=none\n')
  const result = runScript(join(fixture.scriptDir, 'rollback.sh'), ['--yes'], {
    PATH: `${fixture.bin}:${process.env.PATH}`,
    COMMAND_LOG: fixture.log,
    ROLLBACK_WAIT_SECONDS: '0',
  }, join(fixture.fixture, 'elsewhere'))
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  const log = await readFile(fixture.log, 'utf8')
  assertLogSequence(log, [
    'backup\n',
    'docker tag approval-app:latest approval-app:failed\n',
    'docker tag approval-app:rollback approval-app:latest\n',
    'docker compose -p approval-app --env-file ',
    ' -f ',
  ])
  const recreate = log.split('\n').find((line) => line.includes(' up -d '))
  assert.ok(recreate, log)
  assert.match(recreate, /-f .*docker-compose\.prod\.yml up -d --force-recreate app$/)
  assert.doesNotMatch(recreate, /\b(db|migrate|seed)\b/)
})

test('rollback package-root invocation resolves compose and backup paths without changing cwd', async () => {
  const fixture = await installRollbackFixture(true)
  await writeFile(join(fixture.project, 'backups/last-deployment-state.env'), 'MIGRATIONS_APPLIED=none\n')
  const result = runScript(join(fixture.scriptDir, 'rollback.sh'), ['--yes'], {
    PATH: `${fixture.bin}:${process.env.PATH}`,
    COMMAND_LOG: fixture.log,
    ROLLBACK_WAIT_SECONDS: '0',
  }, root)
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  const log = await readFile(fixture.log, 'utf8')
  assert.match(log, new RegExp(`--env-file ${fixture.project.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\.env\\.production`))
  assert.match(log, /-f .*docker-compose\.prod\.yml up -d --force-recreate app/)
})

test('rollback migration compatibility gate cannot be bypassed by --yes and treats malformed or duplicate state as unknown', async () => {
  for (const state of [
    'MIGRATIONS_APPLIED=applied\n',
    'MIGRATIONS_APPLIED=broken\n',
    'MIGRATIONS_APPLIED=none\nMIGRATIONS_APPLIED=applied\n',
    '',
  ]) {
    const fixture = await installRollbackFixture()
    if (state) await writeFile(join(fixture.project, 'backups/last-deployment-state.env'), state)
    const env = {
      PATH: `${fixture.bin}:${process.env.PATH}`,
      COMMAND_LOG: fixture.log,
      ROLLBACK_WAIT_SECONDS: '0',
    }
    const blocked = runScript(join(fixture.scriptDir, 'rollback.sh'), ['--yes'], env, root)
    assert.notEqual(blocked.status, 0, `state=${JSON.stringify(state)}`)
    assert.match(`${blocked.stdout}\n${blocked.stderr}`, /Migrations applied state: (applied|unknown)/)
    const log = await readFile(fixture.log, 'utf8')
    assert.doesNotMatch(log, /docker tag approval-app/)

    const approved = runScript(join(fixture.scriptDir, 'rollback.sh'), ['--yes'], env, root, 'ROLLBACK APP ONLY\n')
    assert.equal(approved.status, 0, `state=${JSON.stringify(state)}\n${approved.stdout}\n${approved.stderr}`)
  }
})

test('rollback preserves ordinary confirmation unless --yes is provided', async () => {
  const fixture = await installRollbackFixture()
  await writeFile(join(fixture.project, 'backups/last-deployment-state.env'), 'MIGRATIONS_APPLIED=none\n')
  const env = {
    PATH: `${fixture.bin}:${process.env.PATH}`,
    COMMAND_LOG: fixture.log,
    ROLLBACK_WAIT_SECONDS: '0',
  }
  const cancelled = runScript(join(fixture.scriptDir, 'rollback.sh'), [], env, root, 'n\n')
  assert.equal(cancelled.status, 0, cancelled.stderr)
  assert.match(cancelled.stdout, /Cancelled\./)
  assert.doesNotMatch(await readFile(fixture.log, 'utf8'), /backup|docker tag approval-app/)

  const approved = runScript(join(fixture.scriptDir, 'rollback.sh'), [], env, root, 'y\n')
  assert.equal(approved.status, 0, `${approved.stdout}\n${approved.stderr}`)
  assert.match(await readFile(fixture.log, 'utf8'), /docker tag approval-app:rollback approval-app:latest/)
})

test('rollback aborts before retagging when canonical backup fails', async () => {
  const fixture = await installRollbackFixture()
  await writeFile(join(fixture.project, 'backups/last-deployment-state.env'), 'MIGRATIONS_APPLIED=none\n')
  const result = runScript(join(fixture.scriptDir, 'rollback.sh'), ['--yes'], {
    PATH: `${fixture.bin}:${process.env.PATH}`,
    COMMAND_LOG: fixture.log,
    BACKUP_EXIT: '1',
    ROLLBACK_WAIT_SECONDS: '0',
  }, root)
  assert.notEqual(result.status, 0)
  const log = await readFile(fixture.log, 'utf8')
  assert.match(log, /backup/)
  assert.doesNotMatch(log, /docker tag approval-app| up -d /)
})

test('restore fallback starts and uses only explicit production compose when containers are absent', async () => {
  const fixture = await installRollbackFixture(true)
  await writeFile(join(fixture.project, 'backup.sql'), 'PostgreSQL database dump\n')
  await writeFile(join(fixture.bin, 'docker'), `#!/bin/sh
printf 'docker %s\\n' "$*" >>"$COMMAND_LOG"
case "$1" in
  compose)
    [ "\${2:-}" = version ] && exit 0
    case " $* " in
      *' config --volumes '*) printf 'uploads_data\\n'; exit 0 ;;
      *' ps '*) exit 1 ;;
      *' up -d db '*) exit 0 ;;
      *' exec -T db '*) exit 0 ;;
      *' restart app '*) exit 0 ;;
    esac
    exit 0
    ;;
  ps) exit 0 ;;
  volume) printf 'uploads_data\\n'; exit 0 ;;
esac
exit 0
`)
  await chmod(join(fixture.bin, 'docker'), 0o755)
  const result = runScript(join(fixture.scriptDir, 'restore.sh'), [join(fixture.project, 'backup.sql')], {
    PATH: `${fixture.bin}:${process.env.PATH}`,
    COMMAND_LOG: fixture.log,
    RESTORE_WAIT_SECONDS: '0',
  }, root, 'yes\n')
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  const log = await readFile(fixture.log, 'utf8')
  assert.match(log, /docker compose -p approval-app --env-file .*\.env\.production -f .*docker-compose\.prod\.yml up -d db/)
  assert.match(log, /docker compose -p approval-app --env-file .*\.env\.production -f .*docker-compose\.prod\.yml exec -T db/)
  assert.match(log, /docker compose -p approval-app --env-file .*\.env\.production -f .*docker-compose\.prod\.yml restart app/)
  assert.doesNotMatch(log, /docker-compose\.yml/)
})

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
  for (const script of ['deploy-offline.sh', 'restore.sh', 'rollback.sh', 'health-check.sh', 'setup.sh']) {
    await copyFile(join(root, 'scripts', script), join(rootDir, 'scripts', script))
  }
  await writeFile(join(rootDir, 'scripts/backup.sh'), `#!/usr/bin/env bash
set -eu
checksum() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi
}
mkdir -p "$BACKUP_DIR"
echo backup >>"$COMMAND_LOG"
printf x >"$BACKUP_DIR/db.sql"
printf x >"$BACKUP_DIR/uploads.tar.gz"
db_sha="$(checksum "$BACKUP_DIR/db.sql")"
uploads_sha="$(checksum "$BACKUP_DIR/uploads.tar.gz")"
if [ "\${FORGED_BACKUP_SHA:-0}" = 1 ]; then db_sha="${'0'.repeat(64)}"; uploads_sha="${'0'.repeat(64)}"; fi
printf 'DB_BACKUP_PATH=%s\\nUPLOADS_BACKUP_PATH=%s\\nDB_BACKUP_SHA256=%s\\nUPLOADS_BACKUP_SHA256=%s\\n' "$DEPLOY_ROOT/backups/db.sql" "$DEPLOY_ROOT/backups/uploads.tar.gz" "$db_sha" "$uploads_sha"
`)
  await chmod(join(rootDir, 'scripts/backup.sh'), 0o755)
  await writeFile(join(rootDir, 'Dockerfile'), 'FROM scratch\n')
}

function portableChecksums(files, cwd) {
  const hasSha256sum = spawnSync('sha256sum', ['--version'], { encoding: 'utf8' }).status === 0
  return hasSha256sum
    ? execFileSync('sha256sum', files, { cwd, encoding: 'utf8' })
    : execFileSync('shasum', ['-a', '256', ...files], { cwd, encoding: 'utf8' })
}

async function installOfflinePackage(rootDir) {
  await installDeployRoot(rootDir)
  for (const dir of ['images', 'docs', 'scripts/upgrade']) await mkdir(join(rootDir, dir))
  for (const file of upgradeArtifacts) await copyFile(join(root, file), join(rootDir, file))
  for (const image of ['approval-app.tar', 'approval-migrate.tar', 'postgres.tar']) await writeFile(join(rootDir, 'images', image), 'fake-image')
  await writeFile(join(rootDir, 'VERSION'), 'VERSION=1.0.0\n')
  const files = [
    'VERSION', 'docker-compose.prod.yml',
    'images/approval-app.tar', 'images/approval-migrate.tar', 'images/postgres.tar',
    'scripts/deploy.sh', 'scripts/deploy-offline.sh', 'scripts/backup.sh', 'scripts/restore.sh',
    'scripts/rollback.sh', 'scripts/health-check.sh', 'scripts/setup.sh',
    'scripts/lib/deploy-common.sh', 'tools/env-check.mjs', 'tools/lib/env.mjs',
    ...upgradeArtifacts,
  ]
  await writeFile(join(rootDir, 'SHA256SUMS'), portableChecksums(files, rootDir))
}

test('built archive ships the legacy upgrade artifacts with valid checksums', async (t) => {
  const fixture = await fakeBin()
  t.after(() => rm(fixture.dir, { recursive: true, force: true }))
  const source = join(fixture.dir, 'source')
  await installDeployRoot(source)
  // Keep packaging, tar and checksums real; replace only Docker's Buildx exports.
  for (const dir of ['docs', 'scripts/upgrade/fixtures']) await mkdir(join(source, dir), { recursive: true })
  for (const file of [
    'DEPLOY.md', 'scripts/build-package.sh', 'scripts/backup.sh',
    ...upgradeArtifacts, 'scripts/upgrade/verify-upgrade.sh',
  ]) await copyFile(join(root, file), join(source, file))
  await writeFile(join(source, 'scripts/upgrade/fixtures/rehearsal.sql'), '-- fixture, not a runtime artifact\n')
  const docker = join(fixture.bin, 'docker')
  const normalDocker = join(fixture.bin, 'docker-deploy')
  await copyFile(docker, normalDocker)
  await chmod(normalDocker, 0o755)
  await writeFile(docker, `#!/bin/bash
set -eu
[ "$1" = buildx ] || exec docker-deploy "$@"
case "$2" in
  inspect|use) exit 0 ;;
  build)
    shift 2
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --output)
          case "$2" in
            type=docker,dest=*) printf 'fake image\n' >"\${2#type=docker,dest=}"; exit 0 ;;
          esac
          ;;
      esac
      shift
    done ;;
esac
exit 2
`)
  const env = { PATH: `${fixture.bin}:${process.env.PATH}`, COMMAND_LOG: fixture.log, APP_CONTAINER_MISSING: '1' }
  const built = runScript(join(source, 'scripts/build-package.sh'), ['task3-fixture'], env, source)
  assert.equal(built.status, 0, `${built.stdout}\n${built.stderr}`)
  const archive = (await readdir(join(source, 'deploy'))).filter((file) => file.endsWith('.tar.gz'))
  assert.equal(archive.length, 1)
  const unpacked = join(fixture.dir, 'unpacked')
  await mkdir(unpacked)
  execFileSync('tar', ['-xzf', join(source, 'deploy', archive[0]), '-C', unpacked])
  const bundled = join(unpacked, archive[0].slice(0, -'.tar.gz'.length))
  const manifest = await read(join(bundled, 'SHA256SUMS'))
  for (const file of upgradeArtifacts) {
    assert.ok(existsSync(join(bundled, file)), `missing archive file: ${file}`)
    assertManifestEntry(manifest, file)
  }
  assert.deepEqual((await readdir(join(bundled, 'scripts/upgrade'))).sort(), ['postcheck.sql', 'precheck.sql'])
  const verified = verifyManifest(bundled)
  assert.equal(verified.status, 0, `${verified.stdout}\n${verified.stderr}`)
  const runbook = await read(join(bundled, 'docs/upgrade-runbook.md'))
  const [preamble] = runbook.split(/^## /m)
  const preparation = runShell(runbookBashBlocks(preamble).join('\n'), {}, { cwd: bundled })
  assert.equal(preparation.status, 0, `${preparation.stdout}\n${preparation.stderr}`)
  for (const [, link] of runbook.matchAll(/\]\((\.\.\/[^)]+)\)/g)) {
    assert.ok(existsSync(resolve(bundled, 'docs', link)), `unresolved packaged runbook link: ${link}`)
  }
  for (const block of runbookBashBlocks(runbook)) {
    const syntax = spawnSync('/bin/bash', ['-n'], { input: block, encoding: 'utf8' })
    assert.equal(syntax.status, 0, syntax.stderr)
  }

  await copyFile(join(bundled, '.env.production.example'), join(bundled, '.env.production'))
  const result = runDeployment(join(bundled, 'scripts/deploy.sh'), ['--offline', bundled], env, unpacked)
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.match(result.stdout, /Deployment succeeded \(offline\)/)
})

test('offline CI verifier rejects unsafe runners before touching the archive or Docker', async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), 'offline-ci-guard-'))
  t.after(() => rm(fixture, { recursive: true, force: true }))
  const bin = join(fixture, 'bin')
  await mkdir(bin)
  for (const command of ['docker', 'tar', 'sha256sum']) {
    await writeFile(join(bin, command), '#!/bin/sh\nprintf "%s\\n" "$0" >>"$COMMAND_LOG"\nexit 99\n', { mode: 0o755 })
  }
  await writeFile(join(bin, 'uname'), '#!/bin/sh\n[ "$*" = -m ] || exit 99\nprintf "%s\\n" "$FIXTURE_ARCH"\n', { mode: 0o755 })
  const archive = join(fixture, 'release.tar.gz')
  await writeFile(archive, '')

  for (const [name, overrides, diagnostic] of [
    ['outside GitHub Actions', { GITHUB_ACTIONS: '' }, /GITHUB_ACTIONS/],
    ['self-hosted runner', { RUNNER_ENVIRONMENT: 'self-hosted' }, /github-hosted/],
    ['ARM runner', { FIXTURE_ARCH: 'arm64' }, /x86_64/],
    ['invalid run ID', { GITHUB_RUN_ID: 'local' }, /GITHUB_RUN_ID/],
    ['invalid run attempt', { GITHUB_RUN_ATTEMPT: '' }, /GITHUB_RUN_ATTEMPT/],
    ['unusable scratch directory', { RUNNER_TEMP: archive }, /RUNNER_TEMP/],
  ]) {
    await t.test(name, () => {
      const log = join(fixture, `${name}.log`)
      const result = runScript(offlineVerifier, [archive], {
        PATH: `${bin}:${process.env.PATH}`,
        COMMAND_LOG: log,
        FIXTURE_ARCH: 'x86_64',
        GITHUB_ACTIONS: 'true',
        RUNNER_ENVIRONMENT: 'github-hosted',
        GITHUB_RUN_ID: '1234',
        GITHUB_RUN_ATTEMPT: '2',
        GITHUB_SHA: 'a'.repeat(40),
        RUNNER_TEMP: fixture,
        ...overrides,
      }, fixture)
      assert.ifError(result.error)
      assert.notEqual(result.status, 0)
      assert.equal(existsSync(log), false, 'an archive or Docker command ran before the guard')
      assert.match(result.stderr, diagnostic)
    })
  }
})

async function offlineVerifierFixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'offline-ci-package-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const bin = join(dir, 'bin')
  const runnerTemp = join(dir, 'runner')
  const pkg = join(dir, 'package')
  const archive = join(dir, 'release.tar.gz')
  const log = join(dir, 'docker.log')
  const override = join(dir, 'ci-override.yml')
  const sha = 'a'.repeat(40)
  await Promise.all([mkdir(bin), mkdir(runnerTemp), installOfflinePackage(pkg)])
  await copyFile(join(root, '.env.example'), join(pkg, '.env.production.example'))
  await copyFile(join(root, 'docker-compose.prod.yml'), join(pkg, 'docker-compose.prod.yml'))
  await rm(join(pkg, '.env.production'))
  await writeFile(join(pkg, 'VERSION'), `version=${sha}\ngit_commit=aaaaaaa\n`)
  await writeFile(join(bin, 'uname'), '#!/bin/sh\n[ "$*" = -m ] || exit 99\necho x86_64\n', { mode: 0o755 })
  if (process.platform === 'darwin') {
    // Keep real strict checksum verification on macOS, whose sha256sum lacks --strict.
    await writeFile(join(bin, 'sha256sum'), '#!/bin/sh\nexec shasum -a 256 "$@"\n', { mode: 0o755 })
  }
  await writeFile(join(bin, 'docker'), `#!/bin/sh
set -eu
printf '%s\n' "$*" >>"$COMMAND_LOG"
case "$*" in
  'load --input images/approval-app.tar') echo 'Loaded image: approval-app:latest' ;;
  'load --input images/approval-migrate.tar') echo 'Loaded image: approval-migrate:latest' ;;
  'load --input images/postgres.tar') echo 'Loaded image: postgres:15-alpine' ;;
  'image inspect --format {{.Os}}/{{.Architecture}} '*) echo linux/amd64 ;;
  'compose --project-name approval-release-1234-2 --env-file .env.production -f docker-compose.prod.yml -f compose.ci.yml '*)
    shift 9
    case "$*" in
      '--profile * config --format json') cp compose.ci.yml "$CI_OVERRIDE"; printf '%s\n' "$COMPOSE_MODEL" ;;
      'up -d --pull never --no-build db migrate app') exit 88 ;; # Stop at the real verifier's startup boundary.
      'ps --all'|'logs --no-color --tail 100 db migrate app'|'down --volumes') ;;
      *) exit 99 ;;
    esac ;;
  *) exit 99 ;;
esac
`, { mode: 0o755 })

  const healthy = { condition: 'service_healthy', required: true }
  const migrated = { condition: 'service_completed_successfully', required: true }
  const model = {
    name: 'approval-release-1234-2',
    services: {
      db: { image: 'postgres:15-alpine' },
      migrate: { image: 'approval-migrate:latest', depends_on: { db: healthy } },
      app: { image: 'approval-app:latest', depends_on: { db: healthy, migrate: migrated } },
      seed: { image: 'approval-migrate:latest', profiles: ['first-install'], depends_on: { migrate: migrated } },
    },
  }
  return {
    pkg, log, override, model,
    async run() {
      execFileSync('tar', ['-czf', archive, '-C', dir, 'package'])
      const result = runScript(offlineVerifier, [archive], {
        PATH: `${bin}:${process.env.PATH}`,
        COMMAND_LOG: log, CI_OVERRIDE: override, COMPOSE_MODEL: JSON.stringify(model),
        GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted',
        GITHUB_RUN_ID: '1234', GITHUB_RUN_ATTEMPT: '2', GITHUB_SHA: sha, RUNNER_TEMP: runnerTemp,
      }, dir)
      assert.ifError(result.error)
      assert.deepEqual(await readdir(runnerTemp), [], 'verifier left scratch files behind')
      return result
    },
  }
}

test('offline CI rejects a manifest-valid archive that omits required deployment or recovery files', async (t) => {
  for (const [file, removeFile] of [
    ['scripts/deploy.sh', true],
    ['scripts/lib/deploy-common.sh', true],
    ['scripts/backup.sh', true],
    ['scripts/restore.sh', true],
    ['scripts/rollback.sh', true],
    ['scripts/deploy.sh', false],
  ]) {
    await t.test(`${removeFile ? 'missing file and checksum' : 'no exact checksum path for'} ${file}`, async (subtest) => {
      const fixture = await offlineVerifierFixture(subtest)
      if (removeFile) await rm(join(fixture.pkg, file))
      const generated = generateChecksums(fixture.pkg)
      assert.equal(generated.status, 0, generated.stderr)
      if (!removeFile) {
        const manifestPath = join(fixture.pkg, 'SHA256SUMS')
        const manifest = await read(manifestPath)
        await writeFile(manifestPath, manifest.replace(`  ${file}\n`, `  ./${file}\n`))
      }
      assert.equal(verifyManifest(fixture.pkg).status, 0, 'checksums for listed paths should still pass')
      const result = await fixture.run()
      assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
      assert.ok(result.stderr.includes(file), result.stderr)
      assert.equal(existsSync(fixture.log), false, 'invalid archive reached Docker')
    })
  }
})

test('offline CI gives Compose a TCP readiness probe before starting the migrator', async (t) => {
  const fixture = await offlineVerifierFixture(t)
  const generated = generateChecksums(fixture.pkg)
  assert.equal(generated.status, 0, generated.stderr)
  const result = await fixture.run()
  assert.equal(result.status, 88, `${result.stdout}\n${result.stderr}`)
  assert.match(await read(fixture.log), / up -d --pull never --no-build db migrate app$/m)

  // Parse the emitted override (not verifier source) using the YAML parser already in the dev lockfile.
  const { DEFAULT_SCHEMA, Type, load } = (await import('js-yaml')).default
  const schema = DEFAULT_SCHEMA.extend(['scalar', 'sequence'].map((kind) => new Type('!reset', { kind })))
  const overrides = load(await read(fixture.override), { schema })
  const [mode, probe] = overrides.services.db.healthcheck?.test ?? []
  assert.equal(mode, 'CMD-SHELL', 'db healthcheck still inherits the socket-only probe')
  assert.match(probe, /^pg_isready\b.*\s(?:-h\s+|--host[=\s]+)127\.0\.0\.1(?:\s|$)/)
})

test('offline CI rejects dependencies that could start a service outside db, migrate and app', async (t) => {
  for (const [name, edge] of [
    ['depends_on', { depends_on: { sidecar: { condition: 'service_started', required: true } } }],
    ['links', { links: ['sidecar:alias'] }],
    ['volumes_from', { volumes_from: ['sidecar:ro'] }],
    ['ipc', { ipc: 'service:sidecar' }],
    ['pid', { pid: 'service:sidecar' }],
  ]) {
    await t.test(name, async (subtest) => {
      const fixture = await offlineVerifierFixture(subtest)
      const generated = generateChecksums(fixture.pkg)
      assert.equal(generated.status, 0, generated.stderr)
      fixture.model.services.sidecar = { image: 'approval-app:latest' }
      // Follow a transitive edge from app via migrate, not just app's own dependencies.
      Object.assign(fixture.model.services.migrate, edge)
      const result = await fixture.run()
      assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
      assert.match(result.stderr, /migrate.*sidecar/)
      assert.doesNotMatch(await read(fixture.log), / (?:up -d|down --volumes)\b/)
    })
  }
})

test('offline CI health assertion requires a connected database in a valid JSON response', async (t) => {
  for (const [name, body, status] of [
    ['connected', '{"status":"ok","database":"connected"}', 0],
    ['database error despite ok status', '{"status":"ok","database":"error"}', 1],
    ['unhealthy status despite connected database', '{"status":"degraded","database":"connected"}', 1],
    ['malformed JSON', '{"status":"ok","database":"connected"', 1],
  ]) {
    await t.test(name, () => {
      const result = spawnSync('/bin/bash', ['-c', 'source "$1" || exit 125; declare -F assert_connected_health >/dev/null || exit 125; assert_connected_health', 'bash', offlineVerifier], {
        input: body,
        env: { ...process.env, GITHUB_ACTIONS: '' },
        encoding: 'utf8',
      })
      assert.ifError(result.error)
      assert.equal(result.status, status, result.stderr)
    })
  }
})

function runDeployment(script, args, env, cwd, options = {}) {
  return spawnSync('/bin/bash', [script, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    ...options,
  })
}

function assertLogSequence(log, markers) {
  let offset = 0
  for (const marker of markers) {
    const position = log.indexOf(marker, offset)
    assert.notEqual(position, -1, `missing or out-of-order command marker: ${marker}\n${log}`)
    offset = position + marker.length
  }
}

const remoteTarget = 'deploy@example.invalid'
const remoteTag = 'v1.2.3_rc-1'
const remoteRelease = 'approval-app-v1.2.3_rc-1-20261118'

async function installRemoteDeployFixture(t) {
  const fixture = await fakeBin()
  t.after(() => rm(fixture.dir, { recursive: true, force: true }))
  const project = join(fixture.dir, 'project')
  const scripts = join(project, 'scripts')
  const server = join(fixture.dir, 'Approval.App_v2-1')
  const current = join(server, 'current')
  const packageScripts = join(fixture.dir, 'archive', remoteRelease, 'scripts')
  await mkdir(scripts, { recursive: true })
  await mkdir(join(project, 'deploy'))
  await mkdir(join(server, 'old-release'), { recursive: true })
  await symlink('old-release', current)
  await mkdir(packageScripts, { recursive: true })
  const script = join(scripts, 'deploy-remote.sh')
  await copyFile(join(root, 'scripts/deploy-remote.sh'), script)
  await writeFile(join(packageScripts, 'deploy-offline.sh'), `#!/bin/bash
set -e
# Record the old current target from the extracted package root before exiting.
readlink ../current >>deploy-calls.log
exit "$CHILD_EXIT"
`)
  await writeFile(join(scripts, 'build-package.sh'), `#!/bin/bash
set -e
printf 'build %s\\n' "$*" >>"$COMMAND_LOG"
[ "$#" = 1 ] && [ "$1" = '${remoteTag}' ] || exit 2
tar -czf "$FIXTURE_PROJECT/deploy/${remoteRelease}.tar.gz" -C "$FIXTURE_ARCHIVE_DIR" '${remoteRelease}'
`)
  for (const [name, body] of Object.entries({
    date: `
[ "$*" = '+%Y%m%d' ] || exit 2
printf '%s\\n' '20261118'
`,
    ssh: `
printf 'ssh %s\\n' "$*" >>"$COMMAND_LOG"
if [ "$1" = -- ]; then shift; fi
[ "$1" = '${remoteTarget}' ] || exit 2
shift
if [ "$#" = 0 ]; then
  wait_for_marker "$WAIT_BEFORE_EXTRACT"
  exec /bin/bash
fi
[ "$#" = 1 ] || exit 2
case "$1" in
  'id -u') id -u; exit "$SSH_PROBE_EXIT" ;;
  "mkdir -p '$FIXTURE_REMOTE_PATH'"*|"rm -f -- '$FIXTURE_REMOTE_PATH/.incoming."*) exec /bin/bash -c "$1" ;;
  *) exit 2 ;;
esac
`,
    scp: `
printf 'scp %s\\n' "$*" >>"$COMMAND_LOG"
if [ "$1" = -- ]; then shift; fi
[ "$#" = 2 ] && [ "$1" = "$FIXTURE_PROJECT/deploy/${remoteRelease}.tar.gz" ] || exit 2
dest=\${2#${remoteTarget}:}
case "$dest" in
  "$FIXTURE_REMOTE_PATH/"|"$FIXTURE_REMOTE_PATH/".incoming.*/) ;;
  *) exit 2 ;;
esac
wait_for_marker "$WAIT_BEFORE_UPLOAD"
cp "$1" "$dest"
if [ -n "$UPLOAD_MARKER" ]; then : >"$UPLOAD_MARKER"; fi
exit "$SCP_EXIT"
`,
  })) {
    const path = join(fixture.bin, name)
    await writeFile(path, `#!/bin/bash
set -e
wait_for_marker() {
  [ -n "$1" ] || return 0
  for ((attempt = 0; attempt < 500; attempt++)); do
    [ ! -f "$1" ] || return 0
    sleep 0.02
  done
  printf 'Timed out waiting for fixture marker %s\\n' "$1" >&2
  return 2
}
${body}`)
    await chmod(path, 0o755)
  }
  return { ...fixture, project, server, script, current, calls: join(server, remoteRelease, 'deploy-calls.log') }
}

function remoteDeployEnv(fixture, { uid = '0', childExit = '0', probeExit = '0', scpExit = '0' } = {}) {
  return {
    PATH: `${fixture.bin}:${process.env.PATH}`,
    COMMAND_LOG: fixture.log,
    FIXTURE_PROJECT: fixture.project,
    FIXTURE_ARCHIVE_DIR: join(fixture.dir, 'archive'),
    FIXTURE_REMOTE_PATH: fixture.server,
    FAKE_UID: uid,
    CHILD_EXIT: childExit,
    SSH_PROBE_EXIT: probeExit,
    SCP_EXIT: scpExit,
    WAIT_BEFORE_UPLOAD: '',
    WAIT_BEFORE_EXTRACT: '',
    UPLOAD_MARKER: '',
  }
}

function runRemoteDeployment(fixture, { path = fixture.server, tag = remoteTag, ...options } = {}) {
  return runDeployment(fixture.script, [remoteTarget, path, tag], remoteDeployEnv(fixture, options), fixture.dir)
}

test('deploy-remote invokes scripts/deploy-offline.sh once and promotes current only after success', async (t) => {
  const fixture = await installRemoteDeployFixture(t)
  const result = runRemoteDeployment(fixture)
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.equal(await read(fixture.calls), 'old-release\n')
  assert.equal(await readlink(fixture.current), remoteRelease)
  assertLogSequence(await read(fixture.log), [
    `ssh -- ${remoteTarget} id -u\n`,
    `build ${remoteTag}\n`,
    `ssh -- ${remoteTarget} mkdir -p `,
    'scp ',
    `ssh -- ${remoteTarget}\n`,
  ])
})

test('deploy-remote propagates offline child failure and leaves current unchanged', async (t) => {
  const fixture = await installRemoteDeployFixture(t)
  const result = runRemoteDeployment(fixture, { childExit: '23' })
  assert.equal(result.status, 23, `${result.stdout}\n${result.stderr}`)
  assert.equal(await read(fixture.calls), 'old-release\n')
  assert.equal(await readlink(fixture.current), 'old-release')
  assert.doesNotMatch(result.stdout, /Remote Deploy Complete/)
})

test('deploy-remote preserves active release contents on a same-version, same-day retry', async (t) => {
  const fixture = await installRemoteDeployFixture(t)
  const stagedCompose = join(fixture.dir, 'archive', remoteRelease, 'docker-compose.prod.yml')
  const activeCompose = join(fixture.current, 'docker-compose.prod.yml')
  await writeFile(stagedCompose, 'active release compose\n')
  const first = runRemoteDeployment(fixture)
  assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`)

  await writeFile(stagedCompose, 'retry compose\n')
  const retry = runRemoteDeployment(fixture, { childExit: '23' })
  assert.notEqual(retry.status, 0)
  assert.equal(await readlink(fixture.current), remoteRelease)
  assert.equal(await read(activeCompose), 'active release compose\n')
  assert.equal(await read(fixture.calls), 'old-release\n')
  assert.match(retry.stderr, /already exists.*new version tag/i)
  assert.doesNotMatch(retry.stdout, /Remote Deploy Complete/)
})

test('overlapping same-tag remote deploys can only extract their own archive', async (t) => {
  const first = await installRemoteDeployFixture(t)
  const second = await installRemoteDeployFixture(t)
  // Separate build clients share one destination. Allow A to extract only after B
  // has uploaded, but reserve the release directory for A before B extracts.
  const composePath = join('archive', remoteRelease, 'docker-compose.prod.yml')
  await writeFile(join(first.dir, composePath), 'archive A\n')
  await writeFile(join(second.dir, composePath), 'archive B\n')
  const firstUpload = join(first.dir, 'first-uploaded')
  const secondUpload = join(first.dir, 'second-uploaded')
  const firstDone = join(first.dir, 'first-done')
  const start = (client, options) => new Promise((resolve) => {
    execFile('/bin/bash', [client.script, remoteTarget, first.server, remoteTag], {
      cwd: client.dir,
      env: { ...process.env, ...remoteDeployEnv(client), FIXTURE_REMOTE_PATH: first.server, ...options },
      timeout: 15000,
    }, (error, stdout, stderr) => resolve({ status: error ? error.code : 0, stdout, stderr }))
  })
  const a = start(first, { UPLOAD_MARKER: firstUpload, WAIT_BEFORE_EXTRACT: secondUpload })
  const b = start(second, {
    WAIT_BEFORE_UPLOAD: firstUpload, UPLOAD_MARKER: secondUpload, WAIT_BEFORE_EXTRACT: firstDone,
  })
  const winner = await a
  await writeFile(firstDone, '')
  const collision = await b
  assert.equal(winner.status, 0, `${winner.stdout}\n${winner.stderr}`)
  assert.equal(collision.status, 1, `${collision.stdout}\n${collision.stderr}`)
  assert.match(collision.stderr, /already exists.*new version tag/i)
  assert.equal(await readlink(first.current), remoteRelease)
  assert.equal(await read(join(first.current, 'docker-compose.prod.yml')), 'archive A\n')
  assert.equal(await read(first.calls), 'old-release\n')
  assert.deepEqual((await readdir(first.server)).sort(), [remoteRelease, 'current', 'old-release'].sort())
})

test('deploy-remote removes its partial upload when transfer fails', async (t) => {
  const fixture = await installRemoteDeployFixture(t)
  const result = runRemoteDeployment(fixture, { scpExit: '29' })
  assert.equal(result.status, 29, `${result.stdout}\n${result.stderr}`)
  assert.equal(await readlink(fixture.current), 'old-release')
  assert.deepEqual((await readdir(fixture.server)).sort(), ['current', 'old-release'])
})

test('deploy-remote keeps current when creating the new symlink fails', async (t) => {
  const fixture = await installRemoteDeployFixture(t)
  const ln = join(fixture.bin, 'ln')
  await writeFile(ln, '#!/bin/bash\nexit 24\n', { mode: 0o755 })

  const result = runRemoteDeployment(fixture)
  assert.equal(result.status, 24, `${result.stdout}\n${result.stderr}`)
  assert.equal(await read(fixture.calls), 'old-release\n')
  assert.ok(existsSync(fixture.current), 'current disappeared after symlink creation failed')
  assert.equal(await readlink(fixture.current), 'old-release')
  assert.doesNotMatch(result.stdout, /Remote Deploy Complete/)
})

test('deploy-remote refuses a non-root SSH session before building or transferring', async (t) => {
  const fixture = await installRemoteDeployFixture(t)
  const result = runRemoteDeployment(fixture, { uid: '1001' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /must run as root/i)
  assert.match(result.stderr, /transfer the package separately.*authorized deployment account/i)
  assert.equal(await read(fixture.log), `ssh -- ${remoteTarget} id -u\n`)
  assert.equal(await readlink(fixture.current), 'old-release')
})

test('deploy-remote stops on an SSH UID probe failure even if it prints 0', async (t) => {
  const fixture = await installRemoteDeployFixture(t)
  const result = runRemoteDeployment(fixture, { probeExit: '255' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /effective UID/i)
  assert.equal(await read(fixture.log), `ssh -- ${remoteTarget} id -u\n`)
  assert.equal(await readlink(fixture.current), 'old-release')
})

test('deploy-remote rejects unsupported paths before SSH', async (t) => {
  const fixture = await installRemoteDeployFixture(t)
  for (const path of ['/opt/Approval App', 'relative/path', '/', '//', '/opt/./app', '/opt/app/..', '/opt/Approvação']) {
    const result = runRemoteDeployment(fixture, { path })
    assert.notEqual(result.status, 0, path)
    assert.equal(existsSync(fixture.log), false, `${path} triggered build or transport`)
    assert.match(result.stderr, /remote path/i)
  }
  assert.equal(await readlink(fixture.current), 'old-release')
})

test('deploy-remote rejects invalid Docker tags before SSH', async (t) => {
  const fixture = await installRemoteDeployFixture(t)
  for (const tag of ['release/candidate', '-leading', '.leading', 'é', 'a'.repeat(129)]) {
    const result = runRemoteDeployment(fixture, { tag })
    assert.notEqual(result.status, 0, tag)
    assert.equal(existsSync(fixture.log), false, `${tag} triggered build or transport`)
    assert.match(result.stderr, /Docker tag/i)
  }
  assert.equal(await readlink(fixture.current), 'old-release')
})

test('backup archives uploads without an unpackaged helper image', async () => {
  const source = await read('scripts/backup.sh')
  assert.doesNotMatch(source, /alpine:(?:latest|[0-9.]+)/)
  assert.match(source, /docker exec "\$APP_CONTAINER" tar -czf -/)
  assert.match(source, /--pull=never/)
})

test('canonical backup creates non-empty database and uploads artifacts without pulling', async () => {
  const fixture = await fakeBin()
  const deployRoot = join(fixture.dir, 'real-backup-root')
  await installValidGate(deployRoot)
  const result = runScript(join(root, 'scripts/backup.sh'), [], {
    PATH: `${fixture.bin}:${process.env.PATH}`,
    COMMAND_LOG: fixture.log,
    DEPLOY_ROOT: deployRoot,
    BACKUP_DIR: join(deployRoot, 'backups'),
  }, fixture.dir)
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  const dbPath = result.stdout.match(/^DB_BACKUP_PATH=(.+)$/m)?.[1]
  const uploadsPath = result.stdout.match(/^UPLOADS_BACKUP_PATH=(.+)$/m)?.[1]
  assert.ok(dbPath && uploadsPath, result.stdout)
  assert.ok((await readFile(dbPath)).length > 0)
  assert.ok((await readFile(uploadsPath)).length > 0)
  const log = await readFile(fixture.log, 'utf8')
  assert.match(log, /docker exec approval-app tar -czf - -C \/app\/uploads \./)
  assert.doesNotMatch(log, /docker run|alpine|--pull=always/)
})

test('canonical backup rejects connection-string-shaped database names before side effects', async (t) => {
  for (const [label, databaseName] of [
    ['equals sign', 'fixture=data'],
    ['postgresql URI prefix', 'postgresql://'],
    ['postgres URI prefix', 'postgres://'],
    ['NUL byte', 'fixture\0data'],
  ]) {
    const sources = label === 'NUL byte' ? ['env file'] : ['env file', 'no-file fallback']
    for (const source of sources) {
      await t.test(`${source}: ${label}`, async (t) => {
        const fixture = await fakeBin()
        t.after(() => rm(fixture.dir, { recursive: true, force: true }))
        const deployRoot = join(fixture.dir, 'backup-root')
        const envPath = join(deployRoot, '.env.production')
        const backupDir = join(deployRoot, 'backups')
        if (source === 'env file') {
          await installValidGate(deployRoot)
          await writeFile(envPath, (await read(envPath))
            .replace('@db/app_db', `@db/${databaseName}`)
            .replace('POSTGRES_DB=app_db', `POSTGRES_DB='${databaseName}'`))
        }
        const result = runScript(join(root, 'scripts/backup.sh'), [], {
          PATH: `${fixture.bin}:${process.env.PATH}`,
          COMMAND_LOG: fixture.log,
          DEPLOY_ROOT: deployRoot,
          ENV_FILE: envPath,
          BACKUP_DIR: backupDir,
          POSTGRES_DB: source === 'no-file fallback' ? databaseName : 'ignored_fallback',
        }, fixture.dir)
        assert.equal(result.status, 1, result.stdout + result.stderr)
        assert.match(result.stderr, /^ERROR: POSTGRES_DB must be a literal database name, not a connection string\n$/)
        assert.doesNotMatch(result.stdout + result.stderr, /fixture=data|postgresql?:\/\//)
        assert.equal(existsSync(fixture.log), false, 'Docker ran')
        assert.equal(existsSync(backupDir), false, 'backup directory was created')
      })
    }
  }
})

test('deployment preflight requires every documented host command', async () => {
  const source = await read('scripts/deploy.sh')
  for (const command of ['docker', 'node', 'curl']) {
    assert.match(source, new RegExp(`require_host_command ${command}`))
  }
  const docs = `${await read('DEPLOY.md')}\n${await read('docs/DEPLOY.md')}`
  assert.match(docs, /Node\.js/)
  assert.match(docs, /curl/)
})

test('verified backup rejects forged checksum summaries', async () => {
  const fixture = await fakeBin()
  const deployRoot = join(fixture.dir, 'backup-root')
  await installDeployRoot(deployRoot)
  const result = runShell('source scripts/lib/deploy-common.sh; run_verified_backup', {
    PATH: `${fixture.bin}:${process.env.PATH}`,
    COMMAND_LOG: fixture.log,
    DEPLOY_ROOT: deployRoot,
    ENV_FILE: join(deployRoot, '.env.production'),
    PROD_COMPOSE_FILE: join(deployRoot, 'docker-compose.prod.yml'),
    FORGED_BACKUP_SHA: '1',
  })
  assert.notEqual(result.status, 0)
  assert.match(`${result.stdout}\n${result.stderr}`, /checksum/i)
})

test('non-root deploy exits before host or repository commands', async (t) => {
  for (const mode of ['online', 'offline']) {
    await t.test(mode, async (t) => {
      const fixture = await fakeBin()
      t.after(() => rm(fixture.dir, { recursive: true, force: true }))
      const deployRoot = join(fixture.dir, 'deploy-root')
      const state = join(deployRoot, 'backups/last-deployment-state.env')
      if (mode === 'offline') await installOfflinePackage(deployRoot)
      else await installDeployRoot(deployRoot)
      const args = mode === 'offline' ? ['--offline', deployRoot] : ['--online']
      const result = runDeployment(join(root, 'scripts/deploy.sh'), args, {
        PATH: `${fixture.bin}:${process.env.PATH}`, COMMAND_LOG: fixture.log, DEPLOY_ROOT: deployRoot,
        DEPLOY_STATE_FILE: state, FAKE_UID: '1001',
      }, fixture.dir)
      assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`)
      assert.match(result.stderr, /must run as root/i)
      assert.match(result.stderr, /Deployment failed during: preflight/)
      assert.doesNotMatch(result.stdout + result.stderr, /Deployment succeeded/)
      assert.equal(existsSync(fixture.log), false, 'Docker, Git, or backup ran')
      assert.equal(existsSync(state), false, 'deployment state file was written')
    })
  }
})

test('non-root deploy can show help', async (t) => {
  const fixture = await fakeBin()
  t.after(() => rm(fixture.dir, { recursive: true, force: true }))
  const result = runDeployment(join(root, 'scripts/deploy.sh'), ['--help'], {
    PATH: `${fixture.bin}:${process.env.PATH}`, COMMAND_LOG: fixture.log, FAKE_UID: '1001',
  }, fixture.dir)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Usage:/)
  assert.equal(existsSync(fixture.log), false)
})

test('online dirty-tree abort happens before rollback tags, state, or backup mutation', async () => {
  const fixture = await fakeBin()
  const deployRoot = join(fixture.dir, 'dirty-root')
  await installDeployRoot(deployRoot)
  const result = runDeployment(join(root, 'scripts/deploy.sh'), ['--online'], {
    PATH: `${fixture.bin}:${process.env.PATH}`,
    COMMAND_LOG: fixture.log,
    DEPLOY_ROOT: deployRoot,
    DIRTY_TREE_OUTPUT: ' M local-change.txt',
  }, fixture.dir, { input: '\n' })
  assert.notEqual(result.status, 0)
  assert.match(`${result.stdout}\n${result.stderr}`, /working tree is dirty|deployment aborted/i)
  const log = await readFile(fixture.log, 'utf8')
  assert.doesNotMatch(log, /docker image tag|backup|select id|Mounts/)
})

test('main online update path proves rollback and backup precede build and preservation follows health', async () => {
  const fixture = await fakeBin()
  const deployRoot = join(fixture.dir, 'online-root')
  await installDeployRoot(deployRoot)
  const result = runDeployment(join(root, 'scripts/deploy.sh'), ['--online'], {
    PATH: `${fixture.bin}:${process.env.PATH}`, COMMAND_LOG: fixture.log, DEPLOY_ROOT: deployRoot,
  }, fixture.dir)
  assert.equal(result.status, 0, result.stderr)
  const log = await readFile(fixture.log, 'utf8')
  const stateCaptureMarker = 'docker inspect -f {{range .Mounts}}{{.Name}} {{.Destination}}{{"\\n"}}{{end}} approval-db\n'
  assertLogSequence(log, [
    'docker image tag sha256:appimage approval-app:rollback\n',
    'docker image tag sha256:migrateimage approval-migrate:rollback\n',
    stateCaptureMarker,
    'docker exec approval-db psql -U deployuser -d app_db -Atc select id, "filePath" from file_attachments order by id;\n',
    'backup\n',
    'docker build --target runner -t approval-app:latest ',
    'docker build --target migrator -t approval-migrate:latest ',
    'up -d db migrate app\n',
    'MIGRATION_COMMAND_REACHED\n',
    'docker inspect -f {{.State.Health.Status}} approval-app\n',
    'curl -fsS http://localhost:3000/api/health\n',
    stateCaptureMarker,
  ])
  assert.match(result.stdout, /Deployment succeeded \(online\)\./)
  assert.doesNotMatch(log, /seed|down -v|volume prune/)
})

test('main offline checksum failure identifies checksum and stops before any safety or acquisition command', async () => {
  const fixture = await fakeBin()
  const deployRoot = join(fixture.dir, 'offline-root')
  await installOfflinePackage(deployRoot)
  await writeFile(join(deployRoot, 'VERSION'), 'VERSION=changed\n')
  const result = runDeployment(join(root, 'scripts/deploy.sh'), ['--offline', deployRoot], {
    PATH: `${fixture.bin}:${process.env.PATH}`, COMMAND_LOG: fixture.log, DEPLOY_ROOT: deployRoot, APP_CONTAINER_MISSING: '1',
  }, fixture.dir)
  assert.notEqual(result.status, 0)
  const output = `${result.stdout}\n${result.stderr}`
  assert.ok(output.includes('ERROR: Offline package checksum validation failed'), output)
  assert.ok(!output.includes('Deployment succeeded (offline).'), output)
  const log = await readFile(fixture.log, 'utf8')
  assert.doesNotMatch(log, /inspect|tag|load|backup|build|MIGRATION_COMMAND_REACHED|Health.Status|success/i)
  assert.equal(log, 'docker compose version\n')
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
  assert.doesNotMatch(log, /\bgit\b|\bfetch\b|\bpull\b|alpine:latest|--pull=always/)
})

test('coordinator rejects a matching nonliteral database name before existing-state probes', async (t) => {
  const fixture = await fakeBin()
  t.after(() => rm(fixture.dir, { recursive: true, force: true }))
  const deployRoot = join(fixture.dir, 'offline-existing')
  await installOfflinePackage(deployRoot)
  const envPath = join(deployRoot, '.env.production')
  await writeFile(envPath, (await read(envPath))
    .replace('@db/app_db', '@db/fixture=data')
    .replace('POSTGRES_DB=app_db', "POSTGRES_DB='fixture=data'"))

  const result = runDeployment(join(root, 'scripts/deploy.sh'), ['--offline', deployRoot], {
    PATH: `${fixture.bin}:${process.env.PATH}`, COMMAND_LOG: fixture.log, DEPLOY_ROOT: deployRoot,
  }, fixture.dir)
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stderr, /^Environment error: POSTGRES_DB must be a literal database name, not a connection string$/m)
  assert.match(result.stderr, /Deployment failed during: validation/)
  assert.doesNotMatch(result.stdout + result.stderr, /fixture=data/)
  assert.equal(await read(fixture.log), 'docker compose version\n')
  assert.equal(existsSync(join(deployRoot, 'backups')), false)
})

test('existing offline installation backs up the configured role and database before loading images', async (t) => {
  const fixture = await fakeBin()
  t.after(() => rm(fixture.dir, { recursive: true, force: true }))
  const deployRoot = join(fixture.dir, 'offline-existing')
  await installOfflinePackage(deployRoot)
  await copyFile(join(root, 'scripts/backup.sh'), join(deployRoot, 'scripts/backup.sh'))
  const envPath = join(deployRoot, '.env.production')
  await writeFile(envPath, (await read(envPath))
    .replace('deployuser:deploypassword123456@db/app_db', 'backup_fixture:deploypassword123456@db/fixture_data')
    .replace('POSTGRES_USER=deployuser', 'POSTGRES_USER = "backup_fixture"')
    .replace('POSTGRES_DB=app_db', "POSTGRES_DB = 'fixture_data'") +
    'BACKUP_SOURCE_PROBE=$(touch "$DEPLOY_ROOT/backup-sourced-env")\n')
  const generated = generateChecksums(deployRoot)
  assert.equal(generated.status, 0, generated.stderr)

  const result = runShell('unset POSTGRES_USER POSTGRES_DB; bash scripts/deploy-offline.sh', {
    PATH: `${fixture.bin}:${process.env.PATH}`, COMMAND_LOG: fixture.log, DEPLOY_ROOT: deployRoot,
  }, { cwd: deployRoot })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.equal(existsSync(join(deployRoot, 'backup-sourced-env')), false, 'env file was evaluated as shell code')
  const log = await read(fixture.log)
  assertLogSequence(log, [
    'docker exec approval-db psql -U backup_fixture -d fixture_data -Atqc select count(*) from users;\n',
    'docker exec approval-db psql -U backup_fixture -d fixture_data -Atc select id, "filePath" from file_attachments order by id;\n',
    'docker exec approval-db pg_dump -U backup_fixture -d fixture_data\n',
    'docker exec approval-db psql -U backup_fixture -d fixture_data -tAc select count(*) from users;\n',
    'docker exec approval-app tar -czf - -C /app/uploads .\n',
    'docker load ',
    'up -d db migrate app\n',
  ])
  assert.match(result.stdout, /^DB_BACKUP_SHA256=[a-f0-9]{64}$/m)
  assert.match(result.stdout, /^UPLOADS_BACKUP_SHA256=[a-f0-9]{64}$/m)
})

test('state probes refuse invalid database identity rather than reaching psql', async (t) => {
  for (const [label, envLine, error] of [
    ['nonliteral database name', 'POSTGRES_DB=fixture=data', /POSTGRES_DB must be a literal database name/],
    ['missing database name', 'POSTGRES_DB=', /POSTGRES_USER and POSTGRES_DB/],
    ['NUL byte in role', 'POSTGRES_DB=fixture_data\nPOSTGRES_USER=fixture\0user', /POSTGRES_USER must not contain a NUL byte/],
  ]) {
    for (const probe of ['query_count approval-db "select count(*) from users;"', 'audit_attachment_integrity "$OUTPUT"']) {
      await t.test(`${probe.split(' ')[0]}: ${label}`, async (t) => {
        const fixture = await fakeBin()
        t.after(() => rm(fixture.dir, { recursive: true, force: true }))
        const envPath = join(fixture.dir, '.env.production')
        const output = join(fixture.dir, 'audit.txt')
        await writeFile(envPath, `POSTGRES_USER=fixture_user\n${envLine}\n`)
        const result = runShell(`source scripts/lib/deploy-common.sh; ${probe}`, {
          PATH: `${fixture.bin}:${process.env.PATH}`, COMMAND_LOG: fixture.log, ENV_FILE: envPath, OUTPUT: output,
        })
        assert.equal(result.status, 1, result.stdout + result.stderr)
        assert.match(result.stderr, error)
        assert.equal(existsSync(fixture.log), false, 'Docker ran')
        assert.equal(existsSync(output), false, 'audit output was created')
      })
    }
  }
})

test('offline package validation requires backup and recovery scripts before mutation', async () => {
  const fixture = await fakeBin()
  const deployRoot = join(fixture.dir, 'offline-missing-runtime')
  await installOfflinePackage(deployRoot)
  await rm(join(deployRoot, 'scripts/backup.sh'))
  const result = runDeployment(join(root, 'scripts/deploy.sh'), ['--offline', deployRoot], {
    PATH: `${fixture.bin}:${process.env.PATH}`,
    COMMAND_LOG: fixture.log,
    DEPLOY_ROOT: deployRoot,
    APP_CONTAINER_MISSING: '1',
  }, fixture.dir)
  assert.notEqual(result.status, 0)
  assert.match(`${result.stdout}\n${result.stderr}`, /missing: scripts\/backup\.sh/)
  const log = await readFile(fixture.log, 'utf8')
  assert.doesNotMatch(log, /docker image tag|docker load|backup|MIGRATION_COMMAND_REACHED/)
})

test('offline preflight rejects incomplete or changed legacy upgrade artifacts before mutation', async (t) => {
  async function removeManifestEntry(deployRoot, file) {
    const path = join(deployRoot, 'SHA256SUMS')
    const lines = (await read(path)).split('\n')
    assert.equal(lines.filter((line) => line.slice(66) === file).length, 1)
    await writeFile(path, lines.filter((line) => line.slice(66) !== file).join('\n'))
  }

  for (const scenario of [
    {
      name: 'missing file even when it is not listed in the manifest',
      change: async (dir) => {
        await rm(join(dir, 'docs/upgrade-runbook.md'))
        await removeManifestEntry(dir, 'docs/upgrade-runbook.md')
      },
      error: /missing: docs\/upgrade-runbook\.md/,
      remainingHashesValid: true,
    },
    {
      name: 'missing exact manifest entry while all listed hashes match',
      change: async (dir) => {
        await removeManifestEntry(dir, 'scripts/upgrade/precheck.sql')
        await appendFile(join(dir, 'SHA256SUMS'), portableChecksums(['./scripts/upgrade/precheck.sql'], dir))
      },
      error: /SHA256SUMS.*scripts\/upgrade\/precheck\.sql/,
      remainingHashesValid: true,
    },
    {
      name: 'changed SQL file',
      change: (dir) => appendFile(join(dir, 'scripts/upgrade/postcheck.sql'), '\n-- changed after hashing\n'),
      error: /Offline package checksum validation failed/,
    },
  ]) {
    await t.test(scenario.name, async (t) => {
      const fixture = await fakeBin()
      t.after(() => rm(fixture.dir, { recursive: true, force: true }))
      const deployRoot = join(fixture.dir, 'offline-root')
      await installOfflinePackage(deployRoot)
      await scenario.change(deployRoot)
      if (scenario.remainingHashesValid) {
        const verified = verifyManifest(deployRoot)
        assert.equal(verified.status, 0, `${verified.stdout}\n${verified.stderr}`)
      }
      const result = runDeployment(join(deployRoot, 'scripts/deploy.sh'), ['--offline', deployRoot], {
        PATH: `${fixture.bin}:${process.env.PATH}`, COMMAND_LOG: fixture.log,
      }, fixture.dir)
      const log = await read(fixture.log)
      assert.notEqual(result.status, 0, `invalid package was accepted:\n${result.stdout}\n${log}`)
      assert.match(result.stderr, scenario.error)
      assert.match(result.stderr, /Deployment failed during: package-validation/)
      assert.equal(log, 'docker compose version\n', 'only the host Compose version probe may run')
      assert.equal(existsSync(join(deployRoot, 'backups')), false)
    })
  }
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

test('production deployment records unknown migration state before starting compose', async () => {
  const fixture = await fakeBin()
  const gateRoot = join(fixture.dir, 'deployment-root')
  await installValidGate(gateRoot)
  const stateFile = join(fixture.dir, 'state.env')
  await writeFile(stateFile, 'MIGRATIONS_APPLIED=none\n')
  const result = runShell('source scripts/lib/deploy-common.sh; deploy_production_services', {
    PATH: `${fixture.bin}:${process.env.PATH}`,
    COMMAND_LOG: fixture.log,
    DEPLOY_ROOT: gateRoot,
    ENV_FILE: join(gateRoot, '.env.production'),
    ENV_TEMPLATE: join(gateRoot, '.env.example'),
    PROD_COMPOSE_FILE: join(gateRoot, 'docker-compose.prod.yml'),
    DEPLOY_STATE_FILE: stateFile,
    COMPOSE_UP_EXIT: '1',
  })
  assert.notEqual(result.status, 0)
  assert.match(await readFile(stateFile, 'utf8'), /^MIGRATIONS_APPLIED=unknown$/m)
  assert.match(await readFile(fixture.log, 'utf8'), /MIGRATION_COMMAND_REACHED/)
})

test('migration-state persistence failure prevents compose from starting', async () => {
  const fixture = await fakeBin()
  const gateRoot = join(fixture.dir, 'deployment-root')
  await installValidGate(gateRoot)
  const result = runShell('source scripts/lib/deploy-common.sh; deploy_production_services', {
    PATH: `${fixture.bin}:${process.env.PATH}`,
    COMMAND_LOG: fixture.log,
    DEPLOY_ROOT: gateRoot,
    ENV_FILE: join(gateRoot, '.env.production'),
    ENV_TEMPLATE: join(gateRoot, '.env.example'),
    PROD_COMPOSE_FILE: join(gateRoot, 'docker-compose.prod.yml'),
    DEPLOY_STATE_FILE: join(fixture.dir, 'state.env'),
    CHOWN_EXIT: '1',
  })
  assert.notEqual(result.status, 0)
  assert.doesNotMatch(await readFile(fixture.log, 'utf8'), /MIGRATION_COMMAND_REACHED/)
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

test('mount detection survives real docker Go-template newline escaping', async () => {
  const fixture = await fakeBin()
  const result = runShell(
    'source scripts/lib/deploy-common.sh; mount_for_destination approval-db /var/lib/postgresql/data && mount_for_destination approval-app /app/uploads',
    { PATH: `${fixture.bin}:${process.env.PATH}` },
  )
  assert.equal(result.status, 0, `stderr: ${result.stderr}`)
  assert.equal(result.stdout.trim(), 'approval-app_db_data\napproval-app_uploads_data')
})

test('state capture psql probes authenticate explicitly instead of as the exec OS user', async () => {
  const fixture = await fakeBin()
  // The fake docker exec rejects psql without -U, mirroring the official
  // postgres image where `docker exec` runs as root and role "root" absent.
  const result = runShell(
    'source scripts/lib/deploy-common.sh; capture_deployment_state "$STATE_FILE" && grep -q "^PRE_USERS=19$" "$STATE_FILE"',
    { PATH: `${fixture.bin}:${process.env.PATH}`, STATE_FILE: join(fixture.dir, 'auth-state'), COMMAND_LOG: fixture.log },
  )
  assert.equal(result.status, 0, `stderr: ${result.stderr}`)
  const log = await readFile(fixture.log, 'utf8')
  assert.match(log, /docker exec approval-db psql -U \S+ -d \S+ -Atqc select count\(\*\) from users;/)
})

test('non-root interactive cancel exits cleanly without running deployment commands', async (t) => {
  const fixture = await fakeBin()
  t.after(() => rm(fixture.dir, { recursive: true, force: true }))
  const deployRoot = join(fixture.dir, 'cancel-root')
  await installDeployRoot(deployRoot)
  const result = runDeployment(join(root, 'scripts/deploy.sh'), [], {
    PATH: `${fixture.bin}:${process.env.PATH}`, COMMAND_LOG: fixture.log, DEPLOY_ROOT: deployRoot, FAKE_UID: '1001',
  }, fixture.dir, { input: '3\n' })
  assert.equal(result.status, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`)
  assert.match(result.stdout + result.stderr, /[Cc]ancel+ed/)
  assert.doesNotMatch(result.stdout + result.stderr, /Deployment failed/)
  const log = await readFile(fixture.log, 'utf8').catch(() => '')
  assert.equal(log, '')
})

test('invalid menu choice re-prompts instead of aborting', async () => {
  const fixture = await fakeBin()
  const deployRoot = join(fixture.dir, 'reprompt-root')
  await installDeployRoot(deployRoot)
  const result = runDeployment(join(root, 'scripts/deploy.sh'), [], {
    PATH: `${fixture.bin}:${process.env.PATH}`, COMMAND_LOG: fixture.log, DEPLOY_ROOT: deployRoot,
  }, fixture.dir, { input: '9\n3\n' })
  assert.equal(result.status, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`)
  assert.doesNotMatch(result.stdout + result.stderr, /Deployment failed/)
  const log = await readFile(fixture.log, 'utf8').catch(() => '')
  assert.equal(log, '')
})
