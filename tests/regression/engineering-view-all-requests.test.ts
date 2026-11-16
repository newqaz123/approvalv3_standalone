import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as actionPolicy from '@/lib/action-permissions'
import * as subTaskPolicy from '@/lib/engineering-sub-tasks'
import { CURRENT_INSTANCE_ROW_FILTER } from '@/lib/approval-engine/current-instance'
import type { OrganizationUnitNode } from '@/lib/organization/model'
import {
  buildRequestVisibilityWhere,
  canViewRequestByPredicate,
  createRequestVisibilityDb,
  type RequestVisibilityActor,
  type RequestVisibilityDb,
} from '@/lib/request-visibility/scope'

const unit = (id: string, parentId: string | null, extra: Partial<OrganizationUnitNode> = {}): OrganizationUnitNode => ({
  id, name: id, parentId, isActive: true, shareRequests: false,
  canWorkOnSolutions: false, engineeringCanViewAllRequests: false, managerUserId: null, ...extra,
})
const organization = () => [
  unit('company', null),
  unit('engineering', 'company', { canWorkOnSolutions: true, engineeringCanViewAllRequests: true }),
  unit('engineering-child', 'engineering'),
  unit('other-engineering', 'company', { canWorkOnSolutions: true }),
  unit('operations', 'company'),
]

// Evaluate the actual emitted Prisma predicate against isolated request records.
// Expected results below are explicit, not derived from the visibility policy.
function matches(row: Record<string, unknown>, where: unknown): boolean {
  if (!where || typeof where !== 'object') return false
  return Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return Array.isArray(value) && value.every((part) => matches(row, part))
    if (key === 'OR') return Array.isArray(value) && value.some((part) => matches(row, part))
    if (value && typeof value === 'object') {
      const condition = value as Record<string, unknown>
      if ('in' in condition) return Array.isArray(condition.in) && condition.in.includes(row[key])
      if ('some' in condition) return Array.isArray(row[key]) && (row[key] as Record<string, unknown>[]).some((item) => matches(item, condition.some))
      return row[key] !== null && typeof row[key] === 'object' && matches(row[key] as Record<string, unknown>, condition)
    }
    return row[key] === value
  })
}

function fixture(options: {
  units?: OrganizationUnitNode[]
  assignmentUnitId?: string | null
  assignmentActive?: boolean
  userActive?: boolean
  role?: string
  status?: string
  request?: Record<string, unknown>
} = {}) {
  const units = options.units ?? organization()
  const user = { id: 'engineer', role: options.role ?? 'general_dept', isActive: options.userActive ?? true }
  const assignmentUnitId = options.assignmentUnitId === undefined ? 'engineering' : options.assignmentUnitId
  const request = {
    id: 'foreign-request', organizationUnitId: 'operations', requesterId: 'someone-else',
    status: options.status ?? 'ImprovementRequest', isDeleted: false, isArchived: false,
    approvals: [], solutions: [], engineerAssignments: [], ...options.request,
  }
  const db = createRequestVisibilityDb({
    user: { async findUnique({ where }) { return where.id === user.id ? user : null } },
    organization_assignments: {
      async findFirst({ where }) {
        return where.userId === user.id && (options.assignmentActive ?? true) === where.isActive && assignmentUnitId
          ? { unitId: assignmentUnitId } : null
      },
    },
    organization_units: {
      async findMany({ select }) {
        // Mirror Prisma projections: forgetting to select the stored grant must fail these tests.
        return units.map((row) => Object.fromEntries(
          Object.keys(select).map((key) => [key, row[key as keyof OrganizationUnitNode]]),
        ) as unknown as OrganizationUnitNode)
      },
    },
    requests: { async findFirst({ where }) { return matches(request, where) ? { id: request.id } : null } },
  })
  return { db, units, user, request }
}

const statuses = ['ImprovementRequest', 'SentToEngineer', 'DesignCostEstimationApproval', 'SendBackToRequester', 'FinalApproval', 'Completed', 'Cancelled']

