import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildBudgetCodeGroups,
  buildBudgetExportRows,
  fuzzyMatchBudgetCode,
  matchesBudgetMonitorSearch,
  getBudgetProjectEstimateAmount,
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

  it('matches the combined budget monitor search by budget code or request details', () => {
    const request = {
      title: 'Replace chilled water pump',
      status: 'Completed',
      department: { id: 'd1', name: 'Production 1' },
      budgetCode: {
        id: 'b1',
        code: 'AYT-PD1-CX-400',
        displayCode: 'AYT-PD1-CX-400',
        budgetAmount: 10000000,
        department: { id: 'd1', name: 'Production 1' },
      },
    }

    assert.equal(matchesBudgetMonitorSearch(request, 'pd1cx'), true)
    assert.equal(matchesBudgetMonitorSearch(request, 'water pump'), true)
    assert.equal(matchesBudgetMonitorSearch(request, 'production completed'), true)
    assert.equal(matchesBudgetMonitorSearch(request, 'warehouse'), false)
  })

  it('prefers engineering estimate over project estimate for usage', () => {
    assert.equal(getBudgetUsageAmount({ projectEstimateCost: 100, engineeringEstimateCost: 250 }), 250)
    assert.equal(getBudgetUsageAmount({ projectEstimateCost: 100, engineeringEstimateCost: null }), 100)
    assert.equal(getBudgetUsageAmount({ projectEstimateCost: null, engineeringEstimateCost: null }), 0)
  })

  it('displays approved engineering estimates in the project estimate column', () => {
    assert.equal(getBudgetProjectEstimateAmount({ projectEstimateCost: null, engineeringEstimateCost: 250 }), 250)
    assert.equal(getBudgetProjectEstimateAmount({ projectEstimateCost: 100, engineeringEstimateCost: 250 }), 250)
    assert.equal(getBudgetProjectEstimateAmount({ projectEstimateCost: 100, engineeringEstimateCost: null }), 100)
    assert.equal(getBudgetProjectEstimateAmount({ projectEstimateCost: null, engineeringEstimateCost: null }), null)
  })

  it('groups assigned requests and calculates remaining budget', () => {
    const groups = buildBudgetCodeGroups([
      {
        id: 'r1',
        title: 'Server storage',
        status: 'Completed',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        department: { id: 'd1', name: 'IT' },
        budgetCode: {
          id: 'b1',
          code: 'CAPEX-2026-IT',
          displayCode: 'CAPEX-2026-IT',
          budgetAmount: 1000,
          department: { id: 'd1', name: 'IT' },
        },
        projectEstimateCost: 200,
        engineeringEstimateCost: 250,
      },
      {
        id: 'r2',
        title: 'Network expansion',
        status: 'ImprovementRequest',
        createdAt: new Date('2026-01-02T00:00:00Z'),
        department: { id: 'd1', name: 'IT' },
        budgetCode: {
          id: 'b1',
          code: 'CAPEX-2026-IT',
          displayCode: 'CAPEX-2026-IT',
          budgetAmount: 1000,
          department: { id: 'd1', name: 'IT' },
        },
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
        budgetCode: {
          id: 'b1',
          code: 'CAPEX-2026-IT',
          displayCode: 'CAPEX-2026-IT',
          budgetAmount: 1000,
          department: { id: 'd1', name: 'IT' },
        },
        projectEstimateCost: 200,
        engineeringEstimateCost: 250,
      },
    ])

    assert.deepEqual(rows, [
      {
        'Budget Code': 'CAPEX-2026-IT',
        'Budget Department': 'IT',
        'Budget Amount': 1000,
        'Used Amount': 250,
        'Remaining Budget': 750,
        'Request Title': 'Server storage',
        'Request Department': 'IT',
        Status: 'Completed',
        'Project Estimate Cost': 200,
        'Engineering Estimate Cost': 250,
        'Request Created Date': '2026-01-01',
      },
    ])
  })

  it('rounds fractional monetary values in groups and export rows', () => {
    const requests = [
      {
        id: 'r1',
        title: 'Fractional usage A',
        status: 'Completed',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        department: { id: 'd1', name: 'IT' },
        budgetCode: {
          id: 'b1',
          code: 'CAPEX-2026-IT',
          displayCode: 'CAPEX-2026-IT',
          budgetAmount: 1,
          department: { id: 'd1', name: 'IT' },
        },
        projectEstimateCost: 0.1,
        engineeringEstimateCost: null,
      },
      {
        id: 'r2',
        title: 'Fractional usage B',
        status: 'Completed',
        createdAt: new Date('2026-01-02T00:00:00Z'),
        department: { id: 'd1', name: 'IT' },
        budgetCode: {
          id: 'b1',
          code: 'CAPEX-2026-IT',
          displayCode: 'CAPEX-2026-IT',
          budgetAmount: 1,
          department: { id: 'd1', name: 'IT' },
        },
        projectEstimateCost: 0.2,
        engineeringEstimateCost: null,
      },
    ]

    const groups = buildBudgetCodeGroups(requests)
    const rows = buildBudgetExportRows(requests)

    assert.equal(groups[0].usedAmount, 0.3)
    assert.equal(groups[0].remainingBudget, 0.7)
    assert.equal(rows[0]['Used Amount'], 0.3)
    assert.equal(rows[0]['Remaining Budget'], 0.7)
    assert.equal(rows[1]['Used Amount'], 0.3)
    assert.equal(rows[1]['Remaining Budget'], 0.7)
  })
})

