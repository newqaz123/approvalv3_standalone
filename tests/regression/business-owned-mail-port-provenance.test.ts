import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

import { playwrightBusinessArgs } from '../support/native/business-runner-cli'
import { BUSINESS_ROUTE_CONFIGURATION_NAMES } from '../support/business-workflow-fixture'

/**
 * Owned test-mail port provenance regression (Task139, scalar slice ONLY).
 *
 * Executes the EXACT CURRENT source — requireBusinessEnv from
 * tests/business-e2e/business-flow-helpers.ts and runPlaywrightBusiness from
 * tests/support/native/run-native-business-tests.ts — extracted with the
 * TypeScript compiler AST (byte-exact function text, never a re-implemented
 * copy) and run inside a VM whose `process.env` is an explicit synthetic
 * fixture map. The EXTRACTED FUNCTIONS under test therefore never touch the
 * real process.env: they read, print, and adopt only the fresh synthetic
 * maps injected into their VM sandboxes. (Scope qualification: the
 * module-level import of business-runner-cli for the real
 * playwrightBusinessArgs constant transitively imports
 * runner-lifecycle -> postgres-instance, whose top-level PG_ENV_BASE
 * initializer reads the NONSENSITIVE process.env.HOME at import time. That
 * is not a credential read, environment adoption, or native effect, and the
 * import graph is deliberately not rewritten here.)
 *
 * Boundary fakes only: fake path/os/log and captured runChild /
 * runScenarioListGate record calls without spawning anything; the REAL
 * import-safe playwrightBusinessArgs argv builder and the REAL
 * BUSINESS_ROUTE_CONFIGURATION_NAMES constants are injected. No database,
 * no app, no browser, no mail server, no network.
 *
 * Contract under test:
 *  - requireBusinessEnv: BUSINESS_MAIL_PORT absent → LEGACY result shape
 *    (exactly the four historical keys, no businessMailPort key); present
 *    and canonical ASCII decimal 1..65535 → returned verbatim as
 *    businessMailPort with the other four keys unchanged; present and
 *    malformed (0/65536/empty/leading zero/sign/whitespace/fraction/
 *    exponent/non-ASCII/garbage) → fixed safe refusal that never serializes
 *    the rejected value.
 *  - runPlaywrightBusiness: the child/gate env gains exactly
 *    BUSINESS_MAIL_PORT = String(runtime.ports.mailPort) (owned testmail
 *    provenance metadata, NOT transport config); every existing env key,
 *    the playwright argv, the scenario gate call, log file, and timeout are
 *    otherwise unchanged; DATABASE_URL / SMTP credentials / standard SMTP
 *    transport variables stay absent.
 */

const HELPERS_PATH = 'tests/business-e2e/business-flow-helpers.ts'
const RUNNER_PATH = 'tests/support/native/run-native-business-tests.ts'

/** Byte-exact extraction of one named function declaration from real source. */
function extractExactFunction(relativePath: string, functionName: string): string {
  const source = readFileSync(relativePath, 'utf8')
  const sourceFile = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === functionName) {
      return source.slice(statement.getStart(sourceFile), statement.end)
    }
  }
  // Fixture failure (extraction scaffold), NOT a genuine behavior RED.
  throw new Error(`extraction fixture failure: ${functionName} not found in ${relativePath}`)
}

/** Transpile + evaluate the exact extracted function with injected dependencies. */
function loadExactFunction<T>(
  relativePath: string,
  functionName: string,
  sandbox: Record<string, unknown>,
): T {
  const compiled = ts.transpileModule(extractExactFunction(relativePath, functionName), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  // The transpiled snippet may carry a "use strict" prologue and a CommonJS
  // `Object.defineProperty(exports, "__esModule", ...)` line, so append the
  // function reference AFTER the declaration instead of paren-wrapping it,
  // and provide an inert `exports` object in the sandbox.
  const factory = runInNewContext(`${compiled}\n;(${functionName})`, {
    exports: {},
    ...sandbox,
  })
  assert.equal(typeof factory, 'function', `extracted ${functionName} must evaluate to a function`)
  return factory as T
}

/** Explicit synthetic env fixture (fake values only; never the real env). */
function fakeEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    BUSINESS_TEST_BASE_URL: 'http://127.0.0.1:3210',
    BUSINESS_EVIDENCE_DIR: '/fake-owned-evidence/run-1',
    BUSINESS_E2E_PASSWORD: 'fake-e2e-password',
    BUSINESS_ROUTES_CONFIG: 'all-defaults',
    ...overrides,
  }
}

