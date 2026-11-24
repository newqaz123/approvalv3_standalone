import { notFound } from 'next/navigation'
import { LocaleProvider } from '@/lib/i18n/client'
import { LanguageWorkflowDraft } from './language-workflow-draft'

export const dynamic = 'force-dynamic'

export default async function LanguageWorkflowHarness({ searchParams }: { searchParams: Promise<{ locale?: string; failure?: string }> }) {
  if (process.env.E2E_UI_HARNESS !== '1') notFound()
  const { locale, failure } = await searchParams
  if (process.env.NODE_ENV === 'development' && failure === '1') throw new Error('language error fixture')
  return (
    <LocaleProvider locale={locale === 'th' ? 'th' : 'en'}>
      <LanguageWorkflowDraft />
    </LocaleProvider>
  )
}
