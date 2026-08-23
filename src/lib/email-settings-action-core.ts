import {
  buildEmailSecretAad,
  decryptEmailSecret,
} from './email-crypto'
import {
  buildTransporterOptions,
  decidePasswordOnSave,
  normalizeEmailIdentity,
  parseEmailPort,
  readEnvEmailConfig,
  sanitizeSmtpErrorWithSecrets,
  validateFromAddress,
  type TransporterOptions,
} from './email-settings'
import {
  EMAIL_PROVIDERS,
  type EmailProvider,
} from './email-presets'

export type EmailSettingsActionResult =
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
  toAddress?: string
}

export type ValidatedEmailSettingsInput = Omit<
  EmailSettingsActionInput,
  'host' | 'port' | 'username' | 'fromAddress'
> & {
  host: string
  port: number
  username: string
  fromAddress: string
}

export type StoredPasswordRow = {
  host: string
  port: number
  username: string | null
  passwordEncrypted: string | null
}

export function isEmailProvider(value: string): value is EmailProvider {
  return EMAIL_PROVIDERS.some((provider) => provider === value)
}

export function validateEmailSettingsInput(
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

export function canReuseStoredPassword(row: StoredPasswordRow) {
  if (!row.passwordEncrypted) return false
  const identity = normalizeEmailIdentity(row)
  try {
    decryptEmailSecret(row.passwordEncrypted, buildEmailSecretAad(identity))
    return true
  } catch {
    return false
  }
}

export function passwordIdentity(row: StoredPasswordRow | null) {
  if (!row) return null
  return {
    host: row.host,
    port: row.port,
    username: row.username,
    hasEncrypted: canReuseStoredPassword(row),
  }
}

export function explainTestEmailError(message: string) {
  if (/550/i.test(message) && /example\.com/i.test(message) && /\bto\b/i.test(message)) {
    return 'Resend rejected the recipient. It will not deliver to example.com addresses. Enter a real inbox in “Send test to” — usually the email you used to sign up for Resend, or an address on your verified domain.'
  }
  return message
}

function resolveTestRecipient(toAddress: string | undefined, adminEmail: string) {
  const explicit = toAddress?.trim() ?? ''
  if (!explicit) {
    return { ok: true as const, email: adminEmail }
  }
  const validation = validateFromAddress(explicit)
  if (!validation.ok) {
    return {
      ok: false as const,
      error: validation.error.replace(/From address/g, 'Test recipient'),
    }
  }
  const angled = explicit.match(/<([^>]+)>$/)
  return { ok: true as const, email: angled ? angled[1].trim() : explicit }
}

export async function requireEmailSettingsAdmin(
  checkAdmin: () => Promise<string | null>,
) {
  const adminId = await checkAdmin()
  if (!adminId) {
    throw new Error('Admin access required')
  }
  return adminId
}

export type TestEmailMessage = {
  from: string
  to: string
  subject: string
  text: string
}

export type TestEmailTransport = {
  sendMail(message: TestEmailMessage): Promise<unknown>
}

export type TestEmailSettingsStore = {
  findAdminEmail(adminId: string): Promise<string | null>
  findEmailSettings(): Promise<StoredPasswordRow | null>
}

export async function sendTestEmailCore(
  adminId: string,
  input: EmailSettingsActionInput,
  {
    store,
    createTransport,
    env = process.env,
  }: {
    store: TestEmailSettingsStore
    createTransport(options: TransporterOptions): TestEmailTransport
    env?: Record<string, string | undefined>
  },
): Promise<EmailSettingsActionResult> {
  const validated = validateEmailSettingsInput(input)
  if (!validated.ok) {
    return { success: false, error: validated.error }
  }

  let resolvedPassword = validated.value.password
  let importedEnvPassword = ''

  try {
    const value = validated.value
    const [adminEmail, existing] = await Promise.all([
      store.findAdminEmail(adminId),
      store.findEmailSettings(),
    ])

    if (!adminEmail) {
      return { success: false, error: 'Your admin account has no email address' }
    }

    const recipient = resolveTestRecipient(input.toAddress, adminEmail)
    if (!recipient.ok) {
      return { success: false, error: recipient.error }
    }

    const envConfig = readEnvEmailConfig(env)
    const decision = decidePasswordOnSave({
      host: value.host,
      port: value.port,
      username: value.username,
      password: value.password,
      noAuth: value.noAuth,
      provider: value.provider,
      existing: passwordIdentity(existing),
      env: {
        host: envConfig.host,
        port: envConfig.port,
        username: envConfig.username,
        hasPass: Boolean(envConfig.password),
      },
    })
    if (!decision.ok) {
      return { success: false, error: decision.error }
    }

    const identity = normalizeEmailIdentity(value)
    const aad = buildEmailSecretAad(identity)
    switch (decision.action) {
      case 'encrypt':
        resolvedPassword = decision.password
        break
      case 'keep':
        if (!existing?.passwordEncrypted) {
          return {
            success: false,
            error: 'Re-enter the password for this SMTP server',
          }
        }
        try {
          resolvedPassword = decryptEmailSecret(existing.passwordEncrypted, aad)
        } catch {
          return {
            success: false,
            error: 'Stored SMTP password could not be read. Re-enter it.',
          }
        }
        break
      case 'import-env':
        if (!envConfig.password) {
          return {
            success: false,
            error: 'Re-enter the password for this SMTP server',
          }
        }
        importedEnvPassword = envConfig.password
        resolvedPassword = importedEnvPassword
        break
      case 'none':
        resolvedPassword = ''
        break
    }

    // Test send is an explicit admin probe and intentionally ignores the
    // notification master toggle in `value.enabled`.
    const transporter = createTransport(
      buildTransporterOptions({
        host: identity.host,
        port: identity.port,
        username: identity.username,
        password: resolvedPassword,
        fromAddress: value.fromAddress,
        source: 'db',
      }),
    )

    await transporter.sendMail({
      from: value.fromAddress,
      to: recipient.email,
      subject: 'Approval App test email',
      text: 'SMTP test from Admin → Email notifications.',
    })

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: explainTestEmailError(
        sanitizeSmtpErrorWithSecrets(error, [
          resolvedPassword,
          importedEnvPassword,
        ]),
      ),
    }
  }
}