/** Clone a VM-realm value into this realm so strict deep-equality works. */
function plainRealm(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value))
}

function callRequireBusinessEnv(envFixture: Record<string, string>) {
  const requireBusinessEnvFn = loadExactFunction<() => unknown>(HELPERS_PATH, 'requireBusinessEnv', {
    process: { env: envFixture },
    BUSINESS_ROUTE_CONFIGURATION_NAMES,
  })
  return requireBusinessEnvFn()
}

/** Invoke the exact runPlaywrightBusiness with fake boundary IO; capture calls. */
async function invokeRunPlaywrightBusiness(options: {
  mailPort: number
  scenario?: 'T18B'
}): Promise<{
  runChildCalls: Array<{ command: string; args: string[]; cwd: string; env: Record<string, string>; logFile: string; timeout: number }>
  gateCalls: Array<{ command: string; cwd: string; env: Record<string, string>; baseDir: string; scenario: string }>
  logLines: string[]
}> {
  const runChildCalls: Array<{ command: string; args: string[]; cwd: string; env: Record<string, string>; logFile: string; timeout: number }> = []
  const gateCalls: Array<{ command: string; cwd: string; env: Record<string, string>; baseDir: string; scenario: string }> = []
  const logLines: string[] = []
  const fakeRuntime = {
    runId: 'r-owned-fake-1',
    e2ePassword: 'fake-e2e-password',
    ports: { databasePort: 55432, serverPort: 3210, mailPort: options.mailPort },
  }
  const runPlaywrightBusinessFn = loadExactFunction<
    (runtime: unknown, appDir: string, evidenceDir: string, baseUrl: string, routesConfig: string, scenario?: string) => Promise<void>
  >(RUNNER_PATH, 'runPlaywrightBusiness', {
    process: { env: { PATH: '/fake-owned-bin', HOME: '/fake-owned-home' } },
    os: { tmpdir: () => '/fake-owned-tmp' },
    path: { join: (...parts: string[]) => parts.join('/') },
    log: (line: string) => { logLines.push(line) },
    playwrightBusinessArgs, // REAL argv builder (pure, import-safe)
    runScenarioListGate: async (gate: { command: string; cwd: string; env: Record<string, string>; baseDir: string; scenario: string }) => {
      gateCalls.push(gate)
      return { logFile: '/fake-owned-evidence/list/playwright-list.log', output: 'T18B focused scenario\n', total: 1 }
    },
    runChild: async (command: string, args: string[], cwd: string, env: Record<string, string>, logFile: string, timeout: number) => {
      runChildCalls.push({ command, args, cwd, env, logFile, timeout })
    },
  })
  await runPlaywrightBusinessFn(fakeRuntime, '/fake-owned-app', '/fake-owned-evidence/run-1', 'http://127.0.0.1:3210', 'all-defaults', options.scenario)
  return { runChildCalls, gateCalls, logLines }
}

const FORBIDDEN_TRANSPORT_KEYS = [
  'DATABASE_URL',
  'BUSINESS_DATABASE_URL',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'SMTP_URL',
  'MAIL_HOST',
  'MAIL_PORT',
  'EMAIL_HOST',
  'EMAIL_PORT',
]

