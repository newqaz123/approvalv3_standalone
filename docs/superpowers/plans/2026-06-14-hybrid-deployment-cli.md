# Hybrid Deployment CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a first-pass interactive manager that wraps the existing Docker scripts, validates environment files, and makes updates safer by requiring backup and health checks.

**Architecture:** Add a Node `.mjs` CLI under `tools/` for cross-platform prompts, env parsing, OS checks, and command orchestration. Keep Docker operations in existing `scripts/*.sh` files for this first version, while introducing small Node helper modules that can be tested with Node's built-in test runner.

**Tech Stack:** Node.js built-ins (`readline/promises`, `child_process`, `fs/promises`, `node:test`), existing Bash scripts, Docker Compose, npm scripts.

---

## File Structure

- Create `tools/lib/env.mjs`: Parse `.env`-style files, compare keys, classify required and optional variables, and generate safe env reports.
- Create `tools/lib/command.mjs`: Run external commands with inherited stdio, platform-aware shell handling, and dry-run support for tests.
- Create `tools/lib/project.mjs`: Locate project root, detect platform, detect existing scripts, and resolve paths used by the manager.
- Create `tools/manage.mjs`: Interactive CLI menu and command routing.
- Create `tests/tools/env.test.mjs`: Unit tests for env parsing and env doctor behavior.
- Create `tests/tools/command.test.mjs`: Unit tests for command planning without running Docker.
- Modify `package.json`: Add `manage` and CLI test scripts.
- Modify `.env.example`: Add missing variables used by app and deployment scripts.
- Modify `.gitignore`: Ignore generated backup/env backup artifacts while preserving templates and source files.
- Modify `README.md`: Add short operator workflow for `npm run manage`.

## Task 1: Env Parser and Doctor

**Files:**
- Create: `tools/lib/env.mjs`
- Test: `tests/tools/env.test.mjs`

- [ ] **Step 1: Write failing env tests**

Create `tests/tools/env.test.mjs`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseEnvText,
  REQUIRED_PRODUCTION_KEYS,
  OPTIONAL_PRODUCTION_KEYS,
  createEnvReport,
  mergeMissingEnvKeys,
} from '../../tools/lib/env.mjs'

test('parseEnvText ignores comments and preserves quoted values', () => {
  const parsed = parseEnvText(`
# comment
DATABASE_URL="postgresql://postgres:changeme@db:5432/app_db?schema=public"
NEXTAUTH_URL=http://localhost:3000
EMPTY_VALUE=
`)

  assert.equal(parsed.DATABASE_URL, 'postgresql://postgres:changeme@db:5432/app_db?schema=public')
  assert.equal(parsed.NEXTAUTH_URL, 'http://localhost:3000')
  assert.equal(parsed.EMPTY_VALUE, '')
})

test('createEnvReport lists missing required and optional keys', () => {
  const template = parseEnvText(`
DATABASE_URL="postgresql://postgres:changeme@db:5432/app_db?schema=public"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="secret"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
UPLOAD_DIR="public/uploads"
CRON_SECRET="cron"
POSTGRES_USER="postgres"
POSTGRES_PASSWORD="changeme"
POSTGRES_DB="app_db"
SMTP_HOST=""
`)
  const current = parseEnvText(`
DATABASE_URL="postgresql://postgres:changeme@db:5432/app_db?schema=public"
NEXTAUTH_URL="http://localhost:3000"
`)

  const report = createEnvReport({ current, template })

  assert.deepEqual(report.missingRequired.sort(), [
    'CRON_SECRET',
    'NEXTAUTH_SECRET',
    'NEXT_PUBLIC_APP_URL',
    'POSTGRES_DB',
    'POSTGRES_PASSWORD',
    'POSTGRES_USER',
    'UPLOAD_DIR',
  ].sort())
  assert.deepEqual(report.missingOptional, ['SMTP_HOST'])
  assert.equal(REQUIRED_PRODUCTION_KEYS.includes('DATABASE_URL'), true)
  assert.equal(OPTIONAL_PRODUCTION_KEYS.includes('SMTP_HOST'), true)
})

