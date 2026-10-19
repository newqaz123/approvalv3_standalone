/**
 * Rejection/Recovery Matrix — owned profile runtime lifecycle controller.
 * TEST-ONLY. Composed EXCLUSIVELY from already-exported native safety
 * primitives. The native CLI and the side-effecting run-native-business-tests
 * module are never imported.
 *
 * Shutdown captures real artifacts BEFORE one verified stop of the resources
 * this run actually started. Stop failures are recorded and block the next
 * profile. A successful stop is idempotent. Root/PGDATA are retained.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, statSync, writeSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createOwnedRuntime,
  ensureOwnedTmpParent,
  initdbCluster,
  startPostgres,
  ensureOwnedDatabase,
  verifyOwnedMaintenanceIdentity,
  verifyPostgresIdentity,
  assertNoProtectedAmbientKeys,
  psqlQuery,
  stopPostgres,
  type OwnedRuntime,
  type PostgresIdentity,
} from './postgres-instance'
import {
  OwnedResourceTracker,
  runChild,
  spawnApp,
  stopAppProcess,
  waitForHttpReady,
  type AppProcess,
} from './runner-lifecycle'
import { startMailCapture, type MailCaptureHandle } from './mail-capture'
import { assertOwnedLoopbackDatabaseTarget, createSafeRunPlan } from '../business-workflow-safety'
import { BUSINESS_ROUTE_CONFIGURATION_NAMES } from '../business-workflow-fixture'
import { applyMappedMatrixSeed, assertReadOnlySingleSelect, parsePsqlJsonDocument, MATRIX_ACTION_REGISTRY, loadClearedInvocation, type ArtifactRef, type ArtifactReader, type ClearedInvocationContext, type HandlerKey, type RunBinding, type RuntimeProvenance,
  type ClockDriverPreRootDescriptorV3, type ClockNativeReadFailureCodeV3, type ClockNativeReadInputV3, type ClockObserverBootstrapV3, type ClockProbeCleanupClosureV3, type ClockProbeCompletionV3, type ClockProbeLeaseV3,
  type ClockProbeRegistrationV3, type ClockScopeSeedV3, type ClockSelfAcquisitionV3, type NativeAppGroupStopFactV3, type NativeBirthV3,
  type NativeProcessReadV3, type NativeReadResultV3 } from '../rejection-recovery-matrix'
import ts from 'typescript'
import { PG_BIN } from './native-environment'

export const MATRIX_REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** Exact partial unique indexes from the native runner. prisma db push cannot
 *  express them; they are applied only to a future authorized fresh owned DB. */
export const PARTIAL_UNIQUE_INDEX_SQL = [
  `CREATE UNIQUE INDEX one_active_assignment_per_user ON organization_assignments ("userId") WHERE "isActive";`,
  `CREATE UNIQUE INDEX one_active_company_root ON organization_units ((1)) WHERE "parentId" IS NULL AND "isActive";`,
  `CREATE UNIQUE INDEX one_published_route_per_scope_phase ON approval_route_versions ("scopeUnitId", "phase") WHERE "status" = 'PUBLISHED';`,
  `CREATE UNIQUE INDEX one_active_team_name_per_unit ON teams ("unitId", "name") WHERE "isActive";`,
] as const

export const REQUIRED_INDEXES = [
  'one_active_assignment_per_user',
  'one_active_company_root',
  'one_published_route_per_scope_phase',
  'one_active_team_name_per_unit',
] as const

export const MATRIX_FORBIDDEN_PORTS = new Set([3100, 5432, 50666])

export const RSYNC_EXCLUDES = [
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

export type MatrixRoutesConfig = (typeof BUSINESS_ROUTE_CONFIGURATION_NAMES)[number]

export function matrixRuntimeParentDir(explicit?: string): string {
  return explicit ?? path.join(os.tmpdir(), 'rejection-recovery-matrix')
}

export class MatrixRuntimeError extends Error {}

let stopBlock: string | null = null

export function matrixStopBlockReason(): string | null {
  return stopBlock
}

/** Test-only clearance after a recorded stop/capture failure has been asserted. */
export function clearMatrixStopBlock(): void {
  stopBlock = null
}

function blockNextProfile(reason: string): void {
  stopBlock = reason
}

export interface MatrixRuntimeHandle {
  stopped?: boolean
  stopFailure?: string
  artifactsCaptured?: boolean
  runtime: OwnedRuntime
  appDir: string
  baseUrl: string
  tracker: OwnedResourceTracker
  app?: AppProcess
  mail?: MailCaptureHandle
  /** Task2: set only after the observed generated copy has been produced AND
   *  compiled. Callers that require an observed runtime must refuse to create
   *  a case context without it. */
  observerManifest?: ObserverCopyManifest
  /** Task5: set only after the parent-pinned clearance has been re-read and
   *  verified against the actually allocated owned runtime, and the immutable
   *  runtime/assurance-runtime.json provenance has been written. The binding
   *  is attached before any browser/session work consumes the runtime. */
  assuranceBinding?: RunBinding
  captureArtifacts: () => Promise<void>
  setArtifactCapture(capture: () => Promise<void>): void
  /** Identity recheck + one read-only SELECT. Returns parsed JSON, never raw
   *  pipe text. Does not wrap the statement in BEGIN/COMMIT. */
  queryReadOnly(sql: string): Promise<unknown>
}

export interface StopMatrixRuntimeOptions {
  captureArtifacts?: () => Promise<void>
}

export interface StopDeps {
  stopApp: () => Promise<void>
  closeMail: () => Promise<void>
  stopPg: () => Promise<void>
}

export interface MatrixLifecycleDeps {
  assertNoProtectedAmbientKeys: typeof assertNoProtectedAmbientKeys
  ensureOwnedTmpParent: typeof ensureOwnedTmpParent
  createOwnedRuntime: typeof createOwnedRuntime
  initdbCluster: typeof initdbCluster
  startPostgres: typeof startPostgres
  verifyOwnedMaintenanceIdentity: typeof verifyOwnedMaintenanceIdentity
  ensureOwnedDatabase: typeof ensureOwnedDatabase
  verifyPostgresIdentity: typeof verifyPostgresIdentity
  psqlQuery: typeof psqlQuery
  stopPostgres: typeof stopPostgres
  runChild: typeof runChild
  spawnApp: typeof spawnApp
  stopAppProcess: typeof stopAppProcess
  waitForHttpReady: typeof waitForHttpReady
  startMailCapture: typeof startMailCapture
  copyAppSource: (runtime: OwnedRuntime) => Promise<string>
  /** Task2 compile-before-spawn seam. Provided by callers that require an
   *  observed copy (the matrix manual driver); invoked right after the owned
   *  source copy, and any failure fails startup before schema push, seed,
   *  mail, spawn or browser use. */
  prepareObservedAppCopy?: typeof prepareObservedAppCopy
  /** Task2: builds fresh guards from the copied source bytes; injected
   *  lifecycle tests stub it together with prepareObservedAppCopy. */
  observerSourceGuards?: typeof matrixObserverSourceGuards
  assertOwnedLoopbackDatabaseTarget: typeof assertOwnedLoopbackDatabaseTarget
  createSafeRunPlan: typeof createSafeRunPlan
  readOnlyQuery?: (runtime: OwnedRuntime, database: string, sql: string, env: Record<string, string>) => Promise<string>
  applyMappedSeed?: (runtime: OwnedRuntime, routesConfig: MatrixRoutesConfig) => Promise<void>
  createSeedClient?: (databaseUrl: string) => Promise<MappedSeedClient> | MappedSeedClient
  hashPassword?: (plain: string) => Promise<string>
}

export const READ_ONLY_PGOPTIONS = '-c default_transaction_read_only=on'

const READ_ONLY_ENV_KEYS = new Set(['PGOPTIONS', 'PGHOST', 'PGPORT', 'PGUSER', 'PGDATABASE', 'PGPASSWORD'])

export function assertReadOnlyConnectionEnv(env: Record<string, string>): void {
  if (env.PGOPTIONS !== READ_ONLY_PGOPTIONS) {
    throw new MatrixRuntimeError('evidence connection is not default_transaction_read_only')
  }
  if (env.PGHOST !== '127.0.0.1') throw new MatrixRuntimeError('evidence connection host is not loopback')
  for (const key of Object.keys(env)) {
    if (key.startsWith('PG') && !READ_ONLY_ENV_KEYS.has(key)) {
      throw new MatrixRuntimeError(`unexpected connection setting ${key}`)
    }
  }
}

export function readOnlyConnectionEnv(input: {
  databasePassword: string
  databasePort: number
  database: string
}): Record<string, string> {
  const env = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    LC_ALL: 'C',
    HOME: process.env.HOME ?? '/tmp',
    PGPASSWORD: input.databasePassword,
    PGHOST: '127.0.0.1',
    PGPORT: String(input.databasePort),
    PGUSER: 'postgres',
    PGDATABASE: input.database,
    PGOPTIONS: READ_ONLY_PGOPTIONS,
  }
  assertReadOnlyConnectionEnv(env)
  return env
}

export async function executeReadOnlyQuery(input: {
  sql: string
  verifyIdentity: () => Promise<Pick<PostgresIdentity, 'connectedDatabase' | 'dataDirectory'>>
  ownedDatabase: string
  ownedDataDir: string
  connectionEnv?: Record<string, string>
  query: (sql: string, env?: Record<string, string>) => Promise<string>
}): Promise<unknown> {
  const identity = await input.verifyIdentity()
  if (identity.connectedDatabase !== input.ownedDatabase || identity.dataDirectory !== input.ownedDataDir) {
    throw new MatrixRuntimeError(
      `queryReadOnly owned identity recheck failed (database ${identity.connectedDatabase}, data_directory ${identity.dataDirectory})`,
    )
  }
  const statement = assertReadOnlySingleSelect(input.sql)
  if (input.connectionEnv) assertReadOnlyConnectionEnv(input.connectionEnv)
  const raw = await input.query(statement, input.connectionEnv)
  return parsePsqlJsonDocument(raw)
}

