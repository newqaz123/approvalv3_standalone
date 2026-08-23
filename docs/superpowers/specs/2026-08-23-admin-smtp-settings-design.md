# Admin SMTP Settings Design

**Date:** 2026-08-23  
**Status:** Approved design  
**Scope:** Local repository only; no production migration or VPS deploy

## Purpose

Let an admin configure notification email from the app instead of editing `SMTP_*` environment variables and restarting. Switching from Resend to Gmail, Outlook, or another SMTP provider should be a form change, not a deploy change.

## Goals

- Add an admin Email Notifications page with a master on/off toggle, provider presets, SMTP fields, save, and test send.
- Persist settings in the database. Env `SMTP_*` remains the fallback until an admin saves settings.
- Apply new settings to the next outgoing email without restarting the process.
- Keep the current Resend-via-SMTP setup working until someone saves in the UI.
- Never expose the stored SMTP password to the browser.
- Show per-provider instructions so an admin knows what each field is and where to get it.

## Non-Goals

- No Resend HTTP API, SendGrid SDK, or other non-SMTP transports.
- No generic `system_settings` key-value store.
- No writing SMTP values back into `.env`.
- No production database migration from this work session.
- No change to in-app notification creation, templates, or the post-commit notification timing rules.
- No extra top-level navbar item.

## Approach

Dedicated singleton `email_settings` table plus `/admin/email`. Sending stays on Nodemailer SMTP. A resolver chooses DB settings or env fallback and honors the master toggle.

## Data Model

Additive Prisma model only:

```prisma
model email_settings {
  id                String   @id @default("default")
  enabled           Boolean  @default(true)
  provider          String   @default("custom") // resend | gmail | outlook | custom
  host              String
  port              Int      @default(587)
  username          String?
  passwordEncrypted String?
  fromEmail         String
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}
```

Rules:

- The table is a singleton. The only row id is `"default"`.
- No row means “not configured in admin yet.” Runtime falls back to env.
- First successful save upserts id `"default"`. After that, DB values win over env.
- `provider` is a UI preset label only. Transport is always SMTP.
- `passwordEncrypted` stores AES-256-GCM ciphertext. It is never selected for client responses.

## Runtime Resolution

Replace the module-level Nodemailer transporter in `src/server-actions/notifications.ts` with a helper, for example `getEmailTransport()`, called on each send so a save applies to the next email without a restart.

Resolution order:

1. **No `email_settings` row** → use `SMTP_HOST`, `SMTP_PORT` (default `587`), `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`. If host or from is missing, skip email and log the same style of warning used today.
2. **Row exists and `enabled === false`** → skip email. Env is ignored. This is the master switch.
3. **Row exists and `enabled === true`** → use DB host, port, username, decrypted password, and from address.

`secure` stays `port === 465`, same as today.

In-app notification rows are unchanged. Only the SMTP send is gated.

Test send uses the same helper. It may accept unsaved form values so an admin can probe a provider before or while saving. Unsaved test values are not persisted unless the admin also saves.

## Admin UI

New route: `/admin/email`. Admin-only via the existing admin layout and `requireAdmin()`.

Entry point: a new “Email notifications” card on `/admin`. No extra navbar link.

Page contents:

1. Master toggle: Email notifications on/off.
2. Provider preset: Resend, Gmail, Outlook/Microsoft 365, Custom.
3. Fields: host, port, username, password, from address.
4. Actions: Save settings, Send test email.

Behavior:

- Choosing a preset fills host/port (and username for Resend) but does not overwrite a password the admin already typed.
  - Resend → `smtp.resend.com`, `587`, username `resend`
  - Gmail → `smtp.gmail.com`, `587`
  - Outlook → `smtp.office365.com`, `587`
  - Custom → do not change host/port/username
- Password is write-only. If a password is stored, show a placeholder such as `••••••••` and `hasPassword: true`. An empty password on save means keep the current secret.
- If no DB row exists, prefill the form from `SMTP_*` so the current Resend env config is visible and editable.
- Save upserts the singleton row and encrypts a newly provided password.
- Test send uses the current form values (including unsaved ones) and mails only the signed-in admin. Success or failure is shown in a toast. Failure may include the SMTP error message but must not include the password.
- A provider-specific help panel sits under the preset. Each field also has a one-line hint.