describe('Engineering all-request visibility', () => {
  for (const status of statuses) {
    it(`allows opted-in Engineering to read a foreign ${status} request`, async () => {
      const { db } = fixture({ status })
      assert.equal(await canViewRequestByPredicate(db, 'engineer', 'foreign-request'), true)
      assert.deepEqual(await buildRequestVisibilityWhere(db, { userId: 'engineer', includeArchived: false }), {
        isDeleted: false, isArchived: false,
      })
    })
  }

  for (const [name, options, expected] of [
    ['inherited grant', { assignmentUnitId: 'engineering-child' }, true],
    ['sibling isolation', { assignmentUnitId: 'other-engineering' }, false],
    ['inactive user', { userActive: false }, false],
    ['inactive assignment', { assignmentActive: false }, false],
    ['unassigned user', { assignmentUnitId: null }, false],
    ['legacy engineering role alone', { assignmentUnitId: null, role: 'engineering' }, false],
    ['administrator without assignment', { role: 'admin', assignmentUnitId: null }, true],
    ['inactive administrator', { role: 'admin', userActive: false }, false],
  ] as const) {
    it(name, async () => {
      const { db } = fixture(options)
      assert.equal(await canViewRequestByPredicate(db, 'engineer', 'foreign-request'), expected)
    })
  }

  it('supports a local child grant when solution-work eligibility is inherited', async () => {
    const { db, units } = fixture({ assignmentUnitId: 'engineering-child' })
    units[1].engineeringCanViewAllRequests = false
    units[2].engineeringCanViewAllRequests = true
    assert.equal(await canViewRequestByPredicate(db, 'engineer', 'foreign-request'), true)
  })

  it('removes a revoked grant on the next read but retains an enabled ancestor grant', async () => {
    const { db, units } = fixture({ assignmentUnitId: 'engineering-child' })
    assert.equal(await canViewRequestByPredicate(db, 'engineer', 'foreign-request'), true)
    units[1].engineeringCanViewAllRequests = false
    assert.equal(await canViewRequestByPredicate(db, 'engineer', 'foreign-request'), false)
    units[0].engineeringCanViewAllRequests = true
    assert.equal(await canViewRequestByPredicate(db, 'engineer', 'foreign-request'), true)
  })

  for (const grant of [false, undefined]) {
    it(`does not grant blanket visibility for a ${grant} flag`, async () => {
      const { db, units } = fixture()
      units[1].engineeringCanViewAllRequests = grant
      assert.equal(await canViewRequestByPredicate(db, 'engineer', 'foreign-request'), false)
    })
  }

  it('requires active solution-work eligibility in addition to a view-all grant', async () => {
    const { db, units } = fixture({ assignmentUnitId: 'engineering-child' })
    units[1].canWorkOnSolutions = false
    assert.equal(await canViewRequestByPredicate(db, 'engineer', 'foreign-request'), false)
    units[1].canWorkOnSolutions = true
    units[1].isActive = false
    units[2].engineeringCanViewAllRequests = true
    assert.equal(await canViewRequestByPredicate(db, 'engineer', 'foreign-request'), false)
  })

  it('ignores an inactive granting ancestor even with active solution-work eligibility', async () => {
    const { db, units } = fixture({ assignmentUnitId: 'engineering-child' })
    units[1].isActive = false
    units[2].canWorkOnSolutions = true
    assert.equal(await canViewRequestByPredicate(db, 'engineer', 'foreign-request'), false)
  })

  for (const corruption of ['cycle', 'missing-parent', 'missing-assignment-unit'] as const) {
    it(`does not grant access with ${corruption}`, async () => {
      const { db, units } = fixture({ assignmentUnitId: corruption === 'missing-assignment-unit' ? 'missing' : 'engineering' })
      if (corruption === 'cycle') units[0].parentId = 'engineering'
      if (corruption === 'missing-parent') units[1].parentId = 'missing'
      const canView = await canViewRequestByPredicate(db, 'engineer', 'foreign-request').catch(() => false)
      assert.equal(canView, false)
    })
  }

  it('excludes deleted requests in both regular and archive-aware reads', async () => {
    const { db } = fixture({ request: { isDeleted: true } })
    assert.equal(await canViewRequestByPredicate(db, 'engineer', 'foreign-request'), false)
    assert.equal(await db.findRequest(await buildRequestVisibilityWhere(db, { userId: 'engineer', includeArchived: false })), null)
  })

  it('preserves archive filtering while allowing existing archive-aware detail reads', async () => {
    const { db } = fixture({ request: { isArchived: true } })
    assert.equal(await db.findRequest(await buildRequestVisibilityWhere(db, { userId: 'engineer', includeArchived: false })), null)
    assert.equal(await canViewRequestByPredicate(db, 'engineer', 'foreign-request'), true)
  })

  it('fails closed when an actor has a view-all flag without solution-work eligibility', async () => {
    const actor: RequestVisibilityActor = {
      id: 'engineer', role: 'general_dept', isActive: true, assignmentUnitId: 'engineering',
      sharingScopeUnitIds: [], managedUnitIds: [], canWorkOnSolutions: false,
      engineeringCanViewAllRequests: true,
    }
    const db: RequestVisibilityDb = { ...fixture().db, async findActor() { return actor } }
    assert.equal(await canViewRequestByPredicate(db, 'engineer', 'foreign-request'), false)
  })
})