describe('requireBusinessEnv: BUSINESS_MAIL_PORT absence stays legal (legacy shape)', () => {
  it('returns exactly the four legacy keys when BUSINESS_MAIL_PORT is absent', () => {
    const raw = callRequireBusinessEnv(fakeEnv()) as object
    // RAW own-key shape assertions come FIRST, directly on the VM-returned
    // object (host Object.keys / Object.hasOwn / `in` all operate on the
    // cross-realm object): JSON normalization silently DROPS undefined-valued
    // own properties, so a regression returning businessMailPort: undefined
    // would be invisible to a clone-based keys check (see the canary below).
    assert.equal(
      Object.keys(raw).sort().join(','),
      'baseURL,e2ePassword,evidenceDir,routesConfig',
      'raw VM return has exactly the four legacy own keys',
    )
    assert.equal(Object.hasOwn(raw, 'businessMailPort'), false, 'no businessMailPort own key on the raw return')
    assert.equal('businessMailPort' in raw, false, 'no businessMailPort key anywhere (own or inherited)')
    // Normalized value equality afterwards (cross-realm clone for strict
    // deep-equal mechanics only — it is NOT the shape oracle).
    const env = plainRealm(raw) as Record<string, unknown>
    assert.deepEqual(env, {
      baseURL: 'http://127.0.0.1:3210',
      evidenceDir: '/fake-owned-evidence/run-1',
      e2ePassword: 'fake-e2e-password',
      routesConfig: 'all-defaults',
    })
  })

  it('diagnostic canary (harness only, synthetic fixture): JSON clone masks an undefined own key; the raw own-key check above detects it', () => {
    // NOT a source-behavior test: this synthetic fixture documents why the
    // absence oracle must inspect the RAW return. A hypothetical stray
    // businessMailPort: undefined key survives hasOwn on the raw object but
    // is silently dropped by JSON normalization — the exact gap the raw
    // assertions above close. No parser/source change is implied.
    const strayKeyFixture = {
      baseURL: 'http://127.0.0.1:3210',
      evidenceDir: '/fake-owned-evidence/run-1',
      e2ePassword: 'fake-e2e-password',
      routesConfig: 'all-defaults',
      businessMailPort: undefined,
    }
    assert.equal(
      Object.hasOwn(plainRealm(strayKeyFixture) as object, 'businessMailPort'),
      false,
      'JSON clone hides the stray undefined-valued key (the old oracle gap)',
    )
    assert.equal(Object.hasOwn(strayKeyFixture, 'businessMailPort'), true, 'raw own-key check detects the stray key')
    assert.equal('businessMailPort' in strayKeyFixture, true)
  })
})

describe('requireBusinessEnv: canonical present BUSINESS_MAIL_PORT is returned', () => {
  for (const port of ['1', '25', '1025', '3101', '65535']) {
    it(`accepts canonical decimal "${port}" and returns it verbatim`, () => {
      const env = plainRealm(callRequireBusinessEnv(fakeEnv({ BUSINESS_MAIL_PORT: port }))) as Record<string, unknown>
      assert.equal(env.businessMailPort, port)
      assert.deepEqual(env.baseURL, 'http://127.0.0.1:3210')
      assert.deepEqual(env.evidenceDir, '/fake-owned-evidence/run-1')
      assert.deepEqual(env.e2ePassword, 'fake-e2e-password')
      assert.deepEqual(env.routesConfig, 'all-defaults')
    })
  }
})

describe('requireBusinessEnv: malformed BUSINESS_MAIL_PORT is refused safely', () => {
  const malformed: string[] = [
    '0',
    '65536',
    '',
    '007',
    '+25',
    '-25',
    ' 25',
    '25 ',
    '25.0',
    '2.5e2',
    'NaN',
    '0x19',
    '25x',
    'abc',
    '\u0661\u0662\u0663',
    // Line-terminator suffix boundary cases (LF/CR/CRLF/U+2028/U+2029):
    // ALREADY-GREEN coverage of the CURRENT predicate — its anchored,
    // non-multiline ASCII [0-9]+ pattern rejects all of these today. This
    // is hardening of the oracle's boundary matrix, NOT a newline bug
    // reproduction and NOT a parser change.
    '25\n',
    '25\r',
    '25\r\n',
    '25\u2028',
    '25\u2029',
  ]
  for (const bad of malformed) {
    it(`rejects "${JSON.stringify(bad)}" with a fixed safe message (no value dump)`, () => {
      let threw = false
      let message = ''
      try {
        callRequireBusinessEnv(fakeEnv({ BUSINESS_MAIL_PORT: bad }))
      } catch (error) {
        threw = true
        message = String((error as { message?: unknown }).message ?? error)
      }
      assert.ok(threw, `malformed BUSINESS_MAIL_PORT must throw (sample length ${bad.length})`)
      assert.match(message, /BUSINESS_MAIL_PORT/, 'error names the offending variable')
      // `String.includes('')` is vacuously true, so the no-value-dump check
      // can only apply to non-empty samples (empty is still required to
      // throw above and to name the variable).
      if (bad.length > 0) {
        assert.ok(!message.includes(bad), 'error must not serialize the rejected value')
      }
    })
  }
})

