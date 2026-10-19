/**
 * Source-level contract for the in-place organization upgrade
 * (docs/superpowers/specs/2026-10-19-upgrade-migration-design.md).
 *
 * Existing production databases already applied main's 18 migrations, so
 * those folders must stay byte-identical and the upgrade must be one extra
 * migration that refuses to run while approvals are open, keeps the audit
 * trigger, and the production seed must be a non-destructive bootstrap.
 * Runtime behaviour is verified on throwaway clusters by
 * scripts/upgrade/verify-upgrade.sh.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'

const MAIN_MIGRATIONS = [
  '20260130161131_init',
  '20260131032658_add_request_workflow_models',
  '20260131042445_change_s3key_to_filepath',
  '20260207160239_make_audit_trail_append_only',
  '20260208000000_add_hierarchy_config',
  '20260302141354_add_password_auth',
  '20260303140000_allow_admin_hard_delete',
  '20260518000000_add_budget_control',
  '20260518001000_add_budget_code_creator',
  '20260519000000_add_budget_code_department',
  '20260606000000_add_engineering_sub_tasks',
  '20260817000000_add_budget_code_name',
  '20260823000000_add_email_settings',
  '20260824000000_add_storage_plan_events',
  '20260825000000_add_retention_settings',
  '20260826000000_add_retention_archive_clock',
  '20260827000000_add_storage_alert',
  '20260828000000_add_inline_description_images',
]
const UPGRADE = '20261019000000_organization_upgrade'
const upgradeSql = () => readFileSync(`prisma/migrations/${UPGRADE}/migration.sql`, 'utf8')
const withoutComments = (sql: string) => sql.replace(/--.*$/gm, '')

describe('organization upgrade migration', () => {
  it("keeps main's 18 migrations and appends exactly one upgrade migration", () => {
    const dirs = readdirSync('prisma/migrations', { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
    assert.deepEqual(dirs, [...MAIN_MIGRATIONS, UPGRADE])
    for (const name of MAIN_MIGRATIONS) {
      assert.ok(existsSync(`prisma/migrations/${name}/migration.sql`), `${name}/migration.sql`)
    }
    assert.equal(existsSync('prisma/migrations/00000000000001_clean_start_init'), false)
    assert.match(readFileSync('prisma/migrations/migration_lock.toml', 'utf8'), /provider = "postgresql"/)
  })

  it('guards against pending approvals on open requests before any DDL', () => {
    const sql = withoutComments(upgradeSql())
    const guard = sql.indexOf('ORGANIZATION UPGRADE BLOCKED')
    assert.ok(guard > 0, 'guard message present')
    assert.ok(guard < sql.indexOf('CREATE TYPE'), 'guard runs before the first DDL statement')
    assert.match(sql, /RAISE EXCEPTION/)
    assert.match(sql, /"status" = 'pending'/)
    assert.match(sql, /NOT IN \('Completed', 'Cancelled'\)/)
    assert.match(sql, /"request_approvals"/)
    assert.match(sql, /"solution_approvals"/)
    // An explicit BEGIN/COMMIT makes Prisma hide the guard message behind
    // "current transaction is aborted" (only plpgsql DO-block BEGINs allowed).
    assert.doesNotMatch(sql, /^\s*(BEGIN|COMMIT)\s*;/m)
  })

  it('never drops or replaces the append-only audit trigger', () => {
    const sql = withoutComments(upgradeSql())
    assert.doesNotMatch(sql, /prevent_audit_modification/)
    assert.doesNotMatch(sql, /DROP TRIGGER/i)
    assert.doesNotMatch(sql, /request_activities/)
    assert.match(
      readFileSync('prisma/migrations/20260303140000_allow_admin_hard_delete/migration.sql', 'utf8'),
      /app\.bypass_audit/,
    )
  })

  it('maps data before dropping legacy tables and carries the raw-SQL contracts', () => {
    const sql = withoutComments(upgradeSql())
    const firstDrop = sql.indexOf('DROP TABLE "departments"')
    for (const step of [
      'INSERT INTO "organization_units"',
      'INSERT INTO "positions"',
      'INSERT INTO "organization_assignments"',
      'UPDATE "requests" SET "organizationUnitId" = "departmentId"',
      'UPDATE "budget_codes" SET "unitId" = "departmentId"',
      'INSERT INTO "approval_route_versions"',
    ]) {
      const at = sql.indexOf(step)
      assert.ok(at > 0 && at < firstDrop, `${step} happens before legacy tables are dropped`)
    }
    for (const contract of [
      'one_active_assignment_per_user',
      'one_active_company_root',
      'one_published_route_per_scope_phase',
      'one_active_team_name_per_unit',
      'request_approvals_row_mode_integrity',
      'solution_approvals_row_mode_integrity',
      'approval_instances_one_document_owner',
      'inline_description_image_references_one_owner',
    ]) {
      assert.ok(sql.includes(contract), contract)
    }
    assert.match(sql, /'Level ' \|\| l\.level/)
    assert.match(sql, /"shareRequests" BOOLEAN NOT NULL DEFAULT false/)
  })
})

describe('production bootstrap seed', () => {
  const seed = () => readFileSync('prisma/seed.ts', 'utf8')

  it('has no database URL guard and is not the dev fixture', () => {
    assert.doesNotMatch(seed(), /URL-GUARD|app_cleanstart_dev|assertCleanStartDatabaseUrl/)
    assert.doesNotMatch(seed(), /seedCleanStartFixture|pat@example\.com/)
    assert.match(readFileSync('prisma/seed-dev.ts', 'utf8'), /app_cleanstart_dev/)
  })

  it('creates the admin without ever resetting it and forces a password change', () => {
    const source = seed()
    const admin = source.slice(source.indexOf('async function seedAdmin'))
    assert.match(admin, /update: \{\}/)
    assert.match(admin, /forcePasswordChange: true/)
    assert.doesNotMatch(admin, /forcePasswordChange: false/)
  })

  it('bootstraps company root, positions and sub-task stages idempotently', () => {
    const source = seed()
    assert.match(source, /company_settings\.findUnique/)
    assert.match(source, /positions\.count\(\)/)
    assert.match(source, /sub_task_stages\.upsert/)
    assert.match(readFileSync('docker-compose.prod.yml', 'utf8'), /npx tsx prisma\/seed\.ts/)
  })
})

describe('upgrade verification script', () => {
  it('counts the clean-start constraints integration suite instead of treating it as informational', () => {
    const script = readFileSync('scripts/upgrade/verify-upgrade.sh', 'utf8')
    assert.match(script, /check "CI constraints suite" PASS FAIL/)
    assert.doesNotMatch(script, /informational, not counted/)
  })

  it('integration suite asserts SQLSTATE + pg_indexes and cleans up with the audit bypass', () => {
    const suite = readFileSync('tests/integration/clean-start-constraints.integration.test.ts', 'utf8')
    assert.match(suite, /postgresCode\(error\), '23505'/)
    assert.match(suite, /FROM pg_indexes WHERE/)
    assert.match(suite, /SET LOCAL app\.bypass_audit = 'true'/)
    assert.doesNotMatch(suite, /maximumPositionLevel/)
  })
})
