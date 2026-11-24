import Link from 'next/link'
import { ChevronLeft, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmailSettingsForm } from '@/components/admin/email-settings-form'
import { getEmailSettingsForAdmin } from '@/server-actions/email-settings'
import { createTranslator } from '@/lib/i18n/messages'
import { getRequestLocale } from '@/lib/i18n/server'

export async function generateMetadata() {
  const t = createTranslator(await getRequestLocale())
  return { title: `${t('admin.emailNotifications')} | ${t('admin.admin')}` }
}

export default async function AdminEmailPage() {
  const t = createTranslator(await getRequestLocale())
  const settings = await getEmailSettingsForAdmin()

  return (
    <div className="space-y-6 p-8">
      <div className="flex flex-col gap-3">
        <Button asChild variant="ghost" className="w-fit gap-2 px-0">
          <Link href="/admin">
            <ChevronLeft className="h-4 w-4" />
            {t('admin.admin')}
          </Link>
        </Button>
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Mail className="h-8 w-8 text-muted-foreground" />
            {t('admin.emailNotifications')}
          </h1>
          <p className="mt-2 text-muted-foreground">
            {t('admin.emailDescription')}
          </p>
        </div>
      </div>

      <EmailSettingsForm initial={settings} />
    </div>
  )
}
