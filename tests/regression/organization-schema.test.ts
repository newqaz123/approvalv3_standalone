import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Prisma } from '@prisma/client'

const schema = readFileSync('prisma/schema.prisma', 'utf8')

/**
 * A missing migration file must surface as failed SQL contract assertions
 * (clean RED) instead of a module-load crash that hides the other contracts.
 */
function loadMigrationSql(): string {
  try {
    return readFileSync(
      'prisma/migrations/20260905000000_organization_approval_redesign/migration.sql',
      'utf8',
    )
  } catch {
    return ''
  }
}

const migration = loadMigrationSql()

/** Collapse whitespace so SQL/DDL assertions do not depend on formatting. */
function normalized(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Extract the `model <name> { ... }` block from the Prisma schema. */
function modelBlock(name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`))
  assert.ok(match, `model ${name} must exist in prisma/schema.prisma`)
  return match[1]
}

describe('organization approval schema contract', () => {
  it('contains separate units, positions, reporting groups, routes, instances, and snapshots', () => {
    for (const name of [
      'organization_units',
      'organization_position_assignments',
      'reporting_groups',
      'reporting_group_members',
      'approval_route_versions',
      'approval_route_steps',
      'approval_instances',
      'approval_instance_skips',
      'approval_candidate_groups',
      'approval_candidate_group_members',
    ]) {
      assert.match(schema, new RegExp(`model ${name} \\{`))
    }
    assert.match(schema, /enum ApprovalRoutingMode \{[\s\S]*LEGACY_LEVEL[\s\S]*SNAPSHOT_GROUP[\s\S]*CUSTOM_PERSON/)
    assert.match(schema, /requiredPosition\s+OrganizationPositionCode\?/)
    assert.match(schema, /candidateGroupId\s+String\?/)
    assert.match(schema, /instanceId\s+String\?/)
  })

  it('keeps the existing numeric level and custom flags for legacy compatibility', () => {
    assert.match(schema, /requiredLevel\s+Int\?/)
    assert.match(schema, /isCustomChain\s+Boolean\s+@default\(false\)/)
    assert.match(schema, /routingMode\s+ApprovalRoutingMode\s+@default\(LEGACY_LEVEL\)/)
  })

  it('stores release import provenance in organization_import_runs', () => {
    const block = modelBlock('organization_import_runs')
    assert.match(block, /mappingDigest\s+String\s+@unique/)
    assert.match(block, /appliedAt\s+DateTime\s+@default\(now\(\)\)/)
    assert.match(block, /appliedBy\s+String/)
    assert.match(block, /targetIdentity\s+String/)
    assert.match(block, /counts\s+Json/)
  })

  it('makes request origin ownership dual: legacy department or organization unit', () => {
    const requests = modelBlock('requests')
    assert.match(requests, /departmentId\s+String\?/)
    assert.match(requests, /department\s+departments\?/)
    assert.match(requests, /organizationUnitId\s+String\?/)
    assert.match(
      requests,
      /organizationUnit\s+organization_units\?\s+@relation\(fields:\s*\[organizationUnitId\],\s*references:\s*\[id\]\)/,
    )
    assert.match(requests, /approvalInstances\s+approval_instances\[\]/)
  })

  it('links departments to their future organization unit without ownership transfer', () => {
    const departments = modelBlock('departments')
    assert.match(
      departments,
      /organizationUnit\s+organization_units\?\s+@relation\("organization_units_legacyDepartment"\)/,
    )
  })

  it('extends both approval-row models with routing metadata for the explicit discriminator', () => {
    for (const [model, instanceRelation, groupRelation] of [
      ['request_approvals', 'request_approval_instance', 'request_approval_candidate_group'],
      ['solution_approvals', 'solution_approval_instance', 'solution_approval_candidate_group'],
    ] as const) {
      const block = modelBlock(model)
      assert.match(block, /instanceId\s+String\?/)
      assert.match(block, /requiredPosition\s+OrganizationPositionCode\?/)
      assert.match(block, /candidateGroupId\s+String\?/)
      assert.match(block, /routingMode\s+ApprovalRoutingMode\s+@default\(LEGACY_LEVEL\)/)
      assert.match(
        block,
        new RegExp(
          `instance\\s+approval_instances\\?\\s+@relation\\("${instanceRelation}",\\s*fields:\\s*\\[instanceId\\],\\s*references:\\s*\\[id\\],\\s*onDelete:\\s*Restrict\\)`,
        ),
      )
      assert.match(
        block,
        new RegExp(
          `candidateGroup\\s+approval_candidate_groups\\?\\s+@relation\\("${groupRelation}",\\s*fields:\\s*\\[candidateGroupId\\],\\s*references:\\s*\\[id\\],\\s*onDelete:\\s*Restrict\\)`,
        ),
      )
    }
  })

  it('classifies organization units independently of names and levels', () => {
    const block = modelBlock('organization_units')
    assert.match(block, /operationalType\s+DepartmentType\s+@default\(GENERAL\)/)
    assert.match(block, /legacyDepartmentId\s+String\?\s+@unique/)
  })

  it('uniquely numbers approval attempts per document owner and phase', () => {
    const instances = modelBlock('approval_instances')
    assert.match(instances, /@@unique\(\[requestId, phase, attempt\]\)/)
    assert.match(instances, /@@unique\(\[solutionId, phase, attempt\]\)/)
    assert.match(instances, /attempt\s+Int\s+@default\(1\)/)
    assert.match(instances, /state\s+ApprovalInstanceState\s+@default\(PENDING\)/)
    assert.match(instances, /originContext\s+Json/)
  })

  it('declares reverse assignment, group, route, and instance relations on users', () => {
    const user = modelBlock('User')
    assert.match(user, /organizationPositionAssignments\s+organization_position_assignments\[\]/)
    assert.match(user, /reportingGroupMembers\s+reporting_group_members\[\]/)
    assert.match(user, /createdApprovalRouteVersions\s+approval_route_versions\[\]/)
    assert.match(
      user,
      /approvalInstancesOrigin\s+approval_instances\[\]\s+@relation\("approval_instances_originUser"\)/,
    )
  })

  it('keeps candidate membership captured as scalar audit data, not live user joins', () => {
    const members = modelBlock('approval_candidate_group_members')
    assert.doesNotMatch(members, /user\s+User\s+@relation/)
    assert.match(members, /capturedDisplayName\s+String/)
    assert.match(members, /@@id\(\[candidateGroupId, userId\]\)/)
  })
})

describe('organization approval generated client metadata', () => {
  type DatamodelModel = (typeof Prisma.dmmf.datamodel.models)[number]
  type DatamodelField = DatamodelModel['fields'][number]

  function findModel(name: string): DatamodelModel {
    const model = Prisma.dmmf.datamodel.models.find((candidate) => candidate.name === name)
    assert.ok(model, `generated client metadata must contain model ${name}`)
    return model
  }

  function findField(model: DatamodelModel, name: string): DatamodelField {
    const field = model.fields.find((candidate) => candidate.name === name)
    assert.ok(field, `model ${model.name} must contain field ${name}`)
    return field
  }

  function assertNullable(modelName: string, fieldName: string, typeName?: string) {
    const field = findField(findModel(modelName), fieldName)
    assert.equal(
      field.isRequired,
      false,
      `${modelName}.${fieldName} must be nullable in the generated client`,
    )
    if (typeName) {
      assert.equal(field.type, typeName, `${modelName}.${fieldName} must be typed ${typeName}`)
    }
  }

  it('exposes the new enums with the approved discriminators', () => {
    const routingMode = Prisma.dmmf.datamodel.enums.find(
      (candidate) => candidate.name === 'ApprovalRoutingMode',
    )
    assert.ok(routingMode, 'ApprovalRoutingMode enum must exist in generated metadata')
    assert.deepEqual(
      routingMode.values.map((value) => value.name),
      ['LEGACY_LEVEL', 'SNAPSHOT_GROUP', 'CUSTOM_PERSON'],
    )
    for (const [name, values] of [
      ['OrganizationUnitType', ['FACTORY', 'DIVISION', 'DEPARTMENT', 'SECTION']],
      [
        'OrganizationPositionCode',
        [
          'STAFF',
          'SUPERVISOR',
          'SECTION_MANAGER',
          'DEPARTMENT_MANAGER',
          'DIVISION_MANAGER',
          'FACTORY_MANAGER',
        ],
      ],
      ['ApprovalPhase', ['REQUEST', 'SOLUTION', 'FINAL']],
      ['ApprovalRouteStatus', ['DRAFT', 'PUBLISHED', 'RETIRED']],
      [
        'ApprovalInstanceState',
        [
          'PENDING',
          'AUTO_APPROVED',
          'COMPLETED_NO_ELIGIBLE_STEPS',
          'APPROVED',
          'REJECTED',
          'CANCELLED',
          'SUPERSEDED',
        ],
      ],
      ['ApprovalSkipReason', ['VACANT_POSITION']],
    ] as const) {
      const found = Prisma.dmmf.datamodel.enums.find((candidate) => candidate.name === name)
      assert.ok(found, `${name} enum must exist in generated metadata`)
      assert.deepEqual(
        found.values.map((value) => value.name),
        [...values],
      )
    }
  })

  it('exposes nullable legacy nullability on requests and requiredLevel', () => {
    assertNullable('requests', 'departmentId', 'String')
    assertNullable('requests', 'organizationUnitId', 'String')
    assertNullable('request_approvals', 'requiredLevel', 'Int')
  })

  it('exposes routing metadata fields on both approval-row models', () => {
    for (const model of ['request_approvals', 'solution_approvals']) {
      assertNullable(model, 'instanceId', 'String')
      assertNullable(model, 'requiredPosition', 'OrganizationPositionCode')
      assertNullable(model, 'candidateGroupId', 'String')
    }
    for (const model of ['request_approvals', 'solution_approvals']) {
      const routingMode = findField(findModel(model), 'routingMode')
      assert.equal(routingMode.isRequired, true, `${model}.routingMode must be required`)
      assert.equal(routingMode.type, 'ApprovalRoutingMode')
    }
  })
})

describe('organization approval migration SQL contract', () => {
  const sql = normalized(migration)

  it('initializes the custom discriminator without touching legacy levels', () => {
    assert.match(
      sql,
      /UPDATE "request_approvals" SET "routingMode" = 'CUSTOM_PERSON' WHERE "isCustomChain" = true;/,
    )
    assert.match(
      sql,
      /UPDATE "solution_approvals" SET "routingMode" = 'CUSTOM_PERSON' WHERE "isCustomChain" = true;/,
    )
    assert.ok(
      sql.indexOf('ADD COLUMN "routingMode"') <
        sql.indexOf('UPDATE "request_approvals" SET "routingMode"'),
      'discriminator initialization must run after the routingMode column exists',
    )
    assert.doesNotMatch(sql, /SET "requiredLevel"/)
    assert.doesNotMatch(sql, /UPDATE "users"/)
  })

  it('adds the partial uniqueness indexes Prisma cannot express', () => {
    assert.match(
      sql,
      /CREATE UNIQUE INDEX "approval_routes_one_published_scope_phase" ON "approval_route_versions" \("scopeUnitId", "phase"\) WHERE "status" = 'PUBLISHED';/,
    )
    assert.match(
      sql,
      /CREATE UNIQUE INDEX "organization_assignments_one_active_primary" ON "organization_position_assignments" \("userId"\) WHERE "isPrimary" = true AND "isActive" = true;/,
    )
    assert.match(
      sql,
      /CREATE UNIQUE INDEX "approval_instances_current_request_phase" ON "approval_instances" \("requestId", "phase"\) WHERE "requestId" IS NOT NULL AND "supersededAt" IS NULL;/,
    )
    assert.match(
      sql,
      /CREATE UNIQUE INDEX "approval_instances_current_solution_phase" ON "approval_instances" \("solutionId", "phase"\) WHERE "solutionId" IS NOT NULL AND "supersededAt" IS NULL;/,
    )
  })

  it('ties each instance to exactly one owning document for its phase', () => {
    assert.ok(
      sql.includes(
        normalized(`
          ALTER TABLE "approval_instances"
            ADD CONSTRAINT "approval_instances_one_document_owner"
            CHECK (
              ("phase" = 'SOLUTION' AND "solutionId" IS NOT NULL AND "requestId" IS NULL)
              OR ("phase" IN ('REQUEST', 'FINAL') AND "requestId" IS NOT NULL AND "solutionId" IS NULL)
            );
        `),
      ),
      'approval_instances_one_document_owner check must tie phases to exactly one document owner',
    )
  })

  it('keeps row modes honest, including approved auto self-rows without pending groups', () => {
    for (const table of ['request_approvals', 'solution_approvals']) {
      const constraint = `ALTER TABLE "${table}" ADD CONSTRAINT "${table}_row_mode_integrity"`
      assert.ok(
        sql.includes(
          normalized(`
            ${constraint}
            CHECK (
              ("routingMode" = 'LEGACY_LEVEL' AND "requiredLevel" IS NOT NULL)
              OR ("routingMode" = 'CUSTOM_PERSON' AND "isCustomChain" = true AND "requiredApproverId" IS NOT NULL)
              OR (
                "routingMode" = 'SNAPSHOT_GROUP'
                AND "instanceId" IS NOT NULL
                AND "requiredPosition" IS NOT NULL
                AND ("candidateGroupId" IS NOT NULL OR "status" <> 'pending')
              )
            );
          `),
        ),
        `${table} row-mode integrity check must tie routingMode to row metadata`,
      )
      assert.ok(
        sql.indexOf(`UPDATE "${table}" SET "routingMode" = 'CUSTOM_PERSON'`) <
          sql.indexOf(constraint),
        `discriminator initialization must run before the ${table} row-mode check`,
      )
    }
  })

  it('requires every request to keep one present origin owner', () => {
    assert.match(
      sql,
      /ALTER TABLE "requests" ADD CONSTRAINT "requests_one_origin_owner" CHECK \("departmentId" IS NOT NULL OR "organizationUnitId" IS NOT NULL\);/,
    )
  })

  it('relaxes only the legacy columns that gain nullable organization semantics', () => {
    const requestApprovalsAlter = sql.match(/ALTER TABLE "request_approvals" [^;]*;/)?.[0] ?? ''
    const requestsAlter = sql.match(/ALTER TABLE "requests" [^;]*;/)?.[0] ?? ''
    assert.match(
      requestApprovalsAlter,
      /ALTER COLUMN "requiredLevel" DROP NOT NULL;/,
      'request_approvals.requiredLevel must become nullable in the migration',
    )
    assert.match(
      requestsAlter,
      /ALTER COLUMN "departmentId" DROP NOT NULL;/,
      'requests.departmentId must become nullable in the migration',
    )
    assert.doesNotMatch(
      sql,
      /ALTER TABLE "solution_approvals" [^;]*ALTER COLUMN "requiredLevel" DROP NOT NULL;/,
    )
  })

  it('carries the attempt-uniqueness and lookup indexes from the datamodel', () => {
    assert.match(
      sql,
      /CREATE UNIQUE INDEX "approval_instances_requestId_phase_attempt_key" ON "approval_instances"\("requestId", "phase", "attempt"\);/,
    )
    assert.match(
      sql,
      /CREATE UNIQUE INDEX "approval_instances_solutionId_phase_attempt_key" ON "approval_instances"\("solutionId", "phase", "attempt"\);/,
    )
    assert.match(sql, /CREATE INDEX "request_approvals_instanceId_idx" ON "request_approvals"\("instanceId"\);/)
    assert.match(sql, /CREATE INDEX "solution_approvals_candidateGroupId_idx" ON "solution_approvals"\("candidateGroupId"\);/)
  })

  it('creates the import provenance table without inserting any mapping data', () => {
    assert.match(sql, /CREATE TABLE "organization_import_runs"/)
    for (const table of [
      'organization_units',
      'organization_position_assignments',
      'reporting_groups',
      'reporting_group_members',
      'organization_import_runs',
    ]) {
      assert.doesNotMatch(sql, new RegExp(`INSERT INTO "${table}"`, 'i'))
    }
  })
})
