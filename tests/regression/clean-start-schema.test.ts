import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Prisma } from '@prisma/client'

// Plan-sample correction (disclosed): Prisma 6.1's DMMF exposes models only
// under `datamodel.models` — there is no `modelMap` accessor, so the plan's
// sample `Prisma.dmmf.modelMap[model]` can never resolve. Same assertions,
// same messages, real accessor.
const model = (name: string) => {
  const found = Prisma.dmmf.datamodel.models.find((m) => m.name === name)
  assert.ok(found, `model ${name} must exist`)
  return found
}

const fields = (name: string) => model(name).fields.map((f) => f.name)

describe('clean-start additive schema', () => {
  it('adds the clean organization models', () => {
    for (const m of ['company_settings', 'positions', 'organization_assignments', 'teams']) model(m)
    for (const f of ['id', 'name', 'rootUnitId']) assert.ok(fields('company_settings').includes(f))
    for (const f of ['name', 'rank', 'isActive']) assert.ok(fields('positions').includes(f))
    for (const f of ['shareRequests', 'canWorkOnSolutions', 'managerUserId']) {
      assert.ok(fields('organization_units').includes(f))
    }
    for (const f of ['userId', 'unitId', 'positionId', 'teamId', 'isActive', 'deactivatedAt']) {
      assert.ok(fields('organization_assignments').includes(f))
    }
    for (const f of ['unitId', 'name', 'reportsToAssignmentId', 'isActive']) {
      assert.ok(fields('teams').includes(f))
    }
  })
  it('adds position-based routing, limit, and restart provenance', () => {
    assert.ok(fields('approval_route_versions').includes('approvalLimitPositionId'))
    assert.ok(fields('approval_route_steps').includes('positionId'))
    for (const f of ['originAssignmentId', 'originPositionId', 'restartOfInstanceId', 'restartReason', 'restartedById']) {
      assert.ok(fields('approval_instances').includes(f))
    }
    assert.ok(fields('approval_instance_skips').includes('requiredPositionId'))
    assert.ok(fields('approval_candidate_groups').includes('requiredPositionId'))
    assert.ok(fields('request_approvals').includes('requiredPositionId'))
    assert.ok(fields('solution_approvals').includes('requiredPositionId'))
    assert.ok(fields('budget_codes').includes('unitId'))
  })
  it('carries the partial unique contracts in migration SQL', () => {
    const sql = readFileSync('prisma/migrations/00000000000001_clean_start_init/migration.sql', 'utf8').replace(/\s+/g, ' ')
    // Quoted identifiers are required: Prisma stores camelCase columns quoted.
    // Unquoted userId folds to userid and would fail a real SQL apply.
    // These regexes must not match unquoted SQL (no /i; quotes are mandatory).
    assert.match(sql, /CREATE UNIQUE INDEX one_active_assignment_per_user ON "organization_assignments" \("userId"\) WHERE "isActive"/)
    assert.match(sql, /CREATE UNIQUE INDEX one_active_company_root ON "organization_units" \(\(1\)\) WHERE "parentId" IS NULL AND "isActive"/)
    // R1 (plan-vs-source defect): this index does NOT pre-exist from the prior
    // redesign — B1 CREATES it, so the full contract is asserted by name.
    assert.match(sql, /CREATE UNIQUE INDEX one_published_route_per_scope_phase ON "approval_route_versions" \("scopeUnitId", "phase"\) WHERE "status" = 'PUBLISHED'/)
    // Team names: partial unique on ACTIVE rows per unit (accepted A3 rule 7),
    // deliberately NOT an unqualified UNIQUE (unitId, name) — inactive
    // historical team names must remain reusable.
    assert.match(sql, /CREATE UNIQUE INDEX one_active_team_name_per_unit ON "teams" \("unitId", "name"\) WHERE "isActive"/)
  })
})

const enumValues = (name: string) => {
  const found = Prisma.dmmf.datamodel.enums.find((item) => item.name === name)
  assert.ok(found, `enum ${name} must exist`)
  return found.values.map((value) => value.name)
}

