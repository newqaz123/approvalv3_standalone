import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  canManageEngineeringSubTasks,
  ENGINEERING_SUB_TASK_VISIBLE_STATUSES,
  filterRowsByWorkRequisition,
  getSubTaskSummary,
  getWorkRequisitionLabel,
  isSubTaskVisibleForRequestStatus,
  isSubTaskStale,
  validateSubTaskInput,
} from '../../src/lib/engineering-sub-tasks'

describe('engineering sub-task schema', () => {
  const schema = () => readFileSync('prisma/schema.prisma', 'utf8')
  const migration = () => readFileSync('prisma/migrations/20260606000000_add_engineering_sub_tasks/migration.sql', 'utf8')

  it('adds request sub-task, stage, and subcontractor models', () => {
    const source = schema()

    assert.match(source, /model request_sub_tasks \{/)
    assert.match(source, /model sub_task_stages \{/)
    assert.match(source, /model sub_contractors \{/)
    assert.match(source, /workRequisitionReceived\s+Boolean\s+@default\(false\)/)
    assert.match(source, /workRequisitionReceivedAt\s+DateTime\?/)
    assert.match(source, /workRequisitionReceivedById\s+String\?/)
  })

  it('creates tables, indexes, and default sub-task stages in SQL migration', () => {
    const sql = migration()

    assert.match(sql, /CREATE TABLE "sub_task_stages"/)
    assert.match(sql, /CREATE TABLE "sub_contractors"/)
    assert.match(sql, /CREATE TABLE "request_sub_tasks"/)
    assert.match(sql, /CREATE INDEX "request_sub_tasks_requestId_idx"/)
    assert.match(sql, /CREATE INDEX "request_sub_tasks_updatedAt_idx"/)
    assert.match(sql, /INSERT INTO "sub_task_stages"/)
    for (const stage of ['Design', 'Site survey', 'Waiting user data', 'Waiting quotation', 'Waiting WR', 'Completed', 'Others']) {
      assert.match(sql, new RegExp(stage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    }
  })
})

describe('engineering sub-task helpers', () => {
  it('limits sub-task visibility to the approved request stages', () => {
    assert.deepEqual(ENGINEERING_SUB_TASK_VISIBLE_STATUSES, [
      'SentToEngineer',
      'SendBackToRequester',
      'FinalApproval',
      'Completed',
    ])
    assert.equal(isSubTaskVisibleForRequestStatus('SentToEngineer'), true)
    assert.equal(isSubTaskVisibleForRequestStatus('DesignCostEstimationApproval'), false)
    assert.equal(isSubTaskVisibleForRequestStatus('Cancelled'), false)
  })

  it('filters rows by WR state', () => {
    const rows = [
      { id: 'a', workRequisitionReceived: true },
      { id: 'b', workRequisitionReceived: false },
    ]

    assert.deepEqual(filterRowsByWorkRequisition(rows, 'all').map((row) => row.id), ['a', 'b'])
    assert.deepEqual(filterRowsByWorkRequisition(rows, 'received').map((row) => row.id), ['a'])
    assert.deepEqual(filterRowsByWorkRequisition(rows, 'not-received').map((row) => row.id), ['b'])
  })

  it('allows only engineering and admin users to manage sub-tasks', () => {
    assert.equal(canManageEngineeringSubTasks({ role: 'engineering' }), true)
    assert.equal(canManageEngineeringSubTasks({ role: 'admin' }), true)
    assert.equal(canManageEngineeringSubTasks({ role: 'engineering', isActive: false }), false)
    assert.equal(canManageEngineeringSubTasks({ role: 'general_dept' }), false)
    assert.equal(canManageEngineeringSubTasks({ role: null }), false)
    assert.equal(canManageEngineeringSubTasks(null), false)
  })

  it('builds WR labels and sub-task completion summaries', () => {
    assert.equal(getWorkRequisitionLabel(true), 'WR received')
    assert.equal(getWorkRequisitionLabel(false), 'No WR')
    assert.equal(getWorkRequisitionLabel(), 'No WR')

    assert.deepEqual(getSubTaskSummary([
      { isCompleted: true },
      { isCompleted: false },
      { isCompleted: true },
    ]), {
      total: 3,
      completed: 2,
      label: '2/3 complete',
    })
    assert.deepEqual(getSubTaskSummary([]), {
      total: 0,
      completed: 0,
      label: '0/0 complete',
    })
  })

  it('detects stale incomplete sub-tasks by updatedAt and stage', () => {
    const now = new Date('2026-06-06T12:00:00Z')
    const oldWaitingQuotation = {
      isCompleted: false,
      updatedAt: new Date('2026-05-30T11:59:59Z'),
      stage: { id: 'stage-wq', name: 'Waiting quotation' },
    }
    const recentWaitingQuotation = {
      isCompleted: false,
      updatedAt: new Date('2026-06-05T12:00:00Z'),
      stage: { id: 'stage-wq', name: 'Waiting quotation' },
    }
    const completedOldTask = {
      isCompleted: true,
      updatedAt: new Date('2026-05-01T12:00:00Z'),
      stage: { id: 'stage-wq', name: 'Waiting quotation' },
    }

    assert.equal(isSubTaskStale(oldWaitingQuotation, { olderThanDays: 7, now }), true)
    assert.equal(isSubTaskStale(recentWaitingQuotation, { olderThanDays: 7, now }), false)
    assert.equal(isSubTaskStale(completedOldTask, { olderThanDays: 7, now }), false)
    assert.equal(isSubTaskStale(oldWaitingQuotation, { olderThanDays: 7, stageId: 'other-stage', now }), false)
    assert.equal(isSubTaskStale(oldWaitingQuotation, { olderThanDays: 7, stageId: 'stage-wq', now }), true)
  })

  it('requires custom stage text only for Others', () => {
    assert.deepEqual(validateSubTaskInput({ description: '', stageIsOthers: false }), {
      success: false,
      error: 'Description is required',
    })
    assert.deepEqual(validateSubTaskInput({ description: 'Piping work', stageIsOthers: true, customStageText: '' }), {
      success: false,
      error: 'Custom stage text is required when stage is Others',
    })
    assert.deepEqual(validateSubTaskInput({ description: 'Piping work', stageIsOthers: false, customStageText: 'ignored' }), {
      success: true,
      customStageText: null,
    })
  })
})

describe('engineering sub-task server action wiring', () => {
  it('exposes CRUD, WR, stages, subcontractor, and stale filter actions', () => {
    const source = readFileSync('src/server-actions/engineering-sub-tasks.ts', 'utf8')

    for (const exportName of [
      'getEngineeringSubTaskOptions',
      'createSubTask',
      'updateSubTask',
      'setSubTaskCompleted',
      'deleteSubTask',
      'toggleWorkRequisitionReceived',
      'createSubContractor',
      'deactivateSubContractor',
      'getStaleSubTaskRequests',
    ]) {
      assert.match(source, new RegExp(`export async function ${exportName}\\b`))
    }

    assert.match(source, /'use server'/)
    assert.match(source, /canManageEngineeringSubTasks/)
    assert.match(source, /revalidateRequestViews/)
    assert.match(source, /isSubTaskVisibleForRequestStatus/)
  })

  it('exports exactly the planned server actions', () => {
    const source = readFileSync('src/server-actions/engineering-sub-tasks.ts', 'utf8')
    const exportedAsyncFunctions = Array.from(source.matchAll(/export async function (\w+)\b/g), (match) => match[1]).sort()

    assert.deepEqual(exportedAsyncFunctions, [
      'createSubContractor',
      'createSubTask',
      'deactivateSubContractor',
      'deleteSubTask',
      'getEngineeringSubTaskOptions',
      'getStaleSubTaskRequests',
      'setSubTaskCompleted',
      'toggleWorkRequisitionReceived',
      'updateSubTask',
    ])
  })

  it('rejects inactive users, deleted requests, and inactive subcontractors before mutations', () => {
    const source = readFileSync('src/server-actions/engineering-sub-tasks.ts', 'utf8')

    assert.match(source, /canManageEngineeringSubTasks\(user\)/)
    assert.match(source, /select:\s*\{\s*id:\s*true,\s*status:\s*true,\s*isDeleted:\s*true\s*\}/)
    assert.match(source, /if \(!request\s*\|\|\s*request\.isDeleted\) throw new Error\('Request not found'\)/)
    assert.match(source, /async function getActiveSubContractor\(subContractorId\?: string \| null\)/)
    assert.match(source, /prisma\.sub_contractors\.findUnique\(\{[\s\S]*where:\s*\{\s*id: subContractorId\s*\}/)
    assert.match(source, /if \(!contractor \|\| !contractor\.isActive\) throw new Error\('Selected subcontractor is not available'\)/)
    assert.match(source, /const subContractorId = await getActiveSubContractor\(input\.subContractorId\)/)
    assert.match(source, /subContractorId,/)
  })
})

describe('engineering sub-task request and filter wiring', () => {
  it('adds WR fields to request server rows and request detail data', () => {
    const requests = readFileSync('src/server-actions/requests.ts', 'utf8')
    const dashboard = readFileSync('src/server-actions/dashboard.ts', 'utf8')

    for (const source of [requests, dashboard]) {
      assert.match(source, /workRequisitionReceived: true/)
    }

    assert.match(requests, /wrStatus\?: 'all' \| 'not-received' \| 'received'/)
    assert.match(requests, /whereClause\.workRequisitionReceived = true/)
    assert.match(requests, /whereClause\.workRequisitionReceived = false/)
    assert.match(requests, /subTasks:\s*\{/)
    assert.match(requests, /workRequisitionReceivedAt: true/)
    assert.match(requests, /workRequisitionReceivedBy/)
    assert.match(requests, /orderBy:\s*\[\s*\{\s*isCompleted: 'asc'\s*\},\s*\{\s*updatedAt: 'desc'\s*\}/)
  })

  it('wires WR filters into requests API, request filters, and dashboard filters', () => {
    const api = readFileSync('src/app/api/requests/route.ts', 'utf8')
    const requestFilters = readFileSync('src/components/requests/request-filters.tsx', 'utf8')
    const requestList = readFileSync('src/components/requests/requests-list-with-filters.tsx', 'utf8')
    const dashboardFilters = readFileSync('src/components/dashboard/table-filters.tsx', 'utf8')
    const dashboardTable = readFileSync('src/components/dashboard/dashboard-table.tsx', 'utf8')

    assert.match(api, /wrStatus/)
    assert.match(requestFilters, /wrStatus\?: 'all' \| 'not-received' \| 'received'/)
    assert.match(requestFilters, /All WR/)
    assert.match(requestFilters, /WR received/)
    assert.match(requestFilters, /No WR/)
    assert.match(requestList, /wrStatus/)
    assert.match(dashboardFilters, /wrStatus\?: 'all' \| 'not-received' \| 'received'/)
    assert.match(dashboardFilters, /All WR/)
    assert.match(dashboardFilters, /WR received/)
    assert.match(dashboardFilters, /No WR/)
    assert.match(dashboardTable, /filterRowsByWorkRequisition/)
    assert.match(dashboardTable, /data: tableData/)
  })
})

describe('engineering sub-task request modal panel wiring', () => {
  const modalFiles = [
    'src/components/requests/approver-modal.tsx',
    'src/components/requests/solution-modal.tsx',
    'src/components/requests/completed-request-modal.tsx',
    'src/components/requests/completed-solution-modal.tsx',
    'src/components/requests/final-approval-modal.tsx',
    'src/components/requests/completed-final-modal.tsx',
    'src/components/requests/submit-final-approval-modal.tsx',
    'src/components/requests/final-approval-resubmit-modal.tsx',
  ]

  it('adds the collapsed Sub-tasks section with WR and task management actions', () => {
    const source = readFileSync('src/components/requests/sub-tasks-section.tsx', 'utf8')

    assert.match(source, /'use client'/)
    assert.match(source, /Collapsible[\s\S]*defaultOpen=\{false\}/)
    assert.match(source, /Sub-tasks/)
    assert.match(source, /getSubTaskSummary/)
    assert.match(source, /getWorkRequisitionLabel/)
    const collapsedTrigger = source.match(/<CollapsibleTrigger[\s\S]*?<\/CollapsibleTrigger>/)?.[0] ?? ''
    assert.match(collapsedTrigger, /<Badge[\s\S]*\{summary\.label\}[\s\S]*<\/Badge>/)
    assert.ok((collapsedTrigger.match(/<Badge\b/g) ?? []).length > 1)
    assert.match(source, /Work requisition received/)
    assert.match(source, /Last edited/)
    assert.match(source, /canManage/)
    assert.match(source, /toggleWorkRequisitionReceived/)
    assert.match(source, /setSubTaskCompleted/)
    assert.match(source, /deleteSubTask/)
    assert.match(source, /import \{ toast \} from 'sonner'/)
    assert.match(source, /toast\.error\(result\.error/)
    assert.match(source, /onChanged\(\)/)
  })

  it('adds an add/edit sub-task form dialog with Others stage custom text', () => {
    const source = readFileSync('src/components/requests/sub-task-form-dialog.tsx', 'utf8')

    assert.match(source, /'use client'/)
    assert.match(source, /createSubTask/)
    assert.match(source, /updateSubTask/)
    assert.match(source, /isOthers/)
    assert.match(source, /customStageText/)
    assert.match(source, /subContractorId/)
    assert.match(source, /No subcontractor/)
  })

  it('routes visible requests to SubTasksSection with options and permissions', () => {
    const source = readFileSync('src/components/requests/request-modal-router.tsx', 'utf8')

    assert.match(source, /SubTasksSection/)
    assert.match(source, /getEngineeringSubTaskOptions/)
    assert.match(source, /canManageEngineeringSubTasks/)
    assert.match(source, /isSubTaskVisibleForRequestStatus/)
    assert.match(source, /setSubTaskOptions/)
    assert.match(source, /subTasksElement/)
    assert.match(source, /requestData\.subTasks/)
    assert.match(source, /workRequisitionReceived/)
  })

  it('renders the optional sub-task section before each activity timeline', () => {
    for (const file of modalFiles) {
      const source = readFileSync(file, 'utf8')

      assert.match(source, /subTasksElement\?: React\.ReactNode/)
      assert.match(source, /\{subTasksElement && \(\s*<>\s*<Separator[\s\S]*?\{subTasksElement\}/)
      assert.match(source, /Retractable Activity Timeline/)
    }
  })
})
