# Admin SMTP Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins configure notification SMTP from `/admin/email` with provider presets, a master toggle, and a test send, without editing env or restarting.

**Architecture:** Dedicated singleton `email_settings` row. Pure crypto + config modules in `src/lib`. Thin admin server actions. `notifications.ts` builds a Nodemailer transporter per logical send from DB or env fallback. After the first save, DB never falls back to env.

**Tech Stack:** Next.js 15 App Router, Prisma/PostgreSQL, Nodemailer, node:crypto (HKDF-SHA256 + AES-256-GCM), shadcn/ui, node:test via `npx tsx --test`.

**Spec:** `docs/superpowers/specs/2026-08-23-admin-smtp-settings-design.md`

## Global Constraints

- Work on a branch or git worktree. Do not collide with in-progress mobile/file-preview UI WIP.
- Do not run production migrations.
- Do not add Resend/SendGrid SDKs or write SMTP values back into `.env`.
- Do not use `AUTH_SECRET` for email crypto. Key material is `NEXTAUTH_SECRET` only.
- `requireAdmin()` returns `null`. Every email-settings action must reject null with `Admin access required`.
- SMTP helpers stay outside Prisma transaction callbacks.
- Never return plaintext, ciphertext, or env secrets to the client.
- Run `npm run check` after code changes.
- After modifying code, run `graphify update .`.

## File map

- Create: `src/lib/email-crypto.ts` — HKDF + AES-256-GCM envelope
- Create: `src/lib/email-settings.ts` — identity, validation, save decision, runtime resolve, transporter options
- Create: `src/server-actions/email-settings.ts` — get, save, test send
- Create: `src/app/admin/email/page.tsx`
- Create: `src/components/admin/email-settings-form.tsx`
- Create: `prisma/migrations/20260823000000_add_email_settings/migration.sql`
- Create: `tests/regression/email-crypto.test.ts`
- Create: `tests/regression/email-settings.test.ts`
- Create: `tests/regression/email-settings-actions.test.ts`
- Modify: `prisma/schema.prisma` — add `email_settings`
- Modify: `src/server-actions/notifications.ts` — per-send resolver, drop module-level transporter
- Modify: `src/app/admin/page.tsx` — dashboard card
- Modify: `README.md`, `.env.example`

---

### Task 1: Email secret crypto

**Files:**
- Create: `tests/regression/email-crypto.test.ts`
- Create: `src/lib/email-crypto.ts`

**Interfaces:**
- Consumes: `process.env.NEXTAUTH_SECRET`
- Produces:
  - `buildEmailSecretAad(identity: { host: string; port: number; username: string }): string`
  - `encryptEmailSecret(plaintext: string, aad: string): string`
  - `decryptEmailSecret(envelopeJson: string, aad: string): string`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildEmailSecretAad,
  encryptEmailSecret,
  decryptEmailSecret,
} from '../../src/lib/email-crypto'

