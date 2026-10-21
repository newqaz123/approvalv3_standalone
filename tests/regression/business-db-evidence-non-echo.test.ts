/**
 * DB evidence QUERY non-echo contract (Task164 design; Task165 test-only repair).
 *
 * TEST SOURCE ONLY — authored WITHOUT executing anything (no tests, VM,
 * transpile, import, diagnostics). Every FUTURE-CONTRACT assertion is
 * prepared to fail against CURRENT behavior; the eligible RED is proven only
 * by an actual parent run AFTER fresh pre-execution SAFETY/SPEC/QUALITY
 * clearance. Scaffold/prerequisite assertions are distinct from feature RED.
 *
 * Subject: EXACT CURRENT source, AST-extracted, executed in isolated VMs in
 * the FUTURE run only:
 *   - `queryJson` (capture-workflow-db-evidence.ts:556–564) with ONLY the
 *     slow/external `psqlQuery` boundary faked;
 *   - the runner DB-capture TRY/CATCH statement (run-native-business-tests.ts
 *     main():435–446) via a wrapper supplying the same free variables. Its
 *     capture dependency is a FAKE CAPTURE BRIDGE (honestly labeled) — never
 *     the whole captureData/native chain, never an injected opaque value.
 *
 * Hand-derived fixed categories (canonical, payload-free):
 *   DB_EVIDENCE_QUERY_FAILED      — psql rejection; opaque must NOT escape.
 *   DB_EVIDENCE_JSON_PARSE_FAILED — malformed returned JSON terminal; message
 *                                   must EQUAL the canonical fixed text (no
 *                                   prefix/suffix: no SQL, no output payload).
 *   DB_EVIDENCE_CAPTURE_FAILED    — runner DB-catch log line must EQUAL the
 *                                   canonical fixed text (no raw payload).
 *
 * Safety classes (distinct):
 *   - OPAQUE psql rejections are tested DIRECTLY against queryJson ONLY, with
 *     presence + boolean Object.is + OWNED counters; the caught opaque is
 *     never inspected/classified/thrown onward, and NEVER routed through the
 *     current legacy runner catch (error instanceof Error/.message/String).
 *   - The single value the runner catch observes is PROVABLY SOURCE-
 *     GENERATED: the fake psql RESOLVES a fixed malformed string, so the only
 *     possible rejection is queryJson's own parse catch (host JSON/Error
 *     realm explicit). Known-generated canonical checks are the permitted
 *     fixed-generated observer class — never applied to opaque values.
 *   - Every fault/sentinel/site gets its OWN matching healthy case FIRST in
 *     the SAME test, with fully asserted footprints (parsed output class and
 *     length, delegation count, database, statement, runtime identity via
 *     boolean Object.is, retained evidence/status/log) — never once per
 *     family, never mock-existence-only.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const W = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const DB_EVIDENCE_SOURCE_PATH = path.join(W, 'tests/support/native/capture-workflow-db-evidence.ts')
const RUNNER_SOURCE_PATH = path.join(W, 'tests/support/native/run-native-business-tests.ts')

const CATEGORY_QUERY_FAILED = 'DB_EVIDENCE_QUERY_FAILED'
const CATEGORY_JSON_PARSE_FAILED = 'DB_EVIDENCE_JSON_PARSE_FAILED'
const CATEGORY_CAPTURE_FAILED = 'DB_EVIDENCE_CAPTURE_FAILED'
const REQUIRED_DATABASE_NAME = 'app_cleanstart_dev'
// Canonical fixed outputs (category-only; equality rejects any payload).
const CANONICAL_PARSE_MESSAGE = `db evidence: ${CATEGORY_JSON_PARSE_FAILED}`
const CANONICAL_CAPTURE_LOG = `could not capture workflow DB evidence: ${CATEGORY_CAPTURE_FAILED}`
// Fixed NON-SENSITIVE statement label: no real SQL, credentials, or rows.
const SYNTHETIC_STATEMENT = 'select synthetic-non-sensitive-label from synthetic'
const SQL_MARKER = 'synthetic-non-sensitive-label'
// Controlled malformed returned-JSON fixture with an INDEPENDENT marker, so
// payload-leak checks do not depend on SQL/stdout/stderr tokens alone.
const MALFORMED_JSON = '{"synthetic-malformed-output-marker": '
const MALFORMED_MARKER = 'synthetic-malformed-output-marker'
// Retained runtime fixture: delegation identity is asserted by reference.
const RUNTIME_FIXTURE = { syntheticRuntime: true }

// ---------------------------------------------------------------- extraction
type Sf = ts.SourceFile
function parseSource(absPath: string, name: string): Sf {
  return ts.createSourceFile(name, readFileSync(absPath, 'utf8'), ts.ScriptTarget.Latest, true)
}
function transpileDeclText(declText: string): string {
  return ts.transpileModule(declText.replace(/^export\s+/, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
}
function extractFunctionText(sf: Sf, functionName: string): string | undefined {
  const decl = sf.statements.find(
    (s: ts.Statement) => ts.isFunctionDeclaration(s) && s.name?.text === functionName)
  return decl ? transpileDeclText(decl.getText(sf)) : undefined
}
function extractRunnerDbCaptureTryCatch(sf: Sf): string | undefined {
  // Exact try-statement text of the DB-evidence capture inside main(): the
  // first TryStatement whose try block calls captureWorkflowDbEvidence.
  let found: string | undefined
  const visit = (node: ts.Node): void => {
    if (found) return
    if (ts.isTryStatement(node)) {
      const text = node.getText(sf)
      if (text.includes('captureWorkflowDbEvidence')) {
        found = text
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

const DB_SF = parseSource(DB_EVIDENCE_SOURCE_PATH, 'capture-workflow-db-evidence.ts')
const RUNNER_SF = parseSource(RUNNER_SOURCE_PATH, 'run-native-business-tests.ts')
const QUERY_JSON_TEXT = extractFunctionText(DB_SF, 'queryJson')
const RUNNER_DB_TRY_CATCH_TEXT = extractRunnerDbCaptureTryCatch(RUNNER_SF)

// ------------------------------------------------------------ query fixtures
type PsqlCall = { runtime: unknown; database: string; sql: string }
type FakePsqlExecutor = (runtime: unknown, database: string, sql: string) => Promise<string>
type QueryResult = { rows: unknown; threw: boolean; caught: unknown; psqlCalls: PsqlCall[] }

const GLOBALS = (): Record<string, unknown> => ({
  Date, Promise, Object, Array, Error, Symbol, JSON, Math, RegExp, String, Number, Boolean,
})

/** Executes the REAL extracted queryJson in an isolated VM; only psql faked. */
async function runExtractedQueryJson(psqlImpl: FakePsqlExecutor): Promise<QueryResult> {
  assert.ok(typeof QUERY_JSON_TEXT === 'string', 'scaffold: queryJson extracted from current source')
  const psqlCalls: PsqlCall[] = []
  const trackedImpl: FakePsqlExecutor = async (runtime, database, sql) => {
    psqlCalls.push({ runtime, database, sql })
    return psqlImpl(runtime, database, sql)
  }
  const ctx = vm.createContext({
    ...GLOBALS(),
    psqlQuery: trackedImpl,
    REQUIRED_DATABASE_NAME,
  })
  const fn = new vm.Script(`(function () {\n${QUERY_JSON_TEXT}\nreturn queryJson;\n})()`).runInContext(ctx) as
    (runtime: unknown, sql: string) => Promise<unknown[]>
  let rows: unknown
  let caught: unknown
  let threw = false
  try {
    rows = await fn(RUNTIME_FIXTURE, SYNTHETIC_STATEMENT)
  } catch (e) {
    threw = true
    caught = e
  }
  return { rows, threw, caught, psqlCalls }
}

