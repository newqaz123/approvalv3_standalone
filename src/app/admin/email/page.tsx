import Link from 'next/link'
import { ChevronLeft, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmailSettingsForm } from '@/components/admin/email-settings-form'
import { getEmailSettingsForAdmin } from '@/server-actions/email-settings'

export const metadata = { title: 'Email notifications | Admin' }

export default async function AdminEmailPage() {
  const settings = await getEmailSettingsForAdmin()

  return (
    <div className="space-y-6 p-8">
      <div className="flex flex-col gap-3">
        <Button asChild variant="ghost" className="w-fit gap-2 px-0">
          <Link href="/admin">
            <ChevronLeft className="h-4 w-4" />
            Admin
          </Link>
        </Button>
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Mail className="h-8 w-8 text-muted-foreground" />
            Email notifications
          </h1>
          <p className="mt-2 text-muted-foreground">
            Configure SMTP for request notifications. You can switch providers
            here without editing environment variables or restarting the app.
          </p>
        </div>
      </div>

      <EmailSettingsForm initial={settings} />
    </div>
  )
}