describe('Engineering viewing does not extend mutation scope', () => {
  for (const status of ['ImprovementRequest', 'SendBackToRequester', 'FinalApproval', 'Completed', 'Cancelled']) {
    it(`keeps a foreign ${status} request read-only`, async () => {
      const { db } = fixture({ status })
      assert.equal(await canViewRequestByPredicate(db, 'engineer', 'foreign-request'), true)
      assert.equal(await canViewRequestByPredicate(db, 'engineer', 'foreign-request', { includeEngineeringViewAll: false }), false)
    })
  }

  for (const request of [
    { requesterId: 'engineer' },
    { organizationUnitId: 'engineering-child' },
    { approvals: [{ approverId: 'engineer', instanceId: null }] },
    { status: 'SentToEngineer' },
    { status: 'DesignCostEstimationApproval' },
  ]) {
    it(`retains pre-existing access for ${JSON.stringify(request)}`, async () => {
      const { db } = fixture({ request })
      assert.equal(await canViewRequestByPredicate(db, 'engineer', 'foreign-request'), true)
      assert.equal(await canViewRequestByPredicate(db, 'engineer', 'foreign-request', { includeEngineeringViewAll: false }), true)
    })
  }
})

describe('solution workers reach sub-task stages without the tracking grant', () => {
  // other-engineering can work on solutions but has no view-all grant.
  const worker = { assignmentUnitId: 'other-engineering' } as const
  const subTaskWork = { includeEngineeringViewAll: false, includeSubTaskWork: true }

  for (const status of ['SentToEngineer', 'SendBackToRequester', 'FinalApproval', 'Completed']) {
    it(`opens and manages sub-tasks on a foreign ${status} request`, async () => {
      const { db } = fixture({ ...worker, status })
      assert.equal(await canViewRequestByPredicate(db, 'engineer', 'foreign-request'), true)
      assert.equal(await canViewRequestByPredicate(db, 'engineer', 'foreign-request', subTaskWork), true)
    })
  }

  for (const status of ['ImprovementRequest', 'Cancelled']) {
    it(`keeps a foreign ${status} request out of reach`, async () => {
      const { db } = fixture({ ...worker, status })
      assert.equal(await canViewRequestByPredicate(db, 'engineer', 'foreign-request'), false)
      assert.equal(await canViewRequestByPredicate(db, 'engineer', 'foreign-request', subTaskWork), false)
    })
  }

  for (const status of ['SendBackToRequester', 'FinalApproval', 'Completed']) {
    it(`does not widen other mutations or request lists for ${status}`, async () => {
      const { db, request } = fixture({ ...worker, status })
      assert.equal(await canViewRequestByPredicate(db, 'engineer', 'foreign-request', { includeEngineeringViewAll: false }), false)
      assert.equal(matches(request, await buildRequestVisibilityWhere(db, { userId: 'engineer', includeArchived: false })), false)
    })

    it(`gives a user outside solution work no sub-task access to ${status}`, async () => {
      const { db } = fixture({ assignmentUnitId: 'operations', status, request: { organizationUnitId: 'other-engineering' } })
      assert.equal(await canViewRequestByPredicate(db, 'engineer', 'foreign-request'), false)
      assert.equal(await canViewRequestByPredicate(db, 'engineer', 'foreign-request', subTaskWork), false)
    })
  }
})

