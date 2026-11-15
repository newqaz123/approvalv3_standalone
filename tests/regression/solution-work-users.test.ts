import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { listSolutionWorkUsers, filterSolutionWorkUserIds } from '@/lib/solution-work-users'
import type { OrganizationUnitNode } from '@/lib/organization/model'
import { evaluateRequestAction, existingAssignEngineersDecision } from '@/lib/action-permissions'
import { isActorSolutionWorker, type SolutionWorkActorDb } from '@/lib/solution-work-actor'

const u = (id: string, parentId: string | null, over: Partial<OrganizationUnitNode> = {}): OrganizationUnitNode =>
  ({ id, name: id, parentId, isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null, ...over })
const units = [
  u('company', null),
  u('solutions', 'company', { canWorkOnSolutions: true }),
  u('child', 'solutions'),
  u('sales', 'company'),
  u('retired', 'company', { canWorkOnSolutions: true, isActive: false }),
]
const assignment = (unitId: string, isActive = true) => ({ unitId, isActive })
const users = [
  { id: 'direct', name: 'Zoe', isActive: true, role: 'general_dept', assignments: [assignment('solutions')] },
  { id: 'child', name: 'Amy', isActive: true, role: 'general_dept', assignments: [assignment('child')] },
  { id: 'unflagged', name: 'Sales', isActive: true, role: 'general_dept', assignments: [assignment('sales')] },
  { id: 'inactive', name: 'Inactive', isActive: false, role: 'general_dept', assignments: [assignment('solutions')] },
  { id: 'retired', name: 'Retired', isActive: true, role: 'general_dept', assignments: [assignment('retired')] },
  { id: 'multiple', name: 'Bob', isActive: true, role: 'general_dept', assignments: [assignment('sales'), assignment('solutions'), assignment('child')] },
  { id: 'legacy', name: 'Legacy', isActive: true, role: 'engineering', assignments: [] },
  { id: 'inactiveAssignment', name: 'Old', isActive: true, role: 'general_dept', assignments: [assignment('solutions', false)] },
]

function fakeClient(): Parameters<typeof listSolutionWorkUsers>[0] {
  return {
    user: {
      async findMany(args) {
        assert.deepEqual(args.where, { isActive: true })
        assert.deepEqual(args.select, {
          id: true, name: true, email: true,
          organizationAssignments: { where: { isActive: true }, select: { unitId: true } },
        })
        assert.deepEqual(args.orderBy, { name: 'asc' })
        return users.filter((user) => user.isActive === args.where.isActive)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((user) => ({
            id: user.id, name: user.name, email: `${user.id}@example.com`,
            organizationAssignments: user.assignments.filter((row) => row.isActive === args.select.organizationAssignments.where.isActive),
          }))
      },
    },
    organization_units: {
      async findMany() { return units },
    },
  }
}

const qualifyingUsers = [
  { id: 'child', name: 'Amy', email: 'child@example.com' },
  { id: 'multiple', name: 'Bob', email: 'multiple@example.com' },
  { id: 'direct', name: 'Zoe', email: 'direct@example.com' },
]

describe('listSolutionWorkUsers follows active assignments and inherited unit settings', () => {
  it('lists flagged-unit and descendant users once, ordered by name, with only public picker fields', async () => {
    assert.deepEqual(await listSolutionWorkUsers(fakeClient()), qualifyingUsers)
  })

  it('excludes unflagged, inactive, inactive-unit, inactive-assignment, and legacy-role-only users', async () => {
    const ids = (await listSolutionWorkUsers(fakeClient())).map((user) => user.id)
    for (const id of ['unflagged', 'inactive', 'retired', 'inactiveAssignment', 'legacy']) {
      assert.equal(ids.includes(id), false, id)
    }
  })

  it('filters candidate ids to qualifying users only and does not duplicate users', async () => {
    const ids = ['direct', 'unflagged', 'child', 'inactive', 'retired', 'multiple', 'legacy', 'inactiveAssignment', 'unknown', 'direct']
    assert.deepEqual((await filterSolutionWorkUserIds(fakeClient(), ids)).sort(), ['child', 'direct', 'multiple'])
    assert.deepEqual(await filterSolutionWorkUserIds(fakeClient(), []), [])
    assert.deepEqual(await filterSolutionWorkUserIds(fakeClient(), ['unknown', 'legacy']), [])
  })
})

