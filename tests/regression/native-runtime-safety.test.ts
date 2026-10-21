import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs, existsSync as fsSyncExists } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  allocateDistinctLoopbackPorts,
  buildEvidenceIndex,
  buildOutboundAllowlistSpec,
  buildSpawnEnvironment,
  assertNoProtectedEnvironmentKeys,
  createRunId,
  decideDnsLookup,
  decideOutboundConnection,
  formatAllowlistEnv,
  generateDatabasePassword,
  generateE2ePassword,
  isOwnedRunId,
  isValidPort,
  parseAllowlistEnv,
  FORBIDDEN_SHARED_PORTS,
  type EvidenceEntry,
} from '../support/native/native-environment'
import {
  postmasterCommandIsOwned,
  readPostmasterPid,
} from '../support/native/postgres-instance'
import {
  startMailCapture,
  summarizeCapturedMessages,
} from '../support/native/mail-capture'

// Anchor on this module's real file location (import.meta.dirname is NOT
// populated under tsx): tests/regression/../support/native/….
const PRELOAD = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'support',
  'native',
  'outbound-allowlist-preload.js',
)
if (!fsSyncExists(PRELOAD)) {
  throw new Error(`preload module missing at ${PRELOAD} — native safety suite cannot run`)
}

describe('native runtime owned identity', () => {
  it('mints owned run ids, strong run-generated passwords, and fixture-only e2e passwords', () => {
    const runId = createRunId()
    assert.ok(isOwnedRunId(runId), runId)
    assert.equal(isOwnedRunId('business-test-not-a-timestamp'), false)
    assert.equal(isOwnedRunId('/etc/passwd'), false)
    for (let i = 0; i < 20; i++) {
      const password = generateDatabasePassword()
      assert.ok(password.length >= 24, 'SCRAM password must have >=192 bits of entropy in URL-safe form')
      assert.match(password, /^[A-Za-z0-9_-]+$/, 'password must be shell-safe')
      assert.ok(generateE2ePassword().startsWith('business-e2e-'))
      assert.notEqual(password, generateDatabasePassword())
    }
  })

  it('allocates three distinct valid loopback ports and never shares them', async () => {
    const listening = new Set<number>()
    const probe = async (port: number) => listening.has(port)
    const ports = await allocateDistinctLoopbackPorts(probe)
    const values = [ports.databasePort, ports.serverPort, ports.mailPort]
    assert.equal(new Set(values).size, 3)
    for (const port of values) {
      assert.ok(isValidPort(port), String(port))
      assert.equal(FORBIDDEN_SHARED_PORTS.has(port), false, 'allocator must never pick a shared port')
    }
  })

  it('fails bounded (no hang) when every candidate port is busy', async () => {
    await assert.rejects(
      () => allocateDistinctLoopbackPorts(async () => true),
      /could not allocate 3 distinct free loopback ports/,
    )
  })
})

