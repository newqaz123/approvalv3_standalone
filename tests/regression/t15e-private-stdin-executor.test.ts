// T15E private stdin executor (Task108) — fake child only. No psql, mint, or live DB.
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import {
  T15E_PRIVATE_PROBE_SQL,
  T15E_PRIVATE_STDIN_SAFE_MESSAGE,
  buildT15EPrivateStdinInvocation,
  matchT15EPrivateProbe,
  parseT15EPrivateStdinFrame,
  runT15EPrivateStdinChild,
  type T15EPrivateStdinChild,
} from '../support/native/t15e-private-stdin-executor'
import type { T15EArmedTimer } from '../support/native/t15e-overlap-lifecycle'

const SECRET = 'Abcdefghijklmnop-qrstuv_1234'
const MARKER = 'STDERR_SECRET_SHOULD_NOT_LEAK'

class FakeTimer implements T15EArmedTimer {
  firedFlag = false
  cancelled = false
  private release: (value?: void) => void = () => undefined
  readonly fired: Promise<void>
  constructor(readonly ms: number) {
    this.fired = new Promise<void>((resolve) => { this.release = resolve })
  }
  fire() {
    if (this.firedFlag || this.cancelled) return
    this.firedFlag = true
    this.release()
  }
  cancel() {
    if (this.cancelled || this.firedFlag) return
    this.cancelled = true
    this.firedFlag = true
    this.release()
  }
}

class FakeChild implements T15EPrivateStdinChild {
  readonly events = new EventEmitter()
  readonly stdinEvents = new EventEmitter()
  readonly stdoutEvents = new EventEmitter()
  readonly stderrEvents = new EventEmitter()
  readonly writes: Buffer[] = []
  readonly kills: string[] = []
  ended = false
  endCalls = 0
  failWrite: Error | null = null
  failStdoutOff = false
  stdin = {
    write: (chunk: Buffer, callback: (error?: Error | null) => void) => {
      this.writes.push(chunk)
      callback(this.failWrite)
    },
    end: () => { this.ended = true; this.endCalls += 1 },
    on: (event: 'error' | 'close', listener: (...args: never[]) => void) => { this.stdinEvents.on(event, listener as never) },
    off: (event: 'error' | 'close', listener: (...args: never[]) => void) => { this.stdinEvents.off(event, listener as never) },
  }
  stdout = {
    on: (event: 'data' | 'error' | 'close', listener: (...args: never[]) => void) => { this.stdoutEvents.on(event, listener as never) },
    off: (event: 'data' | 'error' | 'close', listener: (...args: never[]) => void) => {
      if (this.failStdoutOff) throw new Error('bad off')
      this.stdoutEvents.off(event, listener as never)
    },
  }
  stderr = {
    on: (event: 'data' | 'error' | 'close', listener: (...args: never[]) => void) => { this.stderrEvents.on(event, listener as never) },
    off: (event: 'data' | 'error' | 'close', listener: (...args: never[]) => void) => { this.stderrEvents.off(event, listener as never) },
  }
  on(event: 'error' | 'close', listener: (first?: unknown, second?: unknown) => void) { this.events.on(event, listener as never) }
  off(event: 'error' | 'close', listener: (first?: unknown, second?: unknown) => void) { this.events.off(event, listener as never) }
  kill(signal: 'SIGTERM' | 'SIGKILL') { this.kills.push(signal) }
  emitClose(code: number | null) { this.events.emit('close', code, null) }
}

function frame(body: unknown): Buffer {
  const json = JSON.stringify(body)
  return Buffer.from(`T15E_STDIN_B1\n${json}\nT15E_STDIN_E1:${Buffer.byteLength(json, 'utf8')}\n`, 'utf8')
}

const PROBE = {
  dataDirectory: '/tmp/owned-run/data',
  databasePort: 20111,
  databaseName: 'app_cleanstart_dev',
  serverVersionNum: 160001,
}

function timers() {
  const armed: FakeTimer[] = []
  return {
    armed,
    schedule: (ms: number) => {
      const timer = new FakeTimer(ms)
      armed.push(timer)
      return timer
    },
  }
}

describe('private stdin invocation is not authority', () => {
  it('builds an allowlisted env and keeps the secret off argv', () => {
    const built = buildT15EPrivateStdinInvocation({
      dataDirectory: PROBE.dataDirectory,
      databasePort: 20111,
      database: 'app_cleanstart_dev',
      databasePassword: SECRET,
    })
    assert.equal(built.ok, true)
    if (!built.ok) return
    assert.equal(built.authority, 'NONE')
    assert.deepEqual(Object.keys(built.env).sort(), ['PGDATABASE', 'PGHOST', 'PGPASSWORD', 'PGPORT', 'PGUSER'])
    assert.equal(built.env.PGHOST, '127.0.0.1')
    assert.equal(built.env.PGUSER, 'postgres')
    assert.equal(built.argv.includes('-c'), false)
    assert.equal(built.argv.join(' ').includes(SECRET), false)
    assert.equal(built.probeSql.includes(SECRET), false)
    assert.equal(built.probeSql.includes("current_setting('server_version_num')::int"), true)
    assert.equal(built.probeSql.includes('CREATE ROLE'), false)
    assert.equal(buildT15EPrivateStdinInvocation({
      dataDirectory: PROBE.dataDirectory,
      databasePort: 5432,
      database: 'app_cleanstart_dev',
      databasePassword: SECRET,
    }).ok, false)
  })

  it('does not export a spawn driver or mint from the producer', () => {
    const executor = readFileSync(new URL('../support/native/t15e-private-stdin-executor.ts', import.meta.url), 'utf8')
    const producer = readFileSync(new URL('../support/native/postgres-instance.ts', import.meta.url), 'utf8')
    assert.equal(executor.includes('export function mint'), false)
    assert.equal(executor.includes('process.env'), false)
    assert.equal(executor.includes("'-c'"), false)
    assert.equal(producer.includes('export async function probeOwnedClusterIdentity'), false)
    assert.equal(producer.includes('prepareT15EAppRoleMaintenance'), false)
    assert.match(producer, /function probeOwnedClusterIdentity/)
    assert.match(producer, /env: plan\.env/)
    assert.equal(producer.includes('...process.env'), false)
  })
})

