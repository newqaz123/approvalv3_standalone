// Clean-start readiness validation (Plan A Task 7) — replaces the legacy
// cutover/mapping machinery (legacy rollout modes, mapping digests) with
// explicit organization/route readiness. In-memory fake db and child CLI
// only: NO Prisma, NO database, NO env-var rollout modes. Pins the parent
// A7 rulings R-A7-1..R-A7-6 recorded in the SDD ledger before these tests.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { verifyCleanStartReadiness, ROOT_DEFAULT_ROUTES_REQUIRED } from '@/lib/clean-start-readiness'
import type { CleanStartReadinessDb, ReadinessReport } from '@/lib/clean-start-readiness'
import { runVerifyCleanStartReadiness } from '../../scripts/verify-clean-start-readiness'
import type { AssignmentNode, OrganizationUnitNode, PositionNode, TeamNode } from '@/lib/organization/model'

type PhaseCounts = Record<'REQUEST' | 'SOLUTION' | 'FINAL', number>

const units: OrganizationUnitNode[] = [
  { id: 'company', name: 'Company', parentId: null, isActive: true, shareRequests: true, canWorkOnSolutions: false, managerUserId: 'u-root' },
  { id: 'eng', name: 'Engineering', parentId: 'company', isActive: true, shareRequests: false, canWorkOnSolutions: true, managerUserId: 'u-engmgr' },
]
const positions: PositionNode[] = [
  { id: 'p-staff', name: 'Staff', rank: 1, isActive: true },
  { id: 'p-lead', name: 'Lead', rank: 2, isActive: true },
  { id: 'p-mgr', name: 'Manager', rank: 3, isActive: true },
]
const assignments: AssignmentNode[] = [
  { id: 'a-root', userId: 'u-root', unitId: 'company', positionId: 'p-mgr', teamId: null, isActive: true },
  { id: 'a-engmgr', userId: 'u-engmgr', unitId: 'eng', positionId: 'p-mgr', teamId: null, isActive: true },
  { id: 'a-lead', userId: 'u-lead', unitId: 'eng', positionId: 'p-lead', teamId: null, isActive: true },
  { id: 'a-staff', userId: 'u-staff', unitId: 'eng', positionId: 'p-staff', teamId: 't-1', isActive: true },
]
const teams: TeamNode[] = [
  { id: 't-1', unitId: 'eng', name: 'Crew', reportsToAssignmentId: 'a-lead', isActive: true },
]

const onePerPhase = (): PhaseCounts => ({ REQUEST: 1, SOLUTION: 1, FINAL: 1 })

function makeDb(over: Partial<CleanStartReadinessDb> = {}, counts: PhaseCounts = onePerPhase()): CleanStartReadinessDb {
  return {
    loadUnits: async () => units,
    loadPositions: async () => positions,
    loadAssignments: async () => assignments,
    loadTeams: async () => teams,
    countPublishedRoutesByPhase: async () => counts,
    ...over,
  }
}

