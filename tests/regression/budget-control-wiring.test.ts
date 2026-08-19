import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

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

  it('uses tabs and a group select instead of drag and drop', () => {
    const page = readFileSync('src/components/budget/budget-monitor-page.tsx', 'utf8')
    assert.match(page, /budget-monitor-view/)
    assert.match(page, /value="depts"/)
    assert.match(page, /value="requests"/)
    assert.match(page, /BudgetDepartmentPanel/)
    assert.match(page, /BudgetRequestTable/)
    assert.match(page, /Reports/)
    assert.match(page, /BudgetCodePasteDialog/)
    assert.match(page, /exportBudgetMonitorXlsx/)
    assert.doesNotMatch(page, /DndContext|DragOverlay|budget-monitor-dnd/)
    assert.doesNotMatch(page, /RemainingRequestPanel/)
    assert.equal(existsSync('src/components/budget/budget-code-box.tsx'), false)
    assert.equal(existsSync('src/components/budget/remaining-request-panel.tsx'), false)
  })

  it('uses one top search for budget codes and request names', () => {
    const page = readFileSync('src/components/budget/budget-monitor-page.tsx', 'utf8')
    const serverAction = readFileSync('src/server-actions/budget-control.ts', 'utf8')

    assert.match(page, /placeholder="Search code or request"/)
    assert.match(page, /budgetCodeSearch/)
    assert.doesNotMatch(page, /placeholder="Filter budget code"/)
    assert.match(serverAction, /matchesBudgetMonitorSearch/)
  })

  it('keeps budget search suggestions closed until text is entered', () => {
    const searchInput = readFileSync('src/components/budget/budget-search-input.tsx', 'utf8')

    assert.match(searchInput, /trimmedValue\.length > 0/)
    assert.match(searchInput, /setOpen\(nextValue\.trim\(\)\.length > 0\)/)
    assert.doesNotMatch(searchInput, /if \(!trimmedValue\) return options/)
    assert.doesNotMatch(searchInput, /Popover/)
    assert.doesNotMatch(searchInput, /CommandItem/)
  })
})
