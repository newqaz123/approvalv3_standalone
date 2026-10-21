import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { promises as fsp } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { type OwnedRuntime } from '../support/native/postgres-instance'
import { spawnApp, type AppProcess } from '../support/native/runner-lifecycle'
import { recycleMatrixApp, readLogTail, type MatrixRuntimeHandle } from '../support/native/rejection-recovery-runtime'
import {
  appRecycleReason,
  formatAppHealthSummary,
  latestServerHeap,
  parseProcessGroupRows,
  startAppHealthSampler,
  summarizeAppHealth,
  type AppHealthSample,
  type AppProcessRow,
} from '../support/native/app-health'
import { signInThroughUi, type SignInPage } from '../support/ui-sign-in'

const PRELOAD = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'support',
  'native',
  'outbound-allowlist-preload.js',
)

// `next dev` restarts itself once its heap passes 80% of the limit and says so
// only in its own log (RRM-012). These tests pin the diagnostics that tell that
// restart from any other shutdown of the matrix app.
describe('matrix app process diagnostics', () => {
  const preloadEnv = (dir: string, extra: Record<string, string> = {}): Record<string, string> => ({
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    BUSINESS_NET_ALLOWLIST: JSON.stringify({ mode: 'ENFORCE', tcp: {} }),
    BUSINESS_NET_BLOCK_LOG: path.join(dir, 'blocked-connections.jsonl'),
    ...extra,
  })

  it('records heap statistics for the dev server child, including the exit code', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'app-heap-'))
    try {
      const result = spawnSync(process.execPath, ['--require', PRELOAD, '-e', 'setTimeout(() => process.exit(75), 100)'], {
        env: preloadEnv(dir, { NEXT_PRIVATE_WORKER: '1' }) as NodeJS.ProcessEnv,
        encoding: 'utf8',
      })
      assert.equal(result.status, 75, result.stderr)
      const lines = (await fsp.readFile(path.join(dir, 'app-heap.log'), 'utf8')).trim().split('\n')
      assert.match(lines[0], /^\S+ start pid=\d+ heapUsedMb=\d+ heapLimitMb=\d+ externalMb=\d+ arrayBuffersMb=\d+ rssMb=\d+$/)
      assert.match(lines[lines.length - 1], /^\S+ exit code=75 pid=\d+ heapUsedMb=\d+ heapLimitMb=\d+/)
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('leaves processes other than the dev server child alone', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'app-heap-'))
    try {
      const result = spawnSync(process.execPath, ['--require', PRELOAD, '-e', 'process.exit(0)'], {
        env: preloadEnv(dir) as NodeJS.ProcessEnv,
        encoding: 'utf8',
      })
      assert.equal(result.status, 0, result.stderr)
      await assert.rejects(fsp.stat(path.join(dir, 'app-heap.log')))
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('stamps how and when the app process ended in its log', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'spawn-app-'))
    try {
      const bin = path.join(dir, 'app', 'node_modules', 'next', 'dist', 'bin')
      await fsp.mkdir(bin, { recursive: true })
      await fsp.writeFile(path.join(dir, 'preload.js'), '')
      const run = async (name: string, script: string): Promise<string> => {
        await fsp.writeFile(path.join(bin, 'next'), script)
        const logFile = path.join(dir, `${name}.log`)
        const runtime = { appEnv: {}, ports: { serverPort: 1 } } as unknown as OwnedRuntime
        const app = spawnApp(runtime, path.join(dir, 'app'), path.join(dir, 'preload.js'), logFile)
        await new Promise((resolve) => app.child.once('close', resolve))
        await new Promise((resolve) => setTimeout(resolve, 50))
        return fsp.readFile(logFile, 'utf8')
      }
      assert.match(await run('code', 'process.exit(3)'), /\[next exited 3 at \d{4}-\d\d-\d\dT[\d:.]+Z\]/)
      assert.match(
        await run('signal', "process.kill(process.pid, 'SIGTERM'); setTimeout(() => {}, 5000)"),
        /\[next exited null signal=SIGTERM at \d{4}-\d\d-\d\dT[\d:.]+Z\]/,
      )
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })
})

const PS_TABLE = [
  '  4242  1111  4242   48000    01:23:45 /usr/bin/node /tmp/app/node_modules/next/dist/bin/next dev --port 27187',
  '  4243  4242  4242 3500000       23:10 next-server (v15.5.23)',
  '  5000     1  5000     100       00:01 /usr/bin/other thing',
  'not a process line',
].join('\n')