/** Asserts a COMPLETE healthy footprint at the query boundary (per-fault prereq). */
function assertHealthyQueryFootprint(r: QueryResult, tag: string): void {
  assert.equal(r.threw, false, `prereq ${tag}: healthy query resolves at the same boundary`)
  assert.equal(Array.isArray(r.rows), true, `prereq ${tag}: healthy rows are an array (realm-safe boolean)`)
  assert.equal((r.rows as unknown[]).length, 0, `prereq ${tag}: healthy raw-'[]' fixture yields zero rows`)
  assert.equal(r.psqlCalls.length, 1, `prereq ${tag}: single psql delegation`)
  assert.equal(r.psqlCalls[0]?.database, REQUIRED_DATABASE_NAME, `prereq ${tag}: delegates the required database`)
  assert.equal(r.psqlCalls[0]?.sql, SYNTHETIC_STATEMENT, `prereq ${tag}: delegates the statement verbatim`)
  assert.equal(Object.is(r.psqlCalls[0]?.runtime, RUNTIME_FIXTURE), true, `prereq ${tag}: delegates the runtime by reference (boolean Object.is)`)
}

/** Asserts the complete fault delegation footprint BEFORE the intended RED. */
function assertFaultDelegationFootprint(r: QueryResult, tag: string): void {
  assert.equal(r.psqlCalls.length, 1, `${tag}: exactly one psql call (no retry)`)
  assert.equal(r.psqlCalls[0]?.database, REQUIRED_DATABASE_NAME, `${tag}: fault delegated to the required database`)
  assert.equal(r.psqlCalls[0]?.sql, SYNTHETIC_STATEMENT, `${tag}: fault delegated the statement verbatim`)
  assert.equal(Object.is(r.psqlCalls[0]?.runtime, RUNTIME_FIXTURE), true, `${tag}: fault delegated the runtime by reference`)
}