export function readOnlyPsqlInvocation(sql: string, env: Record<string, string>): { executable: string; args: string[]; env: Record<string, string> } {
  assertReadOnlyConnectionEnv(env)
  return {
    executable: path.join(PG_BIN, 'psql'),
    args: ['-X', '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql],
    env,
  }
}

export interface ReadOnlyPsqlChild {
  stdout?: { on(event: 'data', cb: (chunk: Buffer) => void): void }
  stderr?: { on(event: 'data', cb: (chunk: Buffer) => void): void }
  on(event: 'error', cb: (error: Error) => void): void
  on(event: 'close', cb: (code: number | null) => void): void
}

export function readOnlyPsql(
  _runtime: OwnedRuntime,
  _database: string,
  sql: string,
  env: Record<string, string>,
  spawnProcess: (executable: string, args: readonly string[], options: { env: NodeJS.ProcessEnv; stdio: ['ignore', 'pipe', 'pipe'] }) => ReadOnlyPsqlChild = spawn,
): Promise<string> {
  const invocation = readOnlyPsqlInvocation(sql, env)
  return new Promise((resolve, reject) => {
    const child = spawnProcess(invocation.executable, invocation.args, {
      env: invocation.env as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => { stdout += String(chunk) })
    child.stderr?.on('data', (chunk: Buffer) => { stderr += String(chunk) })
    child.on('error', reject)
    child.on('close', (code: number | null) => {
      if (code !== 0) reject(new MatrixRuntimeError(`read-only psql exited ${code}: ${stderr.slice(0, 200)}`))
      else resolve(stdout.trim())
    })
  })
}

export async function copyAppSourceIsolated(runtime: OwnedRuntime): Promise<string> {
  const appDir = path.join(runtime.paths.rootDir, 'app')
  await fs.mkdir(appDir, { mode: 0o700 })
  const args = ['-a']
  for (const exclude of RSYNC_EXCLUDES) args.push('--exclude', exclude)
  args.push(`${MATRIX_REPO_ROOT}/`, appDir)
  await runChild(
    '/usr/bin/rsync',
    args,
    MATRIX_REPO_ROOT,
    { PATH: process.env.PATH ?? '/usr/bin:/bin' },
    path.join(runtime.paths.logsDir, 'rsync.log'),
    600_000,
  )
  await fs.symlink(path.join(MATRIX_REPO_ROOT, 'node_modules'), path.join(appDir, 'node_modules'), 'dir')
  await fs.mkdir(path.join(appDir, 'uploads'), { recursive: true })
  return appDir
}

async function applyAndVerifyPartialUniqueIndexes(
  runtime: OwnedRuntime,
  query: typeof psqlQuery,
): Promise<void> {
  for (const statement of PARTIAL_UNIQUE_INDEX_SQL) {
    await query(runtime, runtime.resource.databaseName, statement)
  }
  const raw = await query(
    runtime,
    runtime.resource.databaseName,
    "select coalesce(json_agg(indexname order by indexname), '[]'::json)::text from pg_indexes where schemaname = 'public' and indexname like 'one_%'",
  )
  const present = parsePsqlJsonDocument(raw)
  if (!Array.isArray(present)) throw new MatrixRuntimeError(`index verification was not a JSON array: ${raw}`)
  const names = present.map((item) => String(item))
  for (const required of REQUIRED_INDEXES) {
    if (!names.includes(required)) {
      throw new MatrixRuntimeError(`required partial unique index ${required} missing after apply (present: ${names.join(',')})`)
    }
  }
}

function expectedPublishedRouteCount(routesConfig: MatrixRoutesConfig): number {
  const solutionException = routesConfig === 'solution-exception' || routesConfig === 'solution-and-final-exceptions'
  const finalException = routesConfig === 'final-exception' || routesConfig === 'solution-and-final-exceptions'
  return 3 + (solutionException ? 1 : 0) + (finalException ? 1 : 0)
}

export function expectedPublishedRoutes(routesConfig: MatrixRoutesConfig): number {
  return expectedPublishedRouteCount(routesConfig)
}

const defaultDeps: MatrixLifecycleDeps = {
  assertNoProtectedAmbientKeys,
  ensureOwnedTmpParent,
  createOwnedRuntime,
  initdbCluster,
  startPostgres,
  verifyOwnedMaintenanceIdentity,
  ensureOwnedDatabase,
  verifyPostgresIdentity,
  psqlQuery,
  stopPostgres,
  runChild,
  spawnApp,
  stopAppProcess,
  waitForHttpReady,
  startMailCapture,
  copyAppSource: copyAppSourceIsolated,
  assertOwnedLoopbackDatabaseTarget,
  createSafeRunPlan,
}

/**
 * Allocate and bootstrap one fresh owned profile runtime. Nothing in this
 * repair invokes the default deps. Injected failures prove capture-before-stop
 * without creating a cluster.
 */
const SEED_MODELS: Record<string, string> = {
  positions: 'positions',
  users: 'user',
  organization_units: 'organization_units',
  company_settings: 'company_settings',
  organization_assignments: 'organization_assignments',
  teams: 'teams',
  approval_route_versions: 'approval_route_versions',
  approval_route_steps: 'approval_route_steps',
  email_settings: 'email_settings',
}

export interface MappedSeedModel {
  create(args: { data: Record<string, unknown> }): Promise<unknown>
  update?(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<unknown>
  count?(): Promise<number>
}

export interface MappedSeedClient {
  $connect(): Promise<void>
  $disconnect(): Promise<void>
  $queryRawUnsafe<T = unknown>(sql: string): Promise<T>
  $transaction<T>(fn: (tx: Record<string, MappedSeedModel>) => Promise<T>): Promise<T>
  company_settings: { count(): Promise<number> }
  user: { count(): Promise<number> }
  organization_units: { count(): Promise<number> }
  approval_route_versions: { count(): Promise<number> }
  email_settings: { count(): Promise<number> }
}

export function prismaSeedAdapter(tx: Record<string, MappedSeedModel>) {
  return {
    insert: async (table: string, data: Record<string, unknown>) => {
      const model = SEED_MODELS[table]
      if (!model || !tx[model]?.create) throw new MatrixRuntimeError(`no prisma model for seed table ${table}`)
      await tx[model].create({ data })
    },
    update: async (table: string, where: Record<string, unknown>, data: Record<string, unknown>) => {
      const model = SEED_MODELS[table]
      if (!model || !tx[model]?.update) throw new MatrixRuntimeError(`no prisma update for seed table ${table}`)
      await tx[model].update({ where, data })
    },
  }
}

async function defaultSeedClient(databaseUrl: string): Promise<MappedSeedClient> {
  const prisma = await import('@prisma/client')
  return new prisma.PrismaClient({ datasources: { db: { url: databaseUrl } } }) as unknown as MappedSeedClient
}

async function defaultSeedHash(plain: string): Promise<string> {
  const bcrypt = await import('bcryptjs')
  return bcrypt.hash(plain, 10)
}

/** Real default adapters. Constructed only after explicit seedCleared. Tests inject fakes and do not call the defaults. */
export async function runDefaultMappedSeed(input: {
  seedCleared: boolean
  databaseUrl: string
  routesConfig: MatrixRoutesConfig
  mailPort: number
  password: string
  createClient?: (databaseUrl: string) => Promise<MappedSeedClient> | MappedSeedClient
  hashPassword?: (plain: string) => Promise<string>
}): Promise<{ users: number; routes: number; mailHost: string; fromAddress: string }> {
  if (input.seedCleared !== true) {
    throw new MatrixRuntimeError('mapped seed requires explicit seedCleared from a future cleared caller')
  }
  const createClient = input.createClient ?? defaultSeedClient
  const hashPassword = input.hashPassword ?? defaultSeedHash
  const client = await createClient(input.databaseUrl)
  let failure: unknown
  let result: { users: number; routes: number; mailHost: string; fromAddress: string } | undefined
  try {
    await client.$connect()
    const connected = await client.$queryRawUnsafe<Array<{ current_database: string }>>('select current_database()')
    const connectedDatabase = connected[0]?.current_database ?? ''
    const [company, users, units, routes, mail] = await Promise.all([
      client.company_settings.count(),
      client.user.count(),
      client.organization_units.count(),
      client.approval_route_versions.count(),
      client.email_settings.count(),
    ])
    const indexRows = await client.$queryRawUnsafe<Array<{ indexname: string }>>(
      "select indexname from pg_indexes where schemaname = 'public'",
    )
    result = await client.$transaction(async (tx) => applyMappedMatrixSeed({
      seedCleared: true,
      routesConfig: input.routesConfig,
      mailPort: input.mailPort,
      password: input.password,
      hashPassword,
      connectedDatabase,
      counts: { company, users, units, routes, mail },
      indexes: indexRows.map((row) => row.indexname),
      tx: prismaSeedAdapter(tx),
    }))
  } catch (error) {
    failure = error
  } finally {
    try {
      await client.$disconnect()
    } catch (error) {
      const extra = error instanceof Error ? error.message : String(error)
      failure = failure
        ? new MatrixRuntimeError(`${failure instanceof Error ? failure.message : String(failure)}; disconnect failed: ${extra}`)
        : error
    }
  }
  if (failure) throw failure
  return result as { users: number; routes: number; mailHost: string; fromAddress: string }
}

/** Canonical JSON for exact re-read comparisons. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
}

/** Task5 artifact reader over absolute reference paths: realpath (no symlink
 *  traversal), exact archived byte size and SHA-256 digest. File-only; never
 *  executes or probes anything. */
export function ownedArtifactReader(): ArtifactReader {
  return async (ref) => {
    if (typeof ref.path !== 'string' || !path.isAbsolute(ref.path)) {
      throw new MatrixRuntimeError(`artifact reference path must be absolute: ${String(ref.path)}`)
    }
    const real = await fs.realpath(ref.path)
    if (real !== path.resolve(ref.path)) {
      throw new MatrixRuntimeError(`artifact reference must not traverse symlinks: ${ref.path} -> ${real}`)
    }
    const bytes = await fs.readFile(real)
    if (bytes.length !== ref.bytes) {
      throw new MatrixRuntimeError(`artifact ${ref.path} byte size ${bytes.length} != ${ref.bytes}`)
    }
    const digest = createHash('sha256').update(bytes).digest('hex')
    if (digest !== ref.sha256) {
      throw new MatrixRuntimeError(`artifact ${ref.path} digest ${digest} != ${ref.sha256}`)
    }
    return bytes
  }
}

export async function startMatrixRuntime(input: {
  routesConfig: MatrixRoutesConfig
  parentDir?: string
  log: (message: string) => void
  artifactCapture?: (note: string) => Promise<void>
  /** Future caller must set this explicitly. The manual driver must not. */
  seedCleared?: boolean
  /** Task5: parent-pinned cleared invocation. When present, the runtime is
   *  qualified for exactly this strict-assurance slot: the clearance is
   *  re-read and verified, the actual owned identity/fixture gates are
   *  persisted as artifacts, and the derived RunBinding is attached to the
   *  handle before spawn/browser work. Without it the runtime stays in
   *  historical/legacy mode and can never qualify a fresh pass. */
  assurance?: ClearedInvocationContext
}, deps: MatrixLifecycleDeps = defaultDeps): Promise<MatrixRuntimeHandle> {
  if (stopBlock) {
    throw new MatrixRuntimeError(`next profile blocked by previous owned stop/capture failure: ${stopBlock}`)
  }
  if (!(BUSINESS_ROUTE_CONFIGURATION_NAMES as readonly string[]).includes(input.routesConfig)) {
    throw new MatrixRuntimeError(`unknown routes config ${input.routesConfig}`)
  }
  deps.assertNoProtectedAmbientKeys(process.env)
  const ownedParent = matrixRuntimeParentDir(input.parentDir)
  await deps.ensureOwnedTmpParent(ownedParent)
  const runtime = await deps.createOwnedRuntime({ parentDir: ownedParent })
  input.log(`matrix runtime ${runtime.runId}: ports db=${runtime.ports.databasePort} app=${runtime.ports.serverPort} mail=${runtime.ports.mailPort}`)

  const tracker = new OwnedResourceTracker()
  let artifactCapture = async (): Promise<void> => { await input.artifactCapture?.('startup-capture') }
  const refs: { app?: AppProcess; mail?: MailCaptureHandle; appDir?: string; postgresStartAttempted: boolean } = {
    postgresStartAttempted: false,
  }
  const handle: MatrixRuntimeHandle = {
    runtime,
    appDir: runtime.paths.rootDir,
    baseUrl: `http://127.0.0.1:${runtime.ports.serverPort}`,
    tracker,
    captureArtifacts: async () => { await artifactCapture() },
    setArtifactCapture: (capture) => { artifactCapture = capture },
    queryReadOnly: async (sql: string) => {
      const connectionEnv = readOnlyConnectionEnv({
        databasePassword: runtime.databasePassword,
        databasePort: runtime.ports.databasePort,
        database: runtime.resource.databaseName,
      })
      return executeReadOnlyQuery({
        sql,
        ownedDatabase: runtime.resource.databaseName,
        ownedDataDir: runtime.paths.dataDir,
        connectionEnv,
        verifyIdentity: async () => deps.verifyPostgresIdentity(runtime, runtime.resource.databaseName),
        query: (statement, env) => {
          if (!env) throw new MatrixRuntimeError('evidence query missing read-only connection env')
          const adapter = deps.readOnlyQuery ?? readOnlyPsql
          return adapter(runtime, runtime.resource.databaseName, statement, env)
        },
      })
    },
  }

  const stopStarted = async (phase: string): Promise<void> => {
    await stopMatrixRuntime(handle, {}, input.log, {
      stopApp: async () => {
        if (refs.app && refs.appDir) await deps.stopAppProcess(refs.app, refs.appDir)
      },
      closeMail: async () => {
        if (refs.mail) await refs.mail.close()
      },
      stopPg: async () => {
        if (refs.postgresStartAttempted) await deps.stopPostgres(runtime)
      },
    })
    input.log(`matrix runtime ${runtime.runId}: cleanup after ${phase}`)
  }

  try {
    for (const port of [runtime.ports.databasePort, runtime.ports.serverPort, runtime.ports.mailPort]) {
      if (MATRIX_FORBIDDEN_PORTS.has(port)) {
        throw new MatrixRuntimeError(`allocator picked a matrix-forbidden port ${port}`)
      }
    }
    await deps.initdbCluster(runtime)
    refs.postgresStartAttempted = true
    await deps.startPostgres(runtime)
    const maintenance = await deps.verifyOwnedMaintenanceIdentity(runtime)
    if (maintenance.connectedDatabase !== 'postgres') {
      throw new MatrixRuntimeError(`maintenance identity connected to ${maintenance.connectedDatabase}, expected postgres`)
    }
    await deps.ensureOwnedDatabase(runtime)
    deps.assertOwnedLoopbackDatabaseTarget(runtime.databaseUrl, runtime.resource)
    deps.createSafeRunPlan({
      databaseUrl: runtime.databaseUrl,
      resource: runtime.resource,
      mail: { mode: 'LOOPBACK_CAPTURE', host: '127.0.0.1', port: runtime.ports.mailPort, fallbackTransport: 'DISABLED' },
    })
    const identity = await deps.verifyPostgresIdentity(runtime, runtime.resource.databaseName)
    if (identity.connectedDatabase !== runtime.resource.databaseName || identity.dataDirectory !== runtime.paths.dataDir) {
      throw new MatrixRuntimeError('business identity does not match the owned runtime')
    }
    refs.appDir = await deps.copyAppSource(runtime)
    handle.appDir = refs.appDir
    if (deps.prepareObservedAppCopy) {
      handle.observerManifest = await deps.prepareObservedAppCopy({
        ownedRoot: runtime.paths.rootDir,
        appDir: refs.appDir,
        evidenceDir: path.join(runtime.paths.logsDir, 'observer-journal'),
        guards: await (deps.observerSourceGuards ?? matrixObserverSourceGuards)(refs.appDir),
        nextVersion: '15.5.23',
      }, { runChild: deps.runChild })
    }
    const prismaBin = path.join(refs.appDir, 'node_modules', '.bin', 'prisma')
    await deps.runChild(
      prismaBin,
      ['db', 'push', '--skip-generate'],
      refs.appDir,
      {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        HOME: process.env.HOME ?? '/tmp',
        DATABASE_URL: runtime.databaseUrl,
      },
      path.join(runtime.paths.logsDir, 'schema-push.log'),
      600_000,
    )
    await applyAndVerifyPartialUniqueIndexes(runtime, deps.psqlQuery)
    if (input.seedCleared !== true) {
      throw new MatrixRuntimeError('mapped seed requires explicit seedCleared from a future cleared caller')
    }
    await runDefaultMappedSeed({
      seedCleared: true,
      databaseUrl: runtime.databaseUrl,
      routesConfig: input.routesConfig,
      mailPort: runtime.ports.mailPort,
      password: runtime.e2ePassword,
      createClient: deps.createSeedClient,
      hashPassword: deps.hashPassword,
    })
    const retentionRaw = await deps.psqlQuery(
      runtime,
      runtime.resource.databaseName,
      "select json_build_object('users', (select count(*) from users), 'routes', (select count(*) from approval_route_versions where status = 'PUBLISHED'))::text",
    )
    const retention = parsePsqlJsonDocument(retentionRaw) as { users?: number; routes?: number }
    const expectedRoutes = expectedPublishedRouteCount(input.routesConfig)
    if (!retention || Number(retention.users) <= 0 || Number(retention.routes) !== expectedRoutes) {
      throw new MatrixRuntimeError(`retention proof failed: ${JSON.stringify(retention)} expected routes ${expectedRoutes}`)
    }
    refs.mail = await deps.startMailCapture({ host: '127.0.0.1', port: runtime.ports.mailPort })
    handle.mail = refs.mail
    tracker.register({ kind: 'mail', stop: () => refs.mail!.close() })
    if (input.assurance) {
      // Task5 lineage: reread and verify the same parent-pinned clearance,
      // then persist the ACTUAL allocation/identity/fixture/observer gate
      // records under the owned runtime and derive the RunBinding from those
      // verified records. No generated run id, no new auth/DB probe.
      const recleared = await loadClearedInvocation({
        authority: input.assurance.authority,
        invocationId: input.assurance.value.slot.invocationId,
        readArtifact: ownedArtifactReader(),
      })
      if (stableStringify(recleared.value) !== stableStringify(input.assurance.value)) {
        throw new MatrixRuntimeError('re-read owner clearance differs from the caller-provided cleared invocation')
      }
      const clearance = recleared.value
      if (clearance.slot.profile !== input.routesConfig) {
        throw new MatrixRuntimeError(`cleared slot profile ${clearance.slot.profile} does not match the allocated routes config ${input.routesConfig}`)
      }
      if (!Number.isInteger(clearance.slot.caseIds.length) || clearance.slot.caseIds.length <= 0) {
        throw new MatrixRuntimeError('cleared slot carries no canonical case membership')
      }
      const runtimeDir = path.join(runtime.paths.rootDir, 'runtime')
      await fs.mkdir(runtimeDir, { recursive: true, mode: 0o700 })
      const writeGate = async (name: string, value: unknown): Promise<ArtifactRef> => {
        const file = path.join(runtimeDir, name)
        const bytes = Buffer.from(JSON.stringify(value, null, 2))
        await fs.writeFile(file, bytes, { mode: 0o600 })
        return { path: file, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length }
      }
      const maintenance = await deps.verifyOwnedMaintenanceIdentity(runtime)
      const business = await deps.verifyPostgresIdentity(runtime, runtime.resource.databaseName)
      const ownedIdentity = await writeGate('owned-identity.json', {
        runId: runtime.runId,
        maintenance: { connectedDatabase: maintenance.connectedDatabase, dataDirectory: maintenance.dataDirectory, serverPort: maintenance.serverPort },
        business: { connectedDatabase: business.connectedDatabase, dataDirectory: business.dataDirectory, serverPort: business.serverPort },
      })
      const freshEmptyFixture = await writeGate('fresh-empty-fixture.json', {
        runId: runtime.runId,
        routesConfig: input.routesConfig,
        seedCleared: true,
        canonicalCaseIds: clearance.slot.caseIds,
      })
      if (!handle.observerManifest) throw new MatrixRuntimeError('strict-assurance runtime requires the compiled observed app copy before lineage')
      const observerArtifact = await writeGate('observer-copy-manifest.json', handle.observerManifest)
      const sourceIdentity = await (deps.observerSourceGuards ?? matrixObserverSourceGuards)(refs.appDir as string)
      const reviewedSource = await writeGate('reviewed-source.json', {
        approvedSource: clearance.approvedSource,
        ownedRootRealpath: await fs.realpath(runtime.paths.rootDir),
        guards: sourceIdentity.map((guard) => ({ relativePath: guard.relativePath, sha256: guard.sha256 })),
      })
      const runtimeProvenance: RuntimeProvenance = {
        authority: input.assurance.authority,
        clearanceManifest: recleared.manifest,
        slot: clearance.slot,
        runId: runtime.runId,
        sourceMode: 'strict-assurance',
        evidenceRoot: clearance.evidenceRoot,
        ownedRoot: await fs.realpath(runtime.paths.rootDir),
        approvedSource: reviewedSource,
        observerManifest: observerArtifact,
        ownedIdentity,
        freshEmptyFixture,
      }
      const provenanceRef = await writeGate('assurance-runtime.json', runtimeProvenance)
      handle.assuranceBinding = {
        pass: clearance.slot.pass,
        invocation: clearance.slot.invocation,
        invocationId: clearance.slot.invocationId,
        profile: clearance.slot.profile,
        runId: runtime.runId,
        sourceMode: 'strict-assurance',
        evidenceRoot: clearance.evidenceRoot,
        clearanceManifest: recleared.manifest,
        runtimeManifest: provenanceRef,
      }
      input.log(`matrix runtime ${runtime.runId}: strict-assurance lineage attached for ${clearance.slot.invocationId} (${handle.assuranceBinding.pass === 1 ? 'pass1' : 'pass2'} slot ${clearance.slot.invocation})`)
    }
    const preloadPath = path.join(refs.appDir, 'tests', 'support', 'native', 'outbound-allowlist-preload.js')
    refs.app = deps.spawnApp(runtime, refs.appDir, preloadPath, path.join(runtime.paths.logsDir, 'next-dev.log'))
    handle.app = refs.app
    tracker.register({ kind: 'app', stop: () => deps.stopAppProcess(refs.app as AppProcess, refs.appDir as string) })
    await deps.waitForHttpReady(`${handle.baseUrl}/sign-in`, runtime.ports.serverPort, refs.app.pid, 240_000)
    await handle.captureArtifacts()
    handle.artifactsCaptured = true
    input.log(`matrix runtime ${runtime.runId}: app ready at ${handle.baseUrl}`)
    return handle
  } catch (error) {
    input.log(`matrix runtime ${runtime.runId}: FAILED: ${error instanceof Error ? error.message : String(error)}`)
    try {
      await stopStarted('startup-failure')
    } catch (stopError) {
      throw new MatrixRuntimeError(
        `${error instanceof Error ? error.message : String(error)}; owned stop/capture: ${stopError instanceof Error ? stopError.message : String(stopError)}`,
      )
    }
    throw error
  }
}

/**
 * Artifacts first, then one stop of app/mail/postgres. `stopped` is set only
 * after the stops succeed. A failed stop is recorded and blocks the next
 * profile; it is not retried (no duplicate stops) and is not reported as a
 * clean stop. Capture failure is never presented as captured.
 */
export async function stopMatrixRuntime(
  handle: MatrixRuntimeHandle,
  options: StopMatrixRuntimeOptions = {},
  log: (message: string) => void = () => undefined,
  deps?: Partial<StopDeps>,
): Promise<void> {
  if (handle.stopFailure) {
    throw new MatrixRuntimeError(`previous owned stop failed; next profile blocked: ${handle.stopFailure}`)
  }
  if (handle.stopped) {
    log(`matrix runtime ${handle.runtime?.runId ?? '??'}: already stopped; nothing to do`)
    return
  }
  const capture = options.captureArtifacts ?? handle.captureArtifacts
  if (!capture) throw new MatrixRuntimeError('artifact capture hook is not wired')
  let captureError: string | null = null
  try {
    await capture()
    handle.artifactsCaptured = true
  } catch (error) {
    handle.artifactsCaptured = false
    captureError = error instanceof Error ? error.message : String(error)
  }
  const failures: string[] = []
  const attempt = async (name: string, body: (() => Promise<void>) | undefined): Promise<void> => {
    if (!body) return
    try {
      await body()
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const stopApp = deps?.stopApp ?? (handle.app ? () => stopAppProcess(handle.app as AppProcess, handle.appDir) : undefined)
  const closeMail = deps?.closeMail ?? (handle.mail ? () => handle.mail!.close() : undefined)
  const stopPg = deps?.stopPg ?? (() => stopPostgres(handle.runtime))
  await attempt('app', stopApp)
  await attempt('mail', closeMail)
  await attempt('postgres', stopPg)
  if (captureError || failures.length > 0) {
    const message = [
      captureError ? `artifact capture failed; not presenting artifacts as captured: ${captureError}` : '',
      failures.length > 0 ? `owned stop reported failures: ${failures.join(' | ')}` : '',
    ].filter(Boolean).join('; ')
    if (failures.length > 0) handle.stopFailure = failures.join(' | ')
    else handle.stopped = true
    blockNextProfile(message)
    log(`matrix runtime ${handle.runtime?.runId ?? '??'}: ${message}`)
    throw new MatrixRuntimeError(message)
  }
  handle.stopped = true
  handle.artifactsCaptured = true
  // Task5: the verified owned stop is itself an immutable evidence artifact.
  // InvocationQualification.ownedStop must reference exactly these bytes; a
  // failed stop never writes it and never becomes a qualifying invocation.
  try {
    const runtimeDir = path.join(handle.runtime.paths.rootDir, 'runtime')
    await fs.mkdir(runtimeDir, { recursive: true, mode: 0o700 })
    const bytes = Buffer.from(JSON.stringify({
      runId: handle.runtime.runId,
      stopped: true,
      artifactsCaptured: true,
      stoppedAt: new Date().toISOString(),
      rootRetained: handle.runtime.paths.rootDir,
    }, null, 2))
    await fs.writeFile(path.join(runtimeDir, 'owned-stop.json'), bytes, { flag: 'wx', mode: 0o600 })
  } catch (error) {
    throw new MatrixRuntimeError(`verified owned stop artifact could not be written; stop cannot qualify: ${error instanceof Error ? error.message : String(error)}`)
  }
  log(`matrix runtime ${handle.runtime.runId}: stopped (root retained: ${handle.runtime.paths.rootDir})`)
}

export async function writeFailureArtifacts(input: {
  dir: string
  label: string
  error: unknown
  screenshot?: (file: string) => Promise<void>
  dbText?: string
  auditText?: string
  mailText?: string
  notificationText?: string
  progressText?: string
}): Promise<string[]> {
  await fs.mkdir(input.dir, { recursive: true })
  const written: string[] = []
  const write = async (name: string, body: string): Promise<void> => {
    const file = path.join(input.dir, name)
    await fs.writeFile(file, body)
    written.push(file)
  }
  await write(`${input.label}-error.txt`, input.error instanceof Error ? input.error.stack ?? input.error.message : String(input.error))
  if (input.screenshot) {
    const shot = path.join(input.dir, `${input.label}.png`)
    await input.screenshot(shot)
    written.push(shot)
  }
  if (input.dbText !== undefined) await write(`${input.label}-db.txt`, input.dbText)
  if (input.auditText !== undefined) await write(`${input.label}-audit.txt`, input.auditText)
  if (input.mailText !== undefined) await write(`${input.label}-mail.txt`, input.mailText)
  if (input.notificationText !== undefined) await write(`${input.label}-notifications.txt`, input.notificationText)
  if (input.progressText !== undefined) await write(`${input.label}-progress.txt`, input.progressText)
  return written
}

/** Browser launch and the case run share one cleanup enclosure. A launch
 *  failure still stops the owned runtime. */
export async function runOwnedMatrixSession<T>(input: {
  handle: MatrixRuntimeHandle
  launchBrowser: () => Promise<{ close: () => Promise<void> }>
  run: (browser: { close: () => Promise<void> }) => Promise<T>
  stop?: typeof stopMatrixRuntime
  log?: (message: string) => void
}): Promise<T> {
  let browser: { close: () => Promise<void> } | null = null
  let runError: unknown = null
  let result: T | undefined
  try {
    browser = await input.launchBrowser()
    try {
      result = await input.run(browser)
    } catch (error) {
      runError = error
    }
  } catch (error) {
    runError = error
  } finally {
    const stop = input.stop ?? stopMatrixRuntime
    const failures: unknown[] = runError ? [runError] : []
    try {
      await stop(input.handle, {}, input.log)
    } catch (error) {
      failures.push(error)
    }
    if (browser) {
      try {
        await browser.close()
      } catch (error) {
        failures.push(error)
      }
    }
    runError = failures.length === 0 ? null : failures.length === 1 ? failures[0] : new MatrixRuntimeError(failures.map((error) => error instanceof Error ? error.message : String(error)).join('; '))
  }
  if (runError) throw runError
  return result as T
}

// ============================================================================
// Task2: guarded generated-copy observer (offline, file-only owned copies).
//
// Exact source AST match constraints (fail closed on any drift):
// - Each registered export is an `export async function` whose body block is
//   wrapped verbatim in `runObservedOriginal('<HandlerKey>', [<params>],
//   async (inv: ObserverInvocation) => {original body})`. Original guard,
//   return and catch order are preserved byte-for-byte apart from the taps
//   below; any `this`, `arguments`, `yield` or `super` inside a registered
//   body is rejected, never rewritten.
// - Actor taps are inserted only after the EXISTING auth statement:
//   `const user = await getCurrentUser()` (requests.createRequest) or the
//   `const { user: _authUser } = (await auth()) ?? {}` + `const userId =
//   _authUser?.id` pair (all ten remaining exports), each as the FIRST
//   statement(s) of the body. No auth call is added.
// - Direct `await prisma.$transaction(...)` expressions (with their original
//   `.catch(...)` translations) are tapped in requests.createRequest,
//   requests.resubmitRequest, approvals.approveRequest,
//   approvals.rejectRequest and solutions.submitSolution only.
// - solutions.ts: the private `runSolutionTransactionWithNotifications(work,
//   options?, inv?)` helper gains an optional third `inv` token parameter;
//   both of its existing `prisma.$transaction` branches are instrumented
//   with `observeTransaction` before any notification dispatch; the six
//   registered callers append the token as a third argument, passing
//   `undefined` where the original call had no options.
// - The same-invocation prepared-description boundary producer wraps the
//   existing `await prepareInlineDescription({...})` calls in
//   requests.createRequest, requests.resubmitRequest,
//   solutions.submitSolution and solutions.resubmitSolution, observing the
//   raw input description SHA, the prepared HTML SHA and the actual prepared
//   upload session. No persisted after-state is read for it.
// The generated private module src/lib/rrm-action-observer.ts is emitted
// from the template below; it never imports product or test code and its
// journal writes only inside the baked private evidence directory.
// ============================================================================

/** Generated private module path inside the owned app copy. */
export const OBSERVER_MODULE_RELATIVE_PATH = 'src/lib/rrm-action-observer.ts'

const OBSERVER_ACTION_MODULE_PREFIXES: Readonly<Record<string, 'requests' | 'approvals' | 'solutions'>> = {
  'src/server-actions/requests.ts': 'requests',
  'src/server-actions/approvals.ts': 'approvals',
  'src/server-actions/solutions.ts': 'solutions',
}

const OBSERVER_IMPORT_SYMBOLS: Readonly<Record<string, string>> = {
  'src/server-actions/requests.ts': 'observeAuthenticatedActor, observePreparedDescription, observeTransaction, runObservedOriginal, type ObserverInvocation',
  'src/server-actions/approvals.ts': 'observeAuthenticatedActor, observeTransaction, runObservedOriginal, type ObserverInvocation',
  'src/server-actions/solutions.ts': 'observeAuthenticatedActor, observePreparedDescription, observeTransaction, runObservedOriginal, type ObserverInvocation',
}

export type ObserverActorAnchor = 'getCurrentUser-first-statement' | 'auth-userId-first-statements'

export type ObserverTransactionTap =
  | { mode: 'direct-await' }
  | { mode: 'solution-helper'; optionsArgument: 'present' | 'absent' }

export interface ObserverSourceConstraint {
  handler: HandlerKey
  relativePath: string
  exportName: string
  actorAnchor: ObserverActorAnchor
  transaction: ObserverTransactionTap
  preparedDescription: boolean
}

/** Recorded exact source AST match constraints; the transform is driven by
 *  this table and rejects any other mutation/transaction path. */
export const OBSERVER_SOURCE_AST_CONSTRAINTS: readonly ObserverSourceConstraint[] = [
  { handler: 'requests.createRequest', relativePath: 'src/server-actions/requests.ts', exportName: 'createRequest', actorAnchor: 'getCurrentUser-first-statement', transaction: { mode: 'direct-await' }, preparedDescription: true },
  { handler: 'requests.resubmitRequest', relativePath: 'src/server-actions/requests.ts', exportName: 'resubmitRequest', actorAnchor: 'auth-userId-first-statements', transaction: { mode: 'direct-await' }, preparedDescription: true },
  { handler: 'approvals.approveRequest', relativePath: 'src/server-actions/approvals.ts', exportName: 'approveRequest', actorAnchor: 'auth-userId-first-statements', transaction: { mode: 'direct-await' }, preparedDescription: false },
  { handler: 'approvals.rejectRequest', relativePath: 'src/server-actions/approvals.ts', exportName: 'rejectRequest', actorAnchor: 'auth-userId-first-statements', transaction: { mode: 'direct-await' }, preparedDescription: false },
  { handler: 'solutions.submitSolution', relativePath: 'src/server-actions/solutions.ts', exportName: 'submitSolution', actorAnchor: 'auth-userId-first-statements', transaction: { mode: 'direct-await' }, preparedDescription: true },
  { handler: 'solutions.resubmitSolution', relativePath: 'src/server-actions/solutions.ts', exportName: 'resubmitSolution', actorAnchor: 'auth-userId-first-statements', transaction: { mode: 'solution-helper', optionsArgument: 'present' }, preparedDescription: true },
  { handler: 'solutions.approveSolution', relativePath: 'src/server-actions/solutions.ts', exportName: 'approveSolution', actorAnchor: 'auth-userId-first-statements', transaction: { mode: 'solution-helper', optionsArgument: 'absent' }, preparedDescription: false },
  { handler: 'solutions.rejectSolution', relativePath: 'src/server-actions/solutions.ts', exportName: 'rejectSolution', actorAnchor: 'auth-userId-first-statements', transaction: { mode: 'solution-helper', optionsArgument: 'absent' }, preparedDescription: false },
  { handler: 'solutions.initiateFinalApproval', relativePath: 'src/server-actions/solutions.ts', exportName: 'initiateFinalApproval', actorAnchor: 'auth-userId-first-statements', transaction: { mode: 'solution-helper', optionsArgument: 'present' }, preparedDescription: false },
  { handler: 'solutions.approveFinalApproval', relativePath: 'src/server-actions/solutions.ts', exportName: 'approveFinalApproval', actorAnchor: 'auth-userId-first-statements', transaction: { mode: 'solution-helper', optionsArgument: 'absent' }, preparedDescription: false },
  { handler: 'solutions.rejectFinalApproval', relativePath: 'src/server-actions/solutions.ts', exportName: 'rejectFinalApproval', actorAnchor: 'auth-userId-first-statements', transaction: { mode: 'solution-helper', optionsArgument: 'absent' }, preparedDescription: false },
]

export interface SourceGuard { relativePath: string; sha256: string; exports: readonly HandlerKey[] }

export interface ObserverCopyInput {
  ownedRoot: string; appDir: string; evidenceDir: string
  guards: readonly SourceGuard[]; nextVersion: '15.5.23'
}

export interface ObserverCopyManifest {
  original: readonly SourceGuard[]; generated: readonly ArtifactRef[]
  registered: readonly HandlerKey[]; compiled: boolean
}

export interface ObserverCopyDeps {
  /** Existing bounded child runner; injected tests replace it to prove a
   *  failed build never produces a compiled manifest or an app spawn. */
  runChild?: typeof runChild
}

function observerSha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Emitted source of the generated private observer module. The evidence
 *  directory is baked in; the module never writes anywhere else. */
export function observerModuleSource(evidenceDir: string): string {
  return OBSERVER_MODULE_TEMPLATE.replace('__OBSERVER_EVIDENCE_DIR__', JSON.stringify(evidenceDir))
}

const OBSERVER_MODULE_TEMPLATE = String.raw`/**
 * GENERATED file — written by tests/support/native/rejection-recovery-runtime.ts
 * into the owned rejection-recovery app copy only. Never edit the original
 * product source to change this file and never import product or test modules
 * from here. The journal writer touches ONLY paths inside the baked private
 * evidence directory. Before admission, an identity/append/projection fault
 * fails closed with an observer admission error and zero original calls.
 * After the original invocation begins, every observation — clock reads,
 * journal appends, record/proof projections and fault recording — is
 * fenced: faults are latched and recorded to private stderr, never thrown
 * into business logic, and a failed clock yields no invented timestamp, so
 * the affected record is simply missing and the strict host evidence gate
 * fails closed.
 */
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, openSync, writeSync } from 'node:fs'

export type HandlerKey =
  | 'requests.createRequest' | 'requests.resubmitRequest'
  | 'approvals.approveRequest' | 'approvals.rejectRequest'
  | 'solutions.submitSolution' | 'solutions.resubmitSolution'
  | 'solutions.approveSolution' | 'solutions.rejectSolution'
  | 'solutions.initiateFinalApproval'
  | 'solutions.approveFinalApproval' | 'solutions.rejectFinalApproval'

export type JsonValue = null | boolean | number | string | JsonValue[]
  | { [key: string]: JsonValue }

export interface ClockMark { domain: string; monotonicMs: number; wallMs: number }

export type ObserverExit =
  | { state: 'returned'; projection: JsonValue }
  | { state: 'thrown'; code: string; digest: string | null }

export interface PreparedDescriptionProof {
  inputSha256: string
  htmlSha256: string
  uploadSessionId: string | null
}

export interface ObserverInvocation {
  readonly invocationId: string
  readonly handler: HandlerKey
  readonly argumentProjection: JsonValue
  actorId: string | null
  authObserved: boolean
  transaction: 'not-started' | 'resolved' | 'rejected' | 'unknown'
  start: ClockMark
  end: ClockMark | null
  exit: ObserverExit | null
  preparedDescription: PreparedDescriptionProof | null
  observerErrors: string[]
}

export type ObserverRecord =
  | { kind: 'begin'; invocationId: string; handler: HandlerKey; argumentProjection: JsonValue; at: ClockMark }
  | { kind: 'actor'; invocationId: string; actorId: string | null; authObserved: boolean; at: ClockMark }
  | { kind: 'transaction'; invocationId: string; phase: 'begin' | 'resolved' | 'rejected'; at: ClockMark }
  | { kind: 'prepared'; invocationId: string; inputSha256: string; htmlSha256: string; uploadSessionId: string | null; at: ClockMark }
  | { kind: 'exit'; invocationId: string; exit: ObserverExit; observerErrors: readonly string[]; at: ClockMark }
  | { kind: 'fault'; invocationId: string; observation: string; message: string; at: ClockMark }

export interface ObserverJournalDeps {
  append: (record: ObserverRecord) => void
  clock: () => ClockMark
  nextInvocationId: () => string
}

const OBSERVER_EVIDENCE_DIR = __OBSERVER_EVIDENCE_DIR__

function defaultJournal(): ObserverJournalDeps {
  const journalPath = OBSERVER_EVIDENCE_DIR + '/observer-journal.jsonl'
  return {
    append: (record: ObserverRecord): void => {
      const fd = openSync(journalPath, 'a')
      try {
        writeSync(fd, JSON.stringify(record) + '\n')
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
    },
    clock: (): ClockMark => ({ domain: 'observer', monotonicMs: performance.now(), wallMs: Date.now() }),
    nextInvocationId: (): string => 'observer-' + randomUUID(),
  }
}

let journal: ObserverJournalDeps = defaultJournal()

/** Explicit local dependency seam for host tests: append(record), clock()
 *  and nextInvocationId() are the ONLY journal effects of this module; no
 *  other hidden or ambient dependency exists. */
export function configureObserverJournal(deps: ObserverJournalDeps): void {
  journal = {
    append: (record) => { deps.append(record) },
    clock: () => deps.clock(),
    nextInvocationId: () => deps.nextInvocationId(),
  }
}

/** Thrown only for ADMISSION failures before the original handler runs:
 *  begin append/fsync failure. The safe projection contract can also refuse
 *  admission; either way zero business calls happen. Every later observation
 *  catches and latches its own errors instead of throwing into the original
 *  logic, and the exit capture returns the original object or rethrows the
 *  identical original error. */
export class ObserverAdmissionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ObserverAdmissionError'
  }
}

class ObserverContractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ObserverContractError'
  }
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function isJsonObject(value: unknown): value is { [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function jsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue
}

/** Canonical review-safe text. Length is JS UTF-16; blank does not imply
 * source validity. Raw schemas still run before argument normalization. */
function projectPrivateText(value: string): JsonValue {
  return {sha256:sha256Hex(value),length:value.length,blank:value.trim().length === 0}
}
function projectObservedPrivateText(value: unknown): JsonValue {
  // Observation is not source validation. Preserve previously admitted
  // invalid optional values without exporting their free contents.
  return typeof value === 'string' ? projectPrivateText(value) : {invalidType:value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value}
}
function privateTextValid(value: unknown): boolean {
  return isJsonObject(value) && Object.keys(value).sort().join(',') === 'blank,length,sha256'
    && typeof value.sha256 === 'string' && /^[0-9a-f]{64}$/.test(value.sha256) && Number.isInteger(value.length) && Number(value.length) >= 0 && typeof value.blank === 'boolean'
    && (value.length !== 0 || value.blank === true)
}
const KNOWN_ACTION_ERRORS = new Set([
  'Unauthorized', 'You cannot approve this request at this time', 'You cannot reject this request at this time',
  'You cannot approve this solution at this time', 'You cannot reject this solution at this time',
  'Comments are required when rejecting', 'This request was updated by another user.',
])
/** Only fixed source-supported errors carry meaning. Unknown text is a hash,
 * never an invented stale/denial code; raw message/stack/digest are not copied. */
function normalizeActionError(message: string, digest: unknown = null): {state:'thrown';code:string;digest:string|null} {
  return {state:'thrown',code:KNOWN_ACTION_ERRORS.has(message) ? message : 'unknown-error:' + sha256Hex(message),
    digest:typeof digest === 'string' ? (/^\d{1,20}$/.test(digest) ? digest : 'sha256:' + sha256Hex(digest)) : null}
}
function canonicalPrivateText(value: unknown): JsonValue {
  if (typeof value === 'string') return projectPrivateText(value)
  if (privateTextValid(value)) return value as JsonValue
  throw new ObserverContractError('result-shape:private-text')
}
/** Structural replica of the accepted safe argument normalization: rich text
 *  is hashed with JS UTF-16 code-unit lengths and only real schema defaults
 *  are made explicit. Validation stays in the original handler; inputs the
 *  schema would reject can never reach host correlation because the
 *  caller-side strict projection fails first. */
function safeProjectArguments(handler: HandlerKey, args: readonly unknown[]): JsonValue {
  const out: { [key: string]: JsonValue } = {}
  const objectInput = (): { [key: string]: unknown } => {
    if (args.length !== 1 || !isJsonObject(args[0])) throw new ObserverContractError('argument-shape:input-object')
    return args[0]
  }
  const content = (from: { [key: string]: unknown }, optional: boolean): void => {
    for (const field of ['title', 'description']) {
      if (optional && from[field] === undefined) continue
      if (typeof from[field] !== 'string') throw new ObserverContractError('argument-shape:' + field)
      out[field + 'Sha256'] = sha256Hex(from[field] as string)
      out[field + 'Length'] = (from[field] as string).length
    }
  }
  const copy = (from: { [key: string]: unknown }, keys: string[]): void => {
    for (const key of keys) if (from[key] !== undefined) out[key] = jsonValue(from[key])
  }
  switch (handler) {
    case 'requests.createRequest': {
      const from = objectInput()
      copy(from, ['inlineImageSessionId'])
      content(from, false)
      out.stagedAttachmentIds = jsonValue(from.stagedAttachmentIds ?? [])
      break
    }
    case 'requests.resubmitRequest': {
      const from = objectInput()
      copy(from, ['requestId', 'inlineImageSessionId'])
      content(from, true)
      break
    }
    case 'solutions.submitSolution': {
      const from = objectInput()
      copy(from, ['requestId', 'inlineImageSessionId'])
      content(from, false)
      copy(from, ['costEstimate', 'customApproverIds'])
      for (const key of ['timeline','conceptDesign']) if (from[key] !== undefined) {
        out[key] = projectObservedPrivateText(from[key])
      }
      out.currency = jsonValue(from.currency ?? 'THB')
      out.fileIds = jsonValue(from.fileIds ?? [])
      out.useCustomApprovals = jsonValue(from.useCustomApprovals ?? false)
      break
    }
    case 'solutions.resubmitSolution': {
      const from = objectInput()
      copy(from, ['requestId', 'inlineImageSessionId'])
      content(from, false)
      copy(from, ['cost', 'currency', 'useCustomHierarchy'])
      if (from.timeline !== undefined) {
        out.timeline = projectObservedPrivateText(from.timeline)
      }
      out.newFileIds = jsonValue(from.newFileIds ?? [])
      out.deletedFileIds = jsonValue(from.deletedFileIds ?? [])
      out.customApprovers = jsonValue(from.customApprovers ?? [])
      break
    }
    default: {
      const idField = handler === 'solutions.approveSolution' || handler === 'solutions.rejectSolution' ? 'solutionId' : 'requestId'
      if (args.length < 1 || args.length > 3) throw new ObserverContractError('argument-shape:arity')
      if (typeof args[0] !== 'string' || !args[0]) throw new ObserverContractError('argument-shape:' + idField)
      out[idField] = args[0]
      if (handler === 'solutions.initiateFinalApproval') {
        if (typeof args[1] !== 'boolean') throw new ObserverContractError('argument-shape:custom-chain')
        out.useCustomChain = args[1]
        if (args[2] !== undefined) out.customApproverIds = jsonValue(args[2])
      } else {
        if (args[1] !== undefined) {
          if (typeof args[1] !== 'string') throw new ObserverContractError('argument-shape:comments')
          out.comments = projectPrivateText(args[1])
        }
        if (args[2] !== undefined) out.expectedUpdatedAt = jsonValue(args[2] instanceof Date ? args[2].toISOString() : args[2])
      }
      break
    }
  }
  return out
}

/** Structural replica of the accepted safe result normalization. A shape
 *  violation latches and records no fabricated projection; the original
 *  object is returned unchanged either way. */
function safeProjectResult(handler: HandlerKey, value: unknown): JsonValue {
  if (!isJsonObject(value) || typeof value.success !== 'boolean') throw new ObserverContractError('result-shape:object-success')
  if (value.success === false) {
    if (value.stale === true && (typeof value.message === 'string' || privateTextValid(value.message))) return {success:false,stale:true,message:canonicalPrivateText(value.message)}
    if (handler === 'requests.createRequest' && (typeof value.error === 'string' || privateTextValid(value.error))) return {success:false,error:canonicalPrivateText(value.error)}
    if (handler === 'requests.createRequest' && isJsonObject(value.errors)) {
      const errors: {[key:string]:JsonValue} = {}
      for (const [key,list] of Object.entries(value.errors)) {
        if (!['title','description','inlineImageSessionId','stagedAttachmentIds'].includes(key) || !Array.isArray(list)) throw new ObserverContractError('result-shape:errors')
        errors[key] = list.map(canonicalPrivateText)
      }
      return {success:false,errors}
    }
    throw new ObserverContractError('result-shape:failure')
  }
  const result: {[key:string]:JsonValue} = {success:true}
  const requireId = (key:string): string => { const id=value[key]; if (typeof id !== 'string' || !id.trim()) throw new ObserverContractError('result-identity-missing:' + key); return id }
  if (handler === 'requests.createRequest') result.requestId = requireId('requestId')
  if (handler === 'solutions.submitSolution' || handler === 'solutions.resubmitSolution') result.solutionId = requireId('solutionId')
  if (handler === 'requests.resubmitRequest') {
    const id = isJsonObject(value.request) ? value.request.id : null; if (typeof id !== 'string' || !id) throw new ObserverContractError('result-identity-missing:request.id')
    result.request = {id}
  }
  if (handler === 'solutions.resubmitSolution') {
    for (const key of ['deletedAttachmentIds','cleanupWarnings']) {
      const v=value[key]; if (!Array.isArray(v) || (key === 'deletedAttachmentIds' && v.some(x=>typeof x !== 'string'))) throw new ObserverContractError('result-shape:' + key)
      result[key]=key === 'cleanupWarnings' ? v.map(canonicalPrivateText) : v
    }
  }
  return result
}

/** Diagnostic text only, never an original thrown-value projection. Even
 *  instanceof, message access and string coercion can throw for unknown faults.
 *  Keep a literal fallback so the sticky fault survives failed rendering. */
function faultMessage(error: unknown): string {
  try {
    return String(error instanceof Error ? error.message : error)
  } catch {
    return '[unrenderable observer fault]'
  }
}

function latch(inv: ObserverInvocation, observation: string, error: unknown): string {
  const message = faultMessage(error)
  if (!inv.observerErrors.includes(observation + ':' + message)) inv.observerErrors.push(observation + ':' + message)
  try {
    process.stderr.write('[rrm-action-observer] fault on ' + inv.handler + ' at ' + observation + ': ' + message + '\n')
  } catch {
    // Even fault recording can fail; the missing journal sequence then fails
    // the host evidence gate closed.
  }
  return message
}

/** Nonthrowing post-admission clock read. A clock fault is latched like any
 *  other observation fault and yields NO invented timestamp: the affected
 *  record is then simply not written, so the missing required record still
 *  fails the strict host evidence gate closed. Never called before admission. */
function observationClock(inv: ObserverInvocation, observation: string): ClockMark | null {
  try {
    return journal.clock()
  } catch (error) {
    latch(inv, observation + ':clock', error)
    return null
  }
}

/** Post-admission record fence: build the record only from an honest clock
 *  mark, then append it; append faults latch as usual. After the original
 *  invocation begins, neither the clock read nor the append may throw into
 *  the original logic, short-circuit it, or replace its exact outcome. */
function fencedRecord(inv: ObserverInvocation, observation: string, build: (at: ClockMark) => ObserverRecord): void {
  const at = observationClock(inv, observation)
  if (!at) return
  latchAppend(inv, observation, build(at))
}

function latchAppend(inv: ObserverInvocation, observation: string, record: ObserverRecord): void {
  try {
    journal.append(record)
  } catch (error) {
    const message = latch(inv, observation, error)
    try {
      journal.append({ kind: 'fault', invocationId: inv.invocationId, observation, message, at: journal.clock() })
    } catch {
      // The fault record itself failed too; the missing required sequence
      // still fails the host evidence gate closed.
    }
  }
}

export function observeAuthenticatedActor(inv: ObserverInvocation, actorId: string | null): void {
  inv.actorId = actorId
  inv.authObserved = true
  fencedRecord(inv, 'actor', (at) => ({ kind: 'actor', invocationId: inv.invocationId, actorId, authObserved: true, at }))
}

export function observeTransaction<T>(inv: ObserverInvocation, original: () => Promise<T>): Promise<T> {
  inv.transaction = 'unknown'
  fencedRecord(inv, 'transaction-begin', (at) => ({ kind: 'transaction', invocationId: inv.invocationId, phase: 'begin', at }))
  let pending: Promise<T>
  try {
    pending = original()
  } catch (error) {
    inv.transaction = 'rejected'
    fencedRecord(inv, 'transaction-rejected', (at) => ({ kind: 'transaction', invocationId: inv.invocationId, phase: 'rejected', at }))
    throw error
  }
  return pending.then(
    (value) => {
      inv.transaction = 'resolved'
      fencedRecord(inv, 'transaction-resolved', (at) => ({ kind: 'transaction', invocationId: inv.invocationId, phase: 'resolved', at }))
      return value
    },
    (error) => {
      inv.transaction = 'rejected'
      fencedRecord(inv, 'transaction-rejected', (at) => ({ kind: 'transaction', invocationId: inv.invocationId, phase: 'rejected', at }))
      throw error
    },
  )
}

/** Same-invocation prepared-description boundary producer: records the raw
 *  input description SHA, the prepared HTML SHA and the actual prepared
 *  upload session. This is an observation of the live prepare call, never a
 *  reconstruction from persisted state. Returns the prepared object
 *  unchanged. */
export function observePreparedDescription<P extends { html: string }>(
  inv: ObserverInvocation,
  rawDescription: string,
  uploadSessionId: string | null | undefined,
  prepared: P,
): P {
  let proof: PreparedDescriptionProof
  try {
    proof = {
      inputSha256: sha256Hex(typeof rawDescription === 'string' ? rawDescription : String(rawDescription)),
      htmlSha256: sha256Hex(prepared.html),
      uploadSessionId: typeof uploadSessionId === 'string' ? uploadSessionId : null,
    }
  } catch (error) {
    // Even proof hashing is a post-admission observation: it latches and
    // returns the prepared object unchanged, never throwing into the flow.
    latch(inv, 'prepared-description', error)
    return prepared
  }
  inv.preparedDescription = proof
  fencedRecord(inv, 'prepared-description', (at) => ({
    kind: 'prepared', invocationId: inv.invocationId, inputSha256: proof.inputSha256,
    htmlSha256: proof.htmlSha256, uploadSessionId: proof.uploadSessionId, at,
  }))
  return prepared
}

export async function runObservedOriginal<T>(
  handler: HandlerKey,
  args: readonly unknown[],
  original: (inv: ObserverInvocation) => Promise<T>,
): Promise<T> {
  let start: ClockMark
  let invocationId: string
  try {
    start = journal.clock()
    invocationId = journal.nextInvocationId()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    try {
      process.stderr.write('[rrm-action-observer] admission fault on ' + handler + ' at identity-clock: ' + message + '\n')
    } catch {
      // Fault recording itself failed; the thrown observer error still fails closed.
    }
    throw new ObserverAdmissionError('observer admission failed before the original ' + handler + ' invocation at identity-clock: ' + message)
  }
  let argumentProjection: JsonValue
  try {
    argumentProjection = safeProjectArguments(handler, args)
  } catch (error) {
    try {
      process.stderr.write('[rrm-action-observer] admission fault on ' + handler + ' at argument-projection: ' + (error instanceof Error ? error.message : String(error)) + '\n')
    } catch {
      // Fault recording itself failed; the thrown observer error still fails closed.
    }
    throw error
  }
  const inv: ObserverInvocation = {
    invocationId,
    handler,
    argumentProjection,
    actorId: null,
    authObserved: false,
    transaction: 'not-started',
    start,
    end: null,
    exit: null,
    preparedDescription: null,
    observerErrors: [],
  }
  try {
    journal.append({ kind: 'begin', invocationId, handler, argumentProjection, at: start })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    try {
      process.stderr.write('[rrm-action-observer] admission fault on ' + handler + ' at begin: ' + message + '\n')
    } catch {
      // Fault recording itself failed; the thrown observer error still fails closed.
    }
    throw new ObserverAdmissionError('observer admission failed before the original ' + handler + ' invocation: ' + message)
  }
  let result: T
  try {
    result = await original(inv)
  } catch (error) {
    inv.end = observationClock(inv, 'exit')
    let exit: ObserverExit
    try {
      const digestValue = error !== null && typeof error === 'object' ? (error as { digest?: unknown }).digest : null
      const digest = typeof digestValue === 'string' ? digestValue : null
      const code = error instanceof Error ? error.message : String(error)
      if (typeof code !== 'string') throw new ObserverContractError('throw-shape:message')
      exit = normalizeActionError(code, digest)
    } catch (projectionError) {
      // Unlike diagnostic rendering, unavailable business-error evidence has
      // no fallback. Keep exit missing and rethrow the exact original value.
      latch(inv, 'throw-projection', projectionError)
      throw error
    }
    inv.exit = exit
    if (inv.end) latchAppend(inv, 'exit', { kind: 'exit', invocationId, exit, observerErrors: [...inv.observerErrors], at: inv.end })
    throw error
  }
  inv.end = observationClock(inv, 'exit')
  let exit: ObserverExit
  try {
    exit = { state: 'returned', projection: safeProjectResult(handler, result) }
  } catch (error) {
    exit = { state: 'returned', projection: null }
    latch(inv, 'result-projection', error)
  }
  inv.exit = exit
  if (inv.end) latchAppend(inv, 'exit', { kind: 'exit', invocationId, exit, observerErrors: [...inv.observerErrors], at: inv.end })
  return result
}
`

interface ObserverSpliceOp { start: number; end: number; text: string }

function applyObserverSplices(source: string, ops: readonly ObserverSpliceOp[]): string {
  const ordered = [...ops].sort((a, b) => a.start - b.start || a.end - b.end)
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].start < ordered[index - 1].end) {
      throw new MatrixRuntimeError('observer transform produced overlapping source splices')
    }
  }
  let output = ''
  let cursor = 0
  for (const op of ordered) {
    output += source.slice(cursor, op.start) + op.text
    cursor = op.end
  }
  return output + source.slice(cursor)
}

function parseObserverFunctions(sf: ts.SourceFile): Map<string, ts.FunctionDeclaration> {
  const found = new Map<string, ts.FunctionDeclaration>()
  for (const statement of sf.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      if (found.has(statement.name.text)) {
        throw new MatrixRuntimeError(`observer transform found a duplicate function declaration ${statement.name.text}`)
      }
      found.set(statement.name.text, statement)
    }
  }
  return found
}

function observerExportNames(sf: ts.SourceFile): string[] {
  const names: string[] = []
  for (const statement of sf.statements) {
    const modifiers = (statement as { modifiers?: readonly ts.Modifier[] }).modifiers
    const exported = modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false
    if (!exported) continue
    if (ts.isFunctionDeclaration(statement) && statement.name) names.push('function:' + statement.name.text)
    else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) names.push('variable:' + declaration.name.getText(sf))
    } else if (
      (ts.isInterfaceDeclaration(statement) || ts.isClassDeclaration(statement)
        || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name
    ) {
      names.push(statement.kind + ':' + statement.name.text)
    }
  }
  return names.sort()
}

