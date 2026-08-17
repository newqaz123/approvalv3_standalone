import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildBudgetCodeGroups,
  buildBudgetExportRows,
  classifyBudgetCodePasteRows,
  fuzzyMatchBudgetCode,
  getBudgetCodeHealth,
  getBudgetCodeLabel,
  getBudgetProjectEstimateAmount,
  getBudgetUsageAmount,
  groupBudgetCodesByDepartment,
  matchesBudgetMonitorSearch,
  normalizeBudgetCode,
  parseBudgetCodePaste,
  sumVisibleRemainingBudget,
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
        name: null,
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
          name: null,
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
          name: null,
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
          name: null,
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
          name: null,
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
          name: null,
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

  it('matches budget monitor search against budget code name', () => {
    const request = {
      title: 'Replace chilled water pump',
      status: 'Completed',
      department: { id: 'd1', name: 'Production 1' },
      budgetCode: {
        id: 'b1',
        code: 'AYT-PD1-CX-400',
        displayCode: 'AYT-PD1-CX-400',
        name: 'Line 2 filler capex',
        budgetAmount: 10000000,
        department: { id: 'd1', name: 'Production 1' },
      },
    }

    assert.equal(matchesBudgetMonitorSearch(request, 'filler capex'), true)
    assert.equal(matchesBudgetMonitorSearch(request, 'warehouse'), false)
  })

  it('labels a budget code with name and falls back to displayCode', () => {
    assert.equal(getBudgetCodeLabel({ name: 'Filler upgrade', displayCode: 'AYT-PD1-GF-411' }), 'Filler upgrade')
    assert.equal(getBudgetCodeLabel({ name: '  ', displayCode: 'AYT-PD1-GF-411' }), 'AYT-PD1-GF-411')
    assert.equal(getBudgetCodeLabel({ name: null, displayCode: 'AYT-PD1-GF-411' }), 'AYT-PD1-GF-411')
  })

  it('classifies budget health without blocking', () => {
    assert.equal(getBudgetCodeHealth(-1, 100), 'Over')
    assert.equal(getBudgetCodeHealth(10, 100), 'Watch')
    assert.equal(getBudgetCodeHealth(20, 100), 'Healthy')
    assert.equal(getBudgetCodeHealth(null, null), 'Healthy')
    assert.equal(getBudgetCodeHealth(5, 0), 'Healthy')
  })

  it('groups budget codes by department and sums remaining', () => {
    const groups = [
      {
        budgetCode: {
          id: 'b1',
          code: 'A',
          displayCode: 'A',
          name: 'Alpha',
          budgetAmount: 100,
          department: { id: 'd1', name: 'Production 1' },
        },
        usedAmount: 40,
        remainingBudget: 60,
        assignedRequestCount: 1,
        requests: [],
      },
      {
        budgetCode: {
          id: 'b2',
          code: 'B',
          displayCode: 'B',
          name: 'Beta',
          budgetAmount: 50,
          department: null,
        },
        usedAmount: 10,
        remainingBudget: 40,
        assignedRequestCount: 0,
        requests: [],
      },
      {
        budgetCode: {
          id: 'b3',
          code: 'C',
          displayCode: 'C',
          name: null,
          budgetAmount: null,
          department: { id: 'd2', name: 'Maintenance' },
        },
        usedAmount: 0,
        remainingBudget: null,
        assignedRequestCount: 0,
        requests: [],
      },
    ]

    const grouped = groupBudgetCodesByDepartment(groups)
    assert.deepEqual(
      grouped.map((entry) => [entry.departmentName, entry.departmentId, entry.groups.length]),
      [
        ['Maintenance', 'd2', 1],
        ['Production 1', 'd1', 1],
        ['No department', null, 1],
      ]
    )

    assert.deepEqual(sumVisibleRemainingBudget(groups), { total: 100, groupCount: 2 })
  })

  it('parses paste text with headers, aliases, and headerless columns', () => {
    const headed = parseBudgetCodePaste(
      'Budget Code,Budget Code Name,Budget Amount\nAYT-PD1-GF-411,Filler,50000\n,Missing name,10\nAYT-PD1-GF-412,No amount,\nAYT-PD1-GF-411,Duplicate,1\nbad,Bad amount,abc'
    )
    assert.equal(headed.valid.length, 1)
    assert.equal(headed.valid[0].code, 'AYT-PD1-GF-411')
    assert.equal(headed.valid[0].displayCode, 'AYT-PD1-GF-411')
    assert.equal(headed.valid[0].name, 'Filler')
    assert.equal(headed.valid[0].budgetAmount, 50000)
    assert.equal(headed.skipped.length, 4)

    const headerless = parseBudgetCodePaste('AYT-MT-GF-210\tSeal kit\t28000')
    assert.deepEqual(headerless.valid, [
      {
        code: 'AYT-MT-GF-210',
        displayCode: 'AYT-MT-GF-210',
        name: 'Seal kit',
        budgetAmount: 28000,
      },
    ])
    assert.equal(headerless.skipped.length, 0)
  })

  it('classifies paste rows as creates or updates using normalized codes', () => {
    const classified = classifyBudgetCodePasteRows(
      [
        { code: 'AYT-PD1-GF-411', displayCode: 'AYT-PD1-GF-411', name: 'Filler', budgetAmount: 1 },
        { code: 'AYT-NEW-001', displayCode: 'AYT-NEW-001', name: 'New', budgetAmount: 2 },
      ],
      [{ code: 'AYT-PD1-GF-411' }]
    )
    assert.equal(classified.updates[0].code, 'AYT-PD1-GF-411')
    assert.equal(classified.creates[0].code, 'AYT-NEW-001')
  })
})

