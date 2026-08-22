import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

describe('requests page defaults to the no-WR filter', () => {
  it('defaults the WR filter to not-received (Show only no WR enabled)', () => {
    const filters = read('src/components/requests/request-filters.tsx')
    assert.match(
      filters,
      /export const DEFAULT_WR_FILTER = "not-received" as const;/,
      'DEFAULT_WR_FILTER must be "not-received" so the page opens with Show only no WR enabled',
    )
  })

  it('toggling Show only no WR off shows all WR states', () => {
    const filters = read('src/components/requests/request-filters.tsx')
    assert.match(
      filters,
      /filters\.wrStatus === "not-received" \? "all" : "not-received"/,
      'toggling off must switch wrStatus to "all" so every WR state is visible',
    )
    assert.doesNotMatch(
      filters,
      /wrStatus === "not-received" \? DEFAULT_WR_FILTER/,
      'the toggle must not fall back to DEFAULT_WR_FILTER (which is now not-received)',
    )
  })

  it('Clear All restores the default no-WR state', () => {
    const filters = read('src/components/requests/request-filters.tsx')
    const clearMatch = filters.match(
      /const clearFilters = \(\) => \{[\s\S]*?\};/,
    )
    assert.ok(clearMatch, 'clearFilters must exist')
    assert.match(
      clearMatch[0],
      /\{ wrStatus: DEFAULT_WR_FILTER \}/,
      'Clear All must reset to DEFAULT_WR_FILTER (not-received)',
    )
  })

  it('the initial server query filters wrStatus not-received (no unfiltered first render)', () => {
    const page = read('src/app/(dashboard)/requests/page.tsx')
    assert.match(
      page,
      /getMyRequests\(\{\s*wrStatus: 'not-received',?\s*\}\)/,
      'the server-rendered first page must already apply wrStatus not-received',
    )
  })

  it('the client list keeps its initial filter state aligned with the default', () => {
    const list = read('src/components/requests/requests-list-with-filters.tsx')
    assert.match(
      list,
      /useState<GetRequestsFilters>\(\{ wrStatus: DEFAULT_WR_FILTER \}\)/,
    )
  })
})