function requireRegisteredExport(fn: ts.FunctionDeclaration | undefined, exportName: string, relativePath: string): ts.FunctionDeclaration {
  if (!fn) throw new MatrixRuntimeError(`observer guard expects export ${exportName} in ${relativePath}`)
  if (!fn.body || !ts.isBlock(fn.body)) throw new MatrixRuntimeError(`registered export ${exportName} in ${relativePath} must have a block body`)
  const isAsync = fn.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false
  const isExported = fn.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false
  if (!isAsync || !isExported) throw new MatrixRuntimeError(`registered export ${exportName} in ${relativePath} must remain an exported async function`)
  return fn
}

function rejectUnsupportedLexicalConstructs(fn: ts.FunctionDeclaration, sf: ts.SourceFile): void {
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.ThisKeyword) found.push('this@' + node.getStart(sf))
    if (ts.isIdentifier(node) && node.text === 'arguments') {
      const parent = node.parent
      const isPropertyPosition = ts.isPropertyAccessExpression(parent) && parent.name === node
        || ts.isPropertyAssignment(parent) && parent.name === node
      if (!isPropertyPosition) found.push('arguments@' + node.getStart(sf))
    }
    if (ts.isYieldExpression(node)) found.push('yield@' + node.getStart(sf))
    if (node.kind === ts.SyntaxKind.SuperKeyword) found.push('super@' + node.getStart(sf))
    ts.forEachChild(node, visit)
  }
  visit(fn.body as ts.Block)
  if (found.length > 0) {
    throw new MatrixRuntimeError(`observer transform refuses unsupported lexical construct(s) in ${fn.name?.text}: ${found.join(', ')}`)
  }
}

