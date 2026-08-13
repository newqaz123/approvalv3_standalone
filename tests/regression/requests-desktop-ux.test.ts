import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')
const filters = read('src/components/requests/request-filters.tsx')

describe('Requests desktop filters', () => {
  it('retains the existing Radix Select component and never uses native select', () => {
    assert.match(filters, /from ['"]@\/components\/ui\/select['"]/)
    for (const symbol of ['Select', 'SelectTrigger', 'SelectValue', 'SelectContent', 'SelectItem']) {
      assert.match(filters, new RegExp(`\\b${symbol}\\b`))
    }
    assert.doesNotMatch(filters, /<select(?:\s|>)/)
  })

  it('keeps filtering immediate with no Apply step', () => {
    assert.match(filters, /setFilters\(newFilters\)[\s\S]*onFilterChange\(newFilters\)/)
    assert.match(filters, /onFilterChange\(defaultFilters\)/)
    assert.doesNotMatch(filters, />\s*Apply\s*</)
    assert.match(filters, /aria-pressed=\{showOnlyNoWr\}/)
  })

  it('renders distinct primary and status tiers with responsive controls', () => {
    assert.match(filters, /data-filter-tier="primary"/)
    assert.match(filters, /data-filter-tier="status"/)
    assert.match(filters, /lg:grid-cols-3/)
    assert.ok(filters.includes('2xl:grid-cols-[minmax(20rem,1.8fr)_repeat(4,minmax(10rem,1fr))_minmax(11rem,auto)]'))
    assert.match(filters, /Clear All/)
  })
})

describe('Requests desktop data flow and header', () => {
  it('keeps request list query, cache, and refresh contracts unchanged', () => {
    const listWithFilters = read('src/components/requests/requests-list-with-filters.tsx')

    assert.match(listWithFilters, /URLSearchParams/)
    assert.match(listWithFilters, /params\.append/)
    assert.match(listWithFilters, /\/api\/requests\?/)
    assert.match(listWithFilters, /cache: 'no-store'/)
    assert.match(listWithFilters, /approvalapp:request-data-changed/)
  })

  it('retains the Requests heading, supporting copy, actions, and mobile stack', () => {
    const listClient = read('src/components/requests/requests-list-client.tsx')

    assert.match(listClient, />Requests</)
    assert.match(listClient, /View and track improvement requests from your department/)
    assert.match(listClient, /BulkDeleteByDateRange/)
    assert.match(listClient, /New Request/)
    assert.match(listClient, /flex flex-col sm:flex-row/)
    assert.doesNotMatch(listClient, /Export View/)
    assert.doesNotMatch(listClient, />\s*Apply\s*</)
  })
})