// Run real server-action bodies, replacing only session/DB/storage boundaries.
// No real database, filesystem attachment mutation, or environment is used.
function actionFixture(status: string, owned = false, assignmentUnitId = 'engineering') {
  const data = fixture({
    status, assignmentUnitId,
    request: {
      // An operations actor must not reach the request through its own unit.
      ...(assignmentUnitId === 'operations' ? { organizationUnitId: 'other-engineering' } : {}),
      ...(owned ? { requesterId: 'engineer' } : {}),
    },
  })
  const effects = { requestWrites: 0, deletedFiles: 0, deletedBytes: 0 }
  const prisma = {
    user: { async findUnique() { return data.user } },
    organization_units: { async findMany() { return data.units } },
    organization_assignments: { async findFirst() { return { unitId: assignmentUnitId } } },
    requests: {
      async findUnique() { return data.request },
      async update() { effects.requestWrites++; return data.request },
    },
    request_approvals: { async findFirst() { return null } },
    solution_approvals: { async count() { return 0 }, async findFirst() { return null } },
    file_attachments: {
      async findUnique() {
        return { requestId: data.request.id, request: data.request, uploadedById: 'someone-else', filePath: 'private/test.pdf', fileName: 'test.pdf' }
      },
      async delete() { effects.deletedFiles++ },
    },
    request_activities: { async create() {} },
  }
  const dependencies: Record<string, unknown> = {
    '@/lib/prisma': { __esModule: true, default: prisma },
    '@/lib/auth-config': { async auth() { return { user: data.user } } },
    '@/lib/cache/user-cache': { async getCurrentUser() { return data.user } },
    '@/lib/solution-work-actor': { createSolutionWorkActorDb() {}, async isActorSolutionWorker() { return true } },
    'next/cache': { revalidatePath() {} },
    './request-view-invalidation': { revalidateRequestViews() {} },
    '@/lib/request-visibility/scope': {
      createRequestVisibilityDb() { return data.db },
      buildRequestVisibilityWhere,
      canUserViewRequest: (userId: string, requestId: string, options?: Parameters<typeof canViewRequestByPredicate>[3]) =>
        canViewRequestByPredicate(data.db, userId, requestId, options),
    },
    '@/lib/action-permissions': actionPolicy,
    '@/lib/engineering-sub-tasks': subTaskPolicy,
    '@/lib/approval-engine/current-instance': { CURRENT_INSTANCE_ROW_FILTER },
    '@/lib/approval-engine/transaction-adapter': { createPrismaApprovalTransactionDb() {} },
    '@/lib/attachments/policy': {},
    '@/lib/attachments/image-optimization': {},
    '@/lib/attachments/storage': { async deleteAttachmentFile() { effects.deletedBytes++ } },
  }
  function loadActionModule(path: string) {
    const compiled = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText
    const module = { exports: {} }
    runInNewContext(compiled, {
      exports: module.exports, module, console,
      require(name: string) {
        assert.ok(name in dependencies, `Unhandled server-action dependency: ${name}`)
        return dependencies[name]
      },
    }, { filename: path })
    return module.exports as Record<string, (...args: any[]) => Promise<any>>
  }
  return { ...data, effects, loadActionModule }
}

