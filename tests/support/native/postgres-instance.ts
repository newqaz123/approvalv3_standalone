import { spawn, execFile } from 'node:child_process'
import { promises as fs, realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createRunId,
  generateDatabasePassword,
  generateE2ePassword,
  buildOutboundAllowlistSpec,
  formatAllowlistEnv,
  buildSpawnEnvironment,
  assertNoProtectedEnvironmentKeys,
  allocateDistinctLoopbackPorts,
  isOwnedRunId,
  FORBIDDEN_SHARED_PORTS,
  PG_BIN,
  REQUIRED_DATABASE_NAME,
  type OwnedPorts,
  type OutboundAllowlistSpec,
} from './native-environment'
import type { OwnedDisposableResource } from '../business-workflow-safety'
import type { T15EOwnedRuntimeCapability } from './t15e-capability-types'
import { buildT15EPrivateStdinInvocation, matchT15EPrivateProbe, runT15EPrivateStdinChild } from './t15e-private-stdin-executor'

/**
 * Native (no Docker) PostgreSQL 16 lifecycle for one owned test run.
 *
 * Guarantees implemented here:
 * - data/work dir is a unique mkdtemp owned by the run, mode 0700;
 * - the cluster is initialized with a run-generated SCRAM password;
 * - postgres listens on one owned loopback TCP port with NO Unix-domain
 *   socket (macOS caps socket paths at 103 bytes, which the owned runtime
 *   dir always exceeds; empty socket list = no shared /tmp socket either);
 * - before any schema/fixture write the runner re-verifies the postmaster
 *   PID, the data directory, the SQL port and the connected database;
 * - cleanup stops ONLY the exact verified postmaster and removes ONLY the
 *   owned tmp dir, and never deletes evidence (which lives outside it).
 */

export interface LifecycleProbe {
  (port: number): Promise<boolean>
}

function run(exe: string, args: string[], env: Record<string, string>, timeoutMs = 120_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'] as const })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`TIMEOUT: ${path.basename(exe)} ${args[0] ?? ''} did not finish in ${timeoutMs}ms`))
    }, timeoutMs)
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`${path.basename(exe)} exited ${code}\nstdout: ${stdout}\nstderr: ${stderr}`))
    })
  })
}