describe('budget code name field', () => {
  it('adds a nullable name column and monitor requests list', () => {
    const schema = readFileSync('prisma/schema.prisma', 'utf8')
    const types = readFileSync('src/types/budget.ts', 'utf8')
    const migration = readFileSync(
      'prisma/migrations/20260817000000_add_budget_code_name/migration.sql',
      'utf8'
    )

    assert.match(schema, /model budget_codes[\s\S]*name\s+String\?/)
    assert.match(migration, /ALTER TABLE "budget_codes" ADD COLUMN "name" TEXT/)
    assert.match(types, /name: string \| null/)
    assert.match(types, /requests: BudgetRequestRecord\[\]/)
  })
})

describe('budget code dialogs', () => {
  it('previews paste rows before writing budget codes', () => {
    const dialog = readFileSync('src/components/budget/budget-code-paste-dialog.tsx', 'utf8')
    assert.match(dialog, /export function BudgetCodePasteDialog/)
    assert.match(dialog, /parseBudgetCodePaste/)
    assert.match(dialog, /classifyBudgetCodePasteRows/)
    assert.match(dialog, /Confirm/)
    assert.doesNotMatch(dialog, /type="file"/)
  })

  it('requires name and amount in create and edit budget code dialogs', () => {
    const createDialog = readFileSync('src/components/budget/budget-code-create-dialog.tsx', 'utf8')
    const editDialog = readFileSync('src/components/budget/budget-code-edit-dialog.tsx', 'utf8')

    assert.match(createDialog, /name: string/)
    assert.match(createDialog, /budgetAmount: number/)
    assert.match(createDialog, /id="new-budget-code-name"/)
    assert.match(createDialog, /disabled=\{isSaving \|\| !canSubmit\}/)

    assert.match(editDialog, /name: string/)
    assert.match(editDialog, /budgetAmount: number/)
    assert.match(editDialog, /id="budget-code-edit-name"/)
    assert.match(editDialog, /disabled=\{isSaving \|\| !canSubmit\}/)
  })
})

