import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildBudgetCodeGroups,
  buildBudgetExportRows,
  fuzzyMatchBudgetCode,
  getBudgetUsageAmount,
  normalizeBudgetCode,
} from '../../src/lib/budget-control'

describe('budget control helpers', () => {
  it('normalizes budget codes for case-insensitive lookup', () => {
    assert.equal(normalizeBudgetCode(' capex-2026-it '), 'CAPEX-2026-IT')
    assert.equal(normalizeBudgetCode('CAPEX  2026 IT'), 'CAPEX 2026 IT')
  })

  it('matches budget codes by fuzzy ordered characters', () => {
    assert.equal(fuzzyMatchBudgetCode('CAPEX-2026-IT', 'c26it'), true)
    assert.equal(fuzzyMatchBudgetCode('OPEX-FAC-042', 'it'), false)
  })

  it('prefers engineering estimate over project estimate for usage', () => {
    assert.equal(getBudgetUsageAmount({ projectEstimateCost: 100, engineeringEstimateCost: 250 }), 250)
    assert.equal(getBudgetUsageAmount({ projectEstimateCost: 100, engineeringEstimateCost: null }), 100)
    assert.equal(getBudgetUsageAmount({ projectEstimateCost: null, engineeringEstimateCost: null }), 0)
  })

  it('groups assigned requests and calculates remaining budget', () => {
    const groups = buildBudgetCodeGroups([
      {
        id: 'r1',
        title: 'Server storage',
        status: 'Completed',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        department: { id: 'd1', name: 'IT' },
        budgetCode: { id: 'b1', code: 'CAPEX-2026-IT', displayCode: 'CAPEX-2026-IT', budgetAmount: 1000 },
        projectEstimateCost: 200,
        engineeringEstimateCost: 250,
      },
      {
        id: 'r2',
        title: 'Network expansion',
        status: 'ImprovementRequest',
        createdAt: new Date('2026-01-02T00:00:00Z'),
        department: { id: 'd1', name: 'IT' },
        budgetCode: { id: 'b1', code: 'CAPEX-2026-IT', displayCode: 'CAPEX-2026-IT', budgetAmount: 1000 },
        projectEstimateCost: 300,
        engineeringEstimateCost: null,
      },
    ])

    assert.equal(groups.length, 1)
    assert.equal(groups[0].usedAmount, 550)
    assert.equal(groups[0].remainingBudget, 450)
    assert.equal(groups[0].requests.length, 2)
  })

  it('builds export rows with calculated usage fields', () => {
    const rows = buildBudgetExportRows([
      {
        id: 'r1',
        title: 'Server storage',
        status: 'Completed',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        department: { id: 'd1', name: 'IT' },
        budgetCode: { id: 'b1', code: 'CAPEX-2026-IT', displayCode: 'CAPEX-2026-IT', budgetAmount: 1000 },
        projectEstimateCost: 200,
        engineeringEstimateCost: 250,
      },
    ])

    assert.deepEqual(rows, [
      {
        'Budget Code': 'CAPEX-2026-IT',
        'Budget Amount': 1000,
        'Used Amount': 250,
        'Remaining Budget': 750,
        'Request Title': 'Server storage',
        Department: 'IT',
        Status: 'Completed',
        'Project Estimate Cost': 200,
        'Engineering Estimate Cost': 250,
        'Usage Amount': 250,
        'Request Created Date': '2026-01-01',
      },
    ])
  })
})