export async function isPortListening(port: number): Promise<boolean> {
  const net = await import('node:net')
  return new Promise((resolve) => {
    const socket = new net.Socket()
    const done = (result: boolean) => {
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(500)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
    socket.connect(port, '127.0.0.1')
  })
}

export interface NativeRuntimePaths {
  rootDir: string
  dataDir: string
  socketDir: string
  secretsDir: string
  logsDir: string
}

export interface OwnedRuntime {
  runId: string
  resource: OwnedDisposableResource
  ports: OwnedPorts
  paths: NativeRuntimePaths
  databasePassword: string
  e2ePassword: string
  databaseUrl: string
  allowlist: OutboundAllowlistSpec
  allowlistEnv: string
  postmasterPid: number | null
  appEnv: Record<string, string>
}

export async function createOwnedRuntimeRoot(parentDir: string, runId: string): Promise<NativeRuntimePaths> {
  if (!isOwnedRunId(runId)) throw new Error('SAFETY: refusing to create runtime dirs for a non-owned run id')
  const rootDir = await fs.mkdtemp(path.join(parentDir, `${runId}-`))
  await fs.mkdir(rootDir, { recursive: true })
  await fs.chmod(rootDir, 0o700)
  const dataDir = path.join(rootDir, 'pgdata')
  const socketDir = path.join(rootDir, 'pgsocket')
  const secretsDir = path.join(rootDir, 'secrets')
  const logsDir = path.join(rootDir, 'logs')
  for (const dir of [dataDir, socketDir, secretsDir, logsDir]) {
    await fs.mkdir(dir, { mode: 0o700 })
  }
  return { rootDir, dataDir, socketDir, secretsDir, logsDir }
}

const PG_ENV_BASE: Record<string, string> = {
  PATH: `${PG_BIN}:/usr/bin:/bin`,
  LC_ALL: 'C',
  HOME: process.env.HOME ?? '/tmp',
}

/**
 * Repeat-safe preparation of the shared tmp parent for owned runtime roots.
 * An existing directory is accepted (repeat invocation must not EEXIST), but
 * ONLY when verified safe/owned: inside os.tmpdir(), a real directory (not a
 * symlink), owned by the current user, and not group/world writable.
 * Anything else fails closed.
 */
export async function ensureOwnedTmpParent(parentDir: string): Promise<void> {
  const resolvedParent = path.resolve(parentDir)
  const tmpRoot = path.resolve(os.tmpdir())
  if (resolvedParent !== tmpRoot && !resolvedParent.startsWith(`${tmpRoot}${path.sep}`)) {
    throw new Error(`SAFETY: refusing tmp parent outside os.tmpdir(): ${parentDir}`)
  }
  await fs.mkdir(resolvedParent, { recursive: true, mode: 0o700 })
  const stat = await fs.lstat(resolvedParent)
  if (stat.isSymbolicLink()) {
    throw new Error(`SAFETY: tmp parent must not be a symlink: ${parentDir}`)
  }
  if (!stat.isDirectory()) {
    throw new Error(`SAFETY: tmp parent is not a directory: ${parentDir}`)
  }
  const currentUid = process.getuid?.()
  if (currentUid === undefined || stat.uid !== currentUid) {
    throw new Error(`SAFETY: tmp parent is not owned by the current user: ${parentDir}`)
  }
  if ((stat.mode & 0o022) !== 0) {
    throw new Error(`SAFETY: tmp parent must not be group/world writable: ${parentDir}`)
  }
}

export async function initdbCluster(runtime: OwnedRuntime): Promise<void> {
  const pwfile = path.join(runtime.paths.secretsDir, 'initdb-password')
  await fs.writeFile(pwfile, `${runtime.databasePassword}\n`, { mode: 0o600 })
  await run(path.join(PG_BIN, 'initdb'), [
    '-D', runtime.paths.dataDir,
    '--username=postgres',
    `--pwfile=${pwfile}`,
    '--auth-local=scram-sha-256',
    '--auth-host=scram-sha-256',
    '--encoding=UTF8',
    '--no-instructions',
  ], PG_ENV_BASE)
  // The pwfile has served its purpose; the password stays only in memory and
  // in the compose file written for the app spawn (owned tmp dir).
  await fs.rm(pwfile, { force: true })
}

export interface PostgresStartOptions {
  extraConfig?: readonly string[]
}

/**
 * Write the owned cluster settings. PostgreSQL reads ONLY postgresql.conf plus
 * its includes — a bare business_test.conf is silently IGNORED (lifecycle
 * attempt-2 evidence: the owned cluster came up on default port 5432 with the
 * shared /tmp socket). The settings therefore live in business_test.conf and
 * postgresql.conf gains an include_if_exists for it, so the owned port, owned
 * socket dir and 127.0.0.1-only listen address actually apply — the cluster
 * can never touch the forbidden shared ports (3100/5432).
 */
/** Task112: canonical-arity config writer — the start path passes ALLOCATION
 *  values, never foreign mutable runtime fields relabeled later. */
async function writeOwnedPostgresConfigAt(
  dataDir: string,
  databasePort: number,
  options: PostgresStartOptions = {},
): Promise<void> {
  const settings = [
    `port = ${databasePort}`,
    "listen_addresses = '127.0.0.1'",
    // No Unix-domain socket at all: every client (psql, the app) connects via
    // the OWNED loopback TCP port, and macOS caps socket paths at 103 bytes —
    // the deep owned runtime dir always exceeds it (lifecycle attempt-1
    // evidence: FATAL could not create any Unix-domain sockets). An empty
    // socket list also makes a shared /tmp socket impossible by construction.
    "unix_socket_directories = ''",
    'fsync = off',
    'synchronous_commit = off',
    'full_page_writes = off',
    'logging_collector = off',
    ...(options.extraConfig ?? []),
  ]
  await fs.appendFile(path.join(dataDir, 'business_test.conf'), settings.join('\n') + '\n')
  await fs.appendFile(
    path.join(dataDir, 'postgresql.conf'),
    "include_if_exists = 'business_test.conf'\n",
  )
}

export async function writeOwnedPostgresConfig(
  runtime: OwnedRuntime,
  options: PostgresStartOptions = {},
): Promise<void> {
  // Existing public surface preserved: delegates with the caller's runtime.
  await writeOwnedPostgresConfigAt(runtime.paths.dataDir, runtime.ports.databasePort, options)
}

export async function startPostgres(
  runtime: OwnedRuntime,
  options: PostgresStartOptions = {},
): Promise<number> {
  // Task112 P1: resolve the LIVE EXACT private allocation BEFORE any
  // configuration/fs/pg_ctl effect. Unregistered shapes have no authority;
  // revoked allocations never start.
  const allocation = t15eOwnedRuntimeAllocations.get(runtime)
  if (allocation === undefined) {
    throw new Error('SAFETY: startPostgres requires a producer-allocated runtime')
  }
  if (t15eAllocationLive.get(runtime) !== true) {
    throw new Error('SAFETY: allocation is revoked; refusing to start')
  }
  // Mutable handle fields are validated against the canonical allocation: a
  // relabeled or mutated runtime can never relabel foreign paths into the
  // private observed record.
  if (runtime.paths.rootDir !== allocation.rootDir ||
      runtime.paths.dataDir !== allocation.dataDir ||
      runtime.paths.logsDir !== allocation.logsDir ||
      runtime.ports.databasePort !== allocation.databasePort) {
    throw new Error('SAFETY: runtime paths/port diverge from the canonical allocation; refusing to start')
  }
  // Canonical metadata is used THROUGHOUT IO/start/read.
  await writeOwnedPostgresConfigAt(allocation.dataDir, allocation.databasePort, options)
  const logfile = path.join(allocation.logsDir, 'postgresql.log')
  await run(path.join(PG_BIN, 'pg_ctl'), [
    '-D', allocation.dataDir,
    '-l', logfile,
    '-w', '-t', '60',
    'start',
  ], PG_ENV_BASE, 90_000)
  const parsed = await readOwnedPostmasterIdentity(allocation.dataDir, {
    dataDir: allocation.dataDir,
    databasePort: allocation.databasePort,
  })
  if (!parsed.ok) throw new Error('SAFETY: postgres started but the owned postmaster.pid identity is missing or invalid')
  const identity = parsed.identity
  runtime.postmasterPid = identity.postmasterPid
  // Same-current-record recheck AFTER every await: a concurrent start or
  // replacement must never publish a stale proof.
  if (t15eOwnedRuntimeAllocations.get(runtime) !== allocation || t15eAllocationLive.get(runtime) !== true) {
    throw new Error('SAFETY: allocation changed during startup; refusing to publish observed identity')
  }
  // Task111/112: privately record the OBSERVED startup generation — full
  // identity (PID + dir + start timestamp + port) from the internal read.
  // The mutable runtime mirror above is a convenience only; this private
  // record is the sole authority for later identity binding.
  t15eObservedStartup.set(runtime, Object.freeze({
    runId: allocation.runId,
    rootDir: allocation.rootDir,
    dataDir: allocation.dataDir,
    databasePort: allocation.databasePort,
    postmasterPid: identity.postmasterPid,
    startTimeEpochSeconds: identity.startTimeEpochSeconds,
  }))
  return identity.postmasterPid
}

/** Full postmaster.pid generation (PID, canonical data directory, start
 * timestamp, port). STRICT numeric parsing: digits-only lines, positive
 * values — no permissive parseInt and no trailing junk. */
export interface T15EOwnedPostmasterIdentity {
  postmasterPid: number
  dataDirectory: string
  startTimeEpochSeconds: number
  port: number
}
export type T15EOwnedPostmasterIdentityParse =
  | { ok: true; identity: Readonly<T15EOwnedPostmasterIdentity> }
  | { ok: false; reason: 'MISSING' | 'MALFORMED_PID' | 'MALFORMED_START_TIME' | 'MALFORMED_PORT' | 'DIR_MISMATCH' | 'PORT_MISMATCH' }

const STRICT_POSITIVE_INT = /^[0-9]+$/
/** Applicable PID bound: positive signed 32-bit. */
const MAX_SIGNED_32BIT_PID = 2147483647
const MIN_TCP_PORT = 1
const MAX_TCP_PORT = 65535

/**
 * Digits-only AND finite safe integer AND within [min, max], with a
 * string-round-trip equality check so MAX_SAFE_INTEGER rounding aliases and
 * leading zeros are rejected instead of silently aliased to another value.
 */
function parseStrictBoundedInt(line: string, min: number, max: number): number | null {
  if (!STRICT_POSITIVE_INT.test(line)) return null
  const value = Number(line)
  if (!Number.isFinite(value) || !Number.isSafeInteger(value)) return null
  if (String(value) !== line) return null // rounding alias / leading zeros
  if (value < min || value > max) return null
  return value
}

export function parseOwnedPostmasterPidIdentity(
  content: string,
  expected: { dataDir: string; databasePort: number },
): T15EOwnedPostmasterIdentityParse {
  // Raw lines, no trimming: strict digits-only means whitespace-padded or
  // junk-suffixed values are malformed rather than permissively accepted.
  const lines = content.split('\n')
  const pidLine = lines[0] ?? ''
  const dirLine = lines[1] ?? ''
  const startLine = lines[2] ?? ''
  const portLine = lines[3] ?? ''
  if (pidLine === '' || dirLine === '' || startLine === '' || portLine === '') return { ok: false, reason: 'MISSING' }
  const postmasterPid = parseStrictBoundedInt(pidLine, 1, MAX_SIGNED_32BIT_PID)
  if (postmasterPid === null) return { ok: false, reason: 'MALFORMED_PID' }
  const startTimeEpochSeconds = parseStrictBoundedInt(startLine, 1, Number.MAX_SAFE_INTEGER)
  if (startTimeEpochSeconds === null) return { ok: false, reason: 'MALFORMED_START_TIME' }
  const port = parseStrictBoundedInt(portLine, MIN_TCP_PORT, MAX_TCP_PORT)
  if (port === null) return { ok: false, reason: 'MALFORMED_PORT' }
  if (dirLine !== expected.dataDir) return { ok: false, reason: 'DIR_MISMATCH' }
  if (port !== expected.databasePort) return { ok: false, reason: 'PORT_MISMATCH' }
  return { ok: true, identity: Object.freeze({ postmasterPid, dataDirectory: dirLine, startTimeEpochSeconds, port }) }
}

async function readOwnedPostmasterIdentity(
  dataDir: string,
  expected: { dataDir: string; databasePort: number },
): Promise<T15EOwnedPostmasterIdentityParse> {
  let content: string
  try {
    content = await fs.readFile(path.join(dataDir, 'postmaster.pid'), 'utf8')
  } catch {
    return { ok: false, reason: 'MISSING' }
  }
  return parseOwnedPostmasterPidIdentity(content, expected)
}

/**
 * Deadline-owned read workflow (Task112): the captured absolute finite
 * deadline gates the read BEFORE it starts, races it against an injected
 * timer (a hanging read cannot stretch the deadline — the read promise is
 * never "cancelled"; its late result is simply discarded and the REAL timer
 * is cleared on the success path), and is rechecked AFTER the read so a read
 * that completes late never counts. Pure data-domain helper: clock, timer,
 * and read are injected; used by the private probe below and by tests.
 */
export async function boundedOwnedRead<Read>(input: {
  deadlineEpochMs: number
  clock: { nowEpochMs(): number }
  arm: (ms: number) => { fired: Promise<void>; cancel(): void }
  read: () => Promise<Read>
}): Promise<{ ok: true; value: Read } | { ok: false; category: 'T15E_STDIN_DEADLINE' | 'T15E_STDIN_READ_FAILED' | 'T15E_STDIN_TIMER_FAILED' }> {
  // Immutable captures at entry: a mutated input object can NEVER extend the
  // budget or swap the clock/read/arm callbacks mid-flight.
  const deadlineEpochMs = input.deadlineEpochMs
  const clock = input.clock
  const arm = input.arm
  const read = input.read
  // Expired/invalid budget is rejected BEFORE any timer/read effect.
  const expired = () => !Number.isFinite(deadlineEpochMs) || !(deadlineEpochMs > clock.nowEpochMs())
  if (expired()) return { ok: false, category: 'T15E_STDIN_DEADLINE' }
  const budget = deadlineEpochMs - clock.nowEpochMs()
  if (!(budget > 0)) return { ok: false, category: 'T15E_STDIN_DEADLINE' }
  let timer: { fired: Promise<void>; cancel(): void }
  try {
    timer = arm(budget)
  } catch {
    // Synchronous arm failure: contained fixed failure, nothing was armed.
    return { ok: false, category: 'T15E_STDIN_TIMER_FAILED' }
  }
  let cancelFailed = false
  // Cancellation is ALWAYS attempted once armed, on every exit path,
  // independently guarded: a throwing cancel can never strand the wait or
  // skip consumers. (The race does NOT cancel the filesystem operation —
  // only this real timer is cleared; a late read result is discarded.)
  const cancelArmed = () => {
    try { timer.cancel() } catch { cancelFailed = true }
  }
  type ReadRace = { kind: 'read'; value: Read } | { kind: 'read-error'; error: unknown } | { kind: 'deadline' } | { kind: 'timer-failed' }
  // Task113B: timer failure is latched INDEPENDENTLY of the race winner —
  // a rejection observed after the race settled on the read (but before
  // publication) must still defeat success; a rejection observed after
  // publication only gets consumed and never mutates the frozen result.
  let timerFailed = false
  const raced = await new Promise<ReadRace>((resolve) => {
    let settled = false
    const finish = (value: ReadRace): void => {
      if (settled) return
      settled = true
      resolve(value)
    }
    // Timer consumers are attached BEFORE invoking read, so an already- or
    // about-to-reject timer cannot be outrun by an immediately resolved read.
    timer.fired.then(
      () => finish({ kind: 'deadline' }),
      () => {
        timerFailed = true // latch: independent of the settled flag
        finish({ kind: 'timer-failed' })
      },
    )
    // Read consumers are attached on EVERY branch: a synchronous read throw is
    // contained here, and late read settlement/rejection after the race is
    // consumed by these handlers (no unhandled escapes, no raw error logs).
    try {
      Promise.resolve(read()).then(
        (value) => finish({ kind: 'read', value }),
        (error: unknown) => finish({ kind: 'read-error', error }),
      )
    } catch (error: unknown) {
      finish({ kind: 'read-error', error })
    }
  })
  cancelArmed()
  if (raced.kind === 'timer-failed') return { ok: false, category: 'T15E_STDIN_TIMER_FAILED' }
  if (raced.kind === 'read-error') return { ok: false, category: 'T15E_STDIN_READ_FAILED' }
  if (raced.kind === 'deadline') return { ok: false, category: 'T15E_STDIN_DEADLINE' }
  // The read won: a throwing timer cancellation DEFEATS success with a fixed
  // failure (never silently swallowed, never turned into success).
  if (cancelFailed) return { ok: false, category: 'T15E_STDIN_TIMER_FAILED' }
  // Post-read recheck against the CAPTURED deadline: a read that completes at
  // or after the deadline never counts.
  if (expired()) return { ok: false, category: 'T15E_STDIN_DEADLINE' }
  // Timer failure observed before publication (after the read won the race)
  // defeats success immediately before it is returned; nothing already
  // returned is ever reinterpreted afterwards.
  if (timerFailed) return { ok: false, category: 'T15E_STDIN_TIMER_FAILED' }
  return { ok: true, value: raced.value }
}

export async function readPostmasterPid(dataDir: string): Promise<number | null> {
  try {
    const content = await fs.readFile(path.join(dataDir, 'postmaster.pid'), 'utf8')
    const first = content.split('\n')[0]?.trim()
    const pid = Number(first)
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null }
}

export interface PostgresIdentity {
  postmasterPid: number
  processCommandMatchesOwnedBinary: boolean
  processCommand: string
  dataDirectory: string
  serverPort: number
  connectedDatabase: string
  connectedUser: string
  serverVersion: string
  socketDirectory: string
}

/**
 * Executable paths that count as OUR postgres binary: the Homebrew symlink
 * path this runner spawns through (PG_BIN/postgres) plus its canonical
 * realpath — macOS `ps -o command=` reports the RESOLVED binary path
 * (…/Cellar/postgresql@16/<ver>/bin/postgres), not the invoked symlink
 * (observed in lifecycle attempt 2). Computed once; fail-closed to the
 * symlink-only set if realpath is unavailable.
 */
let ownedPostgresBinariesCache: string[] | null = null
export function ownedPostgresBinaries(): string[] {
  if (ownedPostgresBinariesCache === null) {
    const symlinkPath = path.join(PG_BIN, 'postgres')
    const candidates = [symlinkPath]
    try {
      const resolved = realpathSync(symlinkPath)
      if (resolved !== symlinkPath) candidates.push(resolved)
    } catch {
      // Binary not resolvable here — only the exact symlink path is accepted.
    }
    ownedPostgresBinariesCache = candidates
  }
  return ownedPostgresBinariesCache
}

/**
 * Parse `ps -p PID -o command=` and confirm it is OUR postgres binary on OUR
 * data dir. Both checks are EXACT-token matches: the executable token must be
 * an owned binary path (symlink or canonical realpath) and the `-D` argument
 * must EQUAL the owned data dir — a sibling path such as `<dataDir>2` is
 * rejected (no loose substring/prefix matching).
 */
export function postmasterCommandIsOwned(command: string, dataDir: string): boolean {
  const tokens = command.trim().split(/\s+/)
  if (tokens.length === 0 || !ownedPostgresBinaries().includes(tokens[0])) return false
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i] === '-D' && tokens[i + 1] === dataDir) return true
    if (tokens[i] === `-D${dataDir}`) return true
  }
  return false
}

