import Link from 'next/link'
import { Users, Building2, FileText, Trash2, Archive, ClipboardList, LayoutTemplate, ListChecks, Mail, HardDrive } from 'lucide-react'
import prisma from '@/lib/prisma'
import { createTranslator } from '@/lib/i18n/messages'
import { getRequestLocale } from '@/lib/i18n/server'

async function getStats() {
  const [userCount, unitCount, requestCount, deletedCount] = await Promise.all([
    prisma.user.count(),
    prisma.organization_units.count(),
    prisma.requests.count({ where: { isDeleted: false } }),
    prisma.requests.count({ where: { isDeleted: true } }),
  ])

  return { userCount, unitCount, requestCount, deletedCount }
}

export default async function AdminPage() {
  const t = createTranslator(await getRequestLocale())
  const stats = await getStats()

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">{t('admin.dashboard')}</h1>
        <p className="text-muted-foreground mt-2">
          {t('admin.dashboardDescription')}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-muted-foreground" />
            <h3 className="text-sm font-medium text-muted-foreground">{t('admin.totalUsers')}</h3>
          </div>
          <p className="text-3xl font-bold mt-2">{stats.userCount}</p>
        </div>

        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-muted-foreground" />
            <h3 className="text-sm font-medium text-muted-foreground">{t('admin.organizationUnits')}</h3>
          </div>
          <p className="text-3xl font-bold mt-2">{stats.unitCount}</p>
        </div>

        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-muted-foreground" />
            <h3 className="text-sm font-medium text-muted-foreground">{t('admin.activeRequests')}</h3>
          </div>
          <p className="text-3xl font-bold mt-2">{stats.requestCount}</p>
        </div>

        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-muted-foreground" />
            <h3 className="text-sm font-medium text-muted-foreground">{t('admin.deletedRequests')}</h3>
          </div>
          <p className="text-3xl font-bold mt-2">{stats.deletedCount}</p>
        </div>
      </div>

      <div>
        <h2 className="text-xl font-semibold mb-4">{t('admin.quickActions')}</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Link
            href="/admin/users"
            className="rounded-lg border bg-card p-6 hover:bg-accent transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-4">
              <div className="rounded-full bg-primary/10 p-3">
                <Users className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">{t('admin.manageUsers')}</h3>
                <p className="text-sm text-muted-foreground">
                  {t('admin.manageUsersDescription')}
                </p>
              </div>
            </div>
          </Link>

          <Link
            href="/admin/organization"
            className="rounded-lg border bg-card p-6 hover:bg-accent transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-4">
              <div className="rounded-full bg-primary/10 p-3">
                <Building2 className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">{t('admin.organization')}</h3>
                <p className="text-sm text-muted-foreground">
                  {t('admin.organizationTile')}
                </p>
              </div>
            </div>
          </Link>

          <Link
            href="/admin/retention"
            className="rounded-lg border bg-card p-6 hover:bg-accent transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-4">
              <div className="rounded-full bg-primary/10 p-3">
                <Archive className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">{t('admin.retention')}</h3>
                <p className="text-sm text-muted-foreground">
                  {t('admin.retentionTile')}
                </p>
              </div>
            </div>
          </Link>

          <Link
            href="/admin/audit"
            className="rounded-lg border bg-card p-6 hover:bg-accent transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-4">
              <div className="rounded-full bg-primary/10 p-3">
                <ClipboardList className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">{t('admin.auditExport')}</h3>
                <p className="text-sm text-muted-foreground">
                  {t('admin.auditTile')}
                </p>
              </div>
            </div>
          </Link>

          <Link
            href="/admin/templates"
            className="rounded-lg border bg-card p-6 hover:bg-accent transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-4">
              <div className="rounded-full bg-primary/10 p-3">
                <LayoutTemplate className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">{t('admin.templates')}</h3>
                <p className="text-sm text-muted-foreground">
                  {t('admin.templatesTile')}
                </p>
              </div>
            </div>
          </Link>

          <Link
            href="/admin/sub-task-stages"
            className="rounded-lg border bg-card p-6 hover:bg-accent transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-4">
              <div className="rounded-full bg-primary/10 p-3">
                <ListChecks className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">{t('admin.stagesTileTitle')}</h3>
                <p className="text-sm text-muted-foreground">
                  {t('admin.stagesTile')}
                </p>
              </div>
            </div>
          </Link>

          <Link
            href="/admin/email"
            className="rounded-lg border bg-card p-6 hover:bg-accent transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-4">
              <div className="rounded-full bg-primary/10 p-3">
                <Mail className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">{t('admin.emailNotifications')}</h3>
                <p className="text-sm text-muted-foreground">
                  {t('admin.emailTile')}
                </p>
              </div>
            </div>
          </Link>

          <Link
            href="/admin/storage"
            className="rounded-lg border bg-card p-6 hover:bg-accent transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-4">
              <div className="rounded-full bg-primary/10 p-3">
                <HardDrive className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">{t('admin.storage')}</h3>
                <p className="text-sm text-muted-foreground">
                  {t('admin.storageTile')}
                </p>
              </div>
            </div>
          </Link>
        </div>
      </div>
    </div>
  )
}