describe('runT15EPrivateStdinChild', () => {
  it('accepts exit 0 plus a complete frame and never reports backend gone', async () => {
    const child = new FakeChild()
    const clock = { now: 1_000, nowEpochMs() { return this.now } }
    const scheduled = timers()
    const pending = runT15EPrivateStdinChild({
      child, stdin: Buffer.from(T15E_PRIVATE_PROBE_SQL), deadlineEpochMs: 5_000, clock,
      scheduleTimer: scheduled.schedule, maxStdoutBytes: 4096, maxStderrBytes: 32, cleanupBudgetMs: 10,
    })
    child.stdoutEvents.emit('data', frame(PROBE))
    child.stderrEvents.emit('data', Buffer.from('ok'))
    child.emitClose(0)
    const result = await pending
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.authority, 'NONE')
    assert.equal(result.backendGoneConfirmed, false)
    assert.equal(result.childExited, true)
    assert.equal(child.ended, true)
    assert.equal(JSON.stringify(result).includes(MARKER), false)
  })

  it('requires both a zero exit and a valid frame', async () => {
    const child = new FakeChild()
    const clock = { now: 1_000, nowEpochMs() { return this.now } }
    const pending = runT15EPrivateStdinChild({
      child, stdin: Buffer.from('select 1;'), deadlineEpochMs: 5_000, clock,
      scheduleTimer: timers().schedule, maxStdoutBytes: 4096, maxStderrBytes: 32, cleanupBudgetMs: 10,
    })
    child.stdoutEvents.emit('data', Buffer.from('not-a-frame\n'))
    child.emitClose(0)
    const missing = await pending
    assert.equal(missing.ok, false)
    if (missing.ok) return
    assert.equal(missing.category, 'T15E_STDIN_FRAME_INVALID')
    assert.equal(missing.backendGoneConfirmed, false)
    const badExit = new FakeChild()
    const pendingExit = runT15EPrivateStdinChild({
      child: badExit, stdin: Buffer.from('select 1;'), deadlineEpochMs: 5_000, clock,
      scheduleTimer: timers().schedule, maxStdoutBytes: 4096, maxStderrBytes: 32, cleanupBudgetMs: 10,
    })
    badExit.stdoutEvents.emit('data', frame(PROBE))
    badExit.emitClose(1)
    const exited = await pendingExit
    assert.equal(exited.ok, false)
    if (exited.ok) return
    assert.equal(exited.category, 'T15E_STDIN_EXIT_FAILED')
  })

  it('discards stderr, fails overflow without persisting it, and does not write after the deadline', async () => {
    const child = new FakeChild()
    const clock = { now: 1_000, nowEpochMs() { return this.now } }
    child.stdin.write = (chunk, callback) => {
      child.writes.push(chunk)
      child.stderrEvents.emit('data', Buffer.from(MARKER))
      child.stdoutEvents.emit('data', frame(PROBE))
      child.emitClose(0)
      callback(null)
    }
    const overflow = await runT15EPrivateStdinChild({
      child, stdin: Buffer.from('select 1;'), deadlineEpochMs: 5_000, clock,
      scheduleTimer: timers().schedule, maxStdoutBytes: 4096, maxStderrBytes: 4, cleanupBudgetMs: 10,
    })
    assert.equal(overflow.ok, false)
    if (overflow.ok) return
    assert.equal(overflow.category, 'T15E_STDIN_STDERR_OVERFLOW')
    assert.equal(JSON.stringify(overflow).includes(MARKER), false)
    assert.equal(overflow.message, T15E_PRIVATE_STDIN_SAFE_MESSAGE)
    const late = new FakeChild()
    const lateClock = { now: 9_000, nowEpochMs() { return this.now } }
    const lateResult = await runT15EPrivateStdinChild({
      child: late, stdin: Buffer.from(SECRET), deadlineEpochMs: 5_000, clock: lateClock,
      scheduleTimer: (ms) => {
        const timer = new FakeTimer(ms)
        setTimeout(() => timer.fire(), 0)
        return timer
      },
      maxStdoutBytes: 4096, maxStderrBytes: 32, cleanupBudgetMs: 10,
    })
    assert.equal(lateResult.ok, false)
    if (lateResult.ok) return
    assert.equal(lateResult.category, 'T15E_STDIN_DEADLINE')
    assert.equal(late.writes.length, 0)
    assert.equal(late.kills[0], 'SIGTERM')
  })

  it('treats a missing close after TERM and KILL as unconfirmed, not backend gone', async () => {
    const child = new FakeChild()
    const clock = { now: 1_000, nowEpochMs() { return this.now } }
    const scheduled = timers()
    const pending = runT15EPrivateStdinChild({
      child, stdin: Buffer.from('select 1;'), deadlineEpochMs: 1_100, clock,
      scheduleTimer: (ms) => {
        const timer = new FakeTimer(ms)
        scheduled.armed.push(timer)
        setTimeout(() => timer.fire(), 0)
        return timer
      },
      maxStdoutBytes: 4096, maxStderrBytes: 32, cleanupBudgetMs: 5,
    })
    const result = await pending
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.category, 'T15E_STDIN_CLEANUP_UNCONFIRMED')
    assert.equal(result.childExited, false)
    assert.equal(result.backendGoneConfirmed, false)
    assert.deepEqual(child.kills, ['SIGTERM', 'SIGKILL'])
  })
})

