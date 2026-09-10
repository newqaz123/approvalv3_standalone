/**
 * Task 6: admin route publication + route preview.
 *
 * Layer 1: source contracts from the task brief (admin-only publication,
 * explicit positions, ceiling, preview, and no financial route conditions).
 * Layer 2: behavioral tests executing the REAL src/server-actions/
 * approval-routes.ts through the transpile+vm harness in
 * tests/fixtures/approval-route-admin-harness.ts (real route validation,
 * nearest-scope resolution, and production candidate pools; strict in-memory
 * Prisma fake enforcing the Task 2 unique constraints).
 * Layer 3: structural UI contracts for the admin route editor, step list,
 * and preview components.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ROUTE_SCENARIO,
  UnexpectedWriteError,
  createRouteScenarioHarness,
  routeDefinitionInput,
  standardPublishedRoutes,
} from '../fixtures/approval-route-admin-harness'

const read = (path: string) => readFileSync(path, 'utf8')

// ---------------------------------------------------------------------------
// Layer 1: brief source contracts
// ---------------------------------------------------------------------------

describe('approval route admin contracts', () => {
  it('requires admin-only publication, explicit positions, a ceiling, and a preview', () => {
    const source = read('src/server-actions/approval-routes.ts')
    assert.match(source, /publishApprovalRoute/)
    assert.match(source, /requireAdmin/)
    assert.match(source, /maximumPositionLevel/)
    assert.match(source, /previewApprovalRoute/)
  })

  it('does not authorize financial route conditions', () => {
    const source = read('src/server-actions/approval-routes.ts')
    assert.doesNotMatch(source, /amount|budget|cost|threshold/i)
  })
})

// ---------------------------------------------------------------------------
// Layer 2: behavioral action tests (real module via harness)
// ---------------------------------------------------------------------------

describe('approval route admin guard', () => {
  it('rejects draft save, publish, and preview for non-admin actors before any write', async () => {
    const harness = createRouteScenarioHarness({ publishedRoutes: standardPublishedRoutes() })
    harness.state.adminId = null

    await assert.rejects(
      () => harness.actions.saveApprovalRouteDraft(routeDefinitionInput()),
      /admin/i,
    )
    await assert.rejects(
      () => harness.actions.publishApprovalRoute(routeDefinitionInput()),
      /admin/i,
    )
    await assert.rejects(
      () =>
        harness.actions.previewApprovalRoute({
          scopeUnitId: ROUTE_SCENARIO.sectionOneId,
          phase: 'REQUEST',
          originUserId: ROUTE_SCENARIO.staffOneId,
        }),
      /admin/i,
    )
    assert.equal(harness.db.writes.length, 0)
  })
})

describe('approval route write validation', () => {
  it('rejects an unknown or non-scope unit before any write', async () => {
    const harness = createRouteScenarioHarness()
    await assert.rejects(
      () => harness.actions.saveApprovalRouteDraft(routeDefinitionInput({ scopeUnitId: 'unit-unknown' })),
      (error: unknown) => {
        assert.match((error as Error).message, /valid route scope/)
        return true
      },
    )
    assert.equal(harness.db.writes.length, 0)
  })

  it('rejects an invalid phase before any write', async () => {
    const harness = createRouteScenarioHarness()
    await assert.rejects(
      () => harness.actions.saveApprovalRouteDraft(routeDefinitionInput({ phase: 'WEEKLY' })),
      /valid approval phase/,
    )
    assert.equal(harness.db.writes.length, 0)
  })

  it('rejects a non-ascending position order, a ceiling violation, and duplicates before any write', async () => {
    const harness = createRouteScenarioHarness()

    await assert.rejects(
      () =>
        harness.actions.publishApprovalRoute(
          routeDefinitionInput({
            steps: [
              { order: 1, position: 'DEPARTMENT_MANAGER' },
              { order: 2, position: 'SECTION_MANAGER' },
            ],
          }),
        ),
      /strictly ascending/,
    )

    await assert.rejects(
      () =>
        harness.actions.publishApprovalRoute(
          routeDefinitionInput({
            maximumPositionLevel: 4,
            steps: [{ order: 1, position: 'FACTORY_MANAGER' }],
          }),
        ),
      /exceeds the configured ceiling/,
    )

    await assert.rejects(
      () =>
        harness.actions.publishApprovalRoute(
          routeDefinitionInput({
            steps: [
              { order: 1, position: 'SUPERVISOR' },
              { order: 2, position: 'SUPERVISOR' },
            ],
          }),
        ),
      /Duplicate route position/,
    )

    assert.equal(harness.db.writes.length, 0)
    assert.equal(harness.db.tableRows('approval_route_versions').size, 0)
    assert.equal(harness.db.tableRows('approval_route_steps').size, 0)
  })
})

describe('saveApprovalRouteDraft', () => {
  it('creates an immutable draft version without retiring the published route', async () => {
    const harness = createRouteScenarioHarness({ publishedRoutes: standardPublishedRoutes() })

    const saved = (await harness.actions.saveApprovalRouteDraft(routeDefinitionInput())) as {
      id: string
      scopeUnitId: string
      phase: string
      version: number
      maximumPositionLevel: number
      status: string
      steps: Array<{ order: number; position: string }>
    }

    assert.equal(saved.scopeUnitId, ROUTE_SCENARIO.sectionOneId)
    assert.equal(saved.phase, 'REQUEST')
    assert.equal(saved.status, 'DRAFT')
    // Version numbering counts every version row for the scope/phase.
    assert.equal(saved.version, 2)
    assert.deepEqual(
      [...saved.steps].map((step) => [step.order, step.position]),
      [
        [1, 'SUPERVISOR'],
        [2, 'SECTION_MANAGER'],
      ],
    )

    const rows = [...harness.db.tableRows('approval_route_versions').values()]
    const published = rows.find((row) => row.id === ROUTE_SCENARIO.publishedRouteSectionOneId)
    assert.equal(published?.status, 'PUBLISHED', 'published route must never be touched by a draft save')
    const draft = rows.find((row) => row.id === saved.id)
    assert.equal(draft?.status, 'DRAFT')
    assert.equal(draft?.createdById, ROUTE_SCENARIO.adminId)
    assert.equal(draft?.publishedAt, null)

    const stepRows = [...harness.db.tableRows('approval_route_steps').values()].filter(
      (row) => row.routeVersionId === saved.id,
    )
    assert.deepEqual(
      stepRows.map((row) => [row.stepOrder, row.positionCode]),
      [
        [1, 'SUPERVISOR'],
        [2, 'SECTION_MANAGER'],
      ],
    )

    // A draft save must never run a retiring update.
    assert.ok(
      !harness.db.writes.some(
        (write) => write.op === 'updateMany' && write.count !== 0,
      ),
    )
    assert.deepEqual(harness.state.revalidatedPaths, ['/admin/routes'])
  })
})

describe('publishApprovalRoute', () => {
  it('publishes version 1 with no prior published route and nothing to retire', async () => {
    const harness = createRouteScenarioHarness()

    const published = (await harness.actions.publishApprovalRoute(routeDefinitionInput())) as {
      version: number
      status: string
    }

    assert.equal(published.version, 1)
    assert.equal(published.status, 'PUBLISHED')
    const row = [...harness.db.tableRows('approval_route_versions').values()].find(
      (entry) => entry.id !== undefined && entry.version === 1,
    )
    assert.equal(row?.status, 'PUBLISHED')
    // Dates are created inside the vm realm: compare structurally, not by
    // instanceof.
    assert.ok(
      row?.publishedAt != null && typeof (row.publishedAt as Date).getTime === 'function',
      'publishedAt must be set on publish',
    )
    assert.ok(
      !harness.db.writes.some(
        (write) => write.op === 'updateMany' && write.count !== 0,
      ),
      'publishing with no prior published route must not retire any row',
    )
  })

  it('retires the current published version and inserts the new published version in one transaction', async () => {
    const harness = createRouteScenarioHarness({ publishedRoutes: standardPublishedRoutes() })

    const published = (await harness.actions.publishApprovalRoute(
      routeDefinitionInput({
        steps: [
          { order: 1, position: 'SUPERVISOR' },
          { order: 2, position: 'DEPARTMENT_MANAGER' },
        ],
      }),
    )) as { id: string; version: number; status: string }

    assert.equal(published.version, 2)
    assert.equal(published.status, 'PUBLISHED')

    const rows = [...harness.db.tableRows('approval_route_versions').values()]
    const retired = rows.find((row) => row.id === ROUTE_SCENARIO.publishedRouteSectionOneId)
    assert.equal(retired?.status, 'RETIRED', 'the previous published version is retired, never edited in place')
    const live = rows.filter(
      (row) => row.status === 'PUBLISHED' && row.scopeUnitId === ROUTE_SCENARIO.sectionOneId && row.phase === 'REQUEST',
    )
    assert.equal(live.length, 1)
    assert.equal(live[0]?.id, published.id)
    assert.equal(live[0]?.version, 2)

    const retire = harness.db.writes.find(
      (write) => write.model === 'approval_route_versions' && write.op === 'updateMany',
    )
    assert.deepEqual(retire?.where, {
      scopeUnitId: ROUTE_SCENARIO.sectionOneId,
      phase: 'REQUEST',
      status: 'PUBLISHED',
    })
    assert.deepEqual(retire?.data, { status: 'RETIRED' })

    const stepRows = [...harness.db.tableRows('approval_route_steps').values()].filter(
      (row) => row.routeVersionId === published.id,
    )
    assert.deepEqual(
      stepRows.map((row) => [row.stepOrder, row.positionCode]),
      [
        [1, 'SUPERVISOR'],
        [2, 'DEPARTMENT_MANAGER'],
      ],
    )
  })

  it('surfaces the partial unique index violation and rolls back so the previous published version survives', async () => {
    const harness = createRouteScenarioHarness({ publishedRoutes: standardPublishedRoutes() })
    const s = ROUTE_SCENARIO

    // A competing publisher commits while the first transaction is in
    // flight: the fake enforces approval_routes_one_published_scope_phase,
    // so the first publisher's insert must fail and roll back.
    harness.db.onRouteVersionWrite = () => {
      harness.db.commitConcurrently((concurrent) => {
        void concurrent.approval_route_versions.updateMany({
          where: { scopeUnitId: s.sectionOneId, phase: 'REQUEST', status: 'PUBLISHED' },
          data: { status: 'RETIRED' },
        })
        void concurrent.approval_route_versions.create({
          data: {
            scopeUnitId: s.sectionOneId,
            phase: 'REQUEST',
            version: 2,
            maximumPositionLevel: 4,
            status: 'PUBLISHED',
            createdById: 'concurrent-admin',
            publishedAt: new Date('2026-09-07T00:00:00Z'),
          },
        })
      })
    }

    await assert.rejects(
      () =>
        harness.actions.publishApprovalRoute(
          routeDefinitionInput({
            steps: [{ order: 1, position: 'SECTION_MANAGER' }],
          }),
        ),
      (error: unknown) => {
        assert.match((error as Error).message, /PUBLISHED route|already exists/)
        return true
      },
    )

    const scopeRows = [...harness.db.tableRows('approval_route_versions').values()].filter(
      (row) => row.scopeUnitId === s.sectionOneId,
    )
    assert.equal(scopeRows.length, 2, 'the rolled-back publisher must not leave a version row behind')
    const previous = scopeRows.find((row) => row.id === s.publishedRouteSectionOneId)
    assert.equal(previous?.status, 'RETIRED', 'only the winning publisher retires the previous version')
    const live = scopeRows.filter((row) => row.status === 'PUBLISHED')
    assert.equal(live.length, 1, 'exactly one published route survives the conflict')
    assert.equal(live[0]?.version, 2)
    assert.equal(live[0]?.createdById, 'concurrent-admin')
  })
})

describe('previewApprovalRoute', () => {
  it('resolves the nearest published scope and computes per-step candidate counts, names, and ceiling without writing', async () => {
    const harness = createRouteScenarioHarness({ publishedRoutes: standardPublishedRoutes(), failOnWrite: true })

    const preview = (await harness.actions.previewApprovalRoute({
      scopeUnitId: ROUTE_SCENARIO.sectionOneId,
      phase: 'REQUEST',
      originUserId: ROUTE_SCENARIO.staffOneId,
    })) as {
      routeVersionId: string
      scopeUnitId: string
      phase: string
      maximumPositionLevel: number
      autoApproved: boolean
      steps: Array<{
        order: number
        position: string
        candidateCount: number
        candidates: Array<{ id: string; name: string }>
        skipped: boolean
        skipReason?: string
      }>
    }

    assert.equal(preview.routeVersionId, ROUTE_SCENARIO.publishedRouteSectionOneId)
    assert.equal(preview.scopeUnitId, ROUTE_SCENARIO.sectionOneId, 'the origin section is the nearest scope')
    assert.equal(preview.phase, 'REQUEST')
    assert.equal(preview.maximumPositionLevel, 4)
    assert.equal(preview.autoApproved, false)
    assert.deepEqual(
      [...preview.steps].map((step) => [
        step.order,
        step.position,
        step.candidateCount,
        [...step.candidates].map((candidate) => candidate.id),
        step.skipped,
        step.skipReason,
      ]),
      [
        [1, 'SUPERVISOR', 1, [ROUTE_SCENARIO.supervisorOneId], false, undefined],
        [2, 'SECTION_MANAGER', 1, [ROUTE_SCENARIO.sectionManagerOneId], false, undefined],
        [3, 'DEPARTMENT_MANAGER', 1, [ROUTE_SCENARIO.departmentManagerOneId], false, undefined],
      ],
    )
    assert.equal(preview.steps[0]?.candidates[0]?.name, 'Fitting Supervisor')

    // Read-only: no route, instance, or candidate-group writes at all.
    assert.equal(harness.db.writes.length, 0)
  })

  it('falls back to the nearest ancestor scope and flags vacant positions as runtime skips', async () => {
    const harness = createRouteScenarioHarness({ publishedRoutes: standardPublishedRoutes(), failOnWrite: true })

    const preview = (await harness.actions.previewApprovalRoute({
      scopeUnitId: ROUTE_SCENARIO.sectionTwoId,
      phase: 'REQUEST',
      originUserId: ROUTE_SCENARIO.staffTwoId,
    })) as {
      routeVersionId: string
      scopeUnitId: string
      steps: Array<{ position: string; candidateCount: number; skipped: boolean; skipReason?: string }>
    }

    // Section two has no published route: the department scope wins.
    assert.equal(preview.routeVersionId, ROUTE_SCENARIO.publishedRouteDepartmentId)
    assert.equal(preview.scopeUnitId, ROUTE_SCENARIO.departmentId)
    assert.deepEqual(
      [...preview.steps].map((step) => [step.position, step.candidateCount, step.skipped, step.skipReason]),
      [
        ['SECTION_MANAGER', 0, true, 'VACANT_POSITION'],
        ['DEPARTMENT_MANAGER', 1, false, undefined],
      ],
    )
    assert.equal(harness.db.writes.length, 0)
  })

  it('auto-approves an origin at or above the ceiling with zero steps', async () => {
    const harness = createRouteScenarioHarness({ publishedRoutes: standardPublishedRoutes(), failOnWrite: true })

    const preview = (await harness.actions.previewApprovalRoute({
      scopeUnitId: ROUTE_SCENARIO.departmentId,
      phase: 'REQUEST',
      originUserId: ROUTE_SCENARIO.departmentManagerOneId,
    })) as { autoApproved: boolean; steps: unknown[]; maximumPositionLevel: number }

    assert.equal(preview.autoApproved, true)
    assert.equal(preview.steps.length, 0)
    assert.equal(preview.maximumPositionLevel, 4)
    assert.equal(harness.db.writes.length, 0)
  })

  it('drops positions at or below the origin exactly like the engine builder', async () => {
    const harness = createRouteScenarioHarness({ publishedRoutes: standardPublishedRoutes(), failOnWrite: true })

    const preview = (await harness.actions.previewApprovalRoute({
      scopeUnitId: ROUTE_SCENARIO.sectionOneId,
      phase: 'REQUEST',
      originUserId: ROUTE_SCENARIO.sectionManagerOneId,
    })) as { steps: Array<{ position: string }> }

    assert.deepEqual(
      [...preview.steps].map((step) => step.position),
      ['DEPARTMENT_MANAGER'],
    )
    assert.equal(harness.db.writes.length, 0)
  })

  it('previews a validated unsaved draft override instead of the stored published route', async () => {
    const harness = createRouteScenarioHarness({ publishedRoutes: standardPublishedRoutes(), failOnWrite: true })
    const s = ROUTE_SCENARIO

    const preview = (await harness.actions.previewApprovalRoute({
      scopeUnitId: s.sectionOneId,
      phase: 'REQUEST',
      originUserId: s.staffOneId,
      draft: {
        scopeUnitId: s.sectionOneId,
        phase: 'REQUEST',
        maximumPositionLevel: 6,
        steps: [
          { order: 1, position: 'SECTION_MANAGER' },
          { order: 2, position: 'DIVISION_MANAGER' },
          { order: 3, position: 'FACTORY_MANAGER' },
        ],
      },
    })) as {
      routeVersionId: string
      maximumPositionLevel: number
      steps: Array<{ position: string; candidateCount: number; skipped: boolean; skipReason?: string }>
    }

    assert.equal(preview.routeVersionId, 'DRAFT')
    assert.equal(preview.maximumPositionLevel, 6)
    assert.deepEqual(
      [...preview.steps].map((step) => [step.position, step.candidateCount, step.skipped, step.skipReason]),
      [
        ['SECTION_MANAGER', 1, false, undefined],
        // No division manager is staffed anywhere in the scenario.
        ['DIVISION_MANAGER', 0, true, 'VACANT_POSITION'],
        ['FACTORY_MANAGER', 1, false, undefined],
      ],
    )

    // The draft override is also auto-approval aware: a valid empty-route
    // draft whose ceiling sits at the origin's own position.
    const ceilingDraft = (await harness.actions.previewApprovalRoute({
      scopeUnitId: s.sectionOneId,
      phase: 'REQUEST',
      originUserId: s.staffOneId,
      draft: {
        scopeUnitId: s.sectionOneId,
        phase: 'REQUEST',
        maximumPositionLevel: 1,
        steps: [],
      },
    })) as { autoApproved: boolean; steps: unknown[] }
    assert.equal(ceilingDraft.autoApproved, true)
    assert.equal(ceilingDraft.steps.length, 0)

    // An invalid draft override is rejected by the same validator.
    await assert.rejects(
      () =>
        harness.actions.previewApprovalRoute({
          scopeUnitId: s.sectionOneId,
          phase: 'REQUEST',
          originUserId: s.staffOneId,
          draft: {
            scopeUnitId: s.sectionOneId,
            phase: 'REQUEST',
            maximumPositionLevel: 4,
            steps: [
              { order: 1, position: 'DEPARTMENT_MANAGER' },
              { order: 2, position: 'SECTION_MANAGER' },
            ],
          },
        }),
      /strictly ascending/,
    )

    assert.equal(harness.db.writes.length, 0)
  })

  it('rejects a preview for an origin without an unambiguous reporting branch', async () => {
    const harness = createRouteScenarioHarness({ publishedRoutes: standardPublishedRoutes(), failOnWrite: true })

    await assert.rejects(
      () =>
        harness.actions.previewApprovalRoute({
          scopeUnitId: ROUTE_SCENARIO.sectionOneId,
          phase: 'REQUEST',
          originUserId: 'user-ghost',
        }),
      /reporting branch/,
    )
    assert.equal(harness.db.writes.length, 0)
  })
})


// ---------------------------------------------------------------------------
// P1 fix-round: preview must run nearest-scope selection WITH the draft
// substituted in-memory, never skipping published selection.
// ---------------------------------------------------------------------------

describe('previewApprovalRoute nearest-scope selection with draft override', () => {
  const s = ROUTE_SCENARIO

  it('reports the nearer PUBLISHED section route when a department-scope draft is supplied (reviewer repro)', async () => {
    // Section one's REQUEST route is published. The editor draft targets the
    // department scope; the origin is section-one staff, whose nearest scope
    // is the section, so runtime would select the SECTION route — the preview
    // must report that route, not the farther department draft.
    const harness = createRouteScenarioHarness({ publishedRoutes: standardPublishedRoutes(), failOnWrite: true })

    const preview = (await harness.actions.previewApprovalRoute({
      scopeUnitId: s.departmentId,
      phase: 'REQUEST',
      originUserId: s.staffOneId,
      draft: {
        scopeUnitId: s.departmentId,
        phase: 'REQUEST',
        maximumPositionLevel: 6,
        steps: [{ order: 1, position: 'FACTORY_MANAGER' }],
      },
    })) as {
      routeVersionId: string
      scopeUnitId: string
      maximumPositionLevel: number
      steps: Array<{ order: number; position: string }>
    }

    assert.equal(preview.routeVersionId, s.publishedRouteSectionOneId, 'the nearer published section route wins')
    assert.equal(preview.scopeUnitId, s.sectionOneId)
    assert.equal(preview.maximumPositionLevel, 4, 'the winning route ceiling is reported, not the draft ceiling')
    assert.deepEqual(
      [...preview.steps].map((step) => [step.order, step.position]),
      [
        [1, 'SUPERVISOR'],
        [2, 'SECTION_MANAGER'],
        [3, 'DEPARTMENT_MANAGER'],
      ],
    )
    assert.equal(harness.db.writes.length, 0)

    // The read-only view really is armed: a direct write attempt rejects.
    await assert.rejects(
      () =>
        Promise.resolve().then(() =>
          (harness.prismaView.approval_route_versions as { create: (args: unknown) => Promise<unknown> }).create({ data: {} }),
        ),
      UnexpectedWriteError,
    )
  })

  it('keeps the DRAFT sentinel when the draft scope is itself the nearest scope', async () => {
    const harness = createRouteScenarioHarness({ publishedRoutes: standardPublishedRoutes(), failOnWrite: true })

    // Draft at the section scope: it substitutes the stored section route
    // in-memory and wins selection as the nearest scope.
    const preview = (await harness.actions.previewApprovalRoute({
      scopeUnitId: s.sectionOneId,
      phase: 'REQUEST',
      originUserId: s.staffOneId,
      draft: {
        scopeUnitId: s.sectionOneId,
        phase: 'REQUEST',
        maximumPositionLevel: 4,
        steps: [{ order: 1, position: 'SECTION_MANAGER' }],
      },
    })) as {
      routeVersionId: string
      scopeUnitId: string
      steps: Array<{ position: string; candidateCount: number }>
    }

    assert.equal(preview.routeVersionId, 'DRAFT')
    assert.equal(preview.scopeUnitId, s.sectionOneId)
    assert.deepEqual(
      [...preview.steps].map((step) => [step.position, step.candidateCount]),
      [['SECTION_MANAGER', 1]],
    )
    assert.equal(harness.db.writes.length, 0)
  })

  it('lets a draft at a nearer scope override a farther published route', async () => {
    // Only the department scope has a published route; the draft targets the
    // section (nearer on the origin branch), so the draft wins selection.
    const harness = createRouteScenarioHarness({
      publishedRoutes: standardPublishedRoutes().filter(
        (route) => route.id !== ROUTE_SCENARIO.publishedRouteSectionOneId,
      ),
      failOnWrite: true,
    })

    const preview = (await harness.actions.previewApprovalRoute({
      scopeUnitId: s.sectionOneId,
      phase: 'REQUEST',
      originUserId: s.staffOneId,
      draft: {
        scopeUnitId: s.sectionOneId,
        phase: 'REQUEST',
        maximumPositionLevel: 4,
        steps: [
          { order: 1, position: 'SUPERVISOR' },
          { order: 2, position: 'SECTION_MANAGER' },
        ],
      },
    })) as {
      routeVersionId: string
      scopeUnitId: string
      maximumPositionLevel: number
      steps: Array<{ position: string }>
    }

    assert.equal(preview.routeVersionId, 'DRAFT', 'the nearer draft outranks the farther published route')
    assert.equal(preview.scopeUnitId, s.sectionOneId)
    assert.equal(preview.maximumPositionLevel, 4)
    assert.deepEqual(
      [...preview.steps].map((step) => step.position),
      ['SUPERVISOR', 'SECTION_MANAGER'],
    )
    assert.equal(harness.db.writes.length, 0)
  })
})

// ---------------------------------------------------------------------------
// Layer 3: structural UI contracts
// ---------------------------------------------------------------------------

describe('admin route UI contracts', () => {
  const editor = read('src/components/admin/routes/RouteEditor.tsx')
  const stepList = read('src/components/admin/routes/RouteStepList.tsx')
  const preview = read('src/components/admin/routes/RoutePreview.tsx')
  const page = read('src/app/admin/organization/page.tsx')

  it('submits only the scope, phase, ceiling, and ordered position list', () => {
    assert.match(editor, /saveApprovalRouteDraft/)
    assert.match(editor, /publishApprovalRoute/)
    assert.match(editor, /scopeUnitId/)
    assert.match(editor, /phase/)
    assert.match(editor, /maximumPositionLevel/)
    assert.match(editor, /steps/)
    assert.match(editor, /RouteStepList/)
    assert.match(editor, /RoutePreview/)
  })

  it('rejects a downward drag reorder with a visible validation error instead of silently reordering', () => {
    assert.match(stepList, /DndContext/)
    assert.match(stepList, /useSortable/)
    assert.match(stepList, /onDragEnd/)
    assert.match(stepList, /strictly ascending/)
    assert.match(stepList, /role="alert"/)
    // The error is set and the invalid reorder is dropped before acceptance.
    assert.match(stepList, /setOrderError\(/)
    assert.match(stepList, /onReorder\(reordered\)/)
    assert.ok(
      stepList.indexOf('setOrderError(') < stepList.indexOf('onReorder(reordered)'),
      'validation must run before the reorder is accepted',
    )
  })

  it('previews candidate counts, names, vacant warnings, nearest scope, ceiling, and auto-approval', () => {
    assert.match(preview, /previewApprovalRoute/)
    assert.match(preview, /draft:/)
    assert.match(preview, /candidateCount/)
    assert.match(preview, /candidates/)
    assert.match(preview, /skipReason/)
    assert.match(preview, /VACANT_POSITION/)
    assert.match(preview, /autoApproved/)
    assert.match(preview, /maximumPositionLevel/)
    assert.match(preview, /scopeUnitId/)
  })

  it('exposes no amount, budget, threshold, candidate reassignment, or email controls', () => {
    for (const [name, source] of [
      ['RouteEditor', editor],
      ['RouteStepList', stepList],
      ['RoutePreview', preview],
      ['page', page],
    ] as const) {
      assert.doesNotMatch(source, /amount|budget|threshold|reassign/i, `${name} must not expose financial controls`)
      assert.doesNotMatch(source, /smtp|email/i, `${name} must not expose email configuration`)
    }
  })

  it('gates the organization workspace page behind the existing admin guard', () => {
    assert.match(page, /requireAdmin/)
    assert.match(page, /OrganizationWorkspace/)
    assert.match(page, /getOrganizationWorkspaceData/)
    assert.doesNotMatch(page, /RouteEditor/)
  })
})
