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
NEXTAUTH_SECRET=""
SMTP_HOST=""
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
  assert.deepEqual(report.missingOptional, [])
  assert.equal(REQUIRED_PRODUCTION_KEYS.includes('DATABASE_URL'), true)
  assert.equal(OPTIONAL_PRODUCTION_KEYS.includes('SMTP_HOST'), true)
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
