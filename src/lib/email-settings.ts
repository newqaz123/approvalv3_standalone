import { buildEmailSecretAad, decryptEmailSecret } from './email-crypto'
import type { EmailProvider } from './email-presets'

// Presets and public types stay client-safe in ./email-presets so the admin
// form never pulls this (node:crypto-dependent) module into the browser
// build. Re-exported here so server callers can import from either module.
export { EMAIL_PROVIDERS, applyEmailPreset } from './email-presets'
export type { EmailProvider, EmailSettingsPublic } from './email-presets'

/**
 * Pure SMTP settings logic: identity binding, validation, password-reuse
 * decisions, runtime config resolution, and Nodemailer option shaping.
 * Server-only callers pass the row/env in; nothing here touches Prisma or
 * Nodemailer so every rule stays unit-testable.
 */

export type EmailIdentity = {
  host: string
  port: number
  username: string
}

export type ResolvedEmailConfig = {
  host: string
  port: number
  username: string
  password: string
  fromAddress: string
  source: 'env' | 'db'
}

export type EnvEmailConfig = {
  host: string
  port: number
  username: string
  password: string
  fromAddress: string
}

export type EmailSettingsRowInput = {
  enabled: boolean
  host: string
  port: number
  username?: string | null
  passwordEncrypted?: string | null
  fromAddress: string
}

export type ResolvedRuntimeEmailConfig =
  | { status: 'ready'; config: ResolvedEmailConfig }
  | { status: 'unconfigured' }
  | { status: 'disabled' }
  | { status: 'invalid' }
  | { status: 'needsPasswordReset' }

export type ResolvedEmailTransport<TTransport> =
  | {
      ok: true
      from: string
      password: string
      transporter: TTransport
    }
  | {
      ok: false
      reason: Exclude<ResolvedRuntimeEmailConfig['status'], 'ready'>
    }

export type TransporterOptions = {
  host: string
  port: number
  secure: boolean
  requireTLS: boolean
  connectionTimeout: number
  greetingTimeout: number
  socketTimeout: number
  auth?: { user: string; pass: string }
}

const SMTP_TIMEOUT_MS = 10_000
const DEFAULT_SMTP_PORT = 587

export function normalizeEmailIdentity({
  host,
  port,
  username,
}: {
  host: string | null | undefined
  port: number | string | null | undefined
  username?: string | null
}): EmailIdentity {
  return {
    host: (host ?? '').trim().toLowerCase(),
    port: Number(port),
    username: (username ?? '').trim(),
  }
}

export function identitiesMatch(
  a: {
    host: string | null | undefined
    port: number | string | null | undefined
    username?: string | null
  },
  b: {
    host: string | null | undefined
    port: number | string | null | undefined
    username?: string | null
  },
): boolean {
  const left = normalizeEmailIdentity(a)
  const right = normalizeEmailIdentity(b)
  return (
    left.host === right.host &&
    left.port === right.port &&
    left.username === right.username
  )
}

export function parseEmailPort(
  value: string | number,
): { ok: true; port: number } | { ok: false; error: string } {
  const port =
    typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return {
      ok: false,
      error: 'Port must be a whole number between 1 and 65535',
    }
  }
  return { ok: true, port }
}

// One mailbox only: `local@domain` or `Display Name <local@domain>`.
// CR/LF and address-list separators are rejected so the value cannot inject
// headers or additional recipients into the SMTP envelope.
export function validateFromAddress(
  value: string,
): { ok: true } | { ok: false; error: string } {
  const trimmed = value.trim()
  if (!trimmed) {
    return { ok: false, error: 'From address is required' }
  }
  if (/[\r\n]/.test(trimmed)) {
    return { ok: false, error: 'From address must not contain line breaks' }
  }
  if (/[,;]/.test(trimmed) || (trimmed.match(/</g) ?? []).length > 1) {
    return { ok: false, error: 'From address must be a single mailbox' }
  }
  const displayForm = /^[^<>]+<[^\s@<>]+@[^\s@<>]+>$/
  const bareForm = /^[^\s@,;<>]+@[^\s@,;<>]+$/
  if (!displayForm.test(trimmed) && !bareForm.test(trimmed)) {
    return {
      ok: false,
      error: 'From address must look like "name@example.com" or "Name <name@example.com>"',
    }
  }
  return { ok: true }
}