test('mergeMissingEnvKeys appends only missing template keys', () => {
  const currentText = 'DATABASE_URL="postgresql://postgres:changeme@db:5432/app_db?schema=public"\\n'
  const templateText = [
    'DATABASE_URL="postgresql://postgres:changeme@db:5432/app_db?schema=public"',
    'NEXTAUTH_URL="http://localhost:3000"',
    'NEXTAUTH_SECRET="generate-with-openssl-rand-base64-32"',
  ].join('\\n')

  const merged = mergeMissingEnvKeys({ currentText, templateText })

  assert.match(merged, /DATABASE_URL=/)
  assert.match(merged, /NEXTAUTH_URL=/)
  assert.match(merged, /NEXTAUTH_SECRET=/)
  assert.equal((merged.match(/DATABASE_URL=/g) || []).length, 1)
})
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
node --test tests/tools/env.test.mjs
```

Expected: fail with `Cannot find module` for `tools/lib/env.mjs`.

- [ ] **Step 3: Implement env helpers**

Create `tools/lib/env.mjs`:

```js
export const REQUIRED_PRODUCTION_KEYS = [
  'DATABASE_URL',
  'NEXTAUTH_URL',
  'NEXTAUTH_SECRET',
  'NEXT_PUBLIC_APP_URL',
  'UPLOAD_DIR',
  'CRON_SECRET',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DB',
]

export const OPTIONAL_PRODUCTION_KEYS = [
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_FROM',
  'ARCHIVE_AFTER_DAYS',
  'PUPPETEER_EXECUTABLE_PATH',
]

export function parseEnvText(text) {
  const result = {}

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const equalsIndex = line.indexOf('=')
    if (equalsIndex === -1) continue

    const key = line.slice(0, equalsIndex).trim()
    let value = line.slice(equalsIndex + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    if (key) result[key] = value
  }

  return result
}

export function createEnvReport({ current, template }) {
  const templateKeys = Object.keys(template)
  const missingRequired = REQUIRED_PRODUCTION_KEYS.filter((key) => !(key in current))
  const missingOptional = templateKeys
    .filter((key) => OPTIONAL_PRODUCTION_KEYS.includes(key))
    .filter((key) => !(key in current))

  return {
    missingRequired,
    missingOptional,
    unknownKeys: Object.keys(current).filter((key) => !templateKeys.includes(key)),
    presentRequired: REQUIRED_PRODUCTION_KEYS.filter((key) => key in current),
  }
}

export function mergeMissingEnvKeys({ currentText, templateText }) {
  const current = parseEnvText(currentText)
  const templateLines = templateText.split(/\r?\n/)
  const missingLines = []

  for (const line of templateLines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const equalsIndex = trimmed.indexOf('=')
    if (equalsIndex === -1) continue

    const key = trimmed.slice(0, equalsIndex).trim()
    if (key && !(key in current)) {
      missingLines.push(trimmed)
    }
  }

  if (missingLines.length === 0) return currentText

  const separator = currentText.endsWith('\n') ? '\n' : '\n\n'
  return `${currentText}${separator}# Added by Approval App Manager\n${missingLines.join('\n')}\n`
}
```

- [ ] **Step 4: Run env tests and verify they pass**

Run:

```bash
node --test tests/tools/env.test.mjs
```

Expected: all tests pass.

- [ ] **Step 5: Commit env parser**

Run:

```bash
git add tools/lib/env.mjs tests/tools/env.test.mjs
git commit -m "feat: add deployment env doctor helpers"
```

## Task 2: Command Runner and Project Detection

**Files:**
- Create: `tools/lib/command.mjs`
- Create: `tools/lib/project.mjs`
- Test: `tests/tools/command.test.mjs`

- [ ] **Step 1: Write failing command tests**

Create `tests/tools/command.test.mjs`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCommandPlan } from '../../tools/lib/command.mjs'
import { resolveManagerPaths } from '../../tools/lib/project.mjs'

test('createCommandPlan returns dry-run metadata without executing', () => {
  const plan = createCommandPlan({
    command: 'bash',
    args: ['scripts/backup.sh'],
    cwd: '/project',
    dryRun: true,
  })

  assert.equal(plan.command, 'bash')
  assert.deepEqual(plan.args, ['scripts/backup.sh'])
  assert.equal(plan.cwd, '/project')
  assert.equal(plan.dryRun, true)
})

test('resolveManagerPaths points at expected script names', () => {
  const paths = resolveManagerPaths('/repo')

  assert.equal(paths.root, '/repo')
  assert.equal(paths.envExample.endsWith('.env.example'), true)
  assert.equal(paths.envProduction.endsWith('.env.production'), true)
  assert.equal(paths.scripts.backup.endsWith('scripts/backup.sh'), true)
  assert.equal(paths.scripts.restore.endsWith('scripts/restore.sh'), true)
  assert.equal(paths.scripts.deploy.endsWith('scripts/deploy.sh'), true)
  assert.equal(paths.scripts.health.endsWith('scripts/health-check.sh'), true)
})
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
node --test tests/tools/command.test.mjs
```

