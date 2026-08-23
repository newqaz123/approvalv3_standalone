'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  MailCheck,
  Save,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  applyEmailPreset,
  type EmailProvider,
  type EmailSettingsPublic,
} from '@/lib/email-presets'
import {
  saveEmailSettings,
  sendTestEmail,
} from '@/server-actions/email-settings'

type CredentialIdentity = {
  host: string
  port: string
  username: string
  hasPassword: boolean
}

const SOURCE_LABELS: Record<EmailSettingsPublic['source'], string> = {
  env: 'Environment',
  admin: 'Admin settings',
  none: 'Not configured',
}

const PROVIDER_LABELS: Record<EmailProvider, string> = {
  resend: 'Resend',
  gmail: 'Gmail',
  outlook: 'Outlook / Microsoft 365',
  custom: 'Custom',
}

function normalizeCredentialIdentity({
  host,
  port,
  username,
}: Omit<CredentialIdentity, 'hasPassword'>) {
  return {
    host: host.trim().toLowerCase(),
    port: String(Number(port)),
    username: username.trim(),
  }
}

function ProviderInstructions({ provider }: { provider: EmailProvider }) {
  return (
    <div className="rounded-lg border bg-muted/40 p-4 text-sm">
      <p className="font-medium">{PROVIDER_LABELS[provider]} setup</p>
      {provider === 'resend' && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          <li>Host/port/user fill automatically.</li>
          <li>
            Password is an API key from{' '}
            <a
              className="font-medium text-primary underline underline-offset-4"
              href="https://resend.com/api-keys"
              target="_blank"
              rel="noreferrer"
            >
              resend.com/api-keys
            </a>{' '}
            (<code>re_...</code>).
          </li>
          <li>From must use a domain verified in Resend → Domains.</li>
        </ul>
      )}
      {provider === 'gmail' && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          <li>Host/port fill automatically.</li>
          <li>Username is the full Gmail address.</li>
          <li>
            Password is a Google App Password from{' '}
            <a
              className="font-medium text-primary underline underline-offset-4"
              href="https://myaccount.google.com/apppasswords"
              target="_blank"
              rel="noreferrer"
            >
              myaccount.google.com/apppasswords
            </a>
            , not the Google account password. 2-Step Verification must be on.
          </li>
          <li>From is that same Gmail address.</li>
        </ul>
      )}
      {provider === 'outlook' && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          <li>Host/port fill automatically.</li>
          <li>Username is the full Microsoft 365 email.</li>
          <li>
            Password is the mailbox password, or an app password if MFA is on.
          </li>
          <li>From is that same mailbox.</li>
          <li>
            SMTP AUTH must be enabled for the mailbox in the Microsoft 365
            admin center.
          </li>
          <li>
            Some tenants disable password SMTP or require OAuth. The UI must
            not promise that a mailbox password always works.
          </li>
        </ul>
      )}
      {provider === 'custom' && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          <li>
            Copy host, port, username, password, and allowed From from the
            provider&apos;s SMTP documentation.
          </li>
          <li>
            Use “No authentication” only for internal relays that do not
            require a login.
          </li>
        </ul>
      )}
    </div>
  )
}

function FieldHint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>
}

