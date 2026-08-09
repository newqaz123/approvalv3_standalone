import { it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

it('uses configured production origins and a relative logout callback', () => {
  const navbar = readFileSync('src/components/navigation/navbar.tsx', 'utf8')
  const env = readFileSync('.env.example', 'utf8')
  const deploy = readFileSync('DEPLOY.md', 'utf8')
  assert.match(navbar, /signOut\(\{ callbackUrl: '\/sign-in' \}\)/)
  assert.doesNotMatch(navbar, /localhost:3000/)
  assert.match(env, /AUTH_URL="https:\/\/approval\.example\.com"/)
  assert.match(env, /NEXTAUTH_URL="https:\/\/approval\.example\.com"/)
  assert.match(env, /NEXT_PUBLIC_APP_URL="https:\/\/approval\.example\.com"/)
  assert.match(env, /AUTH_TRUST_HOST="true"/)
  assert.match(deploy, /proxy_set_header X-Forwarded-Proto \$scheme;/)
})
