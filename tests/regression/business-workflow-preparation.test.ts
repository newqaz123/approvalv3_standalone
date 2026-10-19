import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildNormalApprovalInstance, type ApprovalEngineDb, type PhaseOrigin } from '@/lib/approval-engine/plan'
import { resolvePublishedApprovalRoute } from '@/lib/approval-routes/selection'
import {
  BUSINESS_POSITIONS,
  BUSINESS_ROUTE_CONFIGURATION_NAMES,
  BUSINESS_UNITS,
  createBusinessWorkflowFixture,
  type BusinessRouteConfigurationName,
} from '../support/business-workflow-fixture'
import {
  assertOwnedLoopbackDatabaseTarget,
  assertPortIsFree,
  cleanupOwnedRuntime,
  createFailClosedMailCapture,
  createFailClosedMailCapturePlan,
  createFailClosedMailTransportOptions,
  createSafeRunPlan,
  runWithOwnedCleanup,
  type OwnedDisposableResource,
} from '../support/business-workflow-safety'

const fixture = createBusinessWorkflowFixture()
const resource: OwnedDisposableResource = {
  runId: 'business-test-run-1',
  containerName: 'business-test-run-1-postgres',
  databaseName: 'app_cleanstart_dev',
  databasePort: 55432,
  serverPort: 3150,
}
const databaseUrl = 'postgresql://preflight:run-local-password@127.0.0.1:55432/app_cleanstart_dev?schema=public'
const mailPlan = createFailClosedMailCapturePlan({ host: '127.0.0.1', port: 2525, fallbackTransport: 'DISABLED' })

function configuration(name: BusinessRouteConfigurationName) {
  return fixture.routeConfigurations[name]
}

function pathForPhase(phase: 'REQUEST' | 'SOLUTION' | 'FINAL') {
  return phase === 'SOLUTION' ? fixture.paths.engineerA : fixture.paths.requesterA
}

function originForPhase(phase: 'REQUEST' | 'SOLUTION' | 'FINAL', path = pathForPhase(phase)): PhaseOrigin {
  return {
    phase,
    originUserId: path.originUserId,
    originUnitId: path.unitId,
    path,
    requestId: 'request-business-1',
    source: phase === 'REQUEST' ? 'REQUESTER' : phase === 'SOLUTION' ? 'SOLUTION_SUBMITTER' : 'FINAL_INITIATOR',
  }
}

function dbFor(name: BusinessRouteConfigurationName, phase: 'REQUEST' | 'SOLUTION' | 'FINAL', originPath = pathForPhase(phase)): ApprovalEngineDb {
  const path = originPath
  const routes = configuration(name).routes
  const ownTeamAssignments = Object.values(fixture.actors)
    .map((actor) => actor.assignment)
    .filter((assignment): assignment is NonNullable<typeof assignment> => assignment !== null && assignment.teamId === path.teamId)
  return {
    async resolvePhaseOrigin() {
      return originForPhase(phase, path)
    },
    async resolvePublishedRoute(ctx) {
      return resolvePublishedApprovalRoute(ctx, {
        async loadOriginPath() {
          return path
        },
        async loadRoutes() {
          return [...routes]
        },
        async loadPositions() {
          return [...fixture.positions]
        },
      })
    },
    async loadPositions() {
      return [...fixture.positions]
    },
    async loadOwnTeamActiveAssignments() {
      return ownTeamAssignments
    },
    async findStepCandidates({ requiredPositionId }) {
      // Realistic account lookup: every account holding exactly the requested
      // position, with its real activity flag. The engine intersects this with
      // structural selection (own team + reporting path) and drops inactive
      // accounts, so a position with only inactive holders stays vacant.
      return Object.values(fixture.actors)
        .filter((actor) => actor.assignment?.positionId === requiredPositionId)
        .map((actor) => ({ id: actor.id, isActive: actor.isActive }))
    },
  }
}

