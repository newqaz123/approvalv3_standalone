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
    assert.match(filters, /className="flex h-10 cursor-pointer/)
    assert.doesNotMatch(filters, /className="flex h-8 cursor-pointer/)
    assert.match(filters, /lg:grid-cols-3/)
    assert.ok(
      filters.includes(
        'xl:grid-cols-[minmax(16rem,1.6fr)_repeat(4,minmax(8.5rem,1fr))_minmax(9rem,auto)_minmax(5.5rem,auto)]'
      )
    )
    assert.doesNotMatch(filters, /2xl:grid-cols-/)
  })

  it('collapses the filter block to exactly two rows without a heading', () => {
    assert.doesNotMatch(filters, />\s*Filters\s*</)
    assert.doesNotMatch(filters, /font-semibold text-gray-700/)
    assert.match(filters, /Clear All/)
    assert.match(filters, /disabled=\{!hasActiveFilters\}/)
    assert.doesNotMatch(filters, /\{hasActiveFilters && \(/)
    assert.match(filters, /data-filter-tier="status"[^>]*flex flex-wrap[^>]*xl:flex-nowrap/)
    assert.match(filters, /whitespace-nowrap/)
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

describe('Requests desktop table proportions and keyboard rows', () => {
  const table = read('src/components/requests/request-table.tsx')
  const requestCard = read('src/components/mobile/request-card.tsx')

  it('uses fixed desktop proportions, taller scan rows, and keyboard activation', () => {
    assert.match(table, /<Table className="min-w-\[[^\]]+\] table-fixed"/)
    assert.match(table, /line-clamp-2/)
    assert.match(table, /whitespace-nowrap/)
    assert.match(table, /<TableCell[^>]*className="h-\[60px\] py-3"/)
    assert.doesNotMatch(table, /<TableRow[\s\S]{0,300}min-h-\[60px\]/)
    assert.match(table, /tabIndex=\{0\}/)
    assert.match(table, /aria-label=\{`Open request /)
    assert.doesNotMatch(table, /<TableRow[\s\S]{0,300}role="button"/)
    assert.match(table, /event\.key === 'Enter' \|\| event\.key === ' '/)
    assert.match(table, /focus-visible:/)
    assert.match(table, /bg-sky-50 hover:bg-sky-100\/60/)
    assert.match(table, /className="md:hidden space-y-3"/)
    assert.match(table, /className="hidden md:block/)
    assert.match(table, /<RequestCard/)
    assert.match(table, /<RequestModalRouter/)
  })

  it('keeps RequestCard tap and empty-state contracts unchanged', () => {
    assert.match(requestCard, /export function RequestCard/)
    assert.match(requestCard, /onTap: \(requestId: string\) => void/)
    assert.match(requestCard, /onClick=\{\(\) => onTap\(request\.id\)\}/)
    assert.match(requestCard, /export function RequestCardsEmptyState/)
    assert.match(requestCard, /message = 'No requests found'/)
    assert.match(requestCard, /submessage = 'Create your first request to get started'/)
  })
})
