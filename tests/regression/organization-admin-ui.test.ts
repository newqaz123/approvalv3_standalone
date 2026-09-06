/**
 * Task 14: organization administration + labeled legacy hierarchy view.
 *
 * Layer 1: source contracts from the task brief (typed organization
 * controls, mapping status, no candidate reassignment, labeled legacy
 * hierarchy compatibility).
 * Layer 2: behavioral tests executing the REAL src/server-actions/
 * organization.ts and users.ts through the transpile+vm harness in
 * tests/fixtures/organization-admin-harness.ts (requireAdmin, parent
 * type/acyclicity, ambiguous primary, no pending-row mutation, Factory
 * Manager create with departmentId=null).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ADMIN_SCENARIO, createOrganizationAdminHarness } from '../fixtures/organization-admin-harness'

const read = (path: string) => readFileSync(path, 'utf8')

function snapshotPending(harness: ReturnType<typeof createOrganizationAdminHarness>) {
  return {
    instances: harness.db.snapshot('approval_instances'),
    requestApprovals: harness.db.snapshot('request_approvals'),
    solutionApprovals: harness.db.snapshot('solution_approvals'),
    candidateGroups: harness.db.snapshot('approval_candidate_groups'),
  }
}

function pendingWriteModels(harness: ReturnType<typeof createOrganizationAdminHarness>): string[] {
  return [...new Set(harness.db.writes.map((write) => write.model))].filter((model) =>
    ['approval_instances', 'request_approvals', 'solution_approvals', 'approval_candidate_groups'].includes(model),
  )
}

describe('organization admin UI contracts', () => {
  it('exposes typed organization, position, reporting-group, and mapping status controls', () => {
    const page = read('src/app/admin/organization/page.tsx')
    const editor = read('src/components/admin/organization/OrganizationEditor.tsx')
    assert.match(page, /getOrganizationAdminData/)
    assert.match(editor, /PositionAssignmentTable/)
    assert.match(editor, /ReportingGroupEditor/)
    assert.match(editor, /mapping/i)
  })

  it('does not expose candidate reassignment or old numeric drag mutation as the NEW editor', () => {
    const editor = read('src/components/admin/organization/OrganizationEditor.tsx')
    assert.doesNotMatch(editor, /reassignCandidate|candidate.*replacement/i)
    const legacy = read('src/app/admin/hierarchy/page.tsx')
    assert.match(legacy, /legacy|compatibility|readOnly/i)
  })

  it('links the organization page to route editing and preview', () => {
    const page = read('src/app/admin/organization/page.tsx')
    const editor = read('src/components/admin/organization/OrganizationEditor.tsx')
    assert.match(`${page}\n${editor}`, /\/admin\/routes/)
    assert.match(`${page}\n${editor}`, /preview/i)
  })

  it('keeps positions independent of system roles and shows explicit deactivation', () => {
    const table = read('src/components/admin/organization/PositionAssignmentTable.tsx')
    const tree = read('src/components/admin/organization/OrganizationUnitTree.tsx')
    assert.match(table, /role/)
    assert.match(table, /positionCode|Position/)
    assert.doesNotMatch(table, /reassignCandidate/)
    assert.match(tree, /isActive|Active/)
    assert.match(tree, /deactivat/i)
  })

  it('does not duplicate parent managers into descendant sections', () => {
    const groups = read('src/components/admin/organization/ReportingGroupEditor.tsx')
    assert.doesNotMatch(groups, /duplicate parent managers into sections/i)
    const actions = read('src/server-actions/organization.ts')
    assert.match(actions, /parent manager|section membership|does not match unit/i)
  })

  it('lets a NEW manager be created with a system role and parent-unit position, without legacy department or numeric level', () => {
    const form = read('src/components/admin/user-form.tsx')
    const users = read('src/server-actions/users.ts')
    assert.match(form, /FACTORY_MANAGER/)
    assert.match(form, /positionCode/)
    assert.match(form, /unitId/)
    assert.doesNotMatch(form, /AdditionalDepartmentsSection/)
    assert.match(users, /departmentId\?:\s*string\s*\|\s*null/)
    assert.match(users, /positionAssignment/)
  })

  it('does not require main or additional section selection for Factory Manager create', () => {
    const form = read('src/components/admin/user-form.tsx')
    const edit = read('src/components/admin/edit-user-dialog.tsx')
    assert.match(form, /FACTORY_MANAGER/)
    assert.doesNotMatch(form, /main section|additional section/i)
    assert.match(edit, /departmentId/)
    assert.match(edit, /AdditionalDepartmentsSection/)
  })

  it('shows typed unit/position for mapped users and a labeled legacy fallback otherwise', () => {
    const table = read('src/components/admin/user-table.tsx')
    assert.match(table, /positionCode|organizationAssignment/)
    assert.match(table, /legacy/i)
  })

  it('labels numeric levels and department_approvers as legacy compatibility, never as the six positions', () => {
    const page = read('src/app/admin/hierarchy/page.tsx')
    const actions = read('src/server-actions/hierarchy.ts')
    assert.match(page, /legacy compatibility/i)
    assert.match(page, /department_approvers/)
    assert.match(page, /numeric levels/i)
    assert.doesNotMatch(page, /Staff \(1\)[\s\S]*Factory Manager \(6\)/)
    assert.match(actions, /NEW organization/)
    assert.doesNotMatch(actions, /prisma\.organization_position_assignments/)
    assert.doesNotMatch(actions, /prisma\.approval_instances/)
    assert.doesNotMatch(actions, /prisma\.approval_candidate_groups/)
    assert.doesNotMatch(actions, /prisma\.approval_route/)
  })
})

describe('organization admin guard', () => {
  it('rejects every organization write for non-admin actors before any write', async () => {
    const harness = createOrganizationAdminHarness()
    harness.state.adminId = null

    await assert.rejects(() => harness.actions.createOrganizationUnit({
      name: 'Denied',
      unitType: 'FACTORY',
      parentId: null,
    }), /admin/i)
    await assert.rejects(() => harness.actions.updateOrganizationUnit({
      id: ADMIN_SCENARIO.factoryId,
      name: 'Denied',
      parentId: null,
      isActive: true,
    }), /admin/i)
    await assert.rejects(() => harness.actions.savePositionAssignment({
      userId: ADMIN_SCENARIO.staffOneId,
      unitId: ADMIN_SCENARIO.sectionOneId,
      positionCode: 'STAFF',
      reportingGroupId: null,
      isPrimary: true,
      isActive: true,
    }), /admin/i)
    await assert.rejects(() => harness.actions.saveReportingGroup({
      unitId: ADMIN_SCENARIO.sectionOneId,
      parentGroupId: null,
      name: 'Denied',
      memberUserIds: [],
    }), /admin/i)
    await assert.rejects(() => harness.actions.getOrganizationAdminData(), /admin/i)
    assert.equal(harness.db.writes.length, 0)
  })
})

describe('organization write validation', () => {
  it('rejects an invalid parent type and a cycle before any write', async () => {
    const harness = createOrganizationAdminHarness()

    await assert.rejects(
      () => harness.actions.createOrganizationUnit({
        name: 'Orphan Division',
        unitType: 'DIVISION',
        parentId: null,
      }),
      /parent type/i,
    )
    await assert.rejects(
      () => harness.actions.updateOrganizationUnit({
        id: ADMIN_SCENARIO.factoryId,
        name: 'Cyclic Factory',
        parentId: ADMIN_SCENARIO.divisionId,
        isActive: true,
      }),
      /parent type|cycle/i,
    )
    assert.equal(harness.db.writes.length, 0)
  })

  it('rejects ambiguous primary assignments before any write', async () => {
    const harness = createOrganizationAdminHarness()

    await assert.rejects(
      () => harness.actions.savePositionAssignment({
        userId: ADMIN_SCENARIO.staffOneId,
        unitId: ADMIN_SCENARIO.sectionTwoId,
        positionCode: 'SUPERVISOR',
        reportingGroupId: null,
        isPrimary: true,
        isActive: true,
      }),
      /primary/i,
    )
    assert.equal(harness.db.writes.length, 0)
  })

  it('does not duplicate a parent manager into a descendant section', async () => {
    const harness = createOrganizationAdminHarness()

    await assert.rejects(
      () => harness.actions.savePositionAssignment({
        userId: ADMIN_SCENARIO.departmentManagerOneId,
        unitId: ADMIN_SCENARIO.sectionOneId,
        positionCode: 'DEPARTMENT_MANAGER',
        reportingGroupId: null,
        isPrimary: false,
        isActive: true,
      }),
      /does not match unit|parent manager/i,
    )
    await assert.rejects(
      () => harness.actions.saveReportingGroup({
        id: ADMIN_SCENARIO.groupOneId,
        unitId: ADMIN_SCENARIO.sectionOneId,
        parentGroupId: null,
        name: 'Fitting crews',
        memberUserIds: [ADMIN_SCENARIO.staffOneId, ADMIN_SCENARIO.departmentManagerOneId],
      }),
      /parent manager|section membership/i,
    )
    assert.equal(pendingWriteModels(harness).length, 0)
  })
})

describe('organization edits do not mutate pending rows', () => {
  it('leaves pending instances, approvals, and candidate groups untouched', async () => {
    const harness = createOrganizationAdminHarness()
    const before = snapshotPending(harness)

    await harness.actions.updateOrganizationUnit({
      id: ADMIN_SCENARIO.sectionTwoId,
      name: 'Welding Section Renamed',
      parentId: ADMIN_SCENARIO.departmentId,
      isActive: true,
    })
    await harness.actions.savePositionAssignment({
      userId: ADMIN_SCENARIO.staffOneId,
      unitId: ADMIN_SCENARIO.sectionOneId,
      positionCode: 'STAFF',
      reportingGroupId: ADMIN_SCENARIO.groupOneId,
      isPrimary: true,
      isActive: true,
    })
    await harness.actions.createOrganizationUnit({
      name: 'Paint Section',
      unitType: 'SECTION',
      parentId: ADMIN_SCENARIO.departmentId,
    })

    assert.deepEqual(snapshotPending(harness), before)
    assert.deepEqual(pendingWriteModels(harness), [])
    const audits = harness.db.snapshot('request_activities')
    assert.ok(audits.length >= 3)
    assert.ok(audits.every((row) => typeof row.action === 'string' && row.userId === ADMIN_SCENARIO.adminId))
  })
})

describe('Factory Manager create', () => {
  it('creates a Factory Manager with departmentId=null and no main/additional section selection', async () => {
    const harness = createOrganizationAdminHarness()
    const beforePending = snapshotPending(harness)

    const created = await harness.userActions.createUser({
      name: 'Factory Manager',
      email: 'factory-manager@example.test',
      departmentId: null,
      role: 'general_dept',
      positionAssignment: {
        unitId: ADMIN_SCENARIO.factoryId,
        positionCode: 'FACTORY_MANAGER',
        reportingGroupId: null,
        isPrimary: true,
      },
    }) as { id: string; departmentId: string | null; level: number | null; role: string }

    assert.equal(created.departmentId, null)
    assert.equal(created.level, null)
    assert.equal(created.role, 'general_dept')
    const assignments = harness.db.snapshot('organization_position_assignments').filter((row) => row.userId === created.id)
    assert.equal(assignments.length, 1)
    assert.equal(assignments[0].unitId, ADMIN_SCENARIO.factoryId)
    assert.equal(assignments[0].positionCode, 'FACTORY_MANAGER')
    assert.equal(assignments[0].reportingGroupId, null)
    assert.equal(assignments[0].isPrimary, true)
    assert.equal(harness.db.snapshot('department_approvers').length, 0)
    assert.deepEqual(snapshotPending(harness), beforePending)
  })
})