function findActorAnchor(
  fn: ts.FunctionDeclaration,
  sf: ts.SourceFile,
  anchor: ObserverActorAnchor,
): { end: number; tapArgument: string } {
  const body = fn.body as ts.Block
  const statements = body.statements
  if (anchor === 'getCurrentUser-first-statement') {
    const first = statements[0]
    const declaration = first && ts.isVariableStatement(first) && first.declarationList.declarations.length === 1
      ? first.declarationList.declarations[0]
      : undefined
    const initializer = declaration?.initializer
    const call = initializer && ts.isAwaitExpression(initializer) && ts.isCallExpression(initializer.expression)
      ? initializer.expression
      : undefined
    const ok = !!declaration && declaration.name.getText(sf) === 'user' && !!call
      && ts.isIdentifier(call.expression) && call.expression.text === 'getCurrentUser' && call.arguments.length === 0
    if (!ok) {
      throw new MatrixRuntimeError(`observer actor anchor missing in ${fn.name?.text}: expected the first statement to be 'const user = await getCurrentUser()'`)
    }
    return { end: (first as ts.Statement).getEnd(), tapArgument: 'user?.id ?? null' }
  }
  const first = statements[0]
  const second = statements[1]
  const firstDeclaration = first && ts.isVariableStatement(first) && first.declarationList.declarations.length === 1
    ? first.declarationList.declarations[0]
    : undefined
  const binding = firstDeclaration?.name
  const bindingElement = binding && ts.isObjectBindingPattern(binding) && binding.elements.length === 1 ? binding.elements[0] : undefined
  const firstInitializer = firstDeclaration?.initializer
  const nullishAuth = firstInitializer && ts.isBinaryExpression(firstInitializer)
    && firstInitializer.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    && ts.isObjectLiteralExpression(firstInitializer.right)
    ? firstInitializer.left
    : undefined
  const awaitedAuth = nullishAuth && ts.isParenthesizedExpression(nullishAuth)
    ? nullishAuth.expression
    : nullishAuth
  const authCall = awaitedAuth && ts.isAwaitExpression(awaitedAuth) && ts.isCallExpression(awaitedAuth.expression)
    ? awaitedAuth.expression
    : undefined
  const firstOk = !!bindingElement && !bindingElement.dotDotDotToken
    && (bindingElement.propertyName === undefined || (ts.isIdentifier(bindingElement.propertyName) && bindingElement.propertyName.text === 'user'))
    && ts.isIdentifier(bindingElement.name) && bindingElement.name.text === '_authUser'
    && !!authCall && ts.isIdentifier(authCall.expression) && authCall.expression.text === 'auth' && authCall.arguments.length === 0
  const secondDeclaration = second && ts.isVariableStatement(second) && second.declarationList.declarations.length === 1
    ? second.declarationList.declarations[0]
    : undefined
  const secondInitializer = secondDeclaration?.initializer
  const secondOk = !!secondDeclaration && secondDeclaration.name.getText(sf) === 'userId'
    && !!secondInitializer && ts.isPropertyAccessExpression(secondInitializer)
    && ts.isIdentifier(secondInitializer.expression) && secondInitializer.expression.text === '_authUser'
    && secondInitializer.questionDotToken !== undefined && secondInitializer.name.text === 'id'
  if (!firstOk || !secondOk) {
    throw new MatrixRuntimeError(`observer actor anchor missing in ${fn.name?.text}: expected the first statements to be 'const { user: _authUser } = (await auth()) ?? {}' and 'const userId = _authUser?.id'`)
  }
  return { end: (second as ts.Statement).getEnd(), tapArgument: 'userId ?? null' }
}

function rootTransactionCall(expression: ts.Expression): ts.CallExpression | undefined {
  let current = expression
  while (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression) && current.expression.name.text === 'catch') {
    current = current.expression.expression
  }
  if (
    ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)
    && ts.isIdentifier(current.expression.expression) && current.expression.expression.text === 'prisma'
    && current.expression.name.text === '$transaction'
  ) return current
  return undefined
}

function findDirectTransactionAwait(fn: ts.FunctionDeclaration, sf: ts.SourceFile): ts.AwaitExpression {
  const found: ts.AwaitExpression[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isAwaitExpression(node) && rootTransactionCall(node.expression)) found.push(node)
    ts.forEachChild(node, visit)
  }
  visit(fn.body as ts.Block)
  if (found.length !== 1) {
    throw new MatrixRuntimeError(`observer transform expected exactly one direct prisma.$transaction await in ${fn.name?.text}, found ${found.length}`)
  }
  return found[0]
}

function findPreparedCall(fn: ts.FunctionDeclaration, sf: ts.SourceFile): { span: ts.AwaitExpression; descriptionText: string; sessionText: string } {
  const found: ts.CallExpression[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'prepareInlineDescription') found.push(node)
    ts.forEachChild(node, visit)
  }
  visit(fn.body as ts.Block)
  if (found.length !== 1) {
    throw new MatrixRuntimeError(`observer transform expected exactly one prepareInlineDescription call in ${fn.name?.text}, found ${found.length}`)
  }
  const call = found[0]
  if (!ts.isAwaitExpression(call.parent)) {
    throw new MatrixRuntimeError(`prepareInlineDescription in ${fn.name?.text} must be awaited directly`)
  }
  const argument = call.arguments[0]
  if (call.arguments.length !== 1 || !ts.isObjectLiteralExpression(argument)) {
    throw new MatrixRuntimeError(`prepareInlineDescription in ${fn.name?.text} must take one object literal`)
  }
  const properties = new Map<string, ts.Expression>()
  for (const property of argument.properties) {
    if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name)) {
      properties.set(property.name.text, property.initializer)
    } else if (ts.isShorthandPropertyAssignment(property)) {
      properties.set(property.name.getText(sf), property.name)
    } else {
      throw new MatrixRuntimeError(`prepareInlineDescription input in ${fn.name?.text} must use explicit property assignments`)
    }
  }
  const description = properties.get('description')
  const session = properties.get('uploadSessionId')
  if (!description || !session || !properties.get('userId')) {
    throw new MatrixRuntimeError(`prepareInlineDescription input in ${fn.name?.text} needs description, userId and uploadSessionId properties`)
  }
  return { span: call.parent, descriptionText: description.getText(sf), sessionText: session.getText(sf) }
}

function findHelperCall(fn: ts.FunctionDeclaration, sf: ts.SourceFile, expectedOptions: 'present' | 'absent'): ts.CallExpression {
  const found: ts.CallExpression[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'runSolutionTransactionWithNotifications') found.push(node)
    ts.forEachChild(node, visit)
  }
  visit(fn.body as ts.Block)
  if (found.length !== 1) {
    throw new MatrixRuntimeError(`observer transform expected exactly one runSolutionTransactionWithNotifications call in ${fn.name?.text}, found ${found.length}`)
  }
  const call = found[0]
  if (call.arguments.length < 1 || call.arguments.length > 2) {
    throw new MatrixRuntimeError(`registered solution helper call in ${fn.name?.text} has ${call.arguments.length} arguments; expected work plus optional options`)
  }
  const actualOptions = call.arguments.length === 2 ? 'present' : 'absent'
  if (actualOptions !== expectedOptions) {
    throw new MatrixRuntimeError(`registered solution helper call in ${fn.name?.text} drifted: options argument ${actualOptions}, constraint requires ${expectedOptions}`)
  }
  return call
}

function wrapRegisteredBody(
  source: string,
  fn: ts.FunctionDeclaration,
  sf: ts.SourceFile,
  constraint: ObserverSourceConstraint,
): ObserverSpliceOp {
  const body = fn.body as ts.Block
  rejectUnsupportedLexicalConstructs(fn, sf)
  const innerStart = body.getStart(sf) + 1
  const innerEnd = body.getEnd() - 1
  const inner: ObserverSpliceOp[] = []
  const actor = findActorAnchor(fn, sf, constraint.actorAnchor)
  inner.push({ start: actor.end, end: actor.end, text: '\n  observeAuthenticatedActor(inv, ' + actor.tapArgument + ')' })
  if (constraint.transaction.mode === 'direct-await') {
    const awaited = findDirectTransactionAwait(fn, sf)
    inner.push({ start: awaited.expression.getStart(sf), end: awaited.expression.getEnd(), text: 'observeTransaction(inv, () => ' + awaited.expression.getText(sf) + ')' })
  } else {
    const call = findHelperCall(fn, sf, constraint.transaction.optionsArgument)
    const lastArgument = call.arguments[call.arguments.length - 1]
    const injected = constraint.transaction.optionsArgument === 'absent' ? ', undefined, inv)' : ', inv)'
    inner.push({ start: lastArgument.getEnd(), end: call.getEnd(), text: injected })
  }
  if (constraint.preparedDescription) {
    const prepared = findPreparedCall(fn, sf)
    inner.push({
      start: prepared.span.getStart(sf),
      end: prepared.span.getEnd(),
      text: 'observePreparedDescription(inv, ' + prepared.descriptionText + ', ' + prepared.sessionText + ', ' + prepared.span.getText(sf) + ')',
    })
  }
  const relative = inner
    .map((op) => ({ start: op.start - innerStart, end: op.end - innerStart, text: op.text }))
    .sort((a, b) => a.start - b.start)
  const newBody = applyObserverSplices(source.slice(innerStart, innerEnd), relative)
  const parameterNames = fn.parameters.map((parameter) => {
    if (!ts.isIdentifier(parameter.name)) {
      throw new MatrixRuntimeError(`registered export ${constraint.exportName} has a non-identifier parameter`)
    }
    return parameter.name.text
  })
  const wrapped = '{\n    return runObservedOriginal(\'' + constraint.handler + '\', ['
    + parameterNames.join(', ') + '], async (inv: ObserverInvocation) => {' + newBody + '})\n  }'
  return { start: body.getStart(sf), end: body.getEnd(), text: wrapped }
}

function transformSolutionHelper(sf: ts.SourceFile, ops: ObserverSpliceOp[]): void {
  const functions = parseObserverFunctions(sf)
  const helper = functions.get('runSolutionTransactionWithNotifications')
  if (!helper || !helper.body) {
    throw new MatrixRuntimeError('observer transform requires the private runSolutionTransactionWithNotifications helper in solutions.ts')
  }
  const parameters = helper.parameters
  if (parameters.length !== 2 || !parameters[1].questionToken || parameters[1].name.getText(sf) !== 'options') {
    throw new MatrixRuntimeError('solution helper signature drifted from (work, options?)')
  }
  ops.push({ start: parameters[1].getEnd(), end: parameters[1].getEnd(), text: ', inv?: ObserverInvocation' })
  const transactions: ts.CallExpression[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && rootTransactionCall(node)) transactions.push(node)
    ts.forEachChild(node, visit)
  }
  visit(helper.body)
  if (transactions.length !== 2) {
    throw new MatrixRuntimeError(`solution helper must contain exactly two prisma.$transaction branches, found ${transactions.length}`)
  }
  for (const call of transactions) {
    ops.push({ start: call.getStart(sf), end: call.getEnd(), text: 'observeTransaction(inv!, () => ' + call.getText(sf) + ')' })
  }
}

function verifyTransformedOutput(output: string, guard: SourceGuard, beforeExports: readonly string[]): void {
  const re = ts.createSourceFile(guard.relativePath, output, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  const diagnostics = (re as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics
  if (diagnostics && diagnostics.length > 0) {
    throw new MatrixRuntimeError(`observer transform output failed to parse for ${guard.relativePath}: ${String(diagnostics[0].messageText)}`)
  }
  const afterExports = observerExportNames(re)
  if (beforeExports.join('|') !== afterExports.join('|')) {
    throw new MatrixRuntimeError(`observer transform changed the export surface of ${guard.relativePath}`)
  }
  const functions = parseObserverFunctions(re)
  const constraints = OBSERVER_SOURCE_AST_CONSTRAINTS.filter((constraint) => constraint.relativePath === guard.relativePath)
  let runCalls = 0
  let actorCalls = 0
  let transactionCalls = 0
  let preparedCalls = 0
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === 'runObservedOriginal') runCalls += 1
      if (node.expression.text === 'observeAuthenticatedActor') actorCalls += 1
      if (node.expression.text === 'observeTransaction') transactionCalls += 1
      if (node.expression.text === 'observePreparedDescription') preparedCalls += 1
    }
    ts.forEachChild(node, visit)
  }
  visit(re)
  const expectedRuns = constraints.length
  const expectedActors = constraints.length
  const expectedTransactions = constraints.filter((constraint) => constraint.transaction.mode === 'direct-await').length
    + (guard.relativePath === 'src/server-actions/solutions.ts' ? 2 : 0)
  const expectedPrepared = constraints.filter((constraint) => constraint.preparedDescription).length
  if (runCalls !== expectedRuns || actorCalls !== expectedActors || transactionCalls !== expectedTransactions || preparedCalls !== expectedPrepared) {
    throw new MatrixRuntimeError(
      `observer transform verification failed tap counts for ${guard.relativePath}`
      + ` (run=${runCalls}/${expectedRuns}, actor=${actorCalls}/${expectedActors}, tx=${transactionCalls}/${expectedTransactions}, prepared=${preparedCalls}/${expectedPrepared})`,
    )
  }
  const unwrapped: string[] = []
  for (const constraint of constraints) {
    const fn = functions.get(constraint.exportName)
    if (!fn || !fn.body) throw new MatrixRuntimeError(`observer transform lost ${constraint.exportName} in ${guard.relativePath}`)
    const visitTransactions = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === '$transaction') {
        let wrapped = false
        for (let ancestor: ts.Node | undefined = node.parent; ancestor && ancestor !== fn.body; ancestor = ancestor.parent) {
          if (ts.isCallExpression(ancestor) && ts.isIdentifier(ancestor.expression) && ancestor.expression.text === 'observeTransaction') {
            wrapped = true
            break
          }
        }
        if (!wrapped) unwrapped.push(constraint.exportName + '@' + node.getStart(re))
      }
      ts.forEachChild(node, visitTransactions)
    }
    visitTransactions(fn.body)
  }
  if (unwrapped.length > 0) {
    throw new MatrixRuntimeError(`observer transform left unwrapped transaction calls in ${guard.relativePath}: ${unwrapped.join(', ')}`)
  }
  if (guard.relativePath === 'src/server-actions/solutions.ts') {
    const helper = functions.get('runSolutionTransactionWithNotifications')
    if (!helper) throw new MatrixRuntimeError('observer transform lost the solution helper')
    const invParameter = helper.parameters[2]
    if (!invParameter || invParameter.name.getText(re) !== 'inv' || !invParameter.questionToken) {
      throw new MatrixRuntimeError('observer transform did not add the optional inv token parameter to the solution helper')
    }
    let callerCount = 0
    const visitCalls = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'runSolutionTransactionWithNotifications') {
        const last = node.arguments[node.arguments.length - 1]
        if (!last || last.getText(re) !== 'inv') {
          throw new MatrixRuntimeError('a registered solution helper call site is missing the inv token argument')
        }
        callerCount += 1
      }
      ts.forEachChild(node, visitCalls)
    }
    visitCalls(re)
    const expectedCallers = OBSERVER_SOURCE_AST_CONSTRAINTS.filter((constraint) => constraint.transaction.mode === 'solution-helper').length
    if (callerCount !== expectedCallers) {
      throw new MatrixRuntimeError(`expected ${expectedCallers} registered solution helper call sites with inv tokens, found ${callerCount}`)
    }
  }
}

/** Deterministic AST-local guarded transform of one copied action module.
 *  Preserves the original exports/signatures/parameters and every original
 *  byte apart from the recorded taps; rejects missing/renamed/duplicate
 *  exports, unexpected auth/transaction sites, hash mismatch and unsupported
 *  lexical constructs instead of rewriting them. */
export function transformObserverSource(source: string, guard: SourceGuard): string {
  const prefix = OBSERVER_ACTION_MODULE_PREFIXES[guard.relativePath]
  if (!prefix) throw new MatrixRuntimeError(`observer transform target is not a registered copy source: ${guard.relativePath}`)
  if (observerSha256(source) !== guard.sha256) {
    throw new MatrixRuntimeError(`observer source guard hash mismatch for ${guard.relativePath}`)
  }
  const constraints = OBSERVER_SOURCE_AST_CONSTRAINTS.filter((constraint) => constraint.relativePath === guard.relativePath)
  if (constraints.length === 0) throw new MatrixRuntimeError(`no registered observer constraints for ${guard.relativePath}`)
  const expectedHandlers = constraints.map((constraint) => constraint.handler).sort().join('|')
  const providedHandlers = [...guard.exports].sort().join('|')
  if (expectedHandlers !== providedHandlers) {
    throw new MatrixRuntimeError(`observer guard exports for ${guard.relativePath} must be exactly [${expectedHandlers}]`)
  }
  const sf = ts.createSourceFile(guard.relativePath, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  const beforeExports = observerExportNames(sf)
  const functions = parseObserverFunctions(sf)
  const ops: ObserverSpliceOp[] = []
  let lastImportEnd = -1
  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement)) lastImportEnd = statement.getEnd()
  }
  if (lastImportEnd < 0) throw new MatrixRuntimeError(`${guard.relativePath} has no import section to anchor the observer import`)
  ops.push({
    start: lastImportEnd,
    end: lastImportEnd,
    text: "\nimport { " + OBSERVER_IMPORT_SYMBOLS[guard.relativePath] + " } from '../lib/rrm-action-observer'",
  })
  for (const constraint of constraints) {
    const fn = requireRegisteredExport(functions.get(constraint.exportName), constraint.exportName, guard.relativePath)
    ops.push(wrapRegisteredBody(source, fn, sf, constraint))
  }
  if (prefix === 'solutions') transformSolutionHelper(sf, ops)
  const output = applyObserverSplices(source, ops)
  verifyTransformedOutput(output, guard, beforeExports)
  return output
}