describe('read-only grant at server-action boundaries', () => {
  for (const status of ['SendBackToRequester', 'FinalApproval']) {
    for (const unitId of ['engineering', 'other-engineering']) {
      it(`lets a ${unitId} solution worker edit WR on a foreign ${status} request`, async () => {
        const { effects, loadActionModule } = actionFixture(status, false, unitId)
        const actions = loadActionModule('src/server-actions/engineering-sub-tasks.ts')
        const result = await actions.toggleWorkRequisitionReceived('foreign-request', true)
        assert.deepEqual({ ...result }, { success: true })
        assert.equal(effects.requestWrites, 1)
      })
    }

    it(`blocks WR edits on a foreign ${status} request outside solution-work units`, async () => {
      const { effects, loadActionModule } = actionFixture(status, false, 'operations')
      const actions = loadActionModule('src/server-actions/engineering-sub-tasks.ts')
      const result = await actions.toggleWorkRequisitionReceived('foreign-request', true)
      assert.equal(result.success, false)
      assert.equal(effects.requestWrites, 0)
    })

    it(`blocks attachment deletion on a newly visible ${status} request`, async () => {
      const { effects, loadActionModule } = actionFixture(status)
      const actions = loadActionModule('src/server-actions/files.ts')
      await assert.rejects(() => actions.deleteFileAttachment({ fileId: 'attachment' }), /Unauthorized/)
      assert.deepEqual(effects, { requestWrites: 0, deletedFiles: 0, deletedBytes: 0 })
    })

    it(`advertises only sub-task management on a newly visible ${status} request`, async () => {
      const { loadActionModule } = actionFixture(status)
      const actions = loadActionModule('src/server-actions/request-action-capabilities.ts')
      const decisions = await actions.getRequestActionCapabilities('foreign-request')
      for (const action of actionPolicy.REQUEST_ACTIONS) {
        assert.equal(decisions[action].allowed, action === 'MANAGE_SUB_TASKS', action)
      }
    })
  }

  it('retains WR edits and attachment deletion for an already-visible owned request', async () => {
    const { effects, loadActionModule } = actionFixture('FinalApproval', true)
    const subTasks = loadActionModule('src/server-actions/engineering-sub-tasks.ts')
    assert.equal((await subTasks.toggleWorkRequisitionReceived('foreign-request', true)).success, true)
    const files = loadActionModule('src/server-actions/files.ts')
    assert.equal((await files.deleteFileAttachment({ fileId: 'attachment' })).success, true)
    assert.deepEqual(effects, { requestWrites: 1, deletedFiles: 1, deletedBytes: 1 })
    const capabilities = loadActionModule('src/server-actions/request-action-capabilities.ts')
    const decisions = await capabilities.getRequestActionCapabilities('foreign-request')
    assert.equal(decisions.MANAGE_SUB_TASKS.allowed, true)
    assert.equal(decisions.DELETE_ATTACHMENT.allowed, true)
  })

  it('blocks WR edits on a tracking-only request outside the sub-task stages', async () => {
    const { db, effects, loadActionModule } = actionFixture('ImprovementRequest')
    assert.equal(await canViewRequestByPredicate(db, 'engineer', 'foreign-request'), true)
    const actions = loadActionModule('src/server-actions/engineering-sub-tasks.ts')
    assert.equal((await actions.toggleWorkRequisitionReceived('foreign-request', true)).success, false)
    assert.equal(effects.requestWrites, 0)
    const capabilities = loadActionModule('src/server-actions/request-action-capabilities.ts')
    const decisions = await capabilities.getRequestActionCapabilities('foreign-request')
    for (const action of actionPolicy.REQUEST_ACTIONS) assert.equal(decisions[action].allowed, false, action)
  })

  it('keeps PDF export and sub-task management as the only actions on newly visible completed requests', async () => {
    const { loadActionModule } = actionFixture('Completed')
    const actions = loadActionModule('src/server-actions/request-action-capabilities.ts')
    const decisions = await actions.getRequestActionCapabilities('foreign-request')
    assert.equal(decisions.EXPORT_PDF.allowed, true)
    assert.equal(decisions.MANAGE_SUB_TASKS.allowed, true)
    for (const action of actionPolicy.REQUEST_ACTIONS.filter((name) => name !== 'EXPORT_PDF' && name !== 'MANAGE_SUB_TASKS')) {
      assert.equal(decisions[action].allowed, false, action)
    }
  })
})

