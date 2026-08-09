import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseEnvText,
  REQUIRED_PRODUCTION_KEYS,
  OPTIONAL_PRODUCTION_KEYS,
  createEnvReport,
  createOriginReport,
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
