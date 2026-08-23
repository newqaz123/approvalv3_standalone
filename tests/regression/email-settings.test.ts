import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  applyEmailPreset,
  decidePasswordOnSave,
  identitiesMatch,
  normalizeEmailIdentity,
  parseEmailPort,
  readEnvEmailConfig,
  resolveRuntimeEmailConfig,
  sanitizeSmtpError,
  sanitizeSmtpErrorWithSecrets,
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

  it('redacts exact SMTP credentials from unstructured provider errors', () => {
    const resolvedPassword = 'super-secret-value'
    const envPassword = 'env-secret-value'
    const message = sanitizeSmtpErrorWithSecrets(
      new Error(
        `Authentication failed for ${resolvedPassword}; fallback was ${envPassword}`,
      ),
      [resolvedPassword, envPassword],
    )

    assert.equal(
      message,
      'Authentication failed for [redacted]; fallback was [redacted]',
    )
    assert.doesNotMatch(message, /super-secret-value|env-secret-value/)
  })

  it('redacts an exact credential before SMTP error truncation', () => {
    const longPassword = 'x'.repeat(350)
    const message = sanitizeSmtpErrorWithSecrets(
      new Error(`Authentication failed for ${longPassword}`),
      [longPassword],
    )

    assert.equal(message, 'Authentication failed for [redacted]')
    assert.doesNotMatch(message, /x{20}/)
  })

  it('preserves leading and trailing whitespace in passwords', () => {
    const withSpaces = decidePasswordOnSave({
      host: 'smtp.resend.com',
      port: 587,
      username: 'resend',
      password: ' pad ded ',
      noAuth: false,
      provider: 'resend',
      existing: null,
      env: null,
    })
    assert.deepEqual(withSpaces, {
      ok: true,
      action: 'encrypt',
      password: ' pad ded ',
    })

    // Whitespace-only input still counts as blank.
    const whitespaceOnly = decidePasswordOnSave({
      host: 'smtp.resend.com',
      port: 587,
      username: 'resend',
      password: '   ',
      noAuth: false,
      provider: 'resend',
      existing: null,
      env: null,
    })
    assert.equal(whitespaceOnly.ok, false)
  })

  it('sanitizes URI and quoted JSON credentials', () => {
    const uri = sanitizeSmtpError(
      new Error('connect failed for smtp://resend:re_abc123_secret@smtp.example.com:587'),
    )
    assert.doesNotMatch(uri, /re_abc123_secret/)
    assert.match(uri, /smtp:\/\/resend:\[redacted\]@/)

    const json = sanitizeSmtpError(
      new Error('535 auth failed {"password":"hunter2 secret","user":"resend"}'),
    )
    assert.doesNotMatch(json, /hunter2/)
  })

  it('keeps presets client-safe with no node-only imports', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/lib/email-presets.ts'),
      'utf8',
    )
    // Assert on import module specifiers, not prose: the doc comment
    // legitimately names node-only modules, but only an actual import would
    // pull them into the browser bundle. This repo is semicolon-free, so
    // import statements never end in ';' — match specifiers instead of
    // statements, and only after stripping comments.
    const withoutComments = source
      // Opener must be a literal `/*` — `\/*` is `\/` + `*` quantifier
      // (zero-or-more slashes) and would strip a banned import placed above
      // this file's header comment along with the comment itself.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '')
    const specifiers = [
      ...(withoutComments.match(/from\s+['"][^'"]+['"]/g) ?? []),
      ...(withoutComments.match(/import\s+['"][^'"]+['"]/g) ?? []),
      ...(withoutComments.match(/require\(\s*['"][^'"]+['"]\s*\)/g) ?? []),
    ].join('\n')
    assert.doesNotMatch(
      specifiers,
      /node:|email-crypto|email-settings|nodemailer|prisma/,
    )
    // Non-vacuous: the module must still export the preset API the form uses,
    // so an emptied file cannot pass on zero specifiers alone.
    assert.match(source, /export function applyEmailPreset/)
    assert.match(source, /export const EMAIL_PROVIDERS/)
    assert.match(source, /export type EmailSettingsPublic/)
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
