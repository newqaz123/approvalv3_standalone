/**
 * Client-safe email preset data. This module must stay free of Node-only
 * imports (no node:crypto, nodemailer, Prisma) because the admin email
 * settings form (a client component) imports `applyEmailPreset` and
 * `EmailSettingsPublic` directly from the browser bundle. Server-only
 * resolution and crypto live in `./email-settings` and `./email-crypto`.
 */

export const EMAIL_PROVIDERS = ['resend', 'gmail', 'outlook', 'custom'] as const
export type EmailProvider = (typeof EMAIL_PROVIDERS)[number]

export type EmailSettingsPublic = {
  source: 'env' | 'admin' | 'none'
  enabled: boolean
  provider: EmailProvider
  host: string
  port: number
  username: string
  fromAddress: string
  hasPassword: boolean
  needsPasswordReset: boolean
  noAuth: boolean
}

const PRESETS: Record<
  Exclude<EmailProvider, 'custom'>,
  { host: string; port: number; username?: string }
> = {
  resend: { host: 'smtp.resend.com', port: 587, username: 'resend' },
  gmail: { host: 'smtp.gmail.com', port: 587 },
  outlook: { host: 'smtp.office365.com', port: 587 },
}

export function applyEmailPreset(provider: EmailProvider): {
  provider: EmailProvider
  host?: string
  port?: number
  username?: string
} {
  if (provider === 'custom') {
    return { provider }
  }
  return { provider, ...PRESETS[provider] }
}