/** Fresh guards pinned to the actual bytes of a freshly copied app dir. */
export async function matrixObserverSourceGuards(appDir: string): Promise<SourceGuard[]> {
  const guards: SourceGuard[] = []
  for (const relativePath of Object.keys(OBSERVER_ACTION_MODULE_PREFIXES)) {
    const bytes = await fs.readFile(path.join(appDir, relativePath), 'utf8')
    guards.push({
      relativePath,
      sha256: observerSha256(bytes),
      exports: OBSERVER_SOURCE_AST_CONSTRAINTS
        .filter((constraint) => constraint.relativePath === relativePath)
        .map((constraint) => constraint.handler),
    })
  }
  return guards
}

async function appendObserverJournalRecord(evidenceDir: string, record: Record<string, unknown>): Promise<void> {
  const fd = await fs.open(path.join(evidenceDir, 'observer-journal.jsonl'), 'a')
  try {
    await fd.write(JSON.stringify(record) + '\n')
    await fd.sync()
  } finally {
    await fd.close()
  }
}

/** Build the guarded observed copy of one owned app dir: realpath ownership
 *  checks, fresh source guard verification before the transform, generation
 *  of the private observer module plus exactly the three copied-source
 *  transforms, after-copy re-verification, a writable private journal
 *  admission record, and the separate compile gate (exit 0) whose log is
 *  saved BEFORE any app spawn. Compilation here is not the later readiness
 *  or served-binding verification. No encryptionKey or other opaque private
 *  manifest material is read. */
export async function prepareObservedAppCopy(input: ObserverCopyInput, deps: ObserverCopyDeps = {}): Promise<ObserverCopyManifest> {
  if (input.nextVersion !== '15.5.23') {
    throw new MatrixRuntimeError(`observer copy next-version drift: requires 15.5.23, received ${String(input.nextVersion)}`)
  }
  const supportedPaths = Object.keys(OBSERVER_ACTION_MODULE_PREFIXES)
  if (input.guards.length !== supportedPaths.length) {
    throw new MatrixRuntimeError(`observer copy requires exactly ${supportedPaths.length} fresh source guards, received ${input.guards.length}`)
  }
  const ownedReal = await fs.realpath(input.ownedRoot)
  const appReal = await fs.realpath(input.appDir)
  if (appReal !== path.join(ownedReal, 'app')) {
    throw new MatrixRuntimeError(`observer copy owner mismatch: ${appReal} is not the app copy of owned root ${ownedReal}`)
  }
  await fs.mkdir(input.evidenceDir, { recursive: true, mode: 0o700 })
  const evidenceReal = await fs.realpath(input.evidenceDir)
  if (evidenceReal !== ownedReal && !evidenceReal.startsWith(ownedReal + path.sep)) {
    throw new MatrixRuntimeError(`observer journal evidence dir ${evidenceReal} is not under owned root ${ownedReal}`)
  }
  if (evidenceReal === appReal || evidenceReal.startsWith(appReal + path.sep)) {
    throw new MatrixRuntimeError('observer journal evidence dir must stay outside the generated app copy')
  }
  const seen = new Set<string>()
  const originals = new Map<string, string>()
  for (const guard of input.guards) {
    if (path.isAbsolute(guard.relativePath) || guard.relativePath.split('/').includes('..')) {
      throw new MatrixRuntimeError(`observer guard path escapes the app copy: ${guard.relativePath}`)
    }
    if (seen.has(guard.relativePath)) throw new MatrixRuntimeError(`duplicate observer guard for ${guard.relativePath}`)
    seen.add(guard.relativePath)
    if (!OBSERVER_ACTION_MODULE_PREFIXES[guard.relativePath]) {
      throw new MatrixRuntimeError(`observer guard path is not a registered transform target: ${guard.relativePath}`)
    }
    const target = path.join(appReal, guard.relativePath)
    const targetReal = await fs.realpath(target)
    if (targetReal !== target) {
      throw new MatrixRuntimeError(`observer guard target must not traverse symlinks: ${guard.relativePath} -> ${targetReal}`)
    }
    const bytes = await fs.readFile(targetReal, 'utf8')
    if (observerSha256(bytes) !== guard.sha256) {
      throw new MatrixRuntimeError(`fresh observer source guard mismatch for ${guard.relativePath}`)
    }
    originals.set(guard.relativePath, bytes)
  }
  const packageJson = JSON.parse(await fs.readFile(path.join(appReal, 'package.json'), 'utf8')) as { dependencies?: Record<string, unknown> }
  if (packageJson.dependencies?.next !== input.nextVersion) {
    throw new MatrixRuntimeError(`copied app next-version drift: package.json has ${String(packageJson.dependencies?.next)}, observer copy requires ${input.nextVersion}`)
  }
  const observerPath = path.join(appReal, 'src', 'lib', 'rrm-action-observer.ts')
  let observerExists = true
  try {
    await fs.lstat(observerPath)
  } catch {
    observerExists = false
  }
  if (observerExists) {
    throw new MatrixRuntimeError(`generated observer module path already exists; refusing original-file overwrite at ${observerPath}`)
  }
  await fs.mkdir(path.dirname(observerPath), { recursive: true })
  const moduleSource = observerModuleSource(evidenceReal)
  await fs.writeFile(observerPath, moduleSource, { mode: 0o600 })
  for (const guard of input.guards) {
    const transformed = transformObserverSource(originals.get(guard.relativePath) as string, guard)
    await fs.writeFile(path.join(appReal, guard.relativePath), transformed)
  }
  const generated: ArtifactRef[] = []
  for (const guard of input.guards) {
    const written = await fs.readFile(path.join(appReal, guard.relativePath), 'utf8')
    const expected = transformObserverSource(originals.get(guard.relativePath) as string, guard)
    if (written !== expected) {
      throw new MatrixRuntimeError(`observer transform after-copy verification failed for ${guard.relativePath}`)
    }
    if (observerSha256(written) === guard.sha256) {
      throw new MatrixRuntimeError(`observer transform did not change guarded source ${guard.relativePath}`)
    }
    generated.push({ path: guard.relativePath, sha256: observerSha256(written), bytes: Buffer.byteLength(written) })
  }
  generated.push({ path: OBSERVER_MODULE_RELATIVE_PATH, sha256: observerSha256(moduleSource), bytes: Buffer.byteLength(moduleSource) })
  const registered = MATRIX_ACTION_REGISTRY.map((entry) => entry.handler)
  if (registered.length !== 11 || new Set(registered).size !== registered.length) {
    throw new MatrixRuntimeError('observer registry must hold exactly eleven distinct registered handlers')
  }
  await appendObserverJournalRecord(evidenceReal, {
    kind: 'admission',
    ownedRoot: ownedReal,
    appDir: appReal,
    evidenceDir: evidenceReal,
    nextVersion: input.nextVersion,
    templateSha256: observerSha256(moduleSource),
    guards: input.guards,
    generated,
    registered,
  })
  const run = deps.runChild ?? runChild
  const tscBin = path.join(appReal, 'node_modules', '.bin', 'tsc')
  await fs.access(tscBin)
  const compileLog = path.join(evidenceReal, 'observer-tsc-compile.log')
  try {
    await run(tscBin, ['--noEmit', '--incremental', 'false'], appReal, { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' }, compileLog, 600_000)
  } catch (error) {
    throw new MatrixRuntimeError(`observer copy compilation failed; app spawn stays blocked (log ${compileLog}): ${error instanceof Error ? error.message : String(error)}`)
  }
  return { original: [...input.guards], generated, registered, compiled: true }
}

// ===========================================================================
// clock-v3 lane B: pinned native metadata bridge, synchronous observer self
// acquisition, diagnostic probe ledger/seal/closure, optional copy seed.
//
// Scope notes (approved V3 design + timing-and-probe-lifecycle companion):
// - One fixed reviewed Python bridge literal below is the ONLY native metadata
//   implementation. It is shared verbatim by the host reader and by any
//   emitted private helper; no PATH discovery, no alternate interpreter.
// - The observer seam is SYNCHRONOUS with a 1000ms local admissibility cap.
//   It takes no client deadline and returns no Promise.
// - Host reads share the caller's absolute DeadlineV3; no retry, no reset.
// - Probe ledger artifacts are append-only/create-once; a seal closes NEW
//   diagnostic admission only. Missing records never prove no child.
// - Pure metadata only: no argv/env/raw-buffer serialization, no signaling,
//   no business/app/PG/network/native allocation. Targets are self or freshly
//   owned fixture children only.
// ===========================================================================

/** Pinned trusted interpreter from approved-clock-tool-policy.json (owner
 *  approved; exact path/SHA pinned; never discovered through PATH). */
export const CLOCK_PINNED_PYTHON_V3 = {
  executable: '/opt/homebrew/Cellar/python@3.14/3.14.6/Frameworks/Python.framework/Versions/3.14/bin/python3.14',
  sha256: 'b502cb4c5b46b8d4192ec6bcb600ce8922f1afc396fcf646e8765c6eba74a0bf',
  version: '3.14.6',
} as const

/** The one fixed reviewed bridge literal (Darwin selected ABI), repaired in
 *  stage B repair step 1:
 *  - request/reply wire `rrm-clock-bridge-request-br-v2` /
 *    `rrm-clock-bridge-reply-br-v2`: exactly one compact sorted-key JSON reply
 *    object + LF; fixed error tokens with fixed details, never raw echo.
 *  - readOne = unique(17,56B) -> short(13,64B) -> unique(17,56B) with errno
 *    exchange enabled (CDLL use_errno=True) and fixed FFI signatures.
 *  - A1: bounded sysctlbyname reads (kern.osrelease, kern.osversion,
 *    kern.bootsessionuuid) plus the interpreter version are checked against
 *    the supported tuple BEFORE any process metadata is admitted.
 *  - single mode = readOne(pid).
 *  - lineage mode (one invocation, expected owned root required):
 *    root-before, leaf-to-owned-root collection one, leaf-to-owned-root
 *    collection two, root-after. The walk stops AT the owned root; its parent
 *    is never queried. Cycle/32-node limits are checked BEFORE another read;
 *    every edge needs pid/PPID and parent unique-ID agreement.
 *  - observer mode additionally writes the durable create-once helper
 *    registration BEFORE emitting metadata (paths arrive in the request JSON,
 *    never in the environment). */
export const CLOCK_NATIVE_BRIDGE_PYTHON_SOURCE = String.raw`import ctypes, hashlib, json, os, struct, sys, uuid

LIBPROC_PATH = "/usr/lib/libproc.dylib"
LIBSYSTEM_PATH = "/usr/lib/libSystem.B.dylib"
PROC_PIDUNIQIDENTIFIERINFO = 17
PROC_PIDT_SHORTBSDINFO = 13
UNIQUE_SIZE = 56
SHORT_SIZE = 64
SZOMB = 5
PROC_FLAG_INEXIT = 4
MAX_LINEAGE_NODES = 32
MAX_LINEAGE_READS = 66
SUPPORTED_KERNEL_RELEASE = "25.6.0"
SUPPORTED_OS_BUILD = "25G83"
SUPPORTED_PYTHON_VERSION = "3.14.6"
REQUEST_SCHEMA = "rrm-clock-bridge-request-br-v2"
REPLY_SCHEMA = "rrm-clock-bridge-reply-br-v2"
BIRTH_FIELDS = ("bootUuid", "pid", "uniqueId", "idVersion", "executableUuid")
WALK_AGREED_FIELDS = ("bootUuid", "pid", "uniqueId", "idVersion", "executableUuid", "ppid", "parentUniqueId", "pgid")

BRIDGE_ERROR_DETAILS = {
    "unavailable": "required native facility is unavailable",
    "denied": "metadata read was denied",
    "exited": "target process exited or is a zombie",
    "changed": "process identity or lineage changed during the read",
    "invalid-abi": "native ABI size or layout mismatch",
    "invalid-response": "request or output was invalid",
    "unsupported-platform": "observed platform tuple is not the supported tuple",
}

class BridgeError(Exception):
    def __init__(self, code):
        Exception.__init__(self, code)
        self.code = code

def emit_reply(obj):
    sys.stdout.write(json.dumps(obj, separators=(",", ":"), sort_keys=True) + "\n")
    sys.stdout.flush()

def emit_error(code):
    detail = BRIDGE_ERROR_DETAILS.get(code, BRIDGE_ERROR_DETAILS["invalid-response"])
    emit_reply({"schema": REPLY_SCHEMA, "ok": False, "failure": {"code": code, "detail": detail}})

def load_libraries():
    try:
        lib = ctypes.CDLL(LIBPROC_PATH, use_errno=True)
        lib_sysctl = ctypes.CDLL(LIBSYSTEM_PATH, use_errno=True)
    except OSError:
        raise BridgeError("unavailable")
    lib.proc_pidinfo.restype = ctypes.c_int
    lib.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int]
    lib_sysctl.sysctlbyname.restype = ctypes.c_int
    lib_sysctl.sysctlbyname.argtypes = [ctypes.c_char_p, ctypes.c_void_p, ctypes.POINTER(ctypes.c_size_t), ctypes.c_void_p, ctypes.c_size_t]
    return lib, lib_sysctl

def sysctl_string(lib_sysctl, key):
    buf = ctypes.create_string_buffer(128)
    size = ctypes.c_size_t(128)
    ctypes.set_errno(0)
    if lib_sysctl.sysctlbyname(key.encode("ascii"), buf, ctypes.byref(size), None, 0) != 0:
        raise BridgeError("unsupported-platform")
    n = size.value
    if n < 1 or n > 128:
        raise BridgeError("unsupported-platform")
    raw = buf.raw[:n]
    if not raw.endswith(b"\x00") or raw[:-1].find(b"\x00") != -1:
        raise BridgeError("unsupported-platform")
    try:
        text = raw[:-1].decode("ascii")
    except UnicodeDecodeError:
        raise BridgeError("unsupported-platform")
    if len(text) == 0:
        raise BridgeError("unsupported-platform")
    return text

def observe_os(lib_sysctl):
    if sys.version_info[:3] != (3, 14, 6):
        raise BridgeError("unsupported-platform")
    release = sysctl_string(lib_sysctl, "kern.osrelease")
    build = sysctl_string(lib_sysctl, "kern.osversion")
    boot_uuid = sysctl_string(lib_sysctl, "kern.bootsessionuuid")
    if release != SUPPORTED_KERNEL_RELEASE or build != SUPPORTED_OS_BUILD:
        raise BridgeError("unsupported-platform")
    try:
        canonical = str(uuid.UUID(boot_uuid))
    except ValueError:
        raise BridgeError("invalid-response")
    return {"kernelRelease": release, "osBuild": build, "bootUuid": canonical, "pythonVersion": SUPPORTED_PYTHON_VERSION}

def proc_pidinfo_exact(lib, pid, flavor, size):
    buf = ctypes.create_string_buffer(size)
    ctypes.set_errno(0)
    ret = lib.proc_pidinfo(ctypes.c_int(pid), ctypes.c_int(flavor), 0, buf, ctypes.c_int(size))
    if ret != size:
        err = ctypes.get_errno()
        if err in (1, 13):
            raise BridgeError("denied")
        if err == 3:
            raise BridgeError("exited")
        raise BridgeError("invalid-abi")
    return buf.raw

def parse_unique(raw):
    executable_uuid = uuid.UUID(bytes=raw[0:16]).hex
    unique_id, parent_unique_id = struct.unpack_from("<QQ", raw, 16)
    id_version, original_parent_version = struct.unpack_from("<ii", raw, 32)
    if unique_id == 0:
        raise BridgeError("invalid-abi")
    if id_version < 0:
        raise BridgeError("invalid-response")
    return {
        "executableUuid": executable_uuid,
        "uniqueId": str(unique_id),
        "parentUniqueId": str(parent_unique_id),
        "idVersion": id_version,
    }

def parse_short(raw, pid):
    short_pid, ppid, pgid, status = struct.unpack_from("<IIII", raw, 0)
    flags = struct.unpack_from("<I", raw, 32)[0]
    if short_pid != pid:
        raise BridgeError("invalid-abi")
    return {"ppid": ppid, "pgid": pgid, "status": status, "flags": flags}

def read_one(lib, boot_uuid, pid):
    unique_one = parse_unique(proc_pidinfo_exact(lib, pid, PROC_PIDUNIQIDENTIFIERINFO, UNIQUE_SIZE))
    short = parse_short(proc_pidinfo_exact(lib, pid, PROC_PIDT_SHORTBSDINFO, SHORT_SIZE), pid)
    unique_two = parse_unique(proc_pidinfo_exact(lib, pid, PROC_PIDUNIQIDENTIFIERINFO, UNIQUE_SIZE))
    for field in ("executableUuid", "uniqueId", "parentUniqueId", "idVersion"):
        if unique_one[field] != unique_two[field]:
            raise BridgeError("changed")
    if short["status"] == SZOMB:
        raise BridgeError("exited")
    if (short["flags"] & PROC_FLAG_INEXIT) != 0:
        raise BridgeError("changed")
    return {
        "bootUuid": boot_uuid,
        "pid": pid,
        "uniqueId": unique_one["uniqueId"],
        "idVersion": unique_one["idVersion"],
        "executableUuid": unique_one["executableUuid"],
        "ppid": short["ppid"],
        "parentUniqueId": unique_one["parentUniqueId"],
        "pgid": short["pgid"],
        "status": short["status"],
        "flags": short["flags"],
    }

def canonical_birth(boot_uuid, pid, unique):
    return {
        "bootUuid": boot_uuid,
        "pid": pid,
        "uniqueId": unique["uniqueId"],
        "idVersion": unique["idVersion"],
        "executableUuid": unique["executableUuid"],
    }

def births_equal(a, b):
    for field in BIRTH_FIELDS:
        if a[field] != b[field]:
            return False
    return True

def validate_birth(birth):
    if not isinstance(birth, dict) or set(birth.keys()) != set(BIRTH_FIELDS):
        raise BridgeError("invalid-response")
    pid = birth["pid"]
    if not isinstance(pid, int) or isinstance(pid, bool) or pid < 1 or pid > 2147483647:
        raise BridgeError("invalid-response")
    id_version = birth["idVersion"]
    if not isinstance(id_version, int) or isinstance(id_version, bool) or id_version < 0:
        raise BridgeError("invalid-response")
    unique_id = birth["uniqueId"]
    if not isinstance(unique_id, str) or not unique_id.isdigit() or len(unique_id) > 20 or int(unique_id) == 0:
        raise BridgeError("invalid-response")
    exe = birth["executableUuid"]
    if not isinstance(exe, str) or len(exe) != 32:
        raise BridgeError("invalid-response")
    if any(c not in "0123456789abcdef" for c in exe):
        raise BridgeError("invalid-response")
    boot = birth["bootUuid"]
    if not isinstance(boot, str) or len(boot) != 36:
        raise BridgeError("invalid-response")
    try:
        if str(uuid.UUID(boot)) != boot:
            raise BridgeError("invalid-response")
    except ValueError:
        raise BridgeError("invalid-response")
    return birth

def validate_ref(ref):
    if not isinstance(ref, dict):
        raise BridgeError("invalid-response")
    path = ref.get("path")
    if not isinstance(path, str) or len(path) == 0 or len(path.encode("utf-8")) > 4096 or "\x00" in path:
        raise BridgeError("invalid-response")
    sha = ref.get("sha256")
    if not isinstance(sha, str) or len(sha) != 64:
        raise BridgeError("invalid-response")
    if any(c not in "0123456789abcdef" for c in sha):
        raise BridgeError("invalid-response")
    size = ref.get("bytes")
    if not isinstance(size, int) or isinstance(size, bool) or size <= 0:
        raise BridgeError("invalid-response")
    return ref

def validate_request_pid(value):
    if not isinstance(value, int) or isinstance(value, bool) or value < 1 or value > 2147483647:
        raise BridgeError("invalid-response")
    return value

def parse_requested_pid(text):
    if not text.isdigit():
        raise BridgeError("invalid-response")
    value = int(text)
    if value < 1 or value > 2147483647:
        raise BridgeError("invalid-response")
    return value

def edges_linked(nodes):
    for i in range(1, len(nodes)):
        child = nodes[i - 1]
        parent = nodes[i]
        if child["ppid"] != parent["pid"] or child["parentUniqueId"] != parent["uniqueId"]:
            return False
    return True

def walks_agree(one, two):
    if len(one) != len(two):
        return False
    for a, b in zip(one, two):
        for field in WALK_AGREED_FIELDS:
            if a[field] != b[field]:
                return False
    return True

def walk_to_owned_root(lib, boot_uuid, leaf_pid, root_pid, reads_counter):
    nodes = []
    visited = set()
    current = leaf_pid
    while True:
        if len(nodes) >= MAX_LINEAGE_NODES:
            raise BridgeError("changed")
        if current in visited:
            raise BridgeError("changed")
        visited.add(current)
        reads_counter["n"] += 1
        if reads_counter["n"] > MAX_LINEAGE_READS:
            raise BridgeError("changed")
        node = read_one(lib, boot_uuid, current)
        nodes.append(node)
        if node["pid"] == root_pid:
            return nodes
        if node["ppid"] == 0:
            raise BridgeError("changed")
        current = node["ppid"]

def do_lineage(lib, boot_uuid, request, root_pid):
    expected = validate_birth(request.get("expectedRoot"))
    if expected["pid"] != root_pid:
        raise BridgeError("invalid-response")
    reads_counter = {"n": 1}
    root_before = read_one(lib, boot_uuid, root_pid)
    if not births_equal(root_before, expected):
        raise BridgeError("changed")
    walk_one = walk_to_owned_root(lib, boot_uuid, request["pid"], root_pid, reads_counter)
    walk_two = walk_to_owned_root(lib, boot_uuid, request["pid"], root_pid, reads_counter)
    reads_counter["n"] += 1
    if reads_counter["n"] > MAX_LINEAGE_READS:
        raise BridgeError("changed")
    root_after = read_one(lib, boot_uuid, root_pid)
    if not births_equal(root_after, expected) or root_after["pgid"] != root_before["pgid"]:
        raise BridgeError("changed")
    if not edges_linked(walk_one) or not edges_linked(walk_two):
        raise BridgeError("changed")
    if not walks_agree(walk_one, walk_two):
        raise BridgeError("changed")
    terminal = walk_one[-1]
    for field in ("bootUuid", "pid", "uniqueId", "idVersion", "executableUuid", "pgid"):
        if terminal[field] != root_before[field]:
            raise BridgeError("changed")
    return {"rootBefore": root_before, "walkOne": walk_one, "walkTwo": walk_two, "rootAfter": root_after}

def write_registration(lib, boot_uuid, owner_pid, registration_path, lease_ref):
    helper_pid = os.getpid()
    helper_short = parse_short(proc_pidinfo_exact(lib, helper_pid, PROC_PIDT_SHORTBSDINFO, SHORT_SIZE), helper_pid)
    if helper_short["ppid"] != owner_pid:
        raise BridgeError("changed")
    helper_unique = parse_unique(proc_pidinfo_exact(lib, helper_pid, PROC_PIDUNIQIDENTIFIERINFO, UNIQUE_SIZE))
    owner_unique = parse_unique(proc_pidinfo_exact(lib, owner_pid, PROC_PIDUNIQIDENTIFIERINFO, UNIQUE_SIZE))
    record = {
        "schema": "rrm-clock-probe-registration-v3",
        "leaseRef": lease_ref,
        "helperBirth": canonical_birth(boot_uuid, helper_pid, helper_unique),
        "ownerBirth": canonical_birth(boot_uuid, owner_pid, owner_unique),
        "pgid": os.getpgrp(),
        "sessionId": os.getsid(0),
    }
    payload = json.dumps(record, separators=(",", ":"), sort_keys=True).encode("utf-8")
    fd = os.open(registration_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        os.write(fd, payload)
        os.fsync(fd)
    finally:
        os.close(fd)
    return {"path": registration_path, "sha256": hashlib.sha256(payload).hexdigest(), "bytes": len(payload)}


def unique_json_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise BridgeError("invalid-response")
        result[key] = value
    return result

def main():
    argv = sys.argv[1:]
    if len(argv) < 3 or len(argv) > 4:
        raise BridgeError("invalid-response")
    mode = argv[0]
    try:
        request_text = os.fsencode(argv[-1]).decode("utf-8", "strict")
        request = json.loads(request_text, object_pairs_hook=unique_json_object)
    except Exception:
        raise BridgeError("invalid-response")
    if not isinstance(request, dict):
        raise BridgeError("invalid-response")
    if mode == "single":
        if len(argv) != 3 or set(request.keys()) != {"schema", "mode", "pid"}:
            raise BridgeError("invalid-response")
        if request.get("schema") != REQUEST_SCHEMA or request.get("mode") != "single":
            raise BridgeError("invalid-response")
        pid = validate_request_pid(request.get("pid"))
        if parse_requested_pid(argv[1]) != pid:
            raise BridgeError("invalid-response")
    elif mode == "lineage":
        if len(argv) != 4 or set(request.keys()) != {"schema", "mode", "pid", "expectedRoot"}:
            raise BridgeError("invalid-response")
        if request.get("schema") != REQUEST_SCHEMA or request.get("mode") != "lineage":
            raise BridgeError("invalid-response")
        pid = validate_request_pid(request.get("pid"))
        if parse_requested_pid(argv[1]) != pid:
            raise BridgeError("invalid-response")
        root_pid = parse_requested_pid(argv[2])
    elif mode == "observer":
        if len(argv) != 4 or set(request.keys()) != {"schema", "mode", "pid", "appDir", "rootScopePath", "registrationPath", "leaseRef"}:
            raise BridgeError("invalid-response")
        if request.get("schema") != REQUEST_SCHEMA or request.get("mode") != "observer":
            raise BridgeError("invalid-response")
        pid = validate_request_pid(request.get("pid"))
        if parse_requested_pid(argv[1]) != pid:
            raise BridgeError("invalid-response")
        app_dir = argv[2]
        if request.get("appDir") != app_dir or not isinstance(app_dir, str) or len(app_dir) == 0:
            raise BridgeError("invalid-response")
        validate_ref(request.get("leaseRef"))
        registration_path = request.get("registrationPath")
        if not isinstance(registration_path, str) or len(registration_path) == 0 or len(registration_path.encode("utf-8")) > 4096 or "\x00" in registration_path:
            raise BridgeError("invalid-response")
    else:
        raise BridgeError("invalid-response")
    lib, lib_sysctl = load_libraries()
    os_observation = observe_os(lib_sysctl)
    if mode == "single":
        read = read_one(lib, os_observation["bootUuid"], pid)
        emit_reply({"schema": REPLY_SCHEMA, "ok": True, "mode": "single", "requestedPid": pid, "os": os_observation, "read": read})
    elif mode == "lineage":
        observation = do_lineage(lib, os_observation["bootUuid"], request, root_pid)
        emit_reply({"schema": REPLY_SCHEMA, "ok": True, "mode": "lineage", "requestedPid": pid, "expectedRoot": request["expectedRoot"], "os": os_observation, "observation": observation})
    else:
        registration_ref = write_registration(lib, os_observation["bootUuid"], pid, registration_path, request["leaseRef"])
        read = read_one(lib, os_observation["bootUuid"], pid)
        emit_reply({"schema": REPLY_SCHEMA, "ok": True, "mode": "observer", "requestedPid": pid, "os": os_observation, "read": read, "registrationRef": registration_ref})

if __name__ == "__main__":
    try:
        main()
    except BridgeError as error:
        emit_error(error.code)
    except Exception:
        emit_error("invalid-response")
`

export const CLOCK_BRIDGE_MAX_LINEAGE_NODES_V3 = 32
export const CLOCK_BRIDGE_MAX_LINEAGE_READS_V3 = 66
export const CLOCK_BRIDGE_MAX_BUFFER_BYTES_V3 = 65536
export const CLOCK_OBSERVER_LOCAL_BUDGET_MS_V3 = 1000

/** Fixed supported platform tuple (A1): the bridge observes exactly these
 *  release/build/python values before admitting any native metadata. Exact
 *  byte equality with the approved offline tool policy; never a runtime
 *  attestation. */
export const CLOCK_SUPPORTED_PLATFORM_TUPLE_V3 = {
  kernelRelease: '25.6.0',
  osBuild: '25G83',
  pythonVersion: '3.14.6',
} as const

/** Fixed bounded diagnostic bound: failure details are constant strings per
 *  known token, always below this bound, never raw stdout/stderr/exception
 *  rendering (N2). */
export const CLOCK_BRIDGE_DIAGNOSTIC_BOUND_CHARS_V3 = 256

/** One bridge node read: selected identity/lineage whitelist plus the
 *  membership pgid. Never raw buffers/argv/env. */
export interface ClockBridgeNodeReadV3 extends NativeProcessReadV3 { pgid: number }

/** A1 OS build observation carried in every bridge reply. */
export interface ClockOsBuildObservationBRepairV3 {
  kernelRelease: '25.6.0'
  osBuild: '25G83'
  bootUuid: string
  pythonVersion: '3.14.6'
}

/** Mandatory dual-lineage observation: root-before, two independent
 *  leaf-to-owned-root collections and root-after (F2). */
export interface ClockDualLineageObservationBRepairV3 {
  rootBefore: ClockBridgeNodeReadV3
  walkOne: readonly ClockBridgeNodeReadV3[]
  walkTwo: readonly ClockBridgeNodeReadV3[]
  rootAfter: ClockBridgeNodeReadV3
}

/** Step-1 bridge request wire. Host binding/lease artifact refs arrive with
 *  the step-2 host session; observer context completion is step 4. */
export type ClockBridgeRequestBRepairV3 =
  | { schema: 'rrm-clock-bridge-request-br-v2'; mode: 'single'; pid: number }
  | { schema: 'rrm-clock-bridge-request-br-v2'; mode: 'lineage'; pid: number; expectedRoot: NativeBirthV3 }
  | { schema: 'rrm-clock-bridge-request-br-v2'; mode: 'observer'; pid: number; appDir: string; rootScopePath: string; registrationPath: string; leaseRef: ArtifactRef }

export type ClockBridgeReplyParseV3 =
  | { ok: true; mode: 'single'; requestedPid: number; os: ClockOsBuildObservationBRepairV3; read: ClockBridgeNodeReadV3 }
  | { ok: true; mode: 'lineage'; requestedPid: number; expectedRoot: NativeBirthV3; os: ClockOsBuildObservationBRepairV3; observation: ClockDualLineageObservationBRepairV3 }
  | { ok: true; mode: 'observer'; requestedPid: number; os: ClockOsBuildObservationBRepairV3; read: ClockBridgeNodeReadV3; registrationRef: ArtifactRef }
  | { ok: false; failure: { code: ClockNativeReadFailureCodeV3; detail: string } }

/** Refined host read result: single carries the read; lineage carries the
 *  MANDATORY dual observation. `reads` is explicitly observation.walkOne
 *  (structural compatibility only): no consumer may treat the flat array as
 *  evidence that dual collection occurred. */
export type ClockNativeReadResultBRepairV3 =
  | { ok: true; kind: 'single'; read: ClockBridgeNodeReadV3; os: ClockOsBuildObservationBRepairV3 }
  | { ok: true; kind: 'lineage'; reads: readonly ClockBridgeNodeReadV3[]; observation: ClockDualLineageObservationBRepairV3; os: ClockOsBuildObservationBRepairV3 }
  | { ok: false; failure: { code: ClockNativeReadFailureCodeV3; detail: string } }

/** Structural spawnSync seam (tests inject; production uses node:child_process). */
export interface ClockSpawnSyncResultV3 {
  status: number | null
  signal: string | null
  error?: { code?: string; message?: string }
  stdout: string | Uint8Array
  stderr: string | Uint8Array
  pid?: number
}
export type ClockSpawnSyncFnV3 =
  (file: string, args: readonly string[], options: {
    timeout: number; killSignal: 'SIGKILL'; maxBuffer: number; shell: false
    encoding: 'buffer'; env: Record<string, string>
  }) => ClockSpawnSyncResultV3

/** Typed bridge failure: fixed code union + bounded detail; never a raw dump. */
export class ClockBridgeFailureV3 extends Error {
  constructor(readonly failure: { code: ClockNativeReadFailureCodeV3; detail: string }) {
    super(`clock bridge failure ${failure.code}: ${failure.detail}`)
    this.name = 'ClockBridgeFailureV3'
  }
}

/** Observer-local admission failure: thrown synchronously BEFORE the original
 *  invocation is admitted; zero business calls have happened at that point. */
export class ClockObserverAcquisitionErrorV3 extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClockObserverAcquisitionErrorV3'
  }
}