describe('business workflow test-only fixture routes', () => {
  it('defines named actors, Production 1 request scope, Engineering solution capability, and no Director', () => {
    assert.equal(fixture.id, 'business-workflow-test-only')
    assert.equal(fixture.units.find((unit) => unit.id === BUSINESS_UNITS.productionSection)?.name, 'Production 1 Section')
    assert.equal(fixture.units.find((unit) => unit.id === BUSINESS_UNITS.engineeringSection)?.canWorkOnSolutions, true)
    assert.equal(fixture.units.find((unit) => unit.id === BUSINESS_UNITS.productionSection)?.canWorkOnSolutions, false)
    assert.equal(fixture.positions.some((position) => position.name === 'Director'), false)
    assert.ok(fixture.actors.requesterA.assignment)
    assert.ok(fixture.actors.staffB.assignment)
    assert.equal(fixture.actors.admin.role, 'ADMIN')
    assert.equal(fixture.actors.unassignedUser.assignment, null)
  })

  it('publishes exactly the four approved default/exception route configurations with explicit route identity and ordered steps', async () => {
    const supervisor = BUSINESS_POSITIONS.supervisor
    const sectionManager = BUSINESS_POSITIONS.sectionManager
    const departmentManager = BUSINESS_POSITIONS.departmentManager
    const requestSteps = [
      [1, supervisor], [2, sectionManager], [3, departmentManager],
    ] as const
    const finalDefaultSteps = [
      [1, sectionManager], [2, departmentManager],
    ] as const
    assert.deepEqual(BUSINESS_ROUTE_CONFIGURATION_NAMES, [
      'all-defaults',
      'solution-exception',
      'final-exception',
      'solution-and-final-exceptions',
    ])
    for (const name of BUSINESS_ROUTE_CONFIGURATION_NAMES) {
      const config = configuration(name)
      const request = await resolvePublishedApprovalRoute({
        phase: 'REQUEST', originUserId: fixture.paths.requesterA.originUserId, originUnitId: fixture.paths.requesterA.unitId, requestId: 'request-1',
      }, {
        loadOriginPath: async () => fixture.paths.requesterA,
        loadRoutes: async () => [...config.routes],
        loadPositions: async () => [...fixture.positions],
      })
      const solution = await resolvePublishedApprovalRoute({
        phase: 'SOLUTION', originUserId: fixture.paths.engineerA.originUserId, originUnitId: fixture.paths.engineerA.unitId, requestId: 'request-1',
      }, {
        loadOriginPath: async () => fixture.paths.engineerA,
        loadRoutes: async () => [...config.routes],
        loadPositions: async () => [...fixture.positions],
      })
      const final = await resolvePublishedApprovalRoute({
        phase: 'FINAL', originUserId: fixture.paths.requesterA.originUserId, originUnitId: fixture.paths.requesterA.unitId, requestId: 'request-1',
      }, {
        loadOriginPath: async () => fixture.paths.requesterA,
        loadRoutes: async () => [...config.routes],
        loadPositions: async () => [...fixture.positions],
      })
      const solutionException = config.expectedSources.SOLUTION === 'UNIT_EXCEPTION'
      const finalException = config.expectedSources.FINAL === 'UNIT_EXCEPTION'
      assert.equal(request.id, `${name}-request-default`)
      assert.equal(request.scopeUnitId, BUSINESS_UNITS.company)
      assert.deepEqual(request.steps.map((step) => [step.order, step.positionId]), requestSteps)
      assert.equal(solution.id, solutionException ? `${name}-solution-exception` : `${name}-solution-default`)
      assert.equal(solution.scopeUnitId, solutionException ? BUSINESS_UNITS.engineeringSection : BUSINESS_UNITS.company)
      assert.deepEqual(
        solution.steps.map((step) => [step.order, step.positionId]),
        solutionException
          ? [[1, sectionManager], [2, departmentManager]] as const
          : requestSteps,
      )
      assert.equal(final.id, finalException ? `${name}-final-exception` : `${name}-final-default`)
      assert.equal(final.scopeUnitId, finalException ? BUSINESS_UNITS.productionSection : BUSINESS_UNITS.company)
      assert.deepEqual(
        final.steps.map((step) => [step.order, step.positionId]),
        finalException
          ? [[1, departmentManager]] as const
          : finalDefaultSteps,
      )
    }
  })

  it('builds real approval plans with rank skipping and vacant-step behavior', async () => {
    const supervisor = BUSINESS_POSITIONS.supervisor
    const sectionManager = BUSINESS_POSITIONS.sectionManager
    const departmentManager = BUSINESS_POSITIONS.departmentManager

    const defaults = configuration('all-defaults')
    const staffRequest = await buildNormalApprovalInstance(dbFor(defaults.name, 'REQUEST'), {
      requestId: 'request-business-1', phase: 'REQUEST', originUserId: fixture.paths.requesterA.originUserId,
    })
    assert.equal(staffRequest.state, 'PENDING')
    assert.equal(staffRequest.routeVersionId, 'all-defaults-request-default')
    assert.deepEqual(staffRequest.steps, [
      {
        order: 1,
        requiredPositionId: supervisor,
        scopeUnitId: BUSINESS_UNITS.company,
        candidateUserIds: ['user-supervisor-p', 'user-second-approver'],
      },
      {
        order: 2,
        requiredPositionId: sectionManager,
        scopeUnitId: BUSINESS_UNITS.company,
        candidateUserIds: ['user-section-manager-p'],
      },
      {
        order: 3,
        requiredPositionId: departmentManager,
        scopeUnitId: BUSINESS_UNITS.company,
        candidateUserIds: ['user-department-manager'],
      },
    ])
    assert.deepEqual(staffRequest.skipped, [])

    const supervisorRequest = await buildNormalApprovalInstance(dbFor(defaults.name, 'REQUEST', fixture.paths.supervisorP), {
      requestId: 'request-business-2', phase: 'REQUEST', originUserId: fixture.paths.supervisorP.originUserId,
    })
    assert.deepEqual(supervisorRequest.steps, [
      {
        order: 2,
        requiredPositionId: sectionManager,
        scopeUnitId: BUSINESS_UNITS.company,
        candidateUserIds: ['user-section-manager-p'],
      },
      {
        order: 3,
        requiredPositionId: departmentManager,
        scopeUnitId: BUSINESS_UNITS.company,
        candidateUserIds: ['user-department-manager'],
      },
    ])
    assert.deepEqual(supervisorRequest.skipped, [])

    const defaultSolution = await buildNormalApprovalInstance(dbFor(defaults.name, 'SOLUTION'), {
      requestId: 'request-business-5', solutionId: 'solution-business-2', phase: 'SOLUTION', originUserId: fixture.paths.engineerA.originUserId,
    })
    assert.equal(defaultSolution.routeVersionId, 'all-defaults-solution-default')
    assert.deepEqual(defaultSolution.steps, [
      {
        order: 1,
        requiredPositionId: supervisor,
        scopeUnitId: BUSINESS_UNITS.company,
        candidateUserIds: ['user-supervisor-e'],
      },
      {
        order: 2,
        requiredPositionId: sectionManager,
        scopeUnitId: BUSINESS_UNITS.company,
        candidateUserIds: ['user-section-manager-e'],
      },
      {
        order: 3,
        requiredPositionId: departmentManager,
        scopeUnitId: BUSINESS_UNITS.company,
        candidateUserIds: ['user-department-manager'],
      },
    ])
    assert.deepEqual(defaultSolution.skipped, [])

    const customSolution = await buildNormalApprovalInstance(dbFor('solution-exception', 'SOLUTION'), {
      requestId: 'request-business-3', solutionId: 'solution-business-1', phase: 'SOLUTION', originUserId: fixture.paths.engineerA.originUserId,
    })
    assert.equal(customSolution.routeVersionId, 'solution-exception-solution-exception')
    assert.deepEqual(customSolution.steps, [
      {
        order: 1,
        requiredPositionId: sectionManager,
        scopeUnitId: BUSINESS_UNITS.engineeringSection,
        candidateUserIds: ['user-section-manager-e'],
      },
      {
        order: 2,
        requiredPositionId: departmentManager,
        scopeUnitId: BUSINESS_UNITS.engineeringSection,
        candidateUserIds: ['user-department-manager'],
      },
    ])
    assert.deepEqual(customSolution.skipped, [])

    const customFinal = await buildNormalApprovalInstance(dbFor('final-exception', 'FINAL'), {
      requestId: 'request-business-4', phase: 'FINAL', originUserId: fixture.paths.requesterA.originUserId,
    })
    assert.equal(customFinal.routeVersionId, 'final-exception-final-exception')
    assert.deepEqual(customFinal.steps, [
      {
        order: 1,
        requiredPositionId: departmentManager,
        scopeUnitId: BUSINESS_UNITS.productionSection,
        candidateUserIds: ['user-department-manager'],
      },
    ])
    assert.deepEqual(customFinal.skipped, [])
  })

  it('skips a vacant supervisor step but keeps the remaining eligible route steps', async () => {
    const plan = await buildNormalApprovalInstance(dbFor('all-defaults', 'REQUEST', fixture.paths.staffVacantSup), {
      requestId: 'request-business-6', phase: 'REQUEST', originUserId: fixture.paths.staffVacantSup.originUserId,
    })
    assert.equal(plan.state, 'PENDING')
    assert.deepEqual(plan.skipped, [
      { requiredPositionId: BUSINESS_POSITIONS.supervisor, reason: 'VACANT_POSITION' },
    ])
    assert.deepEqual(plan.steps.map((step) => [step.order, step.requiredPositionId, step.candidateUserIds]), [
      [2, BUSINESS_POSITIONS.sectionManager, ['user-section-manager-p']],
      [3, BUSINESS_POSITIONS.departmentManager, ['user-department-manager']],
    ])
  })

  it('completes with no eligible steps when every published position is vacant', async () => {
    const plan = await buildNormalApprovalInstance(dbFor('all-defaults', 'REQUEST', fixture.paths.staffVacantAll), {
      requestId: 'request-business-7', phase: 'REQUEST', originUserId: fixture.paths.staffVacantAll.originUserId,
    })
    assert.equal(plan.state, 'COMPLETED_NO_ELIGIBLE_STEPS')
    assert.equal(plan.completionReason, 'NO_ELIGIBLE_APPROVAL_STEPS')
    assert.equal(plan.steps.length, 0)
    assert.deepEqual(plan.skipped, [
      { requiredPositionId: BUSINESS_POSITIONS.supervisor, reason: 'VACANT_POSITION' },
      { requiredPositionId: BUSINESS_POSITIONS.sectionManager, reason: 'VACANT_POSITION' },
      { requiredPositionId: BUSINESS_POSITIONS.departmentManager, reason: 'VACANT_POSITION' },
    ])
  })
})