describe('budget department panel', () => {
  it('renders department-grouped budget cards without drop targets', () => {
    const card = readFileSync('src/components/budget/budget-code-card.tsx', 'utf8')
    const panel = readFileSync('src/components/budget/budget-department-panel.tsx', 'utf8')

    assert.match(card, /export function BudgetCodeCard/)
    assert.match(card, /getBudgetCodeHealth/)
    assert.match(card, /getBudgetCodeLabel/)
    assert.doesNotMatch(card, /useDroppable|DndContext|Drop remaining request/)
    assert.match(panel, /groupBudgetCodesByDepartment/)
    assert.match(panel, /Paste budget codes/)
    assert.match(panel, /New budget code/)
  })
})

describe('budget request assignment table', () => {
  it('assigns requests with a group select instead of drag and drop', () => {
    const table = readFileSync('src/components/budget/budget-request-table.tsx', 'utf8')

    assert.match(table, /export function BudgetRequestTable/)
    assert.match(table, /Unassigned/)
    assert.match(table, /Assigned/)
    assert.match(table, /aria-label="Assign group"/)
    assert.match(table, /md:hidden/)
    assert.match(table, /hidden md:table/)
    assert.match(table, /getBudgetProjectEstimateAmount/)
    assert.doesNotMatch(table, /DndContext|useDraggable|useDroppable/)
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
      'pasteBudgetCodes',
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

  it('returns a flat requests list and maps budget code name', () => {
    const source = readServerAction()
    const getDataBody = source.slice(
      source.indexOf('export async function getBudgetMonitorData'),
      source.indexOf('export async function assignRequestToBudgetCode')
    )
    assert.match(getDataBody, /name: true/)
    assert.match(getDataBody, /requests,/)
    assert.match(source, /name: budgetCode\.name \?\? null|name: decimalToNumber|name:/)
  })

  it('requires name and amount on create, update, and paste', () => {
    const source = readServerAction()
    assert.match(source, /export async function pasteBudgetCodes/)
    assert.match(source, /name: z\.string\(\)[\s\S]*min\(1\)/)
    const createBody = source.slice(
      source.indexOf('const createBudgetCodeSchema'),
      source.indexOf('function buildVisibleRequestWhere')
    )
    assert.match(createBody, /name:/)
    assert.doesNotMatch(
      source.slice(
        source.indexOf('const createBudgetCodeSchema'),
        source.indexOf('function buildVisibleRequestWhere')
      ),
      /budgetAmount: moneySchema/
    )
  })

  it('renders budget monitor project estimate cells from the approved display amount', () => {
    const table = readFileSync('src/components/budget/budget-request-table.tsx', 'utf8')

    assert.match(table, /getBudgetProjectEstimateAmount/)
    assert.match(table, /projectEstimateAmount\?\.toLocaleString\(\) \?\? '—'/)
    assert.match(table, /const hasApprovedEstimate = request\.engineeringEstimateCost !== null/)
    assert.match(table, /onEditProjectEstimate\(request\.id, request\.projectEstimateCost\)/)
  })

  it('syncs approved engineering solution estimates into the editable project estimate field', () => {
    const source = readFileSync('src/server-actions/solutions.ts', 'utf8')
    const approveBody = source.slice(
      source.indexOf('export async function approveSolution'),
      source.indexOf('export async function rejectSolution')
    )

    assert.match(approveBody, /select:\s*\{[\s\S]*requestId:\s*true,[\s\S]*title:\s*true,[\s\S]*costEstimate:\s*true/)
    assert.match(approveBody, /projectEstimateCost:\s*solutionData\.costEstimate/)

    const autoApproveUpdates = source.match(/projectEstimateCost:\s*(validated\.costEstimate|validated\.cost|input\.cost)/g) ?? []
    assert.ok(autoApproveUpdates.length >= 2, 'submit and resubmit auto-approval paths should sync the approved estimate')
  })
})