const CLOCK_BRIDGE_NODE_KEYS = 'bootUuid|executableUuid|flags|idVersion|parentUniqueId|pgid|pid|ppid|status|uniqueId'
const CLOCK_UUID_CANONICAL_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const CLOCK_UINT64_DECIMAL_CANONICAL_PATTERN = /^(0|[1-9][0-9]*)$/
const CLOCK_EXECUTABLE_UUID_PATTERN = /^[0-9a-f]{32}$/
const CLOCK_UINT64_MAX_BIGINT = (BigInt(1) << BigInt(64)) - BigInt(1)

function clockBridgeIsCanonicalUuid(value: unknown): value is string {
  return typeof value === 'string' && value.length === 36 && CLOCK_UUID_CANONICAL_PATTERN.test(value)
}

function clockBridgeIsUint64Decimal(value: unknown, allowZero: boolean): value is string {
  if (typeof value !== 'string' || value.length > 20 || !CLOCK_UINT64_DECIMAL_CANONICAL_PATTERN.test(value)) return false
  if (!allowZero && value === '0') return false
  return BigInt(value) <= CLOCK_UINT64_MAX_BIGINT
}

function clockBridgeIsInt32(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
}

/** Strict validator for one bridge node object. Enforces the fixed whitelist
 *  key set, canonical bounded forms, requested-pid match, negative-idVersion
 *  rejection (CR1: before any admissible birth), and zombie/in-exit
 *  rejections. birth uniqueId must be nonzero; the root edge parentUniqueId
 *  may be kernel "0". requestedPid binds the read to one requested process;
 *  lineage continuation nodes pass the sentinel 0 because their binding is
 *  enforced by the exact parent-edge equality instead. */
function clockBridgeValidateNodeObjectV3(node: Record<string, unknown>, requestedPid: number): ClockBridgeNodeReadV3 {
  const actualKeys = Object.keys(node).sort().join('|')
  if (actualKeys !== CLOCK_BRIDGE_NODE_KEYS) {
    throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'bridge line key set is not the fixed whitelist' })
  }
  if (!clockBridgeIsCanonicalUuid(node.bootUuid)) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'bootUuid is not a canonical UUID' })
  if (!clockBridgeIsInt32(node.pid, 1, 2147483647) || (requestedPid !== 0 && node.pid !== requestedPid)) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'pid does not match the requested process' })
  if (!clockBridgeIsUint64Decimal(node.uniqueId, false)) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'uniqueId is not a canonical nonzero uint64 decimal' })
  if (!clockBridgeIsInt32(node.idVersion, 0, 2147483647)) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'idVersion is outside the admissible nonnegative int32 domain' })
  if (typeof node.executableUuid !== 'string' || !CLOCK_EXECUTABLE_UUID_PATTERN.test(node.executableUuid)) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'executableUuid is not 32 hex chars' })
  if (!clockBridgeIsInt32(node.ppid, 0, 2147483647)) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'ppid is not a nonnegative int32' })
  if (!clockBridgeIsUint64Decimal(node.parentUniqueId, true)) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'parentUniqueId is not a canonical uint64 decimal' })
  if (!clockBridgeIsInt32(node.pgid, 0, 2147483647)) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'pgid is not a nonnegative int32' })
  if (!clockBridgeIsInt32(node.status, 0, 2147483647)) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'status is not a nonnegative int32' })
  if (!clockBridgeIsInt32(node.flags, 0, 4294967295)) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'flags is not a uint32' })
  if (node.status === 5) throw new ClockBridgeFailureV3({ code: 'exited', detail: 'process status is SZOMB' })
  if ((node.flags & 4) !== 0) throw new ClockBridgeFailureV3({ code: 'changed', detail: 'process has PROC_FLAG_INEXIT' })
  return node as unknown as ClockBridgeNodeReadV3
}

/** Strict parser/validator for one bridge node output line. */
export function parseClockBridgeNodeReadV3(text: string, requestedPid: number): ClockBridgeNodeReadV3 {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'bridge line is not JSON' })
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'bridge line is not an object' })
  }
  return clockBridgeValidateNodeObjectV3(parsed as Record<string, unknown>, requestedPid)
}

// JSON.parse alone discards duplicate keys. Scan the valid JSON grammar first,
// comparing decoded property names at every object depth (including escapes).
function clockBridgeParseUniqueJsonV3(line: string): unknown {
  if (Buffer.from(line, 'utf8').toString('utf8') !== line) throw new Error('invalid Unicode')
  const parsed: unknown = JSON.parse(line)
  let at = 0
  const whitespace = () => { while (/\s/.test(line[at] ?? '') && at < line.length) at++ }
  const stringToken = () => {
    const start = at++
    while (at < line.length) {
      const char = line[at++]
      if (char === '\\') at++
      else if (char === '"') return JSON.parse(line.slice(start, at)) as string
    }
    throw new Error('invalid string')
  }
  const value = (): void => {
    whitespace()
    if (line[at] === '{') {
      at++; whitespace()
      const keys = new Set<string>()
      if (line[at] !== '}') {
        while (true) {
          whitespace()
          const key = stringToken()
          if (keys.has(key)) throw new Error('duplicate key')
          keys.add(key)
          whitespace(); at++ // colon; syntax already checked by JSON.parse
          value(); whitespace()
          if (line[at] !== ',') break
          at++
        }
      }
      at++
    } else if (line[at] === '[') {
      at++; whitespace()
      if (line[at] !== ']') {
        while (true) {
          value(); whitespace()
          if (line[at] !== ',') break
          at++
        }
      }
      at++
    } else if (line[at] === '"') {
      stringToken()
    } else {
      while (at < line.length && !/[\s,\]}]/.test(line[at])) at++
    }
  }
  value()
  return parsed
}

function clockBridgeParseJsonLineV3(line: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = clockBridgeParseUniqueJsonV3(line)
  } catch {
    throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'bridge reply is not JSON' })
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'bridge reply is not an object' })
  }
  return parsed as Record<string, unknown>
}

function clockBridgeExpectedKeysV3(keys: readonly string[]): string {
  return [...keys].sort().join('|')
}

const CLOCK_REPLY_SINGLE_KEYS = clockBridgeExpectedKeysV3(['schema', 'ok', 'mode', 'requestedPid', 'os', 'read'])
const CLOCK_REPLY_LINEAGE_KEYS = clockBridgeExpectedKeysV3(['schema', 'ok', 'mode', 'requestedPid', 'expectedRoot', 'os', 'observation'])
const CLOCK_REPLY_OBSERVER_KEYS = clockBridgeExpectedKeysV3(['schema', 'ok', 'mode', 'requestedPid', 'os', 'read', 'registrationRef'])
const CLOCK_REPLY_FAILURE_KEYS = clockBridgeExpectedKeysV3(['schema', 'ok', 'failure'])
const CLOCK_OS_KEYS = clockBridgeExpectedKeysV3(['kernelRelease', 'osBuild', 'bootUuid', 'pythonVersion'])
const CLOCK_BIRTH_KEYS = clockBridgeExpectedKeysV3(['bootUuid', 'pid', 'uniqueId', 'idVersion', 'executableUuid'])

function clockBridgeValidateOsV3(os: unknown): ClockOsBuildObservationBRepairV3 {
  if (typeof os !== 'object' || os === null) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'bridge reply os observation is missing' })
  const record = os as Record<string, unknown>
  if (Object.keys(record).sort().join('|') !== CLOCK_OS_KEYS) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'bridge reply os observation key set is not the fixed whitelist' })
  if (record.kernelRelease !== CLOCK_SUPPORTED_PLATFORM_TUPLE_V3.kernelRelease
    || record.osBuild !== CLOCK_SUPPORTED_PLATFORM_TUPLE_V3.osBuild
    || record.pythonVersion !== CLOCK_SUPPORTED_PLATFORM_TUPLE_V3.pythonVersion) {
    throw new ClockBridgeFailureV3({ code: 'unsupported-platform', detail: 'bridge os observation is not the supported fixed tuple' })
  }
  if (!clockBridgeIsCanonicalUuid(record.bootUuid)) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'bridge os bootUuid is not a canonical UUID' })
  return record as unknown as ClockOsBuildObservationBRepairV3
}

function clockBridgeValidateBirthObjectV3(birth: unknown, label: string): NativeBirthV3 {
  if (typeof birth !== 'object' || birth === null) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: `${label} is not an object` })
  const record = birth as Record<string, unknown>
  if (Object.keys(record).sort().join('|') !== CLOCK_BIRTH_KEYS) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: `${label} key set is not the fixed birth whitelist` })
  if (!clockBridgeIsCanonicalUuid(record.bootUuid)) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: `${label} bootUuid is not a canonical UUID` })
  if (!clockBridgeIsInt32(record.pid, 1, 2147483647)) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: `${label} pid is not a positive int32` })
  if (!clockBridgeIsUint64Decimal(record.uniqueId, false)) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: `${label} uniqueId is not a canonical nonzero uint64 decimal` })
  if (!clockBridgeIsInt32(record.idVersion, 0, 2147483647)) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: `${label} idVersion is outside the admissible nonnegative int32 domain` })
  if (typeof record.executableUuid !== 'string' || !CLOCK_EXECUTABLE_UUID_PATTERN.test(record.executableUuid)) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: `${label} executableUuid is not 32 hex chars` })
  return record as unknown as NativeBirthV3
}

function clockBridgeBirthsEqualV3(a: NativeBirthV3, b: NativeBirthV3): boolean {
  return a.bootUuid === b.bootUuid && a.pid === b.pid && a.uniqueId === b.uniqueId
    && a.idVersion === b.idVersion && a.executableUuid === b.executableUuid
}

const CLOCK_BRIDGE_FAILURE_MAP_V3: Readonly<Record<string, { code: ClockNativeReadFailureCodeV3; detail: string }>> = {
  'unavailable': { code: 'unavailable', detail: 'bridge reported a required native facility is unavailable' },
  'denied': { code: 'denied', detail: 'bridge reported metadata denial' },
  'exited': { code: 'exited', detail: 'bridge reported the target exited or became a zombie' },
  'changed': { code: 'changed', detail: 'bridge reported process identity or lineage change' },
  'invalid-abi': { code: 'invalid-abi', detail: 'bridge reported an ABI size mismatch' },
  'invalid-response': { code: 'invalid-response', detail: 'bridge reported an invalid request or output' },
  'unsupported-platform': { code: 'unsupported-platform', detail: 'bridge rejected the observed platform tuple' },
}

