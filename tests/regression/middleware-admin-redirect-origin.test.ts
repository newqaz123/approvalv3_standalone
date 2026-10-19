import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { encode } from '@auth/core/jwt'

/**
 * T18B/T19B regression: a signed-in non-admin visiting /admin/* must be
 * denied WITHOUT the middleware issuing a redirect that changes the host.
 * Cookies are host-scoped (127.0.0.1 and localhost are different cookie
 * hosts), so an absolute redirect that flips the host silently drops the
 * session and the target page bounces the user to /sign-in — the failure
 * mode captured in the 2026-09-19 business run:
 *
 *   GET 127.0.0.1:PORT/admin/organization  (session cookie sent)
 *   307 Location: http://localhost:PORT/requests/my-actions   <- host flip
 *   GET localhost:PORT/requests/my-actions (NO cookie sent)
 *   307 Location: /sign-in?callbackUrl=%2Frequests%2Fmy-actions
 *
 * next dev's middleware adapter rewrites absolute Locations to a
 * synthesized localhost origin and rejects relative Locations outright,
 * so no middleware redirect can be made host-stable. The denial therefore
 * lives in the admin layout (DB-backed role check + server-side
 * redirect(), which emits an origin-relative Location), and the
 * middleware must simply not redirect signed-in users cross-origin.
 *
 * Landing correction (2026-09-19): the layout denial is role-aware — an
 * authenticated Engineering-ROLE user (UserRole.engineering, NOT merely a
 * member of an engineering organization unit) lands on /engineering; every
 * other non-admin keeps the prior /requests destination. The middleware
 * stays role-blind for /admin so no host-flipping redirect is ever issued.
 */

const SECRET = 'regression-middleware-origin-secret'
const BROWSER_ORIGIN = 'http://127.0.0.1:9999'
const SYNTHESIZED_HOST = 'localhost:9999'

type Middleware = (req: NextRequest) => Promise<Response>

let middleware: Middleware
let savedEnv: Record<string, string | undefined> = {}

async function mintSessionCookie(role: string): Promise<string> {
  const token = await encode({
    token: {
      id: 'regression-user-1',
      email: 'regression@example.com',
      name: 'Regression User',
      role,
      forcePasswordChange: false,
    },
    secret: SECRET,
    salt: 'authjs.session-token',
    maxAge: 60 * 60,
  })
  return `authjs.session-token=${token}`
}

function adminOrganizationRequest(
  cookie: string | null,
  headers: Record<string, string> = {},
): NextRequest {
  const allHeaders: Record<string, string> = {
    // Next.js always sets x-forwarded-proto on real requests; without it the
    // auth URL falls back to https and the plain session cookie name is
    // never consulted.
    'x-forwarded-proto': 'http',
    ...headers,
  }
  if (cookie) allHeaders.cookie = cookie
  return new NextRequest(`${BROWSER_ORIGIN}/admin/organization?panel=chains`, {
    redirect: 'manual',
    headers: allHeaders,
  })
}

function assertNoRedirect(response: Response): void {
  assert.equal(
    response.headers.get('location'),
    null,
    'middleware must not redirect a signed-in user away from /admin — ' +
      'role denial belongs to the admin layout so the Location stays origin-relative',
  )
}

