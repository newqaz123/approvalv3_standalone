/**
 * T15E private stdin protocol (Task108). Data and child-handle protocol only.
 * This module does not spawn, mint, or accept a spawn driver. A caller-built
 * record is not producer authority. Child exit is never backend-gone.
 */

import type { T15EArmedTimer, T15EClock, T15ETimerScheduler } from './t15e-overlap-lifecycle'

export const T15E_PRIVATE_STDIN_SAFE_MESSAGE = 'T15E private stdin failure'
export const T15E_PRIVATE_STDIN_OBLIGATIONS = [
  'NO_MINT',
  'NO_EXPORTED_SPAWN_DRIVER',
  'STDIN_NOT_ARGV',
  'CHILD_EXIT_IS_NOT_BACKEND_GONE',
  'NOT_AUTHENTICATED_ISSUANCE',
] as const

const SECRET_RE = /^[A-Za-z0-9_-]{24,128}$/
const SUPPORTED_PG_MAJORS = Object.freeze([15, 16])
const FORBIDDEN_PORTS = new Set([3100, 5432])
const BEGIN = 'T15E_STDIN_B1\n'
const END_MARK = '\nT15E_STDIN_E1:'

export const T15E_PRIVATE_PROBE_SQL =
  "select 'T15E_STDIN_B1';\n" +
  "select jsonb_build_object('dataDirectory', current_setting('data_directory'), 'databasePort', current_setting('port')::int, 'databaseName', current_database(), 'serverVersionNum', current_setting('server_version_num')::int)::text;\n" +
  "select 'T15E_STDIN_E1:' || octet_length(convert_to((select jsonb_build_object('dataDirectory', current_setting('data_directory'), 'databasePort', current_setting('port')::int, 'databaseName', current_database(), 'serverVersionNum', current_setting('server_version_num')::int)::text), 'UTF8'));\n"

export type T15EPrivateStdinFailureCategory =
  | 'T15E_STDIN_MALFORMED'
  | 'T15E_STDIN_DEADLINE'
  | 'T15E_STDIN_WRITE_FAILED'
  | 'T15E_STDIN_FRAME_INVALID'
  | 'T15E_STDIN_EXIT_FAILED'
  | 'T15E_STDIN_STDERR_OVERFLOW'
  | 'T15E_STDIN_STDOUT_OVERFLOW'
  | 'T15E_STDIN_STREAM_FAILED'
  | 'T15E_STDIN_CLEANUP_UNCONFIRMED'
  | 'T15E_STDIN_TIMER_FAILED'
  | 'T15E_STDIN_CLUSTER_MISMATCH'
  | 'T15E_STDIN_SERVER_VERSION'

export interface T15EPrivateStdinChild {
  stdin: {
    write(chunk: Buffer, callback: (error?: Error | null) => void): void
    end(): void
    on(event: 'error', listener: (error: Error) => void): void
    off(event: 'error', listener: (error: Error) => void): void
    on(event: 'close', listener: () => void): void
    off(event: 'close', listener: () => void): void
  }
  stdout: {
    on(event: 'data', listener: (chunk: Buffer) => void): void
    off(event: 'data', listener: (chunk: Buffer) => void): void
    on(event: 'error', listener: (error: Error) => void): void
    off(event: 'error', listener: (error: Error) => void): void
    on(event: 'close', listener: () => void): void
    off(event: 'close', listener: () => void): void
  }
  stderr: {
    on(event: 'data', listener: (chunk: Buffer) => void): void
    off(event: 'data', listener: (chunk: Buffer) => void): void
    on(event: 'error', listener: (error: Error) => void): void
    off(event: 'error', listener: (error: Error) => void): void
    on(event: 'close', listener: () => void): void
    off(event: 'close', listener: () => void): void
  }
  on(event: 'error' | 'close', listener: (first?: unknown, second?: unknown) => void): void
  off(event: 'error' | 'close', listener: (first?: unknown, second?: unknown) => void): void
  kill(signal: 'SIGTERM' | 'SIGKILL'): void
}

type Probe = {
  dataDirectory: string
  databasePort: number
  databaseName: string
  serverVersionNum: number
}