function clockBridgeValidateArtifactRefV3(ref: unknown, label: string): ArtifactRef {
  if (typeof ref !== 'object' || ref === null) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: `${label} is not an object` })
  const record = ref as Record<string, unknown>
  if (typeof record.path !== 'string' || record.path.length === 0 || Buffer.byteLength(record.path, 'utf8') > 4096) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: `${label} path is not a bounded nonempty string` })
  if (typeof record.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(record.sha256)) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: `${label} sha256 is not 64 lowercase hex chars` })
  if (!clockBridgeIsInt32(record.bytes, 1, Number.MAX_SAFE_INTEGER) && !(typeof record.bytes === 'number' && Number.isSafeInteger(record.bytes) && record.bytes > 0)) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: `${label} bytes is not a positive safe integer` })
  return record as unknown as ArtifactRef
}

/** Strict reply validator. The bridge returns exactly one JSON object; any
 *  failure reply maps through the fixed token table with a FIXED detail —
 *  bridge-provided detail text is shape-checked but never surfaced (N2). */
export function parseClockBridgeReplyV3(
  line: string,
  expectedMode: 'single' | 'lineage' | 'observer',
  requestedPid: number,
  expectedRoot?: NativeBirthV3,
): ClockBridgeReplyParseV3 {
  const reply = clockBridgeParseJsonLineV3(line)
  if (reply.schema !== 'rrm-clock-bridge-reply-br-v2') throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'bridge reply schema is not the fixed reply schema' })
  if (reply.ok === false) {
    if (Object.keys(reply).sort().join('|') !== CLOCK_REPLY_FAILURE_KEYS) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'bridge failure reply key set is not the fixed whitelist' })
    const failure = reply.failure
    if (typeof failure !== 'object' || failure === null) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'bridge failure payload is not an object' })
    const failureRecord = failure as Record<string, unknown>
    if (Object.keys(failureRecord).sort().join('|') !== clockBridgeExpectedKeysV3(['code', 'detail'])) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'bridge failure key set is not the fixed whitelist' })
    if (typeof failureRecord.detail !== 'string' || failureRecord.detail.length > CLOCK_BRIDGE_DIAGNOSTIC_BOUND_CHARS_V3) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'bridge failure detail is not a bounded string' })
    const token = typeof failureRecord.code === 'string' ? failureRecord.code : ''
    if (!Object.prototype.hasOwnProperty.call(CLOCK_BRIDGE_FAILURE_MAP_V3, token)) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'bridge reported an unknown failure token' })
    const mapped = CLOCK_BRIDGE_FAILURE_MAP_V3[token]
    return { ok: false, failure: { code: mapped.code, detail: mapped.detail } }
  }
  if (reply.ok !== true) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'bridge reply ok flag is not a boolean' })
  if (reply.mode !== expectedMode) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'bridge reply mode does not match the requested mode' })
  if (reply.requestedPid !== requestedPid) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'bridge reply requestedPid does not match the requested pid' })
  const os = clockBridgeValidateOsV3(reply.os)
  if (expectedMode === 'single') {
    if (Object.keys(reply).sort().join('|') !== CLOCK_REPLY_SINGLE_KEYS) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'single reply key set is not the fixed whitelist' })
    if (typeof reply.read !== 'object' || reply.read === null) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'single reply read is not an object' })
    const read = clockBridgeValidateNodeObjectV3(reply.read as Record<string, unknown>, requestedPid)
    clockBridgeRequireBootV3(read.bootUuid, os.bootUuid)
    return { ok: true, mode: 'single', requestedPid, os, read }
  }
  if (expectedMode === 'observer') {
    if (Object.keys(reply).sort().join('|') !== CLOCK_REPLY_OBSERVER_KEYS) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'observer reply key set is not the fixed whitelist' })
    if (typeof reply.read !== 'object' || reply.read === null) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'observer reply read is not an object' })
    const read = clockBridgeValidateNodeObjectV3(reply.read as Record<string, unknown>, requestedPid)
    clockBridgeRequireBootV3(read.bootUuid, os.bootUuid)
    const registrationRef = clockBridgeValidateArtifactRefV3(reply.registrationRef, 'observer reply registrationRef')
    return { ok: true, mode: 'observer', requestedPid, os, read, registrationRef }
  }
  if (Object.keys(reply).sort().join('|') !== CLOCK_REPLY_LINEAGE_KEYS) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'lineage reply key set is not the fixed whitelist' })
  if (expectedRoot === undefined) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'lineage reply validated without an expected root' })
  clockBridgeRequireBootV3(expectedRoot.bootUuid, os.bootUuid)
  const echoedRoot = clockBridgeValidateBirthObjectV3(reply.expectedRoot, 'lineage reply expectedRoot')
  if (!clockBridgeBirthsEqualV3(echoedRoot, expectedRoot)) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'lineage reply expectedRoot does not match the requested birth' })
  const observationRaw = reply.observation
  if (typeof observationRaw !== 'object' || observationRaw === null) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'lineage reply observation is not an object' })
  const observationRecord = observationRaw as Record<string, unknown>
  if (Object.keys(observationRecord).sort().join('|') !== clockBridgeExpectedKeysV3(['rootBefore', 'walkOne', 'walkTwo', 'rootAfter'])) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'lineage observation key set is not the fixed whitelist' })
  const rootBefore = clockBridgeValidateNodeObjectV3(clockBridgeRequireObjectV3(observationRecord.rootBefore, 'rootBefore'), 0)
  const rootAfter = clockBridgeValidateNodeObjectV3(clockBridgeRequireObjectV3(observationRecord.rootAfter, 'rootAfter'), 0)
  if (!clockBridgeBirthsEqualV3(rootBefore, expectedRoot) || !clockBridgeBirthsEqualV3(rootAfter, expectedRoot)) {
    throw new ClockBridgeFailureV3({ code: 'changed', detail: 'root-before/root-after do not equal the expected owned root birth' })
  }
  const walkOne = clockBridgeValidateWalkV3(observationRecord.walkOne, 'walkOne', requestedPid)
  const walkTwo = clockBridgeValidateWalkV3(observationRecord.walkTwo, 'walkTwo', requestedPid)
  for (const node of [rootBefore, rootAfter, ...walkOne, ...walkTwo]) {
    clockBridgeRequireBootV3(node.bootUuid, os.bootUuid)
    if (node.pgid !== rootBefore.pgid) throw new ClockBridgeFailureV3({ code: 'changed', detail: 'walk pgid does not match the owned root pgid' })
  }
  if (rootAfter.pgid !== rootBefore.pgid) throw new ClockBridgeFailureV3({ code: 'changed', detail: 'root-after pgid does not match root-before pgid' })
  const terminal = walkOne[walkOne.length - 1]
  if (!clockBridgeBirthsEqualV3(terminal, expectedRoot) || terminal.pgid !== rootBefore.pgid) {
    throw new ClockBridgeFailureV3({ code: 'changed', detail: 'the walk terminal is not the expected owned root' })
  }
  if (walkOne.length !== walkTwo.length) throw new ClockBridgeFailureV3({ code: 'changed', detail: 'the two collections disagree in length' })
  for (let i = 0; i < walkOne.length; i++) {
    const a = walkOne[i]
    const b = walkTwo[i]
    for (const field of ['bootUuid', 'pid', 'uniqueId', 'idVersion', 'executableUuid', 'ppid', 'parentUniqueId', 'pgid'] as const) {
      if (a[field] !== b[field]) throw new ClockBridgeFailureV3({ code: 'changed', detail: 'the two collections disagree on immutable fields or ordering' })
    }
  }
  if (walkOne.length + walkTwo.length + 2 > CLOCK_BRIDGE_MAX_LINEAGE_READS_V3) {
    throw new ClockBridgeFailureV3({ code: 'changed', detail: 'lineage observation exceeds the fixed 66-read bound' })
  }
  return { ok: true, mode: 'lineage', requestedPid, expectedRoot, os, observation: { rootBefore, walkOne, walkTwo, rootAfter } }
}

function clockBridgeRequireBootV3(bootUuid: string, observedBootUuid: string): void {
  if (bootUuid !== observedBootUuid) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'bridge node/root bootUuid does not match the observed OS bootUuid' })
}

function clockBridgeRequireObjectV3(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: `lineage observation ${label} is not an object` })
  return value as Record<string, unknown>
}

function clockBridgeValidateWalkV3(walk: unknown, label: string, requestedPid: number): readonly ClockBridgeNodeReadV3[] {
  if (!Array.isArray(walk)) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: `lineage observation ${label} is not an array` })
  if (walk.length < 1 || walk.length > CLOCK_BRIDGE_MAX_LINEAGE_NODES_V3) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: `lineage observation ${label} length is outside the fixed 1..32 bound` })
  const nodes = walk.map((node) => clockBridgeValidateNodeObjectV3(clockBridgeRequireObjectV3(node, label), 0))
  if (nodes[0].pid !== requestedPid) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: `lineage observation ${label} does not start at the requested leaf pid` })
  const seen = new Set<number>()
  for (const node of nodes) {
    if (seen.has(node.pid)) throw new ClockBridgeFailureV3({ code: 'changed', detail: `lineage observation ${label} revisits a pid (cycle)` })
    seen.add(node.pid)
  }
  for (let i = 1; i < nodes.length; i++) {
    const child = nodes[i - 1]
    const parent = nodes[i]
    if (child.ppid !== parent.pid || child.parentUniqueId !== parent.uniqueId) {
      throw new ClockBridgeFailureV3({ code: 'changed', detail: `lineage observation ${label} edge ${i} does not link child to parent by pid and parent unique id` })
    }
  }
  return nodes
}

/** Fixed reviewed argv: pinned absolute interpreter, -I -S -B, the literal,
 *  mode-specific arguments and the request JSON. shell:false always. */
export function buildClockNativeBridgeCommandV3(request: ClockBridgeRequestBRepairV3): { file: string; args: string[] } {
  if (request === null || typeof request !== 'object') throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'bridge request is not an object' })
  if (request.schema !== 'rrm-clock-bridge-request-br-v2') throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'bridge request schema is not the fixed request schema' })
  if (!clockBridgeIsInt32(request.pid, 1, 2147483647)) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'requested pid is not a positive int32' })
  if (request.mode === 'single') {
    return {
      file: CLOCK_PINNED_PYTHON_V3.executable,
      args: ['-I', '-S', '-B', '-c', CLOCK_NATIVE_BRIDGE_PYTHON_SOURCE, 'single', String(request.pid), JSON.stringify(request)],
    }
  }
  if (request.mode === 'lineage') {
    const expectedRoot = clockBridgeValidateBirthObjectV3(request.expectedRoot, 'bridge request expectedRoot')
    return {
      file: CLOCK_PINNED_PYTHON_V3.executable,
      args: ['-I', '-S', '-B', '-c', CLOCK_NATIVE_BRIDGE_PYTHON_SOURCE, 'lineage', String(request.pid), String(expectedRoot.pid), JSON.stringify(request)],
    }
  }
  if (request.mode === 'observer') {
    if (typeof request.appDir !== 'string' || request.appDir.length === 0) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'observer request appDir is not a nonempty string' })
    if (typeof request.rootScopePath !== 'string' || request.rootScopePath.length === 0) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'observer request rootScopePath is not a nonempty string' })
    if (typeof request.registrationPath !== 'string' || request.registrationPath.length === 0) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'observer request registrationPath is not a nonempty string' })
    clockBridgeValidateArtifactRefV3(request.leaseRef, 'observer request leaseRef')
    return {
      file: CLOCK_PINNED_PYTHON_V3.executable,
      args: ['-I', '-S', '-B', '-c', CLOCK_NATIVE_BRIDGE_PYTHON_SOURCE, 'observer', String(request.pid), request.appDir, JSON.stringify(request)],
    }
  }
  throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'bridge request mode is not one of the fixed modes' })
}

function clockBridgeRunV3(
  spawn: ClockSpawnSyncFnV3,
  request: ClockBridgeRequestBRepairV3,
  timeoutMs: number,
): ClockSpawnSyncResultV3 {
  const command = buildClockNativeBridgeCommandV3(request)
  return spawn(command.file, command.args, {
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    maxBuffer: CLOCK_BRIDGE_MAX_BUFFER_BYTES_V3,
    shell: false,
    encoding: 'buffer',
    env: { PATH: '/usr/bin:/bin' },
  })
}

/** Maps one spawn outcome to the single reply line, or throws the fixed typed
 *  failure. Unknown output never enters diagnostic text (N2). */
function clockBridgeMapSpawnOutcomeV3(result: ClockSpawnSyncResultV3, label: string): string {
  if (result.error !== undefined) {
    if (result.error.code === 'ENOENT') throw new ClockBridgeFailureV3({ code: 'unavailable', detail: `pinned interpreter unavailable (${label})` })
    throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: `bridge could not be executed (${label})` })
  }
  if (result.status === null && result.signal !== null) {
    throw new ClockBridgeFailureV3({ code: 'deadline-elapsed', detail: `bridge child was killed before exit (${label})` })
  }
  if (result.status !== 0) {
    throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: `bridge exited abnormally (${label})` })
  }
  if (result.stderr.length > 0) {
    throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: `bridge wrote unexpected stderr (${label})` })
  }
  let stdout: string
  try {
    stdout = typeof result.stdout === 'string' ? result.stdout : new TextDecoder('utf-8', { fatal: true }).decode(result.stdout)
  } catch {
    throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'bridge output is not strict UTF-8' })
  }
  const lines = stdout.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
  if (lines.length !== 1) throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: `bridge must return exactly one reply line (${label})` })
  return lines[0]
}

/** Host-side native metadata primitive (repaired step 1). Single mode is one
 *  fixed U→B→U read. Lineage mode REQUIRES the expected owned root birth and
 *  performs, inside ONE bridge invocation, root-before, two leaf-to-owned-root
 *  collections and root-after; the walk never reads above the owned root.
 *  Shared absolute caller deadline, no retry. */
export async function readNativeClockProcessV3(
  input: ClockNativeReadInputV3,
  deps: { spawnSync?: ClockSpawnSyncFnV3 } = {},
): Promise<ClockNativeReadResultBRepairV3> {
  try {
    const run = deps.spawnSync ?? (spawnSync as unknown as ClockSpawnSyncFnV3)
    if (!clockBridgeIsInt32(input.pid, 1, 2147483647)) {
      throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'input pid is not a positive int32' })
    }
    const remainingMs = input.deadline.expiresMs - input.deadline.now()
    if (!Number.isFinite(remainingMs) || remainingMs < 1) {
      throw new ClockBridgeFailureV3({ code: 'deadline-elapsed', detail: 'shared host deadline already elapsed; no spawn attempted' })
    }
    if (input.mode !== 'single' && input.mode !== 'lineage') {
      throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'mode must be single or lineage' })
    }
    let request: ClockBridgeRequestBRepairV3
    if (input.mode === 'single') {
      request = { schema: 'rrm-clock-bridge-request-br-v2', mode: 'single', pid: input.pid }
    } else {
      if (input.expectedRoot === undefined) {
        throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'lineage mode requires an expected owned root birth' })
      }
      clockBridgeValidateBirthObjectV3(input.expectedRoot, 'lineage input expectedRoot')
      request = { schema: 'rrm-clock-bridge-request-br-v2', mode: 'lineage', pid: input.pid, expectedRoot: input.expectedRoot }
    }
    const result = clockBridgeRunV3(run, request, Math.floor(remainingMs))
    const line = clockBridgeMapSpawnOutcomeV3(result, input.mode)
    const reply = parseClockBridgeReplyV3(line, input.mode, input.pid, input.mode === 'lineage' ? input.expectedRoot : undefined)
    if (!reply.ok) return { ok: false, failure: reply.failure }
    if (reply.mode === 'single') return { ok: true, kind: 'single', read: reply.read, os: reply.os }
    if (reply.mode !== 'lineage') throw new ClockBridgeFailureV3({ code: 'invalid-response', detail: 'bridge reply mode is not one of the fixed modes' })
    if (input.deadline.now() > input.deadline.expiresMs) throw new ClockBridgeFailureV3({ code: 'deadline-elapsed', detail: 'shared host deadline elapsed during lineage processing' })
    return { ok: true, kind: 'lineage', reads: reply.observation.walkOne, observation: reply.observation, os: reply.os }
  } catch (error) {
    if (error instanceof ClockBridgeFailureV3) return { ok: false, failure: error.failure }
    throw error
  }
}
// --- durable probe ledger (append-only / create-once artifacts) -----------

function clockArtifactRefV3(filePath: string, payload: string): ArtifactRef {
  return { path: filePath, sha256: createHash('sha256').update(payload).digest('hex'), bytes: Buffer.byteLength(payload) }
}

