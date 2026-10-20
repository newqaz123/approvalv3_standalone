import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import path from 'node:path'
import { finalizeAppEnvironment, type OwnedRuntime } from './postgres-instance'

/**
 * Import-safe lifecycle utilities for the native business runner (test-only).
 *
 * This module exists so the safety-critical parts of
 * run-native-business-tests.ts (bounded child execution, owned-process
 * tracking, app-process identity/ownership, HTTP readiness with listener
 * ownership) can be imported and regression-tested WITHOUT executing the
 * runner's `main()`. It has no top-level side effects.
 *
 * Ownership model:
 * - one-shot CLI children (rsync/prisma/tsx/playwright) run BOUNDED: they are
 *   SIGKILLed on timeout and spawn errors always settle the promise;
 * - the app is spawned DETACHED as its own process-group leader (pgid == its
 *   pid), so the whole next-dev tree can be stopped by signalling that one
 *   group, and no unrelated pid/group is ever signalled;
 * - an app process is only signalled after its `ps` command is re-verified to
 *   be the exact next dev invocation on the owned app dir and owned port;
 * - HTTP readiness only counts when the listening socket belongs to a process
 *   inside the owned app process group (a foreign listener on the owned port
 *   aborts the run instead of being mistaken for "the app is up").
 */

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function logToStderr(line: string): void {
  try {
    process.stderr.write(`[native-runner-lifecycle] ${line}\n`)
  } catch {
    // Never let logging break lifecycle guarantees.
  }
}

/** Run a one-shot CLI child with a hard timeout; never leaves it running. */
export function runChild(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  logFile: string,
  timeoutMs = 600_000,
): Promise<number> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess | null = null
    let settled = false
    let timer: NodeJS.Timeout | undefined
    let stream: ReturnType<typeof createWriteStream> | null = null
    const settle = (run: () => void): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (stream && !stream.destroyed) stream.end()
      run()
    }
    try {
      stream = createWriteStream(logFile, { flags: 'a' })
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)))
      return
    }
    // An unhandled stream 'error' (ENOSPC, ENOENT dir) would crash the runner
    // and orphan running children — record it and keep the promise bounded.
    stream.on('error', (error: Error) => {
      logToStderr(`log stream for ${path.basename(command)} failed: ${error.message}`)
      stream?.destroy()
    })
    try {
      child = spawn(command, args, { cwd, env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'] as const })
    } catch (error) {
      settle(() => reject(error instanceof Error ? error : new Error(String(error))))
      return
    }
    child.stdout?.on('data', (chunk) => { if (stream && !stream.destroyed) stream.write(chunk) })
    child.stderr?.on('data', (chunk) => { if (stream && !stream.destroyed) stream.write(chunk) })
    child.on('error', (error) => settle(() => reject(error)))
    child.on('close', (code) => {
      if (code === 0) settle(() => resolve(0))
      else settle(() => reject(new Error(`${command} ${args.join(' ')} exited ${code ?? 'by signal'} (log: ${logFile})`)))
    })
    timer = setTimeout(() => {
      child?.kill('SIGKILL')
      settle(() => reject(new Error(`TIMEOUT: ${command} ${args.join(' ')} did not finish within ${timeoutMs}ms (killed; log: ${logFile})`)))
    }, timeoutMs)
  })
}

export type OwnedProcessKind = 'postgres' | 'app' | 'mail'

export interface OwnedProcessRecord {
  kind: OwnedProcessKind
  stop: () => Promise<void>
}

/**
 * Tracks every started resource so partial startups are still stopped.
 * `stopAll` stops in reverse registration order (app before postgres) and
 * REPORTS failures instead of swallowing them, so the caller can refuse to
 * delete runtime data it cannot prove was shut down.
 */
export class OwnedResourceTracker {
  private records: OwnedProcessRecord[] = []
  register(record: OwnedProcessRecord): void {
    this.records.push(record)
  }
  async stopAll(onWarning: (message: string) => void = () => {}): Promise<string[]> {
    const failures: string[] = []
    for (const record of this.records.reverse()) {
      try {
        await record.stop()
      } catch (error) {
        const message = `${record.kind}: ${error instanceof Error ? error.message : String(error)}`
        failures.push(message)
        onWarning(message)
      }
    }
    this.records.length = 0
    return failures
  }
}

// ---------------------------------------------------------------------------
// App process identity + process-group ownership
// ---------------------------------------------------------------------------

