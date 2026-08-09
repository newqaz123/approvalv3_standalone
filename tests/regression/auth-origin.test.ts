import { it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// The full forwarded-header contract the controlled Nginx reverse proxy must
// send to the app container so Auth.js derives the correct public origin.
const NGINX_FORWARDED_HEADERS = [
  /proxy_set_header Host\s+\$host;/,
  /proxy_set_header X-Forwarded-Host\s+\$host;/,
  /proxy_set_header X-Forwarded-For\s+\$proxy_add_x_forwarded_for;/,
  /proxy_set_header X-Forwarded-Proto\s+\$scheme;/,
]

it('uses configured production origins and a relative logout callback', () => {
  const navbar = readFileSync('src/components/navigation/navbar.tsx', 'utf8')
  const env = readFileSync('.env.example', 'utf8')
  assert.match(navbar, /signOut\(\{ callbackUrl: '\/sign-in' \}\)/)
  assert.doesNotMatch(navbar, /localhost:3000/)
  assert.match(env, /AUTH_URL="https:\/\/approval\.example\.com"/)
  assert.match(env, /NEXTAUTH_URL="https:\/\/approval\.example\.com"/)
  assert.match(env, /NEXT_PUBLIC_APP_URL="https:\/\/approval\.example\.com"/)
  assert.match(env, /AUTH_TRUST_HOST="true"/)
})

it('both deployment guides document the nginx forwarded-header contract', () => {
  for (const guide of ['DEPLOY.md', 'docs/DEPLOY.md']) {
    const doc = readFileSync(guide, 'utf8')
    for (const header of NGINX_FORWARDED_HEADERS) {
      assert.match(doc, header, `${guide} must document ${header}`)
    }
  }
})

it('both deployment guides point operators at the public HTTPS origin only', () => {
  for (const guide of ['DEPLOY.md', 'docs/DEPLOY.md']) {
    const doc = readFileSync(guide, 'utf8')
    // Operators must browse the configured public HTTPS origin, never the raw
    // server IP or container port.
    assert.match(doc, /https:\/\/approval\.example\.com/, `${guide} must reference the public HTTPS origin example`)
    assert.doesNotMatch(doc, /your-server-ip:3000/, `${guide} must not tell operators to browse the raw server IP`)
    // localhost:3000 is allowed only as a host-local health check, never as
    // the Auth.js public origin.
    assert.match(doc, /host-local health check/, `${guide} must scope localhost:3000 to a host-local health check`)
    // Direct IP/container access is unsupported once the DNS proxy contract
    // is enabled.
    assert.match(doc, /direct IP\/container port access is unsupported/, `${guide} must state direct IP/container access is unsupported`)
    // AUTH_TRUST_HOST is framed as trusting the controlled proxy, not open
    // host trust.
    assert.match(doc, /controlled Nginx proxy/, `${guide} must frame AUTH_TRUST_HOST around the controlled Nginx proxy`)
  }
})