// trap-fixture sentinels with trusted literal names and OWNED counters
type OpaqueSentinel = { name: string; make: () => { sentinel: unknown; counts: Record<string, number> } }
const OPAQUE_SENTINELS: OpaqueSentinel[] = [
  { name: 'zero', make: () => ({ sentinel: 0, counts: {} }) },
  { name: 'false', make: () => ({ sentinel: false, counts: {} }) },
  { name: 'null', make: () => ({ sentinel: null, counts: {} }) },
  { name: 'undefined', make: () => ({ sentinel: undefined, counts: {} }) },
  { name: 'empty-string', make: () => ({ sentinel: '', counts: {} }) },
  { name: 'null-proto', make: () => ({ sentinel: Object.create(null), counts: {} }) },
  {
    name: 'getter-trap',
    make: () => {
      const counts = { message: 0 }
      const sentinel = new Error('SYNTHETIC-OPAQUE')
      Object.defineProperty(sentinel, 'message', { get() { counts.message++; throw new Error('SYNTHETIC-TRAP') } })
      return { sentinel, counts }
    },
  },
  {
    name: 'conversion-trap',
    make: () => {
      const counts = { toPrimitive: 0, toString: 0 }
      const sentinel: Record<string | symbol, unknown> = {}
      Object.defineProperty(sentinel, Symbol.toPrimitive, { value() { counts.toPrimitive++; throw new Error('SYNTHETIC-TRAP') } })
      sentinel.toString = function () { counts.toString++; throw new Error('SYNTHETIC-TRAP') }
      return { sentinel, counts }
    },
  },
]

// ------------------------------------------------- runner-capture fake bridge
type RunnerCheck = { name: string; status: string; detail: string }
type DbResultShape = { file: string; checks: RunnerCheck[]; failures: string[] }
type RunnerLog = string[]
type RunnerCall = { runtime: unknown; evidenceDir: string; routesConfig: string; options: Record<string, unknown> }

/**
 * FAKE CAPTURE BRIDGE (honestly labeled): stands in for
 * captureWorkflowDbEvidence ONLY. healthy/failed-state return the documented
 * DbEvidenceResult shape; reject-with-source-terminal rejects with a value
 * produced by the REAL extracted queryJson under a resolved malformed string
 * — a PROVABLY SOURCE-GENERATED terminal, never an injected opaque value.
 */
function makeFakeCaptureBridge(mode: 'healthy' | 'failed-state' | 'reject-with-source-terminal', sourceTerminal?: unknown) {
  const calls: RunnerCall[] = []
  const impl = async (runtime: unknown, evidenceDir: string, routesConfig: string, options: Record<string, unknown>): Promise<DbResultShape> => {
    calls.push({ runtime, evidenceDir, routesConfig, options })
    if (mode === 'reject-with-source-terminal' && sourceTerminal !== undefined) {
      throw sourceTerminal
    }
    if (mode === 'failed-state') {
      return { file: 'db-evidence.json', checks: [{ name: 'synthetic-check', status: 'fail', detail: 'synthetic failure detail' }], failures: ['synthetic-check: synthetic failure detail'] }
    }
    return { file: 'db-evidence.json', checks: [{ name: 'synthetic-check', status: 'pass', detail: 'synthetic pass detail' }], failures: [] }
  }
  return { impl, calls }
}

const RUNNER_RUNTIME_FIXTURE = { syntheticRunnerRuntime: true }
const RUNNER_EVIDENCE_DIR = '/synthetic/evidence'