export interface AppProcess {
  pid: number
  child: ChildProcess
  serverPort: number
}

/**
 * A command line is OUR app only if it is the exact next dev invocation we
 * spawned: a script under `<appDir>/node_modules`, next, and `--port
 * <serverPort>`. Anything else (a random process whose command merely
 * contains "next", a recycled PID, an editor) must never be signalled.
 */
export function appCommandIsOwned(command: string, appDir: string, serverPort: number): boolean {
  if (!command.includes(path.join(appDir, 'node_modules'))) return false
  if (!/\bnext\b/.test(command)) return false
  return new RegExp(`(?:^|\\s)--port[= ]${serverPort}(?:\\s|$)`).test(command)
}

export function spawnApp(runtime: OwnedRuntime, appDir: string, preloadPath: string, logFile: string): AppProcess {
  const env = finalizeAppEnvironment(runtime, appDir, preloadPath)
  // Spawn node directly (no shebang/env indirection) so the `ps` command line
  // deterministically contains the literal owned script path. `detached: true`
  // makes the child its own process-group leader: every next-dev descendant
  // inherits that group, giving the runner strong ownership of the whole tree.
  const nextScript = path.join(appDir, 'node_modules', 'next', 'dist', 'bin', 'next')
  const child = spawn(
    process.execPath,
    [nextScript, 'dev', '--hostname', '127.0.0.1', '--port', String(runtime.ports.serverPort)],
    { cwd: appDir, env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'] as const, detached: true },
  )
  const stream = createWriteStream(logFile, { flags: 'a' })
  stream.on('error', (error: Error) => {
    logToStderr(`app log stream failed: ${error.message}`)
    stream.destroy()
  })
  child.stdout?.on('data', (chunk) => { if (!stream.destroyed) stream.write(chunk) })
  child.stderr?.on('data', (chunk) => { if (!stream.destroyed) stream.write(chunk) })
  child.on('error', (error) => stream.end(`\n[next failed to start: ${error.message}]\n`))
  // A server that dies mid-run leaves no other trace: record how and when.
  child.on('close', (code, signal) => {
    stream.end(`\n[next exited ${code}${signal ? ` signal=${signal}` : ''} at ${new Date().toISOString()}]\n`)
  })
  return { pid: child.pid ?? 0, child, serverPort: runtime.ports.serverPort }
}

function execFileText(command: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 10_000 }, (error, stdout) => resolve(error ? '' : stdout))
  })
}

export async function psCommandOf(pid: number): Promise<string> {
  return (await execFileText('ps', ['-p', String(pid), '-o', 'command='])).trim()
}

export async function psPgidOf(pid: number): Promise<number | null> {
  const value = Number((await execFileText('ps', ['-p', String(pid), '-o', 'pgid='])).trim())
  return Number.isInteger(value) && value > 0 ? value : null
}

/** True when the process group still has at least one member. */
export function signalProcessGroup(pgid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-pgid, signal)
    return true
  } catch {
    return false // ESRCH: the group is gone
  }
}

async function groupMemberPids(pgid: number): Promise<number[]> {
  const text = await execFileText('ps', ['-axo', 'pid=,pgid='])
  const members: number[] = []
  for (const line of text.split('\n')) {
    const parts = line.trim().split(/\s+/)
    if (parts.length === 2 && Number(parts[1]) === pgid) {
      const pid = Number(parts[0])
      if (Number.isInteger(pid) && pid > 0) members.push(pid)
    }
  }
  return members
}

/**
 * Stop the owned app: verify identity, then signal the WHOLE owned process
 * group (term → bounded grace → kill). Never signals a pid or group that is
 * not provably ours.
 */
