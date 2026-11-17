import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { it } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { buildFollowUpDashboard } from '@/lib/follow-up-dashboard'

// Exercise the surviving action, not imports left behind by the retired dashboard queries.
function loadDashboard(userId: string | null, visible: Array<Record<string, unknown>>) {
  const calls: { table: string; query: { where: { requestId: { in: string[] } } } }[] = []
  const listFilters: unknown[] = []
  const findMany = (table: string) => async (query: { where: { requestId: { in: string[] } } }) => {
    calls.push({ table, query })
    return []
  }
  const modules: Record<string, unknown> = {
    '@/lib/prisma': { __esModule: true, default: {
      solutions: { findMany: findMany('solutions') },
      request_activities: { findMany: findMany('activities') },
    } },
    '@/lib/cache/user-cache': { getCurrentUser: async () => userId ? { id: userId } : null },
    '@/server-actions/requests': { getMyRequests: async (filters: unknown) => { listFilters.push(filters); return visible } },
    '@/lib/follow-up-dashboard': { buildFollowUpDashboard },
  }
  const output = ts.transpileModule(readFileSync('src/server-actions/dashboard.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const actions = {} as { getFollowUpDashboard: () => Promise<ReturnType<typeof buildFollowUpDashboard>> }
  runInNewContext(output, {
    exports: actions,
    require(name: string) { assert.ok(name in modules, `unexpected dependency ${name}`); return modules[name] },
  })
  return { run: actions.getFollowUpDashboard, calls, listFilters }
}

it('the follow-up dashboard rejects a missing user before any request or activity reads', async () => {
  const harness = loadDashboard(null, [])
  await assert.rejects(harness.run, /User not found/)
  assert.equal(harness.listFilters.length, 0)
  assert.equal(harness.calls.length, 0)
})

it('a viewer with no visible requests triggers no unscoped supplementary reads', async () => {
  const harness = loadDashboard('viewer', [])
  const result = await harness.run()
  assert.equal(harness.calls.length, 0)
  assert.equal(harness.listFilters.length, 1)
  assert.equal(result.engineerSolutionReady.length, 0)
})

it('solution estimates and activity queries use only IDs returned by the shared visibility reader', async () => {
  const now = new Date('2026-11-17T12:00:00Z')
  const harness = loadDashboard('viewer', [{
    id: 'visible-request', title: 'Visible request', status: 'SendBackToRequester',
    createdAt: now, updatedAt: now, requesterId: 'viewer', requester: { name: 'Viewer' },
    hasRejection: false, workRequisitionReceived: false, approvals: [], engineerAssignments: [],
  }])
  const result = await harness.run()
  assert.deepEqual(JSON.parse(JSON.stringify(harness.listFilters)), [{ wrStatus: 'all' }])
  assert.deepEqual(harness.calls.map(call => call.table).sort(), ['activities', 'activities', 'solutions'])
  for (const { query } of harness.calls) assert.deepEqual(Array.from(query.where.requestId.in), ['visible-request'])
  assert.equal(result.engineerSolutionReady[0]?.id, 'visible-request')
})
