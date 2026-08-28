import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderDescriptionHtml } from '@/lib/formatted-text'

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

  it('keeps private inline image locations out of materialized notification descriptions', () => {
    const html = renderDescriptionHtml(
      '<p><mark data-highlight="pink">Receipt <img src="/api/inline-images/123e4567-e89b-42d3-a456-426614174000" alt="invoice"></mark></p>',
      40,
    )

    assert.equal(
      html,
      '<p><mark style="background-color:#FCE7F3">Receipt [Image: invoice]</mark></p>',
    )
    assert.doesNotMatch(html, /\/api\/inline-images|data:|<img/i)
  })

  it('fix 3: redacts private image references embedded in notification image alt text', () => {
    const html = renderDescriptionHtml(
      '<p><mark data-highlight="pink"><img src="/api/inline-images/123e4567-e89b-42d3-a456-426614174000" alt="receipt /api/inline-images/123e4567-e89b-42d3-a456-426614174001 data:image/png;base64,AAAA"></mark></p>',
    )

    assert.match(html, /\[Image: receipt .* .*\]/)
    assert.doesNotMatch(html, /\/api\/inline-images\/[0-9a-f-]{36}|data:image\//i)
  })
})
