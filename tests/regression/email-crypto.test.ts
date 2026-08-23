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
    // Deterministically alter the ciphertext: random base64 may contain no 'A',
    // so a fixed character swap would sometimes be a no-op tamper.
    const last = envelope.c.slice(-1)
    envelope.c = envelope.c.slice(0, -1) + (last === 'A' ? 'B' : 'A')
    assert.throws(() => decryptEmailSecret(JSON.stringify(envelope), aad))
    const otherAad = buildEmailSecretAad({ host: 'smtp.gmail.com', port: 587, username: 'user@gmail.com' })
    assert.throws(() => decryptEmailSecret(encryptEmailSecret('re_test_key', aad), otherAad))
  })

  it('rejects truncated GCM auth tags and non-standard nonce lengths', () => {
    const aad = buildEmailSecretAad({ host: 'smtp.resend.com', port: 587, username: 'resend' })
    const envelope = JSON.parse(encryptEmailSecret('re_test_key', aad))
    const tag = Buffer.from(envelope.t, 'base64')
    assert.equal(tag.length, 16)
    // Truncated tags are still accepted by Node's raw GCM API with reduced
    // integrity strength; decryption must reject them up front.
    envelope.t = tag.subarray(0, 15).toString('base64')
    assert.throws(() => decryptEmailSecret(JSON.stringify(envelope), aad))
    const nonce = Buffer.from(envelope.n, 'base64')
    assert.equal(nonce.length, 12)
    envelope.t = tag.toString('base64')
    envelope.n = Buffer.concat([nonce, Buffer.from([0])]).toString('base64')
    assert.throws(() => decryptEmailSecret(JSON.stringify(envelope), aad))
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