/** Executes the EXACT runner DB try/catch statement text (only deps faked). */
async function runExtractedRunnerDbCatch(
  bridge: ReturnType<typeof makeFakeCaptureBridge>,
): Promise<{ dbCapture: string; dbEvidence: unknown; log: RunnerLog }> {
  assert.ok(typeof RUNNER_DB_TRY_CATCH_TEXT === 'string', 'scaffold: runner DB try/catch extracted from current source')
  const log: RunnerLog = []
  // SYNCHRONOUS boolean predicates matching the ACTUAL helper class: the real
  // runner calls t18b/t18c2/t15aEvidenceApplies(...) synchronously without
  // await (runner:437–439), so async fakes would leak Promises into options.
  const mkSyncPredicate = (value: boolean) => (mode: string, routesConfig: string, scenario?: string): boolean => {
    void mode; void routesConfig; void scenario
    return value
  }
  const ctx = vm.createContext({
    ...GLOBALS(),
    captureWorkflowDbEvidence: bridge.impl,
    runtime: RUNNER_RUNTIME_FIXTURE,
    runEvidenceDir: RUNNER_EVIDENCE_DIR,
    options: { mode: 'full', routesConfig: 'all-defaults' },
    t18bEvidenceApplies: mkSyncPredicate(true),
    t18c2EvidenceApplies: mkSyncPredicate(false),
    t15aEvidenceApplies: mkSyncPredicate(false),
    log: (line: string) => { log.push(line) },
  })
  // The wrapper text is an INVOKED async IIFE, so runInContext returns the
  // Promise itself — await it DIRECTLY; never cast-to-function-and-call.
  const script = new vm.Script(`(async function () {\nlet dbEvidence;\nlet dbCapture = 'null';\n${RUNNER_DB_TRY_CATCH_TEXT}\nreturn { dbEvidence, dbCapture };\n})()`)
  const result = await script.runInContext(ctx) as { dbEvidence: unknown; dbCapture: string }
  return { dbCapture: result.dbCapture, dbEvidence: result.dbEvidence, log }
}

/** Asserts a COMPLETE healthy runner-capture footprint (per-fault prereq). */
function assertHealthyRunnerFootprint(r: { dbCapture: string; dbEvidence: unknown; log: RunnerLog }, bridge: ReturnType<typeof makeFakeCaptureBridge>, tag: string): void {
  assert.equal(r.dbCapture, 'success', `prereq ${tag}: healthy runner capture recorded as success`)
  const evidence = r.dbEvidence as DbResultShape | undefined
  assert.ok(evidence, `prereq ${tag}: healthy dbEvidence retained (meaningful footprint)`)
  assert.equal(evidence?.file, 'db-evidence.json', `prereq ${tag}: documented result file name`)
  assert.equal(evidence?.failures.length, 0, `prereq ${tag}: documented empty failures array`)
  assert.equal(evidence?.checks.length, 1, `prereq ${tag}: documented checks array retained`)
  assert.equal(evidence?.checks[0]?.status, 'pass', `prereq ${tag}: check status retained`)
  assert.equal(r.log.length, 1, `prereq ${tag}: single log line footprint`)
  assert.equal(r.log[0]?.includes('db-evidence.json'), true, `prereq ${tag}: log reports the evidence file`)
  assert.equal(r.log[0]?.includes('1 checks'), true, `prereq ${tag}: log reports the check count`)
  assert.equal(bridge.calls.length, 1, `prereq ${tag}: single capture delegation`)
  assert.equal(bridge.calls[0]?.routesConfig, 'all-defaults', `prereq ${tag}: delegates routesConfig`)
  assert.equal(bridge.calls[0]?.evidenceDir, RUNNER_EVIDENCE_DIR, `prereq ${tag}: delegates the evidence directory`)
  assert.equal(Object.is(bridge.calls[0]?.runtime, RUNNER_RUNTIME_FIXTURE), true, `prereq ${tag}: delegates the runtime by reference (boolean Object.is)`)
  const opts = bridge.calls[0]?.options as Record<string, unknown>
  assert.equal(opts.requireT18b, true, `prereq ${tag}: synchronous boolean requireT18b delegated`)
  assert.equal(opts.requireT18c2, false, `prereq ${tag}: synchronous boolean requireT18c2 delegated`)
  assert.equal(opts.requireT15a, false, `prereq ${tag}: synchronous boolean requireT15a delegated`)
  assert.equal(opts.focusedScenario, undefined, `prereq ${tag}: focusedScenario delegated for full runs`)
}