describe('email-crypto', () => {
  const previous = process.env.NEXTAUTH_SECRET

  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = 'test-nextauth-secret-value-32chars!!'
  })

  afterEach(() => {
    process.env.NEXTAUTH_SECRET = previous
  })

  it('round-trips a password bound to host/port/username', () => {
    const aad = buildEmailSecretAad({ host: 'smtp.resend.com', port: 587, username: 'resend' })
    const envelope = encryptEmailSecret('re_test_key', aad)
    const parsed = JSON.parse(envelope)
    assert.equal(parsed.v, 1)
    assert.ok(parsed.n)
    assert.ok(parsed.t)
    assert.ok(parsed.c)
    assert.equal(decryptEmailSecret(envelope, aad), 're_test_key')
  })

  it('uses a fresh nonce each encrypt', () => {
    const aad = buildEmailSecretAad({ host: 'smtp.resend.com', port: 587, username: 'resend' })
    const a = JSON.parse(encryptEmailSecret('re_test_key', aad))
    const b = JSON.parse(encryptEmailSecret('re_test_key', aad))
    assert.notEqual(a.n, b.n)
    assert.notEqual(a.c, b.c)
  })

  it('fails closed on tampered ciphertext or wrong AAD', () => {
    const aad = buildEmailSecretAad({ host: 'smtp.resend.com', port: 587, username: 'resend' })
    const envelope = JSON.parse(encryptEmailSecret('re_test_key', aad))
    envelope.c = envelope.c.replace(/A/g, 'B')
    assert.throws(() => decryptEmailSecret(JSON.stringify(envelope), aad))
    const otherAad = buildEmailSecretAad({ host: 'smtp.gmail.com', port: 587, username: 'user@gmail.com' })
    assert.throws(() => decryptEmailSecret(encryptEmailSecret('re_test_key', aad), otherAad))
  })

  it('fails closed without NEXTAUTH_SECRET and does not include the secret in errors', () => {
    const secret = process.env.NEXTAUTH_SECRET
    delete process.env.NEXTAUTH_SECRET
    const aad = buildEmailSecretAad({ host: 'smtp.resend.com', port: 587, username: 'resend' })
    assert.throws(() => encryptEmailSecret('re_test_key', aad), /NEXTAUTH_SECRET/)
    try {
      encryptEmailSecret('re_test_key', aad)
    } catch (error) {
      assert.doesNotMatch(String(error), /test-nextauth-secret/)
    }
    process.env.NEXTAUTH_SECRET = secret
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/regression/email-crypto.test.ts`

Expected: FAIL because `src/lib/email-crypto.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

`src/lib/email-crypto.ts`:

```ts
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'node:crypto'

const INFO = 'approval-app:email-settings:v1'
const ALGO = 'aes-256-gcm'

type EnvelopeV1 = { v: 1; n: string; t: string; c: string }

function requireSecret() {
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) {
    throw new Error('NEXTAUTH_SECRET is required to encrypt email settings')
  }
  return secret
}

function deriveKey() {
  return Buffer.from(hkdfSync('sha256', requireSecret(), '', INFO, 32))
}

export function buildEmailSecretAad(identity: {
  host: string
  port: number
  username: string
}) {
  return `${identity.host}\n${identity.port}\n${identity.username}`
}

export function encryptEmailSecret(plaintext: string, aad: string) {
  const key = deriveKey()
  const nonce = randomBytes(12)
  const cipher = createCipheriv(ALGO, key, nonce)
  cipher.setAAD(Buffer.from(aad, 'utf8'))
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const envelope: EnvelopeV1 = {
    v: 1,
    n: nonce.toString('base64'),
    t: cipher.getAuthTag().toString('base64'),
    c: ciphertext.toString('base64'),
  }
  return JSON.stringify(envelope)
}

export function decryptEmailSecret(envelopeJson: string, aad: string) {
  let parsed: EnvelopeV1
  try {
    parsed = JSON.parse(envelopeJson) as EnvelopeV1
  } catch {
    throw new Error('Invalid email secret envelope')
  }
  if (parsed.v !== 1 || !parsed.n || !parsed.t || !parsed.c) {
    throw new Error('Unsupported email secret envelope')
  }
  const key = deriveKey()
  const decipher = createDecipheriv(ALGO, key, Buffer.from(parsed.n, 'base64'))
  decipher.setAAD(Buffer.from(aad, 'utf8'))
  decipher.setAuthTag(Buffer.from(parsed.t, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(parsed.c, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx tsx --test tests/regression/email-crypto.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/regression/email-crypto.test.ts src/lib/email-crypto.ts
git commit -m "feat(email): add AES-GCM envelope for SMTP passwords"
```

---

### Task 2: Config resolution, identity binding, and transporter options

**Files:**
- Create: `tests/regression/email-settings.test.ts`
- Create: `src/lib/email-settings.ts`

**Interfaces:**
- Consumes: `buildEmailSecretAad`, `encryptEmailSecret`, `decryptEmailSecret`
- Produces:
  - `EMAIL_PROVIDERS`, `applyEmailPreset(provider)`
  - `normalizeEmailIdentity({ host, port, username })`
  - `identitiesMatch(a, b)`
  - `parseEmailPort(value)`
  - `validateFromAddress(value)`
  - `readEnvEmailConfig(env)`
  - `decidePasswordOnSave(input)`
  - `resolveRuntimeEmailConfig({ row, env })`
  - `buildTransporterOptions(config)`
  - `sanitizeSmtpError(error)`
  - types: `EmailProvider`, `EmailIdentity`, `ResolvedEmailConfig`, `EmailSettingsPublic`

- [ ] **Step 1: Write the failing tests**

Cover at least these cases in `tests/regression/email-settings.test.ts`:

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyEmailPreset,
  decidePasswordOnSave,
  identitiesMatch,
  normalizeEmailIdentity,
  parseEmailPort,
  readEnvEmailConfig,
  resolveRuntimeEmailConfig,
  sanitizeSmtpError,
  validateFromAddress,
  buildTransporterOptions,
} from '../../src/lib/email-settings'

describe('email-settings', () => {
  it('normalizes identity for compare', () => {
    const a = normalizeEmailIdentity({ host: ' SMTP.Resend.com ', port: '587', username: ' resend ' })
    const b = normalizeEmailIdentity({ host: 'smtp.resend.com', port: 587, username: 'resend' })
    assert.equal(a.host, 'smtp.resend.com')
    assert.equal(a.port, 587)
    assert.equal(a.username, 'resend')
    assert.equal(identitiesMatch(a, b), true)
  })

  it('treats empty and omitted username as the same', () => {
    const a = normalizeEmailIdentity({ host: 'mail.internal', port: 25, username: '' })
    const b = normalizeEmailIdentity({ host: 'mail.internal', port: 25, username: undefined })
    assert.equal(identitiesMatch(a, b), true)
  })

  it('rejects invalid ports and CR/LF from addresses', () => {
    assert.equal(parseEmailPort('0').ok, false)
    assert.equal(parseEmailPort('65536').ok, false)
    assert.equal(validateFromAddress('Approval App <a@b.com>\nBcc: x@y.com').ok, false)
    assert.equal(validateFromAddress('Approval App <no-reply@mail.new-flows.com>').ok, true)
  })

  it('keeps a stored password only when identity is unchanged', () => {
    const existing = { host: 'smtp.resend.com', port: 587, username: 'resend', hasEncrypted: true }
    const keep = decidePasswordOnSave({
      host: 'smtp.resend.com',
      port: 587,
      username: 'resend',
      password: '',
      noAuth: false,
      provider: 'resend',
      existing,
      env: null,
    })
    assert.deepEqual(keep, { ok: true, action: 'keep' })

    const changed = decidePasswordOnSave({
      host: 'smtp.gmail.com',
      port: 587,
      username: 'user@gmail.com',
      password: '',
      noAuth: false,
      provider: 'gmail',
      existing,
      env: null,
    })
    assert.equal(changed.ok, false)
  })

  it('imports SMTP_PASS on first save only when identity matches env', () => {
    const env = { host: 'smtp.resend.com', port: 587, username: 'resend', hasPass: true }
    const same = decidePasswordOnSave({
      host: 'smtp.resend.com',
      port: 587,
      username: 'resend',
      password: '',
      noAuth: false,
      provider: 'resend',
      existing: null,
      env,
    })
    assert.deepEqual(same, { ok: true, action: 'import-env' })

    const different = decidePasswordOnSave({
      host: 'smtp.gmail.com',
      port: 587,
      username: 'user@gmail.com',
      password: '',
      noAuth: false,
      provider: 'gmail',
      existing: null,
      env,
    })
    assert.equal(different.ok, false)
  })

  it('allows explicit no-auth only for custom SMTP', () => {
    const allowed = decidePasswordOnSave({
      host: 'mail.internal',
      port: 25,
      username: '',
      password: '',
      noAuth: true,
      provider: 'custom',
      existing: null,
      env: null,
    })
    assert.deepEqual(allowed, { ok: true, action: 'none' })

    const blocked = decidePasswordOnSave({
      host: 'smtp.resend.com',
      port: 587,
      username: 'resend',
      password: '',
      noAuth: true,
      provider: 'resend',
      existing: null,
      env: null,
    })
    assert.equal(blocked.ok, false)
  })

  it('resolves env when no row exists and never falls back after a row exists', () => {
    const env = {
      host: 'smtp.resend.com',
      port: 587,
      username: 'resend',
      password: 'env-pass',
      fromAddress: 'App <no-reply@example.com>',
    }
    const fromEnv = resolveRuntimeEmailConfig({ row: null, env })
    assert.equal(fromEnv.status, 'ready')
    if (fromEnv.status === 'ready') {
      assert.equal(fromEnv.config.source, 'env')
      assert.equal(fromEnv.config.password, 'env-pass')
    }

    const disabled = resolveRuntimeEmailConfig({
      row: { enabled: false, host: 'smtp.gmail.com', port: 587, username: 'a', fromAddress: 'a@b.com', passwordEncrypted: 'x' },
      env,
    })
    assert.equal(disabled.status, 'disabled')

    const decryptFailed = resolveRuntimeEmailConfig({
      row: { enabled: true, host: 'smtp.gmail.com', port: 587, username: 'a', fromAddress: 'a@b.com', passwordEncrypted: 'bad' },
      env,
      decrypt: () => {
        throw new Error('bad')
      },
    })
    assert.equal(decryptFailed.status, 'needsPasswordReset')
    assert.notEqual(decryptFailed.status, 'ready')
  })

  it('requires STARTTLS and timeouts for authenticated non-465 SMTP', () => {
    const options = buildTransporterOptions({
      host: 'smtp.resend.com',
      port: 587,
      username: 'resend',
      password: 'secret',
      fromAddress: 'App <a@b.com>',
      source: 'db',
    })
    assert.equal(options.secure, false)
    assert.equal(options.requireTLS, true)
    assert.equal(options.connectionTimeout, 10_000)
    assert.equal(options.greetingTimeout, 10_000)
    assert.equal(options.socketTimeout, 10_000)
    assert.deepEqual(options.auth, { user: 'resend', pass: 'secret' })
  })

  it('sanitizes SMTP errors and strips secrets', () => {
    const message = sanitizeSmtpError(new Error('Invalid login pass=super-secret-value host=smtp.resend.com'))
    assert.ok(message.length <= 300)
    assert.doesNotMatch(message, /super-secret-value/)
  })

  it('fills Resend/Gmail/Outlook presets and leaves custom alone', () => {
    assert.deepEqual(applyEmailPreset('resend'), {
      provider: 'resend',
      host: 'smtp.resend.com',
      port: 587,
      username: 'resend',
    })
    assert.deepEqual(applyEmailPreset('gmail').host, 'smtp.gmail.com')
    assert.deepEqual(applyEmailPreset('outlook').host, 'smtp.office365.com')
    assert.equal(applyEmailPreset('custom').host, undefined)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/regression/email-settings.test.ts`

Expected: FAIL because `src/lib/email-settings.ts` does not exist.

- [ ] **Step 3: Implement `src/lib/email-settings.ts`**

Required behavior, no placeholders:

- `EmailProvider = 'resend' | 'gmail' | 'outlook' | 'custom'`
- `normalizeEmailIdentity`: trim+lowercase host; `Number(port)`; trim username; empty string if missing
- `parseEmailPort`: integer 1–65535 or `{ ok: false, error }`
- `validateFromAddress`: reject CR/LF and more than one mailbox; allow `local@domain` or `Display Name <local@domain>`
- `readEnvEmailConfig(env = process.env)`: map `SMTP_HOST/PORT/USER/PASS/FROM`; default port 587
- `decidePasswordOnSave`:
  - `noAuth && provider !== 'custom'` → error
  - `noAuth && custom && !username && !password` → `{ action: 'none' }`
  - non-empty password → `{ action: 'encrypt', password }`
  - blank + existing + identity match + `hasEncrypted` → `{ action: 'keep' }`
  - blank + no existing + env identity match + `hasPass` → `{ action: 'import-env' }`
  - else `{ ok: false, error: 'Re-enter the password for this SMTP server' }`
- `resolveRuntimeEmailConfig({ row, env, decrypt })`:
  - no row → env if host and from exist, else `unconfigured`
  - row `enabled === false` → `disabled` (do not use env)
  - row enabled → decrypt with AAD from row identity; on failure `needsPasswordReset`; never env
- `buildTransporterOptions`:
  - `secure: port === 465`
  - `requireTLS: port !== 465 && Boolean(password || username)`
  - timeouts 10_000
  - `auth` only when username or password present
- `sanitizeSmtpError`: `String(error.message || error)`, strip `pass=...` / obvious secrets, cap 300 chars
- `applyEmailPreset` as in the test

Do not import Prisma or Nodemailer here. This module stays unit-testable.

- [ ] **Step 4: Run tests**

Run: `npx tsx --test tests/regression/email-settings.test.ts tests/regression/email-crypto.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/regression/email-settings.test.ts src/lib/email-settings.ts
git commit -m "feat(email): resolve SMTP config and bind password reuse to identity"
```

---

### Task 3: Prisma singleton table

**Files:**
- Modify: `prisma/schema.prisma` (append after `templates`, before `User`)
- Create: `prisma/migrations/20260823000000_add_email_settings/migration.sql`

**Interfaces:**
- Consumes: none
- Produces: `email_settings` model with id `"default"`

- [ ] **Step 1: Add the model**

```prisma
model email_settings {
  id                String   @id @default("default")
  enabled           Boolean  @default(true)
  provider          String   @default("custom")
  host              String
  port              Int      @default(587)
  username          String?
  passwordEncrypted String?
  fromAddress       String
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}
```

- [ ] **Step 2: Add the migration SQL**

`prisma/migrations/20260823000000_add_email_settings/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "email_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "provider" TEXT NOT NULL DEFAULT 'custom',
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 587,
    "username" TEXT,
    "passwordEncrypted" TEXT,
    "fromAddress" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_settings_pkey" PRIMARY KEY ("id")
);
```

- [ ] **Step 3: Generate client locally**

Run: `npx prisma generate`

Do **not** run `prisma migrate deploy` against production. Local `npx prisma migrate dev` is allowed only if the developer is on a local DB and the user has not forbidden local migrate. Prefer `generate` plus the checked-in SQL.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260823000000_add_email_settings
git commit -m "feat(email): add email_settings singleton table"
```

---

### Task 4: Admin server actions

**Files:**
- Create: `src/server-actions/email-settings.ts`
- Create: `tests/regression/email-settings-actions.test.ts`

**Interfaces:**
- Consumes: `requireAdmin` from `@/lib/auth`, prisma, Task 1–2 helpers
- Produces:
  - `getEmailSettingsForAdmin(): Promise<EmailSettingsPublic>`
  - `saveEmailSettings(input): Promise<{ success: true } | { success: false; error: string }>`
  - `sendTestEmail(input): Promise<{ success: true } | { success: false; error: string }>`

`EmailSettingsPublic` shape:

```ts
type EmailSettingsPublic = {
  source: 'env' | 'admin' | 'none'
  enabled: boolean
  provider: EmailProvider
  host: string
  port: number
  username: string
  fromAddress: string
  hasPassword: boolean
  needsPasswordReset: boolean
  noAuth: boolean
}
```

- [ ] **Step 1: Write source-contract tests**

Follow `tests/regression/engineering-sub-tasks.test.ts` / `solution-transaction-notifications.test.ts`: read the action file as text and assert:

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('email-settings server actions', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/server-actions/email-settings.ts'),
    'utf8',
  )

  it('rejects a null requireAdmin result in every exported action', () => {
    assert.match(source, /async function requireAdminUser/)
    assert.match(source, /if \(!adminId\) \{\s*throw new Error\('Admin access required'\)/s)
    assert.match(source, /export async function getEmailSettingsForAdmin/)
    assert.match(source, /export async function saveEmailSettings/)
    assert.match(source, /export async function sendTestEmail/)
    for (const name of ['getEmailSettingsForAdmin', 'saveEmailSettings', 'sendTestEmail']) {
      const start = source.indexOf(`export async function ${name}`)
      assert.notEqual(start, -1, name)
      const slice = source.slice(start, start + 800)
      assert.match(slice, /requireAdminUser/)
    }
  })

  it('never returns password or ciphertext fields', () => {
    assert.doesNotMatch(source, /passwordEncrypted,/)
    assert.doesNotMatch(source, /SMTP_PASS/)
    assert.match(source, /hasPassword/)
    assert.match(source, /needsPasswordReset/)
  })

  it('loads the test recipient from Prisma by admin id', () => {
    assert.match(source, /prisma\.user\.findUnique/)
    assert.match(source, /where: \{ id: adminId \}/)
    assert.match(source, /select: \{ email: true \}/)
    assert.doesNotMatch(source, /session\.user\.email/)
  })

  it('does not write the database during test send', () => {
    const start = source.indexOf('export async function sendTestEmail')
    const slice = source.slice(start)
    assert.doesNotMatch(slice, /prisma\.email_settings\.(create|update|upsert)/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/regression/email-settings-actions.test.ts`

Expected: FAIL because the action file is missing.

- [ ] **Step 3: Implement the actions**

Mirror `src/server-actions/sub-task-stages.ts`:

```ts
'use server'

import nodemailer from 'nodemailer'
import prisma from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import {
  decryptEmailSecret,
  encryptEmailSecret,
  buildEmailSecretAad,
} from '@/lib/email-crypto'
import {
  applyEmailPreset,
  buildTransporterOptions,
  decidePasswordOnSave,
  normalizeEmailIdentity,
  parseEmailPort,
  readEnvEmailConfig,
  sanitizeSmtpError,
  validateFromAddress,
  type EmailProvider,
} from '@/lib/email-settings'

async function requireAdminUser() {
  const adminId = await requireAdmin()
  if (!adminId) {
    throw new Error('Admin access required')
  }
  return adminId
}
```

`getEmailSettingsForAdmin`:

1. `await requireAdminUser()`
2. Load `prisma.email_settings.findUnique({ where: { id: 'default' } })`
3. If row exists, return public fields from the row. `hasPassword = Boolean(passwordEncrypted)`. Try decrypt with row AAD; if it throws, `needsPasswordReset = true`.
4. If no row, prefill from `readEnvEmailConfig(process.env)`. `source = env host && from ? 'env' : 'none'`. `hasPassword = Boolean(env.password)`. Never include the password.
5. Select only public columns for the client payload. Do not spread the Prisma row.

`saveEmailSettings(input)`:

1. `await requireAdminUser()`
2. Validate provider, host (non-empty), port, from address.
3. Load existing row and env config.
4. `decidePasswordOnSave(...)`.
5. Switch:
   - `encrypt` → `encryptEmailSecret(password, aad)`
   - `keep` → existing `passwordEncrypted`
   - `import-env` → `encryptEmailSecret(env.password, aad)`
   - `none` → `null`
6. `prisma.email_settings.upsert({ where: { id: 'default' }, ... })`
7. `revalidatePath('/admin/email')`
8. Return `{ success: true }` or `{ success: false, error }`

`sendTestEmail(input)`:

1. `adminId = await requireAdminUser()`
2. Load `prisma.user.findUnique({ where: { id: adminId }, select: { email: true } })`. If missing, return error.
3. Build transport from **form values**, not from enabled flag. If password blank, resolve via `decidePasswordOnSave` / decrypt / env import using the same identity rules. Do not upsert.
4. `nodemailer.createTransport(buildTransporterOptions(config)).sendMail({ from, to: admin.email, subject: 'Approval App test email', text: 'SMTP test from Admin → Email notifications.' })`
5. Catch → `{ success: false, error: sanitizeSmtpError(error) }`

- [ ] **Step 4: Run tests**

Run: `npx tsx --test tests/regression/email-settings-actions.test.ts tests/regression/email-settings.test.ts tests/regression/email-crypto.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server-actions/email-settings.ts tests/regression/email-settings-actions.test.ts
git commit -m "feat(email): add admin get/save/test SMTP actions"
```

---

### Task 5: Wire notification sends to the resolver

**Files:**
- Modify: `src/server-actions/notifications.ts`
- Modify: `tests/regression/email-settings-actions.test.ts` (add a notifications contract) or create `tests/regression/email-notification-transport.test.ts`

**Interfaces:**
- Consumes: `resolveRuntimeEmailConfig`, `buildTransporterOptions`, `decryptEmailSecret`, `readEnvEmailConfig`
- Produces: `sendEmailNotification` uses a per-send transporter; module-level `transporter` is gone

- [ ] **Step 1: Write the failing contract test**

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('notification SMTP transport', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/server-actions/notifications.ts'),
    'utf8',
  )

  it('does not create a module-level transporter from env', () => {
    assert.doesNotMatch(source, /const transporter = process\.env\.SMTP_HOST/)
    assert.match(source, /resolveRuntimeEmailConfig/)
    assert.match(source, /nodemailer\.createTransport/)
  })

  it('skips notification mail when resolver is not ready', () => {
    assert.match(source, /needsPasswordReset|disabled|unconfigured/)
  })
})
```

- [ ] **Step 2: Run it (expect FAIL)**

Run: `npx tsx --test tests/regression/email-notification-transport.test.ts`

- [ ] **Step 3: Replace the module-level transporter**

Delete:

```ts
const transporter = process.env.SMTP_HOST
  ? nodemailer.createTransport({ ... })
  : null
```

Add a helper in the same file:

```ts
async function resolveNotificationTransport() {
  const row = await prisma.email_settings.findUnique({
    where: { id: 'default' },
  })
  const resolved = resolveRuntimeEmailConfig({
    row,
    env: readEnvEmailConfig(process.env),
    decrypt: (envelope, aad) => decryptEmailSecret(envelope, aad),
  })
  if (resolved.status !== 'ready') {
    return { ok: false as const, reason: resolved.status }
  }
  return {
    ok: true as const,
    from: resolved.config.fromAddress,
    transporter: nodemailer.createTransport(buildTransporterOptions(resolved.config)),
  }
}
```

In `sendEmailNotification`:

- One `resolveNotificationTransport()` per logical send (already one call per `createNotification` / department batch).
- If `!ok`, `console.warn` with the reason (`unconfigured` / `disabled` / `needsPasswordReset`) and return `{ success: false, error }`.
- Use `mail.from = resolved.from` instead of `process.env.SMTP_FROM`.
- Keep the existing `.catch` on callers so in-app notification writes stay non-fatal.
- Do not introduce an in-memory cache.

- [ ] **Step 4: Run focused + existing notification tests**

Run:

```bash
npx tsx --test tests/regression/email-notification-transport.test.ts tests/regression/solution-transaction-notifications.test.ts tests/regression/email-settings-actions.test.ts
```

Expected: PASS. The transaction-boundary test still forbids `sendEmailNotification` inside `$transaction`.

- [ ] **Step 5: Commit**

```bash
git add src/server-actions/notifications.ts tests/regression/email-notification-transport.test.ts
git commit -m "feat(email): resolve SMTP per send from admin settings or env"
```

---

### Task 6: Admin UI

**Files:**
- Create: `src/app/admin/email/page.tsx`
- Create: `src/components/admin/email-settings-form.tsx`
- Modify: `src/app/admin/page.tsx`

**Interfaces:**
- Consumes: `getEmailSettingsForAdmin`, `saveEmailSettings`, `sendTestEmail`, `applyEmailPreset`
- Produces: `/admin/email` page and dashboard card

- [ ] **Step 1: Add the page**

Copy the layout of `src/app/admin/sub-task-stages/page.tsx`: back link to `/admin`, title, description.

```tsx
import Link from 'next/link'
import { ChevronLeft, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getEmailSettingsForAdmin } from '@/server-actions/email-settings'
import { EmailSettingsForm } from '@/components/admin/email-settings-form'

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
          <h1 className="text-3xl font-bold flex items-center gap-2">
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
```

- [ ] **Step 2: Build the form**

`src/components/admin/email-settings-form.tsx` is a client component.

Required UI:

1. Status line: `source` (`Environment` / `Admin settings` / `Not configured`), effective enabled, `needsPasswordReset` banner.
2. Master `Switch` labeled “Email notifications”.
3. Provider `Select`: Resend, Gmail, Outlook / Microsoft 365, Custom. On change, apply preset host/port/username but do not overwrite a typed password.
4. Fields with the spec hints: host, port, username, password, from.
5. Password `<Input type="password" placeholder={hasPassword ? '••••••••' : ''} />`. Never set `value` to dots or a secret. Controlled state starts as `''`.
6. Custom-only checkbox “No authentication”.
7. Provider help panel that switches with the preset. Copy the spec instructions verbatim, including the Outlook OAuth caveat.
8. Buttons: Save settings, Send test email.
9. `toast.success` / `toast.error` from `sonner`.

Save sends current form fields. Test send sends the same fields and is allowed when the toggle is off.

- [ ] **Step 3: Add the dashboard card**

In `src/app/admin/page.tsx`, add a `Mail` card after Sub-task Stages linking to `/admin/email` titled “Email notifications” with description “Configure SMTP and switch email providers”.

Do not change the navbar.

- [ ] **Step 4: Source-check the form for instructions**

Add to `tests/regression/email-settings-actions.test.ts` or a small UI contract test:

```ts
const form = readFileSync(resolve(process.cwd(), 'src/components/admin/email-settings-form.tsx'), 'utf8')
assert.match(form, /resend.com\/api-keys/)
assert.match(form, /myaccount.google.com\/apppasswords/)
assert.match(form, /SMTP AUTH/)
assert.match(form, /OAuth/)
assert.match(form, /placeholder=\{.*hasPassword/)
assert.doesNotMatch(form, /value=\{['"]••••/)
```

- [ ] **Step 5: Run tests and `npm run check`**

```bash
npx tsx --test tests/regression/email-*.test.ts tests/regression/solution-transaction-notifications.test.ts
npm run check
```

Expected: PASS, or only pre-existing failures unrelated to these files.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/email/page.tsx src/components/admin/email-settings-form.tsx src/app/admin/page.tsx tests/regression/email-settings-actions.test.ts
git commit -m "feat(email): add admin SMTP settings page and presets"
```

---

### Task 7: Docs and graph update

**Files:**
- Modify: `README.md`
- Modify: `.env.example`

- [ ] **Step 1: Update README email bullets**

Change the feature bullet to say SMTP can be set in Admin → Email notifications, with `SMTP_*` as fallback until the first save.

Add under Environment Variables, after the SMTP rows:

```
SMTP_* values are used only until an admin saves Email notifications.
After that, Admin settings win and rotating NEXTAUTH_SECRET requires
re-entering the SMTP password.
```

- [ ] **Step 2: Update `.env.example` comment**

```
# Optional email notifications (fallback until configured in Admin → Email)
SMTP_HOST=""
SMTP_PORT="587"
SMTP_USER=""
SMTP_PASS=""
SMTP_FROM=""
```

Do not change `OPTIONAL_PRODUCTION_KEYS`. Env remains valid fallback.

- [ ] **Step 3: Run `npm run check` and `graphify update .`**

- [ ] **Step 4: Commit**

```bash
git add README.md .env.example
git commit -m "docs(email): document admin SMTP settings and env fallback"
```

---

## Spec coverage

| Spec requirement | Task |
|---|---|
| Singleton `email_settings` | 3 |
| Env fallback until first save | 2, 4, 5 |
| Master toggle always wins | 2, 5 |
| No env fallback after row exists | 2, 5 |
| Identity-bound password reuse / env import | 2, 4 |
| Explicit no-auth for Custom only | 2, 4, 6 |
| AES-GCM + HKDF from `NEXTAUTH_SECRET` | 1 |
| AAD bound to host/port/username | 1, 4 |
| `needsPasswordReset` | 2, 4, 6 |
| `requireAdmin()` null reject | 4 |
| Test send uses DB admin email | 4 |
| Test send allowed when disabled, no DB write | 4, 6 |
| STARTTLS + timeouts | 2, 5 |
| `fromAddress` mailbox + no CR/LF | 2 |
| Per-send transporter, no module cache | 5 |
| Presets + inline instructions | 6 |
| Dashboard card, no navbar item | 6 |
| Docs / `NEXTAUTH_SECRET` rotation note | 7 |
| SMTP stays out of Prisma transactions | 5 |
| Isolated branch/worktree | Global |

## Manual smoke (after implementation)

1. With current env SMTP and no DB row: notifications still send; admin form prefills host/user/from and `hasPassword`.
2. Save without changing host/user/port and with blank password: row created, mail still works.
3. Switch preset to Gmail, leave password blank, save: rejected.
4. Toggle off: notification mail stops; test send still works.
5. Test send arrives only at the signed-in admin address.
