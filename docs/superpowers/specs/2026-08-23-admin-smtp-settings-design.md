# Admin SMTP Settings Design

**Date:** 2026-08-23  
**Status:** Approved design, revised after Oracle review  
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
- No automatic fallback from a saved DB row back to env.
- No settings audit trail in this slice.
- No change to existing department-notification recipient `to:` behavior.

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
  fromAddress       String
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}
```

Rules:

- The table is a singleton. The only row id is `"default"`.
- No row means “not configured in admin yet.” Runtime falls back to env.
- First successful save upserts id `"default"`. After that, DB values win over env forever for that deployment until an admin changes the DB row. There is no UI to delete the row and return to env fallback.
- Once the row exists, invalid DB config, decrypt failure, or SMTP failure never falls back to env. Silent fallback could send through the old provider after an admin intended to replace or disable it.
- `provider` is a UI preset label only. Transport is always SMTP.
- `passwordEncrypted` stores a versioned AES-256-GCM envelope. It is never selected for client responses.
- `fromAddress` is one mailbox string. It may include a display name, for example `Approval App <no-reply@your-domain.com>`. Reject CR/LF and more than one mailbox.
- `port` is an integer from 1 to 65535.

## Password identity binding

A password belongs to an SMTP identity: normalized host + port + username.

Normalize before compare:

- host: trim, lowercase
- port: integer
- username: trim; empty and omitted are the same

Rules:

- A stored DB password or env `SMTP_PASS` may be reused only when host, port, and username match the credential’s source.
- If host, port, or username changed, require a new password or an explicit no-auth save. Never send the old secret to a new SMTP server.
- First env → DB save may import `SMTP_PASS` server-side only when host, port, and username match current env. The admin does not re-type the key in that case.
- If the first save changes host, port, or username, do not import `SMTP_PASS`.
- Blank password means “keep or import existing” only under the unchanged-identity rule. Never silently create an authenticated DB row with no secret.
- Custom SMTP may be saved with explicit no-auth (empty username and an explicit “No authentication” choice). Authenticated presets (Resend, Gmail, Outlook) cannot be saved without a password unless identity-bound reuse applies.
- Bind the encrypted credential to host, port, and username as AES-GCM additional authenticated data so a swapped identity cannot decrypt under the old secret.

## Runtime Resolution

Replace the module-level Nodemailer transporter in `src/server-actions/notifications.ts` with a helper, for example `resolveEmailTransport()`, called on each logical send so a save applies to the next email without a restart.

Do not keep an in-memory settings cache unless it has cross-instance invalidation. Next.js module caching would retain stale transporters. Create a non-pooled Nodemailer transporter per logical send. One settings query per logical send, not per recipient.

Resolution order:

1. **No `email_settings` row** → use `SMTP_HOST`, `SMTP_PORT` (default `587`), `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`. If host or from is missing, skip email and log the same style of warning used today.
2. **Row exists and `enabled === false`** → skip notification email. Env is ignored. This is the master switch. Test send is still allowed.
3. **Row exists and `enabled === true`** → use DB host, port, username, decrypted password, and from address. Never fall back to env.

Transport security:

- Port `465` uses implicit TLS (`secure: true`).
- Any other port with authentication requires STARTTLS (`requireTLS: true`). Do not authenticate if TLS is unavailable.
- Explicit no-auth Custom SMTP still prefers STARTTLS when offered, but may connect without auth.
- Set bounded connection, greeting, and socket timeouts so a bad Custom host cannot stall post-commit notification work for Nodemailer’s long defaults. Recommended starting point: 10 seconds each.

Keep settings resolution and SMTP work inside the existing notification send error boundary so SMTP failure remains non-fatal to the already-created in-app notification.

Test send uses the same transport builder. It may accept unsaved form values so an admin can probe a provider before or while saving. Unsaved test values are not persisted unless the admin also saves. Test send must not mutate the database.

## Admin UI

New route: `/admin/email`. Admin-only via the existing admin layout **and** explicit server-action checks. Layout protection is not enough because Server Actions are independently callable.

Entry point: a new “Email notifications” card on `/admin`. No extra navbar link.

Page contents:

1. Master toggle: Email notifications on/off.
2. Provider preset: Resend, Gmail, Outlook/Microsoft 365, Custom.
3. Fields: host, port, username, password, from address.
4. Custom-only: explicit “No authentication” checkbox.
5. Actions: Save settings, Send test email.
6. Status line: config source (`env` or `admin`), effective enabled state, and `hasPassword` / `needsPasswordReset`. Never show env or DB secrets.

Behavior:

- Choosing a preset fills host/port (and username for Resend) but does not overwrite a password the admin already typed.
  - Resend → `smtp.resend.com`, `587`, username `resend`
  - Gmail → `smtp.gmail.com`, `587`
  - Outlook → `smtp.office365.com`, `587`
  - Custom → do not change host/port/username
- Password is write-only. The dots are an HTML `placeholder`, never an input `value`. If a reusable password exists, return `hasPassword: true`. An empty password on save means keep/import only when identity is unchanged.
- If identity changed and the password field is blank, reject save with a “re-enter password for the new server” error.
- If no DB row exists, prefill visible fields from `SMTP_*` and set `hasPassword` from whether `SMTP_PASS` is present. Do not send the env password to the client.
- Save upserts the singleton row. Encrypt a newly provided password. Import env or keep stored password only under the identity-binding rules.
- Test send uses the current form values, including unsaved ones, and is allowed while notifications are disabled. It is an explicit admin probe, not a notification. Recipient is the current admin’s email loaded from the database by the verified admin user id, not only the JWT email claim. Reject if that address is missing.
- Success or failure is shown in a toast. Failure may include a sanitized, length-bounded SMTP message. Never return raw error objects, stack traces, transporter config, or secrets.
- A provider-specific help panel sits under the preset. Each field also has a one-line hint.
- Decrypt failure or auth-tag failure loads the form with `needsPasswordReset: true` and a “re-enter password” banner. Notification send is skipped until a new password is saved.

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
- Some tenants disable password SMTP or require OAuth. The UI must not promise that a mailbox password always works.

**Custom**

- Copy host, port, username, password, and allowed From from the provider’s SMTP documentation.
- Use “No authentication” only for internal relays that do not require a login.

## Security

- Every email-settings server action must check `requireAdmin()` and reject a null result. `requireAdmin()` returns `null`; it does not throw.

```ts
const adminId = await requireAdmin()
if (!adminId) throw new Error('Admin access required')
```

- Test send loads the recipient with that `adminId` from Prisma (`User.email`). Do not trust `session.user.email` alone.
- Encrypt `passwordEncrypted` with AES-256-GCM.
  - Key material is `NEXTAUTH_SECRET` only. Do not use `AUTH_SECRET ?? NEXTAUTH_SECRET`. Adding `AUTH_SECRET` later must not silently change the decryption key.
  - Derive a 32-byte domain-separated key with HKDF-SHA256. Do not pass raw env text to AES.
  - Generate a fresh 12-byte GCM nonce for every encryption.
  - Store a versioned envelope: version, nonce, authentication tag, ciphertext.
  - Bind AAD to normalized host, port, and username.
  - Fail closed on malformed data, authentication-tag failure, missing key, or key rotation. Surface `needsPasswordReset`.
- Rotating `NEXTAUTH_SECRET` invalidates stored SMTP passwords. Document that coupling. Admins must re-enter the SMTP password after auth-secret rotation.
- GET/load payloads include `hasPassword` and `needsPasswordReset`. They never include plaintext, ciphertext, or env secrets.
- Do not log password, ciphertext, envelope, or full transporter auth objects.
- Crypto and config modules are server-only. Do not import them from client components.
- Non-admins receive the same authorization failure used by other admin actions.
- An admin can point the server at an arbitrary host/port. Mitigate with validation, timeouts, explicit admin authorization, and no secret leakage. Do not add network allowlists in this slice.

## Testing

Cover at least:

- Resolver: no row → env values; `enabled: false` → no notification send even if env is set; `enabled: true` → DB values.
- After a row exists, decrypt failure and invalid DB config do not fall back to env.
- Identity-bound reuse: blank password keeps/imports only when host+port+username match; otherwise save is rejected.
- First save imports `SMTP_PASS` only when identity matches env.
- Save encrypts a new password with a fresh nonce and versioned envelope.
- Loaded settings omit password and set `hasPassword` / `needsPasswordReset` correctly.
- Crypto: round-trip, random nonce, tampered ciphertext, wrong key, missing secret, and no secret in error messages.
- Test send: mocked transporter success and failure; recipient is the DB admin email; allowed when notifications are disabled; does not write the DB.
- Direct Server Action authorization: non-admin cannot read, save, or test.
- Port validation, mailbox/`fromAddress` CR/LF rejection, STARTTLS/timeout options on authenticated non-465 transports.
- Existing notification regression tests still pass, including the rule that SMTP helpers stay out of Prisma transaction callbacks.

## Docs and Deploy

- README and `.env.example` still document `SMTP_*` as an optional fallback used until admin settings are saved.
- Deployment docs note that provider changes no longer require a process restart once settings are saved in admin.
- Document that rotating `NEXTAUTH_SECRET` requires re-entering the SMTP password.
- Ship an additive Prisma migration in the repo. Do not apply it to production from this session.

## Files (expected)

- `prisma/schema.prisma` — add `email_settings`
- `prisma/migrations/<timestamp>_email_settings/` — additive migration
- `src/lib/email-crypto.ts` — HKDF + AES-256-GCM envelope, server-only
- `src/lib/email-settings.ts` — resolve transport config, identity compare, validation
- `src/server-actions/email-settings.ts` — get, save, test send with explicit admin reject
- `src/server-actions/notifications.ts` — use resolver instead of module-level env transporter
- `src/app/admin/email/page.tsx` — page
- `src/components/admin/email-settings-form.tsx` — form, presets, help, test button
- `src/app/admin/page.tsx` — dashboard card
- Tests under `tests/` for resolver, identity-bound password rules, crypto, auth, TLS/timeouts, and test send
- README / `.env.example` wording updates

## Error Handling

- Missing host or from when enabled: do not send; return a clear error on test send; log a warning on notification send.
- Decrypt failure: do not send; do not fall back to env; surface `needsPasswordReset` and a “re-enter password” message on the admin page.
- SMTP failure on notification send: log a sanitized error, do not fail the in-app notification write.
- SMTP failure on test send: return a sanitized, bounded provider message to the admin toast.
- Authorization failure: throw or return the same admin-required error used elsewhere. Do not leak whether settings exist.

## Isolation

Work lands on a branch or worktree so it does not collide with in-progress request-modal / file-preview UI changes. Shared files to avoid unless required: `src/app/admin/page.tsx` (additive card only) and `src/server-actions/notifications.ts` (transporter lookup only).