describe('probe comparison is not observed execution', () => {
  it('matches allocation fields and rejects an unsupported version', () => {
    const record = { dataDir: PROBE.dataDirectory, databasePort: 20111, database: 'app_cleanstart_dev', postmasterPid: 50 }
    assert.equal(matchT15EPrivateProbe(record, PROBE).ok, true)
    assert.equal(matchT15EPrivateProbe(record, { ...PROBE, serverVersionNum: 170000 }).ok, false)
    assert.equal(matchT15EPrivateProbe({ ...record, postmasterPid: null }, PROBE).ok, false)
  })
})

describe('invocation port bounds (Task109)', () => {
  it('enforces TCP port 1..65535 and forbidden ports on an otherwise valid record', () => {
    const base = { dataDirectory: PROBE.dataDirectory, database: 'app_cleanstart_dev', databasePassword: SECRET }
    for (const port of [0, -1, 65536]) {
      assert.equal(buildT15EPrivateStdinInvocation({ ...base, databasePort: port }).ok, false, `port ${port} must be rejected`)
    }
    assert.equal(buildT15EPrivateStdinInvocation({ ...base, databasePort: 3100 }).ok, false)
    assert.equal(buildT15EPrivateStdinInvocation({ ...base, databasePort: 5432 }).ok, false)
    assert.equal(buildT15EPrivateStdinInvocation({ ...base, databasePort: 1 }).ok, true)
    assert.equal(buildT15EPrivateStdinInvocation({ ...base, databasePort: 65535 }).ok, true)
  })
})

describe('frame validation uses raw bytes, not replacement text (Task109)', () => {
  it('rejects a malformed-UTF-8 frame whose trailer matches the replacement-text length', () => {
    const rawJson = Buffer.concat([
      Buffer.from('{"dataDirectory":"/tmp/owned-run/da', 'utf8'),
      Buffer.from([0xff]),
      Buffer.from('","databasePort":20111,"databaseName":"app_cleanstart_dev","serverVersionNum":160001}', 'utf8'),
    ])
    const decodedText = rawJson.toString('utf8')
    assert.equal(Buffer.byteLength(decodedText, 'utf8') === rawJson.length, false) // 0xff becomes a 3-byte replacement
    const attack = Buffer.concat([
      Buffer.from('T15E_STDIN_B1\n', 'utf8'),
      rawJson,
      Buffer.from(`\nT15E_STDIN_E1:${Buffer.byteLength(decodedText, 'utf8')}\n`, 'utf8'),
    ])
    assert.equal(parseT15EPrivateStdinFrame(attack).ok, false)
  })

  it('accepts valid multibyte content and rejects raw-byte boundary violations', () => {
    const emojiProbe = { ...PROBE, dataDirectory: '/tmp/owned-run/\ud83e\udee1-dir' }
    assert.equal(parseT15EPrivateStdinFrame(frame(emojiProbe)).ok, true)
    assert.equal(parseT15EPrivateStdinFrame(frame(PROBE).subarray(0, frame(PROBE).length - 1)).ok, false) // no trailing newline
    assert.equal(parseT15EPrivateStdinFrame(Buffer.from('T15E_STDIN_B1\n\nT15E_STDIN_E1:0\n')).ok, false) // empty JSON span
    assert.equal(parseT15EPrivateStdinFrame(Buffer.from('T15E_STDIN_E1:5\n')).ok, false) // marker before begin
    const mismatched = Buffer.concat([
      Buffer.from('T15E_STDIN_B1\n', 'utf8'),
      Buffer.from(JSON.stringify(PROBE), 'utf8'),
      Buffer.from(`\nT15E_STDIN_E1:${Buffer.byteLength(JSON.stringify(PROBE), 'utf8') + 1}\n`, 'utf8'),
    ])
    assert.equal(parseT15EPrivateStdinFrame(mismatched).ok, false)
  })
})