describe('clean-start readiness validation', () => {
  it('reports ready for a valid organization with one root default route per phase', async () => {
    assert.equal(ROOT_DEFAULT_ROUTES_REQUIRED, 'ROOT_DEFAULT_ROUTES_PUBLISHED')
    const report = await verifyCleanStartReadiness(makeDb())
    assert.deepEqual(report, { ready: true, blockers: [] })
  })

  it('blocks a phase with zero root-scope published default routes (plan Step 1 case)', async () => {
    const report = await verifyCleanStartReadiness(makeDb({}, { REQUEST: 0, SOLUTION: 1, FINAL: 1 }))
    assert.equal(report.ready, false)
    assert.deepEqual(report.blockers.map((b) => b.code), [ROOT_DEFAULT_ROUTES_REQUIRED])
    assert.match(report.blockers[0].detail, /REQUEST/)
  })

  it('emits one ROOT_DEFAULT_ROUTES_PUBLISHED blocker per missing phase, in phase order', async () => {
    const report = await verifyCleanStartReadiness(makeDb({}, { REQUEST: 0, SOLUTION: 0, FINAL: 0 }))
    assert.equal(report.ready, false)
    assert.deepEqual(report.blockers.map((b) => b.code), [
      ROOT_DEFAULT_ROUTES_REQUIRED, ROOT_DEFAULT_ROUTES_REQUIRED, ROOT_DEFAULT_ROUTES_REQUIRED,
    ])
    assert.deepEqual(
      report.blockers.map((b) => /REQUEST|SOLUTION|FINAL/.exec(b.detail)?.[0]),
      ['REQUEST', 'SOLUTION', 'FINAL'],
    )
  })

  it('blocks when fewer than two positions are active, naming the count', async () => {
    // Valid organization with exactly ONE active position: no active
    // assignment may reference the inactive p-lead (A3 rule 2) and no active
    // team can exist (its reports-to could not rank strictly above members
    // with a single rank), so the only blocker is the position shortage.
    const thinPositions: PositionNode[] = [
      { id: 'p-staff', name: 'Staff', rank: 1, isActive: true },
      { id: 'p-lead', name: 'Lead', rank: 2, isActive: false },
    ]
    const thinAssignments: AssignmentNode[] = [
      { id: 'a-root', userId: 'u-root', unitId: 'company', positionId: 'p-staff', teamId: null, isActive: true },
      { id: 'a-engmgr', userId: 'u-engmgr', unitId: 'eng', positionId: 'p-staff', teamId: null, isActive: true },
      { id: 'a-staff', userId: 'u-staff', unitId: 'eng', positionId: 'p-staff', teamId: null, isActive: true },
    ]
    const report = await verifyCleanStartReadiness(makeDb({
      loadPositions: async () => thinPositions,
      loadAssignments: async () => thinAssignments,
      loadTeams: async () => [],
    }))
    assert.equal(report.ready, false)
    assert.deepEqual(report.blockers.map((b) => b.code), ['POSITIONS_MISSING'])
    assert.match(report.blockers[0].detail, /\b1\b/)
  })

  it('blocks on organization validation failure with the domain detail', async () => {
    const doubled: AssignmentNode[] = [
      ...assignments,
      { id: 'a-staff-b', userId: 'u-staff', unitId: 'company', positionId: 'p-staff', teamId: null, isActive: true },
    ]
    const report = await verifyCleanStartReadiness(makeDb({ loadAssignments: async () => doubled }))
    assert.equal(report.ready, false)
    assert.deepEqual(report.blockers.map((b) => b.code), ['ORGANIZATION_INVALID'])
    assert.match(report.blockers[0].detail, /one active/i)
  })

  it('accumulates every blocker class in one report when their inputs loaded', async () => {
    // One active position (POSITIONS_MISSING) + a second active assignment
    // for u-staff (ORGANIZATION_INVALID, A3 rule 1) + two zero-count phases
    // (ROOT_DEFAULT_ROUTES_PUBLISHED ×2). No active assignment references
    // the inactive p-lead and no team exists, so those are the only blockers.
    const thinPositions: PositionNode[] = [
      { id: 'p-staff', name: 'Staff', rank: 1, isActive: true },
      { id: 'p-lead', name: 'Lead', rank: 2, isActive: false },
    ]
    const doubled: AssignmentNode[] = [
      { id: 'a-root', userId: 'u-root', unitId: 'company', positionId: 'p-staff', teamId: null, isActive: true },
      { id: 'a-engmgr', userId: 'u-engmgr', unitId: 'eng', positionId: 'p-staff', teamId: null, isActive: true },
      { id: 'a-staff', userId: 'u-staff', unitId: 'eng', positionId: 'p-staff', teamId: null, isActive: true },
      { id: 'a-staff-b', userId: 'u-staff', unitId: 'company', positionId: 'p-staff', teamId: null, isActive: true },
    ]
    const report = await verifyCleanStartReadiness(makeDb(
      { loadPositions: async () => thinPositions, loadAssignments: async () => doubled, loadTeams: async () => [] },
      { REQUEST: 0, SOLUTION: 1, FINAL: 0 },
    ))
    assert.equal(report.ready, false)
    assert.deepEqual(report.blockers.map((b) => b.code), [
      'ORGANIZATION_INVALID', 'POSITIONS_MISSING',
      ROOT_DEFAULT_ROUTES_REQUIRED, ROOT_DEFAULT_ROUTES_REQUIRED,
    ])
  })

  it('treats malformed phase counts as fail-closed blockers, never as ready', async () => {
    const malformed: Array<{ label: string; counts: unknown }> = [
      { label: 'missing SOLUTION key', counts: { REQUEST: 1, FINAL: 1 } },
      { label: 'NaN', counts: { REQUEST: 1, SOLUTION: Number.NaN, FINAL: 1 } },
      { label: 'Infinity', counts: { REQUEST: 1, SOLUTION: 1, FINAL: Number.POSITIVE_INFINITY } },
      { label: 'negative', counts: { REQUEST: -1, SOLUTION: 1, FINAL: 1 } },
      { label: 'non-integer', counts: { REQUEST: 1.5, SOLUTION: 1, FINAL: 1 } },
      { label: 'non-number', counts: { REQUEST: '2', SOLUTION: 1, FINAL: 1 } },
    ]
    for (const variant of malformed) {
      const report = await verifyCleanStartReadiness(
        makeDb({ countPublishedRoutesByPhase: async () => variant.counts as PhaseCounts }),
      )
      assert.equal(report.ready, false, variant.label)
      assert.deepEqual(report.blockers.map((b) => b.code), ['PUBLISHED_ROUTE_COUNTS_INVALID'], variant.label)
      assert.match(report.blockers[0].detail, /REQUEST|SOLUTION|FINAL/, variant.label)
    }
  })

  it('provider failures become READINESS_PROVIDER_ERROR blockers naming the method, without fabricating other blockers', async () => {
    const failingTeams = makeDb({ loadTeams: async () => { throw new Error('boom') } })
    const report = await verifyCleanStartReadiness(failingTeams)
    assert.equal(report.ready, false)
    assert.deepEqual(report.blockers.map((b) => b.code), ['READINESS_PROVIDER_ERROR'])
    assert.match(report.blockers[0].detail, /loadTeams/)
    // Positions loaded fine (three active) and counts returned one per phase:
    // neither POSITIONS_MISSING nor ROOT_DEFAULT_ROUTES_PUBLISHED may be
    // fabricated from the failed load.
    assert.equal(report.blockers.some((b) => b.code === 'POSITIONS_MISSING'), false)
    assert.equal(report.blockers.some((b) => b.code === ROOT_DEFAULT_ROUTES_REQUIRED), false)
  })

  it('records one provider blocker per failing method when every provider fails', async () => {
    const reject = async (): Promise<never> => { throw new Error('down') }
    const report = await verifyCleanStartReadiness(makeDb({
      loadUnits: reject, loadPositions: reject, loadAssignments: reject, loadTeams: reject,
      countPublishedRoutesByPhase: reject,
    }))
    assert.equal(report.ready, false)
    assert.deepEqual(report.blockers.map((b) => b.code), [
      'READINESS_PROVIDER_ERROR', 'READINESS_PROVIDER_ERROR', 'READINESS_PROVIDER_ERROR',
      'READINESS_PROVIDER_ERROR', 'READINESS_PROVIDER_ERROR',
    ])
    const joined = report.blockers.map((b) => b.detail).join(' ')
    for (const method of ['loadUnits', 'loadPositions', 'loadAssignments', 'loadTeams', 'countPublishedRoutesByPhase']) {
      assert.match(joined, new RegExp(method))
    }
  })

  it('sanitizes provider error detail — raw non-domain messages never reach the report', async () => {
    const report = await verifyCleanStartReadiness(makeDb({
      loadUnits: async () => { throw new Error('connect ECONNREFUSED postgres://svc:supersecret@db.internal:5432/app_cleanstart_dev') },
    }))
    assert.equal(report.ready, false)
    const detail = report.blockers.map((b) => b.detail).join(' ')
    assert.doesNotMatch(detail, /supersecret|postgres|ECONNREFUSED|db\.internal/)
    assert.match(detail, /loadUnits/)
    assert.match(detail, /sanitiz/i)
  })

  it('never mutates its inputs', async () => {
    const snapshot = JSON.stringify({ units, positions, assignments, teams })
    await verifyCleanStartReadiness(makeDb())
    assert.equal(JSON.stringify({ units, positions, assignments, teams }), snapshot)
  })
})