// ===========================================================================
describe('scaffold: current-source extraction authenticity (distinct from feature RED)', () => {
  it('extracted queryJson and runner DB try/catch are the actual current statements', () => {
    assert.ok(typeof QUERY_JSON_TEXT === 'string' && QUERY_JSON_TEXT.includes('psqlQuery'), 'queryJson text carries the real psqlQuery boundary call')
    assert.ok(typeof QUERY_JSON_TEXT === 'string' && QUERY_JSON_TEXT.includes('JSON.parse'), 'queryJson text carries the real parse catch')
    assert.ok(typeof RUNNER_DB_TRY_CATCH_TEXT === 'string' && RUNNER_DB_TRY_CATCH_TEXT.includes('captureWorkflowDbEvidence'), 'runner try/catch text calls the real capture dependency')
    assert.ok(typeof RUNNER_DB_TRY_CATCH_TEXT === 'string' && RUNNER_DB_TRY_CATCH_TEXT.includes("dbCapture = 'thrown'"), 'runner catch keeps the thrown-state semantics')
    assert.equal(typeof CATEGORY_QUERY_FAILED, 'string', 'hand-derived fixed category example is stable')
  })
})

describe('queryJson healthy semantics and delegation (unchanged success contract)', () => {
  it('raw empty string result returns a zero-length array with exact delegation args', async () => {
    const r = await runExtractedQueryJson(async () => '')
    assert.equal(r.threw, false, 'healthy empty-raw query resolves')
    // Realm-safe booleans: the rows array is VM-created; never compare host
    // prototypes. raw '' must still map to an empty array.
    assert.equal(Array.isArray(r.rows), true, "raw '' returns an array")
    assert.equal((r.rows as unknown[]).length, 0, "raw '' returns a zero-length array")
    assert.equal(r.psqlCalls.length, 1, 'exactly one psql delegation')
    assert.equal(r.psqlCalls[0]?.database, REQUIRED_DATABASE_NAME, 'delegates to the required database name')
    assert.equal(r.psqlCalls[0]?.sql, SYNTHETIC_STATEMENT, 'delegates the caller statement verbatim')
    assert.equal(Object.is(r.psqlCalls[0]?.runtime, RUNTIME_FIXTURE), true, 'delegates the runtime by reference (boolean Object.is)')
  })
  it('valid aggregate JSON returns parsed rows (realm-safe content check)', async () => {
    const r = await runExtractedQueryJson(async () => '[{"syntheticCol":"syntheticValue"}]')
    assert.equal(r.threw, false, 'healthy JSON query resolves')
    assert.equal(Array.isArray(r.rows), true, 'rows are an array (realm-safe boolean)')
    const rows = r.rows as Record<string, unknown>[]
    assert.equal(rows.length, 1, 'single parsed row')
    assert.equal(rows[0]?.syntheticCol, 'syntheticValue', 'parsed row content preserved (trusted fixture key)')
    assert.equal(r.psqlCalls.length, 1, 'single delegation for the healthy path')
    assert.equal(Object.is(r.psqlCalls[0]?.runtime, RUNTIME_FIXTURE), true, 'healthy JSON delegation keeps the runtime reference')
  })
})

describe('queryJson malformed-returned-JSON terminal: canonical fixed category, no payload (future contract; prepared RED)', () => {
  it('own healthy query first; generated terminal must EQUAL the canonical category text', async () => {
    // MATCHING HEALTHY FIRST (same boundary/dependency/input class), fully
    // asserted: parsed output, delegation, database, statement, runtime.
    const healthy = await runExtractedQueryJson(async () => '[]')
    assertHealthyQueryFootprint(healthy, 'malformed')
    // Fault: psql RESOLVES the controlled malformed string — the ONLY possible
    // rejection is queryJson's own parse-catch terminal (provably generated).
    const r = await runExtractedQueryJson(async () => MALFORMED_JSON)
    assert.equal(r.threw, true, 'malformed returned JSON rejects (presence boolean)')
    assertFaultDelegationFootprint(r, 'malformed')
    // Known-generated class check (permitted fixed-generated observer only).
    assert.equal(r.caught instanceof Error, true, 'terminal is the source-generated error class')
    const message = r.caught instanceof Error && typeof r.caught.message === 'string' ? r.caught.message : ''
    // FUTURE CONTRACT (currently FALSE — the prepared RED): CANONICAL EQUALITY
    // asserted as a BOOLEAN RESULT ONLY — neither the actual generated message
    // nor the canonical text is passed as a diagnostic assertion operand, so
    // the intended failure cannot retain or dump raw diagnostic strings.
    const parseMessageCanonical: boolean = message === CANONICAL_PARSE_MESSAGE
    assert.equal(parseMessageCanonical, true, 'terminal message EQUALS the canonical parse-failure text (boolean result; no diagnostic-string operands)')
    assert.equal(message.includes(MALFORMED_MARKER), false, 'terminal contains no resolved-output payload marker')
    assert.equal(message.includes(SQL_MARKER), false, 'terminal contains NO SQL statement text')
    assert.equal(message.includes('stdout'), false, 'terminal contains no stdout payload')
    assert.equal(message.includes('stderr'), false, 'terminal contains no stderr payload')
  })
})