const row = (pid: number, ppid: number, rssKb: number, command = 'next-server (v15.5.23)'): AppProcessRow => ({
  pid,
  ppid,
  rssKb,
  etime: '00:10',
  command,
})
const leader = (): AppProcessRow => row(4242, 1, 50_000, 'node next dev')
const sample = (at: string, rows: AppProcessRow[]): AppHealthSample => ({ at, rows })

describe('app process health sampling', () => {
  it('keeps only the rows of the app process group', () => {
    const rows = parseProcessGroupRows(PS_TABLE, 4242)
    assert.deepEqual(rows.map((r) => [r.pid, r.ppid, r.rssKb, r.etime]), [
      [4242, 1111, 48000, '01:23:45'],
      [4243, 4242, 3500000, '23:10'],
    ])
    assert.equal(rows[1].command, 'next-server (v15.5.23)')
    assert.deepEqual(parseProcessGroupRows(PS_TABLE, 9999), [])
  })

  it('summarises a server restart: the child pid changes while the parent stays', () => {
    const summary = summarizeAppHealth(4242, [
      sample('2026-10-20T14:00:00.000Z', [leader(), row(4243, 4242, 1_000_000)]),
      sample('2026-10-20T14:00:10.000Z', [leader(), row(4243, 4242, 3_500_000)]),
      sample('2026-10-20T14:00:20.000Z', [leader(), row(4300, 4242, 400_000)]),
    ])
    assert.deepEqual(summary.serverPids, [4243, 4300])
    assert.deepEqual(summary.restarts, [{ from: 4243, to: 4300, at: '2026-10-20T14:00:20.000Z' }])
    assert.equal(summary.peakServerRssMb, 3418)
    assert.equal(summary.peakAt, '2026-10-20T14:00:10.000Z')
    assert.equal(summary.serverGoneAt, null)
    assert.equal(summary.groupGoneAt, null)
    assert.match(formatAppHealthSummary(summary), /restarted 1 time.*4243.*4300.*peak server RSS 3418 MB/)
  })

  it('summarises the server child vanishing while the next dev parent stays up', () => {
    const summary = summarizeAppHealth(4242, [
      sample('2026-10-20T14:00:00.000Z', [leader(), row(4243, 4242, 1_000_000)]),
      sample('2026-10-20T14:00:10.000Z', [leader()]),
      sample('2026-10-20T14:00:20.000Z', [leader()]),
    ])
    assert.equal(summary.serverGoneAt, '2026-10-20T14:00:10.000Z')
    assert.equal(summary.groupGoneAt, null)
    assert.match(formatAppHealthSummary(summary), /server process gone at 2026-10-20T14:00:10\.000Z while the next dev parent stayed up/)
  })

  it('summarises the whole process group disappearing', () => {
    const summary = summarizeAppHealth(4242, [
      sample('2026-10-20T14:00:00.000Z', [leader(), row(4243, 4242, 1_000_000)]),
      sample('2026-10-20T14:00:10.000Z', []),
    ])
    assert.equal(summary.groupGoneAt, '2026-10-20T14:00:10.000Z')
    assert.match(formatAppHealthSummary(summary), /process group gone at 2026-10-20T14:00:10\.000Z/)
  })

  it('does not treat a restart in progress or a slow start as a lost server', () => {
    const summary = summarizeAppHealth(4242, [
      sample('2026-10-20T14:00:00.000Z', [leader()]),
      sample('2026-10-20T14:00:10.000Z', [leader(), row(4243, 4242, 1_000_000)]),
      sample('2026-10-20T14:00:20.000Z', [leader()]),
      sample('2026-10-20T14:00:30.000Z', [leader(), row(4300, 4242, 500_000)]),
    ])
    assert.equal(summary.serverGoneAt, null)
    assert.deepEqual(summary.restarts, [{ from: 4243, to: 4300, at: '2026-10-20T14:00:30.000Z' }])
  })

  it('reports plainly when nothing was sampled', () => {
    assert.match(formatAppHealthSummary(summarizeAppHealth(4242, [])), /no samples/)
  })

  it('samples through the injected table reader and logs one line per sample', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'app-health-'))
    try {
      const logFile = path.join(dir, 'app-health.log')
      let calls = 0
      const sampler = startAppHealthSampler({
        pgid: 4242,
        logFile,
        intervalMs: 0,
        readProcessTable: async () => (calls++ === 0 ? PS_TABLE : '  4242  1  4242  100  00:01  node next dev\n'),
        now: () => new Date(Date.UTC(2026, 9, 20, 14, 0, calls)),
      })
      await sampler.sampleOnce()
      await sampler.sampleOnce()
      await sampler.stop()
      const lines = (await fsp.readFile(logFile, 'utf8')).trim().split('\n')
      assert.equal(lines.length, 2)
      assert.match(lines[0], /pgid=4242 procs=2 serverPid=4243 serverRssMb=3418/)
      assert.match(lines[1], /pgid=4242 procs=1 serverPid=-/)
      assert.equal(sampler.samples().length, 2)
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('never throws or records a sample when the process table cannot be read', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'app-health-'))
    try {
      const sampler = startAppHealthSampler({
        pgid: 4242,
        logFile: path.join(dir, 'app-health.log'),
        intervalMs: 0,
        readProcessTable: async () => { throw new Error('ps failed') },
      })
      await sampler.sampleOnce()
      await sampler.stop()
      assert.equal(sampler.samples().length, 0)
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })
})