// Second fixture: budget actions and the Engineering dashboard page, again
// running the real module bodies with only session/DB boundaries replaced.
function moduleFixture(request: Record<string, unknown> = {}) {
  const data = fixture({ request: { budgetCodeId: 'code-1', workRequisitionReceived: false, subTasks: [], ...request } })
  const effects = { requestWrites: 0, codeWrites: 0, codeCreates: 0 }
  const wheres: { findMany: unknown[]; count: unknown[] } = { findMany: [], count: [] }
  const code = { id: 'code-1', code: 'BC1', createdById: 'someone-else' }
  const prisma = {
    requests: {
      async findFirst({ where }: { where: unknown }) { return matches(data.request, where) ? { id: data.request.id } : null },
      async findMany({ where }: { where: unknown }) { wheres.findMany.push(where); return [] },
      async count({ where }: { where: unknown }) { wheres.count.push(where); return 0 },
      async update() { effects.requestWrites++ },
    },
    budget_codes: {
      async findUniqueOrThrow() { return code },
      async findUnique() { return code },
      async findFirst({ where }: { where: { createdById: string } }) { return where.createdById === code.createdById ? code : null },
      async update() { effects.codeWrites++ },
      async create() { effects.codeCreates++; return code },
      async findMany() { return [] },
    },
    organization_units: { async findMany() { return [] } },
  }
  const stub: any = new Proxy(function () { return null }, { get: (_t, key) => (key === '__esModule' ? false : stub) })
  const dependencies: Record<string, unknown> = {
    '@/lib/prisma': { __esModule: true, default: prisma },
    '@/lib/cache/user-cache': { async getCurrentUser() { return data.user } },
    '@/lib/auth-config': { async auth() { return { user: data.user } } },
    'next/cache': { revalidatePath() {} },
    'next/navigation': { redirect(to: string) { throw new Error(`redirect ${to}`) } },
    '@/lib/solution-work-actor': { createSolutionWorkActorDb() {}, async isActorSolutionWorker() { return true } },
    '@/lib/request-visibility/scope': { createRequestVisibilityDb() { return data.db }, buildRequestVisibilityWhere },
    '@/server-actions/requests': {
      async getRequestsNeedingEngineeringAction() { return { needsApproval: [] } },
      async getEngineeringUsers() { return [] },
    },
    '@/server-actions/engineering-sub-tasks': { async getEngineeringSubTaskOptions() { return { stages: [], subcontractors: [] } } },
  }
  function load(path: string) {
    const compiled = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
    }).outputText
    const module = { exports: {} }
    runInNewContext(compiled, {
      exports: module.exports, module, console, Date, Promise,
      // Real libraries (zod, xlsx, pure helpers) run for real; UI modules are inert.
      require(name: string) {
        if (name in dependencies) return dependencies[name]
        if (/^@\/components\/|^lucide-react$|^@\/lib\/utils$/.test(name)) return stub
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require(name.startsWith('@/') ? `${process.cwd()}/src/${name.slice(2)}` : name)
      },
    }, { filename: path })
    return module.exports as Record<string, (...args: any[]) => Promise<any>>
  }
  return { ...data, effects, wheres, load }
}

