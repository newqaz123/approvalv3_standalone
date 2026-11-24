import { createTranslator } from '@/lib/i18n/messages'
import { getRequestLocale } from '@/lib/i18n/server'
import { auth } from '@/lib/auth-config'
import { redirect } from 'next/navigation'
import prisma from '@/lib/prisma'
import { unitPathNames } from '@/lib/unit-labels'
import type { OrganizationUnitNode } from '@/lib/organization/model'

export default async function WorkflowPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/sign-in')

  const t = createTranslator(await getRequestLocale())
  const path = await (async () => {
    const assignment = await prisma.organization_assignments.findFirst({
      where: { userId: session.user.id, isActive: true },
      select: { unitId: true },
    })

    const units = await prisma.organization_units.findMany({
      select: {
        id: true,
        name: true,
        parentId: true,
        isActive: true,
        shareRequests: true,
        canWorkOnSolutions: true,
        managerUserId: true,
      },
    }) as OrganizationUnitNode[]

    return assignment ? unitPathNames(units, assignment.unitId) : []
  })().catch((error) => {
    console.error('Failed to load approval workflow:', error)
    return null
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('workflow.heading')}</h1>
        <p className="text-muted-foreground">
          {t('workflow.intro')}
        </p>
      </div>
      {path === null ? (
        <p role="alert" className="text-destructive">{t('workflow.error.initialLoad')}</p>
      ) : path.length > 0 ? (
        <p className="text-sm text-muted-foreground">{t('workflow.unit', { unit: path.join(' / ') })}</p>
      ) : (
        <p className="text-muted-foreground">
          {t('workflow.noUnit')}
        </p>
      )}
    </div>
  )
}