Expected: fail with missing module errors for `tools/lib/command.mjs` and `tools/lib/project.mjs`.

- [ ] **Step 3: Implement command runner**

Create `tools/lib/command.mjs`:

```js
import { spawn } from 'node:child_process'

export function createCommandPlan({ command, args = [], cwd, dryRun = false }) {
  return { command, args, cwd, dryRun }
}

export function runCommand({ command, args = [], cwd, dryRun = false }) {
  const plan = createCommandPlan({ command, args, cwd, dryRun })

  if (dryRun) {
    console.log(`[dry-run] ${plan.command} ${plan.args.join(' ')}`)
    return Promise.resolve({ code: 0, plan })
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ code, plan })
      } else {
        reject(new Error(`Command failed with exit code ${code}: ${command} ${args.join(' ')}`))
      }
    })
  })
}
```

- [ ] **Step 4: Implement project paths**

Create `tools/lib/project.mjs`:

```js
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function getProjectRoot() {
  const currentFile = fileURLToPath(import.meta.url)
  return path.resolve(path.dirname(currentFile), '..', '..')
}

export function resolveManagerPaths(root = getProjectRoot()) {
  return {
    root,
    envExample: path.join(root, '.env.example'),
    envProduction: path.join(root, '.env.production'),
    backupsDir: path.join(root, 'backups'),
    scripts: {
      backup: path.join(root, 'scripts', 'backup.sh'),
      restore: path.join(root, 'scripts', 'restore.sh'),
      deploy: path.join(root, 'scripts', 'deploy.sh'),
      offlineDeploy: path.join(root, 'scripts', 'deploy-offline.sh'),
      health: path.join(root, 'scripts', 'health-check.sh'),
      rollback: path.join(root, 'scripts', 'rollback.sh'),
    },
  }
}

export function isWindows() {
  return process.platform === 'win32'
}
```

- [ ] **Step 5: Run command tests and verify they pass**

Run:

```bash
node --test tests/tools/command.test.mjs
```

Expected: all tests pass.

- [ ] **Step 6: Run all CLI unit tests**

Run:

```bash
node --test tests/tools/*.test.mjs
```

Expected: all tests pass.

- [ ] **Step 7: Commit command helpers**

Run:

```bash
git add tools/lib/command.mjs tools/lib/project.mjs tests/tools/command.test.mjs
git commit -m "feat: add deployment command runner"
```

## Task 3: Interactive Manager CLI

