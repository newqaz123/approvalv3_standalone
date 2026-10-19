import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import {
  OwnedResourceTracker,
  appCommandIsOwned,
  checkListenerOwnership,
  listenerOwnership,
  psCommandOf,
  runChild,
  signalProcessGroup,
  spawnApp,
  stopAppProcess,
  waitForHttpReady,
  type AppProcess,
} from '../support/native/runner-lifecycle'
import type { OwnedRuntime } from '../support/native/postgres-instance'

/**
 * Regression coverage for the native runner's lifecycle safety behavior
 * (imported from runner-lifecycle so the runner's main() is NEVER executed
 * here). All tests are synthetic: sockets and short-lived child processes
 * only — no database, no app, no browser.
 */

const SPAWN_ENV = { PATH: process.env.PATH ?? '/usr/bin:/bin' }

async function pidIsAlive(pid: number): Promise<boolean> {
  if ((await psCommandOf(pid)) !== '') return true
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForFileContent(file: string, pattern: RegExp, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    try {
      last = await fs.readFile(file, 'utf8')
      if (pattern.test(last)) return last
    } catch {
      // not written yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`timed out waiting for ${pattern} in ${file} (last: ${last.slice(0, 400)})`)
}

describe('bounded one-shot child execution (runChild)', () => {
  it('resolves 0 on success and streams output to the log file', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'runner-lifecycle-'))
    try {
      const log = path.join(dir, 'echo.log')
      await runChild('/bin/echo', ['runner-ok'], dir, SPAWN_ENV, log, 10_000)
      assert.match(await fs.readFile(log, 'utf8'), /runner-ok/)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects on non-zero exit with the log path in the message', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'runner-lifecycle-'))
    try {
      await assert.rejects(
        () => runChild('/usr/bin/false', [], dir, SPAWN_ENV, path.join(dir, 'false.log'), 10_000),
        /exited 1/,
      )
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects on spawn error (missing binary) without hanging', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'runner-lifecycle-'))
    try {
      await assert.rejects(
        () => runChild('/nonexistent/definitely-missing-binary', [], dir, SPAWN_ENV, path.join(dir, 'x.log'), 10_000),
      )
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('SIGKILLs the child on timeout instead of hanging the runner', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'runner-lifecycle-'))
    try {
      const started = Date.now()
      await assert.rejects(
        () => runChild('/bin/sleep', ['30'], dir, SPAWN_ENV, path.join(dir, 'sleep.log'), 500),
        /TIMEOUT: \/bin\/sleep 30 did not finish within 500ms/,
      )
      const elapsed = Date.now() - started
      assert.ok(elapsed < 5_000, `timeout must kill quickly, took ${elapsed}ms`)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

describe('app process identity predicate (appCommandIsOwned)', () => {
  const appDir = '/tmp/business-test-owned/app'
  const port = 31531

  it('accepts the exact spawned next dev invocation (direct and .bin forms)', () => {
    assert.equal(
      appCommandIsOwned(`${appDir}/node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port ${port}`, appDir, port),
      true,
    )
    assert.equal(
      appCommandIsOwned(`/usr/bin/env node ${appDir}/node_modules/.bin/next dev --hostname 127.0.0.1 --port ${port}`, appDir, port),
      true,
    )
    assert.equal(
      appCommandIsOwned(`node ${appDir}/node_modules/next/dist/bin/next dev --port=${port}`, appDir, port),
      true,
    )
  })

  it('refuses commands that merely contain "next" or the app dir but are not our dev server', () => {
    assert.equal(appCommandIsOwned('next dev --port 3000', appDir, port), false)
    assert.equal(appCommandIsOwned('vim next-meeting-notes.txt', appDir, port), false)
    assert.equal(appCommandIsOwned(`grep -r next ${appDir}/logs`, appDir, port), false)
    assert.equal(
      appCommandIsOwned(`${appDir}/node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port ${port + 1}`, appDir, port),
      false,
    )
    assert.equal(
      appCommandIsOwned(`/opt/homebrew/var/postgresql@16/postgres -D /opt/homebrew/var/postgresql@16 --port ${port}`, appDir, port),
      false,
    )
  })
})

describe('listener ownership decision (pure)', () => {
  const leader = 4711

  it('is owned only when every listener pid is inside the app process group', () => {
    assert.deepEqual(listenerOwnership([4800, 4801], { 4800: leader, 4801: leader }, leader), { status: 'owned' })
  })

  it('retries when no listener exists yet or one vanished mid-check', () => {
    assert.equal(listenerOwnership([], {}, leader).status, 'retry')
    assert.equal(listenerOwnership([4800], { 4800: null }, leader).status, 'retry')
  })

  it('marks a foreign listener (outside the owned group) as a safety failure', () => {
    const decision = listenerOwnership([4800], { 4800: 999 }, leader)
    assert.equal(decision.status, 'foreign')
    assert.match(decision.status === 'foreign' ? decision.reason : '', /pgid 999/)
    // The real dev server on port 3100 must never count as owned:
    const mixed = listenerOwnership([4800, 87681], { 4800: leader, 87681: 87679 }, leader)
    assert.equal(mixed.status, 'foreign')
  })
})

describe('owned resource tracker', () => {
  it('stops resources in reverse order and REPORTS failures instead of swallowing them', async () => {
    const tracker = new OwnedResourceTracker()
    const order: string[] = []
    tracker.register({ kind: 'postgres', stop: async () => { order.push('postgres') } })
    tracker.register({ kind: 'app', stop: async () => { order.push('app'); throw new Error('app wedged') } })
    const warnings: string[] = []
    const failures = await tracker.stopAll((message) => warnings.push(message))
    assert.deepEqual(order, ['app', 'postgres'], 'LIFO: app must be stopped before postgres')
    assert.equal(failures.length, 1)
    assert.match(failures[0], /^app: app wedged$/)
    assert.equal(warnings.length, 1)
    // A reported failure lets the runner REFUSE to delete the data dir —
    // that decision belongs to the runner's cleanup, fed by this result.
    assert.notEqual(failures.length, 0, 'stop failures must be visible to the caller')
    const secondRun = await tracker.stopAll()
    assert.deepEqual(secondRun, [], 'records are cleared after stopAll')
  })

  it('returns zero failures when everything stops cleanly', async () => {
    const tracker = new OwnedResourceTracker()
    tracker.register({ kind: 'postgres', stop: async () => {} })
    assert.deepEqual(await tracker.stopAll(), [])
  })
})

describe('app process-group ownership (real synthetic processes)', () => {
  let tmp: string

  before(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'runner-app-owned-'))
  })

  after(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  function fakeRuntime(serverPort: number, allowlistPort: number): OwnedRuntime {
    return {
      runId: 'business-test-20990101T000000-synthetic',
      resource: {
        runId: 'business-test-20990101T000000-synthetic',
        containerName: 'business-test-20990101T000000-synthetic-postgres',
        databaseName: 'app_cleanstart_dev',
        databasePort: 1,
        serverPort,
      },
      ports: { databasePort: 1, serverPort, mailPort: 2 },
      paths: { rootDir: tmp, dataDir: '', socketDir: '', secretsDir: '', logsDir: tmp },
      databasePassword: 'synthetic',
      e2ePassword: 'synthetic',
      databaseUrl: 'postgresql://postgres:synthetic@127.0.0.1:1/app_cleanstart_dev',
      allowlist: {
        mode: 'ENFORCE',
        tcp: { '127.0.0.1': [allowlistPort] },
        unixSocketPrefixes: [],
        resolvableHostnames: ['localhost'],
      },
      allowlistEnv: '',
      postmasterPid: null,
      appEnv: {
        DATABASE_URL: 'postgresql://postgres:synthetic@127.0.0.1:1/app_cleanstart_dev',
        BUSINESS_NET_ALLOWLIST: JSON.stringify({
          mode: 'ENFORCE',
          tcp: { '127.0.0.1': [allowlistPort] },
          unixSocketPrefixes: [],
          resolvableHostnames: ['localhost'],
        }),
      },
    } as unknown as OwnedRuntime
  }

  it('spawnApp/stopAppProcess stop the WHOLE owned process group including SIGTERM-ignoring descendants', async () => {
    const appDir = path.join(tmp, 'app', String(process.pid))
    const nextDir = path.join(appDir, 'node_modules', 'next', 'dist', 'bin')
    await fs.mkdir(nextDir, { recursive: true })
    // Synthetic "next dev": prints leader + a stubborn descendant pid, then
    // waits. The leader dies on SIGTERM; the descendant IGNORES SIGTERM so
    // only a process-GROUP kill can reap it.
    await fs.writeFile(path.join(nextDir, 'next'), [
      "const cp = require('node:child_process')",
      "const child = cp.spawn(process.execPath, ['-e', 'process.on(\"SIGTERM\", function(){}); setInterval(function(){}, 1000)'], { stdio: ['ignore', 'inherit', 'inherit'] })",
      "console.log('SYNTHETIC_NEXT_READY ' + process.pid + ' ' + child.pid)",
      'setInterval(function(){}, 1000)',
      '',
    ].join('\n'))
    const preload = path.join(tmp, 'benign-preload.js')
    await fs.writeFile(preload, 'module.exports = {}\n')
    const logFile = path.join(tmp, 'next-dev.log')

    const serverPort = 20000 + (process.pid % 20000)
    const app = spawnApp(fakeRuntime(serverPort, serverPort), appDir, preload, logFile)
    assert.ok(app.pid > 0)
    try {
      const ready = await waitForFileContent(logFile, /SYNTHETIC_NEXT_READY \d+ \d+/, 10_000)
      const [, leaderPidText, descendantPidText] = ready.match(/SYNTHETIC_NEXT_READY (\d+) (\d+)/) ?? []
      const descendantPid = Number(descendantPidText)
      assert.equal(Number(leaderPidText), app.pid)
      // The spawned leader must pass the identity predicate as seen by ps.
      const command = await psCommandOf(app.pid)
      assert.match(command, new RegExp(appDir.replaceAll('/', '\\/')))
      assert.ok(appCommandIsOwned(command, appDir, serverPort), `ps command must be owned: ${command}`)
      assert.equal(await pidIsAlive(descendantPid), true)

      await stopAppProcess(app, appDir)

      assert.equal(await pidIsAlive(app.pid), false, 'leader must be gone')
      assert.equal(await pidIsAlive(descendantPid), false, 'SIGTERM-ignoring descendant must be reaped by the group kill')
      assert.equal(signalProcessGroup(app.pid, 0), false, 'owned process group must be empty afterwards')
    } finally {
      // Never leak the synthetic group if an assertion above throws.
      signalProcessGroup(app.pid, 'SIGKILL')
    }
  })

  it('stopAppProcess REFUSES to signal a pid that is not the owned next dev process', async () => {
    // An unrelated long-running process wearing our AppProcess record.
    const intruder = spawn('/bin/sleep', ['30'], { stdio: 'ignore', detached: true })
    assert.ok(intruder.pid)
    try {
      const fakeApp: AppProcess = { pid: intruder.pid as number, child: intruder, serverPort: 31531 }
      await assert.rejects(
        () => stopAppProcess(fakeApp, '/tmp/business-test-owned/app'),
        /SAFETY: .*refusing to signal its process group/,
      )
      assert.equal(await pidIsAlive(intruder.pid as number), true, 'the intruder must survive untouched')
    } finally {
      signalProcessGroup(intruder.pid as number, 'SIGKILL')
    }
  })
})

describe('HTTP readiness with listener ownership (real synthetic sockets/processes)', () => {
  interface DetachedListener {
    pid: number
    port: number
    stop: () => void
  }

  async function spawnDetachedListener(): Promise<DetachedListener> {
    const script = [
      "const s = require('node:http').createServer(function (q, r) { r.end('synthetic') })",
      "s.listen(0, '127.0.0.1', function () { console.log('PORT ' + s.address().port); setInterval(function () {}, 1000) })",
    ].join(';')
    const child = spawn(process.execPath, ['-e', script], {
      stdio: ['ignore', 'pipe', 'ignore'] as const,
      detached: true,
    })
    let stdout = ''
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      const match = stdout.match(/^PORT (\d+)$/m)
      if (match) {
        const pid = child.pid as number
        return {
          pid,
          port: Number(match[1]),
          stop: () => signalProcessGroup(pid, 'SIGKILL'),
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    signalProcessGroup(child.pid as number, 'SIGKILL')
    throw new Error(`detached listener never reported its port (stdout: ${stdout})`)
  }

  it('waitForHttpReady resolves when HTTP answers from the owned process group listener', async () => {
    const listener = await spawnDetachedListener()
    try {
      const decision = await checkListenerOwnership(listener.port, listener.pid)
      assert.equal(decision.status, 'owned', JSON.stringify(decision))
      await waitForHttpReady(`http://127.0.0.1:${listener.port}/`, listener.port, listener.pid, 5_000, checkListenerOwnership)
    } finally {
      listener.stop()
    }
  })

  it('waitForHttpReady aborts with a SAFETY error when the listener is in a foreign process group', async () => {
    const listener = await spawnDetachedListener()
    const unrelatedLeader = spawn('/bin/sleep', ['30'], { stdio: 'ignore', detached: true })
    try {
      const decision = await checkListenerOwnership(listener.port, unrelatedLeader.pid as number)
      assert.equal(decision.status, 'foreign')
      await assert.rejects(
        () => waitForHttpReady(`http://127.0.0.1:${listener.port}/`, listener.port, unrelatedLeader.pid as number, 5_000, checkListenerOwnership),
        /SAFETY: .*outside the owned app process group/,
      )
    } finally {
      listener.stop()
      signalProcessGroup(unrelatedLeader.pid as number, 'SIGKILL')
    }
  })

  it('waitForHttpReady fails bounded when nothing listens', async () => {
    await assert.rejects(
      () => waitForHttpReady('http://127.0.0.1:1/', 1, 4711, 1_500, checkListenerOwnership),
      /did not become ready/,
    )
  })
})
