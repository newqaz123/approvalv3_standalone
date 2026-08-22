import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const read = (path: string) => readFileSync(path, 'utf8')

/**
 * Environment-gated auth contract for the behavioral UI harness:
 * /test-harness/* must be reachable without authentication ONLY when
 * E2E_UI_HARNESS === '1'. Without the flag every harness route stays behind
 * authentication in the NextAuth `authorized` callback AND 404s in the page
 * component. No production route may be opened by the flag.
 */
describe('test harness auth gate', () => {
  const authConfig = read('src/lib/auth-config.ts')
  const authorizedBody = authConfig.slice(authConfig.indexOf('async authorized('))

  it('allows /test-harness without auth only behind the exact E2E_UI_HARNESS=1 check', () => {
    const gate = authorizedBody.match(
      /if \(\s*pathname\.startsWith\('\/test-harness'\)\s*&&\s*process\.env\.E2E_UI_HARNESS === '1'\s*\)\s*\{\s*return true\s*\}/,
    )
    assert.ok(
      gate,
      'authorized() must allow /test-harness only when pathname matches AND E2E_UI_HARNESS is exactly "1"',
    )
    // Exact string equality (not truthiness): "true", "yes", "0"... must not
    // open the gate.
    assert.ok(gate[0].includes("=== '1'"))
  })

  it('evaluates the harness gate before the catch-all authenticated fallback', () => {
    const gateIndex = authorizedBody.indexOf("pathname.startsWith('/test-harness')")
    const fallbackIndex = authorizedBody.indexOf('return isLoggedIn')
    assert.ok(gateIndex >= 0, 'harness gate must exist in authorized()')
    assert.ok(fallbackIndex >= 0, 'authorized() must keep the authenticated fallback')
    assert.ok(
      gateIndex < fallbackIndex,
      'the harness gate must come before the default `return isLoggedIn` so only /test-harness is affected',
    )
  })

  it('references the /test-harness route in exactly one code gate so no production route is opened', () => {
    const occurrences = authConfig.match(/'\/test-harness'/g)
    assert.deepEqual(occurrences, ["'/test-harness'"])
  })

  it('keeps every harness page 404-gated when the flag is absent', () => {
    const harnessRoot = 'src/app/test-harness'
    const pages = readdirSync(harnessRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(harnessRoot, entry.name, 'page.tsx'))
    assert.ok(pages.length >= 4, `expected harness pages, found: ${pages.join(', ')}`)
    for (const page of pages) {
      const source = read(page)
      assert.match(
        source,
        /E2E_UI_HARNESS\s*!==\s*["']1["']\s*\)\s*notFound\(\)/,
        `${page} must call notFound() unless E2E_UI_HARNESS === "1"`,
      )
    }
  })

  it('e2e harness spec skips cleanly when E2E_UI_HARNESS is absent from the Playwright process', () => {
    const spec = read('tests/e2e/engineering-resolution-trend-ui.spec.ts')
    assert.match(spec, /test\.skip\(/)
    assert.match(
      spec,
      /process\.env\.E2E_UI_HARNESS === ["']1["']/,
      'the skip guard must key off the exact flag value',
    )
  })
})