function fail(category: T15EPrivateStdinFailureCategory, childExited: boolean) {
  return {
    ok: false as const,
    category,
    message: T15E_PRIVATE_STDIN_SAFE_MESSAGE,
    backendGoneConfirmed: false as const,
    childExited,
  }
}

/** Independently guarded operation: one throwing removal never skips the rest. */
function guarded(op: () => void): void {
  try { op() } catch { /* guarded on purpose */ }
}

/**
 * Minimal terminal error sink kept until the stream's real close event. The
 * sink consumes the 'error' event so a late stream failure cannot escape as
 * an unhandled error, retains no payload state (module-level helper: the sink
 * captures only the target handle, never executor payload scope), and removes
 * itself on close. Targets already closed emit nothing further, so no sink is
 * installed on them.
 */
type T15ETerminalSinkTarget = {
  on(event: 'error', listener: (error: Error) => void): void
  on(event: 'close', listener: () => void): void
  off(event: 'error', listener: (error: Error) => void): void
  off(event: 'close', listener: () => void): void
}

function installStreamTerminalErrorSink(stream: T15ETerminalSinkTarget, alreadyClosed: boolean): void {
  if (alreadyClosed) return
  const onError = () => undefined
  const onClose = () => {
    guarded(() => { stream.off('error', onError) })
    guarded(() => { stream.off('close', onClose) })
  }
  guarded(() => { stream.on('error', onError) })
  guarded(() => { stream.on('close', onClose) })
}

/**
 * Same minimal terminal sink for the child handle (its 'error' can fire from
 * our own kill calls); module-level so it never captures payload scope.
 */
function installChildTerminalErrorSink(child: T15EPrivateStdinChild, alreadyClosed: boolean): void {
  if (alreadyClosed) return
  const onError = () => undefined
  const onClose = () => {
    guarded(() => { child.off('error', onError) })
    guarded(() => { child.off('close', onClose) })
  }
  guarded(() => { child.on('error', onError) })
  guarded(() => { child.on('close', onClose) })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function supportedVersion(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 100000) return false
  return (SUPPORTED_PG_MAJORS as readonly number[]).includes(Math.floor(value / 10000))
}

export function buildT15EPrivateStdinInvocation(record: unknown): {
  ok: true
  authority: 'NONE'
  executableName: 'psql'
  argv: string[]
  env: Record<string, string>
  probeSql: string
} | { ok: false; category: 'T15E_STDIN_MALFORMED'; message: string; authority: 'NONE' } {
  if (!isRecord(record)) return { ok: false, category: 'T15E_STDIN_MALFORMED', message: T15E_PRIVATE_STDIN_SAFE_MESSAGE, authority: 'NONE' }
  const keys = Object.keys(record).sort()
  if (keys.join(',') !== 'dataDirectory,database,databasePassword,databasePort') {
    return { ok: false, category: 'T15E_STDIN_MALFORMED', message: T15E_PRIVATE_STDIN_SAFE_MESSAGE, authority: 'NONE' }
  }
  if (typeof record.databasePort !== 'number' || !Number.isInteger(record.databasePort) ||
    record.databasePort < 1 || record.databasePort > 65535 || FORBIDDEN_PORTS.has(record.databasePort)) {
    return { ok: false, category: 'T15E_STDIN_MALFORMED', message: T15E_PRIVATE_STDIN_SAFE_MESSAGE, authority: 'NONE' }
  }
  if (record.database !== 'app_cleanstart_dev' || typeof record.databasePassword !== 'string' || !SECRET_RE.test(record.databasePassword)) {
    return { ok: false, category: 'T15E_STDIN_MALFORMED', message: T15E_PRIVATE_STDIN_SAFE_MESSAGE, authority: 'NONE' }
  }
  if (typeof record.dataDirectory !== 'string' || !record.dataDirectory.startsWith('/')) {
    return { ok: false, category: 'T15E_STDIN_MALFORMED', message: T15E_PRIVATE_STDIN_SAFE_MESSAGE, authority: 'NONE' }
  }
  const env = {
    PGHOST: '127.0.0.1',
    PGPORT: String(record.databasePort),
    PGDATABASE: record.database,
    PGUSER: 'postgres',
    PGPASSWORD: record.databasePassword,
  }
  const argv = ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1']
  return { ok: true, authority: 'NONE', executableName: 'psql', argv, env, probeSql: T15E_PRIVATE_PROBE_SQL }
}