describe('clean-start readiness source contracts (R-A7-4, R-A7-1)', () => {
  it('documents the ROOT-only adapter contract on the port; actual scoping is provable only in B6 adapter tests', () => {
    const source = readFileSync('src/lib/clean-start-readiness.ts', 'utf8')
    assert.match(source, /company ROOT/i)
    assert.match(source, /unit-level exception/i)
    assert.match(source, /PUBLISHED/i)
  })

  it('imports no Prisma, reads no env, and the CLI writes no files (read-only)', () => {
    for (const path of ['src/lib/clean-start-readiness.ts', 'scripts/verify-clean-start-readiness.ts']) {
      const source = readFileSync(path, 'utf8')
      assert.doesNotMatch(source, /prisma/i, path)
      assert.doesNotMatch(source, /process\.env/, path)
    }
    const cli = readFileSync('scripts/verify-clean-start-readiness.ts', 'utf8')
    assert.doesNotMatch(cli, /node:fs|writeFile/, 'CLI must never write')
  })
})

describe('verify-clean-start-readiness CLI (in-process seam)', () => {
  it('--help exits 0 with usage and never constructs a database', async () => {
    let constructed = 0
    const prints: string[] = []
    const code = await runVerifyCleanStartReadiness({
      argv: ['--help'],
      createDb: async () => {
        constructed += 1
        throw new Error('database client must not be constructed for --help')
      },
      print: (line) => prints.push(line),
    })
    assert.equal(code, 0)
    assert.equal(constructed, 0)
    assert.ok(prints.some((line) => /usage|--help/i.test(line)))
  })

  it('default wiring is fail-closed: no adapter exists until Plan B Task 6 (R-A7-1/R-A7-2)', async () => {
    const prints: string[] = []
    const code = await runVerifyCleanStartReadiness({ argv: [], print: (line) => prints.push(line) })
    assert.equal(code, 1)
    const report = JSON.parse(prints.join('\n')) as ReadinessReport
    assert.equal(report.ready, false)
    assert.deepEqual(report.blockers.map((b) => b.code), ['READINESS_ADAPTER_UNAVAILABLE'])
    assert.match(report.blockers[0].detail, /Plan B Task 6/i)
  })

  it('prints the JSON report and exits 1 when blocked, 0 when ready (injected db)', async () => {
    const blockedPrints: string[] = []
    const blockedCode = await runVerifyCleanStartReadiness({
      argv: [],
      createDb: async () => makeDb({}, { REQUEST: 1, SOLUTION: 0, FINAL: 1 }),
      print: (line) => blockedPrints.push(line),
    })
    assert.equal(blockedCode, 1)
    const blockedReport = JSON.parse(blockedPrints.join('\n')) as ReadinessReport
    assert.equal(blockedReport.ready, false)
    assert.deepEqual(blockedReport.blockers.map((b) => b.code), [ROOT_DEFAULT_ROUTES_REQUIRED])

    const readyPrints: string[] = []
    const readyCode = await runVerifyCleanStartReadiness({
      argv: [],
      createDb: async () => makeDb(),
      print: (line) => readyPrints.push(line),
    })
    assert.equal(readyCode, 0)
    assert.deepEqual(JSON.parse(readyPrints.join('\n')) as ReadinessReport, { ready: true, blockers: [] })
  })

  it('provider failure through the CLI still prints well-formed JSON and exits 1', async () => {
    const prints: string[] = []
    const code = await runVerifyCleanStartReadiness({
      argv: [],
      createDb: async () => makeDb({ loadUnits: async () => { throw new Error('down') } }),
      print: (line) => prints.push(line),
    })
    assert.equal(code, 1)
    const report = JSON.parse(prints.join('\n')) as ReadinessReport
    assert.equal(report.ready, false)
    assert.deepEqual(report.blockers.map((b) => b.code), ['READINESS_PROVIDER_ERROR'])
  })

  it('unknown arguments are fail-closed usage errors, never ignored', async () => {
    let constructed = 0
    const prints: string[] = []
    const code = await runVerifyCleanStartReadiness({
      argv: ['--bogus'],
      createDb: async () => {
        constructed += 1
        throw new Error('database client must not be constructed for a usage error')
      },
      print: (line) => prints.push(line),
    })
    assert.equal(code, 1)
    assert.equal(constructed, 0)
    assert.ok(prints.some((line) => /unknown argument: --bogus/i.test(line)))
    assert.ok(prints.some((line) => /usage/i.test(line)))
  })
})

