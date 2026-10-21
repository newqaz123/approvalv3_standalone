import { PrismaClient } from '@prisma/client'
import { hash } from 'bcryptjs'
import {
  assertOwnedLoopbackDatabaseTarget,
  type OwnedDisposableResource,
} from '../business-workflow-safety'
import {
  createBusinessWorkflowFixture,
  BUSINESS_ROUTE_CONFIGURATION_NAMES,
  type BusinessRouteConfigurationName,
} from '../business-workflow-fixture'
import { buildBusinessSeedPlan, BUSINESS_FIXTURE_OUTBOUND_SENDER_ADDRESS } from './seed-business-fixture-plan'

/**
 * Seeds the OWNED disposable database (fresh `app_cleanstart_dev` inside a
 * run-owned PostgreSQL cluster) with the confirmed business-workflow fixture.
 *
 * Safety contracts enforced here:
 * - the target URL must be an owned loopback URL supplied explicitly by the
 *   native runner (ambient env is never consulted for credentials);
 * - the connected database is re-verified before the first write and must be
 *   empty (fresh) — this seeder never touches a shared development database;
 * - no stock Director/company seed is applied, only the fixture's named
 *   accounts, units, teams, assignments and published route configuration;
 * - row insertion follows the FK-safe plan built by seed-business-fixture-plan
 *   (users before units, assignments before teams, nullable teamId backfilled
 *   after teams) so no INSERT forward-references a non-deferrable FK.
 *
 * Run with: tsx tests/support/native/seed-business-fixture.ts
 */

const REQUIRED_PARTIAL_UNIQUE_INDEXES = [
  'one_active_assignment_per_user',
  'one_active_company_root',
  'one_published_route_per_scope_phase',
  'one_active_team_name_per_unit',
] as const

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`seed: missing required env ${name} (must be set explicitly by the native runner)`)
  return value
}

function resourceFromEnv(): OwnedDisposableResource {
  return {
    runId: requireEnv('BUSINESS_RUN_ID'),
    containerName: `${requireEnv('BUSINESS_RUN_ID')}-postgres`,
    databaseName: 'app_cleanstart_dev',
    databasePort: Number(requireEnv('BUSINESS_DB_PORT')),
    serverPort: Number(requireEnv('BUSINESS_SERVER_PORT')),
  }
}

async function assertFreshOwnedDatabase(prisma: PrismaClient): Promise<void> {
  const connected = await prisma.$queryRawUnsafe<Array<{ current_database: string }>>('select current_database()')
  if (connected[0]?.current_database !== 'app_cleanstart_dev') {
    throw new Error(`seed: connected to ${String(connected[0]?.current_database)}, refusing to seed anything else`)
  }
  const counts = await Promise.all([
    prisma.company_settings.count(),
    prisma.user.count(),
    prisma.organization_units.count(),
    prisma.approval_route_versions.count(),
    prisma.email_settings.count(),
  ])
  if (counts.some((count) => count !== 0)) {
    throw new Error(`seed: target database is not fresh (counts=${counts.join(',')}); refusing to seed over existing data`)
  }
  const indexes = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
    "select indexname from pg_indexes where schemaname = 'public'",
  )
  const present = new Set(indexes.map((row) => row.indexname))
  for (const required of REQUIRED_PARTIAL_UNIQUE_INDEXES) {
    if (!present.has(required)) {
      throw new Error(`seed: required partial unique index ${required} is missing — run the schema preparation step first`)
    }
  }
}

async function main(): Promise<void> {
  const resource = resourceFromEnv()
  const databaseUrl = requireEnv('DATABASE_URL')
  assertOwnedLoopbackDatabaseTarget(databaseUrl, resource)

  const routeName = requireEnv('BUSINESS_ROUTES_CONFIG') as BusinessRouteConfigurationName
  if (!BUSINESS_ROUTE_CONFIGURATION_NAMES.includes(routeName)) {
    throw new Error(`seed: unknown route configuration ${routeName}`)
  }
  const mailPort = Number(requireEnv('BUSINESS_MAIL_PORT'))
  const e2ePassword = requireEnv('BUSINESS_E2E_PASSWORD')

  const fixture = createBusinessWorkflowFixture()
  const config = fixture.routeConfigurations[routeName]

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  try {
    await prisma.$connect()
    await assertFreshOwnedDatabase(prisma)

    const passwordHash = await hash(e2ePassword, 10)
    const plan = buildBusinessSeedPlan(fixture, { passwordHash })

    await prisma.$transaction(async (tx) => {
      for (const step of plan.steps) {
        switch (step.table) {
          case 'positions':
            await tx.positions.create({ data: step.data })
            break
          case 'users':
            await tx.user.create({ data: step.data })
            break
          case 'organization_units':
            await tx.organization_units.create({ data: step.data })
            break
          case 'company_settings':
            await tx.company_settings.create({ data: step.data })
            break
          case 'organization_assignments':
            await tx.organization_assignments.create({ data: step.data })
            break
          case 'teams':
            await tx.teams.create({ data: step.data })
            break
        }
      }
      // Backfill the nullable organization_assignments.teamId now that the
      // teams exist (teams.reportsToAssignmentId required an assignment first,
      // so this is the only constraint-clean way to close the cycle).
      for (const update of plan.teamUpdates) {
        await tx.organization_assignments.update({
          where: { id: update.assignmentId },
          data: { teamId: update.teamId },
        })
      }

      for (const route of config.routes) {
        await tx.approval_route_versions.create({
          data: {
            id: route.id,
            scopeUnitId: route.scopeUnitId,
            phase: route.phase,
            version: route.version,
            status: 'PUBLISHED',
            createdById: fixture.actors.admin.id,
            publishedAt: new Date(),
            approvalLimitPositionId: route.approvalLimitPositionId,
            steps: {
              create: route.steps.map((step) => ({
                stepOrder: step.order,
                positionId: step.positionId,
              })),
            },
          },
        })
      }

      // Demonstrably point the application's mail transport at the owned
      // loopback capture endpoint (no auth → plaintext SMTP, no TLS upgrade),
      // with fixture-only recipients. Fail-closed enforcement additionally
      // comes from the outbound allowlist preload in the app process. The
      // sender is the shared seed-plan constant so the mail evaluator's
      // fixture-domain contract (@business.test) and the seeded fromAddress
      // cannot drift apart.
      await tx.email_settings.create({
        data: {
          id: 'default',
          enabled: true,
          provider: 'custom',
          host: '127.0.0.1',
          port: mailPort,
          username: null,
          passwordEncrypted: null,
          fromAddress: BUSINESS_FIXTURE_OUTBOUND_SENDER_ADDRESS,
        },
      })
    })

    const summary = {
      runId: resource.runId,
      routeConfiguration: routeName,
      routeVersions: config.routes.map((route) => ({ id: route.id, phase: route.phase, steps: route.steps.length })),
      users: Object.keys(fixture.actors).length,
      mailCapture: { host: '127.0.0.1', port: mailPort },
      passwordHashNote: 'all fixture accounts share the run-generated e2e password (hash only stored)',
    }
    console.log(JSON.stringify(summary, null, 2))
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error('seed failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
