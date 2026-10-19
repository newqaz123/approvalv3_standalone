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
  collectionOnlyEnvironment,
  parseArgs,
  playwrightBusinessArgs,
  runScenarioListGate,
  type RunnerCliOptions,
} from './business-runner-cli'
import {
  PG_BIN,
  REQUIRED_DATABASE_NAME,
  isOwnedRunId,
} from './native-environment'
import {
  createOwnedRuntime,
  ensureOwnedDatabase,
  ensureOwnedTmpParent,
  initdbCluster,
  isPortListening,
  psqlQuery,
  readPostmasterPid,
  removeOwnedRuntimeRoot,
  startPostgres,
  stopPostgres,
  verifyOwnedMaintenanceIdentity,
  verifyPostgresIdentity,
  type OwnedRuntime,
} from './postgres-instance'
import { startMailCapture, summarizeCapturedMessages, type MailCaptureHandle } from './mail-capture'
import { captureWorkflowDbEvidence, type DbEvidenceResult } from './capture-workflow-db-evidence'
import {
  decideBusinessEvidenceGate,
  t15aEvidenceApplies,
  t18bEvidenceApplies,
  t18c2EvidenceApplies,
  type DbCaptureState,
} from './business-evidence-gate'
import { captureWorkflowMailEvidence, type MailEvidenceResult } from './capture-workflow-mail-evidence'
import {
  OwnedResourceTracker,
  runChild,
  spawnApp,
  stopAppProcess,
  waitForHttpReady,
} from './runner-lifecycle'

