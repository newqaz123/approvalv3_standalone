'use client'

import { Fragment, useState, useTransition, type ReactNode } from 'react'
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
import type { MessageKey } from '@/lib/i18n/messages'
import { useLocale, useTranslations } from '@/lib/i18n/client'

type CredentialIdentity = {
  host: string
  port: string
  username: string
  hasPassword: boolean
}

const SOURCE_LABELS: Record<EmailSettingsPublic['source'], MessageKey> = {
  env: 'admin.emailSourceEnvironment',
  admin: 'admin.emailSourceAdmin',
  none: 'admin.emailNotConfigured',
}

const PROVIDER_LABELS: Record<Exclude<EmailProvider, 'custom'>, string> = {
  resend: 'Resend',
  mailgun: 'Mailgun',
  gmail: 'Gmail',
  outlook: 'Outlook / Microsoft 365',
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

function instructionText(template: string, parts: Record<string, ReactNode>) {
  return template.split(/(\{\w+\})/g).map((part, index) => (
    <Fragment key={index}>{parts[part.slice(1, -1)] ?? part}</Fragment>
  ))
}

function ProviderInstructions({ provider }: { provider: EmailProvider }) {
  const t = useTranslations()
  return (
    <div className="rounded-lg border bg-muted/40 p-4 text-sm">
      <p className="font-medium">{t('admin.emailProviderSetup', { provider: provider === 'custom' ? t('admin.emailProviderCustom') : PROVIDER_LABELS[provider] })}</p>
      {provider === 'resend' && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          <li>{t('admin.emailAutoFields')}</li>
          <li>
            {instructionText(t('admin.emailResendApiKey'), { link: (
              <a
                className="font-medium text-primary underline underline-offset-4"
                href="https://resend.com/api-keys"
                target="_blank"
                rel="noreferrer"
              >
                resend.com/api-keys
              </a>
            ), example: <code>re_...</code> })}
          </li>
          <li>{t('admin.emailResendFrom')}</li>
          <li>
            {instructionText(t('admin.emailResendTestInbox'), { example: <code>example.com</code> })}
          </li>
        </ul>
      )}
      {provider === 'mailgun' && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          <li>{t('admin.emailMailgunDefaults')}</li>
          <li>
            {instructionText(t('admin.emailMailgunEuHost'), { host: <code>smtp.eu.mailgun.org</code> })}
          </li>
          <li>
            {instructionText(t('admin.emailMailgunCredentials'), { example: <code>postmaster@your-domain</code> })}
          </li>
          <li>
            {instructionText(t('admin.emailMailgunFrom'), { link: (
              <a
                className="font-medium text-primary underline underline-offset-4"
                href="https://app.mailgun.com/app/sending/domains"
                target="_blank"
                rel="noreferrer"
              >
                Mailgun Domains
              </a>
            ) })}
          </li>
          <li>{t('admin.emailMailgunFree')}</li>
        </ul>
      )}
      {provider === 'gmail' && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          <li>{t('admin.emailAutoHostPort')}</li>
          <li>{t('admin.emailGmailUsername')}</li>
          <li>
            {instructionText(t('admin.emailGmailPassword'), { link: (
              <a
                className="font-medium text-primary underline underline-offset-4"
                href="https://myaccount.google.com/apppasswords"
                target="_blank"
                rel="noreferrer"
              >
                myaccount.google.com/apppasswords
              </a>
            ) })}
          </li>
          <li>{t('admin.emailGmailFrom')}</li>
        </ul>
      )}
      {provider === 'outlook' && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          <li>{t('admin.emailAutoHostPort')}</li>
          <li>{t('admin.emailOutlookUsername')}</li>
          <li>
            {t('admin.emailOutlookPassword')}
          </li>
          <li>{t('admin.emailOutlookFrom')}</li>
          <li>
            {t('admin.emailOutlookAuth')}
          </li>
          <li>
            {t('admin.emailOutlookWarning')}
          </li>
        </ul>
      )}
      {provider === 'custom' && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          <li>
            {t('admin.emailCustomHelp')}
          </li>
          <li>
            {t('admin.emailCustomNoAuth')}
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
  const t = useTranslations()
  const locale = useLocale()
  const router = useRouter()
  const [source, setSource] = useState(initial.source)
  const [enabled, setEnabled] = useState(initial.enabled)
  const [provider, setProvider] = useState<EmailProvider>(initial.provider)
  const [host, setHost] = useState(initial.host)
  const [port, setPort] = useState(String(initial.port))
  const [username, setUsername] = useState(initial.username)
  const [password, setPassword] = useState('')
  const [fromAddress, setFromAddress] = useState(initial.fromAddress)
  const [testTo, setTestTo] = useState(initial.adminEmail)
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
        toast.error(locale === 'en' ? result.error : t(result.errorKey))
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
      toast.success(t('admin.emailSaved'))
      router.refresh()
    })
  }

  const handleTest = () => {
    const input = { ...buildInput(), toAddress: testTo }
    startTesting(async () => {
      const result = await sendTestEmail(input)
      if (!result.success) {
        toast.error(locale === 'en' ? result.error : t('admin.sendTestEmailFailed'))
        return
      }
      toast.success(t('admin.emailTestSent', { recipient: testTo.trim() || initial.adminEmail }))
    })
  }

  const busy = isSaving || isTesting

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('admin.currentStatus')}</CardTitle>
          <CardDescription>
            {t('admin.emailMasterSwitch')}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{t('admin.sourceLabel')} {t(SOURCE_LABELS[source])}</Badge>
          <Badge variant={enabled ? 'success' : 'secondary'}>
            {enabled ? 'Enabled' : 'Disabled'}
          </Badge>
          <Badge variant="outline">
            {noAuth
              ? t('admin.noAuthentication')
              : hasPassword
                ? t('admin.passwordAvailable')
                : t('admin.passwordRequired')}
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
            <p className="font-medium">{t('admin.smtpPasswordReenter')}</p>
            <p className="mt-1 text-sm">
              {t('admin.smtpPasswordUnreadable')}
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('admin.emailSettings')}</CardTitle>
          <CardDescription>
            {t('admin.emailSettingsApply')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between gap-6 rounded-lg border p-4">
            <div className="space-y-1">
              <Label htmlFor="email-enabled">{t('admin.emailNotifications')}</Label>
              <p className="text-sm text-muted-foreground">
                {t('admin.emailToggleHelp')}
              </p>
            </div>
            <Switch
              id="email-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
              disabled={busy}
              aria-label={t('admin.emailNotifications')}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email-provider">{t('admin.emailPreset')}</Label>
            <Select
              value={provider}
              onValueChange={(value) =>
                handleProviderChange(value as EmailProvider)
              }
              disabled={busy}
            >
              <SelectTrigger id="email-provider">
                <SelectValue placeholder={t('admin.chooseEmailProvider')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="resend">Resend</SelectItem>
                <SelectItem value="mailgun">Mailgun</SelectItem>
                <SelectItem value="gmail">Gmail</SelectItem>
                <SelectItem value="outlook">
                  Outlook / Microsoft 365
                </SelectItem>
                <SelectItem value="custom">{t('admin.emailProviderCustom')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <ProviderInstructions provider={provider} />

          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="smtp-host">{t('admin.smtpHost')}</Label>
              <Input
                id="smtp-host"
                value={host}
                onChange={(event) => setHost(event.target.value)}
                placeholder="smtp.example.com"
                autoComplete="off"
                disabled={busy}
                required
              />
              <FieldHint>{t('admin.smtpHostHelp')}</FieldHint>
            </div>

            <div className="space-y-2">
              <Label htmlFor="smtp-port">{t('admin.smtpPort')}</Label>
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
                {t('admin.smtpPortHelp')}
              </FieldHint>
            </div>

            <div className="space-y-2">
              <Label htmlFor="smtp-username">{t('admin.smtpUsername')}</Label>
              <Input
                id="smtp-username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="name@example.com"
                autoComplete="username"
                disabled={busy || noAuth}
              />
              <FieldHint>
                {t('admin.smtpUsernameHelp')}
              </FieldHint>
            </div>

            <div className="space-y-2">
              <Label htmlFor="smtp-password">{t('admin.password')}</Label>
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
                {t('admin.smtpPasswordHelp')}
              </FieldHint>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="smtp-from">{t('admin.smtpFrom')}</Label>
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
                {t('admin.smtpFromHelp')}
              </FieldHint>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="smtp-test-to">{t('admin.emailTestRecipient')}</Label>
            <Input
              id="smtp-test-to"
              type="email"
              value={testTo}
              onChange={(event) => setTestTo(event.target.value)}
              placeholder="you@your-domain.com"
              disabled={busy}
              autoComplete="email"
            />
            <FieldHint>
              {t('admin.emailTestRecipientHelp')}
            </FieldHint>
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
                <Label htmlFor="smtp-no-auth">{t('admin.noAuthentication')}</Label>
                <p className="text-sm text-muted-foreground">
                  {t('admin.smtpNoAuthHelp')}
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
              {t('admin.sendTestEmail')}
            </Button>
            <Button type="button" onClick={handleSave} disabled={busy}>
              {isSaving ? <Loader2 className="animate-spin" /> : <Save />}
              {t('admin.saveEmailSettings')}
            </Button>
          </div>

          {!enabled && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4" />
              {t('admin.emailTestStillAvailable')}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