describe('requests use solution-work users, not engineering roles', () => {
  const source = readFileSync('src/server-actions/requests.ts', 'utf8')
  it('removes role-based guards and picker queries', () => {
    assert.doesNotMatch(source, /role:\s*'engineering'|role\s*!==\s*'engineering'/)
    assert.match(source, /return listSolutionWorkUsers\(prisma\)/)
    assert.match(source, /await filterSolutionWorkUserIds\(prisma, engineerIds\)/)
  })

  it('assignEngineers denies an eligible caller who cannot view a deleted request without loading it or writing', async () => {
    const user = { id: 'worker', role: 'general_dept', isActive: true }
    const actorDb: SolutionWorkActorDb = {
      async findUser() { return user },
      async findActiveAssignmentUnitIds() { return ['solutions'] },
      async findUnits() { return units },
    }
    assert.equal(await isActorSolutionWorker(actorDb, user.id), true)

    const file = ts.createSourceFile('requests.ts', source, ts.ScriptTarget.Latest, true)
    const action = file.statements.find((node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === 'assignEngineers')
    assert.ok(action)
    const compiled = ts.transpileModule(action.getText(file), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    const calls: string[] = []
    const storedAssignments = ['existing-engineer']
    const actions = {} as { assignEngineers(requestId: string, engineerIds: string[]): Promise<unknown> }
    runInNewContext(compiled, {
      exports: actions,
      getCurrentUser: async () => user,
      createSolutionWorkActorDb: () => actorDb,
      isActorSolutionWorker,
      evaluateRequestAction,
      existingAssignEngineersDecision,
      canUserViewRequest: async (userId: string, requestId: string) => {
        assert.equal(userId, user.id)
        assert.equal(requestId, 'deleted-request')
        calls.push('visibility-denied')
        return false
      },
      filterSolutionWorkUserIds: async () => [],
      revalidateRequestViews: () => calls.push('revalidate'),
      prisma: {
        requests: {
          async findUnique() {
            calls.push('request-load')
            return { status: 'SentToEngineer', isDeleted: true, title: 'Deleted request', requesterId: 'requester', organizationUnitId: 'sales' }
          },
        },
        request_engineer_assignments: {
          async deleteMany() { calls.push('assignments-delete'); storedAssignments.length = 0 },
          async createMany() { calls.push('assignments-create') },
        },
        request_activities: { async create() { calls.push('activity-create') } },
      },
    })

    await assert.rejects(actions.assignEngineers('deleted-request', []), { message: 'Request not found' })
    assert.deepEqual(calls, ['visibility-denied'])
    assert.deepEqual(storedAssignments, ['existing-engineer'])
  })

  it('keeps stored engineer assignments in the modal request loader even after unit eligibility is removed', async () => {
    // Execute the real loader, isolating its external boundaries only.
    const file = ts.createSourceFile('requests.ts', source, ts.ScriptTarget.Latest, true)
    const loader = file.statements.find((node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === 'getRequest')
    assert.ok(loader)
    const compiled = ts.transpileModule(loader.getText(file), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    const storedAssignments = [{ engineer: { id: 'unflagged', name: 'Sales' } }, { engineer: { id: 'legacy', name: 'Legacy' } }]
    const actions = {} as { getRequest(id: string): Promise<{ engineerAssignments: typeof storedAssignments }> }
    runInNewContext(compiled, {
      exports: actions,
      auth: async () => ({ user: { id: 'viewer' } }),
      canUserViewRequest: async () => true,
      APPROVAL_DISPLAY_SELECT: {},
      CURRENT_INSTANCE_ROW_FILTER: [],
      withApprovalDisplay: (row: unknown) => row,
      prisma: {
        requests: {
          async findUnique(args: { where: { id: string }; include: { engineerAssignments?: unknown } }) {
            assert.equal(args.where.id, 'request')
            // The loader must not filter stored assignments by current eligibility.
            assert.deepEqual(JSON.parse(JSON.stringify(args.include.engineerAssignments ?? null)), {
              include: { engineer: { select: { id: true, name: true } } },
            })
            return { id: 'request', approvals: [], solutions: [], engineerAssignments: storedAssignments }
          },
        },
        solution_approvals: { count: async () => 0 },
      },
    })
    const result = await actions.getRequest('request')
    assert.deepEqual(result.engineerAssignments, storedAssignments)
    const eligible = await filterSolutionWorkUserIds(fakeClient(), storedAssignments.map((row) => row.engineer.id))
    assert.deepEqual(eligible, [])
  })
})