describe('outbound connection allowlist (fail-closed)', () => {
  const spec = buildOutboundAllowlistSpec({
    ports: { databasePort: 20111, serverPort: 20222, mailPort: 20333 },
    unixSocketPrefixes: ['/owned/tmp/pgsocket'],
  })

  it('allows exactly the owned numeric loopback ports', () => {
    assert.deepEqual(decideOutboundConnection(spec, { host: '127.0.0.1', port: 20111 }), { allowed: true })
    assert.deepEqual(decideOutboundConnection(spec, { host: '127.0.0.1', port: 20222 }), { allowed: true })
    assert.deepEqual(decideOutboundConnection(spec, { host: '127.0.0.1', port: 20333 }), { allowed: true })
  })

  it('rejects external SMTP hosts before any DNS or packet', () => {
    const verdict = decideOutboundConnection(spec, { host: 'smtp.example.com', port: 587 })
    assert.equal(verdict.allowed, false)
    assert.match(verdict.allowed ? '' : verdict.reason, /non-loopback or unresolved/)
    assert.equal(decideOutboundConnection(spec, { host: 'mail.internal.corp', port: 25 }).allowed, false)
  })

  it('rejects wrong localhost services (shared postgres, app on 3100, arbitrary port)', () => {
    for (const port of [5432, 3100, 1, 99999]) {
      const verdict = decideOutboundConnection(spec, { host: '127.0.0.1', port })
      assert.equal(verdict.allowed, false, `port ${port} must be rejected`)
      assert.match(verdict.allowed ? '' : verdict.reason, /not an owned runtime port/)
    }
  })

  it('rejects non-canonical loopback forms, missing ports and unknown unix sockets', () => {
    assert.equal(decideOutboundConnection(spec, { host: '127.0.0.2', port: 20111 }).allowed, false)
    assert.equal(decideOutboundConnection(spec, { host: '0.0.0.0', port: 20111 }).allowed, false)
    assert.equal(decideOutboundConnection(spec, { host: '127.0.0.1' }).allowed, false)
    assert.equal(decideOutboundConnection(spec, { path: '/tmp/other.sock' }).allowed, false)
    assert.deepEqual(decideOutboundConnection(spec, { path: '/owned/tmp/pgsocket/.s.PGSQL.20111' }), { allowed: true })
  })

  it('only resolves allowed hostnames to loopback', () => {
    assert.deepEqual(decideDnsLookup(spec, 'localhost', ['127.0.0.1']), { allowed: true })
    assert.equal(decideDnsLookup(spec, 'smtp.example.com', ['93.184.216.34']).allowed, false)
    assert.equal(decideDnsLookup(spec, 'localhost', ['10.0.0.5']).allowed, false)
  })

  it('round-trips through the env format the preload consumes', () => {
    const parsed = parseAllowlistEnv(formatAllowlistEnv(spec))
    assert.ok(parsed)
    assert.deepEqual(decideOutboundConnection(parsed, { host: '127.0.0.1', port: 20333 }), { allowed: true })
    assert.equal(parseAllowlistEnv(undefined), null)
    assert.equal(parseAllowlistEnv('not json'), null)
    assert.equal(parseAllowlistEnv('{"mode":"PERMISSIVE","tcp":{}}'), null)
  })
})

describe('outbound allowlist preload (real process behavior)', () => {
  const spec = buildOutboundAllowlistSpec({
    ports: { databasePort: 0, serverPort: 0, mailPort: 0 },
    unixSocketPrefixes: [],
  })

  let server: net.Server
  let ownedPort = 0
  let allowlistValue = ''

  before(async () => {
    await new Promise<void>((resolve) => {
      server = net.createServer((socket) => socket.end('ok\n'))
      server.listen(0, '127.0.0.1', () => {
        ownedPort = (server.address() as net.AddressInfo).port
        const fullSpec = buildOutboundAllowlistSpec({
          ports: { databasePort: ownedPort, serverPort: ownedPort + 1, mailPort: ownedPort + 2 },
          unixSocketPrefixes: [],
        })
        allowlistValue = formatAllowlistEnv(fullSpec)
        resolve()
      })
    })
  })

  after(() => new Promise<void>((resolve) => server.close(() => resolve())))

  function runNode(script: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, ['--require', PRELOAD, '-e', script], {
        env: {
          PATH: process.env.PATH ?? '/usr/bin:/bin',
          BUSINESS_NET_ALLOWLIST: allowlistValue,
        } as unknown as NodeJS.ProcessEnv,
        stdio: ['ignore', 'pipe', 'pipe'] as const,
      })
      let stdout = ''
      let stderr = ''
      // Bounded: a child that never exits (hung socket) is killed after 10s
      // and reported as a failure instead of wedging the whole suite.
      const killer = setTimeout(() => {
        stderr += '\n[runNode] killed after 10000ms timeout'
        child.kill('SIGKILL')
      }, 10_000)
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk })
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk })
      child.on('close', (code) => {
        clearTimeout(killer)
        resolve({ code, stdout, stderr })
      })
    })
  }

  it('lets the app connect to an owned port', async () => {
    const result = await runNode(`
      const net = require('node:net')
      const socket = net.connect(${ownedPort}, '127.0.0.1')
      socket.once('data', (data) => { console.log('RECEIVED', String(data).trim()); socket.end() })
      socket.once('error', (error) => { console.log('ERROR', error.code); process.exit(1) })
    `)
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stdout, /RECEIVED ok/)
  })

  it('blocks a wrong localhost service (not an owned port) with a guard error', async () => {
    const result = await runNode(`
      const net = require('node:net')
      const socket = net.connect(5432, '127.0.0.1')
      socket.once('error', (error) => { console.log('BLOCKED', error.code); process.exit(0) })
      setTimeout(() => { console.log('NOT_BLOCKED'); process.exit(1) }, 3000)
    `)
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stdout, /BLOCKED EBUSINESSNETGUARD/)
    assert.match(result.stderr, /not an owned runtime port/)
  })

  it('blocks external SMTP at connect time and refuses its DNS resolution', async () => {
    const result = await runNode(`
      const net = require('node:net')
      const dns = require('node:dns')
      let pending = 2
      const done = () => { if (--pending === 0) process.exit(0) }
      dns.lookup('smtp.example.test', (error) => {
        console.log('DNS_BLOCKED', error ? error.code : 'RESOLVED')
        if (!error || error.code !== 'EBUSINESSNETGUARD') process.exit(1)
        done()
      })
      const socket = net.connect(587, 'smtp.example.test')
      socket.once('error', (error) => {
        console.log('BLOCKED', error.code)
        if (error.code !== 'EBUSINESSNETGUARD') process.exit(1)
        done()
      })
      setTimeout(() => { console.log('NOT_BLOCKED'); process.exit(1) }, 3000)
    `)
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stdout, /BLOCKED EBUSINESSNETGUARD/)
    assert.match(result.stdout, /DNS_BLOCKED EBUSINESSNETGUARD/)
    assert.match(result.stderr, /non-loopback or unresolved host not allowed/)
    assert.match(result.stderr, /DNS resolution is not allowed/)
  })
})