export function matchT15EPrivateProbe(record: unknown, probe: unknown): { ok: true; authority: 'NONE' } | { ok: false; category: T15EPrivateStdinFailureCategory; message: string; authority: 'NONE' } {
  if (!isRecord(record) || record.postmasterPid === null || typeof record.postmasterPid !== 'number') {
    return { ok: false, category: 'T15E_STDIN_CLUSTER_MISMATCH', message: T15E_PRIVATE_STDIN_SAFE_MESSAGE, authority: 'NONE' }
  }
  if (!isProbe(probe)) return { ok: false, category: 'T15E_STDIN_FRAME_INVALID', message: T15E_PRIVATE_STDIN_SAFE_MESSAGE, authority: 'NONE' }
  if (!supportedVersion(probe.serverVersionNum)) {
    return { ok: false, category: 'T15E_STDIN_SERVER_VERSION', message: T15E_PRIVATE_STDIN_SAFE_MESSAGE, authority: 'NONE' }
  }
  if (probe.dataDirectory !== record.dataDir || probe.databasePort !== record.databasePort || probe.databaseName !== record.database) {
    return { ok: false, category: 'T15E_STDIN_CLUSTER_MISMATCH', message: T15E_PRIVATE_STDIN_SAFE_MESSAGE, authority: 'NONE' }
  }
  return { ok: true, authority: 'NONE' }
}

function isProbe(value: unknown): value is Probe {
  if (!isRecord(value)) return false
  const keys = Object.keys(value).sort()
  return keys.join(',') === 'dataDirectory,databaseName,databasePort,serverVersionNum' &&
    typeof value.dataDirectory === 'string' &&
    typeof value.databaseName === 'string' &&
    typeof value.databasePort === 'number' && Number.isInteger(value.databasePort) &&
    supportedVersion(value.serverVersionNum)
}

const BEGIN_BYTES = Buffer.from(BEGIN, 'utf8')
const END_BYTES = Buffer.from(END_MARK, 'utf8')

export function parseT15EPrivateStdinFrame(stdout: Buffer): { ok: true; result: Probe } | { ok: false } {
  // Raw-byte framing: decoding may silently replace malformed UTF-8, so every
  // length and boundary below is measured on the received bytes, never on
  // decoded replacement text.
  if (stdout.length === 0 || stdout[stdout.length - 1] !== 0x0a) return { ok: false }
  if (stdout.length < BEGIN_BYTES.length || !stdout.subarray(0, BEGIN_BYTES.length).equals(BEGIN_BYTES)) return { ok: false }
  const endAt = stdout.indexOf(END_BYTES, BEGIN_BYTES.length)
  if (endAt < BEGIN_BYTES.length) return { ok: false }
  const jsonBytes = stdout.subarray(BEGIN_BYTES.length, endAt)
  const trailerBytes = stdout.subarray(endAt + END_BYTES.length)
  if (trailerBytes.length < 2 || trailerBytes[trailerBytes.length - 1] !== 0x0a) return { ok: false }
  for (let i = 0; i < trailerBytes.length - 1; i++) {
    if (trailerBytes[i] < 0x30 || trailerBytes[i] > 0x39) return { ok: false }
  }
  if (Number(trailerBytes.toString('ascii', 0, trailerBytes.length - 1)) !== jsonBytes.length) return { ok: false }
  const jsonText = jsonBytes.toString('utf8')
  // Strict UTF-8: malformed bytes decode to U+FFFD and cannot round-trip to
  // the identical byte span, so a replacement-length trailer can never pass.
  if (Buffer.compare(Buffer.from(jsonText, 'utf8'), jsonBytes) !== 0) return { ok: false }
  try {
    const parsed = JSON.parse(jsonText) as unknown
    if (!isProbe(parsed)) return { ok: false }
    return { ok: true, result: parsed }
  } catch {
    return { ok: false }
  }
}

