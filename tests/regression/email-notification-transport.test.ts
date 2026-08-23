import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('notification SMTP transport', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/server-actions/notifications.ts'),
    'utf8',
  )

  it('does not create a module-level transporter from env', () => {
    assert.doesNotMatch(source, /const transporter = process\.env\.SMTP_HOST/)
    assert.match(source, /resolveRuntimeEmailTransport/)
    assert.match(source, /nodemailer\.createTransport/)
  })

  it('skips notification mail when resolver is not ready', () => {
    assert.match(source, /needsPasswordReset|disabled|unconfigured/)
  })

  it('uses the resolved sender and creates one transporter per send', () => {
    assert.match(source, /from: resolved\.from/)
    assert.match(source, /await resolveNotificationTransport\(\)/)
    assert.match(
      source,
      /createTransport:\s*\(options\)\s*=>\s*nodemailer\.createTransport\(options\)/,
    )
  })

  it('reads saved settings by the singleton id', () => {
    assert.match(source, /prisma\.email_settings\.findUnique\([\s\S]*?where: \{ id: ['"]default['"] \}/)
    assert.match(source, /readEnvEmailConfig\(process\.env\)/)
    assert.match(source, /decryptEmailSecret\(envelope, aad\)/)
  })
})