function clockWriteJsonExclusiveV3(filePath: string, value: unknown): ArtifactRef {
  const payload = JSON.stringify(value) + '\n'
  const fd = openSync(filePath, 'wx')
  try {
    writeSync(fd, payload)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  return clockArtifactRefV3(filePath, payload)
}

/** Read one probe ledger record and enforce its exact schema tag. */
export function readClockProbeRecordV3<T extends { schema: string }>(filePath: string, schema: string): T {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch (error) {
    throw new ClockObserverAcquisitionErrorV3(`probe record ${schema} unreadable at ${filePath}: ${error instanceof Error ? error.message : String(error)}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new ClockObserverAcquisitionErrorV3(`probe record ${schema} at ${filePath} is not JSON`)
  }
  if (typeof parsed !== 'object' || parsed === null || (parsed as { schema?: unknown }).schema !== schema) {
    throw new ClockObserverAcquisitionErrorV3(`probe record at ${filePath} does not carry schema ${schema}`)
  }
  return parsed as T
}

/** Only definitive ENOENT of the seal means unsealed; any other IO/parse
 *  failure fails admission. existsSync must not mask errors as absence. */
export function ensureClockProbeUnsealedV3(probeRoot: string, scopeId: string): void {
  const sealPath = path.join(probeRoot, `${scopeId}-probe-seal.json`)
  let fd: number
  try {
    fd = openSync(sealPath, 'r')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return
    throw new ClockObserverAcquisitionErrorV3(`probe seal state unreadable (${String(code)}); failing admission`)
  }
  try {
    const raw = readFileSync(fd, 'utf8')
    const parsed = JSON.parse(raw) as { schema?: unknown }
    if (parsed.schema !== 'rrm-clock-probe-seal-v3') {
      throw new ClockObserverAcquisitionErrorV3('probe seal file has an unexpected schema')
    }
  } finally {
    closeSync(fd)
  }
  throw new ClockObserverAcquisitionErrorV3('probe seal already present; new diagnostic probe admission is closed')
}

export interface ClockProbeLeaseInputV3 {
  probeRoot: string
  scopeId: string
  clockInstanceId: string
  ownerPidHint: number
  role: 'matrix-context-capture' | 'observer'
  rootScopeRef: ArtifactRef
  localBudgetMs: number
  mode: 'observer-self' | 'host-driver'
  context: string
  nowNs?: () => bigint
}

/** Durable lease-before-fork. wx create + fsync; a PID hint is NOT a birth
 *  proof or kill authorization. */
export function createClockProbeLeaseV3(input: ClockProbeLeaseInputV3): { lease: ClockProbeLeaseV3; ref: ArtifactRef } {
  const probeId = randomUUID()
  const lease: ClockProbeLeaseV3 = {
    schema: 'rrm-clock-probe-lease-v3',
    scopeId: input.scopeId,
    probeId,
    clockInstanceId: input.clockInstanceId,
    ownerPidHint: input.ownerPidHint,
    role: input.role,
    rootScopeRef: input.rootScopeRef,
    localPolicy: { localBudgetMs: input.localBudgetMs },
    mode: input.mode,
    context: input.context,
    createdAtNs: (input.nowNs ?? (() => process.hrtime.bigint()))().toString(),
  }
  const ref = clockWriteJsonExclusiveV3(path.join(input.probeRoot, `${input.scopeId}-lease-${probeId}.json`), lease)
  return { lease, ref }
}

export interface ClockProbeCompletionInputV3 {
  probeRoot: string
  scopeId: string
  probeId: string
  leaseRef: ArtifactRef
  registrationRef: ArtifactRef | null
  spawnPid: number | null
  status: number | null
  signal: string | null
  outcome: 'returned' | 'timeout' | 'error' | 'not-spawned'
  elapsedNs: string
  sourceAssociation: string
}

/** Written by the owner only after synchronous child return/reap or an
 *  explicit actual pre-fork failure. Timeout/error completions are cleanup
 *  information, never successful metadata. */
export function writeClockProbeCompletionV3(input: ClockProbeCompletionInputV3): { completion: ClockProbeCompletionV3; ref: ArtifactRef } {
  const completion: ClockProbeCompletionV3 = {
    schema: 'rrm-clock-probe-completion-v3',
    leaseRef: input.leaseRef,
    registrationRef: input.registrationRef,
    spawnPid: input.spawnPid,
    status: input.status,
    signal: input.signal,
    outcome: input.outcome,
    elapsedNs: input.elapsedNs,
    sourceAssociation: input.sourceAssociation,
  }
  const ref = clockWriteJsonExclusiveV3(path.join(input.probeRoot, `${input.scopeId}-completion-${input.probeId}.json`), completion)
  return { completion, ref }
}

/** Immutable runtime diagnostic-stop artifact: closes NEW diagnostic probe
 *  admission only. Not a business cancellation and not a clock deadline. */
export function sealClockProbesV3(probeRoot: string, scopeId: string, reason: string, nowNs?: () => bigint): { seal: { schema: 'rrm-clock-probe-seal-v3'; scopeId: string; sealedAtNs: string; reason: string }; ref: ArtifactRef } {
  const seal = {
    schema: 'rrm-clock-probe-seal-v3' as const,
    scopeId,
    sealedAtNs: (nowNs ?? (() => process.hrtime.bigint()))().toString(),
    reason,
  }
  const ref = clockWriteJsonExclusiveV3(path.join(probeRoot, `${scopeId}-probe-seal.json`), seal)
  return { seal, ref }
}

export function writeClockNativeAppGroupStopFactV3(probeRoot: string, fields: {
  rootBirth: NativeBirthV3
  groupEmpty: boolean
  stopInvocationRef: ArtifactRef
}): { fact: NativeAppGroupStopFactV3; ref: ArtifactRef } {
  const fact: NativeAppGroupStopFactV3 = {
    schema: 'rrm-clock-native-app-group-stop-fact-v3',
    rootBirth: fields.rootBirth,
    groupEmpty: fields.groupEmpty,
    stopInvocationRef: fields.stopInvocationRef,
  }
  const ref = clockWriteJsonExclusiveV3(path.join(probeRoot, `${fields.rootBirth.pid}-app-group-stop-fact.json`), fact)
  return { fact, ref }
}

/** Closure decision. Missing registration AND missing actual completion stays
 *  UNRESOLVED even when the app group is empty: a PID hint and group absence
 *  never prove no child. Quarantine blocks the owned-stop gate. */
export function decideClockProbeClosureV3(input: {
  registration: ClockProbeRegistrationV3 | null
  completion: ClockProbeCompletionV3 | null
  stopFact: NativeAppGroupStopFactV3 | null
}): { closed: false; reason: string } | { closed: true; closure: ClockProbeCleanupClosureV3['closure'] } {
  if (input.completion?.outcome === 'returned') return { closed: true, closure: 'closed-by-tracked-exit' }
  if (input.registration !== null && input.stopFact !== null && input.stopFact.groupEmpty) {
    return { closed: true, closure: 'closed-by-owned-group-stop' }
  }
  if (input.completion !== null && (input.completion.outcome === 'timeout' || input.completion.outcome === 'error')) {
    return { closed: true, closure: 'quarantined' }
  }
  if (input.registration === null && input.completion === null) {
    return { closed: false, reason: 'missing registration and missing actual completion remain unresolved; group absence proves nothing' }
  }
  return { closed: false, reason: 'probe evidence is incomplete; quarantine/stop-gate block applies' }
}

export function writeClockProbeCleanupClosureV3(probeRoot: string, scopeId: string, probeId: string, leaseRef: ArtifactRef, closure: ClockProbeCleanupClosureV3['closure'], evidenceRef: ArtifactRef): { record: ClockProbeCleanupClosureV3; ref: ArtifactRef } {
  const record: ClockProbeCleanupClosureV3 = { schema: 'rrm-clock-probe-cleanup-closure-v3', leaseRef, closure, evidenceRef }
  const ref = clockWriteJsonExclusiveV3(path.join(probeRoot, `${scopeId}-closure-${probeId}.json`), record)
  return { record, ref }
}

// --- optional copy seed descriptor (pure shape-validating constructor) ----

export interface ClockScopeSeedInputV3 {
  purpose: 'native' | 'offline-fixture'
  scopeId: string
  preRuntimeSubject: Omit<RunBinding, 'runtimeManifest'>
  approvedSourceRef: ArtifactRef
  toolPolicyRef: ArtifactRef
  ownedNamespaces: readonly string[]
  driverDescriptor: ClockDriverPreRootDescriptorV3
}

function clockValidArtifactRefV3(value: unknown, label: string): void {
  if (typeof value !== 'object' || value === null) throw new MatrixRuntimeError(`clock seed ${label} must be an ArtifactRef object`)
  const ref = value as Record<string, unknown>
  if (typeof ref.path !== 'string' || ref.path.length === 0) throw new MatrixRuntimeError(`clock seed ${label}.path must be a nonempty string`)
  if (typeof ref.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(ref.sha256)) throw new MatrixRuntimeError(`clock seed ${label}.sha256 must be 64 lowercase hex chars`)
  if (typeof ref.bytes !== 'number' || !Number.isSafeInteger(ref.bytes) || ref.bytes <= 0) throw new MatrixRuntimeError(`clock seed ${label}.bytes must be a positive integer`)
}

function clockValidBirthV3(value: unknown, label: string): void {
  if (typeof value !== 'object' || value === null) throw new MatrixRuntimeError(`clock seed ${label} must be a NativeBirthV3 object`)
  const birth = value as Record<string, unknown>
  if (!clockBridgeIsCanonicalUuid(birth.bootUuid)) throw new MatrixRuntimeError(`clock seed ${label}.bootUuid must be a canonical UUID`)
  if (!clockBridgeIsInt32(birth.pid, 1, 2147483647)) throw new MatrixRuntimeError(`clock seed ${label}.pid must be a positive int32`)
  if (!clockBridgeIsUint64Decimal(birth.uniqueId, false)) throw new MatrixRuntimeError(`clock seed ${label}.uniqueId must be a canonical nonzero uint64 decimal`)
  if (!clockBridgeIsInt32(birth.idVersion, -2147483648, 2147483647)) throw new MatrixRuntimeError(`clock seed ${label}.idVersion must be an int32`)
  if (typeof birth.executableUuid !== 'string' || !CLOCK_EXECUTABLE_UUID_PATTERN.test(birth.executableUuid)) throw new MatrixRuntimeError(`clock seed ${label}.executableUuid must be 32 hex chars`)
}

/** Pure constructor for ClockScopeSeedV3. Shape validation only: no source
 *  bytes are read, no authority result exists, offline-fixture seeds are
 *  never convertible to native evidence by this constructor. */
export function createClockScopeSeedV3(input: ClockScopeSeedInputV3): ClockScopeSeedV3 {
  if (input.purpose !== 'native' && input.purpose !== 'offline-fixture') throw new MatrixRuntimeError('clock seed purpose must be native or offline-fixture')
  if (typeof input.scopeId !== 'string' || input.scopeId.length === 0) throw new MatrixRuntimeError('clock seed scopeId must be a nonempty string')
  const subject = input.preRuntimeSubject as unknown as Record<string, unknown>
  if (typeof subject !== 'object' || subject === null) throw new MatrixRuntimeError('clock seed preRuntimeSubject is required')
  if ('runtimeManifest' in subject) throw new MatrixRuntimeError('clock seed preRuntimeSubject must not already carry a runtimeManifest')
  if (subject.pass !== 1 && subject.pass !== 2) throw new MatrixRuntimeError('clock seed preRuntimeSubject.pass must be 1 or 2')
  if (typeof subject.invocation !== 'number' || !Number.isSafeInteger(subject.invocation) || subject.invocation <= 0) throw new MatrixRuntimeError('clock seed preRuntimeSubject.invocation must be a positive integer')
  for (const field of ['invocationId', 'profile', 'runId', 'sourceMode', 'evidenceRoot'] as const) {
    if (typeof subject[field] !== 'string' || (subject[field] as string).length === 0) throw new MatrixRuntimeError(`clock seed preRuntimeSubject.${field} must be a nonempty string`)
  }
  clockValidArtifactRefV3(subject.clearanceManifest, 'preRuntimeSubject.clearanceManifest')
  clockValidArtifactRefV3(input.approvedSourceRef, 'approvedSourceRef')
  clockValidArtifactRefV3(input.toolPolicyRef, 'toolPolicyRef')
  if (!Array.isArray(input.ownedNamespaces) || input.ownedNamespaces.length === 0) throw new MatrixRuntimeError('clock seed ownedNamespaces must be a nonempty array')
  for (const namespace of input.ownedNamespaces) {
    if (typeof namespace !== 'string' || namespace.length === 0) throw new MatrixRuntimeError('clock seed ownedNamespaces entries must be nonempty strings')
  }
  if (new Set(input.ownedNamespaces).size !== input.ownedNamespaces.length) throw new MatrixRuntimeError('clock seed ownedNamespaces entries must be distinct')
  const driver = input.driverDescriptor as unknown as Record<string, unknown>
  if (typeof driver !== 'object' || driver === null) throw new MatrixRuntimeError('clock seed driverDescriptor is required')
  if (driver.schema !== 'rrm-clock-preroot-descriptor-v3') throw new MatrixRuntimeError('clock seed driverDescriptor.schema must be rrm-clock-preroot-descriptor-v3')
  if (typeof driver.scopeId !== 'string' || driver.scopeId !== input.scopeId) throw new MatrixRuntimeError('clock seed driverDescriptor.scopeId must equal the seed scopeId')
  if (!clockBridgeIsCanonicalUuid(driver.clockInstanceId)) throw new MatrixRuntimeError('clock seed driverDescriptor.clockInstanceId must be a canonical UUID')
  if (driver.domain !== 'matrix-context-capture') throw new MatrixRuntimeError('clock seed driverDescriptor.domain must be the host matrix-context-capture role; the seed driver is the host')
  if (driver.representation !== 'host-rounded-ms') throw new MatrixRuntimeError('clock seed driverDescriptor.representation must pair host-rounded-ms with the host driver role')
  if (driver.basis !== 'node-hrtime-bigint-performance-now') throw new MatrixRuntimeError('clock seed driverDescriptor.basis must be the reviewed Node basis')
  clockValidBirthV3(driver.nativeBirth, 'driverDescriptor.nativeBirth')
  const parent = driver.observedParent as unknown as Record<string, unknown>
  if (typeof parent !== 'object' || parent === null) throw new MatrixRuntimeError('clock seed driverDescriptor.observedParent is required')
  if (!clockBridgeIsInt32(parent.pid, 1, 2147483647)) throw new MatrixRuntimeError('clock seed driverDescriptor.observedParent.pid must be a positive int32')
  if (!clockBridgeIsUint64Decimal(parent.parentUniqueId, false)) throw new MatrixRuntimeError('clock seed driverDescriptor.observedParent.parentUniqueId must be a canonical nonzero uint64 decimal')
  return {
    schema: 'rrm-clock-scope-seed-v3',
    purpose: input.purpose,
    scopeId: input.scopeId,
    preRuntimeSubject: input.preRuntimeSubject,
    approvedSourceRef: input.approvedSourceRef,
    toolPolicyRef: input.toolPolicyRef,
    ownedNamespaces: [...input.ownedNamespaces],
    driverDescriptor: input.driverDescriptor,
  }
}

// --- synchronous observer self acquisition (1000ms local cap) -------------

export interface ClockObserverSyncInputV3 {
  bootstrap: ClockObserverBootstrapV3
  localBudgetMs: 1000
}

export interface ClockObserverSyncDepsV3 {
  spawnSync?: ClockSpawnSyncFnV3
  nowNs?: () => bigint
  /** Test-only observation point after the SECOND seal check, before fork. */
  onBeforeFork?: () => void
}

function clockValidateBootstrapV3(bootstrap: ClockObserverBootstrapV3): void {
  if (bootstrap.schema !== 'rrm-clock-observer-bootstrap-v3') throw new ClockObserverAcquisitionErrorV3('bootstrap schema must be rrm-clock-observer-bootstrap-v3')
  for (const field of ['protocolId', 'appDir', 'rootScopePath', 'probeRoot'] as const) {
    if (typeof bootstrap[field] !== 'string' || bootstrap[field].length === 0) throw new ClockObserverAcquisitionErrorV3(`bootstrap.${field} must be a nonempty string`)
  }
  clockValidArtifactRefV3(bootstrap.seedRef, 'bootstrap.seedRef')
  clockValidArtifactRefV3(bootstrap.toolPolicyRef, 'bootstrap.toolPolicyRef')
  const descriptor = bootstrap.sourceDescriptor as unknown as Record<string, unknown>
  if (descriptor.schema !== 'rrm-clock-preroot-descriptor-v3') throw new ClockObserverAcquisitionErrorV3('bootstrap.sourceDescriptor.schema must be rrm-clock-preroot-descriptor-v3')
  if (typeof descriptor.scopeId !== 'string' || descriptor.scopeId.length === 0) throw new ClockObserverAcquisitionErrorV3('bootstrap.sourceDescriptor.scopeId must be a nonempty string')
  if (!clockBridgeIsCanonicalUuid(descriptor.clockInstanceId)) throw new ClockObserverAcquisitionErrorV3('bootstrap.sourceDescriptor.clockInstanceId must be a canonical UUID')
  if (descriptor.domain !== 'observer') throw new ClockObserverAcquisitionErrorV3('bootstrap.sourceDescriptor.domain must be the observer role')
  if (descriptor.representation !== 'raw-ms') throw new ClockObserverAcquisitionErrorV3('bootstrap.sourceDescriptor.representation must pair raw-ms with the observer role')
  if (descriptor.basis !== 'node-hrtime-bigint-performance-now') throw new ClockObserverAcquisitionErrorV3('bootstrap.sourceDescriptor.basis must be the reviewed Node basis')
  let appDirStat: import('node:fs').Stats
  try {
    appDirStat = statSync(bootstrap.appDir)
  } catch (error) {
    throw new ClockObserverAcquisitionErrorV3(`bootstrap.appDir is not accessible as genuine context: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!appDirStat.isDirectory()) throw new ClockObserverAcquisitionErrorV3('bootstrap.appDir must be an actual directory')
}

/** PRIVATE synchronous observer self lookup. Runs lazily inside the existing
 *  clock:()=>ClockMark seam; returns synchronously or THROWS before original
 *  invocation admission (zero business calls). Local hrtime budget of exactly
 *  localBudgetMs (1000) bounds admission: remaining is re-checked before and
 *  after each synchronous preparatory step and after the child returns; the
 *  child runs under spawnSync with timeout floor(remaining ms) in 1..1000
 *  (never 0), killSignal SIGKILL, detached:false, 64KiB maxBuffer, fixed args
 *  and a minimal nonsecret environment. Lease-before-fork with a second seal
 *  check immediately before the fork. A configured timeout is not an exit
 *  proof: only an actually reaped child (status) with accepted metadata,
 *  helper registration, and total elapsed<=budget yields a result. */
export function readObserverSelfSyncV3(input: ClockObserverSyncInputV3, deps: ClockObserverSyncDepsV3 = {}): ClockSelfAcquisitionV3 {
  if (input.localBudgetMs !== CLOCK_OBSERVER_LOCAL_BUDGET_MS_V3) {
    throw new ClockObserverAcquisitionErrorV3('observer local budget must be exactly 1000ms')
  }
  const nowNs = deps.nowNs ?? (() => process.hrtime.bigint())
  const run = deps.spawnSync ?? (spawnSync as unknown as ClockSpawnSyncFnV3)
  clockValidateBootstrapV3(input.bootstrap)
  const scopeId = input.bootstrap.sourceDescriptor.scopeId
  const startedNs = nowNs()
  const elapsedNs = () => nowNs() - startedNs
  const budgetNs = BigInt(input.localBudgetMs) * BigInt(1_000_000)
  const ensureWithinBudget = (step: string): number => {
    const remaining = budgetNs - elapsedNs()
    if (remaining <= BigInt(0)) {
      throw new ClockObserverAcquisitionErrorV3(`observer local budget exhausted at ${step}; no admissible acquisition`)
    }
    return Number(remaining / BigInt(1_000_000))
  }
  const completion = (outcome: 'timeout' | 'error' | 'not-spawned', probeId: string | null, leaseRef: ArtifactRef | null, registrationRef: ArtifactRef | null, spawnPid: number | null, status: number | null, signal: string | null, message: string): never => {
    if (probeId !== null && leaseRef !== null) {
      try {
        writeClockProbeCompletionV3({
          probeRoot: input.bootstrap.probeRoot, scopeId, probeId, leaseRef, registrationRef,
          spawnPid, status, signal, outcome, elapsedNs: elapsedNs().toString(), sourceAssociation: 'observer-self',
        })
      } catch {
        // completion write failure must not mask the admission failure
      }
    }
    throw new ClockObserverAcquisitionErrorV3(message)
  }

  ensureWithinBudget('bootstrap')
  mkdirSync(input.bootstrap.probeRoot, { recursive: true })
  ensureClockProbeUnsealedV3(input.bootstrap.probeRoot, scopeId)
  const { lease, ref: leaseRef } = createClockProbeLeaseV3({
    probeRoot: input.bootstrap.probeRoot, scopeId, clockInstanceId: input.bootstrap.sourceDescriptor.clockInstanceId,
    ownerPidHint: process.pid, role: 'observer', rootScopeRef: input.bootstrap.seedRef,
    localBudgetMs: input.localBudgetMs, mode: 'observer-self', context: input.bootstrap.appDir, nowNs,
  })
  ensureWithinBudget('lease')
  ensureClockProbeUnsealedV3(input.bootstrap.probeRoot, scopeId)
  deps.onBeforeFork?.()
  const remainingMs = ensureWithinBudget('seal-recheck')
  const timeoutMs = Math.floor(remainingMs)
  if (timeoutMs < 1) {
    return completion('not-spawned', lease.probeId, leaseRef, null, null, null, null, 'less than 1ms of local budget remained; spawnSync was never called (timeout 0 can never disable the cap)')
  }
  const registrationPath = path.join(input.bootstrap.probeRoot, `${scopeId}-registration-${lease.probeId}.json`)
  const observerRequest: ClockBridgeRequestBRepairV3 = {
    schema: 'rrm-clock-bridge-request-br-v2',
    mode: 'observer',
    pid: process.pid,
    appDir: input.bootstrap.appDir,
    rootScopePath: input.bootstrap.rootScopePath,
    registrationPath,
    leaseRef,
  }
  let result: ClockSpawnSyncResultV3
  try {
    result = clockBridgeRunV3(run, observerRequest, timeoutMs)
  } catch (error) {
    return completion('error', lease.probeId, leaseRef, null, null, null, null, `observer bridge invocation failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  ensureWithinBudget('child-return')
  if (result.error !== undefined) {
    return completion('error', lease.probeId, leaseRef, null, result.pid ?? null, result.status, result.signal, `observer bridge could not be executed: ${result.error.code ?? 'unknown'}`)
  }
  if (result.status === null && result.signal !== null) {
    return completion('timeout', lease.probeId, leaseRef, null, result.pid ?? null, result.status, result.signal, 'observer bridge child did not return before the local cap; SIGKILL is not an exit proof')
  }
  if (result.status !== 0) {
    return completion('error', lease.probeId, leaseRef, null, result.pid ?? null, result.status, result.signal, 'observer bridge exited abnormally')
  }
  let node: ClockBridgeNodeReadV3
  try {
    const line = clockBridgeMapSpawnOutcomeV3(result, 'observer')
    const reply = parseClockBridgeReplyV3(line, 'observer', process.pid)
    if (!reply.ok) {
      return completion('error', lease.probeId, leaseRef, null, result.pid ?? null, result.status, result.signal, `observer bridge reported failure ${reply.failure.code}`)
    }
    if (reply.mode !== 'observer') {
      return completion('error', lease.probeId, leaseRef, null, result.pid ?? null, result.status, result.signal, 'observer bridge reply mode mismatch')
    }
    if (reply.registrationRef.path !== registrationPath) {
      return completion('error', lease.probeId, leaseRef, null, result.pid ?? null, result.status, result.signal, 'observer bridge registration ref path does not match the requested registration path')
    }
    node = reply.read
  } catch (error) {
    return completion('error', lease.probeId, leaseRef, null, result.pid ?? null, result.status, result.signal, `observer bridge metadata rejected: ${error instanceof Error ? error.message : String(error)}`)
  }
  let registrationRef: ArtifactRef
  try {
    const registration = readClockProbeRecordV3<ClockProbeRegistrationV3>(registrationPath, 'rrm-clock-probe-registration-v3')
    registrationRef = clockArtifactRefV3(registrationPath, readFileSync(registrationPath, 'utf8'))
    if (registration.helperBirth.pid !== result.pid) throw new ClockObserverAcquisitionErrorV3('registration helper birth pid does not match the actual spawned helper pid')
    if (registration.helperBirth.pid === process.pid) throw new ClockObserverAcquisitionErrorV3('registration helper birth must not be the observer pid')
    const ownerFields: (keyof NativeBirthV3)[] = ['bootUuid', 'pid', 'uniqueId', 'idVersion', 'executableUuid']
    for (const field of ownerFields) {
      if (registration.ownerBirth[field] !== node[field as keyof ClockBridgeNodeReadV3]) {
        throw new ClockObserverAcquisitionErrorV3(`registration owner birth field ${field} does not match the independently acquired observer identity`)
      }
    }
    if (!clockBridgeIsInt32(registration.pgid, 1, 2147483647) || !clockBridgeIsInt32(registration.sessionId, 1, 2147483647)) {
      throw new ClockObserverAcquisitionErrorV3('registration group/session must be positive int32 values')
    }
  } catch (error) {
    return completion('error', lease.probeId, leaseRef, null, result.pid ?? null, result.status, result.signal, `helper registration rejected: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (node.pid !== process.pid) {
    return completion('error', lease.probeId, leaseRef, registrationRef, result.pid ?? null, result.status, result.signal, 'acquired birth pid must be the actual observer process, never the helper pid')
  }
  const completionWrite = writeClockProbeCompletionV3({
    probeRoot: input.bootstrap.probeRoot, scopeId, probeId: lease.probeId, leaseRef, registrationRef,
    spawnPid: result.pid ?? null, status: result.status, signal: null, outcome: 'returned',
    elapsedNs: elapsedNs().toString(), sourceAssociation: 'observer-self',
  })
  const finished = nowNs()
  if (finished - startedNs > budgetNs) {
    // A valid child response followed by slow ledger IO: the completion stays
    // the child truth ('returned'), but NO admissible acquisition is returned.
    throw new ClockObserverAcquisitionErrorV3('observer local budget overran after child return and ledger IO; no admissible acquisition')
  }
  const completionRef = completionWrite.ref
  return {
    schema: 'rrm-clock-self-acquisition-v3',
    birth: {
      bootUuid: node.bootUuid, pid: node.pid, uniqueId: node.uniqueId,
      idVersion: node.idVersion, executableUuid: node.executableUuid,
    },
    parent: { pid: node.ppid, parentUniqueId: node.parentUniqueId },
    leaseRef,
    registrationRef,
    completionRef,
    startedNs: startedNs.toString(),
    finishedNs: finished.toString(),
  }
}