describe('queryJson opaque psql rejections (direct query ONLY): opaque never escapes (future contract; prepared RED)', () => {
  for (const { name, make } of OPAQUE_SENTINELS) {
    it(`sentinel ${name}: same-fixture failure-OFF healthy, then failure-ON fault, zero reads, then no-escape identity`, async () => {
      // ONE fixture instantiated BEFORE the healthy run: the SAME sentinel,
      // the SAME owned counters, and a SINGLE controlled psql executor that
      // closes over THAT captured sentinel, toggled by a trusted
      // failureEnabled flag — never a generic resolving executor, never a
      // new fixture/executor created after the healthy run.
      const { sentinel, counts } = make()
      let failureEnabled = false
      const executor = async (): Promise<string> => {
        if (failureEnabled) throw sentinel
        return '[]'
      }
      const ownedReads = (): number => Object.values(counts).reduce((a, b) => a + b, 0)
      // HEALTHY (failure OFF) with the SAME executor/fixture, fully asserted,
      // including the owned-counter healthy footprint: scalar fixtures carry
      // an empty owned counter object; trap counters unchanged at zero. No
      // wrong sentinel can hide a falsy/null/undefined value — the throw uses
      // this exact closed-over reference when (and only when) the flag is on.
      const healthy = await runExtractedQueryJson(executor)
      assertHealthyQueryFootprint(healthy, `opaque:${name}`)
      assert.equal(ownedReads(), 0, `prereq ${name}: owned counters zero through the failure-OFF healthy run of this exact fixture`)
      // FAULT (failure ON) with the SAME executor/fixture/sentinel.
      failureEnabled = true
      const r = await runExtractedQueryJson(executor)
      // Presence and delegation footprint FIRST — the expected identity fail
      // below must not prevent the prerequisite/zero-read proof.
      assert.equal(r.threw, true, `${name}: rejection presence observed (same executor, failure ON)`)
      assertFaultDelegationFootprint(r, `opaque:${name}`)
      assert.equal(ownedReads(), 0, `${name}: owned counters stay at zero (opaque never read)`)
      // FUTURE CONTRACT (currently FALSE — the prepared RED): the original
      // opaque value must NOT escape. Identity via boolean Object.is ONLY —
      // the caught value is never inspected/coerced/classified here (today it
      // IS the opaque sentinel; instanceof/.message would be forbidden
      // inspection). The fixed-category text is exercised separately via the
      // known-generated reporter path. Opaque values NEVER reach the runner.
      assert.equal(Object.is(r.caught, sentinel), false, `${name}: original opaque value did not escape`)
    })
  }
})

