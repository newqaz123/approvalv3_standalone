'use client'

import { useTranslations } from '@/lib/i18n/client'

export default function ErrorPage({ reset }: { reset: () => void }) {
  const t = useTranslations()
  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 py-16 text-center">
      <div role="alert" className="space-y-4">
        <h1 className="text-2xl font-bold">{t('fallback.error')}</h1>
        <p className="text-muted-foreground">{t('fallback.errorDescription')}</p>
      </div>
      <button type="button" onClick={reset} className="min-h-[44px] rounded-md bg-blue-600 px-4 text-white">
        {t('fallback.retry')}
      </button>
    </div>
  )
}
