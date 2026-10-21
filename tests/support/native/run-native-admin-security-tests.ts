import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertOwnedLoopbackDatabaseTarget,
  createSafeRunPlan,
  type OwnedDisposableResource,
} from '../business-workflow-safety'
import {
  PG_BIN,
  REQUIRED_DATABASE_NAME,
} from './native-environment'
import {
  createOwnedRuntime,
  ensureOwnedDatabase,
  ensureOwnedTmpParent,
  initdbCluster,
  psqlQuery,
  removeOwnedRuntimeRoot,
  startPostgres,
  stopPostgres,
  verifyOwnedMaintenanceIdentity,
  verifyPostgresIdentity,
  type OwnedRuntime,
} from './postgres-instance'
import { startMailCapture, type MailCaptureHandle } from './mail-capture'
import {
  OwnedResourceTracker,
  runChild,
  spawnApp,
  stopAppProcess,
  waitForHttpReady,
} from './runner-lifecycle'
import { captureAdminSecurityDbEvidence, type DbEvidenceResult } from './capture-admin-security-db-evidence'
import {
  adminInterruptedRunOutcome,
  resolveAdminSecurityRunOutcome,
  type AdminSecurityRunOutcome,
} from './admin-security-run-outcome'

/**
 * Native runner for the admin HTTP-security test runtime (test-only, no
 * Docker) — the isolated-harness counterpart of
 * run-native-business-tests.ts, closing the outstanding Astra review items
 * with REAL HTTP traffic against a separately owned app/database:
 *
 *   npx tsx tests/support/native/run-native-admin-security-tests.ts --mode=full
 *
 * Outcome contract (tests/regression/admin-runner-outcome.test.ts):
 * - in full mode the read-only DB evidence capture is MANDATORY: a capture
 *   that rejects, errors, or yields failed checks fails the WHOLE run —
 *   evidence absence is never treated as "no failures" (Astra finding 3);
 * - SIGINT/SIGTERM produce an interrupted summary and a NONZERO exit even
 *   when cleanup succeeds (Astra finding 6);
 *
 * Modes (default full):
 *   --mode=lifecycle-smoke  initdb → start → identity checks → stop → cleanup
 *                           (no schema push, no seed, no app, no browser)
 *   --mode=prepare          lifecycle + fresh owned DB + schema push +
 *                           partial unique indexes + admin fixture seed, stop
 *   --mode=full             prepare + fail-closed mail capture + isolated app
 *                           on an owned loopback port + admin-security
 *                           Playwright suite + read-only DB evidence
 *
 * Ownership/cleanup guarantees (inherited verbatim from the shared native
 * infrastructure, see run-native-business-tests.ts for the rationale):
 * - every started resource (postgres, app, mail capture, tmp dir) is tracked
 *   and stopped even on partial startup failure;
 * - if any resource stop FAILS, the owned runtime dir is PRESERVED — cleanup
 *   never deletes data it cannot prove was shut down;
 * - the app is spawned as its own process group and stopped as a whole;
 * - HTTP readiness only counts when the listening socket belongs to the
 *   owned app process group;
 * - Playwright intentionally receives NO DATABASE_URL: browser evidence
 *   only; DB verification stays in this runner (psql, read-only);
 * - the brew default cluster, brew services, port 3100 and port 5432 are
 *   never touched; no destructive admin API success action is ever executed
 *   by the runner (the authorized API control posts only reach the routes'
 *   validation-error paths).
 */

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(THIS_DIR, '..', '..', '..')

const MODES = ['lifecycle-smoke', 'prepare', 'full'] as const
type Mode = (typeof MODES)[number]

interface RunnerOptions {
  mode: Mode
  evidenceDir: string
}

