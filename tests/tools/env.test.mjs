import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  parseEnvText,
  REQUIRED_PRODUCTION_KEYS,
  OPTIONAL_PRODUCTION_KEYS,
  createEnvReport,
  createOriginReport,
  createRuntimeReport,
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
SMTP_PORT="587"
`)
  const current = parseEnvText(`
DATABASE_URL="postgresql://postgres:changeme@db:5432/app_db?schema=public"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET=""
SMTP_HOST=""
`)

  const report = createEnvReport({ current, template })

  assert.deepEqual(report.missingRequired.sort(), [
    'AUTH_URL',
    'AUTH_TRUST_HOST',
    'CRON_SECRET',
    'NEXTAUTH_SECRET',
    'NEXT_PUBLIC_APP_URL',
    'POSTGRES_DB',
    'POSTGRES_PASSWORD',
    'POSTGRES_USER',
    'UPLOAD_DIR',
  ].sort())
  assert.deepEqual(report.missingOptional, ['SMTP_PORT'])
  assert.deepEqual(report.presentRequired, ['DATABASE_URL', 'NEXTAUTH_URL'])
  assert.equal(REQUIRED_PRODUCTION_KEYS.includes('DATABASE_URL'), true)
  assert.equal(OPTIONAL_PRODUCTION_KEYS.includes('SMTP_HOST'), true)
})

test('createOriginReport accepts one HTTPS production origin', () => {
  const report = createOriginReport({
    AUTH_URL: 'https://approval.example.com/',
    NEXTAUTH_URL: 'https://approval.example.com',
    NEXT_PUBLIC_APP_URL: 'https://approval.example.com',
    AUTH_TRUST_HOST: 'true',
  })
  assert.deepEqual(report.issues, [])
  assert.equal(report.origin, 'https://approval.example.com')
})

test('createOriginReport rejects localhost and conflicting production origins', () => {
  const report = createOriginReport({
    AUTH_URL: 'http://localhost:3000',
    NEXTAUTH_URL: 'https://approval.example.com',
    NEXT_PUBLIC_APP_URL: 'https://other.example.com',
    AUTH_TRUST_HOST: 'false',
  })
  assert.equal(report.issues.some((issue) => issue.includes('localhost')), true)
  assert.equal(report.issues.some((issue) => issue.includes('same origin')), true)
  assert.equal(report.issues.some((issue) => issue.includes('AUTH_TRUST_HOST=true')), true)
})

test('createEnvReport includes origin issues from auth origin keys', () => {
  const template = parseEnvText(`
AUTH_URL="https://approval.example.com"
NEXTAUTH_URL="https://approval.example.com"
NEXT_PUBLIC_APP_URL="https://approval.example.com"
AUTH_TRUST_HOST="true"
`)
  const current = parseEnvText(`