describe('read-only grant does not unlock budget changes', () => {
  const budget = 'src/server-actions/budget-control.ts'

  it('rejects request budget edits on a tracking-only request', async () => {
    const { db, effects, load } = moduleFixture()
    assert.equal(await canViewRequestByPredicate(db, 'engineer', 'foreign-request'), true)
    const actions = load(budget)
    await assert.rejects(() => actions.updateRequestProjectEstimate({ requestId: 'foreign-request', projectEstimateCost: 5 }), /not visible/)
    await assert.rejects(() => actions.unassignRequestBudgetCode('foreign-request'), /not visible/)
    await assert.rejects(() => actions.assignRequestToBudgetCode({ requestId: 'foreign-request', budgetCodeId: 'code-1' }), /not visible/)
    await assert.rejects(() => actions.assignRequestToBudgetCode({ requestId: 'foreign-request', budgetCode: 'NEW' }), /not visible/)
    assert.deepEqual(effects, { requestWrites: 0, codeWrites: 0, codeCreates: 0 })
  })

  it('rejects budget code edits reachable only through a tracking-only request', async () => {
    const { effects, load } = moduleFixture()
    const actions = load(budget)
    await assert.rejects(() => actions.updateBudgetCodeAmount({ budgetCodeId: 'code-1', name: 'Changed', budgetAmount: 1 }), /not visible/)
    assert.deepEqual({ ...(await actions.pasteBudgetCodes({ rows: [{ code: 'BC1', name: 'Changed', budgetAmount: 1 }] })) }, { created: 0, updated: 0, skipped: 1 })
    assert.deepEqual(effects, { requestWrites: 0, codeWrites: 0, codeCreates: 0 })
  })

  it('keeps budget edits for requests the user could already see', async () => {
    const { effects, load } = moduleFixture({ requesterId: 'engineer' })
    const actions = load(budget)
    assert.equal((await actions.updateRequestProjectEstimate({ requestId: 'foreign-request', projectEstimateCost: 5 })).success, true)
    assert.equal((await actions.updateBudgetCodeAmount({ budgetCodeId: 'code-1', name: 'Changed', budgetAmount: 1 })).success, true)
    assert.deepEqual({ ...(await actions.pasteBudgetCodes({ rows: [{ code: 'BC1', name: 'Changed', budgetAmount: 1 }] })) }, { created: 0, updated: 1, skipped: 0 })
    assert.deepEqual(effects, { requestWrites: 1, codeWrites: 2, codeCreates: 0 })
  })

  it('still lists tracking-only requests in the budget monitor', async () => {
    const { request, wheres, load } = moduleFixture()
    await load(budget).getBudgetMonitorData().catch(() => undefined)
    const where = wheres.findMany[0] as { AND: unknown[] }
    assert.equal(matches(request, { AND: where.AND }), true)
  })
})

describe('Engineering dashboard work queue covers the sub-task stages', () => {
  const page = 'src/app/(dashboard)/engineering/page.tsx'

  for (const status of ['FinalApproval', 'SendBackToRequester']) {
    it(`lists a foreign ${status} request in Follow up work and the pipeline count`, async () => {
      const { request, wheres, load } = moduleFixture({ status })
      await load(page).default()
      assert.equal(matches(request, wheres.findMany[0]), true)
      assert.equal(matches(request, wheres.count[0]), true)
    })
  }

  it('keeps a tracking-only request outside the work stages out of the pipeline count', async () => {
    const { db, request, wheres, load } = moduleFixture({ status: 'Completed' })
    assert.equal(await canViewRequestByPredicate(db, 'engineer', 'foreign-request'), true)
    await load(page).default()
    assert.equal(matches(request, wheres.findMany[0]), false)
    assert.equal(matches(request, wheres.count[0]), false)
  })

  it('keeps an already-visible request in Follow up work and the pipeline count', async () => {
    const { request, wheres, load } = moduleFixture({ status: 'FinalApproval', requesterId: 'engineer' })
    await load(page).default()
    assert.equal(matches(request, wheres.findMany[0]), true)
    assert.equal(matches(request, wheres.count[0]), true)
  })
})
