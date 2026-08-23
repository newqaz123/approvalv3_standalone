'use server'

import nodemailer from 'nodemailer'
import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import {
  buildEmailSecretAad,
  encryptEmailSecret,
} from '@/lib/email-crypto'
import {
  decidePasswordOnSave,
  normalizeEmailIdentity,
  readEnvEmailConfig,
} from '@/lib/email-settings'
import {
  canReuseStoredPassword,
  isEmailProvider,
  passwordIdentity,
  requireEmailSettingsAdmin,
  sendTestEmailCore,
  validateEmailSettingsInput,
  type EmailSettingsActionInput,
  type EmailSettingsActionResult,
} from '@/lib/email-settings-action-core'
import {
  applyEmailPreset,
  type EmailProvider,
  type EmailSettingsPublic,
} from '@/lib/email-presets'
import prisma from '@/lib/prisma'

export type { EmailSettingsActionInput } from '@/lib/email-settings-action-core'

const EMAIL_SETTINGS_ID = 'default'

async function requireAdminUser() {
  return requireEmailSettingsAdmin(requireAdmin)
}

function inferEmailProvider(host: string, username: string): EmailProvider {
  const identity = normalizeEmailIdentity({ host, port: 587, username })
  for (const provider of ['resend', 'gmail', 'outlook'] as const) {
    const preset = applyEmailPreset(provider)
    if (identity.host !== preset.host) continue
    if (preset.username && identity.username !== preset.username) continue
    return provider
  }
  return 'custom'
}

export async function getEmailSettingsForAdmin(): Promise<EmailSettingsPublic> {
  await requireAdminUser()

  const row = await prisma.email_settings.findUnique({
    where: { id: EMAIL_SETTINGS_ID },
    select: {
      enabled: true,
      provider: true,
      host: true,
      port: true,
      username: true,
      fromAddress: true,
      passwordEncrypted: true,
    },
  })

  if (!row) {
    const env = readEnvEmailConfig(process.env)
    const source = env.host && env.fromAddress ? 'env' : 'none'
    return {
      source,
      enabled: true,
      provider: inferEmailProvider(env.host, env.username),
      host: env.host,
      port: env.port,
      username: env.username,
      fromAddress: env.fromAddress,
      hasPassword: Boolean(env.password),
      needsPasswordReset: false,
      noAuth: !env.username && !env.password,
    }
  }

  const hasPassword = Boolean(row.passwordEncrypted)
  const provider = isEmailProvider(row.provider) ? row.provider : 'custom'
  const needsPasswordReset = hasPassword
    ? !canReuseStoredPassword(row)
    : Boolean(row.username || provider !== 'custom')

  return {
    source: 'admin',
    enabled: row.enabled,
    provider,
    host: row.host,
    port: row.port,
    username: row.username ?? '',
    fromAddress: row.fromAddress,
    hasPassword,
    needsPasswordReset,
    noAuth: !(row.username || row.passwordEncrypted),
  }
}

export async function saveEmailSettings(
  input: EmailSettingsActionInput,
): Promise<EmailSettingsActionResult> {
  await requireAdminUser()

  const validated = validateEmailSettingsInput(input)
  if (!validated.ok) {
    return { success: false, error: validated.error }
  }

  try {
    const value = validated.value
    const existing = await prisma.email_settings.findUnique({
      where: { id: EMAIL_SETTINGS_ID },
      select: {
        host: true,
        port: true,
        username: true,
        passwordEncrypted: true,
      },
    })
    const env = readEnvEmailConfig(process.env)

    const decision = decidePasswordOnSave({
      host: value.host,
      port: value.port,
      username: value.username,
      password: value.password,
      noAuth: value.noAuth,
      provider: value.provider,
      existing: passwordIdentity(existing),
      env: {
        host: env.host,
        port: env.port,
        username: env.username,
        hasPass: Boolean(env.password),
      },
    })
    if (!decision.ok) {
      return { success: false, error: decision.error }
    }

    const identity = normalizeEmailIdentity(value)
    const aad = buildEmailSecretAad(identity)
    let encryptedPassword: string | null
    switch (decision.action) {
      case 'encrypt':
        encryptedPassword = encryptEmailSecret(decision.password, aad)
        break
      case 'keep':
        if (!existing?.passwordEncrypted) {
          return {
            success: false,
            error: 'Re-enter the password for this SMTP server',
          }
        }
        encryptedPassword = existing.passwordEncrypted
        break
      case 'import-env':
        if (!env.password) {
          return {
            success: false,
            error: 'Re-enter the password for this SMTP server',
          }
        }
        encryptedPassword = encryptEmailSecret(env.password, aad)
        break
      case 'none':
        encryptedPassword = null
        break
    }

    const data = {
      enabled: value.enabled,
      provider: value.provider,
      host: identity.host,
      port: identity.port,
      username: identity.username || null,
      passwordEncrypted: encryptedPassword,
      fromAddress: value.fromAddress,
    }

    await prisma.email_settings.upsert({
      where: { id: EMAIL_SETTINGS_ID },
      create: { id: EMAIL_SETTINGS_ID, ...data },
      update: data,
    })

    revalidatePath('/admin/email')
    return { success: true }
  } catch {
    // Save errors may contain database fields, including ciphertext. Keep the
    // client response generic; SMTP diagnostics are returned only by test send.
    return { success: false, error: 'Unable to save email settings' }
  }
}

export async function sendTestEmail(
  input: EmailSettingsActionInput,
): Promise<EmailSettingsActionResult> {
  const adminId = await requireAdminUser()

  return sendTestEmailCore(adminId, input, {
    env: process.env,
    store: {
      findAdminEmail: async (adminId) => {
        const admin = await prisma.user.findUnique({
          where: { id: adminId },
          select: { email: true },
        })
        return admin?.email ?? null
      },
      findEmailSettings: () =>
        prisma.email_settings.findUnique({
          where: { id: EMAIL_SETTINGS_ID },
          select: {
            host: true,
            port: true,
            username: true,
            passwordEncrypted: true,
          },
        }),
    },
    createTransport: (options) => {
      const transporter = nodemailer.createTransport(options)
      return {
        sendMail: (message) => transporter.sendMail(message),
      }
    },
  })
}