describe('fail-closed SMTP capture endpoint', () => {
  it('retains raw messages sent by an SMTP client and summarizes them safely', async () => {
    const handle = await startMailCapture({ host: '127.0.0.1', port: 0 as unknown as number }).catch(() => null)
    // Port 0 is not a valid explicit plan port; the shared safety module must
    // reject it, proving the capture inherits the fail-closed plan contract.
    assert.equal(handle, null, 'capture must refuse non-explicit ports')

    const net = await import('node:net')
    const bind = await new Promise<number>((resolve) => {
      const probe = net.createServer((socket) => socket.end())
      probe.listen(0, '127.0.0.1', () => {
        const port = (probe.address() as net.AddressInfo).port
        probe.close(() => resolve(port))
      })
    })
    const capture = await startMailCapture({ host: '127.0.0.1', port: bind })
    try {
      const conversation = [
        'EHLO app',
        'MAIL FROM:<business-workflow-test@example.test>',
        'RCPT TO:<user-supervisor-p@business.test>',
        'RCPT TO:<user-section-manager-p@business.test>',
        'DATA',
        'Subject: approval_needed T01\r\nFrom: business-workflow-test@example.test\r\nTo: user-supervisor-p@business.test\r\n\r\nfixture-only body',
        '.',
        'QUIT',
      ]
      const socket = net.createConnection(bind, '127.0.0.1')
      const received: string[] = []
      await new Promise<void>((resolve, reject) => {
        let timeout: NodeJS.Timeout | undefined
        const settle = (error?: Error) => {
          if (timeout) clearTimeout(timeout)
          socket.destroy()
          if (error) reject(error)
          else resolve()
        }
        socket.on('data', (chunk) => received.push(chunk.toString()))
        socket.on('close', () => settle())
        socket.on('error', (error) => settle(error))
        timeout = setTimeout(() => settle(new Error('SMTP conversation stalled')), 5000)
        // Sequential writes with small gaps keep the SMTP state machine happy
        // regardless of how the server coalesces its replies.
        let step = 0
        const sendNext = () => {
          if (step >= conversation.length) {
            socket.end()
            return
          }
          socket.write(conversation[step] + '\r\n')
          step += 1
          setTimeout(sendNext, 30)
        }
        socket.once('connect', sendNext)
      })
      const messages = capture.messages()
      assert.equal(messages.length, 1)
      assert.deepEqual(messages[0].to, ['user-supervisor-p@business.test', 'user-section-manager-p@business.test'])
      assert.match(messages[0].raw, /Subject: approval_needed T01/)
      assert.equal(messages[0].from, 'business-workflow-test@example.test')
      const summary = summarizeCapturedMessages(messages)
      assert.equal(summary[0].subject, 'approval_needed T01')
      assert.ok(!JSON.stringify(summary).includes('fixture-only body'), 'summary keeps headers, not full bodies')
      assert.ok(received.join('').includes('220 business-test-capture'))
    } finally {
      await capture.close()
    }
  })

  it('refuses to bind outside loopback through the shared safety plan', async () => {
    await assert.rejects(() => startMailCapture({ host: 'smtp.example.com', port: 2525 }), /loopback/)
  })
})