/**
 * Native runner for the business-workflow test runtime (test-only, no Docker).
 *
 *   npx tsx tests/support/native/run-native-business-tests.ts --mode=full
 *
 * Modes (default full):
 *   --mode=lifecycle-smoke  initdb → start → identity checks → stop → cleanup
 *                           (no schema push, no seed, no app, no browser)
 *   --mode=prepare          lifecycle + fresh owned DB + schema push +
 *                           partial unique indexes + fixture seed, then stop
 *   --mode=full             prepare + mail capture + isolated app on an owned
 *                           port + business-only Playwright smoke with
 *                           video/trace/screenshots + evidence index
 *
 * Focused scenario selection (validated options, default UNCHANGED —
 * the full suite runs when no --scenario is given):
 *   --scenario=T18B         full mode, all-defaults profile only: the
 *                           Playwright suite runs ONLY the T18B test via a
 *                           fixed `--grep=\bT18B\b` argv element (no shell).
 *                           The selection is re-verified with a
 *                           collection-only `playwright --list` count over
 *                           the same seam before any browser test executes
 *                           (zero/multiple matches abort the run). Fixture
 *                           seed, mail capture, T18B DB correlation/history
 *                           evidence and the evidence gate are all unchanged:
 *                           a focused T18B run still REQUIRES the T18B
 *                           browser correlation.
 *   --scenario=T18C2        focused selection under the SAME restrictions
 *                           (full mode, all-defaults only, fixed
 *                           `--grep=\bT18C2\b`, exactly-1 listing gate, no
 *                           arbitrary grep). T18B does not execute, so its
 *                           browser correlation is NOT required; the DB
 *                           evaluator records T18B as an explicit
 *                           not-selected SKIPPED entry (no coverage claimed).
 *                           Task24: the T18C2 browser correlation (exact
 *                           created title, t18c2-browser-correlation.json)
 *                           is REQUIRED for this selection — the runner-owned
 *                           read-only DB evaluator asserts the persisted
 *                           all-vacant auto-completion outcome against it.
 *   --scenario=T04B        focused selection under the SAME restrictions
 *                           (full mode, all-defaults only, fixed
 *                           `--grep=\bT04B\b`, exactly-1 listing gate, no
 *                           arbitrary grep). T18B/T18C2 do not execute, so
 *                           their browser correlations are NOT required (the
 *                           DB evaluator records each as an explicit
 *                           not-selected SKIPPED entry; the DEFAULT full run
 *                           still requires BOTH). No expectation is relaxed:
 *                           the T04B completion checks still FAIL honestly
 *                           when the flow does not complete; the DB capture
 *                           retains the failing run's FINAL candidate groups
 *                           and instance rows for post-run diagnosis
 *                           (Task28, test-harness only — no app change).
 *   --scenario=T12A        focused selection under the SAME restrictions
 *                           (full mode, all-defaults only, fixed
 *                           `--grep=\bT12 in-app notification recipients\b`,
 *                           exactly-1 listing gate). Task41 also makes the
 *                           T12A recipient-matrix MAIL evidence REQUIRED for
 *                           this selection; other selections skip it.
 *   --scenario=T15A        focused selection under the SAME restrictions
 *                           (full mode, all-defaults only, fixed
 *                           `--grep=\bT15A\b`, exactly-1 listing gate, no
 *                           arbitrary grep) added by Task52 for the rapid
 *                           double-click Final-trigger MEASUREMENT slice.
 *                           It adds NO required evidence of its own (the
 *                           spec's t15a-browser-correlation.json is a
 *                           bounded measurement artifact for the LATER
 *                           persisted-DB gate task); every other scenario's
 *                           requirement is preserved — T18B/T18C2
 *                           correlations and the T12A mail matrix stay
 *                           REQUIRED for the default full run and are
 *                           explicit not-selected skips here.
 *   --scenario=T16A        diagnosis-only selection under the SAME
 *                           restrictions (full mode, all-defaults only,
 *                           fixed `--grep=\bT16A\b`, exactly-1 listing
 *                           gate, no arbitrary grep). It adds no required
 *                           evidence of its own. Other scenarios do not
 *                           execute, so their required correlations are
 *                           explicit not-selected skips. The default full
 *                           run is unchanged.
 *   --scenario=T11B        diagnosis-only selection under the SAME
 *                           restrictions (full mode, all-defaults only,
 *                           fixed `--grep=\bT11B\b`, exactly-1 listing
 *                           gate, no arbitrary grep). It adds no required
 *                           evidence of its own. Other scenarios do not
 *                           execute, so their required correlations are
 *                           explicit not-selected skips. The default full
 *                           run is unchanged.
 *   --list                  collection-only listing (synthetic env, no
 *                           PostgreSQL/app/browser): prints the matched test
 *                           titles and total. With a --scenario selection
 *                           exactly one matched test is required; without it
 *                           the default full-suite listing is shown.
 *
 * Ownership/cleanup guarantees:
 * - every started resource (postgres, app, mail capture, tmp dir) is tracked
 *   and stopped even on partial startup failure (the postgres stop hook is
 *   registered BEFORE pg_ctl start runs, so a half-started cluster is still
 *   stopped, never orphaned);
 * - if any resource stop FAILS, the owned runtime dir (data dir + logs) is
 *   PRESERVED — cleanup never deletes data it cannot prove was shut down;
 * - postgres is only stopped after postmaster.pid matches the recorded PID,
 *   the process command still points at the owned binary/data dir;
 * - the app is spawned as its own process group and stopped as a whole
 *   (identity re-verified via ps first; descendants included in the kill);
 * - HTTP readiness only counts when the listening socket belongs to the
 *   owned app process group — a foreign listener on the owned port aborts;
 * - one-shot children (rsync/prisma/tsx/playwright) are hard-bounded with
 *   timeouts and SIGKILL so the runner can never hang on a stuck child;
 * - only the owned mkdtemp dir is ever removed; evidence and logs live in a
 *   separate evidence directory and are never deleted; on ANY failure the
 *   captured mail, blocked-connection log, runtime logs, run-summary.json
 *   and evidence-index.md are still written;
 * - the brew default cluster (/opt/homebrew/var/postgresql@16), brew services,
 *   port 3100 and port 5432 are never touched.
 */

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(THIS_DIR, '..', '..', '..')

// CLI parsing/validation (including the single validated --scenario=T18B
// focused selection and the collection-only --list mode) lives in
// ./business-runner-cli (import-safe) so it can be regression-tested without
// executing this runner's main().

function log(line: string): void {
  console.log(`[native-runner ${new Date().toISOString()}] ${line}`)
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false }
}