function parseArgs(argv: string[]): RunnerOptions {
  let mode: Mode = 'full'
  let evidenceDir = path.join(REPO_ROOT, 'test-results', 'admin-native')
  for (const arg of argv) {
    if (arg.startsWith('--mode=')) {
      const value = arg.slice('--mode='.length)
      if (!(MODES as readonly string[]).includes(value)) throw new Error(`unknown mode ${value}`)
      mode = value as Mode
    } else if (arg.startsWith('--evidence-dir=')) {
      evidenceDir = path.resolve(arg.slice('--evidence-dir='.length))
    } else {
      throw new Error(`unknown argument ${arg}`)
    }
  }
  return { mode, evidenceDir }
}

function log(line: string): void {
  console.log(`[admin-native-runner ${new Date().toISOString()}] ${line}`)
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

const RSYNC_EXCLUDES = [
  '.env*',
  '.next',
  'node_modules',
  'uploads',
  '.git',
  '.worktrees',
  'worktrees',
  'test-results',
  'playwright-report',
  'graphify-out',
  'scratch',
] as const

async function copyAppSource(runtime: OwnedRuntime): Promise<string> {
  const appDir = path.join(runtime.paths.rootDir, 'app')
  await fs.mkdir(appDir, { mode: 0o700 })
  const args = ['-a']
  for (const exclude of RSYNC_EXCLUDES) args.push('--exclude', exclude)
  args.push(`${REPO_ROOT}/`, appDir)
  await runChild('/usr/bin/rsync', args, REPO_ROOT, { PATH: process.env.PATH ?? '/usr/bin:/bin' }, path.join(runtime.paths.logsDir, 'rsync.log'), 300_000)
  await fs.symlink(path.join(REPO_ROOT, 'node_modules'), path.join(appDir, 'node_modules'), 'dir')
  await fs.mkdir(path.join(appDir, 'uploads'), { recursive: true })
  return appDir
}

async function applyPartialUniqueIndexes(runtime: OwnedRuntime): Promise<void> {
  // Same hand-appended partial unique indexes the business runner applies
  // (extracted from the squashed init migration DDL; `prisma db push` cannot
  // express them and the seeder refuses to run without them).
  const statements = [
    `CREATE UNIQUE INDEX one_active_assignment_per_user ON organization_assignments ("userId") WHERE "isActive";`,
    `CREATE UNIQUE INDEX one_active_company_root ON organization_units ((1)) WHERE "parentId" IS NULL AND "isActive";`,
    `CREATE UNIQUE INDEX one_published_route_per_scope_phase ON approval_route_versions ("scopeUnitId", "phase") WHERE "status" = 'PUBLISHED';`,
    `CREATE UNIQUE INDEX one_active_team_name_per_unit ON teams ("unitId", "name") WHERE "isActive";`,
  ]
  for (const statement of statements) {
    await psqlQuery(runtime, REQUIRED_DATABASE_NAME, statement)
  }
  const present = await psqlQuery(
    runtime,
    REQUIRED_DATABASE_NAME,
    "select string_agg(indexname, ',') from pg_indexes where schemaname='public' and indexname like 'one_%'",
  )
  for (const required of [
    'one_active_assignment_per_user',
    'one_active_company_root',
    'one_published_route_per_scope_phase',
    'one_active_team_name_per_unit',
  ]) {
    if (!present.includes(required)) {
      throw new Error(`required partial unique index ${required} missing after apply (present: ${present})`)
    }
  }
}

async function pushOwnedSchema(runtime: OwnedRuntime, appDir: string): Promise<void> {
  const prismaBin = path.join(appDir, 'node_modules', '.bin', 'prisma')
  await runChild(
    prismaBin,
    ['db', 'push', '--skip-generate', '--accept-data-loss'],
    appDir,
    {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: process.env.HOME ?? '/tmp',
      DATABASE_URL: runtime.databaseUrl,
    },
    path.join(runtime.paths.logsDir, 'db-push.log'),
    600_000,
  )
}

async function seedAdminSecurityFixture(runtime: OwnedRuntime, appDir: string): Promise<void> {
  const tsxBin = path.join(appDir, 'node_modules', '.bin', 'tsx')
  await runChild(
    tsxBin,
    ['tests/support/native/seed-admin-security-fixture.ts'],
    appDir,
    {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: process.env.HOME ?? '/tmp',
      DATABASE_URL: runtime.databaseUrl,
      ADMIN_RUN_ID: runtime.runId,
      ADMIN_DB_PORT: String(runtime.ports.databasePort),
      ADMIN_SERVER_PORT: String(runtime.ports.serverPort),
      ADMIN_MAIL_PORT: String(runtime.ports.mailPort),
      ADMIN_E2E_PASSWORD: runtime.e2ePassword,
    },
    path.join(runtime.paths.logsDir, 'seed.log'),
    600_000,
  )
}

async function runPlaywrightAdminSecurity(
  runtime: OwnedRuntime,
  appDir: string,
  evidenceDir: string,
  baseUrl: string,
): Promise<void> {
  const env = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: process.env.HOME ?? '/tmp',
    TMPDIR: os.tmpdir(),
    ADMIN_TEST_BASE_URL: baseUrl,
    ADMIN_E2E_PASSWORD: runtime.e2ePassword,
    ADMIN_EVIDENCE_DIR: evidenceDir,
    ADMIN_RUN_ID: runtime.runId,
    // Read-only view of the app copy: the spec resolves REAL server-action
    // ids from the app-generated .next manifest of THIS run. It is never a
    // database handle — DATABASE_URL stays banned by the admin config.
    ADMIN_APP_DIR: appDir,
    // Playwright intentionally gets NO DATABASE_URL and NO SMTP variables:
    // browser/HTTP evidence only; DB assertions stay in this runner (psql).
    NEXT_TELEMETRY_DISABLED: '1',
  }
  await runChild(
    path.join(appDir, 'node_modules', '.bin', 'playwright'),
    ['test', '--config=tests/playwright.admin.config.ts'],
    appDir,
    env,
    path.join(evidenceDir, 'playwright-run.log'),
    3_600_000,
  )
}