function psqlEnv(runtime: OwnedRuntime, database: string): Record<string, string> {
  // Explicit password only; PG* ambient variables are never inherited.
  return {
    ...PG_ENV_BASE,
    PGPASSWORD: runtime.databasePassword,
    PGHOST: '127.0.0.1',
    PGPORT: String(runtime.ports.databasePort),
    PGUSER: 'postgres',
    PGDATABASE: database,
  }
}

export async function psqlQuery(runtime: OwnedRuntime, database: string, sql: string): Promise<string> {
  const { stdout } = await run(
    path.join(PG_BIN, 'psql'),
    ['-X', '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql],
    psqlEnv(runtime, database),
  )
  return stdout.trim()
}

/**
 * Shared read-only identity collection: postmaster PID ps check (owned binary
 * + exact -D boundary), data_directory, SQL port, current_database, user,
 * server version, socket dir. Carries NO database-name policy — the policy
 * lives in the two wrappers below so the strict business guard cannot be
 * satisfied through the maintenance path.
 */
async function collectPostgresIdentity(runtime: OwnedRuntime, database: string): Promise<PostgresIdentity> {
  if (runtime.postmasterPid === null) throw new Error('SAFETY: postgres has not been started by this runner')
  const { stdout: command } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile('ps', ['-p', String(runtime.postmasterPid), '-o', 'command='], (error, stdout, stderr) => {
      if (error) reject(new Error(`SAFETY: postmaster PID ${runtime.postmasterPid} is not running: ${error.message} ${stderr}`))
      else resolve({ stdout, stderr })
    })
  })
  const processCommand = command.trim()
  if (!postmasterCommandIsOwned(processCommand, runtime.paths.dataDir)) {
    throw new Error(
      `SAFETY: postmaster PID ${runtime.postmasterPid} is not the owned cluster (command: ${processCommand}, expected -D ${runtime.paths.dataDir})`,
    )
  }
  const dataDirectory = await psqlQuery(runtime, database, "select current_setting('data_directory')")
  if (dataDirectory !== runtime.paths.dataDir) {
    throw new Error(`SAFETY: connected data_directory is ${dataDirectory}, not the owned ${runtime.paths.dataDir}`)
  }
  const serverPort = Number(await psqlQuery(runtime, database, 'select current_setting(\'port\')'))
  if (serverPort !== runtime.ports.databasePort) {
    throw new Error(`SAFETY: SQL server port ${serverPort} is not the owned port ${runtime.ports.databasePort}`)
  }
  return {
    postmasterPid: runtime.postmasterPid,
    processCommandMatchesOwnedBinary: true,
    processCommand,
    dataDirectory,
    serverPort,
    connectedDatabase: await psqlQuery(runtime, database, 'select current_database()'),
    connectedUser: await psqlQuery(runtime, database, 'select current_user'),
    serverVersion: await psqlQuery(runtime, database, 'show server_version'),
    socketDirectory: await psqlQuery(runtime, database, "select current_setting('unix_socket_directories')"),
  }
}