export function EmailSettingsForm({
  initial,
}: {
  initial: EmailSettingsPublic
}) {
  const router = useRouter()
  const [source, setSource] = useState(initial.source)
  const [enabled, setEnabled] = useState(initial.enabled)
  const [provider, setProvider] = useState<EmailProvider>(initial.provider)
  const [host, setHost] = useState(initial.host)
  const [port, setPort] = useState(String(initial.port))
  const [username, setUsername] = useState(initial.username)
  const [password, setPassword] = useState('')
  const [fromAddress, setFromAddress] = useState(initial.fromAddress)
  const [noAuth, setNoAuth] = useState(
    initial.provider === 'custom' ? initial.noAuth : false,
  )
  const [needsPasswordReset, setNeedsPasswordReset] = useState(
    initial.needsPasswordReset,
  )
  const [credentialIdentity, setCredentialIdentity] =
    useState<CredentialIdentity>({
      host: initial.host.trim().toLowerCase(),
      port: String(Number(initial.port)),
      username: initial.username.trim(),
      hasPassword: initial.hasPassword,
    })
  const [isSaving, startSaving] = useTransition()
  const [isTesting, startTesting] = useTransition()

  const currentIdentity = normalizeCredentialIdentity({ host, port, username })
  const hasPassword =
    !noAuth &&
    credentialIdentity.hasPassword &&
    currentIdentity.host === credentialIdentity.host &&
    currentIdentity.port === credentialIdentity.port &&
    currentIdentity.username === credentialIdentity.username

  const buildInput = () => ({
    enabled,
    provider,
    host,
    port,
    username,
    password,
    fromAddress,
    noAuth,
  })

  const handleProviderChange = (nextProvider: EmailProvider) => {
    const preset = applyEmailPreset(nextProvider)
    setProvider(nextProvider)
    if (preset.host !== undefined) setHost(preset.host)
    if (preset.port !== undefined) setPort(String(preset.port))
    if (nextProvider !== 'custom') {
      if (preset.username !== undefined) setUsername(preset.username)
      setNoAuth(false)
    }
  }

  const handleNoAuthChange = (checked: boolean) => {
    setNoAuth(checked)
    if (checked) {
      setUsername('')
      setPassword('')
    }
  }

  const handleSave = () => {
    const input = buildInput()
    startSaving(async () => {
      const result = await saveEmailSettings(input)
      if (!result.success) {
        toast.error(result.error)
        return
      }

      const savedHasPassword =
        !input.noAuth && (Boolean(input.password.trim()) || hasPassword)
      const savedIdentity = normalizeCredentialIdentity({
        host: input.host,
        port: input.port,
        username: input.username,
      })
      setCredentialIdentity({ ...savedIdentity, hasPassword: savedHasPassword })
      setSource('admin')
      setNeedsPasswordReset(false)
      setPassword('')
      toast.success('Email settings saved')
      router.refresh()
    })
  }

  const handleTest = () => {
    const input = buildInput()
    startTesting(async () => {
      const result = await sendTestEmail(input)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('Test email sent to your admin address')
    })
  }

  const busy = isSaving || isTesting

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Current status</CardTitle>
          <CardDescription>
            The admin toggle is the master switch for notification email.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">Source: {SOURCE_LABELS[source]}</Badge>
          <Badge variant={enabled ? 'success' : 'secondary'}>
            {enabled ? 'Enabled' : 'Disabled'}
          </Badge>
          <Badge variant="outline">
            {noAuth
              ? 'No authentication'
              : hasPassword
                ? 'Password available'
                : 'Password required'}
          </Badge>
        </CardContent>
      </Card>

      {needsPasswordReset && (
        <div
          role="alert"
          className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-medium">Re-enter the SMTP password</p>
            <p className="mt-1 text-sm">
              The stored password could not be decrypted. Notification email
              remains stopped until a new password is saved.
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Email notification settings</CardTitle>
          <CardDescription>
            Saved admin settings take effect on the next email without a
            restart.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between gap-6 rounded-lg border p-4">
            <div className="space-y-1">
              <Label htmlFor="email-enabled">Email notifications</Label>
              <p className="text-sm text-muted-foreground">
                Turn off to stop notification email. In-app notifications are
                unchanged.
              </p>
            </div>
            <Switch
              id="email-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
              disabled={busy}
              aria-label="Email notifications"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email-provider">Provider preset</Label>
            <Select
              value={provider}
              onValueChange={(value) =>
                handleProviderChange(value as EmailProvider)
              }
              disabled={busy}
            >
              <SelectTrigger id="email-provider">
                <SelectValue placeholder="Choose a provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="resend">Resend</SelectItem>
                <SelectItem value="gmail">Gmail</SelectItem>
                <SelectItem value="outlook">
                  Outlook / Microsoft 365
                </SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <ProviderInstructions provider={provider} />

          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="smtp-host">Host</Label>
              <Input
                id="smtp-host"
                value={host}
                onChange={(event) => setHost(event.target.value)}
                placeholder="smtp.example.com"
                autoComplete="off"
                disabled={busy}
                required
              />
              <FieldHint>SMTP server hostname from the email provider</FieldHint>
            </div>

            <div className="space-y-2">
              <Label htmlFor="smtp-port">Port</Label>
              <Input
                id="smtp-port"
                type="number"
                min={1}
                max={65535}
                inputMode="numeric"
                value={port}
                onChange={(event) => setPort(event.target.value)}
                disabled={busy}
                required
              />
              <FieldHint>
                Usually 587 (STARTTLS). Use 465 only if the provider requires
                SSL
              </FieldHint>
            </div>

            <div className="space-y-2">
              <Label htmlFor="smtp-username">Username</Label>
              <Input
                id="smtp-username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="name@example.com"
                autoComplete="username"
                disabled={busy || noAuth}
              />
              <FieldHint>
                SMTP login. Often the mailbox, sometimes a fixed value such as
                resend
              </FieldHint>
            </div>

            <div className="space-y-2">
              <Label htmlFor="smtp-password">Password</Label>
              <Input
                id="smtp-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={hasPassword ? '••••••••' : ''}
                autoComplete="new-password"
                disabled={busy || noAuth}
              />
              <FieldHint>
                SMTP secret or API key. Not the app login password unless the
                provider says so
              </FieldHint>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="smtp-from">From</Label>
              <Input
                id="smtp-from"
                value={fromAddress}
                onChange={(event) => setFromAddress(event.target.value)}
                placeholder="Approval App <no-reply@your-domain.com>"
                autoComplete="email"
                disabled={busy}
                required
              />
              <FieldHint>
                Visible sender, e.g. Approval App &lt;no-reply@your-domain.com&gt;.
                Must be allowed by the provider
              </FieldHint>
            </div>
          </div>

          {provider === 'custom' && (
            <div className="flex items-start gap-3 rounded-lg border p-4">
              <Checkbox
                id="smtp-no-auth"
                checked={noAuth}
                onCheckedChange={(checked) =>
                  handleNoAuthChange(checked === true)
                }
                disabled={busy}
              />
              <div className="space-y-1">
                <Label htmlFor="smtp-no-auth">No authentication</Label>
                <p className="text-sm text-muted-foreground">
                  Use only for an internal SMTP relay that does not require a
                  username or password.
                </p>
              </div>
            </div>
          )}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={handleTest}
              disabled={busy}
            >
              {isTesting ? (
                <Loader2 className="animate-spin" />
              ) : (
                <MailCheck />
              )}
              Send test email
            </Button>
            <Button type="button" onClick={handleSave} disabled={busy}>
              {isSaving ? <Loader2 className="animate-spin" /> : <Save />}
              Save settings
            </Button>
          </div>

          {!enabled && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4" />
              Test email remains available while notifications are disabled.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
