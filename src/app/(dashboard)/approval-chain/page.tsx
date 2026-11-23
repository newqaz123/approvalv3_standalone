import { redirect } from 'next/navigation'
import { ApprovalChainView } from '@/components/profile/approval-chain-view'
import { loadPersonalApprovalChain } from '@/lib/approval-routes/chains-admin'
import { auth } from '@/lib/auth-config'
import { createTranslator } from '@/lib/i18n/messages'
import { getRequestLocale } from '@/lib/i18n/server'

export default async function ApprovalChainPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/sign-in')

  const chain = await loadPersonalApprovalChain(session.user.id)
  const t = createTranslator(await getRequestLocale())
  return <ApprovalChainView chain={chain} t={t} />
}