AUTH_URL="http://localhost:3000"
NEXTAUTH_URL="https://approval.example.com"
NEXT_PUBLIC_APP_URL="https://other.example.com"
AUTH_TRUST_HOST="false"
`)

  const report = createEnvReport({ current, template })

  assert.equal(report.originIssues.some((issue) => issue.includes('localhost')), true)
  assert.equal(report.originIssues.some((issue) => issue.includes('same origin')), true)
  assert.equal(report.originIssues.some((issue) => issue.includes('AUTH_TRUST_HOST=true')), true)
})

test('mergeMissingEnvKeys appends only missing template keys', () => {
  const currentText = 'DATABASE_URL="postgresql://postgres:changeme@db:5432/app_db?schema=public"\n'
  const templateText = [
    'DATABASE_URL="postgresql://postgres:changeme@db:5432/app_db?schema=public"',
    'NEXTAUTH_URL="http://localhost:3000"',
    'NEXTAUTH_SECRET="generate-with-openssl-rand-base64-32"',
  ].join('\n')

  const merged = mergeMissingEnvKeys({ currentText, templateText })

  assert.match(merged, /DATABASE_URL=/)
  assert.match(merged, /NEXTAUTH_URL=/)
  assert.match(merged, /NEXTAUTH_SECRET=/)
  assert.equal((merged.match(/DATABASE_URL=/g) || []).length, 1)
})

test('createOriginReport requires one HTTPS production origin', () => {
  const report = createOriginReport({
    AUTH_URL: 'http://approval.example.com',
    NEXTAUTH_URL: 'http://approval.example.com',
    NEXT_PUBLIC_APP_URL: 'http://approval.example.com',
    AUTH_TRUST_HOST: 'true',
  })
  assert.match(report.issues.join('\n'), /HTTPS/)
})

test('createOriginReport rejects non-HTTPS schemes such as ftp', () => {
  const report = createOriginReport({
    AUTH_URL: 'ftp://approval.example.com',
    NEXTAUTH_URL: 'ftp://approval.example.com',
    NEXT_PUBLIC_APP_URL: 'ftp://approval.example.com',
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

test('createRuntimeReport requires a PostgreSQL DATABASE_URL', () => {
  const report = createRuntimeReport({
    DATABASE_URL: 'mysql://app-user:strong-password@db:5432/app_db',
    POSTGRES_USER: 'app-user',
    POSTGRES_PASSWORD: 'strong-password',
    POSTGRES_DB: 'app_db',
    UPLOAD_DIR: '/app/uploads',
    NEXTAUTH_SECRET: 'a-production-secret-with-32-characters',
    CRON_SECRET: 'another-production-secret-value',
  })
  assert.match(report.issues.join('\n'), /PostgreSQL/)
})

test('env-check CLI exits 1 on runtime issues and never prints secret values', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'approval-envcheck-'))
  const envPath = path.join(dir, '.env.production')
  const templatePath = path.join(dir, '.env.example')
  const secretValue = 'SUPER-SECRET-SENTINEL'

  await writeFile(templatePath, [
    'AUTH_URL="https://approval.example.com"',
    'NEXTAUTH_URL="https://approval.example.com"',
    'NEXT_PUBLIC_APP_URL="https://approval.example.com"',
    'AUTH_TRUST_HOST="true"',
    'NEXTAUTH_SECRET="placeholder"',
    'CRON_SECRET="placeholder"',
    'DATABASE_URL="postgresql://app-user:strong-password@db:5432/app_db?schema=public"',
    'POSTGRES_USER="app-user"',
    'POSTGRES_PASSWORD="strong-password"',
    'POSTGRES_DB="app_db"',
    'UPLOAD_DIR="/app/uploads"',
  ].join('\n'))

  await writeFile(envPath, [
    'AUTH_URL="https://approval.example.com"',
    'NEXTAUTH_URL="https://approval.example.com"',
    'NEXT_PUBLIC_APP_URL="https://approval.example.com"',
    'AUTH_TRUST_HOST="true"',
    `NEXTAUTH_SECRET="${secretValue}"`,
    'CRON_SECRET="another-real-secret-value"',
    'DATABASE_URL="postgresql://app-user:strong-password@db:5432/app_db?schema=public"',
    'POSTGRES_USER="app-user"',
    'POSTGRES_PASSWORD="strong-password"',
    'POSTGRES_DB="app_db"',
    'UPLOAD_DIR="public/uploads"',
  ].join('\n'))

  const result = spawnSync(process.execPath, [
    'tools/env-check.mjs',
    '--env', envPath,
    '--template', templatePath,
  ], { cwd: process.cwd(), encoding: 'utf8' })

  assert.equal(result.status, 1)
  assert.match(result.stdout + result.stderr, /UPLOAD_DIR/)
  assert.doesNotMatch(result.stdout + result.stderr, /SUPER-SECRET-SENTINEL/)
})

test('env-check CLI exits 0 and reports success for a valid production config', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'approval-envcheck-'))
  const envPath = path.join(dir, '.env.production')
  const templatePath = path.join(dir, '.env.example')

  await writeFile(templatePath, [
    'AUTH_URL="https://approval.example.com"',
    'NEXTAUTH_URL="https://approval.example.com"',
    'NEXT_PUBLIC_APP_URL="https://approval.example.com"',
    'AUTH_TRUST_HOST="true"',
    'NEXTAUTH_SECRET="placeholder"',
    'CRON_SECRET="placeholder"',
    'DATABASE_URL="postgresql://app-user:strong-password@db:5432/app_db?schema=public"',
    'POSTGRES_USER="app-user"',
    'POSTGRES_PASSWORD="strong-password"',
    'POSTGRES_DB="app_db"',
    'UPLOAD_DIR="/app/uploads"',
  ].join('\n'))

  await writeFile(envPath, [
    'AUTH_URL="https://approval.example.com"',
    'NEXTAUTH_URL="https://approval.example.com"',
    'NEXT_PUBLIC_APP_URL="https://approval.example.com"',
    'AUTH_TRUST_HOST="true"',
    'NEXTAUTH_SECRET="a-production-secret-with-32-characters"',
    'CRON_SECRET="another-production-secret-value"',
    'DATABASE_URL="postgresql://app-user:strong-password@db:5432/app_db?schema=public"',
    'POSTGRES_USER="app-user"',
    'POSTGRES_PASSWORD="strong-password"',
    'POSTGRES_DB="app_db"',
    'UPLOAD_DIR="/app/uploads"',
  ].join('\n'))

  const result = spawnSync(process.execPath, [
    'tools/env-check.mjs',
    '--env', envPath,
    '--template', templatePath,
  ], { cwd: process.cwd(), encoding: 'utf8' })

  assert.equal(result.status, 0)
  assert.match(result.stdout + result.stderr, /Environment check passed/)
})