// runChild/spawnApp/stopAppProcess/waitForHttpReady live in ./runner-lifecycle
// (import-safe) so their safety behavior can be regression-tested without
// executing this runner's main().

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
  // These are exactly the hand-appended partial unique indexes the disposable
  // CI integration infrastructure (tests/integration/clean-start-constraints)
  // requires; extracted from the squashed init migration DDL. `prisma db push`
  // cannot express them, so the owned schema is incomplete without them.
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

async function seedOwnedFixture(runtime: OwnedRuntime, appDir: string, routesConfig: string): Promise<void> {
  const tsxBin = path.join(appDir, 'node_modules', '.bin', 'tsx')
  await runChild(
    tsxBin,
    ['tests/support/native/seed-business-fixture.ts'],
    appDir,
    {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: process.env.HOME ?? '/tmp',
      DATABASE_URL: runtime.databaseUrl,
      BUSINESS_RUN_ID: runtime.runId,
      BUSINESS_DB_PORT: String(runtime.ports.databasePort),
      BUSINESS_SERVER_PORT: String(runtime.ports.serverPort),
      BUSINESS_MAIL_PORT: String(runtime.ports.mailPort),
      BUSINESS_E2E_PASSWORD: runtime.e2ePassword,
      BUSINESS_ROUTES_CONFIG: routesConfig,
    },
    path.join(runtime.paths.logsDir, 'seed.log'),
    600_000,
  )
}

// The collection-only listing gate lives in ./business-runner-cli
// (runScenarioListGate): it requires the listing child to complete
// successfully, parses only the CURRENT invocation's fresh unique log, and
// fails closed on zero/multiple focused matches. There is deliberately NO
// rescue-parse of a failed child's or a prior invocation's log here.