/**
 * READ-ONLY maintenance identity verification against the initial `postgres`
 * database — used right after startPostgres, BEFORE the owned business
 * database exists (e.g. lifecycle-smoke never creates it). Deliberately a
 * separate contract from the business-write guard: it accepts ONLY the
 * maintenance database and can never be satisfied by (or used to authorize
 * writes into) REQUIRED_DATABASE_NAME.
 */
export async function verifyOwnedMaintenanceIdentity(runtime: OwnedRuntime): Promise<PostgresIdentity> {
  const identity = await collectPostgresIdentity(runtime, 'postgres')
  if (identity.connectedDatabase !== 'postgres') {
    throw new Error(`SAFETY: maintenance identity check connected to ${identity.connectedDatabase}, expected the postgres maintenance database`)
  }
  return identity
}

export async function verifyPostgresIdentity(runtime: OwnedRuntime, expectedDatabase: string): Promise<PostgresIdentity> {
  // Strict business-write guard, unchanged: every caller of this function
  // must be working in REQUIRED_DATABASE_NAME (owned business DB) — refuse
  // any other database BEFORE connecting.
  if (expectedDatabase !== REQUIRED_DATABASE_NAME) {
    throw new Error(`SAFETY: refusing to work in database ${expectedDatabase}; required ${REQUIRED_DATABASE_NAME}`)
  }
  const identity = await collectPostgresIdentity(runtime, expectedDatabase)
  if (identity.connectedDatabase !== expectedDatabase) {
    throw new Error(`SAFETY: connected to ${identity.connectedDatabase}, expected ${expectedDatabase}`)
  }
  return identity
}

// ---------------------------------------------------------------------------
// T15E producer provenance (Task81): PRIVATE exact-handle allocation registry
// ---------------------------------------------------------------------------
// WeakMap keyed on the EXACT runtime object createOwnedRuntime returned; the
// immutable record is written ONLY on the successful allocation path inside
// this module. Exposed surface is lookup/mint + synchronous revocation —
// there is NO unrestricted registration: plain OwnedRuntime-shaped objects,
// clones (different identity), and foreign handles all miss the WeakMap.

interface T15EOwnedRuntimeAllocationRecord {
  runId: string
  rootDir: string
  dataDir: string
  logsDir: string
  databasePort: number
  database: string
  databasePassword: string
  postmasterPid: number | null
}

const t15eOwnedRuntimeAllocations = new WeakMap<object, Readonly<T15EOwnedRuntimeAllocationRecord>>()
/**
 * Task111 producer-PRIVATE observed startup record. Written ONLY inside the
 * internally owned startPostgres path, from the internally read owned
 * postmaster.pid plus the frozen allocation identity (data dir / port / root).
 * The canonical immutable allocation above remains the allocation (its
 * postmasterPid stays null); this record is the DISTINCT observed process
 * identity. runtime.postmasterPid (mutable, caller-visible) is NEVER a
 * source. Dropped synchronously at revocation, so cloned/foreign/revoked
 * handles — and any runtime mutation — can never produce a usable lookup.
 */
interface T15EObservedStartupRecord {
  runId: string
  rootDir: string
  dataDir: string
  databasePort: number
  postmasterPid: number
  startTimeEpochSeconds: number
}
const t15eObservedStartup = new WeakMap<object, Readonly<T15EObservedStartupRecord>>()
const t15eRevokedOwnedRuntimes = new WeakSet<object>()
/** Task82: producer-PRIVATE minted-capability registry. Membership is set
 *  ONLY inside mintT15EOwnedRuntimeCapability after the exact-handle record
 *  lookup — the sole authority. Exported surface is the READ-ONLY validator
 *  below: no registration, no brand/token any caller can copy, transfer, or
 *  inherit (structural clones, Object.create inheritance, and descriptor
 *  copies all fail the WeakSet identity check). */
