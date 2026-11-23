'use server'

import { cookies, headers } from 'next/headers'
import { auth } from '@/lib/auth-config'
import { persistLanguage, type SaveLanguageResult } from '@/lib/i18n/locale'
import { ANONYMOUS_LOCALE_COOKIE } from '@/lib/i18n/server'
import prisma from '@/lib/prisma'

export async function saveLanguage(value: unknown): Promise<SaveLanguageResult> {
  try {
    const userId = (await auth())?.user?.id
    return await persistLanguage(value, userId, {
      writeAccount: async (id, preferredLocale) => {
        const { count } = await prisma.user.updateMany({
          where: { id, isActive: true },
          data: { preferredLocale },
        })
        return count === 1
      },
      writeAnonymous: async (locale) => {
        const protocol = (await headers()).get('x-forwarded-proto')
        const cookieStore = await cookies()
        cookieStore.set(ANONYMOUS_LOCALE_COOKIE, locale, {
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          secure: protocol === 'https',
          maxAge: 365 * 24 * 60 * 60,
        })
      },
    })
  } catch {
    return { ok: false, code: 'save_failed' }
  }
}