async function runPlaywrightBusiness(
  runtime: OwnedRuntime,
  appDir: string,
  evidenceDir: string,
  baseUrl: string,
  routesConfig: string,
  scenario?: RunnerCliOptions['scenario'],
): Promise<void> {
  const env = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: process.env.HOME ?? '/tmp',
    TMPDIR: os.tmpdir(),
    BUSINESS_TEST_BASE_URL: baseUrl,
    BUSINESS_E2E_PASSWORD: runtime.e2ePassword,
    BUSINESS_EVIDENCE_DIR: evidenceDir,
    BUSINESS_RUN_ID: runtime.runId,
    // Explicit validated route-configuration profile: the browser suite skips
    // scenarios that do not belong to this profile (visible skip annotations,
    // never counted as coverage).
    BUSINESS_ROUTES_CONFIG: routesConfig,
    // Owned test-mail capture port as PROVENANCE METADATA ONLY (fixture
    // mail-evidence correlation for THIS run): it is not transport
    // configuration and grants no mail-server capability. Playwright still
    // intentionally gets NO DATABASE_URL, NO SMTP credentials and NO
    // standard SMTP transport variables (SMTP_*/MAIL_* hosts, users,
    // passwords): browser evidence only, no direct business DB or
    // mail-server access from the spec.
    BUSINESS_MAIL_PORT: String(runtime.ports.mailPort),
    NEXT_TELEMETRY_DISABLED: '1',
  }
  const playwrightBin = path.join(appDir, 'node_modules', '.bin', 'playwright')
  if (scenario) {
    // Reject the focused selection when it does not match EXACTLY ONE test:
    // zero or multiple matches mean the fixed grep no longer isolates the
    // scenario — abort BEFORE any browser test executes. The gate fails
    // closed: a nonzero/timeout listing process or an unparsable total
    // rejects the run, and only this invocation's fresh log is parsed.
    const gate = await runScenarioListGate({
      command: playwrightBin,
      cwd: appDir,
      env,
      baseDir: evidenceDir,
      scenario,
    })
    log(`scenario selection ${scenario}: collection-only listing matched exactly 1 test (${gate.logFile})`)
  }
  await runChild(
    playwrightBin,
    playwrightBusinessArgs(scenario),
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
  // The brew default cluster is never referenced anywhere in this runner; keep
  // an explicit tripwire so a future edit cannot silently change that.
  const brewDefaultCluster = '/opt/homebrew/var/postgresql@16'
  if (REPO_ROOT === brewDefaultCluster) throw new Error('SAFETY: impossible repo path collision')
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))

  // Collection-only listing: NO PostgreSQL, NO app copy, NO browser, NO live
  // HTTP, NO DATABASE_URL. Prints the matched test titles and exits; with a
  // scenario selection exactly one matched test is required. The gate fails
  // closed on any nonzero/timeout listing process and parses only this
  // invocation's fresh unique log (prior listing evidence is preserved).
  if (options.list) {
    const listDir = path.join(options.evidenceDir, 'list')
    await fs.mkdir(listDir, { recursive: true, mode: 0o700 })
    const gate = await runScenarioListGate({
      command: path.join(REPO_ROOT, 'node_modules', '.bin', 'playwright'),
      cwd: REPO_ROOT,
      env: collectionOnlyEnvironment(listDir),
      baseDir: listDir,
      scenario: options.scenario,
    })
    console.log(gate.output.trimEnd())
    log(`collection-only listing: ${gate.total} test(s) matched${options.scenario ? ` (scenario selection ${options.scenario})` : ' (default full suite)'} — ${gate.logFile}`)
    return
  }

  await assertEnvironmentPrerequisites()
  if (options.scenario) {
    log(`scenario selection ${options.scenario}: focused browser suite (default without --scenario is the unchanged full suite)`) 
  }

  await fs.mkdir(options.evidenceDir, { recursive: true, mode: 0o700 })
  const runStamp = new Date().toISOString().replace(/[:.]/g, '-')
  const runEvidenceDir = path.join(options.evidenceDir, `${runStamp}-${options.mode}`)
  await fs.mkdir(runEvidenceDir, { mode: 0o700 })
  const tmpParent = path.join(os.tmpdir(), 'business-test-native')
  // Repeat-safe: an existing owned tmp parent is verified (real dir, not a
  // symlink, current user, not group/world writable) instead of EEXISTing.
  await ensureOwnedTmpParent(tmpParent)

  const tracker = new OwnedResourceTracker()
  let runtime: OwnedRuntime | null = null
  let appDir: string | null = null
  let mail: MailCaptureHandle | null = null
  let removedRoot = false
  let cleanupFailures: string[] = []
  let cleanupStarted = false

  interface RunArtifacts {
    mailSummary: ReturnType<typeof summarizeCapturedMessages> | null
    dbEvidence: DbEvidenceResult | null
    dbCapture: DbCaptureState
    mailEvidence: MailEvidenceResult | null
    /** Terminal state of the mail-evidence capture (full runs REQUIRE it — Task41). */
    mailCapture: DbCaptureState
  }

  // Capture evidence that must be read BEFORE owned resources are stopped:
  // captured mail, durable workflow DB evidence (psql, read-only), blocked-
  // connection log, runtime logs. Every step is optional/best-effort so the
  // failure path can always run it — except that DB-evidence CHECK failures
  // are surfaced separately as run failures by writeRunSummaryAndIndex.
  const captureRunArtifacts = async (): Promise<RunArtifacts> => {
    let mailSummary: RunArtifacts['mailSummary'] = null
    let dbEvidence: RunArtifacts['dbEvidence'] = null
    let dbCapture: DbCaptureState = options.mode === 'lifecycle-smoke' ? 'not-applicable' : 'null'
    let mailEvidence: RunArtifacts['mailEvidence'] = null
    // The loopback mail capture + evaluator only exist in full mode; every
    // other state below is a terminal fail-closed answer, never "absent".
    let mailCapture: DbCaptureState = options.mode === 'full' ? 'null' : 'not-applicable'
    if (mail) {
      mailSummary = summarizeCapturedMessages(mail.messages())
      try {
        await fs.writeFile(
          path.join(runEvidenceDir, 'captured-mail.json'),
          JSON.stringify({ note: 'fixture-only recipients; raw SMTP wire text retained', messages: mailSummary }, null, 2),
        )
      } catch (error) {
        log(`could not write captured-mail.json: ${String(error)}`)
      }
    }
    if (runtime && options.mode !== 'lifecycle-smoke') {
      // Read-only psql capture of the persisted workflow truth (route ids,
      // ordered steps, captured candidates, origins, decisions, transitions)
      // BEFORE cleanup drops the owned database. Best-effort wrapper: a
      // capture crash must not mask the original browser-run outcome; the
      // CHECK results inside a successful capture DO fail the run.
      try {
        dbEvidence = await captureWorkflowDbEvidence(runtime, runEvidenceDir, options.routesConfig, {
          requireT18b: t18bEvidenceApplies(options.mode, options.routesConfig, options.scenario),
          requireT18c2: t18c2EvidenceApplies(options.mode, options.routesConfig, options.scenario),
          requireT15a: t15aEvidenceApplies(options.mode, options.routesConfig, options.scenario),
          focusedScenario: options.scenario,
        })
        dbCapture = dbEvidence.failures.length > 0 ? 'failed' : 'success'
        log(`workflow DB evidence captured to ${dbEvidence.file} (${dbEvidence.checks.length} checks, ${dbEvidence.failures.length} failing)`)
      } catch {
        dbCapture = 'thrown'
        // The capture failure is deliberately UNBOUND and never read — only
        // this fixed category is logged (no instanceof/.message/String, no
        // raw payload of any kind, even for Error rejections).
        log('could not capture workflow DB evidence: DB_EVIDENCE_CAPTURE_FAILED')
      }
      // T13: evaluator checks over the loopback mail capture (fixture
      // domains, zero mail to non-participants, expected recipient matrix
      // for the T12A workflow). Same best-effort wrapper; CHECK failures
      // inside a successful capture DO fail the run. Task41: the capture
      // state is tracked and the gate fails closed on thrown/missing mail
      // evidence for full runs, and the T12A matrix is REQUIRED for the
      // default full run and the focused T12A selection.
      if (mail && mailSummary) {
        try {
          mailEvidence = await captureWorkflowMailEvidence(runtime, runEvidenceDir, options.routesConfig, mailSummary, options.scenario)
          mailCapture = mailEvidence.failures.length > 0 ? 'failed' : 'success'
          const failed = mailEvidence.failures.length
          log(`workflow mail evidence captured to ${mailEvidence.file} (${mailEvidence.checks.length} checks, ${failed} failing)`)
        } catch (error) {
          mailCapture = 'thrown'
          log(`could not capture workflow mail evidence: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    if (runtime) {
      try {
        await fs.cp(runtime.paths.logsDir, path.join(runEvidenceDir, 'owned-runtime-logs'), { recursive: true })
      } catch (copyError) {
        log(`could not preserve runtime logs: ${String(copyError)}`)
      }
      try {
        const blocked = await fs.readFile(path.join(runtime.paths.logsDir, 'blocked-connections.jsonl'), 'utf8')
        await fs.writeFile(path.join(runEvidenceDir, 'blocked-connections.jsonl'), blocked)
      } catch {
        // No blocked connections is a valid outcome.
      }
    }
    return { mailSummary, dbEvidence, dbCapture, mailEvidence, mailCapture }
  }

  const evidenceDecision = (
    artifacts: RunArtifacts,
    primaryError: string | undefined,
    cleanupFailureList: readonly string[],
  ) => decideBusinessEvidenceGate({
    mode: options.mode,
    routesConfig: options.routesConfig,
    dbCapture: artifacts.dbCapture,
    dbFailureCount: artifacts.dbEvidence?.failures.length ?? 0,
    mailCapture: artifacts.mailCapture,
    mailFailureCount: artifacts.mailEvidence?.failures.length ?? 0,
    primaryError,
    cleanupFailures: cleanupFailureList,
  })

  // Written in EVERY terminal state (pass, cleanup failure, run failure) so
  // the failure path keeps the same captured-mail/evidence index as success.
  // A successful browser run whose workflow DB-evidence CHECKS fail is still
  // recorded as failed: an unexpected chain/origin/status outcome must never
  // be silently swallowed.
  const writeRunSummaryAndIndex = async (input: {
    status: 'passed' | 'failed'
    error?: string
    artifacts: RunArtifacts
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
        routesConfiguration: options.routesConfig,
        selectedScenario: options.scenario ?? null,
        capturedMailMessages: input.artifacts.mailSummary?.length ?? 0,
        mailEvidenceCapture: input.artifacts.mailCapture,
        workflowDbEvidence: input.artifacts.dbEvidence
          ? {
              file: input.artifacts.dbEvidence.file,
              checks: input.artifacts.dbEvidence.checks.length,
              failedChecks: input.artifacts.dbEvidence.failures.length,
              skippedChecks: input.artifacts.dbEvidence.checks.filter((check) => check.status === 'skipped').length,
            }
          : null,
        workflowMailEvidence: input.artifacts.mailEvidence
          ? {
              file: input.artifacts.mailEvidence.file,
              checks: input.artifacts.mailEvidence.checks.length,
              failedChecks: input.artifacts.mailEvidence.failures.length,
              skippedChecks: input.artifacts.mailEvidence.checks.filter((check) => check.status === 'skipped').length,
            }
          : null,
        cleanupFailures,
        runtimeRootPreserved: rootPreserved,
        finishedAt: new Date().toISOString(),
        note: options.mode === 'lifecycle-smoke'
          ? 'No app or browser was launched in this mode; no business rows were written for lifecycle-smoke.'
          : undefined,
      }, null, 2),
    )
    const index = [
      '# Business workflow native run evidence',
      '',
      `- Run: ${runtime?.runId ?? 'unknown'} (${options.mode}) — status: ${input.status}`,
      ...(input.error ? [`- Failure: ${input.error}`] : []),
      ...(cleanupFailures.length > 0 ? [`- Cleanup failures (${cleanupFailures.length}; runtime dir preserved): ${cleanupFailures.join(' | ')}`] : []),
      `- Ports: db=${runtime?.ports.databasePort ?? '?'} app=${runtime?.ports.serverPort ?? '?'} mail=${runtime?.ports.mailPort ?? '?'}`,
      ...(options.scenario
        ? [`- Scenario selection: ${options.scenario} (focused run — only this scenario executed; every other scenario check is explicitly skipped, never counted as coverage)`]
        : ['- Scenario selection: none (default full suite)']),
      `- Captured mail messages: ${input.artifacts.mailSummary?.length ?? 0}`,
      ...(input.artifacts.dbEvidence
        ? [
            `- Workflow DB evidence: ${input.artifacts.dbEvidence.file} — ${input.artifacts.dbEvidence.checks.length} checks, ${input.artifacts.dbEvidence.failures.length} failing, ${input.artifacts.dbEvidence.checks.filter((check) => check.status === 'skipped').length} skipped (no coverage claimed)`,
            ...input.artifacts.dbEvidence.failures.slice(0, 10).map((failure) => `  - FAILED CHECK: ${failure}`),
          ]
        : ['- Workflow DB evidence: not captured (mode or capture error)']),
      ...(input.artifacts.mailEvidence
        ? [
            `- Workflow mail evidence: ${input.artifacts.mailEvidence.file} — ${input.artifacts.mailEvidence.checks.length} checks, ${input.artifacts.mailEvidence.failures.length} failing, ${input.artifacts.mailEvidence.checks.filter((check) => check.status === 'skipped').length} skipped (no coverage claimed)`,
            ...input.artifacts.mailEvidence.failures.slice(0, 10).map((failure) => `  - FAILED CHECK: ${failure}`),
          ]
        : ['- Workflow mail evidence: not captured (mode or capture error)']),
      '- Playwright output: playwright-output/ (videos, traces), playwright-run.log',
      ...(rootPreserved ? ['- Owned runtime dir PRESERVED (resources could not be proven stopped): inspect owned-runtime-logs/ and the data dir manually.'] : []),
      '',
      'Scenario results are listed by the spec evidence manifest and Playwright JSON report.',
    ].join('\n')
    await fs.writeFile(path.join(runEvidenceDir, 'evidence-index.md'), index)
  }

  const cleanup = async (phase: string): Promise<string[]> => {
    if (cleanupStarted) return cleanupFailures
    cleanupStarted = true
    cleanupFailures = await tracker.stopAll((message) => log(`CLEANUP WARNING (${phase}): ${message}`))
    if (mail) {
      try { await mail.close() } catch { /* already closed */ }
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
        // A resource stop failed: we cannot prove postgres/the app is down,
        // so the data dir (and logs) are NEVER deleted in that case.
        log(`SAFETY: preserving owned runtime dir ${runtime.paths.rootDir} — ${cleanupFailures.length} resource stop(s) failed; data dir and logs are NOT deleted`)
      }
      if (!removedRoot) {
        // Refresh preserved logs so post-stop state is captured for post-mortem.
        try {
          await fs.cp(runtime.paths.logsDir, path.join(runEvidenceDir, 'owned-runtime-logs'), { recursive: true })
        } catch { /* best effort */ }
      }
    }
    return cleanupFailures
  }

  // The app runs as its own process group; on Ctrl-C/SIGTERM stop owned
  // resources instead of orphaning them. Hard-bounded so interrupting the
  // runner can never hang.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void (async () => {
        log(`received ${signal} — stopping owned resources`)
        await cleanup(`signal-${signal}`)
        process.exit(cleanupFailures.length > 0 ? 1 : 0)
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
    // Register the stop hook BEFORE starting: if pg_ctl start half-succeeds
    // and startPostgres throws afterwards, cleanup still stops the running
    // postmaster instead of orphaning it (stopPostgres tolerates a cluster
    // that never came up).
    tracker.register({ kind: 'postgres', stop: () => stopPostgres(runtime as OwnedRuntime) })
    const postmasterPid = await startPostgres(runtime)
    log(`postgres started, postmaster PID ${postmasterPid}`)
    await verifyOwnedMaintenanceIdentity(runtime)
    log('identity verified against postgres maintenance DB (read-only contract)')

    // 2. Fresh owned database + schema + fixture (skipped for lifecycle smoke).
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
      await seedOwnedFixture(runtime, appDir, options.routesConfig)
      log(`fixture seeded (route configuration: ${options.routesConfig})`)
    }

    if (options.mode === 'lifecycle-smoke' || options.mode === 'prepare') {
      log(`mode ${options.mode} complete — stopping owned resources`)
      // prepare seeds the fixture (published routes) but writes no workflow
      // rows: its DB evidence documents the seeded configuration only.
      const artifacts = await captureRunArtifacts()
      const failures = await cleanup('normal-end')
      const decision = evidenceDecision(artifacts, undefined, failures)
      await writeRunSummaryAndIndex({
        status: decision.status,
        error: decision.error,
        artifacts,
      })
      process.exitCode = decision.exitCode
      if (decision.exitCode !== 0) {
        log(`mode ${options.mode} finished nonzero (${decision.error ?? 'evidence gate'}) — see run-summary.json`)
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

    // 4. Business-only Playwright smoke (video + trace + checkpoints).
    await runPlaywrightBusiness(runtime, appDir as string, runEvidenceDir, baseUrl, options.routesConfig, options.scenario)
    log(`playwright business smoke finished (route configuration: ${options.routesConfig}${options.scenario ? `; scenario selection: ${options.scenario}` : ''})`)

    // 5. Evidence: capture mail summary + durable workflow DB evidence +
    // blocked-connection log + runtime logs BEFORE stopping resources, then
    // stop, then write summary + index.
    const artifacts = await captureRunArtifacts()
    const failures = await cleanup('normal-end')
    const decision = evidenceDecision(artifacts, undefined, failures)
    await writeRunSummaryAndIndex({
      status: decision.status,
      error: decision.error,
      artifacts,
    })
    log(`evidence written to ${runEvidenceDir}`)
    process.exitCode = decision.exitCode
    if (decision.exitCode !== 0) {
      log(`FAILURE: ${decision.error ?? 'evidence gate'}`)
    }
  } catch (error) {
    const primaryError = error instanceof Error ? error.message : String(error)
    log(`FAILURE: ${primaryError}`)
    // Failure-path evidence is captured BEFORE cleanup. The primary error
    // stays first; a thrown/missing capture still fails the run and does
    // not skip cleanup.
    const artifacts = await captureRunArtifacts()
    const failures = await cleanup('failure')
    const decision = evidenceDecision(artifacts, primaryError, failures)
    await writeRunSummaryAndIndex({
      status: 'failed',
      error: decision.error ?? primaryError,
      artifacts,
    })
    process.exitCode = 1
    throw error
  }
}

main().catch((error) => {
  log(`runner failed: ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
})

export const __runnerInternals = {
  parseArgs,
  waitForHttpReady,
  RSYNC_EXCLUDES,
  isOwnedRunId,
  readPostmasterPid,
  isPortListening,
}
