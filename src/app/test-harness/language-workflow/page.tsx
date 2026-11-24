import { notFound } from 'next/navigation'
import { LocaleProvider } from '@/lib/i18n/client'
import { LanguageWorkflowDraft } from './language-workflow-draft'

export const dynamic = 'force-dynamic'

export default async function LanguageWorkflowHarness({ searchParams }: { searchParams: Promise<{ locale?: string; failure?: string }> }) {
  if (process.env.E2E_UI_HARNESS !== '1') notFound()
  const { locale, failure } = await searchParams
  // Opt in separately for disposable production-mode tests; never set this on a deployment.
  const productionFixtureFailureEnabled = process.env.NODE_ENV === 'production' && process.env.E2E_LANGUAGE_WORKFLOW_FAILURE === '1'
  if (failure === '1' && (process.env.NODE_ENV === 'development' || productionFixtureFailureEnabled)) {
    throw new Error('language error fixture')
  }
  return (
    <LocaleProvider locale={locale === 'th' ? 'th' : 'en'}>
      <LanguageWorkflowDraft />
    </LocaleProvider>
  )
}
