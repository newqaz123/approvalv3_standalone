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