const t15eMintedCapabilities = new WeakSet<object>()
/** Exact paths-object -> runtime handle binding (mutation-proof identity). */
const t15ePathsToRuntime = new WeakMap<object, object>()
/** Bound root dir -> runtime handle (string-exact, allocation-time value). */
const t15eBoundRoots = new Map<string, object>()
/** Task83 ACTIVE revocation: allocation live flags (capability -> runtime
 *  -> live record); membership alone is insufficient — liveness is checked. */
const t15eCapabilityToRuntime = new WeakMap<object, object>()
const t15eAllocationLive = new WeakMap<object, boolean>()
const t15eRevocationListeners = new WeakMap<object, Array<() => void>>()

/** READ-ONLY identity validator (transport uses this; nothing can mint). */
export function isProducerMintedT15ECapability(value: unknown): boolean {
  return typeof value === 'object' && value !== null && t15eMintedCapabilities.has(value)
}

/** READ-ONLY liveness: a minted capability whose allocation is STILL live
 *  (revocation — via stop/remove entry or explicit revoke — flips it). */
export function isT15ECapabilityLive(capability: unknown): boolean {
  if (typeof capability !== 'object' || capability === null) return false
  if (!t15eMintedCapabilities.has(capability)) return false
  const runtime = t15eCapabilityToRuntime.get(capability)
  if (runtime === undefined) return false
  return t15eAllocationLive.get(runtime) === true
}

export interface T15ERevocationSubscription {
  unsubscribe(): void
}

/** READ-ONLY diagnostics: number of subscriber callback references RETAINED
 *  for this capability's allocation (evidence for lifecycle tests; exposes no
 *  setter and no callbacks — a plain count cannot leak them). */
export function t15eRevocationSubscriberCountForDiagnostics(capability: unknown): number {
  if (typeof capability !== 'object' || capability === null) return 0
  if (!t15eMintedCapabilities.has(capability)) return 0
  const runtime = t15eCapabilityToRuntime.get(capability)
  if (runtime === undefined) return 0
  return t15eRevocationListeners.get(runtime)?.length ?? 0
}

/** Subscribe to the revocation of the allocation a MINTED, STILL-LIVE
 *  capability belongs to. Identity-checked and liveness-checked: forged
 *  capabilities AND already-revoked allocations are a DEFINED rejection
 *  (null) — no entry is retained for either. Unsubscribe RELEASES the
 *  callback reference (splices it out); no registry setter is exposed. */
export function subscribeToT15ERevocation(
  capability: unknown,
  listener: () => void,
): T15ERevocationSubscription | null {
  if (typeof capability !== 'object' || capability === null) return null
  if (!t15eMintedCapabilities.has(capability)) return null
  const runtime = t15eCapabilityToRuntime.get(capability)
  if (runtime === undefined) return null
  if (t15eAllocationLive.get(runtime) !== true) return null // already revoked
  const list = t15eRevocationListeners.get(runtime) ?? []
  list.push(listener)
  t15eRevocationListeners.set(runtime, list)
  // Task85 (relay): each handle is an IDEMPOTENT ONE-SHOT — a repeated
  // unsubscribe removes nothing more, so subscribing the SAME function twice
  // can never let one handle remove the other handle's entry. Revocation
  // keeps its detached-batch semantics (accepted by review).
  let unsubscribed = false
  return {
    unsubscribe() {
      if (unsubscribed) return
      unsubscribed = true
      // RELEASE the callback reference — not merely deactivate it.
      const current = t15eRevocationListeners.get(runtime)
      if (current === undefined) return
      const index = current.indexOf(listener)
      if (index >= 0) current.splice(index, 1)
      if (current.length === 0) t15eRevocationListeners.delete(runtime)
    },
  }
}

/** Mint a capability ONLY for an exact, live, producer-created handle. */
export function mintT15EOwnedRuntimeCapability(handle: unknown): T15EOwnedRuntimeCapability | null {
  if (typeof handle !== 'object' || handle === null) return null
  const record = t15eOwnedRuntimeAllocations.get(handle)
  if (record === undefined || t15eRevokedOwnedRuntimes.has(handle)) return null
  const capability = {
    kind: 'T15E_OWNED_RUNTIME_CAPABILITY' as const,
    cluster: {
      runId: record.runId,
      dataDirectory: record.dataDir,
      databasePort: record.databasePort,
      database: record.database,
      postmasterPid: record.postmasterPid,
    },
    databasePassword: record.databasePassword,
  } as T15EOwnedRuntimeCapability
  // Authority is the producer-private WeakSet membership on this EXACT
  // object — set only here, after the exact-handle record lookup. No symbol,
  // no brand, nothing copyable or inheritable.
  t15eMintedCapabilities.add(capability)
  t15eCapabilityToRuntime.set(capability, handle)
  Object.freeze(capability.cluster)
  Object.freeze(capability)
  return capability
}

/** Synchronously revoke every capability derived from this handle (teardown
 *  entry). Idempotent; never throws; revocation precedes any await. The live
 *  flag flips FIRST, then every subscriber is notified INDEPENDENTLY guarded —
 *  one throwing listener can never skip the rest. */
export function revokeOwnedRuntimeT15ECapabilities(handle: unknown): void {
  if (typeof handle !== 'object' || handle === null) return
  t15eRevokedOwnedRuntimes.add(handle)
  if (t15eAllocationLive.get(handle) !== true) return // already revoked: notify once
  t15eAllocationLive.set(handle, false)
  // Task111: the privately observed startup identity dies with revocation —
  // synchronously, before any notification or later-failing teardown step.
  t15eObservedStartup.delete(handle)
  // DETACH the list BEFORE notifying: concurrent or reentrant changes during
  // notification can neither retain nor skip entries (a reentrant subscribe
  // hits the not-live rejection above instead).
  const listeners = t15eRevocationListeners.get(handle)
  if (listeners === undefined) return
  t15eRevocationListeners.delete(handle)
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // Independently guarded: a bad listener never skips the remaining ones.
    }
  }
}

/**
 * PURE read-only comparison helper (no registry access, mints nothing):
 * binds an observed startup record to (a) the CURRENT internally re-read
 * pidfile PID — a stopped/restarted/reused cluster fails — and (b), when a
 * SQL probe result is supplied, the SQL-OBSERVABLE fields only. The probe SQL
 * does NOT observe the postmaster PID; no PID equality is ever claimed from
 * SQL. Used only by the private probe below; exported solely for tests of
 * the comparison logic.
 */
