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
})
