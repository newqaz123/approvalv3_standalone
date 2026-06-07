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

  it('moves checked sub-tasks to the Completed stage and records the editor', () => {
    const source = readFileSync('src/server-actions/engineering-sub-tasks.ts', 'utf8')
    const completionBlock = source.match(/export async function setSubTaskCompleted[\s\S]*?export async function deleteSubTask/)?.[0] ?? ''

    assert.match(completionBlock, /prisma\.sub_task_stages\.findFirst\(\{[\s\S]*name:\s*'Completed'/)
    assert.match(completionBlock, /stageId:\s*completedStage\.id/)
    assert.match(completionBlock, /updatedById:\s*user\.id/)
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
    const dashboardTabs = readFileSync('src/components/dashboard/dashboard-tabs.tsx', 'utf8')
    const dashboardPage = readFileSync('src/app/(dashboard)/dashboard/page.tsx', 'utf8')

    assert.match(api, /wrStatus/)
    assert.match(requestFilters, /wrStatus\?: 'all' \| 'not-received' \| 'received'/)
    assert.match(requestFilters, /DEFAULT_WR_FILTER = 'all'/)
    assert.match(requestFilters, /Show only no WR/)
    assert.match(requestFilters, /h-10 min-h-10/)
    assert.match(requestFilters, /className=\{cn\(\s*'h-10 min-h-10 w-full/)
    assert.match(requestFilters, /translate-x-4/)
    assert.match(requestFilters, /bg-emerald-500/)
    assert.doesNotMatch(requestFilters, /border-dashed/)
    assert.doesNotMatch(requestFilters, /bg-amber-50/)
    assert.doesNotMatch(requestFilters, /<SelectItem value="received">WR Received<\/SelectItem>/)
    assert.match(requestList, /wrStatus/)
    assert.match(requestList, /DEFAULT_WR_FILTER/)
    const requestPage = readFileSync('src/app/(dashboard)/requests/page.tsx', 'utf8')
    const requestTable = readFileSync('src/components/requests/request-table.tsx', 'utf8')
    assert.match(requestPage, /wrStatus: 'all'/)
    assert.doesNotMatch(requestPage, /wrStatus: 'not-received'/)
    assert.match(requestTable, /workRequisitionReceived\?: boolean/)
    assert.match(requestTable, /bg-sky-50/)
    assert.doesNotMatch(requestTable, /bg-emerald-50/)
    assert.match(dashboardFilters, /wrStatus\?: 'all' \| 'not-received' \| 'received'/)
    assert.match(dashboardFilters, /DEFAULT_WR_FILTER = 'all'/)
    assert.match(dashboardFilters, /Show only no WR/)
    assert.match(dashboardFilters, /h-10 min-h-10/)
    assert.match(dashboardFilters, /className=\{cn\(\s*'h-10 min-h-10 w-full/)
    assert.match(dashboardFilters, /translate-x-4/)
    assert.match(dashboardFilters, /bg-emerald-500/)
    assert.doesNotMatch(dashboardFilters, /border-dashed/)
    assert.doesNotMatch(dashboardFilters, /bg-amber-50/)
    assert.doesNotMatch(dashboardFilters, /<SelectItem value="received">WR Received<\/SelectItem>/)
    assert.match(dashboardTable, /filterRowsByWorkRequisition/)
    assert.match(dashboardTable, /data: tableData/)
    assert.match(dashboardTable, /id: 'departmentId'/)
    assert.match(dashboardTable, /accessorFn: \(row\) => row\.department\?\.id/)
    assert.match(dashboardTable, /bg-sky-50/)
    assert.doesNotMatch(dashboardTable, /bg-emerald-50/)
    assert.match(dashboardTable, /onVisibleRowCountChange/)
    assert.doesNotMatch(dashboardTabs, /All Requests/)
    assert.doesNotMatch(dashboardTabs, /getAllRequests/)
    assert.match(dashboardTabs, /visibleCounts/)
    assert.match(dashboardTabs, /TabCountBadge/)
    assert.match(dashboardTabs, /sm:flex-row sm:items-center sm:justify-between/)
    assert.match(dashboardTabs, /TabsList className="flex w-full sm:max-w-xl"/)
    assert.match(dashboardTabs, /formatDistanceToNow/)
    assert.doesNotMatch(dashboardPage, />Dashboard<\/h1>/)
    assert.match(dashboardPage, /container py-4/)
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
    const taskCardBlock = source.match(/data-testid="sub-task-card"[\s\S]*?\)\s*\}\)\}/)?.[0] ?? ''

    assert.match(source, /'use client'/)
    assert.match(source, /const \[isOpen, setIsOpen\] = useState\(false\)/)
    assert.match(source, /Collapsible[\s\S]*open=\{isOpen\}[\s\S]*onOpenChange=\{setIsOpen\}/)
    assert.doesNotMatch(source, /defaultOpen=\{false\}/)
    assert.match(source, /Sub-tasks/)
    assert.match(source, /getSubTaskSummary/)
    assert.match(source, /getWorkRequisitionLabel/)
    assert.match(source, /Progress/)
    assert.match(source, /progressValue/)
    assert.match(source, /FileText/)
    assert.match(source, /title=\{wrTooltip\}/)
    assert.doesNotMatch(source, /aria-label=\{wrTooltip\}/)
    const collapsedTrigger = source.match(/<CollapsibleTrigger[\s\S]*?<\/CollapsibleTrigger>/)?.[0] ?? ''
    assert.match(collapsedTrigger, /<Badge[\s\S]*\{summary\.label\}[\s\S]*<\/Badge>/)
    assert.match(collapsedTrigger, /<Progress[\s\S]*value=\{progressValue\}/)
    assert.ok((collapsedTrigger.match(/<Badge\b/g) ?? []).length > 1)
    assert.match(source, /Work requisition received/)
    assert.match(source, /Last edited/)
    assert.match(source, /Last edited by/)
    assert.match(source, /task\.updatedBy\?\.name/)
    assert.match(source, /canManage/)
    assert.match(source, /toggleWorkRequisitionReceived/)
    assert.match(source, /setSubTaskCompleted/)
    assert.match(source, /deleteSubTask/)
    assert.match(source, /aria-label="Delete sub-task"/)
    assert.match(source, /sr-only/)
    assert.match(source, /className="flex justify-start pt-1"/)
    assert.match(source, /items-center gap-2 text-xs/)
    assert.match(taskCardBlock, /task\.subContractor\?\.name/)
    assert.match(taskCardBlock, /Badge/)
    assert.match(taskCardBlock, /Last edited by/)
    assert.doesNotMatch(taskCardBlock, /<span>Delete<\/span>/)
    assert.match(source, /import \{ toast \} from 'sonner'/)
    assert.match(source, /toast\.error\(result\.error/)
    assert.match(source, /onChanged\(\)/)
  })

  it('adds an add/edit sub-task form dialog with Others stage custom text', () => {
    const source = readFileSync('src/components/requests/sub-task-form-dialog.tsx', 'utf8')

    assert.match(source, /'use client'/)
    assert.match(source, /createSubTask/)
    assert.match(source, /updateSubTask/)
    assert.match(source, /aria-label=\{task \? 'Edit sub-task' : undefined\}/)
    assert.match(source, /task \? \(\s*<span className="sr-only">Edit sub-task<\/span>/)
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
    assert.match(source, /if \(loading && !requestData\) \{/)
    assert.doesNotMatch(source, /if \(loading \|\| !requestData\) \{/)
    assert.match(source, /subTasksElement/)
    assert.match(source, /requestData\.subTasks/)
    assert.match(source, /workRequisitionReceived/)
    const subTaskElementBlock = source.match(/const subTasksElement =[\s\S]*?\) : undefined/)?.[0] ?? ''
    assert.doesNotMatch(subTaskElementBlock, /onActionComplete\?\.\(\)/)
  })

  it('does not fall through after rendering submit-final sub-task panel', () => {
    const source = readFileSync('src/components/requests/request-modal-router.tsx', 'utf8')
    const submitFinalCase = source.match(/case 'submit-final':[\s\S]*?default:/)?.[0] ?? ''

    assert.match(submitFinalCase, /subTasksElement=\{subTasksElement\}/)
    assert.match(submitFinalCase, /\)\s*break\s*default:/)
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

describe('engineering stale sub-task filters', () => {
  it('loads stage options and passes them to the engineering tabs', () => {
    const page = readFileSync('src/app/(dashboard)/engineering/page.tsx', 'utf8')

    assert.match(page, /getEngineeringSubTaskOptions/)
    assert.match(page, /const subTaskOptions = await getEngineeringSubTaskOptions\(\)/)
    assert.match(page, /subTaskStages=\{subTaskOptions\.stages\}/)
    assert.match(page, /subTasks:\s*\{/)
    assert.match(page, /subContractor:\s*\{/)
    assert.match(page, /updatedAt: true/)
  })

  it('renders live follow-up work filters and sub-task progress metadata', () => {
    const tabs = readFileSync('src/components/engineering/engineering-dashboard-tabs.tsx', 'utf8')

    assert.doesNotMatch(tabs, /getStaleSubTaskRequests/)
    assert.doesNotMatch(tabs, /SubContractorSettings/)
    assert.match(tabs, /Follow up work/)
    assert.match(tabs, /subTaskStages: Array<\{ id: string; name: string; isOthers: boolean \}>/)
    assert.match(tabs, /subContractors: Array<\{ id: string; name: string \}>/)
    assert.match(tabs, /engineeringUsers: Array<\{ id: string; name: string; email: string; level: number \| null \}>/)
    assert.match(tabs, /assignedEngineers: Array<\{ id: string; name: string \}>/)
    assert.match(tabs, /subTasks: Array<\{/)
    assert.match(tabs, /const \[selectedStage, setSelectedStage\] = useState<string \| null>\(null\)/)
    assert.match(tabs, /const \[subContractorQuery, setSubContractorQuery\] = useState\(''\)/)
    assert.match(tabs, /const \[subContractorIds, setSubContractorIds\] = useState<string\[\]>\(\[\]\)/)
    assert.match(tabs, /const \[olderThanDays, setOlderThanDays\] = useState<string>\('all'\)/)
    assert.match(tabs, /const \[selectedEngineer, setSelectedEngineer\] = useState<string \| null>\(null\)/)
    assert.match(tabs, /const filteredRequests = requests\.filter/)
    assert.match(tabs, /matchesStage/)
    assert.match(tabs, /matchesSubContractor/)
    assert.match(tabs, /matchesOlderThanDays/)
    assert.match(tabs, /matchesEngineer/)
    assert.match(tabs, /fuzzyMatch/)
    assert.match(tabs, /sortedSubContractors/)
    assert.match(tabs, /STALE_DAY_PRESETS/)
    assert.doesNotMatch(tabs, /STAGE_ALL_FILTER/)
    assert.doesNotMatch(tabs, /ENGINEER_ALL_FILTER/)
    assert.match(tabs, /selectedSubContractorIdSet/)
    assert.match(tabs, /selectedSubContractors/)
    assert.match(tabs, /toggleSubContractorFilter/)
    assert.match(tabs, /Progress/)
    assert.match(tabs, /progressValue/)
    assert.match(tabs, /data-testid="follow-up-filter-chipline"/)
    assert.match(tabs, /FilterSeparator/)
    assert.match(tabs, /Sub-contractor/)
    assert.match(tabs, /visibleSubContractorChips\.map/)
    assert.match(tabs, /collapsedSubContractorChip/)
    assert.match(tabs, /removeSubContractorFilter/)
    assert.match(tabs, /clearAllFilters/)
    assert.match(tabs, /Clear all/)
    assert.match(tabs, /Checkbox/)
    assert.match(tabs, /Plus/)
    assert.match(tabs, /border-dashed/)
    assert.match(tabs, /Stale/)
    assert.match(tabs, /Clock/)
    assert.match(tabs, /Any date/)
    assert.match(tabs, /getSubTaskSummary/)
    assert.match(tabs, /HoverCard/)
    assert.match(tabs, /max-h-72 overflow-y-auto/)
    assert.match(tabs, /\{stageName\}/)
    assert.match(tabs, /Stage badge/)
    assert.match(tabs, /Completed/)
    assert.match(tabs, /Not completed/)
    assert.match(tabs, /Info/)
    assert.match(tabs, /This table does not show completed requests/)
    assert.match(tabs, /WR received and every sub-task checked complete/)
    assert.match(tabs, /cancelled work/)
    assert.match(tabs, /request\.workRequisitionReceived/)
    assert.match(tabs, /WR Received/)
    assert.match(tabs, /bg-emerald-50 text-emerald-700/)
    assert.match(tabs, /group\/progress/)
    assert.match(tabs, /cursor-pointer/)
    assert.match(tabs, /group-hover\/progress:h-3/)
    assert.doesNotMatch(tabs, /cursor-help/)
    assert.match(tabs, /Subcontractor/)
    assert.match(tabs, /subContractorNames\.map/)
    assert.match(tabs, /onClick=\{\(event\) => handleSubContractorPillClick\(event, name\)\}/)
    assert.match(tabs, /aria-label="Subcontractor filter"/)
    assert.match(tabs, /Last update > X days/)
    assert.match(tabs, /STALE_DAY_PRESETS = \['3', '7', '14', '30'\]/)
    assert.match(tabs, /No update &gt; \{days\} days/)
    assert.doesNotMatch(tabs, /All stages/)
    assert.match(tabs, /selectedStage === stage\.id \? null : stage\.id/)
    assert.match(tabs, /selectedEngineer === ENGINEER_UNASSIGNED_FILTER \? null : ENGINEER_UNASSIGNED_FILTER/)
    assert.match(tabs, /selectedEngineer === engineer\.id \? null : engineer\.id/)
    assert.doesNotMatch(tabs, /All PIC/)
    assert.match(tabs, /subContractorIds\.length >= 3/)
    assert.match(tabs, /\$\{selectedSubContractors\.length\} subcontractors/)
    assert.match(tabs, /StatusBadge[\s\S]*status=\{request\.status\}/)
    assert.match(tabs, /subTask\.description/)
    assert.match(tabs, /subTask\.subContractor/)
    assert.match(tabs, /handleRequestClick\(request\.id\)/)
    assert.doesNotMatch(tabs, /Find stuck sub-tasks/)
    assert.doesNotMatch(tabs, /Stuck sub-tasks/)
    assert.doesNotMatch(tabs, /All Engineering Requests/)
    assert.doesNotMatch(tabs, /<h2 className="text-lg font-semibold text-gray-900">Follow up work<\/h2>/)
    assert.doesNotMatch(tabs, /Sub-task progress:/)
  })

  it('keeps completed requests out of follow-up work and improves engineering summary cards', () => {
    const page = readFileSync('src/app/(dashboard)/engineering/page.tsx', 'utf8')

    assert.doesNotMatch(page, /'Completed'\]/)
    assert.match(page, /OR:\s*\[\s*\{\s*workRequisitionReceived:\s*false\s*\}/)
    assert.match(page, /subTasks:\s*\{\s*some:\s*\{\s*isCompleted:\s*false\s*\}/)
    assert.match(page, /workRequisitionReceived: request\.workRequisitionReceived/)
    assert.doesNotMatch(page, /'Cancelled'/)
    assert.match(page, /Active engineering workload/)
    assert.match(page, /Sent back, final approval, and pending solution/)
    assert.match(page, /Needs engineering response/)
    assert.match(page, /Solution review in progress/)
    assert.match(page, /EngineeringMetricCard/)
    assert.match(page, /startOfYesterday/)
    assert.match(page, /deltaValue/)
    assert.match(page, /isZeroState/)
    assert.match(page, /No new since yesterday/)
    assert.match(page, /TrendingUp/)
    assert.match(page, /value === 0/)
    assert.match(page, /text-gray-400/)
    assert.match(page, /engineerAssignments:\s*\{/)
  })

  it('removes duplicate Needs My Action summary cards, filters solution work by Engineer PIC, and puts approvals first', () => {
    const source = readFileSync('src/components/engineering/needs-action-list.tsx', 'utf8')

    assert.doesNotMatch(source, /Summary Cards/)
    assert.doesNotMatch(source, /View all requests/)
    assert.doesNotMatch(source, /View all approvals/)
    assert.match(source, /const \[engineerId, setEngineerId\] = useState<string>\(ENGINEER_ALL_FILTER\)/)
    assert.match(source, /ENGINEER_ALL_FILTER/)
    assert.match(source, /ENGINEER_UNASSIGNED_FILTER/)
    assert.match(source, /filteredNeedsSolution/)
    assert.match(source, /matchesEngineer/)
    assert.match(source, /Engineer PIC/)

    const approvalIndex = source.indexOf('Solutions Awaiting Your Approval')
    const solutionIndex = source.indexOf('Requests Awaiting Solution')
    assert.ok(approvalIndex >= 0, 'approval table heading exists')
    assert.ok(solutionIndex >= 0, 'solution table heading exists')
    assert.ok(approvalIndex < solutionIndex, 'approval table appears before solution table')
  })

  it('uses accessible non-button markup for follow-up request rows', () => {
    const tabs = readFileSync('src/components/engineering/engineering-dashboard-tabs.tsx', 'utf8')
    const followUpBlock = tabs.match(/<Card>[\s\S]*?\{selectedRequestId &&/)?.[0] ?? ''

    assert.match(followUpBlock, /role="button"/)
    assert.match(followUpBlock, /tabIndex=\{0\}/)
    assert.match(followUpBlock, /onKeyDown=\{\(event\) => handleRequestRowKeyDown\(event, request\.id\)\}/)
  })
})

describe('admin sub-task stage management wiring', () => {
  it('adds admin-managed global stage actions', () => {
    const actions = readFileSync('src/server-actions/sub-task-stages.ts', 'utf8')

    assert.match(actions, /'use server'/)
    assert.match(actions, /requireAdmin/)
    assert.match(actions, /getSubTaskStagesForAdmin/)
    assert.match(actions, /updateSubTaskStage/)
    assert.match(actions, /createSubTaskStage/)
    assert.match(actions, /activateSubTaskStage/)
    assert.match(actions, /deactivateSubTaskStage/)
    assert.match(actions, /deleteSubTaskStage/)
    assert.match(actions, /revalidatePath\('\/admin\/sub-task-stages'\)/)
    assert.match(actions, /isOthers/)
    assert.match(actions, /isDefault/)
    assert.match(actions, /async function stageNameExists/)
    assert.match(actions, /async function getNextSortOrder/)
    assert.match(actions, /Stage name already exists/)
    assert.match(actions, /existing\?\.isOthers && trimmed !== existing\.name/)
    assert.match(actions, /Others stage cannot be renamed/)
    assert.match(actions, /existing\?\.isOthers && !input\.isActive/)
    assert.match(actions, /Others stage cannot be deactivated/)
    assert.match(actions, /name:\s*true/)
    assert.match(actions, /stage\.name === 'Completed'/)
    assert.match(actions, /Completed stage cannot be deleted/)
    assert.match(actions, /Stage is used by sub-tasks and cannot be deleted/)
  })

  it('renders stage settings on a separate admin page with cards, menu actions, and Completed-only default badge', () => {
    const component = readFileSync('src/components/admin/sub-task-stage-settings.tsx', 'utf8')
    const page = readFileSync('src/app/admin/page.tsx', 'utf8')
    const stagePage = readFileSync('src/app/admin/sub-task-stages/page.tsx', 'utf8')

    assert.match(component, /'use client'/)
    assert.match(component, /useEffect/)
    assert.match(component, /setStages\(initialStages\)/)
    assert.match(stagePage, /Sub-task stages/)
    assert.match(stagePage, /p-8/)
    assert.match(stagePage, /Manage stages used in engineering request sub-tasks/)
    assert.match(component, /initialStages/)
    assert.match(component, /isActive/)
    assert.match(component, /updateSubTaskStage/)
    assert.match(component, /createSubTaskStage/)
    assert.match(component, /activateSubTaskStage/)
    assert.match(component, /deactivateSubTaskStage/)
    assert.match(component, /deleteSubTaskStage/)
    assert.match(component, /DropdownMenu/)
    assert.match(component, /DropdownMenuTrigger/)
    assert.match(component, /DropdownMenuItem/)
    assert.match(component, /MoreHorizontal/)
    assert.match(component, /GripVertical/)
    assert.match(component, /Save changes/)
    assert.match(component, /Add stage card/)
    assert.match(component, /Stage list card/)
    assert.match(component, /isCompletedDefaultStage/)
    assert.match(component, /stage\.name === 'Completed'/)
    assert.match(component, /h-11/)
    assert.match(component, /h-10/)
    assert.match(component, /min-h-\[68px\]/)
    assert.match(component, /toast\.error/)
    assert.doesNotMatch(component, /Checkbox/)
    assert.doesNotMatch(component, /New sub-task stage sort order/)
    assert.doesNotMatch(component, /Sort order for/)
    assert.doesNotMatch(page, /getSubTaskStagesForAdmin/)
    assert.doesNotMatch(page, /initialStages=\{subTaskStages\}/)
    assert.match(page, /href="\/admin\/sub-task-stages"/)
    assert.match(stagePage, /getSubTaskStagesForAdmin/)
    assert.match(stagePage, /SubTaskStageSettings/)
    assert.match(stagePage, /initialStages=\{subTaskStages\}/)
  })

  it('adds inline subcontractor creation in the sub-task form dropdown', () => {
    const component = readFileSync('src/components/requests/sub-task-form-dialog.tsx', 'utf8')
    const tabs = readFileSync('src/components/engineering/engineering-dashboard-tabs.tsx', 'utf8')
    const actions = readFileSync('src/server-actions/engineering-sub-tasks.ts', 'utf8')

    assert.match(component, /'use client'/)
    assert.match(component, /createSubContractor/)
    assert.match(component, /CommandInput/)
    assert.match(component, /aria-label="Subcontractor"/)
    assert.match(component, /subContractorSearch/)
    assert.match(component, /filteredSubContractors/)
    assert.match(component, /Add "\{subContractorSearch\.trim\(\)\}"/)
    assert.match(component, /handleSubContractorKeyDown/)
    assert.match(component, /onKeyDown=\{handleSubContractorKeyDown\}/)
    assert.match(component, /setSubContractorId\(result\.data\.id\)/)
    assert.match(component, /localeCompare/)
    assert.match(tabs, /subContractors: Array<\{ id: string; name: string \}>/)
    assert.doesNotMatch(tabs, /SubContractorSettings/)
    assert.match(actions, /select:\s*\{\s*id:\s*true,\s*name:\s*true,\s*isActive:\s*true\s*\}/)
  })
})
