import { PrismaClient } from '@prisma/client'
import { hash } from 'bcryptjs'
import {
  assertOwnedLoopbackDatabaseTarget,
  type OwnedDisposableResource,
} from '../business-workflow-safety'
import {
  createAdminSecurityFixture,
  ADMIN_SECURITY_POSITIONS,
  ADMIN_SECURITY_UNITS,
} from '../admin-security/admin-security-fixture'

/**
 * Seeds the OWNED disposable database (fresh `app_cleanstart_dev` inside a
 * run-owned PostgreSQL cluster) with the admin HTTP-security fixture.
 *
 * Safety contracts (identical in spirit to seed-business-fixture.ts, which
 * this mirrors):
 * - the target URL must be the owned loopback URL supplied explicitly by the
 *   native admin-security runner (ambient env is never consulted);
 * - the connected database is re-verified before the first write and must be
 *   fresh/empty — this seeder never touches a shared development database;
 * - only the named fixture rows are written (users, one position, three
 *   units parent-first, company_settings, assignments, templates, one
 *   archived request, fail-closed loopback email_settings);
 * - every record is disposable: the whole database lives inside the run-owned
 *   PostgreSQL cluster that the runner drops at cleanup.
 *
 * Run with: tsx tests/support/native/seed-admin-security-fixture.ts
 * (invoked by run-native-admin-security-tests.ts with explicit env only)
 */

const REQUIRED_PARTIAL_UNIQUE_INDEXES = [
  'one_active_assignment_per_user',
  'one_active_company_root',
  'one_published_route_per_scope_phase',
  'one_active_team_name_per_unit',
] as const

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`admin-security seed: missing required env ${name} (must be set explicitly by the native runner)`)
  return value
}

function resourceFromEnv(): OwnedDisposableResource {
  return {
    runId: requireEnv('ADMIN_RUN_ID'),
    containerName: `${requireEnv('ADMIN_RUN_ID')}-postgres`,
    databaseName: 'app_cleanstart_dev',
    databasePort: Number(requireEnv('ADMIN_DB_PORT')),
    serverPort: Number(requireEnv('ADMIN_SERVER_PORT')),
  }
}

async function assertFreshOwnedDatabase(prisma: PrismaClient): Promise<void> {
  const connected = await prisma.$queryRawUnsafe<Array<{ current_database: string }>>('select current_database()')
  if (connected[0]?.current_database !== 'app_cleanstart_dev') {
    throw new Error(`admin-security seed: connected to ${String(connected[0]?.current_database)}, refusing to seed anything else`)
  }
  const counts = await Promise.all([
    prisma.company_settings.count(),
    prisma.user.count(),
    prisma.organization_units.count(),
    prisma.positions.count(),
    prisma.templates.count(),
    prisma.requests.count(),
    prisma.email_settings.count(),
  ])
  if (counts.some((count) => count !== 0)) {
    throw new Error(`admin-security seed: target database is not fresh (counts=${counts.join(',')}); refusing to seed over existing data`)
  }
  const indexes = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
    "select indexname from pg_indexes where schemaname = 'public'",
  )
  const present = new Set(indexes.map((row) => row.indexname))
  for (const required of REQUIRED_PARTIAL_UNIQUE_INDEXES) {
    if (!present.has(required)) {
      throw new Error(`admin-security seed: required partial unique index ${required} is missing — run the schema preparation step first`)
    }
  }
}

async function main(): Promise<void> {
  const resource = resourceFromEnv()
  const databaseUrl = requireEnv('DATABASE_URL')
  assertOwnedLoopbackDatabaseTarget(databaseUrl, resource)

  const mailPort = Number(requireEnv('ADMIN_MAIL_PORT'))
  const e2ePassword = requireEnv('ADMIN_E2E_PASSWORD')

  const fixture = createAdminSecurityFixture()
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  try {
    await prisma.$connect()
    await assertFreshOwnedDatabase(prisma)

    const passwordHash = await hash(e2ePassword, 12)

    await prisma.$transaction(async (tx) => {
      // FK-safe order: positions → users → units (parent-first) →
      // company_settings → assignments → templates → requests.
      await tx.positions.create({
        data: { id: ADMIN_SECURITY_POSITIONS.staff, name: 'Admin Security Staff', rank: 1, isActive: true },
      })
      for (const actor of fixture.users) {
        await tx.user.create({
          data: {
            id: actor.id,
            email: actor.email,
            name: actor.name,
            passwordHash,
            role: actor.role,
            isActive: actor.isActive,
            forcePasswordChange: false,
          },
        })
      }
      await tx.organization_units.create({
        data: {
          id: ADMIN_SECURITY_UNITS.company,
          name: 'Admin Security Company',
          parentId: null,
          isActive: true,
          shareRequests: true,
          canWorkOnSolutions: false,
          managerUserId: null,
        },
      })
      for (const [unitId, name] of [
        [ADMIN_SECURITY_UNITS.general, 'General Department'],
        [ADMIN_SECURITY_UNITS.engineering, 'Engineering Department'],
      ] as const) {
        await tx.organization_units.create({
          data: {
            id: unitId,
            name,
            parentId: ADMIN_SECURITY_UNITS.company,
            isActive: true,
            shareRequests: true,
            canWorkOnSolutions: false,
            managerUserId: null,
          },
        })
      }
      await tx.company_settings.create({
        data: {
          id: 'default',
          name: 'Admin Security Test Company',
          rootUnitId: ADMIN_SECURITY_UNITS.company,
        },
      })
      for (const actor of fixture.users) {
        if (!actor.assignment) continue
        await tx.organization_assignments.create({
          data: {
            id: actor.assignment.id,
            userId: actor.id,
            unitId: actor.assignment.unitId,
            positionId: actor.assignment.positionId,
            isActive: true,
            deactivatedAt: null,
          },
        })
      }
      for (const template of fixture.templates) {
        await tx.templates.create({ data: template })
      }
      await tx.requests.create({
        data: {
          id: fixture.request.id,
          title: fixture.request.title,
          description: fixture.request.description,
          requesterId: fixture.request.requesterId,
          organizationUnitId: fixture.request.organizationUnitId,
          isArchived: true,
          isDeleted: false,
        },
      })
      // Fail-closed mail: the app's transport points at the owned loopback
      // capture endpoint; the outbound allowlist preload blocks everything
      // else. The admin-security flows send no mail, but the app process is
      // configured as defensively as the business runtime.
      await tx.email_settings.create({
        data: {
          id: 'default',
          enabled: true,
          provider: 'custom',
          host: '127.0.0.1',
          port: mailPort,
          username: null,
          passwordEncrypted: null,
          fromAddress: 'admin-security-test@example.test',
        },
      })
    })

    const summary = {
      runId: resource.runId,
      fixture: fixture.id,
      users: fixture.users.map((actor) => ({ id: actor.id, role: actor.role, isActive: actor.isActive, assignedTo: actor.assignment?.unitId ?? null })),
      templates: fixture.templates.map((template) => ({ id: template.id, isDefault: template.isDefault, isActive: template.isActive })),
      archivedRequest: fixture.request.id,
      mailCapture: { host: '127.0.0.1', port: mailPort },
      passwordHashNote: 'all fixture accounts share the run-generated e2e password (hash only stored)',
    }
    console.log(JSON.stringify(summary, null, 2))
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error('admin-security seed failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