export function readEnvEmailConfig(
  env: Record<string, string | undefined> = process.env,
): EnvEmailConfig {
  const parsedPort = parseEmailPort(env.SMTP_PORT ?? '')
  return {
    host: (env.SMTP_HOST ?? '').trim(),
    port: parsedPort.ok ? parsedPort.port : DEFAULT_SMTP_PORT,
    username: (env.SMTP_USER ?? '').trim(),
    password: env.SMTP_PASS ?? '',
    fromAddress: (env.SMTP_FROM ?? '').trim(),
  }
}

type PasswordIdentitySource = {
  host: string | null | undefined
  port: number | string | null | undefined
  username?: string | null
}

export type PasswordDecision =
  | { ok: true; action: 'encrypt'; password: string }
  | { ok: true; action: 'keep' }
  | { ok: true; action: 'import-env' }
  | { ok: true; action: 'none' }
  | { ok: false; error: string }

export function decidePasswordOnSave({
  host,
  port,
  username,
  password,
  noAuth,
  provider,
  existing,
  env,
}: {
  host: string
  port: number | string
  username?: string | null
  password?: string | null
  noAuth: boolean
  provider: EmailProvider
  existing: (PasswordIdentitySource & { hasEncrypted: boolean }) | null
  env: (PasswordIdentitySource & { hasPass: boolean }) | null
}): PasswordDecision {
  const identity = normalizeEmailIdentity({ host, port, username })
  // Whitespace decides whether the field is blank, but the credential is
  // stored exactly as typed — SMTP secrets may legitimately contain
  // leading/trailing whitespace, and trimming would silently save a
  // different password than the admin entered.
  const trimmedPassword = (password ?? '').trim()

  if (noAuth && provider !== 'custom') {
    return {
      ok: false,
      error: 'Saving without a password is only allowed for Custom SMTP',
    }
  }

  if (
    noAuth &&
    provider === 'custom' &&
    !identity.username &&
    !trimmedPassword
  ) {
    return { ok: true, action: 'none' }
  }

  if (trimmedPassword && password) {
    return { ok: true, action: 'encrypt', password }
  }

  // A stored password may be reused only for the SMTP identity it was
  // encrypted for — never sent to a different server.
  if (existing && existing.hasEncrypted) {
    if (identitiesMatch(identity, existing)) {
      return { ok: true, action: 'keep' }
    }
  }

  // First env → DB save may import SMTP_PASS only when the identity still
  // matches the environment it came from.
  if (!existing && env && env.hasPass) {
    if (identitiesMatch(identity, env)) {
      return { ok: true, action: 'import-env' }
    }
  }

  return {
    ok: false,
    error: 'Re-enter the password for this SMTP server',
  }
}

export function resolveRuntimeEmailConfig({
  row,
  env,
  decrypt = (envelope, aad) => decryptEmailSecret(envelope, aad),
}: {
  row: EmailSettingsRowInput | null
  env: EnvEmailConfig
  decrypt?: (envelope: string, aad: string) => string
}): ResolvedRuntimeEmailConfig {
  // No saved row: env is the fallback, exactly as before this feature.
  if (!row) {
    if (env.host && env.fromAddress) {
      return {
        status: 'ready',
        config: {
          host: env.host,
          port: env.port,
          username: env.username,
          password: env.password,
          fromAddress: env.fromAddress,
          source: 'env',
        },
      }
    }
    return { status: 'unconfigured' }
  }

  // Master toggle: a saved row that is disabled stops all notification mail,
  // including the env fallback.
  if (!row.enabled) {
    return { status: 'disabled' }
  }

  // A saved row is authoritative: invalid configuration and decrypt failure
  // both fail closed rather than silently falling back to the old env provider.
  const identity = normalizeEmailIdentity(row)
  const parsedPort = parseEmailPort(row.port)
  const fromAddress = row.fromAddress.trim()
  if (
    !identity.host ||
    !parsedPort.ok ||
    !validateFromAddress(fromAddress).ok
  ) {
    return { status: 'invalid' }
  }

  // A username means this row expects SMTP authentication. Without a bound
  // ciphertext there is no credential to use, and env credentials must never
  // be substituted after an admin row exists.
  if (identity.username && !row.passwordEncrypted) {
    return { status: 'needsPasswordReset' }
  }

  let password = ''
  if (row.passwordEncrypted) {
    try {
      password = decrypt(
        row.passwordEncrypted,
        buildEmailSecretAad(identity),
      )
    } catch {
      return { status: 'needsPasswordReset' }
    }
  }

  return {
    status: 'ready',
    config: {
      host: identity.host,
      port: parsedPort.port,
      username: identity.username,
      password,
      fromAddress,
      source: 'db',
    },
  }
}