export function verifyT15EObservedStartupBinding(input: {
  observed: { dataDir: string; databasePort: number; postmasterPid: number; startTimeEpochSeconds: number }
  pidfileNow: T15EOwnedPostmasterIdentity | null
  probe: { dataDirectory: string; databasePort: number } | null
}): { ok: true } | { ok: false; category: 'T15E_STDIN_NOT_OWNED' | 'T15E_STDIN_CLUSTER_MISMATCH' } {
  const pid = input.observed.postmasterPid
  const startTime = input.observed.startTimeEpochSeconds
  const observedPort = input.observed.databasePort
  // The comparison helper itself rejects unsafe/non-finite/range-invalid
  // INJECTED values — safety does not depend on the parser having run first.
  if (typeof pid !== 'number' || !Number.isFinite(pid) || !Number.isSafeInteger(pid) || pid < 1 || pid > MAX_SIGNED_32BIT_PID ||
      typeof startTime !== 'number' || !Number.isFinite(startTime) || !Number.isSafeInteger(startTime) || startTime < 1 ||
      typeof observedPort !== 'number' || !Number.isInteger(observedPort) || observedPort < MIN_TCP_PORT || observedPort > MAX_TCP_PORT ||
      typeof input.observed.dataDir !== 'string' || input.observed.dataDir === '') {
    return { ok: false, category: 'T15E_STDIN_NOT_OWNED' }
  }
  // FULL generation comparison across re-reads: same PID with a NEW start
  // (changed timestamp) fails exactly like a changed PID, dir, or port.
  // Honest limits: this is observed FILE identity, not hostile-process proof;
  // OS PID-reuse windows beyond the pidfile's own lifetime remain.
  if (input.pidfileNow === null ||
      !Number.isFinite(input.pidfileNow.postmasterPid) || !Number.isSafeInteger(input.pidfileNow.postmasterPid) ||
      input.pidfileNow.postmasterPid !== pid ||
      !Number.isFinite(input.pidfileNow.startTimeEpochSeconds) || !Number.isSafeInteger(input.pidfileNow.startTimeEpochSeconds) ||
      input.pidfileNow.startTimeEpochSeconds !== startTime ||
      !Number.isInteger(input.pidfileNow.port) ||
      input.pidfileNow.port !== observedPort ||
      input.pidfileNow.dataDirectory !== input.observed.dataDir) {
    return { ok: false, category: 'T15E_STDIN_CLUSTER_MISMATCH' }
  }
  if (input.probe !== null) {
    if (input.probe.dataDirectory !== input.observed.dataDir ||
        !Number.isSafeInteger(input.probe.databasePort) ||
        input.probe.databasePort !== observedPort) {
      return { ok: false, category: 'T15E_STDIN_CLUSTER_MISMATCH' }
    }
  }
  return { ok: true }
}

/**
 * PURE injected-current-identity comparator (finding 1): a probe holding a
 * captured observed startup record stays valid ONLY while the registry still
 * holds the EXACT same record object and the allocation is live. A concurrent
 * successful start REPLACING the record (even with identical field values)
 * defeats the old probe. Data-only result; no registry access, no setter.
 */
export function verifyT15EObservedStartupFreshness(input: {
  current: unknown
  captured: unknown
  live: boolean
}): { ok: true } | { ok: false; category: 'T15E_STDIN_NOT_OWNED' } {
  // The captured value must be a non-null OBJECT before identity/liveness
  // mean anything: absent captures (null/undefined) and primitives are
  // invalid even when current matches them exactly — reference equality is
  // only meaningful between record objects. (No shape validation: any
  // non-null object is accepted as the record contract.)
  if (typeof input.captured !== 'object' || input.captured === null) {
    return { ok: false, category: 'T15E_STDIN_NOT_OWNED' }
  }
  if (input.live !== true) return { ok: false, category: 'T15E_STDIN_NOT_OWNED' }
  if (input.current !== input.captured) return { ok: false, category: 'T15E_STDIN_NOT_OWNED' }
  return { ok: true }
}

/** Probe-only. Not exported and not called by runners. Not a mint. */
async function probeOwnedClusterIdentity(handle: unknown, deadlineEpochMs: number): Promise<{ ok: false; category: string } | { ok: true; authority: 'NONE' }> {
  if (typeof handle !== 'object' || handle === null || t15eAllocationLive.get(handle) !== true) return { ok: false, category: 'T15E_STDIN_NOT_OWNED' }
  const record = t15eOwnedRuntimeAllocations.get(handle)
  // The DISTINCT private observed startup record is required: a frozen
  // allocation alone (postmasterPid null) or a revoked handle binds nothing.
  const observed = t15eObservedStartup.get(handle)
  if (record === undefined || observed === undefined) return { ok: false, category: 'T15E_STDIN_NOT_OWNED' }
  if (typeof deadlineEpochMs !== 'number' || !Number.isFinite(deadlineEpochMs) || !(deadlineEpochMs > Date.now())) return { ok: false, category: 'T15E_STDIN_NOT_OWNED' }
  // Task114 finding 1: OBSERVED-RECORD freshness. The exact captured record
  // object must STILL be the registry's current one after every awaited
  // boundary — a concurrent successful start that REPLACED the record defeats
  // this probe even if every pidfile field still matches. Allocation-record
  // equality during startup is a different check and is NOT this guarantee.
  const stillCurrent = () => t15eAllocationLive.get(handle) === true && t15eObservedStartup.get(handle) === observed
  // Task112: absolute finite deadline captured above gates BOTH identity
  // reads — before spawn and before final publication. Each read is bounded
  // independently by an owned timer (a hanging read cannot stretch the
  // deadline; no promise-cancellation fiction — the real timer is cleared on
  // success and a late read result is discarded by the race).
  const clock = { nowEpochMs: () => Date.now() }
  const arm = (ms: number) => {
    let timer: NodeJS.Timeout | undefined
    let release: () => void = () => undefined
    const fired = new Promise<void>((resolve) => { release = resolve })
    timer = setTimeout(release, ms)
    return { fired, cancel() { if (timer !== undefined) clearTimeout(timer) } }
  }
  const before = await boundedOwnedRead({
    deadlineEpochMs,
    clock,
    arm,
    read: () => readOwnedPostmasterIdentity(record.dataDir, { dataDir: record.dataDir, databasePort: record.databasePort }),
  })
  if (!before.ok) return { ok: false, category: before.category }
  if (!before.value.ok || !verifyT15EObservedStartupBinding({ observed, pidfileNow: before.value.identity, probe: null }).ok) {
    return { ok: false, category: 'T15E_STDIN_CLUSTER_MISMATCH' }
  }
  // OWN post-await gate after the FIRST bounded read, BEFORE any spawn: the
  // helper's internal checks are not sufficient once control returned here.
  if (!(deadlineEpochMs > clock.nowEpochMs())) return { ok: false, category: 'T15E_STDIN_DEADLINE' }
  const plan = buildT15EPrivateStdinInvocation({
    dataDirectory: observed.dataDir,
    databasePort: observed.databasePort,
    database: record.database,
    databasePassword: record.databasePassword,
  })
  // Freshness recheck immediately before spawn (plan build is synchronous,
  // so this sits after the read await with no gap to the spawn).
  if (!plan.ok || !stillCurrent()) return { ok: false, category: 'T15E_STDIN_NOT_OWNED' }
  const child = spawn(path.join(PG_BIN, plan.executableName), plan.argv, { env: plan.env as NodeJS.ProcessEnv, stdio: ['pipe', 'pipe', 'pipe'] })
  if (child.stdin === null || child.stdout === null || child.stderr === null) {
    child.kill('SIGKILL')
    return { ok: false, category: 'T15E_STDIN_STREAM_FAILED' }
  }
  const ran = await runT15EPrivateStdinChild({
    child: child as unknown as Parameters<typeof runT15EPrivateStdinChild>[0]['child'],
    stdin: Buffer.from(plan.probeSql, 'utf8'),
    deadlineEpochMs,
    clock: { nowEpochMs: () => Date.now() },
    scheduleTimer: (ms) => {
      let timer: NodeJS.Timeout | undefined
      let release: () => void = () => undefined
      const fired = new Promise<void>((resolve) => { release = resolve })
      timer = setTimeout(release, ms)
      return { ms, fired, cancel() { if (timer !== undefined) clearTimeout(timer) } }
    },
    maxStdoutBytes: 4096,
    maxStderrBytes: 1024,
    cleanupBudgetMs: 50,
  })
  if (!stillCurrent() || !ran.ok) return { ok: false, category: 'T15E_STDIN_NOT_OWNED' }
  // Late-revocation / reuse guard: bounded identity re-read after the awaited
  // child run, before trusting the SQL frame or publishing anything.
  const after = await boundedOwnedRead({
    deadlineEpochMs,
    clock,
    arm,
    read: () => readOwnedPostmasterIdentity(record.dataDir, { dataDir: record.dataDir, databasePort: record.databasePort }),
  })
  if (!after.ok) return { ok: false, category: after.category }
  // Final freshness recheck AFTER the last await: only synchronous steps
  // remain until publication, so a superseded record cannot slip through.
  if (!stillCurrent()) return { ok: false, category: 'T15E_STDIN_NOT_OWNED' }
  // OWN post-await gate after the SECOND bounded read, BEFORE final
  // publication: a continuation whose clock expired past the captured
  // deadline never publishes verified data.
  if (!(deadlineEpochMs > clock.nowEpochMs())) return { ok: false, category: 'T15E_STDIN_DEADLINE' }
  // Verified data is compared against BOTH the frozen allocation identity
  // (with the observed PID as its process component — never a caller value)
  // AND the private observed startup record's SQL-observable fields.
  const matched = matchT15EPrivateProbe({
    dataDir: record.dataDir,
    databasePort: record.databasePort,
    database: record.database,
    postmasterPid: observed.postmasterPid,
  }, ran.result)
  if (!matched.ok) return { ok: false, category: matched.category }
  const bound = verifyT15EObservedStartupBinding({ observed, pidfileNow: after.value.ok ? after.value.identity : null, probe: ran.result })
  if (!bound.ok) return { ok: false, category: bound.category }
  return { ok: true, authority: 'NONE' }
}
void probeOwnedClusterIdentity