### Field hints (always visible)

| Field | Hint |
|---|---|
| Host | SMTP server hostname from the email provider |
| Port | Usually `587` (STARTTLS). Use `465` only if the provider requires SSL |
| Username | SMTP login. Often the mailbox, sometimes a fixed value such as `resend` |
| Password | SMTP secret or API key. Not the app login password unless the provider says so |
| From | Visible sender, e.g. `Approval App <no-reply@your-domain.com>`. Must be allowed by the provider |

### Provider instructions

**Resend**

- Host/port/user fill automatically.
- Password is an API key from https://resend.com/api-keys (`re_...`).
- From must use a domain verified in Resend → Domains.

**Gmail**

- Host/port fill automatically.
- Username is the full Gmail address.
- Password is a Google App Password from https://myaccount.google.com/apppasswords, not the Google account password. 2-Step Verification must be on.
- From is that same Gmail address.

**Outlook / Microsoft 365**

- Host/port fill automatically.
- Username is the full Microsoft 365 email.
- Password is the mailbox password, or an app password if MFA is on.
- From is that same mailbox.
- SMTP AUTH must be enabled for the mailbox in the Microsoft 365 admin center.

**Custom**

- Copy host, port, username, password, and allowed From from the provider’s SMTP documentation.

## Security

- Page and all related server actions require an admin session.
- Encrypt `passwordEncrypted` with AES-256-GCM. Derive the key from `process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET`, the same fallback already used by this repo. Do not add a new env secret for this feature.
- GET/load payloads include `hasPassword` and never include plaintext or ciphertext.
- Do not log password, ciphertext, or full transporter auth objects.
- Test send recipient is only `session.user.email`. Reject the action if that address is missing.
- Non-admins receive the same authorization failure used by other admin actions.

## Testing

Cover at least:

- Resolver: no row → env values; `enabled: false` → no send even if env is set; `enabled: true` → DB values.
- Save encrypts a new password and leaves the stored password unchanged when the field is blank.
- Loaded settings omit password and set `hasPassword` correctly.
- Test send: mocked transporter success and failure; recipient is the admin email.
- Non-admin cannot read or write settings.
- Existing notification regression tests still pass, including the rule that SMTP helpers stay out of Prisma transaction callbacks.

## Docs and Deploy

- README and `.env.example` still document `SMTP_*` as an optional fallback used until admin settings are saved.
- Deployment docs note that provider changes no longer require a process restart once settings are saved in admin.
- Ship an additive Prisma migration in the repo. Do not apply it to production from this session.

## Files (expected)

- `prisma/schema.prisma` — add `email_settings`
- `prisma/migrations/<timestamp>_email_settings/` — additive migration
- `src/lib/email-settings.ts` — encrypt/decrypt, resolve transport config
- `src/server-actions/email-settings.ts` — get, save, test send
- `src/server-actions/notifications.ts` — use resolver instead of module-level env transporter
- `src/app/admin/email/page.tsx` — page
- `src/components/admin/email-settings-form.tsx` — form, presets, help, test button
- `src/app/admin/page.tsx` — dashboard card
- Tests under `tests/` for resolver, save, auth, and test send
- README / `.env.example` wording updates

## Error Handling

- Missing host or from when enabled: do not send; return a clear error on test send; log a warning on notification send.
- Decrypt failure: treat as unconfigured password, do not send, surface a “re-enter password” message on the admin page.
- SMTP failure on notification send: log the error, do not fail the in-app notification write.
- SMTP failure on test send: return the provider error to the admin toast.

## Isolation

Work lands on a branch or worktree so it does not collide with in-progress request-modal / file-preview UI changes. Shared files to avoid unless required: `src/app/admin/page.tsx` (additive card only) and `src/server-actions/notifications.ts` (transporter lookup only).