export async function runT15EPrivateStdinChild(input: {
  child: T15EPrivateStdinChild
  stdin: Buffer
  deadlineEpochMs: number
  clock: T15EClock
  scheduleTimer: T15ETimerScheduler
  maxStdoutBytes: number
  maxStderrBytes: number
  cleanupBudgetMs: number
}): Promise<
  | { ok: true; authority: 'NONE'; result: Probe; exitCode: 0; backendGoneConfirmed: false; childExited: true }
  | { ok: false; category: T15EPrivateStdinFailureCategory; message: string; backendGoneConfirmed: false; childExited: boolean }
> {
  const { child, clock, scheduleTimer } = input
  // Caller input is captured into primitives/locals exactly once: no later
  // callback may retain the input object (and through it the original stdin
  // buffer the caller passed) transitively. Caller input is never mutated.
  const deadlineEpochMs = input.deadlineEpochMs
  const maxStdoutBytes = input.maxStdoutBytes
  const maxStderrBytes = input.maxStderrBytes
  const cleanupBudgetMs = input.cleanupBudgetMs
  // Payload state is held in mutable slots so every outcome can drop the
  // retained bytes; post-settlement closures must not keep the secret stdin
  // buffer or output chunks alive.
  let stdinPayload: Buffer | null = input.stdin
  const stdoutChunks: Buffer[] = []
  let stdoutBytes = 0
  let stderrBytes = 0
  let closed = false
  let stdinClosed = false
  let stdoutClosed = false
  let stderrClosed = false
  let exitCode: number | null = null
  let writeFailed = false
  let streamFailed = false
  let stdoutOverflow = false
  let stderrOverflow = false
  let stdoutDone = false
  let stderrDone = false
  let timerDisposalFailed = false
  // Wakes the currently active main wait when a terminal stream failure or an
  // overflow latches, so the failure path (and its bounded cleanup) starts
  // immediately instead of blocking until the deadline timer fires.
  let wakeActiveWait: (() => void) | null = null
  const wake = () => { if (wakeActiveWait !== null) wakeActiveWait() }
  const onClose = (code: unknown) => {
    closed = true
    exitCode = typeof code === 'number' ? code : null
  }
  const onStdoutData = (chunk: Buffer) => {
    if (stdoutDone) return
    // Remaining capacity is checked BEFORE retaining: bytes past the limit are
    // never stored, and further output is no longer accepted.
    if (chunk.length > maxStdoutBytes - stdoutBytes) {
      stdoutOverflow = true
      stdoutDone = true
      guarded(() => { child.stdout.off('data', onStdoutData) })
      wake()
      return
    }
    stdoutChunks.push(chunk)
    stdoutBytes += chunk.length
  }
  const onStderrData = (chunk: Buffer) => {
    if (stderrDone) return
    stderrBytes += chunk.length
    if (stderrBytes > maxStderrBytes) {
      stderrOverflow = true
      stderrDone = true
      guarded(() => { child.stderr.off('data', onStderrData) })
      wake()
    }
  }
  const onStdinError = () => {
    writeFailed = true
    wake()
  }
  const onStreamError = () => {
    streamFailed = true
    wake()
  }
  const onStdinClose = () => { stdinClosed = true }
  const onStdoutClose = () => { stdoutClosed = true }
  const onStderrClose = () => { stderrClosed = true }
  let resolveClose: () => void = () => undefined
  const closeWait = new Promise<void>((resolve) => { resolveClose = resolve })
  const onCloseWait = (code: unknown) => { onClose(code); resolveClose() }
  child.on('close', onCloseWait)
  child.stdout.on('data', onStdoutData)
  child.stderr.on('data', onStderrData)
  child.stdin.on('error', onStdinError)
  child.stdout.on('error', onStreamError)
  child.stderr.on('error', onStreamError)
  child.on('error', onStreamError)
  child.stdin.on('close', onStdinClose)
  child.stdout.on('close', onStdoutClose)
  child.stderr.on('close', onStderrClose)

  // Finite, immutable, absolute deadline: a non-finite or past/exact
  // deadline is expired. Checked before every IO, after each async
  // settlement, and immediately before success.
  const expired = () => !(Number.isFinite(deadlineEpochMs) && deadlineEpochMs > clock.nowEpochMs())
  type WaitOutcome = 'value' | 'timeout' | 'error' | 'scheduler-failed' | 'timer-failed'
  const waitFirst = (signal: Promise<void>, budgetMs: number, wakeable = true, onSettle?: () => void): Promise<WaitOutcome> => {
    // Consumers are attached BEFORE any early budget check or scheduler call:
    // exhausted-budget and scheduler-failure paths must never leave a rejected
    // signal unhandled. Consuming a rejection never settles the result.
    const consume = () => undefined
    signal.then(consume, consume)
    if (!(budgetMs > 0)) {
      if (onSettle !== undefined) onSettle()
      return Promise.resolve('timeout')
    }
    let timer: T15EArmedTimer
    try {
      timer = scheduleTimer(budgetMs)
    } catch {
      // Synchronous scheduler failure: a fixed bounded failure, never a throw
      // out of the run and never a success.
      if (onSettle !== undefined) onSettle()
      return Promise.resolve('scheduler-failed')
    }
    return new Promise((resolve) => {
      let settled = false
      let waker: (() => void) | null = null
      const finish = (value: WaitOutcome) => {
        if (settled) return
        settled = true
        if (waker !== null && wakeActiveWait === waker) wakeActiveWait = null
        // Ownership is revoked SYNCHRONOUSLY at settlement, before the result
        // resolves and before any timer disposal finalizer runs.
        if (onSettle !== undefined) onSettle()
        // Resolve BEFORE disposal: the wait settles even if cancel throws.
        // Each finalizer is guarded independently so one throwing cancel can
        // never strand the promise or skip the remaining cleanup.
        resolve(value)
        try { timer.cancel() } catch { timerDisposalFailed = true }
      }
      if (wakeable) {
        waker = () => finish('error')
        wakeActiveWait = waker
        // Replay an already-latched terminal failure: one latched during the
        // synchronous write call (before this registration) must start the
        // failure path immediately instead of waiting for the main deadline.
        if (streamFailed || writeFailed || stdoutOverflow || stderrOverflow) waker()
      }
      signal.then(() => finish('value'), () => finish('error'))
      // A rejecting timer wakes a fixed failure path (owned cleanup); a late
      // rejection after settlement is consumed here and cannot escape.
      timer.fired.then(() => finish('timeout'), () => finish('timer-failed'))
    })
  }
  let cleanupRun: Promise<boolean> | null = null
  const cleanup = async (): Promise<boolean> => {
    if (closed) return true
    try { child.kill('SIGTERM') } catch { streamFailed = true }
    // Cleanup waits are not woken by latched failures: only a real close (or
    // the bounded budget) ends them.
    if (await waitFirst(closeWait, cleanupBudgetMs, false) === 'value' || closed) return true
    try { child.kill('SIGKILL') } catch { streamFailed = true }
    return await waitFirst(closeWait, cleanupBudgetMs, false) === 'value' || closed
  }
  const runCleanup = (): Promise<boolean> => {
    if (cleanupRun === null) cleanupRun = cleanup()
    return cleanupRun
  }
  const detach = () => {
    // BOTH collectors go terminal BEFORE any listener-removal attempt: a
    // throwing off can leave listeners attached, and from here on they must
    // be inert no-ops that cannot rebuild the dropped buffers.
    stdoutDone = true
    stderrDone = true
    // Drop payload refs on every outcome, including unconfirmed cleanup.
    stdoutChunks.length = 0
    stdinPayload = null
    // Independently guarded removals: one bad off never skips the others.
    guarded(() => { child.stdout.off('data', onStdoutData) })
    guarded(() => { child.stdout.off('error', onStreamError) })
    guarded(() => { child.stdout.off('close', onStdoutClose) })
    guarded(() => { child.stderr.off('data', onStderrData) })
    guarded(() => { child.stderr.off('error', onStreamError) })
    guarded(() => { child.stderr.off('close', onStderrClose) })
    guarded(() => { child.stdin.off('error', onStdinError) })
    guarded(() => { child.stdin.off('close', onStdinClose) })
    guarded(() => { child.off('close', onCloseWait) })
    guarded(() => { child.off('error', onStreamError) })
    // Minimal terminal error sinks until each target's real close, and only
    // on targets that are still open (closed targets emit nothing further).
    installStreamTerminalErrorSink(child.stdin, stdinClosed)
    installStreamTerminalErrorSink(child.stdout, stdoutClosed)
    installStreamTerminalErrorSink(child.stderr, stderrClosed)
    installChildTerminalErrorSink(child, closed)
  }

  try {
    if (expired()) {
      const exited = await runCleanup()
      return fail('T15E_STDIN_DEADLINE', exited)
    }
    let writeTimedOut = false
    // Terminal-state ownership of the write callback: once the write wait has
    // settled (or been disposed), a late callback performs no IO, cannot
    // resurrect success, and any late failure is consumed by latching only.
    let writeCallbackLive = true
    let writeCallbackUsed = false
    const wrote = await waitFirst(new Promise<void>((resolve, reject) => {
      try {
        child.stdin.write(stdinPayload as Buffer, (error) => {
          // The deadline is checked immediately BEFORE any end() IO: a
          // callback delivered at or past the deadline performs none.
          if (writeCallbackUsed || !writeCallbackLive || expired()) {
            if (error) writeFailed = true // consumed late failure; no IO, no resurrection
            // Settle a still-pending wait as a fixed failure instead of
            // hanging until the (possibly held) main timer.
            reject(new Error(T15E_PRIVATE_STDIN_SAFE_MESSAGE))
            return
          }
          writeCallbackUsed = true
          if (error) reject(error)
          else {
            try { child.stdin.end(); resolve() } catch (endError) { reject(endError) }
          }
        })
      } catch (error) { reject(error) }
    }), deadlineEpochMs - clock.nowEpochMs(), true, () => { writeCallbackLive = false })
    if (wrote === 'timeout') writeTimedOut = true
    if (wrote !== 'value' || writeFailed || expired()) {
      const exited = await runCleanup()
      if (!exited) return fail('T15E_STDIN_CLEANUP_UNCONFIRMED', false)
      if (streamFailed) return fail('T15E_STDIN_STREAM_FAILED', true)
      if (stdoutOverflow) return fail('T15E_STDIN_STDOUT_OVERFLOW', true)
      if (stderrOverflow) return fail('T15E_STDIN_STDERR_OVERFLOW', true)
      if (wrote === 'scheduler-failed' || wrote === 'timer-failed' || timerDisposalFailed) {
        return fail('T15E_STDIN_TIMER_FAILED', true)
      }
      return fail(writeTimedOut || expired() ? 'T15E_STDIN_DEADLINE' : 'T15E_STDIN_WRITE_FAILED', true)
    }
    const finished = await waitFirst(closeWait, deadlineEpochMs - clock.nowEpochMs())
    // Recheck every latched terminal failure AND the deadline before any
    // success: a late valid frame plus close(0) never overrides an
    // already-latched failure or a clock that already passed the deadline.
    if (finished !== 'value' || streamFailed || writeFailed || stdoutOverflow || stderrOverflow || timerDisposalFailed || expired()) {
      const exited = await runCleanup()
      if (!exited) return fail('T15E_STDIN_CLEANUP_UNCONFIRMED', false)
      if (streamFailed) return fail('T15E_STDIN_STREAM_FAILED', true)
      if (writeFailed) return fail('T15E_STDIN_WRITE_FAILED', true)
      if (stdoutOverflow) return fail('T15E_STDIN_STDOUT_OVERFLOW', true)
      if (stderrOverflow) return fail('T15E_STDIN_STDERR_OVERFLOW', true)
      if (finished === 'scheduler-failed' || finished === 'timer-failed' || timerDisposalFailed) {
        return fail('T15E_STDIN_TIMER_FAILED', true)
      }
      return fail('T15E_STDIN_DEADLINE', true)
    }
    if (exitCode !== 0) return fail('T15E_STDIN_EXIT_FAILED', true)
    const parsed = parseT15EPrivateStdinFrame(Buffer.concat(stdoutChunks))
    if (!parsed.ok) return fail('T15E_STDIN_FRAME_INVALID', true)
    return { ok: true, authority: 'NONE', result: parsed.result, exitCode: 0, backendGoneConfirmed: false, childExited: true }
  } finally {
    detach()
  }
}