export async function ensureOwnedDatabase(runtime: OwnedRuntime): Promise<void> {
  const existing = await psqlQuery(
    runtime,
    'postgres',
    `select datname from pg_database where datname = '${REQUIRED_DATABASE_NAME}'`,
  )
  if (existing === REQUIRED_DATABASE_NAME) {
    throw new Error(`SAFETY: ${REQUIRED_DATABASE_NAME} already exists in a freshly initialized cluster — aborting instead of reusing it`)
  }
  await psqlQuery(runtime, 'postgres', `create database "${REQUIRED_DATABASE_NAME}"`)
}

export async function stopPostgres(runtime: OwnedRuntime): Promise<void> {
  // Task81: revocation is SYNCHRONOUS at the teardown entry — before any
  // await and before any failure can short-circuit the stop path — so no
  // capability derived from this runtime stays live once stopping begins.
  revokeOwnedRuntimeT15ECapabilities(runtime)
  const pid = await readPostmasterPid(runtime.paths.dataDir)
  if (pid === null) return
  if (runtime.postmasterPid !== null && pid !== runtime.postmasterPid) {
    throw new Error(`SAFETY: postmaster.pid PID ${pid} does not match the started PID ${runtime.postmasterPid}; refusing to touch it`)
  }
  await run(path.join(PG_BIN, 'pg_ctl'), [
    '-D', runtime.paths.dataDir,
    '-m', 'fast',
    '-w', '-t', '60',
    'stop',
  ], PG_ENV_BASE, 90_000)
  runtime.postmasterPid = null
}

/** Remove ONLY the owned tmp root. Evidence directories live outside it.
 *
 * Task82: the associated producer allocation is revoked SYNCHRONOUSLY at the
 * entry — before any await and even when the removal itself later throws —
 * WITHOUT requiring stopPostgres first. Revocation is keyed on the EXACT
 * paths object identity recorded at allocation; a cloned paths object or a
 * mutated rootDir can neither revoke the wrong runtime nor remove another
 * runtime's bound root (both are refused with a SAFETY error). `rmImpl` is a
 * test seam only (defaults to the real fs.rm). */
export async function removeOwnedRuntimeRoot(
  paths: NativeRuntimePaths,
  rmImpl: (target: string, options: { recursive: true; force: true }) => Promise<void> = (target, options) =>
    fs.rm(target, options),
): Promise<void> {
  const boundRuntime = t15ePathsToRuntime.get(paths)
  if (boundRuntime !== undefined) {
    // Synchronous revocation FIRST: even a failing removal has revoked.
    revokeOwnedRuntimeT15ECapabilities(boundRuntime)
    const record = t15eOwnedRuntimeAllocations.get(boundRuntime)
    if (record !== undefined && record.rootDir !== paths.rootDir) {
      throw new Error(
        `SAFETY: refusing to remove a mutated runtime path: ${paths.rootDir} is not the allocated ${record.rootDir}`,
      )
    }
  }
  const rootClaimant = t15eBoundRoots.get(paths.rootDir)
  if (rootClaimant !== undefined && rootClaimant !== boundRuntime) {
    // This root belongs to ANOTHER live allocation reached via a cloned or
    // forged paths object: refuse removal (and no wrong revocation happened).
    throw new Error(`SAFETY: refusing to remove another runtime's bound root: ${paths.rootDir}`)
  }
  if (!path.basename(paths.rootDir).startsWith('business-test-')) {
    throw new Error(`SAFETY: refusing to remove a non-owned runtime dir: ${paths.rootDir}`)
  }
  await rmImpl(paths.rootDir, { recursive: true, force: true })
  // Task83 P2: release the strong root binding ONLY after a SUCCESSFUL
  // removal (retain on failure so a later retry still finds the binding).
  if (t15eBoundRoots.get(paths.rootDir) === boundRuntime) {
    t15eBoundRoots.delete(paths.rootDir)
  }
}

/**
 * Compensation for pre-start construction failures: removes a runtime root
 * ONLY when exact ownership is known — the root was produced by THIS runner's
 * own mkdtemp (createOwnedRuntimeRoot) and is named after THIS run id, and no
 * postmaster/app/mail was ever started from it (startPostgres is only invoked
 * by the runner AFTER createOwnedRuntime returns successfully). Returns false
 * (removing nothing) whenever ownership is not exactly this run's.
 */
export async function removeFreshlyAllocatedRuntimeRoot(paths: NativeRuntimePaths, runId: string): Promise<boolean> {
  if (!path.basename(paths.rootDir).startsWith(`${runId}-`)) return false
  await removeOwnedRuntimeRoot(paths)
  return true
}

