export const REQUIRED_PRODUCTION_KEYS = [
  'DATABASE_URL',
  'AUTH_URL',
  'AUTH_TRUST_HOST',
  'NEXTAUTH_URL',
  'NEXTAUTH_SECRET',
  'NEXT_PUBLIC_APP_URL',
  'UPLOAD_DIR',
  'CRON_SECRET',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DB',
]

export const OPTIONAL_PRODUCTION_KEYS = [
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_FROM',
  'ARCHIVE_AFTER_DAYS',
  'PUPPETEER_EXECUTABLE_PATH',
]

export function parseEnvText(text) {
  const result = {}

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const equalsIndex = line.indexOf('=')
    if (equalsIndex === -1) continue

    const key = line.slice(0, equalsIndex).trim()
    let value = line.slice(equalsIndex + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    if (key) result[key] = value
  }

  return result
}

export function normalizeOrigin(value) {
  if (!value) return null
  try {
    const url = new URL(value)
    return `${url.protocol}//${url.host}`
  } catch {
    return null
  }
}

export function createOriginReport(current) {
  const entries = ['AUTH_URL', 'NEXTAUTH_URL', 'NEXT_PUBLIC_APP_URL']
    .map((key) => [key, normalizeOrigin(current[key])])
  const issues = []
  for (const [key, origin] of entries) {
    if (!origin) issues.push(`${key} must be a valid absolute URL`)
    else if (/^http:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(origin)) issues.push(`${key} must not use localhost in production`)
  }
  const distinct = new Set(entries.map(([, origin]) => origin).filter(Boolean))
  if (distinct.size > 1) issues.push('AUTH_URL, NEXTAUTH_URL, and NEXT_PUBLIC_APP_URL must use the same origin')
  if (current.AUTH_TRUST_HOST !== 'true') issues.push('AUTH_TRUST_HOST=true is required behind the production reverse proxy')
  return { origin: distinct.size === 1 ? [...distinct][0] : null, issues }
}

export function createEnvReport({ current, template }) {
  const templateKeys = Object.keys(template)
  const missingRequired = REQUIRED_PRODUCTION_KEYS.filter((key) => !current[key])
  const missingOptional = templateKeys
    .filter((key) => OPTIONAL_PRODUCTION_KEYS.includes(key))
    .filter((key) => !(key in current))

  return {
    missingRequired,
    missingOptional,
    unknownKeys: Object.keys(current).filter((key) => !templateKeys.includes(key)),
    presentRequired: REQUIRED_PRODUCTION_KEYS.filter((key) => current[key]),
    originIssues: createOriginReport(current).issues,
  }
}

export function mergeMissingEnvKeys({ currentText, templateText }) {
  const current = parseEnvText(currentText)
  const templateLines = templateText.split(/\r?\n/)
  const missingLines = []

  for (const line of templateLines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const equalsIndex = trimmed.indexOf('=')
    if (equalsIndex === -1) continue

    const key = trimmed.slice(0, equalsIndex).trim()
    if (key && !(key in current)) {
      missingLines.push(trimmed)
    }
  }

  if (missingLines.length === 0) return currentText

  const separator = currentText.endsWith('\n') ? '\n' : '\n\n'
  return `${currentText}${separator}# Added by Approval App Manager\n${missingLines.join('\n')}\n`
}