describe('business workflow safe-run prerequisites', () => {
  it('accepts only an explicit owned loopback database target and fail-closed mail plan', () => {
    assertOwnedLoopbackDatabaseTarget(databaseUrl, resource)
    const run = createSafeRunPlan({ databaseUrl, resource, mail: mailPlan })
    assert.equal(run.testBaseUrl, 'http://127.0.0.1:3150')
    assert.throws(() => createSafeRunPlan({ databaseUrl, resource, ambientDatabaseUrl: databaseUrl, mail: mailPlan }), /ambient DATABASE_URL/)
    assert.throws(() => assertOwnedLoopbackDatabaseTarget('postgresql://u:p@db:55432/app_cleanstart_dev', resource), /loopback/)
    assert.throws(() => assertOwnedLoopbackDatabaseTarget('postgresql://u:p@127.0.0.1:55432/app_db', resource), /owned disposable|protected/)
  })

  it('refuses an existing server port before any future launch', async () => {
    await assertPortIsFree(3150, async () => false)
    await assert.rejects(() => assertPortIsFree(3150, async () => true), /already-listening\/shared/)
  })

  it('cleans only the exact recorded server PID and container identity', async () => {
    const calls: string[] = []
    await cleanupOwnedRuntime({ ...resource, serverPid: 41234 }, {
      inspectServerPid: async () => 41234,
      stopServer: async (pid) => { calls.push(`stop:${pid}`) },
      inspectContainerName: async () => resource.containerName,
      removeContainer: async (name) => { calls.push(`remove:${name}`) },
    })
    assert.deepEqual(calls, ['stop:41234', `remove:${resource.containerName}`])
    await assert.rejects(() => cleanupOwnedRuntime({ ...resource, serverPid: 41234 }, {
      inspectServerPid: async () => 999,
      stopServer: async () => undefined,
      inspectContainerName: async () => resource.containerName,
      removeContainer: async () => undefined,
    }), /unowned|changed/)
  })

  it('runs failure cleanup through the exact ownership guard', async () => {
    const calls: string[] = []
    await assert.rejects(() => runWithOwnedCleanup({ ...resource, serverPid: 41235 }, {
      inspectServerPid: async () => 41235,
      stopServer: async (pid) => { calls.push(`stop:${pid}`) },
      inspectContainerName: async () => resource.containerName,
      removeContainer: async (name) => { calls.push(`remove:${name}`) },
    }, async () => {
      throw new Error('future runner failure')
    }), /future runner failure/)
    assert.deepEqual(calls, ['stop:41235', `remove:${resource.containerName}`])
  })

  it('captures mail in-memory and never permits a fallback transport', () => {
    const capture = createFailClosedMailCapture(mailPlan)
    assert.deepEqual(createFailClosedMailTransportOptions(mailPlan), {
      host: '127.0.0.1', port: 2525, secure: false, fallbackTransport: 'DISABLED',
    })
    capture.capture({ to: 'candidate@example.test', subject: 'approval_needed', requestReference: 'request-business-1' })
    assert.equal(capture.messages.length, 1)
    assert.throws(() => createFailClosedMailCapturePlan({ host: 'smtp.example.com', port: 2525, fallbackTransport: 'DISABLED' }), /loopback/)
    assert.throws(() => createFailClosedMailCapturePlan({ host: '127.0.0.1', port: 2525 }), /disabled/)
  })
})
