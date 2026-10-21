/**
 * Focused regression tests for the five narrow native-runner fixes
 * (supervisor-authorized; see reviewer seed-order-review.md §7):
 *
 *  1. postmaster identity accepts BOTH the PG_BIN symlink path and its
 *     canonical realpath (macOS `ps -o command=` reports the resolved
 *     …/Cellar/… path), with an EXACT `-D` owned-path boundary — foreign
 *     binaries, foreign data dirs and prefix-sibling data dirs stay rejected.
 *  2. A separate READ-ONLY maintenance identity contract for the initial
 *     `postgres` database; the strict REQUIRED_DATABASE_NAME business-write
 *     guard in verifyPostgresIdentity is retained (refuses `postgres` by
 *     name BEFORE any connection).
 *  3. The shared tmp parent mkdir is repeat-safe (no EEXIST on re-run) and
 *     verifies an existing directory is safe/owned (real dir, not a symlink,
 *     current user, not group/world writable).
 *  4. A freshly allocated runtime root is compensated (removed) on pre-start
 *     construction failure ONLY when exact ownership (this run's mkdtemp
 *     prefix) is known.
 *  5. Owned cluster settings are actually loaded: postgresql.conf gains
 *     `include_if_exists = 'business_test.conf'` so the owned port/socket
 *     apply (attempt-2 evidence showed the cluster on default 5432 + shared
 *     /tmp socket otherwise), and no Unix-domain socket is created at all
 *     (macOS 103-byte socket path cap; TCP-only removes the shared /tmp
 *     socket surface).
 *  6. Minted run ids satisfy BOTH validators: native isOwnedRunId and the
 *     shared business-workflow-safety charset (previously the uppercase `T`
 *     in the ISO stamp failed `SAFETY: runId must identify a business-test
 *     owned resource` on every full run) — fixed at the source (lowercase
 *     stamp) WITHOUT widening any safety regex.
 *  7. DNS guard mirrors the TCP guard's literal-loopback carve-out:
 *     dns.lookup() runs for NUMERIC hostnames too (answered without a
 *     resolver); next dev's startup lookup of '127.0.0.1' previously aborted
 *     app boot with EBUSINESSNETGUARD. Real names stay blocked; connections
 *     stay owned-port guarded.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PG_BIN,
  buildOutboundAllowlistSpec,
  createRunId,
  decideDnsLookup,
  formatAllowlistEnv,
} from '../support/native/native-environment'
import { assertOwnedDisposableResource } from '../support/business-workflow-safety'
import {
  createOwnedRuntimeRoot,
  ensureOwnedTmpParent,
  ownedPostgresBinaries,
  postmasterCommandIsOwned,
  removeFreshlyAllocatedRuntimeRoot,
  removeOwnedRuntimeRoot,
  verifyOwnedMaintenanceIdentity,
  verifyPostgresIdentity,
  writeOwnedPostgresConfig,
  type NativeRuntimePaths,
  type OwnedRuntime,
} from '../support/native/postgres-instance'

const DATA_DIR = '/tmp/business-test-identity/pgdata'

describe('fix 6: minted run ids satisfy every owned-resource validator', () => {
  it('createRunId output passes native isOwnedRunId AND the shared business-workflow-safety charset', () => {
    const runId = createRunId()
    assert.match(runId, /^business-test-[0-9]{8}t[0-9]{6}-[a-z0-9-]+$/, 'lowercase ISO stamp')
    assert.equal(runId, runId.toLowerCase(), 'no uppercase anywhere')
    // The exact resource shape the runner builds must clear the shared
    // guard (this is what failed every full-mode run before the fix).
    assert.doesNotThrow(() =>
      assertOwnedDisposableResource({
        runId,
        containerName: `${runId}-postgres`,
        databaseName: 'app_cleanstart_dev',
        databasePort: 24680,
        serverPort: 13579,
      }),
    )
    // The uppercase-T form is simply not minted anymore.
    assert.equal(/^business-test-[0-9]{8}T[0-9]{6}-/.test(runId), false)
  })
})

describe('fix 7: DNS guard allows literal loopback IPs (numeric lookups never hit a resolver)', () => {
  const spec = buildOutboundAllowlistSpec({
    ports: { databasePort: 20111, serverPort: 20112, mailPort: 20113 },
    unixSocketPrefixes: ['/owned/tmp/pgsocket'],
  })

  it('decideDnsLookup allows 127.0.0.1 and ::1 even though they are not resolvableHostnames', () => {
    assert.deepEqual(decideDnsLookup(spec, '127.0.0.1', ['127.0.0.1']), { allowed: true })
    assert.deepEqual(decideDnsLookup(spec, '::1', ['::1']), { allowed: true })
    assert.deepEqual(decideDnsLookup(spec, 'LOCALHOST', ['127.0.0.1']), { allowed: true })
  })

  it('decideDnsLookup still blocks real names and non-loopback answers', () => {
    assert.equal(decideDnsLookup(spec, 'smtp.example.test', ['127.0.0.1']).allowed, false)
    assert.equal(decideDnsLookup(spec, 'localhost', ['10.0.0.1']).allowed, false)
    assert.equal(decideDnsLookup(spec, '127.0.0.1', ['10.0.0.1']).allowed, false)
  })

  it('preload subprocess: numeric loopback lookup succeeds, real-name lookup still EBUSINESSNETGUARD', async () => {
    const preloadPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      'support',
      'native',
      'outbound-allowlist-preload.js',
    )
    if (!existsSync(preloadPath)) throw new Error(`preload missing: ${preloadPath}`)
    const allowlistValue = formatAllowlistEnv(spec)
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      const child = spawn(process.execPath, ['--require', preloadPath, '-e', `
        const dns = require('node:dns')
        dns.lookup('127.0.0.1', (error, address) => {
          if (error) { console.log('LITERAL_FAILED', error.code); process.exit(1) }
          console.log('LITERAL_OK', address)
          dns.lookup('127.0.0.1', { all: true }, (error2, answers) => {
            if (error2) { console.log('ALL_FAILED', error2.code); process.exit(1) }
            console.log('ALL_OK', JSON.stringify(answers))
            dns.lookup('smtp.example.test', (error3) => {
              console.log('NAME_BLOCKED', error3 ? error3.code : 'RESOLVED')
              process.exit(error3 && error3.code === 'EBUSINESSNETGUARD' ? 0 : 1)
            })
          })
        })
      `], {
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin', BUSINESS_NET_ALLOWLIST: allowlistValue } as unknown as NodeJS.ProcessEnv,
        stdio: ['ignore', 'pipe', 'pipe'] as const,
      })
      let stdout = ''
      let stderr = ''
      const killer = setTimeout(() => { stderr += '\n[killer] timeout'; child.kill('SIGKILL') }, 10_000)
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk })
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk })
      child.on('close', (code) => { clearTimeout(killer); resolve({ code, stdout, stderr }) })
    })
    assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /LITERAL_OK 127\.0\.0\.1/)
    assert.match(result.stdout, /ALL_OK \[\{"address":"127\.0\.0\.1","family":4\}\]/)
    assert.match(result.stdout, /NAME_BLOCKED EBUSINESSNETGUARD/)
  })
})

describe('fix 1: owned postmaster identity — symlink AND realpath, exact -D boundary', () => {
  it('lists the PG_BIN symlink path plus its canonical realpath without duplicates', () => {
    const binaries = ownedPostgresBinaries()
    assert.ok(binaries.includes(path.join(PG_BIN, 'postgres')), 'symlink path must always be accepted')
    assert.equal(new Set(binaries).size, binaries.length, 'no duplicate binary paths')
    for (const binary of binaries) {
      assert.ok(path.isAbsolute(binary), `absolute binary path: ${binary}`)
    }
  })

  it('accepts EVERY owned binary form (symlink and macOS-resolved realpath) with the exact -D data dir', () => {
    for (const binary of ownedPostgresBinaries()) {
      assert.equal(
        postmasterCommandIsOwned(`${binary} -D ${DATA_DIR}`, DATA_DIR),
        true,
        `must accept owned binary form: ${binary}`,
      )
    }
  })

  it('still rejects a foreign binary even with the owned data dir', () => {
    assert.equal(postmasterCommandIsOwned(`/usr/local/bin/postgres -D ${DATA_DIR}`, DATA_DIR), false)
    assert.equal(postmasterCommandIsOwned(`/opt/homebrew/Cellar/postgresql@15/15.4/bin/postgres -D ${DATA_DIR}`, DATA_DIR), false)
  })

  it('still rejects the owned binary on a foreign data dir (incl. the brew default cluster)', () => {
    const binary = ownedPostgresBinaries()[0]
    assert.equal(postmasterCommandIsOwned(`${binary} -D /var/lib/other`, DATA_DIR), false)
    assert.equal(postmasterCommandIsOwned(`${binary} -D /opt/homebrew/var/postgresql@16`, DATA_DIR), false)
  })

  it('rejects prefix/sibling data dirs — the -D match is exact, not a substring', () => {
    const binary = ownedPostgresBinaries()[0]
    assert.equal(postmasterCommandIsOwned(`${binary} -D ${DATA_DIR}2`, DATA_DIR), false)
    assert.equal(postmasterCommandIsOwned(`${binary} -D ${DATA_DIR}-x`, DATA_DIR), false)
    assert.equal(postmasterCommandIsOwned(`${binary} -D${DATA_DIR}2`, DATA_DIR), false)
    // The pre-fix substring bug: expected /d/pg must NOT match -D /d/pgdata.
    assert.equal(postmasterCommandIsOwned(`${binary} -D /d/pgdata`, '/d/pg'), false)
    // No -D at all, or an empty command, is never owned.
    assert.equal(postmasterCommandIsOwned(binary, DATA_DIR), false)
    assert.equal(postmasterCommandIsOwned('', DATA_DIR), false)
  })

  it('accepts the attached -D<dataDir> form with the exact owned path', () => {
    const binary = ownedPostgresBinaries()[0]
    assert.equal(postmasterCommandIsOwned(`${binary} -D${DATA_DIR}`, DATA_DIR), true)
  })
})

describe('fix 2: maintenance identity vs strict business-write identity', () => {
  const fakeRuntime = (postmasterPid: number | null) =>
    ({ postmasterPid, paths: { dataDir: DATA_DIR, rootDir: '/tmp/business-test-x', socketDir: '/tmp/business-test-x/pgsocket', secretsDir: '/tmp/business-test-x/secrets', logsDir: '/tmp/business-test-x/logs' }, ports: { databasePort: 20001, serverPort: 20002, mailPort: 20003 } }) as unknown as OwnedRuntime

  it('verifyPostgresIdentity refuses the maintenance DB by name BEFORE any connection (strict guard retained)', async () => {
    await assert.rejects(
      () => verifyPostgresIdentity(fakeRuntime(999999), 'postgres'),
      /SAFETY: refusing to work in database postgres; required app_cleanstart_dev/,
    )
    await assert.rejects(
      () => verifyPostgresIdentity(fakeRuntime(999999), 'some_other_db'),
      /refusing to work in database some_other_db; required app_cleanstart_dev/,
    )
  })

  it('verifyPostgresIdentity with the required DB still fails closed without a started postmaster', async () => {
    await assert.rejects(
      () => verifyPostgresIdentity(fakeRuntime(null), 'app_cleanstart_dev'),
      /SAFETY: postgres has not been started by this runner/,
    )
  })

  it('verifyOwnedMaintenanceIdentity fails closed without a started postmaster', async () => {
    await assert.rejects(
      () => verifyOwnedMaintenanceIdentity(fakeRuntime(null)),
      /SAFETY: postgres has not been started by this runner/,
    )
  })

  it('verifyOwnedMaintenanceIdentity fails closed on a non-running postmaster PID (ps path)', async () => {
    // PID above the macOS default pid_max — cannot exist.
    await assert.rejects(
      () => verifyOwnedMaintenanceIdentity(fakeRuntime(999_999)),
      /SAFETY: postmaster PID 999999 is not running/,
    )
  })
})

describe('fix 3: repeat-safe owned tmp parent', () => {
  it('creates the parent when missing and accepts it on repeat (no EEXIST)', async () => {
    const parent = path.join(os.tmpdir(), `business-test-tmp-parent-${Date.now()}-${process.pid}`)
    try {
      await ensureOwnedTmpParent(parent)
      await ensureOwnedTmpParent(parent) // repeat invocation must not throw EEXIST
      const stat = await fs.stat(parent)
      assert.ok(stat.isDirectory())
    } finally {
      await fs.rm(parent, { recursive: true, force: true })
    }
  })

  it('rejects a symlink at the tmp parent path', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'business-test-tmp-'))
    const real = path.join(base, 'real')
    const link = path.join(base, 'link')
    await fs.mkdir(real, { mode: 0o700 })
    await fs.symlink(real, link)
    try {
      await assert.rejects(() => ensureOwnedTmpParent(link), /SAFETY: tmp parent must not be a symlink/)
    } finally {
      await fs.rm(base, { recursive: true, force: true })
    }
  })

  it('rejects a group/world-writable existing tmp parent', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'business-test-tmp-'))
    const loose = path.join(base, 'loose')
    await fs.mkdir(loose)
    await fs.chmod(loose, 0o777) // umask-proof: chmod is not masked
    try {
      await assert.rejects(() => ensureOwnedTmpParent(loose), /SAFETY: tmp parent must not be group\/world writable/)
    } finally {
      await fs.rm(base, { recursive: true, force: true })
    }
  })

  it('rejects a tmp parent outside os.tmpdir()', async () => {
    await assert.rejects(
      () => ensureOwnedTmpParent(path.join(process.cwd(), 'not-a-tmp-parent')),
      /SAFETY: refusing tmp parent outside os\.tmpdir\(\)/,
    )
  })
})

describe('fix 4: compensation removes a freshly allocated root only under exact ownership', () => {
  it('removes this run\'s freshly allocated root', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'business-test-comp-'))
    const runId = createRunId()
    const paths = await createOwnedRuntimeRoot(parent, runId)
    assert.equal(await removeFreshlyAllocatedRuntimeRoot(paths, runId), true)
    await assert.rejects(() => fs.stat(paths.rootDir), /ENOENT/)
    await fs.rm(parent, { recursive: true, force: true })
  })

  it('keeps the root when the run-id prefix does not match (not exactly ours)', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'business-test-comp-'))
    const runId = createRunId()
    const otherRunId = createRunId()
    const paths = await createOwnedRuntimeRoot(parent, runId)
    assert.equal(await removeFreshlyAllocatedRuntimeRoot(paths, otherRunId), false)
    const stat = await fs.stat(paths.rootDir)
    assert.ok(stat.isDirectory(), 'non-matching run id must not remove anything')
    await removeOwnedRuntimeRoot(paths)
    await fs.rm(parent, { recursive: true, force: true })
  })

  it('removeOwnedRuntimeRoot still refuses non-owned directories', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'business-test-comp-'))
    const foreign = path.join(base, 'not-owned-dir')
    await fs.mkdir(foreign)
    try {
      await assert.rejects(
        () => removeOwnedRuntimeRoot({ rootDir: foreign, dataDir: foreign, socketDir: foreign, secretsDir: foreign, logsDir: foreign } as NativeRuntimePaths),
        /SAFETY: refusing to remove a non-owned runtime dir/,
      )
    } finally {
      await fs.rm(base, { recursive: true, force: true })
    }
  })
})

describe('fix 5: owned cluster settings are actually loaded by postgresql.conf', () => {
  it('writes business_test.conf AND includes it from postgresql.conf', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'business-test-conf-'))
    try {
      const runtime = {
        ports: { databasePort: 26169, serverPort: 36882, mailPort: 41021 },
        paths: {
          rootDir: path.dirname(dataDir),
          dataDir,
          socketDir: path.join(path.dirname(dataDir), 'pgsocket'),
          secretsDir: path.join(path.dirname(dataDir), 'secrets'),
          logsDir: path.join(path.dirname(dataDir), 'logs'),
        },
      } as unknown as OwnedRuntime
      // postgresql.conf does not exist here — appendFile creates it, which is
      // exactly what initdb-produced data dirs rely on for the include line.
      await writeOwnedPostgresConfig(runtime)
      const owned = await fs.readFile(path.join(dataDir, 'business_test.conf'), 'utf8')
      assert.match(owned, /port = 26169/)
      assert.match(owned, /listen_addresses = '127\.0\.0\.1'/)
      // No Unix-domain socket: macOS's 103-byte socket path cap makes the
      // owned runtime dir unusable for sockets, and TCP-only removes the
      // shared /tmp socket surface entirely.
      assert.match(owned, /unix_socket_directories = ''/)
      const main = await fs.readFile(path.join(dataDir, 'postgresql.conf'), 'utf8')
      assert.match(main, /include_if_exists = 'business_test\.conf'/)
    } finally {
      await fs.rm(dataDir, { recursive: true, force: true })
    }
  })
})
