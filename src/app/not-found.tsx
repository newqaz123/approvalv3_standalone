import Link from 'next/link'
import { createTranslator } from '@/lib/i18n/messages'
import { getRequestLocale } from '@/lib/i18n/server'

export default async function NotFound() {
  const t = createTranslator(await getRequestLocale())
  return (
    <main className="mx-auto max-w-lg space-y-4 px-4 py-16 text-center">
      <h1 className="text-2xl font-bold">{t('fallback.notFound')}</h1>
      <p className="text-muted-foreground">{t('fallback.notFoundDescription')}</p>
      <Link href="/" className="inline-flex min-h-[44px] items-center text-blue-700 underline">
        {t('fallback.home')}
      </Link>
    </main>
  )
}
