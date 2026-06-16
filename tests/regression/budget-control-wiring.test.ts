import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

describe('budget control wiring', () => {
  it('adds the budget monitor route and server data load', () => {
    const page = readFileSync('src/app/(dashboard)/budget-monitor/page.tsx', 'utf8')
    assert.match(page, /getBudgetMonitorData/)
    assert.match(page, /BudgetMonitorPage/)
  })

  it('adds budget monitor navigation links', () => {
    const navbar = readFileSync('src/components/navigation/navbar.tsx', 'utf8')
    const mobileNav = readFileSync('src/components/mobile/mobile-nav.tsx', 'utf8')
    assert.match(navbar, /href="\/budget-monitor"/)
    assert.match(navbar, /Budget Monitor/)
    assert.match(mobileNav, /href: '\/budget-monitor'/)
    assert.match(mobileNav, /Budget/)
  })

  it('keeps budget monitor filters live and supports improved drag/drop affordances', () => {
    const page = readFileSync('src/components/budget/budget-monitor-page.tsx', 'utf8')
    const budgetBox = readFileSync('src/components/budget/budget-code-box.tsx', 'utf8')
    const remainingPanel = readFileSync('src/components/budget/remaining-request-panel.tsx', 'utf8')

    assert.match(page, /BudgetSearchInput/)
    assert.match(page, /useEffect/)
    assert.match(page, /DragOverlay/)
    assert.match(page, /id="budget-monitor-dnd"/)
    assert.doesNotMatch(page, />\s*Apply\s*</)
    assert.match(budgetBox, /ref=\{setNodeRef\}/)
    assert.match(budgetBox, /min-w-\[960px\]/)
    assert.match(budgetBox, /sticky right-0/)
    assert.match(budgetBox, /Remove request from budget code/)
    assert.match(budgetBox, /Drop remaining request on this collapsed box/)
    assert.match(remainingPanel, /Project estimate:/)
    assert.match(remainingPanel, /dragHandleProps/)
    assert.doesNotMatch(remainingPanel, /translate3d/)
  })

  it('uses one top search for budget codes and request names', () => {
    const page = readFileSync('src/components/budget/budget-monitor-page.tsx', 'utf8')
    const serverAction = readFileSync('src/server-actions/budget-control.ts', 'utf8')

    assert.match(page, /placeholder="Search budget code or request"/)
    assert.match(page, /budgetCodeSearch/)
    assert.doesNotMatch(page, /placeholder="Filter budget code"/)
    assert.match(serverAction, /matchesBudgetMonitorSearch/)
  })

  it('removes the duplicate remaining budget column from budget code request rows', () => {
    const budgetBox = readFileSync('src/components/budget/budget-code-box.tsx', 'utf8')
    const requestTable = budgetBox.slice(
      budgetBox.indexOf('min-w-[960px]'),
      budgetBox.indexOf('Drop remaining request here')
    )

    assert.doesNotMatch(requestTable, /<div className="text-right">Remaining budget<\/div>/)
    assert.doesNotMatch(requestTable, /group\.remainingBudget\?\.toLocaleString\(\) \?\? '-'/)
    assert.match(requestTable, /grid-cols-\[minmax\(320px,1\.8fr\)_150px_220px_150px_64px\]/)
  })

  it('keeps budget search suggestions closed until text is entered', () => {
    const searchInput = readFileSync('src/components/budget/budget-search-input.tsx', 'utf8')

    assert.match(searchInput, /trimmedValue\.length > 0/)
    assert.match(searchInput, /setOpen\(nextValue\.trim\(\)\.length > 0\)/)
    assert.doesNotMatch(searchInput, /if \(!trimmedValue\) return options/)
    assert.doesNotMatch(searchInput, /Popover/)
    assert.doesNotMatch(searchInput, /CommandItem/)
  })

  it('renders the remaining request list as a viewport overlay', () => {
    const remainingPanel = readFileSync('src/components/budget/remaining-request-panel.tsx', 'utf8')
    const page = readFileSync('src/components/budget/budget-monitor-page.tsx', 'utf8')

    assert.match(remainingPanel, /fixed bottom-4 right-4/)
    assert.match(remainingPanel, /max-h-\[min\(620px,calc\(100vh-7rem\)\)\]/)
    assert.doesNotMatch(page, /lg:pr-\[22rem\]/)
  })

  it('keeps the remaining request filter inside the floating remaining request list', () => {
    const remainingPanel = readFileSync('src/components/budget/remaining-request-panel.tsx', 'utf8')
    const page = readFileSync('src/components/budget/budget-monitor-page.tsx', 'utf8')

    assert.match(remainingPanel, /useState\(''\)/)
    assert.match(remainingPanel, /placeholder="Filter remaining request"/)
    assert.match(remainingPanel, /filteredRequests/)
    assert.match(remainingPanel, /requestSearch\.trim\(\)/)
    assert.doesNotMatch(page, /placeholder="Filter remaining request"/)
    assert.doesNotMatch(page, /remainingRequestOptions/)
    assert.doesNotMatch(page, /requestSearch/)
    assert.match(page, /lg:grid-cols-\[1\.2fr_1fr_1fr\]/)
  })
})