const modelNames = () => Prisma.dmmf.datamodel.models.map((item) => item.name)

describe('clean-start schema finalization removals', () => {
  it('drops legacy models', () => {
    const names = modelNames()
    for (const gone of [
      'departments',
      'department_approvers',
      'hierarchy_change_logs',
      'organization_import_runs',
      'reporting_groups',
      'reporting_group_members',
      'organization_position_assignments',
    ]) {
      assert.equal(names.includes(gone), false, `model ${gone} must be absent`)
    }
  })

  it('drops legacy columns from remaining models', () => {
    assert.equal(fields('User').includes('departmentId'), false, 'users.departmentId must be absent')
    assert.equal(fields('User').includes('level'), false, 'users.level must be absent')
    assert.equal(fields('requests').includes('departmentId'), false, 'requests.departmentId must be absent')
    assert.equal(fields('budget_codes').includes('departmentId'), false, 'budget_codes.departmentId must be absent')
    for (const gone of ['unitType', 'legacyDepartmentId', 'operationalType']) {
      assert.equal(fields('organization_units').includes(gone), false, `organization_units.${gone} must be absent`)
    }
    assert.equal(fields('approval_route_versions').includes('maximumPositionLevel'), false)
    assert.equal(fields('approval_route_steps').includes('positionCode'), false)
    assert.equal(fields('approval_instances').includes('originContext'), false, 'approval_instances legacy context must be absent')
    for (const model of ['request_approvals', 'solution_approvals']) {
      for (const gone of ['requiredLevel', 'requiredPosition', 'isCustomChain', 'integrityVersion']) {
        assert.equal(fields(model).includes(gone), false, `${model}.${gone} must be absent`)
      }
    }
    assert.equal(fields('approval_instance_skips').includes('requiredPosition'), false)
    assert.equal(fields('approval_candidate_groups').includes('requiredPosition'), false)
  })

  it('drops leftover enums and keeps ApprovalRoutingMode as CUSTOM_PERSON|SNAPSHOT_GROUP', () => {
    const enums = Prisma.dmmf.datamodel.enums.map((item) => item.name)
    assert.equal(enums.includes('DepartmentType'), false)
    assert.equal(enums.includes('OrganizationUnitType'), false)
    assert.equal(enums.includes('OrganizationPositionCode'), false)
    assert.deepEqual(enumValues('ApprovalRoutingMode').slice().sort(), ['CUSTOM_PERSON', 'SNAPSHOT_GROUP'])
  })

  it('tightens staged columns to required', () => {
    const required = (modelName: string, fieldName: string) => {
      const field = model(modelName).fields.find((item) => item.name === fieldName)
      assert.ok(field, `${modelName}.${fieldName} must exist`)
      assert.equal(field.isRequired, true, `${modelName}.${fieldName} must be required`)
    }
    required('approval_route_versions', 'approvalLimitPositionId')
    required('approval_route_steps', 'positionId')
    required('approval_instances', 'originAssignmentId')
    required('approval_instances', 'originPositionId')
    required('approval_instance_skips', 'requiredPositionId')
    required('approval_candidate_groups', 'requiredPositionId')
  })

  it('carries row-mode CHECKs in the squashed init migration', () => {
    const sql = readFileSync('prisma/migrations/00000000000001_clean_start_init/migration.sql', 'utf8').replace(/\s+/g, ' ')
    assert.match(sql, /ADD CONSTRAINT "request_approvals_row_mode_integrity" CHECK/)
    assert.match(sql, /ADD CONSTRAINT "solution_approvals_row_mode_integrity" CHECK/)
    assert.match(sql, /"routingMode" = 'SNAPSHOT_GROUP' AND "instanceId" IS NOT NULL AND "requiredPositionId" IS NOT NULL/)
    assert.match(sql, /ADD CONSTRAINT "approval_instances_one_document_owner" CHECK/)
  })
})