describe('matrix sign-in sequence', () => {
  it('waits for React to hydrate the form before typing credentials', async () => {
    const calls: string[] = []
    const page: SignInPage = {
      goto: async (url) => { calls.push(`goto ${url}`) },
      waitForFunction: async () => { calls.push('waitForFunction hydrated') },
      locator: (selector) => ({ fill: async (value) => { calls.push(`fill ${selector}=${value}`) } }),
      getByRole: (role, options) => ({ click: async () => { calls.push(`click ${role} ${options.name}`) } }),
      waitForURL: async (predicate) => {
        calls.push(`waitForURL leaves-sign-in=${predicate(new URL('http://127.0.0.1:1/requests'))} stays=${predicate(new URL('http://127.0.0.1:1/sign-in?x=1'))}`)
      },
    }
    await signInThroughUi(page, { baseUrl: 'http://127.0.0.1:1', email: 'a@b.test', password: 'pw' })
    assert.deepEqual(calls, [
      'goto http://127.0.0.1:1/sign-in',
      'waitForFunction hydrated',
      'fill #email=a@b.test',
      'fill #password=pw',
      'click button Sign in',
      'waitForURL leaves-sign-in=true stays=false',
    ])
  })
})

// The dev server's heap grows about 160 MB a minute (React's dev-only async
// stack tracking and Next's manifest cache; no application frames) and `next
// dev` restarts it at 80% of its limit, cutting a page in flight (RRM-012).
// The matrix replaces the server itself between cases, where nothing is open.
describe('recycling the dev server between cases', () => {
  const sampleLine = (at: string, pid: number, used: number, limit = 8240): string =>
    `${at} sample pid=${pid} heapUsedMb=${used} heapLimitMb=${limit} externalMb=600 arrayBuffersMb=590 rssMb=3000`

  it('reads the server heap from the newest samples and ignores tiny helper processes', () => {
    const text = [
      sampleLine('2026-10-21T00:00:00.000Z', 1111, 2000),
      '2026-10-21T00:00:01.000Z start pid=2222 heapUsedMb=5 heapLimitMb=8240 externalMb=2 arrayBuffersMb=0 rssMb=44',
      sampleLine('2026-10-21T00:00:05.000Z', 1111, 2100),
      sampleLine('2026-10-21T00:00:05.500Z', 3333, 70),
      '2026-10-21T00:00:06.000Z exit code=0 pid=3333 heapUsedMb=68 heapLimitMb=8240 externalMb=4 arrayBuffersMb=0 rssMb=178',
    ].join('\n')
    assert.deepEqual(latestServerHeap(text), { pid: 1111, usedMb: 2100, limitMb: 8240, at: '2026-10-21T00:00:05.000Z' })
    assert.equal(latestServerHeap(''), null)
    assert.equal(latestServerHeap('a cut first line\nnot a sample\n'), null)
  })

  it('does not look at samples from an earlier server that are more than 20 s old', () => {
    const text = [
      sampleLine('2026-10-21T00:00:00.000Z', 1111, 6500),
      sampleLine('2026-10-21T00:10:00.000Z', 4444, 1800),
    ].join('\n')
    assert.equal(latestServerHeap(text)?.pid, 4444)
  })

  it('recycles after four cases on one server, or when its heap is half its limit', () => {
    const heap = (usedMb: number) => ({ pid: 1, usedMb, limitMb: 8240, at: 't' })
    assert.equal(appRecycleReason({ casesOnServer: 0, heap: null }), null)
    assert.equal(appRecycleReason({ casesOnServer: 3, heap: heap(3000) }), null)
    assert.match(appRecycleReason({ casesOnServer: 4, heap: heap(3000) }) ?? '', /4 cases/)
    assert.match(appRecycleReason({ casesOnServer: 2, heap: heap(4200) }) ?? '', /4200 MB of 8240 MB/)
    assert.equal(appRecycleReason({ casesOnServer: 3, heap: heap(4119) }), null)
    assert.match(appRecycleReason({ casesOnServer: 4, heap: null }) ?? '', /4 cases/)
  })

  it('reads the tail of a log without the rest', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'log-tail-'))
    try {
      const file = path.join(dir, 'app-heap.log')
      await fsp.writeFile(file, 'first line\nsecond line\nthird line\n')
      assert.equal(await readLogTail(file, 1000), 'first line\nsecond line\nthird line\n')
      assert.equal(await readLogTail(file, 11), 'third line\n')
      assert.equal(await readLogTail(path.join(dir, 'missing.log'), 10), '')
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  const fakeApp = (pid: number): AppProcess => ({ pid, serverPort: 4321, child: {} as AppProcess['child'] })
  const paths = (events: string[]) => ({
    preloadPath: '/tmp/app/preload.js',
    logFile: '/tmp/logs/next-dev.log',
    healthLogFile: '/tmp/logs/app-health.log',
    log: (message: string) => { events.push(`log:${message}`) },
  })
  const fakeHandle = (events: string[]): MatrixRuntimeHandle => ({
    app: fakeApp(100),
    appDir: '/tmp/app',
    baseUrl: 'http://127.0.0.1:4321',
    runtime: { runId: 'business-test-x', ports: { serverPort: 4321 } },
    appHealth: {
      sampleOnce: async () => { events.push('final-sample') },
      samples: () => [],
      stop: async () => { events.push('stop-sampler') },
    },
  } as unknown as MatrixRuntimeHandle)

  it('stops the old app, starts a new one on the same port, and waits until it is ready', async () => {
    const events: string[] = []
    const handle = fakeHandle(events)
    const next = fakeApp(200)
    await recycleMatrixApp(handle, paths(events), {
      stopAppProcess: async (app, dir) => { events.push(`stop-app:${app.pid}:${dir}`) },
      spawnApp: (_runtime, dir, preload, logFile) => { events.push(`spawn:${dir}:${preload}:${logFile}`); return next },
      startAppHealthSampler: (options) => {
        events.push(`sampler:${options.pgid}:${options.logFile}`)
        return { sampleOnce: async () => undefined, samples: () => [], stop: async () => undefined }
      },
      waitForHttpReady: async (url, port, pid, timeoutMs) => { events.push(`ready:${url}:${port}:${pid}:${timeoutMs}`) },
    }, 'server heap 4300 MB of 8240 MB')
    assert.deepEqual(events.filter((e) => !e.startsWith('log:')), [
      'final-sample',
      'stop-sampler',
      'stop-app:100:/tmp/app',
      'spawn:/tmp/app:/tmp/app/preload.js:/tmp/logs/next-dev.log',
      'sampler:200:/tmp/logs/app-health.log',
      'ready:http://127.0.0.1:4321/sign-in:4321:200:240000',
    ])
    assert.equal(handle.app, next)
    const logs = events.filter((e) => e.startsWith('log:')).join('\n')
    assert.match(logs, /recycling the app \(server heap 4300 MB of 8240 MB\)/)
    assert.match(logs, /app health: no samples taken/)
    assert.match(logs, /app ready again at http:\/\/127\.0\.0\.1:4321/)
  })

  it('does not start a new app when the old one cannot be stopped', async () => {
    const events: string[] = []
    const handle = fakeHandle(events)
    const old = handle.app
    await assert.rejects(() => recycleMatrixApp(handle, paths(events), {
      stopAppProcess: async () => { throw new Error('app process group 100 is still alive after SIGKILL') },
      spawnApp: () => { events.push('spawn'); return fakeApp(200) },
      waitForHttpReady: async () => { events.push('ready') },
    }, 'test'), /still alive after SIGKILL/)
    assert.equal(events.includes('spawn'), false)
    assert.equal(handle.app, old)
  })

  it('keeps the new app on the handle when it never becomes ready, so the final stop still reaches it', async () => {
    const events: string[] = []
    const handle = fakeHandle(events)
    const next = fakeApp(200)
    await assert.rejects(() => recycleMatrixApp(handle, paths(events), {
      stopAppProcess: async () => undefined,
      spawnApp: () => next,
      waitForHttpReady: async () => { throw new Error('app did not become ready') },
    }, 'test'), /did not become ready/)
    assert.equal(handle.app, next)
  })

  it('refuses to recycle an app that is not running', async () => {
    const handle = { appDir: '/tmp/app', runtime: { runId: 'x' } } as unknown as MatrixRuntimeHandle
    await assert.rejects(() => recycleMatrixApp(handle, paths([]), {
      stopAppProcess: async () => undefined,
      spawnApp: () => fakeApp(1),
      waitForHttpReady: async () => undefined,
    }, 'test'), /not running/)
  })
})
