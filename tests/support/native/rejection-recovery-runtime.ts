/**
 * Rejection/Recovery Matrix — owned profile runtime lifecycle controller.
 * TEST-ONLY. Composed EXCLUSIVELY from already-exported native safety
 * primitives. The native CLI and the side-effecting run-native-business-tests
 * module are never imported.
 *
 * Shutdown captures real artifacts BEFORE one verified stop of the resources
 * this run actually started. Stop failures are recorded and block the next
 * profile. A successful stop is idempotent and removes the run root (PGDATA +
 * app build) unless RRM_KEEP_RUNTIME=1; a failed stop retains it.
 */
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
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
import { formatAppHealthSummary, startAppHealthSampler, summarizeAppHealth, type AppHealthSampler } from './app-health'
import { startMailCapture, type MailCaptureHandle } from './mail-capture'
import { assertOwnedLoopbackDatabaseTarget, createSafeRunPlan } from '../business-workflow-safety'
import { BUSINESS_ROUTE_CONFIGURATION_NAMES } from '../business-workflow-fixture'
import { applyMappedMatrixSeed, assertReadOnlySingleSelect, parsePsqlJsonDocument } from '../rejection-recovery-matrix'
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

/**
 * Copies the last maxBytes of a log. The run root (and its logs) is deleted after
 * a clean stop, so evidence capture keeps the app log tail first.
 */
export async function copyLogTail(
  source: string,
  dest: string,
  maxBytes = 3 * 1024 * 1024,
): Promise<'copied' | 'missing'> {
  let file
  try {
    file = await fs.open(source, 'r')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'
    throw error
  }
  try {
    const { size } = await file.stat()
    const length = Math.min(size, maxBytes)
    const buffer = Buffer.alloc(length)
    if (length > 0) await file.read(buffer, 0, length, size - length)
    await fs.mkdir(path.dirname(dest), { recursive: true })
    await fs.writeFile(dest, buffer)
    return 'copied'
  } finally {
    await file.close()
  }
}

/** Reads the last maxBytes of a log as text; a missing log reads as empty. */
export async function readLogTail(source: string, maxBytes = 64 * 1024): Promise<string> {
  let file
  try {
    file = await fs.open(source, 'r')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
  try {
    const { size } = await file.stat()
    const length = Math.min(size, maxBytes)
    const buffer = Buffer.alloc(length)
    if (length > 0) await file.read(buffer, 0, length, size - length)
    return buffer.toString('utf8')
  } finally {
    await file.close()
  }
}

/** A run root is disposable only if it is a direct child of the matrix tmp parent. */
export function isDisposableRuntimeRoot(rootDir: string): boolean {
  const resolved = path.resolve(rootDir)
  return path.dirname(resolved) === path.resolve(matrixRuntimeParentDir())
}

/** Removes a cleanly stopped run root (PGDATA + app build). RRM_KEEP_RUNTIME=1 keeps it for debugging. */
export async function removeDisposableRuntimeRoot(
  rootDir: string,
  env: Record<string, string | undefined> = process.env,
): Promise<'removed' | 'kept' | 'refused'> {
  if (env.RRM_KEEP_RUNTIME === '1') return 'kept'
  if (!isDisposableRuntimeRoot(rootDir)) return 'refused'
  await fs.rm(rootDir, { recursive: true, force: true })
  return 'removed'
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
  /** Process-table samples of the app's group; read by the pre-stop capture. */
  appHealth?: AppHealthSampler
  /** Replaces the running dev server (same ports, same log); call between cases only. */
  recycleApp?: (reason: string) => Promise<void>
  mail?: MailCaptureHandle
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
  /** Optional so injected fakes stay hermetic (no `ps`); defaultDeps supplies the real one. */
  startAppHealthSampler?: typeof startAppHealthSampler
  copyAppSource: (runtime: OwnedRuntime) => Promise<string>
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
  startAppHealthSampler,
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

export async function startMatrixRuntime(input: {
  routesConfig: MatrixRoutesConfig
  parentDir?: string
  log: (message: string) => void
  artifactCapture?: (note: string) => Promise<void>
  /** Future caller must set this explicitly. The manual driver must not. */
  seedCleared?: boolean
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
    const preloadPath = path.join(refs.appDir, 'tests', 'support', 'native', 'outbound-allowlist-preload.js')
    refs.app = deps.spawnApp(runtime, refs.appDir, preloadPath, path.join(runtime.paths.logsDir, 'next-dev.log'))
    handle.app = refs.app
    const appLogFile = path.join(runtime.paths.logsDir, 'next-dev.log')
    const healthLogFile = path.join(runtime.paths.logsDir, 'app-health.log')
    handle.appHealth = deps.startAppHealthSampler?.({ pgid: refs.app.pid, logFile: healthLogFile })
    handle.recycleApp = async (reason: string) => {
      await recycleMatrixApp(handle, { preloadPath, logFile: appLogFile, healthLogFile, log: input.log }, deps, reason)
      refs.app = handle.app
    }
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

export interface RecycleAppDeps {
  spawnApp: typeof spawnApp
  stopAppProcess: typeof stopAppProcess
  waitForHttpReady: typeof waitForHttpReady
  startAppHealthSampler?: typeof startAppHealthSampler
}

/**
 * Replaces the running `next dev` with a fresh one on the same ports and log.
 * The dev server's heap grows about 160 MB a minute (React's dev-only async
 * stack tracking and Next's manifest cache) and Next restarts it at 80% of its
 * limit, cutting a page in flight (RRM-012). A restart chosen between cases
 * happens when no browser page is open. The new app is put on the handle before
 * readiness is awaited so the final stop still reaches it if it never comes up.
 */
export async function recycleMatrixApp(
  handle: MatrixRuntimeHandle,
  paths: { preloadPath: string; logFile: string; healthLogFile: string; log: (message: string) => void },
  deps: RecycleAppDeps,
  reason: string,
): Promise<void> {
  const old = handle.app
  if (!old) throw new MatrixRuntimeError('cannot recycle the app: it is not running')
  paths.log(`matrix runtime ${handle.runtime.runId}: recycling the app (${reason})`)
  if (handle.appHealth) {
    await handle.appHealth.sampleOnce()
    paths.log(formatAppHealthSummary(summarizeAppHealth(old.pid, handle.appHealth.samples())))
    await handle.appHealth.stop()
  }
  await deps.stopAppProcess(old, handle.appDir)
  const next = deps.spawnApp(handle.runtime, handle.appDir, paths.preloadPath, paths.logFile)
  handle.app = next
  handle.appHealth = deps.startAppHealthSampler?.({ pgid: next.pid, logFile: paths.healthLogFile })
  await deps.waitForHttpReady(`${handle.baseUrl}/sign-in`, handle.runtime.ports.serverPort, next.pid, 240_000)
  paths.log(`matrix runtime ${handle.runtime.runId}: app ready again at ${handle.baseUrl}`)
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
  // The capture above has read the samples; stop sampling before the app goes away.
  await handle.appHealth?.stop()
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
  const rootDir = handle.runtime.paths.rootDir
  const rootOutcome = await removeDisposableRuntimeRoot(rootDir)
  log(`matrix runtime ${handle.runtime.runId}: stopped (root ${rootOutcome === 'removed' ? 'removed' : 'retained'}: ${rootDir})`)
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