describe('budget monitor server actions', () => {
  function readServerAction() {
    return readFileSync('src/server-actions/budget-control.ts', 'utf8')
  }

  it('exposes data, mutation, and XLSX export actions from the assigned file', () => {
    const source = readServerAction()

    for (const exportName of [
      'getBudgetMonitorData',
      'assignRequestToBudgetCode',
      'unassignRequestBudgetCode',
      'updateRequestProjectEstimate',
      'updateBudgetCodeAmount',
      'createBudgetCode',
      'exportBudgetMonitorXlsx',
    ]) {
      assert.match(source, new RegExp(`export async function ${exportName}\\b`))
    }

    assert.match(source, /'use server'/)
    assert.match(source, /getCurrentUser/)
    assert.match(source, /XLSX\.utils\.json_to_sheet/)
    assert.match(source, /base64/)
  })

  it('does not update existing budget code amounts from create or assignment paths', () => {
    const source = readServerAction()
    const assignBody = source.slice(
      source.indexOf('export async function assignRequestToBudgetCode'),
      source.indexOf('export async function unassignRequestBudgetCode')
    )
    const createBody = source.slice(
      source.indexOf('export async function createBudgetCode'),
      source.indexOf('export async function exportBudgetMonitorXlsx')
    )

    assert.doesNotMatch(assignBody, /budget_codes\.upsert/)
    assert.doesNotMatch(createBody, /budget_codes\.upsert/)
    assert.match(assignBody, /budget_codes\.findUnique/)
    assert.match(createBody, /budget_codes\.findUnique/)
  })

  it('scopes budget code summaries to visible request codes and creator-owned empty codes', () => {
    const source = readServerAction()
    const getDataBody = source.slice(
      source.indexOf('export async function getBudgetMonitorData'),
      source.indexOf('export async function assignRequestToBudgetCode')
    )

    assert.match(getDataBody, /prisma\.budget_codes\.findMany/)
    assert.match(getDataBody, /createdById: user\.id/)
    assert.match(source, /new Map|new Set/)
    assert.match(getDataBody, /mergeBudgetCodes\(mapped, creatorBudgetCodes\)/)
    assert.match(getDataBody, /request\.budgetCode/)
  })

  it('links budget codes to departments and applies department filtering by budget code for groups', () => {
    const source = readServerAction()
    const schema = readFileSync('prisma/schema.prisma', 'utf8')
    const getDataBody = source.slice(
      source.indexOf('export async function getBudgetMonitorData'),
      source.indexOf('export async function assignRequestToBudgetCode')
    )

    assert.match(schema, /model budget_codes[\s\S]*departmentId/)
    assert.match(schema, /model departments[\s\S]*budgetCodes/)
    assert.match(getDataBody, /budgetCode\?\.department\?\.id === filters\.departmentId/)
    assert.match(getDataBody, /request\.department\?\.id === filters\.departmentId/)
    assert.doesNotMatch(source.slice(source.indexOf('function applyBudgetFilters'), source.indexOf('function decimalToNumber')), /where\.departmentId/)
  })

  it('uses strict finite bounded money parsing without empty-string coercion', () => {
    const source = readServerAction()

    assert.doesNotMatch(source, /z\.coerce\.number/)
    assert.match(source, /MAX_BUDGET_MONEY_AMOUNT/)
    assert.match(source, /Number\.isFinite/)
    assert.match(source, /9999999999999\.99/)
    assert.match(source, /value\.trim\(\) === ''/)
  })

  it('requires exactly one assignment target in assign schema', () => {
    const source = readServerAction()
    const assignSchemaBody = source.slice(
      source.indexOf('const assignSchema'),
      source.indexOf('const requestEstimateSchema')
    )

    assert.match(assignSchemaBody, /\.superRefine|\.refine/)
    assert.match(assignSchemaBody, /budgetCodeId/)
    assert.match(assignSchemaBody, /budgetCode/)
    assert.match(assignSchemaBody, /exactly one/i)
  })

  it('renders budget monitor project estimate cells from the approved display amount', () => {
    const box = readFileSync('src/components/budget/budget-code-box.tsx', 'utf8')
    const remainingPanel = readFileSync('src/components/budget/remaining-request-panel.tsx', 'utf8')

    assert.match(box, /getBudgetProjectEstimateAmount/)
    assert.match(box, /projectEstimateAmount\?\.toLocaleString\(\) \?\? '-'/)
    assert.match(box, /const hasApprovedEstimate = request\.engineeringEstimateCost !== null/)
    assert.match(box, /hasApprovedEstimate \? \(/)
    assert.match(box, /onClick=\{\(\) => onEditProjectEstimate\(request\.id, request\.projectEstimateCost\)\}/)
    assert.match(remainingPanel, /getBudgetProjectEstimateAmount/)
    assert.match(remainingPanel, /Project estimate: \{projectEstimateAmount\?\.toLocaleString\(\) \?\? '-'\}/)
    assert.match(remainingPanel, /const hasApprovedEstimate = request\.engineeringEstimateCost !== null/)
    assert.match(remainingPanel, /!hasApprovedEstimate && onEditProjectEstimate/)
  })

  it('syncs approved engineering solution estimates into the editable project estimate field', () => {
    const source = readFileSync('src/server-actions/solutions.ts', 'utf8')
    const approveBody = source.slice(
      source.indexOf('export async function approveSolution'),
      source.indexOf('export async function rejectSolution')
    )

    assert.match(approveBody, /select:\s*\{[\s\S]*requestId:\s*true,[\s\S]*title:\s*true,[\s\S]*costEstimate:\s*true/)
    assert.match(approveBody, /projectEstimateCost:\s*solutionData\.costEstimate/)

    const autoApproveUpdates = source.match(/projectEstimateCost:\s*(validated\.costEstimate|input\.cost)/g) ?? []
    assert.ok(autoApproveUpdates.length >= 2, 'submit and resubmit auto-approval paths should sync the approved estimate')
  })
})