export interface CreateOwnedRuntimeInput {
  parentDir: string
}

export async function createOwnedRuntime(
  input: CreateOwnedRuntimeInput,
  probe: LifecycleProbe = isPortListening,
): Promise<OwnedRuntime> {
  // Ambient preflight BEFORE any allocation (run id, ports, runtime dirs):
  // a runner environment carrying protected keys is rejected without having
  // created anything that would then need cleaning up.
  assertNoProtectedAmbientKeys(process.env)
  const runId = createRunId()
  const ports = await allocateDistinctLoopbackPorts(probe)
  for (const port of [ports.databasePort, ports.serverPort, ports.mailPort]) {
    if (FORBIDDEN_SHARED_PORTS.has(port)) throw new Error(`SAFETY: allocator picked forbidden shared port ${port}`)
  }
  const paths = await createOwnedRuntimeRoot(input.parentDir, runId)
  try {
    const databasePassword = generateDatabasePassword()
    const e2ePassword = generateE2ePassword()
    const resource: OwnedDisposableResource = {
      runId,
      containerName: `${runId}-postgres`,
      databaseName: REQUIRED_DATABASE_NAME,
      databasePort: ports.databasePort,
      serverPort: ports.serverPort,
    }
    const allowlist = buildOutboundAllowlistSpec({
      ports,
      unixSocketPrefixes: [paths.socketDir],
    })
    const allowlistEnv = formatAllowlistEnv(allowlist)
    const databaseUrl = `postgresql://postgres:${encodeURIComponent(databasePassword)}@127.0.0.1:${ports.databasePort}/${REQUIRED_DATABASE_NAME}?schema=public`
    const appEnv = buildAppEnvironment({ runId, ports, paths, databaseUrl, e2ePassword, allowlistEnv })
    const runtime: OwnedRuntime = {
      runId,
      resource,
      ports,
      paths,
      databasePassword,
      e2ePassword,
      databaseUrl,
      allowlist,
      allowlistEnv,
      postmasterPid: null,
      appEnv,
    }
    // Task81 producer provenance: record THIS exact handle in the private
    // allocation registry on the successful allocation path ONLY. The frozen
    // snapshot (not the mutable runtime fields) is the source of truth for
    // capability derivation; revocation is a separate live-flag WeakSet.
    t15ePathsToRuntime.set(paths, runtime)
    t15eBoundRoots.set(paths.rootDir, runtime)
    t15eAllocationLive.set(runtime, true)
    t15eOwnedRuntimeAllocations.set(
      runtime,
      Object.freeze({
        runId,
        rootDir: paths.rootDir,
        dataDir: paths.dataDir,
        logsDir: paths.logsDir,
        databasePort: ports.databasePort,
        database: REQUIRED_DATABASE_NAME,
        databasePassword,
        postmasterPid: null,
      }),
    )
    return runtime
  } catch (error) {
    // Pre-start construction failure: nothing was ever started from this root
    // (no postmaster/app/mail — those are runner phases after this function),
    // and the root is exactly this run's mkdtemp allocation, so compensate by
    // removing it instead of leaking it into the owned tmp parent.
    try {
      await removeFreshlyAllocatedRuntimeRoot(paths, runId)
    } catch {
      // Compensation failed: surface the ORIGINAL construction error. Any
      // residual dir stays inside the 0700 owned tmp parent, named after the
      // run id, for manual cleanup.
    }
    throw error
  }
}

const APP_ENV_ALLOWLIST_KEYS = [
  'DATABASE_URL',
  'NEXTAUTH_SECRET',
  'NEXTAUTH_URL',
  'AUTH_TRUST_HOST',
  'UPLOAD_DIR',
  'NEXT_TELEMETRY_DISABLED',
  'NODE_OPTIONS',
  'BUSINESS_NET_ALLOWLIST',
  'BUSINESS_NET_BLOCK_LOG',
  'BUSINESS_MAIL_HOST',
  'BUSINESS_MAIL_PORT',
  'BUSINESS_E2E_PASSWORD',
  'BUSINESS_APP_DIR',
] as const

/**
 * Fail-closed ambient preflight: the runner's OWN environment must not carry
 * protected keys (DATABASE_URL / SMTP_* / CLEAN_START_CI_DATABASE_URL) whose
 * values could leak into spawned processes. Key NAMES are inspected only —
 * values are never read. The owned DATABASE_URL handed to the app is
 * explicitly generated by buildAppEnvironment (see APP_ENV_ALLOWLIST_KEYS)
 * and is not ambient, so it is not covered by this check.
 */
export function assertNoProtectedAmbientKeys(env: Record<string, string | undefined>): void {
  assertNoProtectedEnvironmentKeys(env as Record<string, string>)
}

export function buildAppEnvironment(input: {
  runId: string
  ports: OwnedPorts
  paths: NativeRuntimePaths
  databaseUrl: string
  e2ePassword: string
  allowlistEnv: string
}): Record<string, string> {
  const explicit: Record<string, string> = {
    DATABASE_URL: input.databaseUrl,
    NEXTAUTH_SECRET: `business-test-only-${generateDatabasePassword()}`,
    NEXTAUTH_URL: `http://127.0.0.1:${input.ports.serverPort}`,
    AUTH_TRUST_HOST: 'true',
    UPLOAD_DIR: path.join(input.paths.rootDir, 'uploads'),
    NEXT_TELEMETRY_DISABLED: '1',
    NODE_OPTIONS: '',
    BUSINESS_NET_ALLOWLIST: input.allowlistEnv,
    BUSINESS_NET_BLOCK_LOG: path.join(input.paths.logsDir, 'blocked-connections.jsonl'),
    BUSINESS_MAIL_HOST: '127.0.0.1',
    BUSINESS_MAIL_PORT: String(input.ports.mailPort),
    BUSINESS_E2E_PASSWORD: input.e2ePassword,
  }
  // `explicit` deliberately carries the runner-generated OWNED DATABASE_URL
  // (APP_ENV_ALLOWLIST_KEYS allows exactly that key); the ambient environment
  // is what must never carry protected keys — checked by
  // assertNoProtectedAmbientKeys(process.env) in createOwnedRuntime.
  for (const key of Object.keys(explicit)) {
    if (!(APP_ENV_ALLOWLIST_KEYS as readonly string[]).includes(key)) {
      throw new Error(`SAFETY: unexpected app env key ${key}`)
    }
  }
  return explicit
}

/**
 * `next dev` restarts itself once V8's heap passes 80% of its limit, which is
 * about 4 GB by default. A long matrix profile gets there and the restart cuts
 * the page the browser is loading (RRM-012). A ceiling of 8 GB moves the
 * restart point past the end of a profile without reserving that memory.
 */
export const APP_MAX_OLD_SPACE_MB = 8192

export function finalizeAppEnvironment(
  runtime: OwnedRuntime,
  appDir: string,
  preloadPath: string,
): Record<string, string> {
  const env = { ...runtime.appEnv }
  env.NODE_OPTIONS = `--max-old-space-size=${APP_MAX_OLD_SPACE_MB} --require ${preloadPath}`
  env.BUSINESS_APP_DIR = appDir
  return env
}

export { createRunId }