**Files:**
- Create: `tools/manage.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add manager npm scripts**

Modify `package.json` scripts to include:

```json
{
  "manage": "node tools/manage.mjs",
  "test:manage": "node --test tests/tools/*.test.mjs"
}
```

Keep existing scripts unchanged.

- [ ] **Step 2: Create CLI entrypoint**

Create `tools/manage.mjs`:

```js
#!/usr/bin/env node
import { readFile, writeFile, copyFile, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { parseEnvText, createEnvReport, mergeMissingEnvKeys } from './lib/env.mjs'
import { runCommand } from './lib/command.mjs'
import { isWindows, resolveManagerPaths } from './lib/project.mjs'

const paths = resolveManagerPaths()

async function fileExists(filePath) {
  try {
    await access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')
}

async function prompt(question) {
  const rl = createInterface({ input, output })
  try {
    return (await rl.question(question)).trim()
  } finally {
    rl.close()
  }
}

async function envDoctor() {
  if (!(await fileExists(paths.envExample))) {
    throw new Error('.env.example not found')
  }

  if (!(await fileExists(paths.envProduction))) {
    console.log('.env.production not found. Creating it from .env.example.')
    await copyFile(paths.envExample, paths.envProduction)
    console.log('Created .env.production. Edit it with production values before deploying.')
    return
  }

  const [templateText, currentText] = await Promise.all([
    readFile(paths.envExample, 'utf8'),
    readFile(paths.envProduction, 'utf8'),
  ])
  const report = createEnvReport({
    current: parseEnvText(currentText),
    template: parseEnvText(templateText),
  })

  console.log('\\nEnvironment report')
  console.log(`Required present: ${report.presentRequired.length}`)
  console.log(`Required missing: ${report.missingRequired.length}`)
  if (report.missingRequired.length > 0) {
    for (const key of report.missingRequired) console.log(`  - ${key}`)
  }
  if (report.missingOptional.length > 0) {
    console.log(`Optional missing: ${report.missingOptional.join(', ')}`)
  }

  if (report.missingRequired.length === 0 && report.missingOptional.length === 0) {
    console.log('Environment file has all template keys.')
    return
  }

  const answer = await prompt('Append missing keys from .env.example after creating a backup? (y/N) ')
  if (!/^y$/i.test(answer)) return

  const backupPath = `${paths.envProduction}.backup.${timestamp()}`
  await copyFile(paths.envProduction, backupPath)
  await writeFile(paths.envProduction, mergeMissingEnvKeys({ currentText, templateText }))
  console.log(`Backup written: ${backupPath}`)
  console.log('Missing keys appended to .env.production.')
}

async function runScript(scriptPath, args = []) {
  if (isWindows()) {
    console.log('Windows detected. Use Docker Desktop and run Bash scripts through Git Bash, WSL, or an equivalent shell.')
  }
  await runCommand({ command: 'bash', args: [scriptPath, ...args], cwd: paths.root })
}

async function backupData() {
  await runScript(paths.scripts.backup)
}

async function healthCheck() {
  await runScript(paths.scripts.health)
}

async function rollback() {
  await runScript(paths.scripts.rollback)
}

async function updateExistingInstall() {
  console.log('\\nUpdate source')
  console.log('1. Git pull using existing deploy script')
  console.log('2. Offline package / flash drive folder')
  const choice = await prompt('Choose update source: ')

  console.log('\\nCreating backup before update.')
  await backupData()

  if (choice === '1') {
    await runScript(paths.scripts.deploy)
  } else if (choice === '2') {
    const packageDir = await prompt('Path to extracted package folder: ')
    await runScript(paths.scripts.offlineDeploy, [packageDir])
  } else {
    console.log('Update cancelled.')
    return
  }

  console.log('\\nRunning health check after update.')
  await healthCheck()
}

async function restoreBackup() {
  const dbBackup = await prompt('Database backup path: ')
  const uploadsBackup = await prompt('Uploads backup path, or press Enter to skip: ')
  const confirm = await prompt('Type RESTORE to replace current data: ')
  if (confirm !== 'RESTORE') {
    console.log('Restore cancelled.')
    return
  }
  const args = uploadsBackup ? [dbBackup, uploadsBackup] : [dbBackup]
  await runScript(paths.scripts.restore, args)
}

async function showMenu() {
  console.log('\\nApproval App Manager')
  console.log('1. First-time install')
  console.log('2. Update existing installation')
  console.log('3. Backup data')
  console.log('4. Restore from backup')
  console.log('5. Check system health')
  console.log('6. Edit/view environment config')
  console.log('7. Roll back last update')
  console.log('8. Exit')
  return prompt('Choose an option: ')
}

async function main() {
  while (true) {
    const choice = await showMenu()
    if (choice === '1') await envDoctor()
    else if (choice === '2') await updateExistingInstall()
    else if (choice === '3') await backupData()
    else if (choice === '4') await restoreBackup()
    else if (choice === '5') await healthCheck()
    else if (choice === '6') await envDoctor()
    else if (choice === '7') await rollback()
    else if (choice === '8') break
    else console.log('Choose a number from 1 to 8.')
  }
}

main().catch((error) => {
  console.error(`\\nManager failed: ${error.message}`)
  process.exitCode = 1
})
```

- [ ] **Step 3: Run CLI tests**

Run:

```bash
npm run test:manage
```

Expected: all tests pass.

- [ ] **Step 4: Smoke-test menu exit**

Run:

```bash
printf "8\n" | npm run manage
```

Expected: menu renders and exits with code 0.

- [ ] **Step 5: Commit manager CLI**

Run:

```bash
git add package.json tools/manage.mjs
git commit -m "feat: add interactive deployment manager"
```

## Task 4: Complete Environment Template and Ignore Generated Artifacts

**Files:**
- Modify: `.env.example`
- Modify: `.gitignore`

- [ ] **Step 1: Update `.env.example`**

Replace `.env.example` with:

```dotenv
# ==============================================
# ApprovalApp Environment Variables Template
# ==============================================
# Copy this file to .env.local for development.
# Copy this file to .env.production for Docker production.

# Application URL
NEXTAUTH_URL="http://localhost:3000"
NEXT_PUBLIC_APP_URL="http://localhost:3000"

# Authentication secrets
NEXTAUTH_SECRET="generate-with-openssl-rand-base64-32"
CRON_SECRET="generate-a-random-secret"

# Database connection used by Prisma and the app.
# Development on host:
# DATABASE_URL="postgresql://postgres:changeme@localhost:5432/app_db?schema=public"
# Docker production:
# DATABASE_URL="postgresql://postgres:changeme@db:5432/app_db?schema=public"
DATABASE_URL="postgresql://postgres:changeme@db:5432/app_db?schema=public"

# Docker Compose PostgreSQL settings
POSTGRES_USER="postgres"
POSTGRES_PASSWORD="changeme"
POSTGRES_DB="app_db"

# File storage
UPLOAD_DIR="public/uploads"

# Optional email notifications
SMTP_HOST=""
SMTP_PORT="587"
SMTP_USER=""
SMTP_PASS=""
SMTP_FROM=""

# Optional maintenance settings
ARCHIVE_AFTER_DAYS="90"
PUPPETEER_EXECUTABLE_PATH=""
```

- [ ] **Step 2: Update `.gitignore`**

Append these lines to `.gitignore`:

```gitignore

# Deployment manager generated files
.env.production
.env.production.backup.*
backups/
deploy/
```

- [ ] **Step 3: Run env tests**

Run:

```bash
npm run test:manage
```

Expected: all tests pass.

- [ ] **Step 4: Run env doctor smoke test**

Run:

```bash
printf "6\nn\n8\n" | npm run manage
```

Expected: environment report prints and the command exits without changing `.env.production`.

- [ ] **Step 5: Commit env template changes**

Run:

```bash
git add .env.example .gitignore
git commit -m "chore: document deployment environment keys"
```

## Task 5: Operator Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add manager section to README**

Insert this section after the Docker Production quick-start:

```markdown
## Interactive Deployment Manager

The project includes an operator menu for Docker-based install, update, backup, restore, health check, and rollback tasks:

```bash
npm run manage
```

Use this before updating a live installation. The manager checks `.env.production`, creates backups before update operations, wraps the existing Docker scripts, and runs a health check after deployment.

Supported update sources:

- Existing Git checkout
- Extracted GitHub zip/package
- Flash drive or local package folder

Persistent data is kept outside source updates:

- `.env.production`
- PostgreSQL Docker volume
- uploads Docker volume
- `backups/`
```

- [ ] **Step 2: Run README-adjacent smoke commands**

Run:

```bash
npm run test:manage
printf "8\n" | npm run manage
```

Expected: tests pass and menu exits cleanly.

- [ ] **Step 3: Commit documentation**

Run:

```bash
git add README.md
git commit -m "docs: add deployment manager workflow"
```

## Task 6: Final Verification

**Files:**
- No source edits unless verification exposes a defect.

- [ ] **Step 1: Run CLI unit tests**

Run:

```bash
npm run test:manage
```

Expected: all tests pass.

- [ ] **Step 2: Run manager exit smoke test**

Run:

```bash
printf "8\n" | npm run manage
```

Expected: the menu renders once and exits with code 0.

- [ ] **Step 3: Run env doctor no-write smoke test**

Run:

```bash
printf "6\nn\n8\n" | npm run manage
```

Expected: environment report prints, `.env.production` is not modified, and the process exits with code 0.

- [ ] **Step 4: Inspect working tree**

Run:

```bash
git status --short
```

Expected: only unrelated pre-existing local changes remain.

- [ ] **Step 5: Summarize implementation**

Report:

- created files
- modified files
- test commands and results
- any operations not executed because they would touch live Docker data

## Self-Review

Spec coverage:

- Interactive CLI front door: covered by Task 3.
- Env preservation and env doctor: covered by Tasks 1, 3, and 4.
- Existing Docker script wrapping: covered by Tasks 2 and 3.
- Backup-before-update: covered by Task 3.
- Git and offline package update sources: covered by Task 3.
- Health check after update: covered by Task 3.
- Documentation: covered by Task 5.

No unresolved placeholders are present. The plan intentionally does not execute real Docker backup, restore, update, or rollback commands during automated verification because those affect live app data.