export function resolveRuntimeEmailTransport<TTransport>({
  row,
  env,
  decrypt,
  createTransport,
}: {
  row: EmailSettingsRowInput | null
  env: EnvEmailConfig
  decrypt?: (envelope: string, aad: string) => string
  createTransport: (options: TransporterOptions) => TTransport
}): ResolvedEmailTransport<TTransport> {
  const resolved = resolveRuntimeEmailConfig({ row, env, decrypt })
  if (resolved.status !== 'ready') {
    return { ok: false, reason: resolved.status }
  }
  return {
    ok: true,
    from: resolved.config.fromAddress,
    password: resolved.config.password,
    transporter: createTransport(buildTransporterOptions(resolved.config)),
  }
}

export function buildTransporterOptions(
  config: ResolvedEmailConfig,
): TransporterOptions {
  const usesAuth = Boolean(config.username || config.password)
  const options: TransporterOptions = {
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    // Authenticated non-465 SMTP must upgrade to TLS rather than send
    // credentials in the clear.
    requireTLS: config.port !== 465 && usesAuth,
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
  }
  if (usesAuth) {
    options.auth = { user: config.username, pass: config.password }
  }
  return options
}

function smtpErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : String(error ?? '')
}

export function redactExactSmtpSecrets(
  message: string,
  secrets: ReadonlyArray<string | null | undefined>,
): string {
  const exactSecrets = [
    ...new Set(
      secrets.filter((secret): secret is string => Boolean(secret)),
    ),
  ].sort((a, b) => b.length - a.length)

  if (exactSecrets.length === 0) return message

  // Replace all exact credentials in one scan. A single pass prevents a
  // short credential from matching inside the [redacted] placeholder that
  // was inserted for a longer credential.
  let result = ''
  let cursor = 0
  while (cursor < message.length) {
    const matched = exactSecrets.find((secret) =>
      message.startsWith(secret, cursor),
    )
    if (matched) {
      result += '[redacted]'
      cursor += matched.length
    } else {
      result += message[cursor]
      cursor += 1
    }
  }
  return result
}

export function sanitizeSmtpError(error: unknown): string {
  const redacted = smtpErrorMessage(error)
    // URI credentials: scheme://user:secret@host → scheme://user:[redacted]@host
    .replace(
      /([a-z][a-z0-9+.-]*:\/\/)([^:@/\s]+):([^@\s]+)@/gi,
      '$1$2:[redacted]@',
    )
    // Quoted JSON-style credentials: "password":"secret" (value may contain spaces)
    .replace(
      /(["']?)(pass(word)?|passwd|pwd|api_?key|token|secret)\1\s*:\s*(["'])(.*?)\4/gi,
      '$1$2$1:$4[redacted]$4',
    )
    // Bare key=value / key:value credentials
    .replace(
      /\b(pass(word)?|passwd|pwd|api_?key|token|secret)\b['"]?\s*[=:]\s*['"]?[^\s,'"\]}]+/gi,
      '$1=[redacted]',
    )
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
  return redacted.length > 300
    ? `${redacted.slice(0, 297)}...`
    : redacted
}

export function sanitizeSmtpErrorWithSecrets(
  error: unknown,
  secrets: ReadonlyArray<string | null | undefined>,
): string {
  // Redact before the 300-character cap so a long credential cannot be
  // truncated into a plaintext prefix that no longer equals the full secret.
  const exactRedacted = redactExactSmtpSecrets(smtpErrorMessage(error), secrets)
  const sanitized = sanitizeSmtpError(exactRedacted)
  // Apply exact redaction again after the structured sanitizer as the final
  // boundary before this diagnostic can cross a Server Action response.
  return redactExactSmtpSecrets(sanitized, secrets)
}