describe('middleware admin-route denial keeps the session on-origin', () => {
  before(async () => {
    for (const key of ['NEXTAUTH_SECRET', 'AUTH_SECRET', 'NEXTAUTH_URL', 'AUTH_URL']) {
      savedEnv[key] = process.env[key]
    }
    process.env.NEXTAUTH_SECRET = SECRET
    delete process.env.AUTH_SECRET
    delete process.env.NEXTAUTH_URL
    delete process.env.AUTH_URL
    middleware = (await import('../../src/middleware')).default as Middleware
  })

  after(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('non-admin /admin passes through middleware without a redirect under a dev-synthesized localhost host header', async () => {
    const cookie = await mintSessionCookie('staff')
    // next dev proxies the request internally with a rewritten Host; the
    // browser is on 127.0.0.1 but the middleware sees localhost.
    const request = adminOrganizationRequest(cookie, {
      host: SYNTHESIZED_HOST,
      'x-forwarded-host': SYNTHESIZED_HOST,
    })
    const response = await middleware(request)
    assertNoRedirect(response)
  })

  it('non-admin /admin passes through middleware without a redirect with plain host headers', async () => {
    const cookie = await mintSessionCookie('staff')
    const request = adminOrganizationRequest(cookie, {
      host: '127.0.0.1:9999',
    })
    const response = await middleware(request)
    assertNoRedirect(response)
  })

  it('admin session is not redirected away from /admin', async () => {
    const cookie = await mintSessionCookie('admin')
    const request = adminOrganizationRequest(cookie, {
      host: SYNTHESIZED_HOST,
      'x-forwarded-host': SYNTHESIZED_HOST,
    })
    const response = await middleware(request)
    assert.equal(response.status, 200, 'admin must pass through to the admin surface')
    assert.equal(response.headers.get('location'), null)
  })

  it('unauthenticated /admin still requires login on the browser origin', async () => {
    const request = adminOrganizationRequest(null, {
      host: '127.0.0.1:9999',
    })
    const response = await middleware(request)
    assert.ok(
      response.status >= 300 && response.status < 400,
      `expected a redirect to sign-in, got ${response.status}`,
    )
    const location = response.headers.get('location')
    assert.ok(location, 'expected a Location header on the sign-in redirect')
    const resolved = new URL(location, BROWSER_ORIGIN)
    assert.equal(
      resolved.origin,
      BROWSER_ORIGIN,
      `sign-in redirect must keep the browser origin ${BROWSER_ORIGIN}, got ${location}`,
    )
    assert.equal(resolved.pathname, '/sign-in')
    assert.equal(
      resolved.searchParams.get('callbackUrl'),
      '/admin/organization?panel=chains',
      'sign-in bounce must remember the denied path',
    )
  })

  it('unauthenticated /admin still requires login under a dev-synthesized localhost host header', async () => {
    // Origin is intentionally not asserted here: the dev adapter rewrites
    // absolute middleware Locations to its synthesized localhost origin.
    // Only anonymous csrf cookies are affected, and login is still
    // required — the guard this test pins.
    const request = adminOrganizationRequest(null, {
      host: SYNTHESIZED_HOST,
      'x-forwarded-host': SYNTHESIZED_HOST,
    })
    const response = await middleware(request)
    assert.ok(
      response.status >= 300 && response.status < 400,
      `expected a redirect to sign-in, got ${response.status}`,
    )
    const location = response.headers.get('location')
    assert.ok(location, 'expected a Location header on the sign-in redirect')
    const resolved = new URL(location, BROWSER_ORIGIN)
    assert.equal(resolved.pathname, '/sign-in')
    assert.equal(
      resolved.searchParams.get('callbackUrl'),
      '/admin/organization?panel=chains',
      'sign-in bounce must remember the denied path',
    )
  })

  it('engineering-role session passes through middleware without a redirect — denial belongs to the admin layout', async () => {
    const cookie = await mintSessionCookie('engineering')
    const request = adminOrganizationRequest(cookie, {
      host: SYNTHESIZED_HOST,
      'x-forwarded-host': SYNTHESIZED_HOST,
    })
    const response = await middleware(request)
    assertNoRedirect(response)
  })

  it('admin layout owns the non-admin denial via a relative redirect', () => {
    const layout = readFileSync('src/app/admin/layout.tsx', 'utf8')
    assert.match(
      layout,
      /if \(!session\?\.user\?\.id\) \{\s*redirect\(['"]\/sign-in['"]\)/,
      'admin layout must redirect unauthenticated visitors to /sign-in',
    )
    assert.match(
      layout,
      /redirect\(user\?\.role === ['"]engineering['"] \? ['"]\/engineering['"] : ['"]\/requests['"]\)/,
      'admin layout must send Engineering-role denials to /engineering and every other non-admin to /requests',
    )
    assert.match(
      layout,
      /if \(!user \|\| user\.role !== ['"]admin['"]\) \{/,
      'admin layout denial must stay keyed on the DB-backed role check',
    )
  })

  it('both admin layouts keep an identical role-aware denial so the duplicated guard cannot drift', () => {
    const authoritative = readFileSync('src/app/admin/layout.tsx', 'utf8')
    const routeGroup = readFileSync('src/app/(admin)/layout.tsx', 'utf8')
    const denialPattern =
      /if \(!user \|\| user\.role !== ['"]admin['"]\) \{[\s\S]*?redirect\(user\?\.role === ['"]engineering['"] \? ['"]\/engineering['"] : ['"]\/requests['"]\)\s*\}/
    assert.match(
      authoritative,
      denialPattern,
      'authoritative admin layout must carry the role-aware denial',
    )
    assert.match(
      routeGroup,
      denialPattern,
      '(admin) route-group layout must match the authoritative denial',
    )
  })

  it('denial destinations are origin-relative bare paths — no host or protocol in any admin-layout redirect', () => {
    for (const path of ['src/app/admin/layout.tsx', 'src/app/(admin)/layout.tsx']) {
      const layout = readFileSync(path, 'utf8')
      const redirectCalls = layout.match(/redirect\([^)]*\)/g) ?? []
      assert.ok(redirectCalls.length > 0, `${path} must contain redirect calls`)
      for (const call of redirectCalls) {
        assert.doesNotMatch(
          call,
          /https?:\/\//,
          `${path} redirect must stay origin-relative, got ${call}`,
        )
        assert.ok(
          /^redirect\((['"`])\//.test(call) || /^redirect\(user\?\.role/.test(call),
          `${path} redirect must resolve to a root-relative path, got ${call}`,
        )
      }
    }
  })
})