describe('verify-clean-start-readiness CLI (child process, deterministic)', () => {
  const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
  const script = fileURLToPath(new URL('../../scripts/verify-clean-start-readiness.ts', import.meta.url))

  function runCli(args: readonly string[]) {
    return spawnSync(process.execPath, ['--import', 'tsx', script, ...args], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 120_000,
    })
  }

  it('child run with no adapter prints parseable fail-closed JSON and exits 1', () => {
    const run = runCli([])
    assert.equal(run.status, 1)
    assert.equal(run.stderr, '')
    const report = JSON.parse(run.stdout) as ReadinessReport
    assert.equal(report.ready, false)
    assert.deepEqual(report.blockers.map((b) => b.code), ['READINESS_ADAPTER_UNAVAILABLE'])
  })

  it('child --help exits 0 with usage text', () => {
    const run = runCli(['--help'])
    assert.equal(run.status, 0)
    assert.match(run.stdout, /usage/i)
  })

  it('child with an unknown argument exits 1 fail-closed with usage', () => {
    const run = runCli(['--nope'])
    assert.equal(run.status, 1)
    assert.match(run.stdout, /unknown argument: --nope/i)
    assert.match(run.stdout, /usage/i)
  })
})

describe('clean-start readiness FIX1 (review 9a6fbd83, NOT APPROVED remediation)', () => {
  it('P1-1 (library): a provider RESOLVING a malformed count container is one identifying invalid-count blocker, never ready and never a throw', async () => {
    const containers: unknown[] = [undefined, null, 3, 'nope', [1, 2], true]
    for (const container of containers) {
      const report = await verifyCleanStartReadiness(makeDb({
        countPublishedRoutesByPhase: async () => container as PhaseCounts,
      }))
      assert.equal(report.ready, false, `container ${String(container)}`)
      assert.deepEqual(
        report.blockers.map((b) => b.code),
        ['PUBLISHED_ROUTE_COUNTS_INVALID'],
        `container ${String(container)} must be exactly one container-level blocker`,
      )
      assert.match(report.blockers[0].detail, /countPublishedRoutesByPhase/, String(container))
    }
  })

  it('P1-1 (library): a resolved undefined container is NOT the failure sentinel — no READINESS_PROVIDER_ERROR may be recorded for it', async () => {
    const report = await verifyCleanStartReadiness(makeDb({
      countPublishedRoutesByPhase: async () => undefined as unknown as PhaseCounts,
    }))
    assert.equal(report.blockers.some((b) => b.code === 'READINESS_PROVIDER_ERROR'), false)
    assert.equal(report.blockers.some((b) => b.code === 'PUBLISHED_ROUTE_COUNTS_INVALID'), true)
  })

  it('P1-1 (injected CLI): resolved malformed count containers still print a JSON report and exit 1', async () => {
    for (const container of [undefined, null]) {
      const prints: string[] = []
      const code = await runVerifyCleanStartReadiness({
        argv: [],
        createDb: async () => makeDb({ countPublishedRoutesByPhase: async () => container as unknown as PhaseCounts }),
        print: (line) => prints.push(line),
      })
      assert.equal(code, 1, String(container))
      const report = JSON.parse(prints.join('\n')) as ReadinessReport
      assert.equal(report.ready, false)
      assert.deepEqual(report.blockers.map((b) => b.code), ['PUBLISHED_ROUTE_COUNTS_INVALID'])
    }
  })

  it('P1-2 (CLI): an injected createDb that throws SYNCHRONOUSLY is caught, sanitized, and reported as JSON with exit 1', async () => {
    const prints: string[] = []
    const code = await runVerifyCleanStartReadiness({
      argv: [],
      createDb: () => {
        throw new Error('connect failed: postgres://svc:topsecret@db.internal:5432/app_cleanstart_dev')
      },
      print: (line) => prints.push(line),
    })
    assert.equal(code, 1)
    const report = JSON.parse(prints.join('\n')) as ReadinessReport
    assert.equal(report.ready, false)
    assert.deepEqual(report.blockers.map((b) => b.code), ['READINESS_PROVIDER_ERROR'])
    assert.match(report.blockers[0].detail, /createDb/)
    assert.doesNotMatch(JSON.stringify(report), /topsecret|postgres|db\.internal|5432/)
  })

  it('P1-2 (CLI): an injected createDb that REJECTS asynchronously is caught, sanitized, and reported as JSON with exit 1', async () => {
    const prints: string[] = []
    const code = await runVerifyCleanStartReadiness({
      argv: [],
      createDb: async () => {
        throw new Error('auth rejected: password hunter2 via smtp://mail:secretword@relay.internal')
      },
      print: (line) => prints.push(line),
    })
    assert.equal(code, 1)
    const report = JSON.parse(prints.join('\n')) as ReadinessReport
    assert.equal(report.ready, false)
    assert.deepEqual(report.blockers.map((b) => b.code), ['READINESS_PROVIDER_ERROR'])
    assert.match(report.blockers[0].detail, /createDb/)
    assert.doesNotMatch(JSON.stringify(report), /hunter2|secretword|smtp|relay\.internal/)
  })

  it('P2-1 (library): validates and assesses zero independently per phase — malformed phases never suppress valid zero blockers and never get root blockers', async () => {
    const report = await verifyCleanStartReadiness(
      makeDb({}, { REQUEST: 0, SOLUTION: Number.NaN, FINAL: 0 } as unknown as PhaseCounts),
    )
    assert.equal(report.ready, false)
    assert.deepEqual(report.blockers.map((b) => b.code), [
      ROOT_DEFAULT_ROUTES_REQUIRED, 'PUBLISHED_ROUTE_COUNTS_INVALID', ROOT_DEFAULT_ROUTES_REQUIRED,
    ])
    assert.match(report.blockers[0].detail, /REQUEST/)
    assert.match(report.blockers[1].detail, /SOLUTION/)
    assert.match(report.blockers[2].detail, /FINAL/)
  })

  it('P2-2 (CLI): help never overrides unknown arguments — every argument is validated first, both orders fail closed with no construction', async () => {
    for (const argv of [['--bogus', '--help'], ['--help', '--bogus']]) {
      let constructed = 0
      const prints: string[] = []
      const code = await runVerifyCleanStartReadiness({
        argv,
        createDb: () => {
          constructed += 1
          throw new Error('database client must not be constructed for a usage error')
        },
        print: (line) => prints.push(line),
      })
      assert.equal(code, 1, argv.join(' '))
      assert.equal(constructed, 0, argv.join(' '))
      assert.ok(prints.some((line) => /unknown argument: --bogus/i.test(line)))
      assert.ok(prints.some((line) => /usage/i.test(line)))
    }
  })
})
