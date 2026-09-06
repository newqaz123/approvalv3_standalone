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
      assert.match(block, /integrityVersion\s+Int\s+@default\(0\)/)
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
      const integrityVersion = findField(findModel(model), 'integrityVersion')
      assert.equal(integrityVersion.isRequired, true, `${model}.integrityVersion must be required`)
      assert.equal(integrityVersion.type, 'Int')
      assert.equal(integrityVersion.default, 0, `${model}.integrityVersion must default to 0 (legacy compatibility)`)
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

  it('scopes strict row-mode integrity to version 1 and keeps version 0 legacy-compatible', () => {
    for (const table of ['request_approvals', 'solution_approvals']) {
      const constraint = `ALTER TABLE "${table}" ADD CONSTRAINT "${table}_row_mode_integrity"`
      assert.ok(
        sql.includes(
          normalized(`
            ${constraint}
            CHECK (
              "integrityVersion" = 0 AND "routingMode" IN ('LEGACY_LEVEL', 'CUSTOM_PERSON')
              OR "integrityVersion" = 1 AND (
                "routingMode" = 'LEGACY_LEVEL' AND "requiredLevel" IS NOT NULL
                OR "routingMode" = 'CUSTOM_PERSON' AND "isCustomChain" = true AND "requiredApproverId" IS NOT NULL
                OR "routingMode" = 'SNAPSHOT_GROUP' AND "instanceId" IS NOT NULL AND "requiredPosition" IS NOT NULL
              )
            );
          `),
        ),
        `${table} row-mode integrity check must separate legacy-compatible version 0 from strict version 1`,
      )
      assert.ok(
        sql.indexOf(`UPDATE "${table}" SET "routingMode" = 'CUSTOM_PERSON'`) <
          sql.indexOf(constraint),
        `discriminator initialization must run before the ${table} row-mode check`,
      )
    }
  })

  it('admits historical version-0 rows without re-imposing strict metadata', () => {
    // Historical rows keep null levels and null designated approvers (deleted
    // custom accounts were always SetNull), and may later be wrapped into an
    // instance. Version 0 must accept them; strict metadata applies only to
    // version 1. NOT VALID must not substitute for the compatibility branch.
    assert.doesNotMatch(sql, /NOT VALID/i)
    for (const table of ['request_approvals', 'solution_approvals']) {
      const statement =
        sql.match(new RegExp(`ALTER TABLE "${table}" ADD CONSTRAINT "${table}_row_mode_integrity" [\\s\\S]*?;`))?.[0] ?? ''
      const versionBoundary = statement.indexOf('"integrityVersion" = 1')
      assert.ok(versionBoundary > 0, `${table} row-mode check must scope strict rules to version 1`)
      const v0Branch = statement.slice(0, versionBoundary)
      assert.match(
        v0Branch,
        /"routingMode" IN \('LEGACY_LEVEL', 'CUSTOM_PERSON'\)/,
        `${table} version 0 must be restricted to legacy and custom modes only`,
      )
      assert.doesNotMatch(
        v0Branch,
        /"requiredApproverId" IS NOT NULL/,
        `${table} version 0 must not require a designated approver`,
      )
      assert.doesNotMatch(
        v0Branch,
        /"requiredLevel" IS NOT NULL/,
        `${table} version 0 must not require a level`,
      )
      const v1Branch = statement.slice(versionBoundary)
      assert.match(
        v1Branch,
        /"requiredApproverId" IS NOT NULL/,
        `${table} version 1 custom rows must require a designated approver`,
      )
    }
  })

  it('enforces the group-less snapshot exception through deferred cross-table triggers', () => {
    // The exception is narrow: an approved audit row whose actual approver is
    // the linked instance's origin user, on an AUTO_APPROVED SNAPSHOT_GROUP
    // instance matching owner and phase. Grouped snapshot rows keep their
    // mandatory candidate group. Applicability is decided from the LATEST
    // persisted row (a queued event's stale NEW fields never reject a row
    // that was grouped or deleted later in the same transaction), and the
    // instance is validated through a locking parent read (FOR SHARE, held to
    // commit) so an audit insert can never commit interleaved with a
    // concurrent instance state demotion.
    assert.match(sql, /CREATE OR REPLACE FUNCTION "approval_groupless_snapshot_audit_ok"/)
    for (const fragment of [
      normalized(`v_status = 'approved'`),
      normalized(`v_instance_state = 'AUTO_APPROVED'`),
      normalized(`v_approver_id = v_instance_origin`),
      normalized(`v_instance_mode = 'SNAPSHOT_GROUP'`),
      normalized(`v_instance_request IS NOT NULL AND v_instance_request = v_owner_id`),
      normalized(`(v_instance_phase = 'FINAL') = v_is_final`),
      normalized(`v_instance_solution IS NOT NULL AND v_instance_solution = v_owner_id`),
      normalized(`v_instance_phase = 'SOLUTION'`),
    ]) {
      assert.ok(sql.includes(fragment), `audit predicate must include ${fragment}`)
    }
    // Per-instance serialization: the helper's instance read is a locking
    // parent read held to commit, shared by both mutation paths.
    assert.match(
      sql,
      /FROM "approval_instances" WHERE "id" = v_instance_id FOR SHARE;/,
      'audit validation must take a per-instance locking parent read (FOR SHARE) held to commit',
    )
    for (const table of ['request_approvals', 'solution_approvals']) {
      assert.ok(
        sql.includes(
          normalized(`
            CREATE CONSTRAINT TRIGGER "${table}_groupless_snapshot_audit_guard"
            AFTER INSERT OR UPDATE ON "${table}"
            DEFERRABLE INITIALLY DEFERRED
            FOR EACH ROW EXECUTE FUNCTION "enforce_${table}_groupless_snapshot_audit"();
          `),
        ),
        `${table} must carry a deferred row-level group-less snapshot audit trigger`,
      )
      const fnStart = sql.indexOf(
        `CREATE OR REPLACE FUNCTION "enforce_${table}_groupless_snapshot_audit"()`,
      )
      assert.ok(fnStart >= 0, `${table} trigger function must exist`)
      const fnEnd = sql.indexOf('$$ LANGUAGE plpgsql;', fnStart)
      const triggerFn = sql.slice(fnStart, fnEnd)
      // Applicability must be decided from the LATEST persisted row, never
      // the stale queued event payload.
      assert.match(
        triggerFn,
        new RegExp(
          `SELECT "integrityVersion", "routingMode", "candidateGroupId" INTO [^;]* FROM "${table}" WHERE "id" = NEW."id"`,
        ),
        `${table} trigger must re-read the latest persisted row before deciding applicability`,
      )
      assert.ok(
        normalized(triggerFn).includes(
          normalized(`
            IF v_integrity_version IS NULL
              OR v_integrity_version <> 1
              OR v_routing_mode <> 'SNAPSHOT_GROUP'
              OR v_candidate_group_id IS NOT NULL THEN
              RETURN NULL;
            END IF;
          `),
        ),
        `${table} trigger must succeed for deleted rows and rows that are no longer group-less version-1 snapshots`,
      )
      assert.doesNotMatch(
        triggerFn,
        /NEW\."(integrityVersion|candidateGroupId|routingMode)"/,
        `${table} trigger must never decide applicability from stale queued NEW fields`,
      )
    }
    assert.ok(
      sql.includes(
        normalized(`
          CREATE CONSTRAINT TRIGGER "approval_instances_groupless_snapshot_audit_guard"
          AFTER UPDATE OF "state", "originUserId", "requestId", "solutionId", "phase", "routingMode"
          ON "approval_instances"
          DEFERRABLE INITIALLY DEFERRED
          FOR EACH ROW EXECUTE FUNCTION "enforce_groupless_snapshot_audit_on_instance"();
        `),
      ),
      'instance mutations must re-validate group-less snapshot audit rows',
    )
    assert.ok(
      sql.includes(
        normalized(
          'AND NOT "approval_groupless_snapshot_audit_ok"(\'request\', r."id")',
        ),
      ) &&
        sql.includes(
          normalized(
            'AND NOT "approval_groupless_snapshot_audit_ok"(\'solution\', s."id")',
          ),
        ),
      'instance-side validation must re-check the latest persisted rows',
    )
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