describe('runT15EPrivateStdinChild stream integrity (Task109)', () => {
  it('latches a stdin error after the write phase even when a valid frame and close 0 arrive late', async () => {
    const child = new FakeChild()
    const clock = { now: 1_000, nowEpochMs() { return this.now } }
    child.stdin.write = (chunk, callback) => {
      child.writes.push(chunk)
      callback(null)
    }
    const pending = runT15EPrivateStdinChild({
      child, stdin: Buffer.from('select 1;'), deadlineEpochMs: 5_000, clock,
      scheduleTimer: timers().schedule, maxStdoutBytes: 4096, maxStderrBytes: 32, cleanupBudgetMs: 10,
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    child.stdinEvents.emit('error', new Error('EPIPE after write phase'))
    child.stdoutEvents.emit('data', frame(PROBE))
    child.emitClose(0)
    const result = await pending
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.category, 'T15E_STDIN_WRITE_FAILED')
    assert.equal(result.backendGoneConfirmed, false)
  })

  it('turns a stdout stream error into a fixed failure instead of an unhandled escape', async () => {
    const child = new FakeChild()
    const clock = { now: 1_000, nowEpochMs() { return this.now } }
    child.stdin.write = (chunk, callback) => {
      child.writes.push(chunk)
      callback(null)
    }
    const pending = runT15EPrivateStdinChild({
      child, stdin: Buffer.from('select 1;'), deadlineEpochMs: 5_000, clock,
      scheduleTimer: timers().schedule, maxStdoutBytes: 4096, maxStderrBytes: 32, cleanupBudgetMs: 10,
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    child.stdoutEvents.emit('error', new Error('stdout pipe broken'))
    child.stdoutEvents.emit('data', frame(PROBE))
    child.emitClose(0)
    const result = await pending
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.category, 'T15E_STDIN_STREAM_FAILED')
  })

  it('wakes the active wait on a latched stream error instead of blocking until the deadline', { timeout: 3_000 }, async () => {
    const child = new FakeChild()
    const clock = { now: 1_000, nowEpochMs() { return this.now } }
    child.stdin.write = (chunk, callback) => {
      child.writes.push(chunk)
      callback(null)
    }
    const pending = runT15EPrivateStdinChild({
      child, stdin: Buffer.from('select 1;'), deadlineEpochMs: 60_000, clock,
      scheduleTimer: (ms) => {
        const timer = new FakeTimer(ms)
        setTimeout(() => timer.fire(), 0)
        return timer
      }, maxStdoutBytes: 4096, maxStderrBytes: 32, cleanupBudgetMs: 10,
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    child.stdoutEvents.emit('error', new Error('stdout pipe broken before close'))
    const result = await pending
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.category, 'T15E_STDIN_CLEANUP_UNCONFIRMED')
    assert.deepEqual(child.kills, ['SIGTERM', 'SIGKILL'])
    assert.equal(child.stdoutEvents.listenerCount('data'), 0)
    assert.equal(child.stderrEvents.listenerCount('data'), 0)
  })

  it('stops accepting stdout data past the limit instead of retaining overflow bytes', async () => {
    const child = new FakeChild()
    const clock = { now: 1_000, nowEpochMs() { return this.now } }
    child.stdin.write = (chunk, callback) => {
      child.writes.push(chunk)
      callback(null)
    }
    const pending = runT15EPrivateStdinChild({
      child, stdin: Buffer.from('select 1;'), deadlineEpochMs: 5_000, clock,
      scheduleTimer: timers().schedule, maxStdoutBytes: 32, maxStderrBytes: 32, cleanupBudgetMs: 10,
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    child.stdoutEvents.emit('data', Buffer.alloc(64, 0x41))
    child.stdoutEvents.emit('data', Buffer.alloc(64, 0x41))
    child.emitClose(0)
    const result = await pending
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.category, 'T15E_STDIN_STDOUT_OVERFLOW')
    assert.equal(child.stdoutEvents.listenerCount('data'), 0)
  })

  it('needs exactly one close for success and installs no sinks on already-closed targets', async () => {
    const child = new FakeChild()
    const clock = { now: 1_000, nowEpochMs() { return this.now } }
    child.stdin.write = (chunk, callback) => {
      child.writes.push(chunk)
      callback(null)
    }
    const pending = runT15EPrivateStdinChild({
      child, stdin: Buffer.from('select 1;'), deadlineEpochMs: 5_000, clock,
      scheduleTimer: timers().schedule, maxStdoutBytes: 4096, maxStderrBytes: 32, cleanupBudgetMs: 10,
    })
    child.stdoutEvents.emit('data', frame(PROBE))
    child.stdoutEvents.emit('close')
    child.stderrEvents.emit('close')
    child.stdinEvents.emit('close')
    child.emitClose(0)
    const result = await pending
    assert.equal(result.ok, true)
    // Everything closed before settlement: nothing may remain attached.
    assert.equal(child.stdoutEvents.listenerCount('data'), 0)
    assert.equal(child.stdoutEvents.listenerCount('error'), 0)
    assert.equal(child.stdoutEvents.listenerCount('close'), 0)
    assert.equal(child.stderrEvents.listenerCount('data'), 0)
    assert.equal(child.stderrEvents.listenerCount('error'), 0)
    assert.equal(child.stderrEvents.listenerCount('close'), 0)
    assert.equal(child.stdinEvents.listenerCount('error'), 0)
    assert.equal(child.stdinEvents.listenerCount('close'), 0)
    assert.equal(child.events.listenerCount('close'), 0)
    assert.equal(child.events.listenerCount('error'), 0)
  })

  it('guards each listener removal so one bad off never skips the others', async () => {
    const child = new FakeChild()
    const clock = { now: 1_000, nowEpochMs() { return this.now } }
    child.failStdoutOff = true
    child.stdin.write = (chunk, callback) => {
      child.writes.push(chunk)
      callback(null)
    }
    const pending = runT15EPrivateStdinChild({
      child, stdin: Buffer.from('select 1;'), deadlineEpochMs: 5_000, clock,
      scheduleTimer: timers().schedule, maxStdoutBytes: 4096, maxStderrBytes: 32, cleanupBudgetMs: 10,
    })
    child.stdoutEvents.emit('data', frame(PROBE))
    child.emitClose(0)
    const result = await pending
    assert.equal(result.ok, true)
    assert.equal(child.stderrEvents.listenerCount('data'), 0)
    // The throwing stdout off left the payload data listener attached; late
    // data on THAT stream must stay a terminal no-op and cannot rebuild the
    // dropped buffers.
    assert.equal(child.stdoutEvents.listenerCount('data'), 1)
    child.stdoutEvents.emit('data', Buffer.alloc(64, 0x41))
    child.stdoutEvents.emit('data', Buffer.alloc(64, 0x41))
    child.stderrEvents.emit('data', Buffer.from('x'))
    child.stdinEvents.emit('error', new Error('late stdin error consumed by sink'))
  })

  it('parses a multibyte frame partitioned across data chunks', async () => {
    const child = new FakeChild()
    const clock = { now: 1_000, nowEpochMs() { return this.now } }
    child.stdin.write = (chunk, callback) => {
      child.writes.push(chunk)
      callback(null)
    }
    const pending = runT15EPrivateStdinChild({
      child, stdin: Buffer.from('select 1;'), deadlineEpochMs: 5_000, clock,
      scheduleTimer: timers().schedule, maxStdoutBytes: 4096, maxStderrBytes: 32, cleanupBudgetMs: 10,
    })
    const whole = frame({ ...PROBE, dataDirectory: '/tmp/owned-run/\ud83e\udee1-dir' })
    const emojiAt = whole.indexOf(Buffer.from('\ud83e\udee1', 'utf8'))
    const split = emojiAt + 2 // split inside the 4-byte emoji sequence
    child.stdoutEvents.emit('data', whole.subarray(0, split))
    child.stdoutEvents.emit('data', whole.subarray(split))
    child.emitClose(0)
    const result = await pending
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.result.dataDirectory, '/tmp/owned-run/\ud83e\udee1-dir')
  })
})

describe('runT15EPrivateStdinChild finalization (Task109B)', () => {
  it('starts cleanup from a synchronous write-phase stream error without waiting for the main deadline', { timeout: 3_000 }, async () => {
    const child = new FakeChild()
    const clock = { now: 1_000, nowEpochMs() { return this.now } }
    const armed: FakeTimer[] = []
    const schedule = (ms: number) => {
      const timer = new FakeTimer(ms)
      armed.push(timer)
      return timer
    }
    child.stdin.write = (chunk, _callback) => {
      child.writes.push(chunk)
      // Synchronous terminal failure during the write call, and the write
      // callback itself is never invoked.
      child.stdoutEvents.emit('error', new Error('sync stdout failure during write'))
    }
    const pending = runT15EPrivateStdinChild({
      child, stdin: Buffer.from('select 1;'), deadlineEpochMs: 5_000, clock,
      scheduleTimer: schedule, maxStdoutBytes: 4096, maxStderrBytes: 32, cleanupBudgetMs: 5,
    })
    // Separately controlled cleanup timers: only the small cleanup-budget
    // timers are stepped; the 4000ms main-deadline timer stays held. The race
    // makes the pre-fix hang a clean, bounded failure instead.
    let bailTimer: NodeJS.Timeout | undefined
    const bail = new Promise<never>((_, reject) => {
      bailTimer = setTimeout(() => reject(new Error('run did not settle without the main deadline timer')), 1_500)
    })
    const stepCleanupTimers = setInterval(() => {
      for (const timer of armed) if (timer.ms <= 5) timer.fire()
    }, 1)
    let result: Awaited<ReturnType<typeof runT15EPrivateStdinChild>>
    try {
      result = await Promise.race([pending, bail])
    } finally {
      clearInterval(stepCleanupTimers)
      if (bailTimer !== undefined) clearTimeout(bailTimer)
    }
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.category, 'T15E_STDIN_CLEANUP_UNCONFIRMED')
    assert.deepEqual(child.kills, ['SIGTERM', 'SIGKILL'])
    const main = armed.find((timer) => timer.ms >= 1_000)
    // cancel() only marks cancelled when the timer never fired: the main
    // deadline timer must have been cancelled, not consumed.
    assert.equal(main !== undefined && main.cancelled, true)
  })

  it('keeps terminal protection on open targets after unconfirmed disposal until their single close', async () => {
    const child = new FakeChild()
    const clock = { now: 1_000, nowEpochMs() { return this.now } }
    const scheduled = timers()
    const pending = runT15EPrivateStdinChild({
      child, stdin: Buffer.from('select 1;'), deadlineEpochMs: 1_100, clock,
      scheduleTimer: (ms) => {
        const timer = new FakeTimer(ms)
        scheduled.armed.push(timer)
        setTimeout(() => timer.fire(), 0)
        return timer
      },
      maxStdoutBytes: 4096, maxStderrBytes: 32, cleanupBudgetMs: 5,
    })
    const result = await pending
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.category, 'T15E_STDIN_CLEANUP_UNCONFIRMED')
    assert.equal(child.stdoutEvents.listenerCount('data'), 0)
    assert.equal(child.stderrEvents.listenerCount('data'), 0)
    // Open targets keep minimal terminal protection: a late error cannot
    // escape, and the single eventual close removes each sink.
    assert.equal(child.stdoutEvents.listenerCount('error'), 1)
    assert.equal(child.events.listenerCount('error'), 1)
    child.stdoutEvents.emit('error', new Error('late error on still-open stream'))
    child.events.emit('error', new Error('late child error'))
    child.stdoutEvents.emit('close')
    assert.equal(child.stdoutEvents.listenerCount('error'), 0)
    assert.equal(child.stdoutEvents.listenerCount('close'), 0)
    child.events.emit('close', 1, null)
    assert.equal(child.events.listenerCount('error'), 0)
    assert.equal(child.events.listenerCount('close'), 0)
  })

  it('captures caller input into primitives and keeps sinks out of the payload scope', () => {
    const source = readFileSync(new URL('../support/native/t15e-private-stdin-executor.ts', import.meta.url), 'utf8')
    const runAt = source.indexOf('export async function runT15EPrivateStdinChild')
    const body = source.slice(runAt)
    const countOf = (needle: string) => body.split(needle).length - 1
    // The deadline and payload are read exactly once into locals: no later
    // callback can transitively retain the caller input object.
    assert.equal(countOf('input.deadlineEpochMs'), 1)
    assert.equal(countOf('input.stdin'), 1)
    assert.equal(countOf('input.maxStdoutBytes'), 1)
    assert.equal(countOf('input.maxStderrBytes'), 1)
    assert.equal(countOf('input.cleanupBudgetMs'), 1)
    // Minimal error/close sinks live in module-level helpers capturing only
    // the target handle, not in the executor's payload lexical scope.
    assert.match(source, /function installStreamTerminalErrorSink\(/)
    assert.match(source, /function installChildTerminalErrorSink\(/)
    assert.equal(body.includes('childSinkError'), false)
    const detachAt = body.indexOf('const detach = () =>')
    const detachBody = body.slice(detachAt, body.indexOf('\n  try {', detachAt))
    // BOTH collectors go terminal before any listener-removal attempt, so a
    // throwing off can never leave a live data path behind.
    assert.ok(detachBody.indexOf('stdoutDone = true') >= 0 && detachBody.indexOf('stdoutDone = true') < detachBody.indexOf('off('), 'detach must mark stdoutDone before any off')
    assert.ok(detachBody.indexOf('stderrDone = true') >= 0 && detachBody.indexOf('stderrDone = true') < detachBody.indexOf('off('), 'detach must mark stderrDone before any off')
  })
})

/** Timer whose cancel() throws: disposal failure must never strand the wait. */
class CancelThrowTimer extends FakeTimer {
  constructor(ms: number) {
    super(ms)
  }
  cancel() { throw new Error('timer cancel threw') }
}

/** Timer whose fired promise rejects: must wake a fixed failure, not hang. */
function rejectingFiredTimer(ms: number): T15EArmedTimer {
  let release: () => void = () => undefined
  let reject: (error: Error) => void = () => undefined
  const fired = new Promise<void>((resolve, r) => { release = resolve; reject = r })
  const timer: T15EArmedTimer = {
    ms,
    fired,
    cancel() { /* nothing scheduled for real */ void release },
  }
  queueMicrotask(() => reject(new Error('timer fired rejected')))
  return timer
}

describe('runT15EPrivateStdinChild deadline/timer ownership (Task110)', () => {
  it('rejects a late valid frame plus close(0) when the clock passed the deadline with the timer held', async () => {
    const child = new FakeChild()
    const clock = { now: 1_000, nowEpochMs() { return this.now } }
    child.stdin.write = (chunk, callback) => {
      child.writes.push(chunk)
      callback(null)
    }
    const pending = runT15EPrivateStdinChild({
      child, stdin: Buffer.from('select 1;'), deadlineEpochMs: 5_000, clock,
      scheduleTimer: () => new FakeTimer(4_000), // main timer held pending forever
      maxStdoutBytes: 4096, maxStderrBytes: 32, cleanupBudgetMs: 10,
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    clock.now = 5_000 // exact deadline: expired
    child.stdoutEvents.emit('data', frame(PROBE))
    child.emitClose(0)
    const result = await pending
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.category, 'T15E_STDIN_DEADLINE')
    assert.equal(result.childExited, true)
    assert.equal(result.backendGoneConfirmed, false)
  })

  it('performs no stdin.end() from a write callback delivered after a terminal timeout and cleanup', async () => {
    const child = new FakeChild()
    const clock = { now: 1_000, nowEpochMs() { return this.now } }
    let heldCallback: ((error?: Error | null) => void) | null = null
    child.stdin.write = (chunk, callback) => {
      child.writes.push(chunk)
      heldCallback = callback // deferred, never invoked by the fake itself
    }
    const pending = runT15EPrivateStdinChild({
      child, stdin: Buffer.from('select 1;'), deadlineEpochMs: 5_000, clock,
      scheduleTimer: (ms) => {
        const timer = new FakeTimer(ms)
        setTimeout(() => timer.fire(), 0)
        return timer
      },
      maxStdoutBytes: 4096, maxStderrBytes: 32, cleanupBudgetMs: 10,
    })
    child.emitClose(0) // cleanup can confirm later
    const result = await pending
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.category, 'T15E_STDIN_DEADLINE')
    assert.equal(child.endCalls, 0)
    assert.equal(child.ended, false)
    // The deferred callback arrives AFTER disposal: no late IO, no success
    // resurrection, and a late failure must be consumed without escaping.
    const deliverHeld = (error: Error | null) => {
      const cb: ((error?: Error | null) => void) | null = heldCallback
      if (cb !== null) cb(error)
    }
    deliverHeld(null)
    deliverHeld(new Error('late EPIPE'))
    assert.equal(child.endCalls, 0)
    assert.equal(child.ended, false)
  })

  it('calls stdin.end() exactly once for a normal write callback', async () => {
    const child = new FakeChild()
    const clock = { now: 1_000, nowEpochMs() { return this.now } }
    child.stdin.write = (chunk, callback) => {
      child.writes.push(chunk)
      callback(null)
      callback(null) // defensive double delivery must not end twice
    }
    const pending = runT15EPrivateStdinChild({
      child, stdin: Buffer.from('select 1;'), deadlineEpochMs: 5_000, clock,
      scheduleTimer: timers().schedule, maxStdoutBytes: 4096, maxStderrBytes: 32, cleanupBudgetMs: 10,
    })
    child.stdoutEvents.emit('data', frame(PROBE))
    child.emitClose(0)
    const result = await pending
    assert.equal(result.ok, true)
    assert.equal(child.endCalls, 1)
  })

  it('resolves despite a throwing timer cancel and reports a fixed timer failure, not success', async () => {
    const child = new FakeChild()
    const clock = { now: 1_000, nowEpochMs() { return this.now } }
    child.stdin.write = (chunk, callback) => {
      child.writes.push(chunk)
      callback(null)
    }
    const pending = runT15EPrivateStdinChild({
      child, stdin: Buffer.from('select 1;'), deadlineEpochMs: 5_000, clock,
      scheduleTimer: (ms) => new CancelThrowTimer(ms),
      maxStdoutBytes: 4096, maxStderrBytes: 32, cleanupBudgetMs: 10,
    })
    child.stdoutEvents.emit('data', frame(PROBE))
    child.emitClose(0)
    const result = await pending // must not reject or hang
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.category, 'T15E_STDIN_TIMER_FAILED')
    assert.equal(result.childExited, true)
    assert.equal(result.backendGoneConfirmed, false)
  })

  it('a rejecting timer.fired wakes a fixed failure with owned cleanup instead of hanging', async () => {
    const child = new FakeChild()
    const clock = { now: 1_000, nowEpochMs() { return this.now } }
    child.stdin.write = (chunk, _callback) => {
      child.writes.push(chunk) // callback never delivered
    }
    const pending = runT15EPrivateStdinChild({
      child, stdin: Buffer.from('select 1;'), deadlineEpochMs: 5_000, clock,
      scheduleTimer: (ms) => rejectingFiredTimer(ms),
      maxStdoutBytes: 4096, maxStderrBytes: 32, cleanupBudgetMs: 10,
    })
    child.emitClose(0) // cleanup confirms via the already-closed child
    const result = await pending // must not hang; rejection consumed
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.category, 'T15E_STDIN_TIMER_FAILED')
    assert.equal(result.childExited, true)
  })

  it('a synchronously throwing scheduler returns a bounded fixed failure and still attempts cleanup', async () => {
    const child = new FakeChild()
    const clock = { now: 1_000, nowEpochMs() { return this.now } }
    child.stdin.write = (chunk, _callback) => {
      child.writes.push(chunk)
    }
    const pending = runT15EPrivateStdinChild({
      child, stdin: Buffer.from('select 1;'), deadlineEpochMs: 5_000, clock,
      scheduleTimer: (ms: number) => { throw new Error('scheduler threw') },
      maxStdoutBytes: 4096, maxStderrBytes: 32, cleanupBudgetMs: 10,
    })
    child.emitClose(0)
    const result = await pending // must not reject or hang
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.category, 'T15E_STDIN_TIMER_FAILED')
    assert.equal(result.childExited, true)
  })
})

