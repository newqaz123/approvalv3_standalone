export type Locale = 'en' | 'th'

const DEFAULT_LOCALE: Locale = 'en'

export function parseLocale(value: unknown): Locale | null {
  return value === 'en' || value === 'th' ? value : null
}

export function resolveLocale(
  userId: string | undefined,
  accountValue: unknown,
  anonymousValue: unknown,
): Locale {
  return parseLocale(userId === undefined ? anonymousValue : accountValue) ?? DEFAULT_LOCALE
}

export type SaveLanguageResult =
  | { ok: true; locale: Locale }
  | { ok: false; code: 'invalid_locale' | 'save_failed' }

export async function persistLanguage(
  value: unknown,
  sessionUserId: string | undefined,
  ports: {
    writeAccount: (id: string, locale: Locale) => Promise<boolean>
    writeAnonymous: (locale: Locale) => Promise<void>
  },
): Promise<SaveLanguageResult> {
  const locale = parseLocale(value)
  if (locale === null) {
    return { ok: false, code: 'invalid_locale' }
  }

  try {
    if (sessionUserId === undefined) {
      await ports.writeAnonymous(locale)
    } else if (!(await ports.writeAccount(sessionUserId, locale))) {
      return { ok: false, code: 'save_failed' }
    }
    return { ok: true, locale }
  } catch {
    return { ok: false, code: 'save_failed' }
  }
}