describe('runPlaywrightBusiness: owned mail port is wired into the child env', () => {
  for (const mailPort of [1025, 25, 1, 65535, 32123]) {
    it(`full run env carries BUSINESS_MAIL_PORT="${String(mailPort)}" derived from runtime.ports.mailPort`, async () => {
      const { runChildCalls, gateCalls } = await invokeRunPlaywrightBusiness({ mailPort })
      assert.equal(runChildCalls.length, 1, 'exactly one playwright child')
      assert.equal(gateCalls.length, 0, 'no listing gate without a scenario selection')
      const call = plainRealm(runChildCalls[0]) as { command: string; args: string[]; cwd: string; env: Record<string, string>; logFile: string; timeout: number }
      // Exact env: the ONE new key is BUSINESS_MAIL_PORT = String(mailPort);
      // every historical key keeps its injected fixture value.
      assert.deepEqual(call.env, {
        PATH: '/fake-owned-bin',
        HOME: '/fake-owned-home',
        TMPDIR: '/fake-owned-tmp',
        BUSINESS_TEST_BASE_URL: 'http://127.0.0.1:3210',
        BUSINESS_E2E_PASSWORD: 'fake-e2e-password',
        BUSINESS_EVIDENCE_DIR: '/fake-owned-evidence/run-1',
        BUSINESS_RUN_ID: 'r-owned-fake-1',
        BUSINESS_ROUTES_CONFIG: 'all-defaults',
        BUSINESS_MAIL_PORT: String(mailPort),
        NEXT_TELEMETRY_DISABLED: '1',
      })
      // Existing child invocation contract unchanged.
      assert.equal(call.command, '/fake-owned-app/node_modules/.bin/playwright')
      assert.deepEqual(call.args, playwrightBusinessArgs(undefined))
      assert.equal(call.cwd, '/fake-owned-app')
      assert.equal(call.logFile, '/fake-owned-evidence/run-1/playwright-run.log')
      assert.equal(call.timeout, 3_600_000)
    })
  }

  it('focused T18B run wires the same port into gate and child env with the focused argv', async () => {
    const { runChildCalls, gateCalls, logLines } = await invokeRunPlaywrightBusiness({ mailPort: 41025, scenario: 'T18B' })
    assert.equal(gateCalls.length, 1, 'exactly one listing gate call for the focused selection')
    assert.equal(gateCalls[0].scenario, 'T18B')
    assert.equal(gateCalls[0].env.BUSINESS_MAIL_PORT, '41025')
    assert.equal(runChildCalls.length, 1)
    assert.equal(runChildCalls[0].env.BUSINESS_MAIL_PORT, '41025')
    assert.deepEqual(runChildCalls[0].args, playwrightBusinessArgs('T18B'))
    assert.ok(logLines.some((line) => line.includes('scenario selection T18B')), 'focused selection is logged')
  })

  it('never passes DB URLs or SMTP credential/transport variables to the child', async () => {
    const { runChildCalls, gateCalls } = await invokeRunPlaywrightBusiness({ mailPort: 4025 })
    for (const call of [...runChildCalls, ...gateCalls]) {
      for (const forbidden of FORBIDDEN_TRANSPORT_KEYS) {
        assert.ok(!(forbidden in call.env), `${forbidden} must never reach the browser child env`)
      }
    }
    assert.ok(runChildCalls.length === 1 && gateCalls.length === 0)
  })
})