async function assertEnvironmentPrerequisites(): Promise<void> {
  for (const exe of ['initdb', 'pg_ctl', 'postgres', 'psql']) {
    if (!(await exists(path.join(PG_BIN, exe)))) {
      throw new Error(`missing native PostgreSQL binary ${path.join(PG_BIN, exe)}`)
    }
  }
  if (!(await exists(path.join(REPO_ROOT, 'node_modules', '.bin', 'next')))) {
    throw new Error('missing node_modules — run npm install in the repository first')
  }
  const brewDefaultCluster = '/opt/homebrew/var/postgresql@16'
  if (REPO_ROOT === brewDefaultCluster) throw new Error('SAFETY: impossible repo path collision')
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  await assertEnvironmentPrerequisites()

  await fs.mkdir(options.evidenceDir, { recursive: true, mode: 0o700 })
  const runStamp = new Date().toISOString().replace(/[:.]/g, '-')
  const runEvidenceDir = path.join(options.evidenceDir, `${runStamp}-${options.mode}`)
  await fs.mkdir(runEvidenceDir, { mode: 0o700 })
  const tmpParent = path.join(os.tmpdir(), 'business-test-native')
  await ensureOwnedTmpParent(tmpParent)

  const tracker = new OwnedResourceTracker()
  let runtime: OwnedRuntime | null = null
  let appDir: string | null = null
  let mail: MailCaptureHandle | null = null
  let removedRoot = false
  let cleanupFailures: string[] = []
  let cleanupStarted = false

  const captureRunArtifacts = async (): Promise<{ dbEvidence: DbEvidenceResult | null; dbCaptureError: string | null }> => {
    let dbEvidence: DbEvidenceResult | null = null
    let dbCaptureError: string | null = null
    if (runtime && options.mode === 'full') {
      // DB evidence is MANDATORY in full mode (Astra finding 3): the capture
      // error is returned, never swallowed — the run-outcome resolver turns
      // a rejected/errored capture into a full run failure even though
      // cleanup still runs afterwards.
      try {
        dbEvidence = await captureAdminSecurityDbEvidence(runtime, runEvidenceDir)
        log(`admin-security DB evidence captured to ${dbEvidence.file} (${dbEvidence.checks.length} checks, ${dbEvidence.failures.length} failing)`)
      } catch (error) {
        dbCaptureError = error instanceof Error ? error.message : String(error)
        log(`could not capture admin-security DB evidence: ${dbCaptureError}`)
      }
    }
    if (runtime) {
      try {
        await fs.cp(runtime.paths.logsDir, path.join(runEvidenceDir, 'owned-runtime-logs'), { recursive: true })
      } catch {
        // best effort
      }
      try {
        const blocked = await fs.readFile(path.join(runtime.paths.logsDir, 'blocked-connections.jsonl'), 'utf8')
        await fs.writeFile(path.join(runEvidenceDir, 'blocked-connections.jsonl'), blocked)
      } catch {
        // No blocked connections is a valid outcome.
      }
    }
    return { dbEvidence, dbCaptureError }
  }

  const writeRunSummaryAndIndex = async (input: {
    status: 'passed' | 'failed' | 'interrupted'
    error?: string
    dbEvidence: DbEvidenceResult | null
  }): Promise<void> => {
    const rootPreserved = runtime !== null && !removedRoot
    await fs.writeFile(
      path.join(runEvidenceDir, 'run-summary.json'),
      JSON.stringify({
        runId: runtime?.runId ?? null,
        mode: options.mode,
        status: input.status,
        error: input.error ?? null,
        ports: runtime?.ports ?? null,
        adminDbEvidence: input.dbEvidence
          ? {
              file: input.dbEvidence.file,
              checks: input.dbEvidence.checks.length,
              failedChecks: input.dbEvidence.failures.length,
            }
          : null,
        cleanupFailures,
        runtimeRootPreserved: rootPreserved,
        finishedAt: new Date().toISOString(),
      }, null, 2),
    )
    const index = [
      '# Admin HTTP-security native run evidence',
      '',
      `- Run: ${runtime?.runId ?? 'unknown'} (${options.mode}) — status: ${input.status}`,
      ...(input.status === 'interrupted'
        ? ['- OUTCOME: interrupted — the suite did NOT complete; no final check summary is valid for this run']
        : []),
      ...(input.error ? [`- Failure: ${input.error}`] : []),
      ...(cleanupFailures.length > 0 ? [`- Cleanup failures (${cleanupFailures.length}; runtime dir preserved): ${cleanupFailures.join(' | ')}`] : []),
      `- Ports: db=${runtime?.ports.databasePort ?? '?'} app=${runtime?.ports.serverPort ?? '?'} mail=${runtime?.ports.mailPort ?? '?'}`,
      ...(input.dbEvidence
        ? [
            `- Admin DB evidence: ${input.dbEvidence.file} — ${input.dbEvidence.checks.length} checks, ${input.dbEvidence.failures.length} failing`,
            ...input.dbEvidence.failures.slice(0, 20).map((failure) => `  - FAILED CHECK: ${failure}`),
          ]
        : ['- Admin DB evidence: not captured (mode or capture error)']),
      '- Playwright output: playwright-output/, playwright-run.log',
      ...(rootPreserved ? ['- Owned runtime dir PRESERVED (resources could not be proven stopped): inspect owned-runtime-logs/ and the data dir manually.'] : []),
    ].join('\n')
    await fs.writeFile(path.join(runEvidenceDir, 'evidence-index.md'), index)
  }

  const cleanup = async (phase: string): Promise<string[]> => {
    if (cleanupStarted) return cleanupFailures
    cleanupStarted = true
    cleanupFailures = await tracker.stopAll((message) => log(`CLEANUP WARNING (${phase}): ${message}`))
    if (mail) {
      // A mail-capture close failure is a cleanup failure (recorded, not
      // swallowed) so the owned runtime dir is preserved for inspection.
      try {
        await mail.close()
      } catch (error) {
        const message = `mail capture close failed: ${error instanceof Error ? error.message : String(error)}`
        cleanupFailures.push(message)
        log(`CLEANUP WARNING (mail): ${message}`)
      }
      mail = null
    }
    if (runtime && !removedRoot) {
      if (cleanupFailures.length === 0) {
        try {
          await removeOwnedRuntimeRoot(runtime.paths)
          removedRoot = true
          log(`removed owned runtime dir ${runtime.paths.rootDir}`)
        } catch (error) {
          const message = `runtime root removal failed: ${error instanceof Error ? error.message : String(error)}`
          cleanupFailures.push(message)
          log(`SAFETY: ${message} — preserving ${runtime.paths.rootDir}`)
        }
      } else {
        log(`SAFETY: preserving owned runtime dir ${runtime.paths.rootDir} — ${cleanupFailures.length} resource stop(s) failed; data dir and logs are NOT deleted`)
      }
      if (!removedRoot) {
        try {
          await fs.cp(runtime.paths.logsDir, path.join(runEvidenceDir, 'owned-runtime-logs'), { recursive: true })
        } catch { /* best effort */ }
      }
    }
    return cleanupFailures
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void (async () => {
        log(`received ${signal} — recording interrupted outcome, then stopping owned resources`)
        // Cleanup FIRST (every tracked resource, mail, runtime-dir policy),
        // then the interrupted outcome: an interrupted run NEVER exits zero,
        // even when cleanup fully succeeds (Astra finding 6).
        const failures = await cleanup(`signal-${signal}`)
        const outcome: AdminSecurityRunOutcome = adminInterruptedRunOutcome(signal, failures)
        await writeRunSummaryAndIndex({
          status: outcome.status,
          error: outcome.error ?? undefined,
          dbEvidence: null,
        })
        log(`INTERRUPTED: ${outcome.error} — exiting ${outcome.exitCode}`)
        process.exit(outcome.exitCode)
      })()
      setTimeout(() => process.exit(1), 30_000).unref()
    })
  }

  try {
    runtime = await createOwnedRuntime({ parentDir: tmpParent })
    log(`run ${runtime.runId}: owned ports db=${runtime.ports.databasePort} app=${runtime.ports.serverPort} mail=${runtime.ports.mailPort}`)
    log(`owned runtime dir ${runtime.paths.rootDir}`)

    // 1. Native PostgreSQL lifecycle.
    await initdbCluster(runtime)
    log('cluster initialized (SCRAM-SHA-256, run-generated password)')
    tracker.register({ kind: 'postgres', stop: () => stopPostgres(runtime as OwnedRuntime) })
    const postmasterPid = await startPostgres(runtime)
    log(`postgres started, postmaster PID ${postmasterPid}`)
    await verifyOwnedMaintenanceIdentity(runtime)
    log('identity verified against postgres maintenance DB (read-only contract)')

    // 2. Fresh owned database + schema + admin fixture.
    if (options.mode !== 'lifecycle-smoke') {
      await ensureOwnedDatabase(runtime)
      await verifyPostgresIdentity(runtime, REQUIRED_DATABASE_NAME)
      log(`owned database ${REQUIRED_DATABASE_NAME} created and identity re-verified before any write`)
      assertOwnedLoopbackDatabaseTarget(runtime.databaseUrl, runtime.resource satisfies OwnedDisposableResource)
      createSafeRunPlan({
        databaseUrl: runtime.databaseUrl,
        resource: runtime.resource,
        mail: { mode: 'LOOPBACK_CAPTURE', host: '127.0.0.1', port: runtime.ports.mailPort, fallbackTransport: 'DISABLED' },
      })

      appDir = await copyAppSource(runtime)
      log(`isolated app copy at ${appDir}`)
      await pushOwnedSchema(runtime, appDir)
      log('schema pushed with prisma db push (fresh owned DB only — no migrations run)')
      await applyPartialUniqueIndexes(runtime)
      log('required partial unique indexes applied and verified')
      await seedAdminSecurityFixture(runtime, appDir)
      log('admin-security fixture seeded (all records disposable, dropped with the owned cluster)')
    }

    if (options.mode === 'lifecycle-smoke' || options.mode === 'prepare') {
      log(`mode ${options.mode} complete — stopping owned resources`)
      const artifacts = await captureRunArtifacts()
      const failures = await cleanup('normal-end')
      const outcome = resolveAdminSecurityRunOutcome({
        mode: options.mode,
        dbEvidence: artifacts.dbEvidence,
        dbCaptureError: artifacts.dbCaptureError,
        cleanupFailures: failures,
      })
      await writeRunSummaryAndIndex({
        status: outcome.status,
        error: outcome.error ?? undefined,
        dbEvidence: artifacts.dbEvidence,
      })
      if (outcome.exitCode !== 0) {
        process.exitCode = outcome.exitCode
        log(`mode ${options.mode} finished with failures — see run-summary.json: ${outcome.error}`)
      }
      return
    }

    // 3. Fail-closed mail capture, then the isolated app.
    mail = await startMailCapture({ host: '127.0.0.1', port: runtime.ports.mailPort })
    log(`mail capture listening on 127.0.0.1:${runtime.ports.mailPort}`)

    const preloadPath = path.join(appDir as string, 'tests', 'support', 'native', 'outbound-allowlist-preload.js')
    const app = spawnApp(runtime, appDir as string, preloadPath, path.join(runtime.paths.logsDir, 'next-dev.log'))
    tracker.register({
      kind: 'app',
      stop: () => stopAppProcess(app, appDir as string),
    })
    const baseUrl = `http://127.0.0.1:${runtime.ports.serverPort}`
    await waitForHttpReady(`${baseUrl}/sign-in`, runtime.ports.serverPort, app.pid, 240_000)
    log(`app ready at ${baseUrl} (PID ${app.pid}, owned process group verified)`)

    // 4. Admin-security Playwright suite (real action wire + admin APIs).
    await runPlaywrightAdminSecurity(runtime, appDir as string, runEvidenceDir, baseUrl)
    log('playwright admin-security suite finished')

    // 5. Read-only DB evidence BEFORE stopping resources, then cleanup.
    const artifacts = await captureRunArtifacts()
    const failures = await cleanup('normal-end')
    const outcome = resolveAdminSecurityRunOutcome({
      mode: options.mode,
      dbEvidence: artifacts.dbEvidence,
      dbCaptureError: artifacts.dbCaptureError,
      cleanupFailures: failures,
    })
    await writeRunSummaryAndIndex({
      status: outcome.status,
      error: outcome.error ?? undefined,
      dbEvidence: artifacts.dbEvidence,
    })
    log(`evidence written to ${runEvidenceDir}`)
    if (outcome.exitCode !== 0) {
      process.exitCode = outcome.exitCode
      log(`FAILURE: ${outcome.error}`)
    }
  } catch (error) {
    log(`FAILURE: ${error instanceof Error ? error.message : error}`)
    const artifacts = await captureRunArtifacts()
    await cleanup('failure')
    await writeRunSummaryAndIndex({
      status: 'failed',
      error: [
        error instanceof Error ? error.message : String(error),
        // In full mode a missing capture is reported even on the failure
        // path — the summary must never imply evidence exists when it does
        // not (Astra finding 3).
        ...(options.mode === 'full' && !artifacts.dbEvidence
          ? [artifacts.dbCaptureError
              ? `admin-security DB evidence capture also failed: ${artifacts.dbCaptureError}`
              : 'admin-security DB evidence was not captured (run failed before the evidence step)']
          : []),
      ].join('; '),
      dbEvidence: artifacts.dbEvidence,
    })
    process.exitCode = 1
    throw error
  }
}

main().catch((error) => {
  log(`runner failed: ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
})
