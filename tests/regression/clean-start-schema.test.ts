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
    const sql = readFileSync('prisma/migrations/00000000000001_clean_start_additive/migration.sql', 'utf8').replace(/\s+/g, ' ')
    assert.match(sql, /CREATE UNIQUE INDEX one_active_assignment_per_user ON organization_assignments \(userId\) WHERE isActive/i)
    assert.match(sql, /CREATE UNIQUE INDEX one_active_company_root ON organization_units \(\(1\)\) WHERE parentId IS NULL AND isActive/i)
    // R1 (plan-vs-source defect): this index does NOT pre-exist from the prior
    // redesign — B1 CREATES it, so the full contract is asserted by name.
    assert.match(sql, /CREATE UNIQUE INDEX one_published_route_per_scope_phase ON approval_route_versions \(scopeUnitId, phase\) WHERE status = 'PUBLISHED'/i)
    // Team names: partial unique on ACTIVE rows per unit (accepted A3 rule 7),
    // deliberately NOT an unqualified UNIQUE (unitId, name) — inactive
    // historical team names must remain reusable.
    assert.match(sql, /CREATE UNIQUE INDEX one_active_team_name_per_unit ON teams \(unitId, name\) WHERE isActive/i)
  })
})