describe('postgres identity and cleanup guards', () => {
  it('accepts only postmaster commands pointing at the owned binary and data dir', () => {
    const dataDir = '/tmp/business-test-x/pgdata'
    assert.equal(postmasterCommandIsOwned(`/opt/homebrew/opt/postgresql@16/bin/postgres -D ${dataDir}`, dataDir), true)
    assert.equal(postmasterCommandIsOwned('/usr/local/bin/postgres -D /var/lib/other', dataDir), false)
    assert.equal(postmasterCommandIsOwned(`/opt/homebrew/opt/postgresql@16/bin/postgres -D /opt/homebrew/var/postgresql@16`, dataDir), false)
  })

  it('reads the postmaster pid from the owned data dir only', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'business-test-pid-'))
    try {
      await fs.writeFile(path.join(dir, 'postmaster.pid'), '424242\n/tmp/x\n5432001\n')
      assert.equal(await readPostmasterPid(dir), 424242)
      await fs.writeFile(path.join(dir, 'postmaster.pid'), 'not-a-pid\n')
      assert.equal(await readPostmasterPid(dir), null)
      assert.equal(await readPostmasterPid(path.join(dir, 'missing')), null)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

describe('spawn environment hygiene', () => {
  it('never inherits ambient DATABASE_URL or SMTP credentials', () => {
    const env = buildSpawnEnvironment(
      {
        PATH: '/usr/bin:/bin',
        DATABASE_URL: 'postgresql://attacker:secret@db.example.com/prod',
        SMTP_HOST: 'smtp.example.com',
        SMTP_PASS: 'ambient-secret',
        HOME: '/home/tester',
      },
      { DATABASE_URL: 'postgresql://postgres:run@127.0.0.1:20111/app_cleanstart_dev' },
    )
    assert.equal(env.SMTP_HOST, undefined)
    assert.equal(env.SMTP_PASS, undefined)
    assert.match(env.DATABASE_URL, /127\.0\.0\.1:20111\/app_cleanstart_dev/)
    assert.equal(env.HOME, '/home/tester')
    assert.throws(() => assertNoProtectedEnvironmentKeys({ SMTP_HOST: 'x' }), /protected ambient keys/)
    assert.doesNotThrow(() => assertNoProtectedEnvironmentKeys({ DATABASE_URL_OK_EXPLICIT: 'x' }))
  })
})

describe('evidence index', () => {
  it('renders a readable index with explicit statuses for every entry', () => {
    const entries: EvidenceEntry[] = [
      {
        scenario: 'T01',
        title: 'Request creation permissions',
        actor: 'requesterA',
        status: 'Pass',
        video: 'videos/t01-requesterA.webm',
        trace: 'traces/T01-requesterA.zip',
        screenshots: ['screenshots/t01-requester-a-signed-in.png'],
      },
      {
        scenario: 'T01',
        title: 'Request creation permissions',
        actor: 'inactiveUser',
        status: 'Blocked',
        screenshots: [],
        notes: 'not executed yet',
      },
    ]
    const index = buildEvidenceIndex(
      {
        runId: 'business-test-x',
        generatedAt: '2026-09-16T00:00:00.000Z',
        databasePort: 20111,
        serverPort: 20222,
        mailPort: 20333,
        routesConfiguration: 'all-defaults',
        mode: 'full',
      },
      entries,
    )
    assert.match(index, /business-test-x/)
    assert.match(index, /\| T01 — Request creation permissions \| requesterA \| Pass \|/)
    assert.match(index, /videos\/t01-requesterA\.webm/)
    assert.match(index, /\| inactiveUser \| Blocked \|/)
  })
})