/** Timer whose cancel() re-enters with the held write callback: ownership
 * must already be revoked when cancellation runs. */
class CancelInvokesCallbackTimer extends FakeTimer {
  constructor(ms: number, private readonly onCancel: () => void) {
    super(ms)
  }
  cancel() {
    super.cancel()
    this.onCancel()
  }
}

describe('runT15EPrivateStdinChild write ownership and wait hygiene (Task110B)', () => {
  it('checks the deadline before stdin.end() in the write callback with the timer held', async () => {
    for (const nowAtDeadline of [true, false]) {
      const child = new FakeChild()
      const clock = { now: 1_000, nowEpochMs() { return this.now } }
      let heldCallback: ((error?: Error | null) => void) | null = null
      child.stdin.write = (chunk, callback) => {
        child.writes.push(chunk)
        heldCallback = callback
      }
      const pending = runT15EPrivateStdinChild({
        child, stdin: Buffer.from('select 1;'), deadlineEpochMs: 5_000, clock,
        scheduleTimer: () => new FakeTimer(4_000), // main timer held pending
        maxStdoutBytes: 4096, maxStderrBytes: 32, cleanupBudgetMs: 10,
      })
      await new Promise<void>((resolve) => setImmediate(resolve))
      clock.now = nowAtDeadline ? 5_000 : 6_000 // exact and past deadline
      const deliver = (error: Error | null) => {
        const cb: ((error?: Error | null) => void) | null = heldCallback
        if (cb !== null) cb(error)
      }
      deliver(null)
      child.emitClose(0)
      const result = await pending
      assert.equal(result.ok, false)
      if (result.ok) return
      assert.equal(result.category, 'T15E_STDIN_DEADLINE')
      assert.equal(child.endCalls, 0, `end must not run at clock=${clock.now}`)
      assert.equal(child.ended, false)
    }
  })

  it('revokes write ownership synchronously at settlement, before timer cancel re-enters the callback', async () => {
    const child = new FakeChild()
    const clock = { now: 1_000, nowEpochMs() { return this.now } }
    let heldCallback: ((error?: Error | null) => void) | null = null
    child.stdin.write = (chunk, callback) => {
      child.writes.push(chunk)
      heldCallback = callback
    }
    const armed: FakeTimer[] = []
    const pending = runT15EPrivateStdinChild({
      child, stdin: Buffer.from('select 1;'), deadlineEpochMs: 5_000, clock,
      scheduleTimer: (ms) => {
        const timer = new CancelInvokesCallbackTimer(ms, () => {
          const cb: ((error?: Error | null) => void) | null = heldCallback
          if (cb !== null) cb(null)
        })
        armed.push(timer)
        return timer
      },
      maxStdoutBytes: 4096, maxStderrBytes: 32, cleanupBudgetMs: 10,
    })
    child.emitClose(0) // cleanup confirms via the already-closed child
    await new Promise<void>((resolve) => setImmediate(resolve))
    armed[0].fire() // main write timer settles the wait; cancel re-enters
    const result = await pending
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.category, 'T15E_STDIN_DEADLINE')
    assert.equal(child.endCalls, 0)
    assert.equal(child.ended, false)
  })

  it('a synchronous write throw plus scheduler throw stays a fixed failure with no unhandled rejection', { timeout: 3_000 }, async () => {
    const child = new FakeChild()
    const clock = { now: 1_000, nowEpochMs() { return this.now } }
    child.stdin.write = () => { throw new Error('sync write throw') }
    const pending = runT15EPrivateStdinChild({
      child, stdin: Buffer.from('select 1;'), deadlineEpochMs: 5_000, clock,
      scheduleTimer: () => { throw new Error('scheduler threw') },
      maxStdoutBytes: 4096, maxStderrBytes: 32, cleanupBudgetMs: 10,
    })
    child.emitClose(0)
    const result = await pending
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.category, 'T15E_STDIN_TIMER_FAILED')
    assert.equal(result.childExited, true)
  })

  it('consumes a late deferred write rejection even on the exhausted-budget early-return path', { timeout: 3_000 }, async () => {
    const child = new FakeChild()
    // Jitter clock: not expired at the entry check, already past the deadline
    // when the write budget is computed (budget <= 0 early return).
    const clock = { calls: 0, nowEpochMs() { this.calls += 1; return this.calls === 1 ? 1_000 : 6_000 } }
    let heldCallback: ((error?: Error | null) => void) | null = null
    child.stdin.write = (chunk, callback) => {
      child.writes.push(chunk)
      heldCallback = callback
    }
    const pending = runT15EPrivateStdinChild({
      child, stdin: Buffer.from('select 1;'), deadlineEpochMs: 5_000, clock,
      scheduleTimer: () => new FakeTimer(4_000),
      maxStdoutBytes: 4096, maxStderrBytes: 32, cleanupBudgetMs: 10,
    })
    child.emitClose(0)
    const result = await pending
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.category, 'T15E_STDIN_DEADLINE')
    assert.equal(child.endCalls, 0)
    // Deferred rejection arrives AFTER the run settled: must be consumed on
    // the early-return path, never an unhandled rejection.
    const deliver = () => {
      const cb: ((error?: Error | null) => void) | null = heldCallback
      if (cb !== null) cb(new Error('late write rejection'))
    }
    deliver()
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
  })

  it('open-child cleanup stays bounded and unconfirmed across cancellation, rejection, and scheduler failures', { timeout: 3_000 }, async () => {
    const runCase = async (mode: 'cancel-throw' | 'close-reject' | 'cleanup-reject' | 'cleanup-scheduler'): Promise<void> => {
      const child = new FakeChild()
      const clock = { now: 1_000, nowEpochMs() { return this.now } }
      const armed: FakeTimer[] = []
      const schedule = (ms: number): T15EArmedTimer => {
        if (mode === 'cancel-throw') {
          const timer = new CancelThrowTimer(ms)
          armed.push(timer)
          return timer
        }
        if (mode === 'close-reject') {
          if (ms >= 1_000) return rejectingFiredTimer(ms)
          const small = new FakeTimer(ms)
          armed.push(small)
          return small
        }
        if (mode === 'cleanup-reject') {
          if (ms <= 10) return rejectingFiredTimer(ms)
          const big = new FakeTimer(ms)
          armed.push(big)
          return big
        }
        if (ms <= 10) throw new Error('cleanup scheduler threw')
        const held = new FakeTimer(ms)
        armed.push(held)
        return held
      }
      child.stdin.write = (chunk, callback) => {
        child.writes.push(chunk)
        callback(null)
      }
      const pending = runT15EPrivateStdinChild({
        child, stdin: Buffer.from('select 1;'), deadlineEpochMs: 5_000, clock,
        scheduleTimer: schedule, maxStdoutBytes: 4096, maxStderrBytes: 32, cleanupBudgetMs: 10,
      })
      // No fabricated close: the child stays open the whole time. Every
      // FakeTimer-compatible timer is stepped (fire() is idempotent), so the
      // held close-wait and each bounded cleanup wait settle by its own timer.
      const stepTimers = setInterval(() => {
        for (const timer of armed) timer.fire()
      }, 1)
      let bailTimer: NodeJS.Timeout | undefined
      const bail = new Promise<never>((_, reject) => {
        bailTimer = setTimeout(() => reject(new Error(`case ${mode} did not settle`)), 1_500)
      })
      let result: Awaited<ReturnType<typeof runT15EPrivateStdinChild>>
      try {
        result = await Promise.race([pending, bail])
      } finally {
        clearInterval(stepTimers)
        if (bailTimer !== undefined) clearTimeout(bailTimer)
      }
      assert.equal(result.ok, false)
      if (result.ok) return
      assert.equal(result.category, 'T15E_STDIN_CLEANUP_UNCONFIRMED', `case ${mode}`)
      assert.equal(result.childExited, false, `case ${mode}`)
      assert.equal(result.backendGoneConfirmed, false, `case ${mode}`)
      assert.deepEqual(child.kills, ['SIGTERM', 'SIGKILL'], `case ${mode}`)
    }
    await runCase('cancel-throw')
    await runCase('close-reject')
    await runCase('cleanup-reject')
    await runCase('cleanup-scheduler')
  })
})
