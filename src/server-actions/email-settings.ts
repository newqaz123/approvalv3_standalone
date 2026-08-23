'use server'

import nodemailer from 'nodemailer'
import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import {
  buildEmailSecretAad,
  decryptEmailSecret,
  encryptEmailSecret,
} from '@/lib/email-crypto'
import {
  buildTransporterOptions,
  decidePasswordOnSave,
  normalizeEmailIdentity,
  parseEmailPort,
  readEnvEmailConfig,
  sanitizeSmtpError,
  validateFromAddress,
} from '@/lib/email-settings'
import {
  applyEmailPreset,
  EMAIL_PROVIDERS,
  type EmailProvider,
  type EmailSettingsPublic,
} from '@/lib/email-presets'
import prisma from '@/lib/prisma'

const EMAIL_SETTINGS_ID = 'default'

type EmailSettingsActionResult =
  | { success: true }
  | { success: false; error: string }

export type EmailSettingsActionInput = {
  enabled: boolean
  provider: EmailProvider
  host: string
  port: string | number
  username: string
  password: string
  fromAddress: string
  noAuth: boolean
}

type ValidatedEmailSettingsInput = Omit<
  EmailSettingsActionInput,
  'host' | 'port' | 'username' | 'fromAddress'
> & {
  host: string
  port: number
  username: string
  fromAddress: string
}

async function requireAdminUser() {
  const adminId = await requireAdmin()
  if (!adminId) {
    throw new Error('Admin access required')
  }
  return adminId
}

function isEmailProvider(value: string): value is EmailProvider {
  return EMAIL_PROVIDERS.some((provider) => provider === value)
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

function validateEmailSettingsInput(
  input: EmailSettingsActionInput,
):
  | { ok: true; value: ValidatedEmailSettingsInput }
  | { ok: false; error: string } {
  if (
    !input ||
    typeof input !== 'object' ||
    typeof input.provider !== 'string' ||
    !isEmailProvider(input.provider)
  ) {
    return { ok: false, error: 'Choose a valid email provider' }
  }
  if (typeof input.enabled !== 'boolean' || typeof input.noAuth !== 'boolean') {
    return { ok: false, error: 'Email settings flags are invalid' }
  }
  if (
    typeof input.host !== 'string' ||
    typeof input.username !== 'string' ||
    typeof input.password !== 'string' ||
    typeof input.fromAddress !== 'string'
  ) {
    return { ok: false, error: 'Email settings fields are invalid' }
  }
  if (typeof input.port !== 'string' && typeof input.port !== 'number') {
    return { ok: false, error: 'SMTP port is invalid' }
  }

  const host = input.host.trim()
  if (!host) {
    return { ok: false, error: 'SMTP host is required' }
  }

  const parsedPort = parseEmailPort(input.port)
  if (!parsedPort.ok) {
    return parsedPort
  }

  const fromAddress = input.fromAddress.trim()
  const fromValidation = validateFromAddress(fromAddress)
  if (!fromValidation.ok) {
    return fromValidation
  }

  return {
    ok: true,
    value: {
      enabled: input.enabled,
      provider: input.provider,
      host,
      port: parsedPort.port,
      username: input.username.trim(),
      password: input.password,
      fromAddress,
      noAuth: input.noAuth,
    },
  }
}

type StoredPasswordRow = {
  host: string
  port: number
  username: string | null
  passwordEncrypted: string | null
}

function canReuseStoredPassword(row: StoredPasswordRow) {
  if (!row.passwordEncrypted) return false
  const identity = normalizeEmailIdentity(row)
  try {
    const encryptedPassword = row.passwordEncrypted
    decryptEmailSecret(encryptedPassword, buildEmailSecretAad(identity))
    return true
  } catch {
    return false
  }
}

function passwordIdentity(row: StoredPasswordRow | null) {
  if (!row) return null
  return {
    host: row.host,
    port: row.port,
    username: row.username,
    hasEncrypted: canReuseStoredPassword(row),
  }
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

  const validated = validateEmailSettingsInput(input)
  if (!validated.ok) {
    return { success: false, error: validated.error }
  }

  try {
    const value = validated.value
    const [admin, existing] = await Promise.all([
      prisma.user.findUnique({
        where: { id: adminId },
        select: { email: true },
      }),
      prisma.email_settings.findUnique({
        where: { id: EMAIL_SETTINGS_ID },
        select: {
          host: true,
          port: true,
          username: true,
          passwordEncrypted: true,
        },
      }),
    ])

    if (!admin?.email) {
      return { success: false, error: 'Your admin account has no email address' }
    }

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
    let password: string
    switch (decision.action) {
      case 'encrypt':
        password = decision.password
        break
      case 'keep':
        if (!existing?.passwordEncrypted) {
          return {
            success: false,
            error: 'Re-enter the password for this SMTP server',
          }
        }
        try {
          const encryptedPassword = existing.passwordEncrypted
          password = decryptEmailSecret(encryptedPassword, aad)
        } catch {
          return {
            success: false,
            error: 'Stored SMTP password could not be read. Re-enter it.',
          }
        }
        break
      case 'import-env':
        if (!env.password) {
          return {
            success: false,
            error: 'Re-enter the password for this SMTP server',
          }
        }
        password = env.password
        break
      case 'none':
        password = ''
        break
    }

    const transporter = nodemailer.createTransport(
      buildTransporterOptions({
        host: identity.host,
        port: identity.port,
        username: identity.username,
        password,
        fromAddress: value.fromAddress,
        source: 'db',
      }),
    )

    await transporter.sendMail({
      from: value.fromAddress,
      to: admin.email,
      subject: 'Approval App test email',
      text: 'SMTP test from Admin → Email notifications.',
    })

    return { success: true }
  } catch (error) {
    return { success: false, error: sanitizeSmtpError(error) }
  }
}