describe('runner DB capture try/catch: success semantics, delegation, canonical fixed-category log (future contract; prepared RED)', () => {
  it('healthy FAKE bridge: success state, documented shape, log/delegation footprints, boolean options', async () => {
    const bridge = makeFakeCaptureBridge('healthy')
    const r = await runExtractedRunnerDbCatch(bridge)
    assertHealthyRunnerFootprint(r, bridge, 'runner-healthy')
  })
  it('failed-state FAKE bridge: own healthy first, then failed state with retained footprints — semantics unchanged', async () => {
    // MATCHING HEALTHY FIRST inside the SAME test at the same boundary.
    const healthyBridge = makeFakeCaptureBridge('healthy')
    const healthy = await runExtractedRunnerDbCatch(healthyBridge)
    assertHealthyRunnerFootprint(healthy, healthyBridge, 'runner-failed-state')
    // Fault: failing checks inside a successful capture fail the run.
    const bridge = makeFakeCaptureBridge('failed-state')
    const r = await runExtractedRunnerDbCatch(bridge)
    assert.equal(r.dbCapture, 'failed', 'failing checks recorded as failed state')
    const evidence = r.dbEvidence as DbResultShape | undefined
    assert.equal(evidence?.failures.length, 1, 'failed-state failures retained (meaningful footprint)')
    assert.equal(r.log.length, 1, 'single log line footprint')
    assert.equal(r.log[0]?.includes('1 failing'), true, 'log reports the failing count')
    assert.equal(bridge.calls.length, 1, 'single capture delegation for the fault case')
  })
  it('SOURCE-generated query terminal: healthy query AND healthy runner first; thrown state with canonical no-payload log', async () => {
    // (1) MATCHING HEALTHY QUERY FIRST, fully asserted — before producing the
    // generated fault value at all.
    const healthyQuery = await runExtractedQueryJson(async () => '[]')
    assertHealthyQueryFootprint(healthyQuery, 'runner-terminal')
    // (2) Produce the terminal with the REAL extracted queryJson: psql
    // RESOLVES the fixed malformed string, so the rejection is PROVABLY
    // SOURCE-GENERATED (never an injected opaque value routed anywhere).
    const generated = await runExtractedQueryJson(async () => MALFORMED_JSON)
    assert.equal(generated.threw, true, 'prereq: source-generated parse terminal produced by the real query path')
    assertFaultDelegationFootprint(generated, 'runner-terminal')
    assert.equal(generated.caught instanceof Error, true, 'prereq: terminal is the known generated class (permitted observer)')
    // (3) MATCHING HEALTHY RUNNER FIRST, fully asserted, at the same boundary.
    const healthyBridge = makeFakeCaptureBridge('healthy')
    const healthy = await runExtractedRunnerDbCatch(healthyBridge)
    assertHealthyRunnerFootprint(healthy, healthyBridge, 'runner-terminal')
    // (4) Fault: the FAKE bridge rejects with the provably source-generated value.
    const bridge = makeFakeCaptureBridge('reject-with-source-terminal', generated.caught)
    const r = await runExtractedRunnerDbCatch(bridge)
    assert.equal(r.dbCapture, 'thrown', 'capture rejection recorded as thrown state')
    assert.equal(r.log.length, 1, 'one log line footprint')
    assert.equal(bridge.calls.length, 1, 'single capture delegation for the fault case')
    const line = r.log[0] ?? ''
    // FUTURE CONTRACT (currently FALSE — the prepared RED): CANONICAL EQUALITY
    // asserted as a BOOLEAN RESULT ONLY — the recorded log line never becomes
    // a diagnostic assertion operand, so the intended failure cannot retain
    // or dump raw diagnostic strings.
    const captureLogCanonical: boolean = line === CANONICAL_CAPTURE_LOG
    assert.equal(captureLogCanonical, true, 'runner log EQUALS the canonical capture-failure text (boolean result; no diagnostic-string operands)')
    assert.equal(line.includes(MALFORMED_MARKER), false, 'runner log contains no resolved-output payload marker')
    assert.equal(line.includes(SQL_MARKER), false, 'runner log contains NO SQL statement text')
    assert.equal(line.includes('stdout'), false, 'runner log contains no stdout payload')
    assert.equal(line.includes('stderr'), false, 'runner log contains no stderr payload')
  })
})

