import { cookies } from 'next/headers'
import { cache } from 'react'
import { auth } from '@/lib/auth-config'
import prisma from '@/lib/prisma'
import { resolveLocale, type Locale } from './locale'

export const ANONYMOUS_LOCALE_COOKIE = 'improveflow_anonymous_locale'

export const getRequestLocale = cache(async (): Promise<Locale> => {
  const userId = (await auth())?.user?.id
  if (userId !== undefined) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { preferredLocale: true },
    })
    return resolveLocale(userId, user?.preferredLocale, undefined)
  }

  const cookie = (await cookies()).get(ANONYMOUS_LOCALE_COOKIE)
  return resolveLocale(undefined, undefined, cookie?.value)
})
