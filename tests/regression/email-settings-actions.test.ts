import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  requireEmailSettingsAdmin,
  sendTestEmailCore,
  type EmailSettingsActionInput,
} from '../../src/lib/email-settings-action-core'

const testInput: EmailSettingsActionInput = {
  enabled: false,
  provider: 'custom',
  host: 'smtp.example.com',
  port: 587,
  username: 'smtp-user',
  password: 'smtp-secret',
  fromAddress: 'Approval App <no-reply@example.com>',
  noAuth: false,
}

describe('email-settings server actions', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/server-actions/email-settings.ts'),
    'utf8',
  )
  const coreSource = readFileSync(
    resolve(process.cwd(), 'src/lib/email-settings-action-core.ts'),
    'utf8',
  )

  it('behaviorally rejects a missing admin id', async () => {
    await assert.rejects(
      requireEmailSettingsAdmin(async () => null),
      /Admin access required/,
    )
    assert.equal(
      await requireEmailSettingsAdmin(async () => 'admin-1'),
      'admin-1',
    )
  })

  it('sends a test while notifications are disabled to the DB admin without writes', async () => {
    let lookedUpAdminId = ''
    let settingsWrites = 0
    let sentMail: { to: string; from: string } | undefined
    const store = {
      findAdminEmail: async (adminId: string) => {
        lookedUpAdminId = adminId
        return 'db-admin@example.com'
      },
      findEmailSettings: async () => null,
      upsertEmailSettings: async () => {
        settingsWrites += 1
      },
    }

    const result = await sendTestEmailCore('admin-42', testInput, {
      store,
      env: {},
      createTransport: () => ({
        sendMail: async (message) => {
          sentMail = { to: message.to, from: message.from }
        },
      }),
    })

    assert.deepEqual(result, { success: true })
    assert.equal(lookedUpAdminId, 'admin-42')
    assert.deepEqual(sentMail, {
      to: 'db-admin@example.com',
      from: 'Approval App <no-reply@example.com>',
    })
    assert.equal(settingsWrites, 0)
  })

  it('sends the test to an explicit recipient instead of the admin email', async () => {
    let sentTo = ''
    const result = await sendTestEmailCore(
      'admin-42',
      { ...testInput, toAddress: 'you@new-flows.com' },
      {
        store: {
          findAdminEmail: async () => 'admin@example.com',
          findEmailSettings: async () => null,
        },
        env: {},
        createTransport: () => ({
          sendMail: async (message) => {
            sentTo = message.to
          },
        }),
      },
    )

    assert.deepEqual(result, { success: true })
    assert.equal(sentTo, 'you@new-flows.com')
  })

  it('explains Resend example.com recipient rejections', async () => {
    const result = await sendTestEmailCore('admin-42', testInput, {
      store: {
        findAdminEmail: async () => 'admin@example.com',
        findEmailSettings: async () => null,
      },
      env: {},
      createTransport: () => ({
        sendMail: async () => {
          throw new Error(
            'Message failed: 550 Invalid `to` field. Please use our testing email address instead of domains like `example.com`.',
          )
        },
      }),
    })

    assert.equal(result.success, false)
    if (!result.success) {
      assert.match(result.error, /Resend rejected the recipient/i)
      assert.match(result.error, /example\.com/)
      assert.match(result.error, /Send test to/i)
    }
  })

  it('returns a sanitized test-delivery failure without writing settings', async () => {
    let settingsWrites = 0
    const store = {
      findAdminEmail: async () => 'db-admin@example.com',
      findEmailSettings: async () => null,
      upsertEmailSettings: async () => {
        settingsWrites += 1
      },
    }

    const result = await sendTestEmailCore('admin-42', testInput, {
      store,
      env: {},
      createTransport: () => ({
        sendMail: async () => {
          throw new Error(`Authentication failed for ${testInput.password}`)
        },
      }),
    })

    assert.equal(result.success, false)
    if (!result.success) {
      assert.match(result.error, /Authentication failed/)
      assert.doesNotMatch(result.error, /smtp-secret/)
    }
    assert.equal(settingsWrites, 0)
  })

  it('rejects a null requireAdmin result in every exported action', () => {
    assert.match(source, /async function requireAdminUser/)
    assert.match(source, /requireEmailSettingsAdmin\(requireAdmin\)/)
    assert.match(
      coreSource,
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

  it('redacts resolved and imported env credentials from test-send errors', () => {
    assert.match(coreSource, /let resolvedPassword/)
    assert.match(coreSource, /let importedEnvPassword/)
    assert.match(
      coreSource,
      /sanitizeSmtpErrorWithSecrets\(\s*error,\s*\[\s*resolvedPassword,\s*importedEnvPassword,?\s*\]/,
    )
  })

  it('shows provider setup instructions without exposing password placeholders as values', () => {
    const form = readFileSync(
      resolve(process.cwd(), 'src/components/admin/email-settings-form.tsx'),
      'utf8',
    )
    assert.match(form, /Send test to/)
    assert.match(form, /resend.com\/api-keys/)
    assert.match(form, /smtp.mailgun.org/)
    assert.match(form, /Mailgun Domains/)
    assert.match(form, /myaccount.google.com\/apppasswords/)
    assert.match(form, /SMTP AUTH/)
    assert.match(form, /OAuth/)
    assert.match(form, /placeholder=\{.*hasPassword/)
    assert.doesNotMatch(form, /value=\{['"]••••/)
    assert.match(
      form,
      /if \(preset\.username !== undefined\) setUsername\(preset\.username\)/,
    )
    assert.doesNotMatch(form, /setUsername\(preset\.username \?\? ['"]['"]\)/)
  })
})