// ===========================================================================
// POST-REPAIR (Task170) OPAQUE RUNNER characterization — appended AFTER the
// Task168 source repair; the original prefix above is byte-identical. The
// CURRENT runner DB catch is UNBOUND and logs only the fixed
// DB_EVIDENCE_CAPTURE_FAILED category, so routing an opaque rejection
// through it is now a safe CHARACTERIZATION of already-correct behavior —
// NOT feature RED and NOT a reconstruction of the forbidden legacy unknown
// baseline. Each case builds ONE fixture BEFORE its healthy run and ONE
// local fake-capture bridge (structurally typed to the existing helper's
// return class) whose failure flag closes over the SAME captured sentinel;
// the flag-gated throw is UNCONDITIONAL (no truthiness guard), so
// undefined/null/false/0/'' are delivered exactly. The opaque value is
// never inspected/classified by the test — only presence/state/log/ledger
// booleans and owned counters.
// ===========================================================================
describe('post-repair opaque runner characterization: unbound catch, fixed category, no payload (appended Task170)', () => {
  for (const { name, make } of OPAQUE_SENTINELS) {
    it(`runner sentinel ${name}: same-bridge healthy→fault pair, thrown state, canonical log, two-call ledger`, async () => {
      // ONE fixture instantiated BEFORE the healthy run; owned counters retained.
      const { sentinel, counts } = make()
      const ownedReads = (): number => Object.values(counts).reduce((a, b) => a + b, 0)
      let failureEnabled = false
      // OWN local fake capture bridge closing over the SAME captured sentinel.
      const calls: RunnerCall[] = []
      const impl = async (runtime: unknown, evidenceDir: string, routesConfig: string, options: Record<string, unknown>): Promise<DbResultShape> => {
        calls.push({ runtime, evidenceDir, routesConfig, options })
        if (failureEnabled) throw sentinel
        return { file: 'db-evidence.json', checks: [{ name: 'synthetic-check', status: 'pass', detail: 'synthetic pass detail' }], failures: [] }
      }
      const bridge: { impl: typeof impl; calls: RunnerCall[] } = { impl, calls }
      // HEALTHY (failure OFF) through the ACTUAL current runner DB catch at
      // the same boundary and same bridge — full footprint first.
      const healthy = await runExtractedRunnerDbCatch(bridge)
      assertHealthyRunnerFootprint(healthy, bridge, `opaque-runner:${name}`)
      assert.equal(ownedReads(), 0, `prereq ${name}: owned counters zero through the failure-OFF healthy runner run`)
      const healthyFirstCall = calls[0]
      const healthyLogCount = healthy.log.length
      // FAULT (failure ON): SAME impl, SAME fixture, SAME bridge.
      failureEnabled = true
      const r = await runExtractedRunnerDbCatch(bridge)
      // State/evidence presence — boolean only; the caught opaque is never
      // observed by this test.
      assert.equal(r.dbCapture, 'thrown', `${name}: capture rejection recorded as thrown state`)
      assert.equal(Object.is(r.dbEvidence, undefined), true, `${name}: no dbEvidence retained for the thrown capture (boolean Object.is)`)
      // Owned counters still zero BEFORE the canonical-log assertion.
      assert.equal(ownedReads(), 0, `${name}: owned counters stay zero through the fault run`)
      // Source-owned pair ledger: healthy call retained + exactly one new
      // fault call (total two), never a reset/discard of the healthy footprint.
      assert.equal(calls.length, 2, `${name}: pair ledger holds healthy+fault (two total calls)`)
      assert.equal(calls[0] !== undefined && Object.is(calls[0], healthyFirstCall), true, `${name}: healthy first call retained by identity`)
      const faultCall = calls[1]
      assert.equal(faultCall !== undefined, true, `${name}: fault call recorded`)
      assert.equal(Object.is(faultCall?.runtime, RUNNER_RUNTIME_FIXTURE), true, `${name}: fault call delegated the runner runtime by reference (boolean Object.is)`)
      assert.equal(faultCall?.evidenceDir, RUNNER_EVIDENCE_DIR, `${name}: fault call delegated the evidence directory`)
      assert.equal(faultCall?.routesConfig, 'all-defaults', `${name}: fault call delegated routesConfig`)
      const opts = faultCall?.options as Record<string, unknown>
      assert.equal(opts.requireT18b, true, `${name}: fault call requireT18b boolean option`)
      assert.equal(opts.requireT18c2, false, `${name}: fault call requireT18c2 boolean option`)
      assert.equal(opts.requireT15a, false, `${name}: fault call requireT15a boolean option`)
      assert.equal(opts.focusedScenario, undefined, `${name}: fault call focusedScenario option`)
      // Log: exactly one line, canonical equality as a BOOLEAN RESULT ONLY —
      // no raw log/diagnostic string operand anywhere.
      assert.equal(r.log.length, 1, `${name}: single log line footprint for the fault run`)
      assert.equal(healthyLogCount, 1, `${name}: healthy log footprint retained (not reset)`)
      const line = r.log[0] ?? ''
      const runnerLogCanonical: boolean = line === CANONICAL_CAPTURE_LOG
      assert.equal(runnerLogCanonical, true, `${name}: runner log EQUALS the canonical capture-failure text (boolean result only)`)
      // Final owned-counter confirmation AFTER all assertions.
      assert.equal(ownedReads(), 0, `${name}: owned counters zero at case end`)
    })
  }
})

/*
 * Task170 footer (bounded historical note): the original 15 cases, comments,
 * helpers, imports, and matrix above were authored BEFORE the Task168 source
 * repair and remain byte-identical — their "prepared RED / future contract"
 * wording describes the historical pre-fix baseline. The appended
 * opaque-runner describe characterizes the CURRENT post-168 repaired
 * unbound catch only; it is expected-green characterization, not new
 * feature RED, not a legacy-unknown-baseline reconstruction, and requires no
 * product change.
 */
