import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('email-settings server actions', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/server-actions/email-settings.ts'),
    'utf8',
  )

  it('rejects a null requireAdmin result in every exported action', () => {
    assert.match(source, /async function requireAdminUser/)
    assert.match(
      source,
      /if \(!adminId\) \{[\s\S]*?throw new Error\('Admin access required'\)/,
    )
    assert.match(source, /export async function getEmailSettingsForAdmin/)
    assert.match(source, /export async function saveEmailSettings/)
    assert.match(source, /export async function sendTestEmail/)
    for (const name of [
      'getEmailSettingsForAdmin',
      'saveEmailSettings',
      'sendTestEmail',
    ]) {
      const start = source.indexOf(`export async function ${name}`)
      assert.notEqual(start, -1, name)
      const slice = source.slice(start, start + 800)
      assert.match(slice, /requireAdminUser/)
    }
  })

  it('never returns password or ciphertext fields', () => {
    assert.doesNotMatch(source, /passwordEncrypted,/)
    assert.doesNotMatch(source, /SMTP_PASS/)
    assert.match(source, /hasPassword/)
    assert.match(source, /needsPasswordReset/)
  })

  it('loads the test recipient from Prisma by admin id', () => {
    assert.match(source, /prisma\.user\.findUnique/)
    assert.match(source, /where: \{ id: adminId \}/)
    assert.match(source, /select: \{ email: true \}/)
    assert.doesNotMatch(source, /session\.user\.email/)
  })

  it('does not write the database during test send', () => {
    const start = source.indexOf('export async function sendTestEmail')
    const slice = source.slice(start)
    assert.doesNotMatch(
      slice,
      /prisma\.email_settings\.(create|update|upsert)/,
    )
  })
})