export async function stopAppProcess(app: AppProcess, appDir: string): Promise<void> {
  if (!app.pid) return
  const command = await psCommandOf(app.pid)
  if (command !== '') {
    if (!appCommandIsOwned(command, appDir, app.serverPort)) {
      throw new Error(
        `SAFETY: app PID ${app.pid} no longer matches the owned next dev process (command: ${command}); refusing to signal its process group`,
      )
    }
    const pgid = await psPgidOf(app.pid)
    if (pgid !== null && pgid !== app.pid) {
      throw new Error(`SAFETY: app PID ${app.pid} is not its process-group leader (pgid ${pgid}); refusing a group signal`)
    }
  } else {
    // The leader already exited; only a group that still contains members we
    // spawned (next-dev descendants, commands referencing next) may be
    // signalled — a recycled pgid must never be.
    const members = await groupMemberPids(app.pid)
    for (const member of members) {
      const memberCommand = await psCommandOf(member)
      if (memberCommand !== '' && !memberCommand.includes('next') && !memberCommand.includes(appDir)) {
        throw new Error(
          `SAFETY: process group ${app.pid} contains unrecognised member PID ${member} (${memberCommand}); refusing to signal it`,
        )
      }
    }
  }
  if (!signalProcessGroup(app.pid, 'SIGTERM')) return
  const termDeadline = Date.now() + 10_000
  while (Date.now() < termDeadline && signalProcessGroup(app.pid, 0)) await sleep(200)
  if (signalProcessGroup(app.pid, 0)) {
    signalProcessGroup(app.pid, 'SIGKILL')
    const killDeadline = Date.now() + 5_000
    while (Date.now() < killDeadline && signalProcessGroup(app.pid, 0)) await sleep(100)
  }
  if (signalProcessGroup(app.pid, 0)) {
    throw new Error(`app process group ${app.pid} is still alive after SIGKILL — manual cleanup required`)
  }
}

// ---------------------------------------------------------------------------
// HTTP readiness with listener ownership
// ---------------------------------------------------------------------------

export type ListenerOwnershipDecision =
  | { status: 'owned' }
  | { status: 'retry'; reason: string }
  | { status: 'foreign'; reason: string }

/**
 * Pure decision: a port's HTTP listener is owned only when EVERY listening
 * pid is inside the app's process group (pgid == the detached leader's pid).
 * Descendants inherit the group, so the actual next-dev HTTP server counts as
 * owned even though it is not the spawned leader itself.
 */
export function listenerOwnership(
  listeningPids: readonly number[],
  pgidByPid: Readonly<Record<number, number | null>>,
  processGroupLeaderPid: number,
): ListenerOwnershipDecision {
  if (listeningPids.length === 0) {
    return { status: 'retry', reason: 'no listener found for the port yet' }
  }
  for (const pid of listeningPids) {
    const pgid = pgidByPid[pid] ?? null
    if (pgid === null) {
      return { status: 'retry', reason: `listener PID ${pid} vanished while checking` }
    }
    if (pgid !== processGroupLeaderPid) {
      return {
        status: 'foreign',
        reason: `listener PID ${pid} has pgid ${pgid}, expected owned group ${processGroupLeaderPid}`,
      }
    }
  }
  return { status: 'owned' }
}

export async function lsofListenerPids(port: number): Promise<number[]> {
  const text = await execFileText('/usr/sbin/lsof', ['-nP', `-tiTCP:${port}`, '-sTCP:LISTEN'])
  return text
    .split('\n')
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0)
}

export async function checkListenerOwnership(
  port: number,
  processGroupLeaderPid: number,
): Promise<ListenerOwnershipDecision> {
  const pids = await lsofListenerPids(port)
  const pgidByPid: Record<number, number | null> = {}
  for (const pid of pids) pgidByPid[pid] = await psPgidOf(pid)
  return listenerOwnership(pids, pgidByPid, processGroupLeaderPid)
}

/**
 * Wait until the app answers HTTP AND the listener is provably inside the
 * owned app process group. An HTTP answer from a foreign process is a SAFETY
 * failure, not readiness.
 */
export async function waitForHttpReady(
  url: string,
  port: number,
  processGroupLeaderPid: number,
  timeoutMs: number,
  check: (port: number, leaderPid: number) => Promise<ListenerOwnershipDecision> = checkListenerOwnership,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError = 'no attempt recorded'
  while (Date.now() < deadline) {
    try {
      await fetch(url, { redirect: 'manual' })
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      await sleep(1000)
      continue
    }
    const decision = await check(port, processGroupLeaderPid)
    if (decision.status === 'owned') return
    if (decision.status === 'foreign') {
      throw new Error(
        `SAFETY: ${url} answered HTTP but the listener is outside the owned app process group (${decision.reason}); refusing to continue`,
      )
    }
    lastError = `listener ownership not provable yet: ${decision.reason}`
    await sleep(1000)
  }
  throw new Error(`app did not become ready at ${url} within ${timeoutMs}ms (last error: ${lastError})`)
}
