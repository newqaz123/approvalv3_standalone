/**
 * T16A safe recording — formal regression (Task150 approved Task149 design).
 *
 * Executes the EXACT CURRENT application source, never re-implementations:
 * `withRecordedContext`, exported `signedInSegment` and
 * `createSafeRecordingSecondaries` are AST-extracted byte-exact declarations
 * from tests/business-e2e/business-flow-helpers.ts; the LOCAL spec wrapper
 * `signedInSegment`, `SCENARIO_IDS`, `REQUIRED_SECONDARY_KINDS`,
 * `SafeRecordingSecondaryFailure`, and the REAL T16A test callback are
 * extracted from tests/business-e2e/business-failure-isolation.spec.ts; each
 * fragment is transpiled and run inside node:vm sandboxes whose browser/fs/
 * test-report dependencies are boundary fakes. The logical implementation
 * under test is always the real one — no app/DB/browser/socket/HTTP/SMTP/env
 * effect, no credentials.
 *
 * Historical TDD qualification (Task152 review): the D150 pre-edit 02c run
 * (9 pass / 19 fail) was a MIXED set. Eligible behavior RED subset only:
 * F05a/c/d, F07, F08a/b, F09, F10a, F11a (Error-sentinel case only),
 * F02/F03 (callback wiring), F12b/c. NOT eligible as behavior RED: F12a
 * (API-existence/structural), F06/F06b (fixture artifact: alias read
 * options.secondaries of undefined because the pre-edit wrapper passed no
 * options), F10b/F11c/F11d (chain-harness invocation defect whose failures
 * persisted after source apply), F11a falsy cases (pre-fix fixture injected
 * via truthiness so 0/false/'' never threw). Missing historical per-fixture
 * prerequisites CANNOT be retroactively supplied; no full historical
 * formal-TDD claim is made — F12a is a STRUCTURAL prerequisite/coverage
 * assertion and the behavior part asserts only the actually returned flags.
 * Current coverage below is CHARACTERIZATION of already-correct production
 * plus explicit per-fixture nominal-operation prerequisites that BLOCK
 * fault obligations (prereq failure is never eligible RED).
 *
 * Test-first discipline within THIS repair (Task153): F00 fixture-obligation
 * tests were written FIRST and run against the CURRENT fixture BEFORE the
 * presence-injection fix, capturing genuine FIXTURE/HARNESS behavior RED
 * (own-property undefined injection) — not application feature RED; the
 * application source was already conforming. Absent future symbols are
 * structural, never behavior RED. Unknown primaries are never read/
 * inspected/coerced/serialized/mutated/wrapped/caused/aggregated: identity
 * assertions are booleans via Object.is + explicit {threw, caught} presence;
 * hostile sentinels carry trusted read counters; the legacy path's
 * deliberate raw-marker serialization and controlled trap demonstrations are
 * explicitly OUTSIDE the safe-observer promise.
 *
 * Family numbering (F01..F13) mirrors contract-task149 §4; F00 are
 * fixture-obligation tests; R-suffixed cases bridge the REAL callback
 * through the real wrapper/factory/exported/helper chain.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const W = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const HELPER_SRC = readFileSync(path.join(W, 'tests/business-e2e/business-flow-helpers.ts'), 'utf8')
const SPEC_SRC = readFileSync(path.join(W, 'tests/business-e2e/business-failure-isolation.spec.ts'), 'utf8')

// ---------------------------------------------------------------- extraction
const sfH = ts.createSourceFile('helper.ts', HELPER_SRC, ts.ScriptTarget.Latest, true)
const sfS = ts.createSourceFile('spec.ts', SPEC_SRC, ts.ScriptTarget.Latest, true)

function transpile(text: string): string {
  return ts.transpileModule(text.replace(/^export\s+/, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
}
function fnText(sf: ts.SourceFile, name: string): string | undefined {
  const st = sf.statements.find(
    (s: ts.Statement) => ts.isFunctionDeclaration(s) && s.name?.text === name)
  return st ? transpile(st.getText(sf)) : undefined
}
function varText(sf: ts.SourceFile, name: string): string | undefined {
  const st = sf.statements.find(
    (s: ts.Statement) => ts.isVariableStatement(s) &&
      ts.isIdentifier(s.declarationList.declarations[0]?.name) &&
      s.declarationList.declarations[0]?.name.getText(sf) === name)
  return st ? transpile(st.getText(sf)) : undefined
}
function classText(sf: ts.SourceFile, name: string): string | undefined {
  const st = sf.statements.find(
    (s: ts.Statement) => ts.isClassDeclaration(s) && s.name?.text === name)
  return st ? transpile(st.getText(sf)) : undefined
}
function callbackText(): string | undefined {
  // second argument (async arrow) of the real `test('T16A ...')` call
  let out: string | undefined
  const visit = (node: ts.Node): void => {
    if (out || !node) return
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
        node.expression.text === 'test' && node.arguments.length === 2 &&
        ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text.startsWith('T16A')) {
      out = node.arguments[1].getText(sfS)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sfS)
  return out
}

function req<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Error('scaffold-missing: ' + what)
  return v
}

const HELPER_FN_TEXT = fnText(sfH, 'withRecordedContext')
const EXPORTED_FN_TEXT = fnText(sfH, 'signedInSegment')
const FACTORY_FN_TEXT = fnText(sfH, 'createSafeRecordingSecondaries')
const LOCAL_WRAPPER_TEXT = fnText(sfS, 'signedInSegment')
const SCENARIO_IDS_TEXT = varText(sfS, 'SCENARIO_IDS')
const KINDS_TEXT = varText(sfS, 'REQUIRED_SECONDARY_KINDS')
const TERMINAL_CLASS_TEXT = classText(sfS, 'SafeRecordingSecondaryFailure')
const CALLBACK_TEXT = callbackText()
// the real callback now contains TypeScript annotations (e.g. the typed ledger
// declaration) — transpile the extracted fragment before VM evaluation
const CALLBACK_JS = CALLBACK_TEXT
  ? ts.transpileModule(CALLBACK_TEXT, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText.replace(/;\s*$/, '')
  : undefined

const scriptCache = new Map<string, vm.Script>()
function evalBinding(ctx: vm.Context, text: string, name: string): unknown {
  const key = name + '\u0000' + text
  let s = scriptCache.get(key)
  if (!s) {
    s = new vm.Script(`(function () {\n${text}\nreturn ${name};\n})()`, { filename: name + '.extracted.js' })
    scriptCache.set(key, s)
  }
  return s.runInContext(ctx, { timeout: 30000 })
}
const GLOBALS = (): Record<string, unknown> => ({
  Date, Promise, Object, Array, Error, Symbol, JSON, Math, RegExp, String, Number, Boolean,
})

// ------------------------------------------------------------------ fixtures
type RunBody = (tools: unknown) => Promise<{ notes: string }>
type Collector = Record<(typeof COLLECTOR_KEYS)[number], boolean>
type HelperFn = (browser: unknown, env: unknown, label: unknown, run: RunBody, options?: unknown) => Promise<void>
type ExportedFn = (browser: unknown, env: unknown, label: unknown, actorEmail: string, run: RunBody, options?: unknown) => Promise<void>
type WrapperFn = (browser: unknown, label: unknown, actorEmail: string, run: RunBody, ledger?: Collector[]) => Promise<void>
type CallbackFn = (fixtures: { browser: unknown }) => Promise<void>
type AliasFn = (browser: unknown, env: unknown, label: unknown, actorEmail: string, run: RunBody, options?: { evidencePolicy: string; secondaries: Collector }) => Promise<unknown>
type TestInfoImpl = () => { annotations: { push(a: { type: string; description: string }): void } }
type ManifestEntry = { status: string; notes: string; [k: string]: unknown }
type FixtureOverrides = Record<string, unknown>

const ENVF = { baseURL: 'http://synthetic.invalid', evidenceDir: '/synthetic/t150-evidence', routesConfig: 'synthetic-routes', e2ePassword: 'synthetic-e2e-password' }
const LABEL = { scenario: 'SYNTHETIC-SCENARIO', phase: 'synthetic-phase', actor: 'synthetic-actor' }
const T16A_LABEL = { scenario: 'T16A-mail-failure-after-commit', phase: 'synthetic-phase', actor: 'synthetic-actor' }
const T16B_LABEL = { scenario: 'T16B-transaction-failure-no-success-write', phase: 'synthetic-phase', actor: 'synthetic-actor' }
const COLLECTOR_KEYS = ['hasPrimary', 'traceStopFailed', 'contextCloseFailed', 'videoPersistFailed',
  'manifestWriteFailed', 'setupCleanupFailed', 'failureShotFailed', 'reportingFailed',
  'setupCleanupAttempted', 'annotationExposed'] as const

// Pre-edit input fixture (plain literal only — never a fake implementation).
function syntheticCollector(): Collector {
  return { hasPrimary: false, traceStopFailed: false, contextCloseFailed: false,
    videoPersistFailed: false, manifestWriteFailed: false, setupCleanupFailed: false,
    failureShotFailed: false, reportingFailed: false, setupCleanupAttempted: false,
    annotationExposed: false }
}
const safeOpts = (secondaries: Collector): { evidencePolicy: string; secondaries: Collector } =>
  ({ evidencePolicy: 'fixed-evidence-only', secondaries })

function makeFixture(o: FixtureOverrides = {}, sharedLog?: string[]) {
  // OWN-PROPERTY presence injection (F00 repair): Object.hasOwn distinguishes
  // an explicitly stored sentinel — including undefined and null — from an
  // absent key, so every falsy/hosile sentinel is injectable per case.
  const has = (k: string) => Object.hasOwn(o, k)
  const calls: Record<string, number> = { mkdir: 0, newContext: 0, newPage: 0, tracingStart: 0, traceStop: 0, close: 0, videoPath: 0, rename: 0, manifest: 0, screenshot: 0 }
  const manifests: ManifestEntry[] = []
  const order: string[] = sharedLog ?? []
  let newContextCount = 0
  const video = { path: async (): Promise<string> => { calls.videoPath++; order.push('videoPath'); return '/synthetic/videos/gen.webm' } }
  const page = { video: (): unknown => { if (has('videoError')) throw o.videoError; return o.videoNull ? null : video } }
  const context = {
    newPage: async (): Promise<unknown> => { calls.newPage++; if (has('newPageError')) throw o.newPageError; return page },
    tracing: {
      start: async (): Promise<void> => { calls.tracingStart++; order.push('tracingStart') },
      stop: async (): Promise<void> => { calls.traceStop++; order.push('traceStop'); if (has('traceStopError')) throw o.traceStopError },
    },
    close: async (): Promise<void> => { calls.close++; if (has('closeError')) throw o.closeError; order.push('close') },
  }
  const browser = {
    newContext: async (): Promise<unknown> => {
      calls.newContext++
      newContextCount++
      if (typeof o.failNthNewContext === 'number' && newContextCount === o.failNthNewContext && has('nthNewContextError')) {
        throw o.nthNewContextError // explicit per-case sentinel (counter-based phase injection)
      }
      if (has('newContextError')) throw o.newContextError
      return context
    },
  }
  const sandboxBits: Record<string, unknown> = {
    path,
    fs: {
      mkdir: async (): Promise<void> => { calls.mkdir++; if (has('mkdirError')) throw o.mkdirError },
      rename: async (): Promise<void> => { calls.rename++; order.push('rename'); if (has('renameError')) throw o.renameError },
    },
    segmentSlug: (): string => 'synthetic-segment',
    makeCheckpointPage: (): { page: unknown; shots: unknown[]; checkpoint: () => Promise<string> } => {
      if (has('makeCheckpointPageError')) throw o.makeCheckpointPageError
      return { page, shots: [], checkpoint: async () => { order.push('checkpoint'); return 'synthetic-checkpoint' } }
    },
    screenshot: async (): Promise<string> => { calls.screenshot++; order.push('screenshot'); if (has('screenshotError')) throw o.screenshotError; return 'synthetic-shot.png' },
    appendManifest: async (_env: unknown, entry: ManifestEntry): Promise<void> => { calls.manifest++; order.push('manifest'); if (has('manifestError')) throw o.manifestError; manifests.push(entry) },
  }
  return { calls, manifests, order, page, context, browser, sandboxBits }
}

// per-fixture nominal-operation prerequisite: runs a healthy twin through the
// same fixture/harness path and BLOCKS fault obligations when it fails
// (prerequisite failure is never eligible RED)
async function prereqHelperNominal(tag: string): Promise<void> {
  const pre = await runHelper({}, async () => ({ notes: `prereq-${tag}` }))
  assert.equal(pre.threw, false, `prereq ${tag}: nominal fixture run resolves`)
  assert.equal(pre.fx.calls.newContext, 1, `prereq ${tag}: nominal newContext once`)
  assert.equal(pre.fx.calls.manifest, 1, `prereq ${tag}: nominal manifest attempted`)
}
async function prereqWrapperNominal(tag: string): Promise<void> {
  const alias: AliasFn = async (browser, env, label, actorEmail, run) => {
    void browser; void env; void label; void actorEmail
    await run({ page: {}, checkpoint: async () => {} })
    return undefined
  }
  const { wrapper } = buildWrapperCtx(alias, recordingTestInfo([]))
  const ledger: Collector[] = []
  let threw = false
  try { await wrapper({}, T16A_LABEL, 'prereq', async () => ({ notes: `prereq-${tag}` }), ledger) } catch { threw = true }
  assert.equal(threw, false, `prereq ${tag}: nominal wrapper call resolves`)
  assert.equal(ledger.length, 1, `prereq ${tag}: nominal wrapper retains one collector`)
}
// MATCHING nominal twins (Task155 finding 2): a safe-helper fault case is
// preceded by a SAFE-mode nominal (same safe policy + fresh collector), and a
// full real-chain fault case is preceded by a healthy run of the SAME
// helper→exported→wrapper chain with the same dependency class — never a
// generic legacy/fake-alias substitute.
async function prereqSafeHelperNominal(tag: string): Promise<void> {
  const c = syntheticCollector()
  const pre = await runHelper({}, async () => ({ notes: `prereq-${tag}` }), safeOpts(c))
  assert.equal(pre.threw, false, `prereq ${tag}: safe-mode nominal resolves`)
  assert.equal(pre.fx.calls.newContext, 1, `prereq ${tag}: nominal newContext once`)
  assert.equal(pre.fx.manifests[0]?.status, 'Pass', `prereq ${tag}: nominal safe manifest Pass`)
  for (const k of COLLECTOR_KEYS) assert.equal(c[k], false, `prereq ${tag}: nominal collector ${k} stays false`)
}
async function prereqRealChainCase(tag: string, mkChain: () => { run: () => Promise<void>; ledger: Collector[]; annotations: { type: string; description: string }[] }): Promise<void> {
  const healthy = mkChain()
  let threw = false
  try { await healthy.run() } catch { threw = true }
  assert.equal(threw, false, `prereq ${tag}: matching healthy real-chain case resolves`)
  assert.equal(healthy.ledger.length, 1, `prereq ${tag}: matching healthy chain retained one collector`)
  assert.equal(healthy.annotations.length, 1, `prereq ${tag}: matching healthy chain reported once`)
}
function buildRealChainCase(o: FixtureOverrides): { run: () => Promise<void>; ledger: Collector[]; annotations: { type: string; description: string }[]; fx: ReturnType<typeof makeFixture> } {
  const fx = makeFixture(o)
  const annotations: { type: string; description: string }[] = []
  const chain = buildRealChain({ ...fx.sandboxBits, signIn: async () => {} })
  const { wrapper } = buildWrapperCtx(chain.signedInSegment as unknown as AliasFn, recordingTestInfo(annotations))
  const ledger: Collector[] = []
  const run = async (): Promise<void> => {
    // uses the case's OWN fixture browser (same dependency class as the fault twin)
    await wrapper(fx.browser, T16A_LABEL, 'synthetic+actor', async () => ({ notes: 'healthy' }), ledger)
  }
  return { run, ledger, annotations, fx }
}

async function runHelper(o: FixtureOverrides, run: RunBody, options?: unknown): Promise<{ fx: ReturnType<typeof makeFixture>; threw: boolean; caught: unknown }> {
  const fx = makeFixture(o)
  const ctx = vm.createContext({ ...fx.sandboxBits, ...GLOBALS() })
  const fn = evalBinding(ctx, req(HELPER_FN_TEXT, 'withRecordedContext'), 'withRecordedContext') as HelperFn
  let caught: unknown, threw = false
  try { await fn(fx.browser, ENVF, LABEL, run, options) } catch (e) { threw = true; caught = e }
  return { fx, threw, caught }
}

// hostile sentinels with trusted read counters (counting coercion attempts)
function hostileMessage(counts: Record<string, number>): Error {
  const e = new Error('SYNTHETIC-RAW-MESSAGE')
  Object.defineProperty(e, 'message', { get() { counts.message++; throw new Error('SYNTHETIC-GETTER-THROW') } })
  return e
}
function hostileName(counts: Record<string, number>): Error {
  const e = new Error('SYNTHETIC-RAW-MESSAGE')
  Object.defineProperty(e, 'name', { get() { counts.name++; throw new Error('SYNTHETIC-GETTER-THROW') } })
  return e
}
function hostileToPrimitive(counts: Record<string, number>): Record<string | symbol, unknown> {
  const o: Record<string | symbol, unknown> = {}
  Object.defineProperty(o, Symbol.toPrimitive, { value() { counts['toPrimitive']++; throw new Error('SYNTHETIC-CONVERSION-THROW') } })
  o.toString = function () { counts['toString']++; throw new Error('SYNTHETIC-CONVERSION-THROW') }
  return o
}

// ------------------------------------------------------------ wrapper harness
function buildWrapperCtx(aliasImpl: AliasFn, testInfoImpl: TestInfoImpl): { wrapper: WrapperFn } {
  const ctx = vm.createContext({ ...GLOBALS() }) as vm.Context & Record<string, unknown>
  if (SCENARIO_IDS_TEXT) ctx.SCENARIO_IDS = evalBinding(ctx, SCENARIO_IDS_TEXT, 'SCENARIO_IDS')
  if (KINDS_TEXT) ctx.REQUIRED_SECONDARY_KINDS = evalBinding(ctx, KINDS_TEXT, 'REQUIRED_SECONDARY_KINDS')
  if (TERMINAL_CLASS_TEXT) ctx.SafeRecordingSecondaryFailure = evalBinding(ctx, TERMINAL_CLASS_TEXT, 'SafeRecordingSecondaryFailure')
  if (FACTORY_FN_TEXT) ctx.createSafeRecordingSecondaries = evalBinding(ctx, FACTORY_FN_TEXT, 'createSafeRecordingSecondaries')
  ctx.env = ENVF
  ctx.signedInSegmentFor = aliasImpl
  ctx.test = { info: testInfoImpl, setTimeout() {} }
  const wrapper = evalBinding(ctx, req(LOCAL_WRAPPER_TEXT, 'local wrapper'), 'signedInSegment') as WrapperFn
  return { wrapper }
}
function recordingTestInfo(sink: { type: string; description: string }[], failMode?: 'throw'): TestInfoImpl {
  return () => {
    if (failMode === 'throw') throw new Error('SYNTHETIC-REPORTER-THROW')
    return { annotations: { push(a: { type: string; description: string }) { sink.push(a) } } }
  }
}

// ------------------------------------------------------- real-callback harness
const scenarioIdsValue = (() => {
  const ctx = vm.createContext({ ...GLOBALS() })
  return evalBinding(ctx, req(SCENARIO_IDS_TEXT, 'SCENARIO_IDS'), 'SCENARIO_IDS') as Record<string, string>
})()
type CallbackCall = { phase: string; ledger: unknown; ledgerDefinedAtCall: boolean }
function makeCallbackFx(opts: { failPhase?: string } = {}) {
  const calls: CallbackCall[] = []
  let mailPort = 'SYNTHETIC-PREV-PORT'
  const injectedSentinel = new Error('SYNTHETIC-INJECTED-SEGMENT-FAILURE') // fixture-owned explicit sentinel reference
  const fakeSignedIn = async (browser: unknown, label: { phase: string }, actorEmail: string, run: RunBody, ledger?: Collector[]): Promise<void> => {
    void browser; void actorEmail
    calls.push({ phase: label.phase, ledger, ledgerDefinedAtCall: ledger !== undefined })
    if (opts.failPhase === label.phase) throw injectedSentinel
    await run({ page: {}, checkpoint: async () => 'synthetic-checkpoint' })
  }
  const sandbox: Record<string, unknown> = {
    ...GLOBALS(),
    SCENARIO_IDS: scenarioIdsValue,
    test: { setTimeout() {} },
    uniqueBusinessTitle: (): string => 'SYNTHETIC-T16A-TITLE',
    signedInSegment: fakeSignedIn,
    BUSINESS_ACTOR_EMAILS: { requesterA: 'synthetic+requesterA', supervisorP: 'synthetic+supervisorP',
      sectionManagerP: 'synthetic+sectionManagerP', departmentManager: 'synthetic+departmentManager',
      admin: 'synthetic+admin', secondApprover: 'synthetic+secondApprover' },
    slug: (): string => 'synthetic-slug',
    createRequestViaUi: async (): Promise<void> => {},
    approveCurrentStepViaUi: async (): Promise<void> => {},
    expectMyActionItemRow: async (): Promise<void> => {},
    expectBellNotificationForRequest: async (): Promise<void> => {},
    expectNoMyActionItem: async (): Promise<void> => {},
    setEmailSmtpPortViaUi: async (_page: unknown, _checkpoint: unknown, nextPort: string): Promise<string> => { const prev = mailPort; mailPort = nextPort; return prev },
    expect: (v: unknown): { toBe(exp: unknown): void } => ({ toBe(exp: unknown) { if (v !== exp) throw new Error('SYNTHETIC-EXPECT-MISMATCH') } }),
  }
  const ctx = vm.createContext(sandbox)
  const callback = new vm.Script(`(${req(CALLBACK_JS, 'T16A callback JS')})`, { filename: 't16a-callback.extracted.js' })
    .runInContext(ctx, { timeout: 30000 }) as CallbackFn
  const wiringOk = (): boolean => calls.length === 7 && calls.every((c) => c.ledgerDefinedAtCall && c.ledger === calls[0].ledger)
  return { calls, ctx, callback, wiringOk, injectedSentinel }
}

// chain builder: REAL helper + REAL exported segment in one VM context
function buildRealChain(ctxExtras: Record<string, unknown>): { signedInSegment: ExportedFn } {
  const script = new vm.Script(`(function () {\n${req(HELPER_FN_TEXT, 'withRecordedContext')}\nreturn { withRecordedContext, signedInSegment: (function () {\n${req(EXPORTED_FN_TEXT, 'exported signedInSegment')}\nreturn signedInSegment;\n})() };\n})()`)
  const ctx = vm.createContext({ ...GLOBALS() }) as vm.Context & Record<string, unknown>
  const chain = script.runInContext(ctx, { timeout: 30000 }) as { signedInSegment: ExportedFn }
  for (const [k, v] of Object.entries(ctxExtras)) ctx[k] = v
  return chain
}

// ------------------------------------------------- REAL-callback bridge harness
// Bridges the REAL T16A test callback through the REAL local wrapper + REAL
// factory → REAL exported segment → REAL withRecordedContext, with controlled
// browser/fs/UI/sign-in/test-report boundary fakes only. `shadowLedger`
// swaps the callback's ledger declaration for `(globalThis.__t16aLedger ??= [])`
// (pure-shadow instrumentation, canary-class) so the retained collectors and
// their pre-delegation/pre-report retention ordering are directly observable.
type BridgeObs = { ledgerLen: number; annotationCount: number; freshAtBody: Record<string, boolean> | null }
function makeRealCallbackFx(opts: { failNthNewContext?: number; shadowLedger?: boolean } = {}) {
  const fixtureOverrides: FixtureOverrides = {}
  if (opts.failNthNewContext !== undefined) {
    fixtureOverrides.failNthNewContext = opts.failNthNewContext
    fixtureOverrides.nthNewContextError = new Error('SYNTHETIC-PHASE4-NEWCONTEXT-FAILURE')
  }
  const fixture = makeFixture(fixtureOverrides)
  const annotations: { type: string; description: string }[] = []
  const uiCalls: string[] = []
  const order: string[] = []
  const obs: BridgeObs[] = []
  let mailPort = 'SYNTHETIC-PREV-PORT'
  const ctx = vm.createContext({ ...GLOBALS() }) as vm.Context & Record<string, unknown>
  // REAL helper-side declarations and fixture deps
  for (const [k, v] of Object.entries(fixture.sandboxBits)) ctx[k] = v
  ctx.createSafeRecordingSecondaries = evalBinding(ctx, req(FACTORY_FN_TEXT, 'createSafeRecordingSecondaries'), 'createSafeRecordingSecondaries')
  ctx.signIn = async () => { order.push('signIn') }
  const chainScript = new vm.Script(`(function () {\n${req(HELPER_FN_TEXT, 'withRecordedContext')}\nreturn { withRecordedContext, signedInSegment: (function () {\n${req(EXPORTED_FN_TEXT, 'exported signedInSegment')}\nreturn signedInSegment;\n})() };\n})()`)
  const chain = chainScript.runInContext(ctx, { timeout: 30000 }) as { signedInSegment: ExportedFn }
  // REAL spec-side declarations
  ctx.SCENARIO_IDS = evalBinding(ctx, req(SCENARIO_IDS_TEXT, 'SCENARIO_IDS'), 'SCENARIO_IDS')
  if (KINDS_TEXT) ctx.REQUIRED_SECONDARY_KINDS = evalBinding(ctx, KINDS_TEXT, 'REQUIRED_SECONDARY_KINDS')
  if (TERMINAL_CLASS_TEXT) ctx.SafeRecordingSecondaryFailure = evalBinding(ctx, TERMINAL_CLASS_TEXT, 'SafeRecordingSecondaryFailure')
  ctx.env = ENVF
  ctx.signedInSegmentFor = chain.signedInSegment
  ctx.test = { info: () => ({ annotations: { push(a: { type: string; description: string }) { annotations.push(a) } } }), setTimeout() {} }
  const realWrapper = evalBinding(ctx, req(LOCAL_WRAPPER_TEXT, 'local wrapper'), 'signedInSegment') as WrapperFn
  // controlled UI/boundary fakes for the callback bodies (phase-observable)
  const observe = () => {
    const ledger = ctx.__t16aLedger as Collector[] | undefined
    obs.push({
      ledgerLen: Array.isArray(ledger) ? ledger.length : -1,
      annotationCount: annotations.length,
      freshAtBody: Array.isArray(ledger) && ledger.length > 0 ? { ...(ledger[ledger.length - 1] as unknown as Record<string, boolean>) } : null,
    })
  }
  ctx.uniqueBusinessTitle = (): string => 'SYNTHETIC-T16A-TITLE'
  ctx.signedInSegment = realWrapper // the callback's signedInSegment IS the REAL wrapper
  ctx.BUSINESS_ACTOR_EMAILS = { requesterA: 'synthetic+requesterA', supervisorP: 'synthetic+supervisorP',
    sectionManagerP: 'synthetic+sectionManagerP', departmentManager: 'synthetic+departmentManager',
    admin: 'synthetic+admin', secondApprover: 'synthetic+secondApprover' }
  ctx.slug = (): string => 'synthetic-slug'
  ctx.createRequestViaUi = async (): Promise<void> => { observe(); uiCalls.push('createRequestViaUi') }
  ctx.approveCurrentStepViaUi = async (): Promise<void> => { observe(); uiCalls.push('approveCurrentStepViaUi') }
  ctx.expectMyActionItemRow = async (): Promise<void> => { observe(); uiCalls.push('expectMyActionItemRow') }
  ctx.expectBellNotificationForRequest = async (): Promise<void> => { observe(); uiCalls.push('expectBellNotificationForRequest') }
  ctx.expectNoMyActionItem = async (): Promise<void> => { observe(); uiCalls.push('expectNoMyActionItem') }
  ctx.setEmailSmtpPortViaUi = async (_p: unknown, _c: unknown, nextPort: string): Promise<string> => { observe(); uiCalls.push('setEmailSmtpPortViaUi'); const prev = mailPort; mailPort = nextPort; return prev }
  ctx.expect = (v: unknown): { toBe(exp: unknown): void } => ({ toBe(exp: unknown) { if (v !== exp) throw new Error('SYNTHETIC-EXPECT-MISMATCH') } })
  // real (unmutated) callback, or pure-shadow ledger-instrumented mutant
  const tsText = req(CALLBACK_TEXT, 'T16A callback')
  const mutated = opts.shadowLedger
    ? tsText.replace('const ledger: SafeRecordingLedger = []', 'const ledger: SafeRecordingLedger = (globalThis.__t16aLedger ??= [])')
    : tsText
  if (opts.shadowLedger && mutated === tsText) throw new Error('scaffold-missing: shadow ledger anchor absent')
  const js = ts.transpileModule(mutated, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText.replace(/;\s*$/, '')
  const callback = new vm.Script(`(${js})`, { filename: opts.shadowLedger ? 't16a-callback.shadow.js' : 't16a-callback.real.js' })
    .runInContext(ctx, { timeout: 30000 }) as CallbackFn
  return {
    callback, fixture, annotations, uiCalls, obs, order, ctx,
    shadowLedger: (): Collector[] | undefined => (ctx.__t16aLedger as Collector[] | undefined),
    sentinel: fixtureOverrides.nthNewContextError as unknown,
  }
}

// ===========================================================================
// F00 — FIXTURE-OBLIGATION tests (Task153): written FIRST and run against the
// CURRENT fixture BEFORE the presence-injection repair. A failure here is a
// genuine FIXTURE/HARNESS behavior defect (not application feature RED — the
// application source already conforms); after the fixture repair these are
// permanent obligations.
// ===========================================================================
test('F00a fixture obligation: own-property undefined injection throws undefined', async () => {
  const c = syntheticCollector()
  const r = await runHelper({ newPageError: undefined }, async () => ({ notes: 'never' }), safeOpts(c))
  assert.equal(r.threw, true, 'rejection PRESENCE observed (own-property undefined sentinel)')
  assert.equal(Object.is(r.caught, undefined), true, 'exact undefined identity via Object.is')
})
test('F00b fixture obligation: explicit null sentinel stored per case, thrown exactly', async () => {
  const c = syntheticCollector()
  const r = await runHelper({ newPageError: null }, async () => ({ notes: 'never' }), safeOpts(c))
  assert.equal(r.threw, true, 'rejection PRESENCE observed (explicit null sentinel)')
  assert.equal(Object.is(r.caught, null), true, 'exact null identity via Object.is — never nullish-selection drift')
})
test('F00c fixture obligation: presence/identity assertion shape is boolean-only', async () => {
  const healthy = await runHelper({}, async () => ({ notes: 'ok' }))
  assert.equal(healthy.threw, false, 'no rejection: boolean presence false')
  const sentinel = new Error('SYNTHETIC-PREREQ-PRIMARY')
  const failing = await runHelper({}, async () => { throw sentinel })
  assert.equal(failing.threw, true, 'rejection presence boolean')
  assert.equal(Object.is(failing.caught, sentinel), true, 'identity via Object.is boolean, no opaque compare')
})

// ===========================================================================
// F13(a-c) — scaffold/runnability prerequisites (must be GREEN in both phases
// before any obligation counts; failures here are scaffold, not behavior RED)
// ===========================================================================
test('F13a scaffold: real declarations extracted from current source', () => {
  assert.ok(typeof HELPER_FN_TEXT === 'string' && HELPER_FN_TEXT.includes('withRecordedContext'), 'helper declaration extracted')
  assert.ok(typeof EXPORTED_FN_TEXT === 'string' && EXPORTED_FN_TEXT.includes('signedInSegment'), 'exported segment extracted')
  assert.ok(typeof LOCAL_WRAPPER_TEXT === 'string' && LOCAL_WRAPPER_TEXT.includes('signedInSegment'), 'local wrapper extracted')
  assert.ok(typeof SCENARIO_IDS_TEXT === 'string' && SCENARIO_IDS_TEXT.includes('T16A'), 'SCENARIO_IDS extracted')
  assert.ok(typeof CALLBACK_TEXT === 'string' && CALLBACK_TEXT.includes('approveCurrentStepViaUi'), 'real T16A callback extracted')
})
test('F13b scaffold: helper fixture operates (nominal clean pass)', async () => {
  const r = await runHelper({}, async () => ({ notes: 'synthetic-pass' }))
  assert.equal(r.threw, false, 'nominal run resolves')
  assert.equal(r.fx.calls.newContext, 1, 'newContext once')
  assert.equal(r.fx.calls.newPage, 1, 'newPage once')
  assert.equal(r.fx.calls.tracingStart, 1, 'tracing start once')
  assert.equal(r.fx.calls.traceStop, 1, 'trace stop attempted once')
  assert.equal(r.fx.calls.close, 1, 'close attempted once')
  assert.equal(r.fx.calls.rename, 1, 'video rename attempted once')
  assert.equal(r.fx.calls.manifest, 1, 'manifest attempted once')
  assert.equal(r.fx.manifests[0].status, 'Pass', 'manifest status Pass')
})
test('F13c scaffold: callback fixture operates with real callback and 7 phases', async () => {
  const fx = makeCallbackFx()
  let rejected = false
  try { await fx.callback({ browser: {} }) } catch { rejected = true }
  assert.equal(rejected, false, 'healthy real callback resolves against fakes (presence boolean)')
  assert.equal(fx.calls.length, 7, 'seven real segment invocations reached')
  const phases = fx.calls.map((c) => c.phase)
  assert.deepEqual(phases, ['create-request', 'request-approval-step1', 'break-mail-transport',
    'approve-while-mail-broken', 'verify-advance', 'verify-inapp-notification-survived',
    'restore-mail-transport'], 'all seven actual phases in order')
})

// ===========================================================================
// F01 — legacy default / T16B compatibility (already-green characterization;
// pinned unchanged: default path keeps today's exact behavior)
// ===========================================================================
test('F01a legacy default: finalization ORDER + Pass manifest unchanged', async () => {
  const r = await runHelper({}, async () => ({ notes: 'legacy-notes' }))
  assert.equal(r.threw, false, 'resolves')
  assert.equal(r.fx.manifests[0].notes, 'legacy-notes', 'default notes come from run result')
  assert.equal(r.fx.calls.traceStop, 1, 'trace stop once')
  assert.equal(r.fx.calls.close, 1, 'close once')
  assert.equal(r.fx.calls.rename, 1, 'rename once')
  assert.equal(r.fx.calls.manifest, 1, 'manifest once')
  // ORDER (not just counts): tracingStart < traceStop < close < videoPath/rename < manifest
  const idx = (n: string) => r.fx.order.indexOf(n)
  assert.ok(idx('tracingStart') >= 0 && idx('traceStop') >= 0 && idx('close') >= 0 && idx('rename') >= 0 && idx('manifest') >= 0, 'all finalizer order events recorded')
  assert.equal(idx('tracingStart') < idx('traceStop'), true, 'trace stop ordered after tracing start')
  assert.equal(idx('traceStop') < idx('close'), true, 'close ordered after trace stop')
  assert.equal(idx('close') < idx('rename'), true, 'video rename ordered after close')
  assert.equal(idx('rename') < idx('manifest'), true, 'manifest ordered after rename')
})
test('F01b legacy default: ordinary primary message serialized into notes (pinned)', async () => {
  const r = await runHelper({}, async () => { throw new Error('SYNTHETIC-RAW-MESSAGE') })
  assert.equal(r.threw, true, 'rethrows')
  assert.equal(r.fx.manifests[0].status, 'Fail', 'status Fail')
  assert.equal(r.fx.manifests[0].notes.includes('SYNTHETIC-RAW-MESSAGE'), true, 'legacy raw marker in notes retained')
})
test('F01c legacy default: setup rejection propagates exactly with no close (pinned)', async () => {
  await prereqHelperNominal('F01c')
  const sentinel = new Error('SYNTHETIC-NEWPAGE-FAILURE')
  const r = await runHelper({ newPageError: sentinel }, async () => ({ notes: 'x' }))
  assert.equal(r.threw, true, 'rejection presence observed')
  assert.equal(Object.is(r.caught, sentinel), true, 'exact setup primary identity via Object.is')
  assert.equal(r.fx.calls.close, 0, 'no close attempt in default mode')
})

// ===========================================================================
// F12(a) — exported factory exists with exactly ten all-false booleans
// ===========================================================================
test('F12a factory: createSafeRecordingSecondaries exports ten all-false flags', () => {
  assert.ok(typeof FACTORY_FN_TEXT === 'string', 'factory declaration exists in real helper source')
  const ctx = vm.createContext({ ...GLOBALS() })
  const factory = evalBinding(ctx, FACTORY_FN_TEXT, 'createSafeRecordingSecondaries') as () => Collector
  const c = factory()
  assert.deepEqual(Object.keys(c).sort(), COLLECTOR_KEYS.slice().map(String).sort(), 'exactly the ten declared fields')
  for (const k of COLLECTOR_KEYS) assert.equal(c[k], false, `field ${k} initialized false`)
})

// ===========================================================================
// F05 — actual local wrapper (AST-executed) forwarding/wiring
// ===========================================================================
test('F05a wrapper: T16A forwards policy+fresh collector, retains in ledger BEFORE alias', async () => {
  let ledgerLenAtFirstCall = -1
  let freshAtCall: Collector | null = null
  let forwardedCollector: Collector | undefined
  const ledger: Collector[] = []
  const alias: AliasFn = async (browser, env, label, actorEmail, run, options) => {
    void browser; void env; void label; void actorEmail
    if (freshAtCall === null) {
      ledgerLenAtFirstCall = ledger.length
      freshAtCall = options ? { ...options.secondaries } : null // snapshot at delegation time
      forwardedCollector = options?.secondaries
    }
    await run({ page: {}, checkpoint: async () => {} })
    return undefined
  }
  const sink: { type: string; description: string }[] = []
  const { wrapper } = buildWrapperCtx(alias, recordingTestInfo(sink))
  await wrapper({}, T16A_LABEL, 'synthetic+actor', async () => ({ notes: 'x' }), ledger)
  assert.equal(ledgerLenAtFirstCall, 1, 'collector retained in ledger BEFORE alias invocation')
  assert.ok(freshAtCall, 'options forwarded on T16A path')
  for (const k of COLLECTOR_KEYS) assert.equal(freshAtCall[k], false, `fresh collector at delegation: ${k}=false`)
  assert.equal(ledger[0] === forwardedCollector, true, 'ledger holds the exact forwarded collector by identity')
  assert.equal(sink.length, 1, 'annotation recorded after delegation')
  assert.equal(ledger[0].annotationExposed, true, 'annotationExposed INFO set after successful reporting')
  assert.equal((JSON.parse(sink[0].description) as Record<string, unknown>).secondaries === undefined, true, 'projection is flat fixed keys (no nested object)')
})
test('F05b wrapper: T16B/default forwards NO options and no annotation', async () => {
  let seenOptions: unknown = 'unset'
  const alias: AliasFn = async (browser, env, label, actorEmail, run, options) => {
    void browser; void env; void label; void actorEmail
    seenOptions = options
    await run({ page: {}, checkpoint: async () => {} })
    return undefined
  }
  const sink: { type: string; description: string }[] = []
  const { wrapper } = buildWrapperCtx(alias, recordingTestInfo(sink))
  await wrapper({}, T16B_LABEL, 'synthetic+actor', async () => ({ notes: 'x' }))
  assert.equal(seenOptions, undefined, 'no options on T16B path')
  assert.equal(sink.length, 0, 'no annotation on T16B path')
})
test('F05c wrapper: T16A without ledger fails closed with fixed wiring error', async () => {
  await prereqWrapperNominal('F05c') // matching healthy wrapper twin BEFORE the missing-ledger fault
  let aliasInvocations = 0
  const alias: AliasFn = async (browser, env, label, actorEmail, run) => {
    void browser; void env; void label; void actorEmail; void run
    aliasInvocations++
    return undefined
  }
  const { wrapper } = buildWrapperCtx(alias, recordingTestInfo([]))
  let caught: unknown, threw = false
  try { await wrapper({}, T16A_LABEL, 'synthetic+actor', async () => ({ notes: 'x' })) } catch (e) { threw = true; caught = e }
  assert.equal(threw, true, 'missing ledger rejects')
  assert.equal(aliasInvocations, 0, 'nothing delegated before the wiring error')
  assert.equal(caught instanceof Error && typeof caught.message === 'string' &&
    caught.message.includes('t16a-safe-recording'), true, 'fixed wiring error class/message')
})
test('F05d wrapper: two T16A invocations get distinct fresh collectors in the SAME ledger', async () => {
  const seen: (Collector | undefined)[] = []
  const alias: AliasFn = async (browser, env, label, actorEmail, run, options) => {
    void browser; void env; void label; void actorEmail
    seen.push(options?.secondaries)
    await run({ page: {}, checkpoint: async () => {} })
    return undefined
  }
  const { wrapper } = buildWrapperCtx(alias, recordingTestInfo([]))
  const ledger: Collector[] = []
  await wrapper({}, T16A_LABEL, 'a', async () => ({ notes: 'x' }), ledger)
  await wrapper({}, T16A_LABEL, 'b', async () => ({ notes: 'x' }), ledger)
  assert.equal(ledger.length, 2, 'two collectors retained')
  assert.equal(ledger[0] === ledger[1], false, 'collectors are distinct (no stale reuse)')
  assert.equal(seen[0] === ledger[0], true, 'first forwarded by identity')
  assert.equal(seen[1] === ledger[1], true, 'second forwarded by identity')
})

// ===========================================================================
// F06 — wrapper fail-closed terminal (no primary + required kind)
// ===========================================================================
test('F06 wrapper: no-primary required secondary fails closed with fixed kinds', async () => {
  await prereqWrapperNominal('F06')
  const alias: AliasFn = async (browser, env, label, actorEmail, run, options) => {
    void browser; void env; void label; void actorEmail
    if (options) options.secondaries.manifestWriteFailed = true
    await run({ page: {}, checkpoint: async () => {} })
    return undefined
  }
  const { wrapper } = buildWrapperCtx(alias, recordingTestInfo([]))
  const ledger: Collector[] = []
  let caught: unknown, threw = false
  try { await wrapper({}, T16A_LABEL, 'a', async () => ({ notes: 'x' }), ledger) } catch (e) { threw = true; caught = e }
  assert.equal(threw, true, 'secondary-only failure rejects (never standalone success)')
  assert.equal(caught instanceof Error && typeof caught.message === 'string' &&
    caught.message.includes('safe-recording-required-secondary-failed'), true, 'fixed terminal error')
  assert.equal(caught instanceof Error && caught.message.includes('manifestWriteFailed'), true, 'kind listed in terminal message')
  assert.equal(ledger[0]?.manifestWriteFailed, true, 'flag survives on retained ledger object')
})
test('F06T terminal matrix: every one of the 7 required kinds fails closed; all 3 INFO kinds never fail', async () => {
  const REQUIRED = ['traceStopFailed', 'contextCloseFailed', 'videoPersistFailed', 'manifestWriteFailed', 'setupCleanupFailed', 'failureShotFailed', 'reportingFailed'] as const
  for (const kind of REQUIRED) {
    await prereqWrapperNominal(`F06T:required:${kind}`) // matching healthy wrapper twin BEFORE each required-kind case
    const alias: AliasFn = async (browser, env, label, actorEmail, run, options) => {
      void browser; void env; void label; void actorEmail
      if (options) (options.secondaries as unknown as Record<string, boolean>)[kind] = true
      await run({ page: {}, checkpoint: async () => {} })
      return undefined
    }
    const { wrapper } = buildWrapperCtx(alias, recordingTestInfo([]))
    const ledger: Collector[] = []
    let caught: unknown, threw = false
    try { await wrapper({}, T16A_LABEL, 'a', async () => ({ notes: 'x' }), ledger) } catch (e) { threw = true; caught = e }
    assert.equal(threw, true, `required kind ${kind}: no-primary invocation rejects (never standalone success)`)
    assert.equal(caught instanceof Error && typeof caught.message === 'string' && caught.message.includes(kind), true, `required kind ${kind} listed in fixed terminal message`)
    assert.equal((ledger[0] as unknown as Record<string, boolean>)[kind], true, `required kind ${kind} flag retained on ledger object`)
  }
  for (const info of ['hasPrimary', 'setupCleanupAttempted', 'annotationExposed'] as const) {
    await prereqWrapperNominal(`F06T:info:${info}`) // matching healthy wrapper twin BEFORE each INFO-kind case
    const alias: AliasFn = async (browser, env, label, actorEmail, run, options) => {
      void browser; void env; void label; void actorEmail
      if (options) (options.secondaries as unknown as Record<string, boolean>)[info] = true
      await run({ page: {}, checkpoint: async () => {} })
      return undefined
    }
    const { wrapper } = buildWrapperCtx(alias, recordingTestInfo([]))
    const ledger: Collector[] = []
    let threw = false
    try { await wrapper({}, T16A_LABEL, 'a', async () => ({ notes: 'x' }), ledger) } catch { threw = true }
    assert.equal(threw, false, `INFO kind ${info} alone never fails the invocation`)
  }
})
test('F06P annotation-push failure (not just test.info failure) is a required reporting failure', async () => {
  // test.info() itself succeeds, but annotations.push throws
  const pushThrowInfo = (): { annotations: { push(a: { type: string; description: string }): void } } => ({
    annotations: { push() { throw new Error('SYNTHETIC-PUSH-THROW') } },
  })
  // MATCHING healthy twin for sub-case 1: same wrapper boundary with a healthy
  // reporting path resolves cleanly before the push-throw fault is enabled.
  {
    const aliasHealthy: AliasFn = async (browser, env, label, actorEmail, run) => {
      void browser; void env; void label; void actorEmail
      await run({ page: {}, checkpoint: async () => {} })
      return undefined
    }
    const healthyLedger: Collector[] = []
    let healthyThrew = false
    try { await buildWrapperCtx(aliasHealthy, recordingTestInfo([])).wrapper({}, T16A_LABEL, 'a', async () => ({ notes: 'x' }), healthyLedger) } catch { healthyThrew = true }
    assert.equal(healthyThrew, false, 'prereq F06P:no-primary: matching healthy reporting wrapper resolves')
    assert.equal(healthyLedger.length, 1, 'prereq F06P:no-primary: healthy twin retained one collector')
  }
  const aliasOk: AliasFn = async (browser, env, label, actorEmail, run) => {
    void browser; void env; void label; void actorEmail
    await run({ page: {}, checkpoint: async () => {} })
    return undefined
  }
  const { wrapper } = buildWrapperCtx(aliasOk, pushThrowInfo)
  const ledger: Collector[] = []
  let caught: unknown, threw = false
  try { await wrapper({}, T16A_LABEL, 'a', async () => ({ notes: 'x' }), ledger) } catch (e) { threw = true; caught = e }
  assert.equal(threw, true, 'push-throw with no primary fails closed')
  assert.equal(ledger[0]?.reportingFailed, true, 'push-throw sets reportingFailed on the retained collector')
  assert.equal(caught instanceof Error && typeof caught.message === 'string' && caught.message.includes('reportingFailed'), true, 'reportingFailed listed in terminal kinds')
  // with a primary, the exact primary still wins over the push failure
  // MATCHING healthy twin for sub-case 2: healthy reporting boundary with the
  // push failure OFF and a resolving alias — not a permanent push-throw claim.
  {
    const aliasHealthy2: AliasFn = async (browser, env, label, actorEmail, run) => {
      void browser; void env; void label; void actorEmail
      await run({ page: {}, checkpoint: async () => {} })
      return undefined
    }
    const healthySink2: { type: string; description: string }[] = []
    const healthyLedger2: Collector[] = []
    let healthyThrew2 = false
    try { await buildWrapperCtx(aliasHealthy2, recordingTestInfo(healthySink2)).wrapper({}, T16A_LABEL, 'a', async () => ({ notes: 'x' }), healthyLedger2) } catch { healthyThrew2 = true }
    assert.equal(healthyThrew2, false, 'prereq F06P:primary-wins: matching healthy twin resolves')
    assert.equal(healthyLedger2.length, 1, 'prereq F06P:primary-wins: healthy twin retained one collector')
    assert.equal(healthySink2.length, 1, 'prereq F06P:primary-wins: healthy twin reported once (reporting footprint asserted)')
    // annotationExposed INFO true AFTER a successful push is legitimate — no
    // all-ten-false fiction here.
    assert.equal(healthyLedger2[0]?.annotationExposed, true, 'prereq F06P:primary-wins: annotationExposed INFO true after successful push')
  }
  const sentinel = null
  const aliasThrow: AliasFn = async () => { throw sentinel }
  const { wrapper: w2 } = buildWrapperCtx(aliasThrow, pushThrowInfo)
  const ledger2: Collector[] = []
  let caught2: unknown, threw2 = false
  try { await w2({}, T16A_LABEL, 'a', async () => ({ notes: 'x' }), ledger2) } catch (e) { threw2 = true; caught2 = e }
  assert.equal(threw2, true, 'rejection surfaces despite push failure')
  assert.equal(Object.is(caught2, sentinel), true, 'exact null primary wins over fixed terminal')
  assert.equal(ledger2[0]?.reportingFailed, true, 'push failure still recorded on retained collector')
})
test('F07H wrapper hostile sentinels: exact identity with ZERO reads (counters stay 0)', async () => {
  const hostileCases: { name: string; make: () => { sentinel: unknown; counts: Record<string, number>; key: string } }[] = [
    { name: 'throwing .message getter', make: () => { const counts = { message: 0 }; return { sentinel: hostileMessage(counts), counts, key: 'message' } } },
    { name: 'throwing .name getter', make: () => { const counts = { name: 0 }; return { sentinel: hostileName(counts), counts, key: 'name' } } },
    { name: 'throwing Symbol.toPrimitive/toString', make: () => { const counts = { toPrimitive: 0, toString: 0, message: 0, name: 0 }; return { sentinel: hostileToPrimitive(counts), counts, key: 'toPrimitive+toString' } } },
  ]
  for (const { name, make } of hostileCases) {
    await prereqWrapperNominal(`F07H:${name}`) // matching healthy wrapper twin BEFORE each hostile case
    const { sentinel, counts, key } = make()
    const alias: AliasFn = async (browser, env, label, actorEmail, run, options) => {
      void browser; void env; void label; void actorEmail; void run
      if (options) options.secondaries.hasPrimary = true
      throw sentinel
    }
    const sink: { type: string; description: string }[] = []
    const { wrapper } = buildWrapperCtx(alias, recordingTestInfo(sink))
    const ledger: Collector[] = []
    let caught: unknown, threw = false
    try { await wrapper({}, T16A_LABEL, 'a', async () => ({ notes: 'x' }), ledger) } catch (e) { threw = true; caught = e }
    assert.equal(threw, true, `hostile ${name}: rejection presence observed`)
    assert.equal(Object.is(caught, sentinel), true, `hostile ${name}: exact identity preserved`)
    const totalReads = Object.values(counts).reduce((a, b) => a + b, 0)
    assert.equal(totalReads, 0, `hostile ${name}: wrapper performed ZERO reads of ${key}`)
    assert.equal(sink.length, 1, `hostile ${name}: annotation attempted before propagation`)
  }
})
test('F06b wrapper: INFO-only flags never fail; reporting failure is required', async () => {
  await prereqWrapperNominal('F06b:info-only') // matching healthy wrapper twin BEFORE the INFO-only sub-case
  const aliasInfo: AliasFn = async (browser, env, label, actorEmail, run, options) => {
    void browser; void env; void label; void actorEmail
    if (options) {
      options.secondaries.setupCleanupAttempted = true
      options.secondaries.annotationExposed = true
      options.secondaries.hasPrimary = true
    }
    await run({ page: {}, checkpoint: async () => {} })
    return undefined
  }
  const sink: { type: string; description: string }[] = []
  const { wrapper } = buildWrapperCtx(aliasInfo, recordingTestInfo(sink))
  const ledger: Collector[] = []
  let threw = false
  try { await wrapper({}, T16A_LABEL, 'a', async () => ({ notes: 'x' }), ledger) } catch { threw = true }
  assert.equal(threw, false, 'INFO-only flags resolve normally')
  // reporting failure with no primary must fail closed with reportingFailed
  await prereqWrapperNominal('F06b:reporting') // matching healthy wrapper twin BEFORE the reporting sub-case
  const alias2: AliasFn = async (browser, env, label, actorEmail, run) => {
    void browser; void env; void label; void actorEmail
    await run({ page: {}, checkpoint: async () => {} })
    return undefined
  }
  const { wrapper: w2 } = buildWrapperCtx(alias2, recordingTestInfo([], 'throw'))
  const ledger2: Collector[] = []
  let threw2 = false, msg = ''
  try { await w2({}, T16A_LABEL, 'a', async () => ({ notes: 'x' }), ledger2) } catch (e) { threw2 = true; msg = e instanceof Error ? e.message : '' }
  assert.equal(threw2, true, 'no-primary reporting failure rejects')
  assert.equal(ledger2[0]?.reportingFailed, true, 'reportingFailed set on retained object')
  assert.equal(msg.includes('reportingFailed'), true, 'reportingFailed listed in terminal kinds')
})

// ===========================================================================
// F07 — wrapper exact falsy primary retention (presence container semantics)
// ===========================================================================
test('F07 wrapper: every falsy/hostile delegated rejection rethrown exactly, flags retained', async () => {
  const values: { sentinel: unknown; name: string }[] = [
    { sentinel: 0, name: 'zero' },
    { sentinel: false, name: 'false' },
    { sentinel: null, name: 'null' },
    { sentinel: undefined, name: 'undefined' },
    { sentinel: '', name: 'empty-string' },
    { sentinel: Object.create(null), name: 'null-proto' },
  ]
  for (const { sentinel, name } of values) {
    await prereqWrapperNominal(`F07:${name}`) // matching healthy wrapper twin BEFORE each sentinel case (tag never coerces the sentinel)
    const alias: AliasFn = async (browser, env, label, actorEmail, run, options) => {
      void browser; void env; void label; void actorEmail
      if (options) {
        options.secondaries.hasPrimary = true
        options.secondaries.traceStopFailed = true
      }
      throw sentinel
    }
    const sink: { type: string; description: string }[] = []
    const { wrapper } = buildWrapperCtx(alias, recordingTestInfo(sink))
    const ledger: Collector[] = []
    let caught: unknown, threw = false
    try { await wrapper({}, T16A_LABEL, 'a', async () => ({ notes: 'x' }), ledger) } catch (e) { threw = true; caught = e }
    assert.equal(threw, true, 'rejection observed for sentinel slot')
    assert.equal(Object.is(caught, sentinel), true, 'exact identity preserved (never truthiness-based)')
    assert.equal(sink.length, 1, 'annotation attempted before propagation')
    assert.equal(ledger[0]?.traceStopFailed, true, 'secondary flags retained alongside exact primary')
  }
})

// ===========================================================================
// F08 — ACTUAL helper hostile/falsy matrix: exact identity + ZERO reads
// ===========================================================================
test('F08a helper safe path: hostile primaries retained exactly with zero reads', async () => {
  const hostileCases: { name: string; key: string; make: () => { sentinel: unknown; counts: Record<string, number> } }[] = [
    { name: 'hostile .message', key: 'message', make: () => { const counts = { message: 0 }; return { sentinel: hostileMessage(counts), counts } } },
    { name: 'hostile .name', key: 'name', make: () => { const counts = { name: 0 }; return { sentinel: hostileName(counts), counts } } },
    { name: 'conversion trap', key: 'toPrimitive+toString', make: () => { const counts = { toPrimitive: 0, toString: 0 }; return { sentinel: hostileToPrimitive(counts), counts } } },
  ]
  for (const { name, key, make } of hostileCases) {
    await prereqSafeHelperNominal(`F08a:${name}`) // matching healthy SAFE twin BEFORE this fresh hostile fixture
    const { sentinel, counts } = make()
    const c = syntheticCollector()
    const r = await runHelper({}, async () => { throw sentinel }, safeOpts(c))
    assert.equal(r.threw, true, `${name}: rejection presence observed`)
    assert.equal(Object.is(r.caught, sentinel), true, `${name} primary exact via boolean Object.is`)
    assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), 0, `safe path never reads ${key}`)
  }
})
test('F08b helper safe path: every falsy primary retained exactly', async () => {
  const sentinels: { sentinel: unknown; name: string }[] = [
    { sentinel: 0, name: 'zero' },
    { sentinel: false, name: 'false' },
    { sentinel: null, name: 'null' },
    { sentinel: undefined, name: 'undefined' },
    { sentinel: '', name: 'empty-string' },
    { sentinel: Object.create(null), name: 'null-proto' },
  ]
  for (const { sentinel, name } of sentinels) {
    await prereqSafeHelperNominal(`F08b:${name}`) // matching healthy SAFE twin BEFORE each sentinel case (tag never coerces the sentinel)
    const c = syntheticCollector()
    const r = await runHelper({}, async () => { throw sentinel }, safeOpts(c))
    assert.equal(r.threw, true, 'rejection presence observed (not vacuous)')
    assert.equal(Object.is(r.caught, sentinel), true, 'exact falsy identity')
    assert.equal(c.hasPrimary, true, 'hasPrimary INFO set')
    assert.equal(r.fx.manifests[0].status, 'Fail', 'Fail status recorded')
    assert.equal(r.fx.manifests[0].notes, 'segment failed', 'fixed safe note (no primary content)')
  }
})

// ===========================================================================
// F09 — ACTUAL helper failure-screenshot matrix
// ===========================================================================
test('F09 helper: screenshot failure after primary sets required flag, finalizers continue', async () => {
  await prereqSafeHelperNominal('F09')
  const sentinel = new Error('SYNTHETIC-PRIMARY')
  const c = syntheticCollector()
  const r = await runHelper({ screenshotError: new Error('SYNTHETIC-SHOT-FAILURE') },
    async () => { throw sentinel }, safeOpts(c))
  assert.equal(Object.is(r.caught, sentinel), true, 'exact primary retained')
  assert.equal(c.failureShotFailed, true, 'failureShotFailed required flag set')
  assert.equal(r.fx.calls.screenshot, 1, 'screenshot attempted once')
  assert.equal(r.fx.calls.traceStop, 1, 'trace stop still attempted')
  assert.equal(r.fx.calls.close, 1, 'close still attempted')
  assert.equal(r.fx.calls.rename, 1, 'video rename still attempted')
  assert.equal(r.fx.calls.manifest, 1, 'manifest still attempted')
  assert.equal(r.fx.manifests[0].status, 'Fail', 'Fail manifest written')
})

// ===========================================================================
// F10 — ACTUAL helper secondary matrix + simultaneous retention
// ===========================================================================
test('F10a helper: each finalizer failure independently sets its fixed flag, later ones continue', async () => {
  const cases: { o: FixtureOverrides; flag: keyof Collector; later: string[] }[] = [
    { o: { traceStopError: new Error('SYNTHETIC-TRACE') }, flag: 'traceStopFailed', later: ['close', 'rename', 'manifest'] },
    { o: { closeError: new Error('SYNTHETIC-CLOSE') }, flag: 'contextCloseFailed', later: ['rename', 'manifest'] },
    { o: { renameError: new Error('SYNTHETIC-RENAME') }, flag: 'videoPersistFailed', later: ['manifest'] },
    { o: { manifestError: new Error('SYNTHETIC-MANIFEST') }, flag: 'manifestWriteFailed', later: [] },
  ]
  for (const { o, flag, later } of cases) {
    await prereqSafeHelperNominal(`F10a:${String(flag)}`) // matching healthy SAFE twin BEFORE this fault case
    const c = syntheticCollector()
    const r = await runHelper(o, async () => ({ notes: 'ok' }), safeOpts(c))
    assert.equal(r.threw, false, `secondary-only (${flag}) must not throw from helper`)
    assert.equal(c[flag], true, `flag ${flag} set`)
    for (const laterCall of later) assert.equal(r.fx.calls[laterCall], 1, `${laterCall} still attempted after ${flag}`)
    assert.equal(r.fx.calls.manifest, 1, 'manifest attempt made')
  }
})
test('F10b helper+wrapper chain: simultaneous primary+trace+manifest+reporter keeps exact primary and all flags', async () => {
  // MATCHING healthy full-chain twin (same real helper→exported→wrapper deps)
  // runs and is asserted BEFORE the fault case below.
  await prereqRealChainCase('F10b', () => buildRealChainCase({}))
  // REAL exported segment + REAL helper + REAL local wrapper in one chain.
  const sentinel = new Error('SYNTHETIC-SIMULTANEOUS-PRIMARY')
  const fx = makeFixture({ traceStopError: new Error('SYNTHETIC-TRACE'), manifestError: new Error('SYNTHETIC-MANIFEST') })
  const order: string[] = []
  const chain = buildRealChain({
    path,
    fs: fx.sandboxBits.fs,
    segmentSlug: fx.sandboxBits.segmentSlug,
    makeCheckpointPage: fx.sandboxBits.makeCheckpointPage,
    screenshot: fx.sandboxBits.screenshot,
    appendManifest: fx.sandboxBits.appendManifest,
    signIn: async () => { order.push('signIn') },
  })
  const sink: { type: string; description: string }[] = []
  const { wrapper } = buildWrapperCtx(chain.signedInSegment as unknown as AliasFn, recordingTestInfo(sink, 'throw'))
  void sink
  const ledger: Collector[] = []
  let caught: unknown, threw = false
  try {
    await wrapper(fx.browser, T16A_LABEL, 'synthetic+actor', async () => { throw sentinel }, ledger)
  } catch (e) { threw = true; caught = e }
  assert.equal(threw, true, 'chain rejected')
  assert.equal(Object.is(caught, sentinel), true, 'simultaneous failures never replace the exact primary')
  const c = ledger[0]
  assert.ok(c, 'collector retained in test-owned ledger')
  assert.equal(c.hasPrimary, true, 'hasPrimary INFO')
  assert.equal(c.traceStopFailed, true, 'traceStopFailed retained')
  assert.equal(c.manifestWriteFailed, true, 'manifestWriteFailed retained')
  assert.equal(c.reportingFailed, true, 'reportingFailed retained after reporter throw')
  assert.equal(order.includes('signIn'), true, 'signIn ran inside the recording callback')
  assert.equal(fx.calls.close, 1, 'close attempted despite trace failure')
})

// ===========================================================================
// F11 — owned setup guard through ACTUAL helper; exported forwarding/sign-in
// ===========================================================================
test('F11a helper setup guard: newPage/video/checkpoint rejection → one close, exact primary, flags', async () => {
  // EXPLICIT per-case sentinel storage (no nullish selection): each case names
  // its injection key and its exact sentinel, including null and undefined.
  const cases: { key: string; sentinel: unknown; desc: string }[] = [
    { key: 'newPageError', sentinel: 0, desc: 'falsy newPage sentinel 0' },
    { key: 'newPageError', sentinel: undefined, desc: 'own-property newPage sentinel undefined' },
    { key: 'newPageError', sentinel: null, desc: 'explicit null newPage sentinel' },
    { key: 'newPageError', sentinel: new Error('SYNTHETIC-NEWPAGE'), desc: 'newPage error' },
    { key: 'videoError', sentinel: false, desc: 'falsy video sentinel false' },
    { key: 'videoError', sentinel: '', desc: 'empty-string video sentinel' },
    { key: 'makeCheckpointPageError', sentinel: '', desc: 'falsy checkpoint sentinel empty-string' },
  ]
  for (const { key, sentinel, desc } of cases) {
    await prereqSafeHelperNominal(`F11a:${desc}`) // matching healthy SAFE twin BEFORE this fault case
    const c = syntheticCollector()
    const r = await runHelper({ [key]: sentinel, closeError: new Error('SYNTHETIC-CLOSE-FAIL') },
      async () => ({ notes: 'never' }), safeOpts(c))
    assert.equal(r.threw, true, `rejection presence (${desc})`)
    assert.equal(Object.is(r.caught, sentinel), true, `exact setup primary (${desc})`)
    assert.equal(c.setupCleanupAttempted, true, `setupCleanupAttempted INFO set (${desc})`)
    assert.equal(c.setupCleanupFailed, true, `actual close failure flagged (${desc})`)
    assert.equal(r.fx.calls.close, 1, `exactly ONE close attempt (${desc})`)
  }
})
test('F11b helper setup: mkdir/newContext rejection exact with no fictitious close', async () => {
  for (const key of ['mkdirError', 'newContextError']) {
    await prereqSafeHelperNominal(`F11b:${key}`) // matching healthy SAFE twin BEFORE this fault case
    const sentinel = new Error('SYNTHETIC-' + key)
    const c = syntheticCollector()
    const r = await runHelper({ [key]: sentinel }, async () => ({ notes: 'never' }), safeOpts(c))
    assert.equal(r.threw, true, `rejection presence (${key})`)
    assert.equal(Object.is(r.caught, sentinel), true, `exact ${key} primary`)
    assert.equal(r.fx.calls.close, 0, `no close attempt without an owned context (${key})`)
    assert.equal(c.setupCleanupAttempted, false, `no fictitious cleanup attempt (${key})`)
  }
})
test('F11E missing collector with selected safe policy: fail-closed BEFORE any effect (zero fixture effects)', async () => {
  await prereqSafeHelperNominal('F11E')
  const malformed = { evidencePolicy: 'fixed-evidence-only', secondaries: undefined } as unknown as { evidencePolicy: string; secondaries: Collector }
  const r = await runHelper({}, async () => ({ notes: 'never' }), malformed)
  assert.equal(r.threw, true, 'policy-without-collector rejects (fail-closed wiring precondition)')
  assert.equal(r.caught instanceof Error && typeof r.caught.message === 'string' &&
    r.caught.message.includes('requires the collector'), true, 'fixed precondition message')
  const zero = ['mkdir', 'newContext', 'newPage', 'tracingStart', 'traceStop', 'close', 'videoPath', 'rename', 'manifest', 'screenshot']
  for (const k of zero) assert.equal(r.fx.calls[k], 0, `ZERO effects: ${k} never invoked`)
  assert.equal(r.fx.manifests.length, 0, 'ZERO effects: no manifest written')
  // same precondition reachable through the REAL exported segment, with a
  // MATCHING healthy EXPORTED twin (valid safe options, same chain deps) FIRST.
  {
    const healthyFx = makeFixture({})
    const healthyChain = buildRealChain({ ...healthyFx.sandboxBits, signIn: async () => {} })
    let healthyThrew = false
    try {
      await healthyChain.signedInSegment(healthyFx.browser, ENVF, LABEL, 'a',
        async () => ({ notes: 'healthy' }), safeOpts(syntheticCollector()))
    } catch { healthyThrew = true }
    assert.equal(healthyThrew, false, 'prereq F11E: matching healthy EXPORTED twin resolves with valid safe options')
    assert.equal(healthyFx.calls.manifest, 1, 'prereq F11E: healthy exported twin wrote its manifest')
  }
  const fx = makeFixture({})
  const chain = buildRealChain({ ...fx.sandboxBits, signIn: async () => {} })
  let threw = false
  try { await chain.signedInSegment(fx.browser, ENVF, LABEL, 'a', async () => ({ notes: 'x' }), malformed) } catch { threw = true }
  assert.equal(threw, true, 'exported segment rejects the same malformed options')
  for (const k of ['newContext', 'newPage', 'manifest']) assert.equal(fx.calls[k], 0, `exported ZERO effects: ${k}`)
})
test('F11U full real chain setup matrix: 3 owned sites × 10 sentinels × cleanup success/failure + ownerless sites', async () => {
  // MATCHING healthy full-chain twin (same deps class) runs FIRST per case.
  type Mk = () => { sentinel: unknown; counts: Record<string, number> | null }
  const sentinelMakers: { name: string; make: Mk }[] = [
    { name: '0', make: () => ({ sentinel: 0, counts: null }) },
    { name: 'false', make: () => ({ sentinel: false, counts: null }) },
    { name: 'null', make: () => ({ sentinel: null, counts: null }) },
    { name: 'undefined', make: () => ({ sentinel: undefined, counts: null }) },
    { name: 'empty-string', make: () => ({ sentinel: '', counts: null }) },
    { name: 'Error', make: () => ({ sentinel: new Error('SYNTHETIC-CHAIN-SETUP'), counts: null }) },
    { name: 'null-proto', make: () => ({ sentinel: Object.create(null), counts: null }) },
    { name: 'hostile-message', make: () => { const counts = { message: 0 }; return { sentinel: hostileMessage(counts), counts } } },
    { name: 'hostile-name', make: () => { const counts = { name: 0 }; return { sentinel: hostileName(counts), counts } } },
    { name: 'hostile-conversion', make: () => { const counts = { toPrimitive: 0, toString: 0 }; return { sentinel: hostileToPrimitive(counts), counts } } },
  ]
  const ownedSites = ['newPageError', 'videoError', 'makeCheckpointPageError']
  for (const site of ownedSites) {
    for (const { name, make } of sentinelMakers) {
      for (const cleanupFails of [false, true]) {
        const tag = `F11U:${site}:${name}:${cleanupFails ? 'cleanup-fail' : 'cleanup-ok'}`
        await prereqRealChainCase(tag, () => buildRealChainCase({})) // matching healthy chain twin FIRST
        const { sentinel, counts } = make()
        const o: FixtureOverrides = { [site]: sentinel }
        if (cleanupFails) o.closeError = new Error('SYNTHETIC-CLOSE-FAIL')
        const fault = buildRealChainCase(o)
        let caught: unknown, threw = false
        try { await fault.run() } catch (e) { threw = true; caught = e }
        assert.equal(threw, true, `${tag}: rejection presence`)
        assert.equal(Object.is(caught, sentinel), true, `${tag}: exact setup primary identity through helper→exported→wrapper`)
        assert.equal(fault.fx.calls.close, 1, `${tag}: exactly ONE owned close attempt`)
        assert.equal(fault.ledger[0]?.setupCleanupAttempted, true, `${tag}: cleanup attempt INFO recorded`)
        assert.equal(fault.ledger[0]?.setupCleanupFailed, cleanupFails, `${tag}: cleanup-failure flag exactly matches outcome`)
        assert.equal(fault.ledger[0]?.hasPrimary, false, `${tag}: helper body hasPrimary INFO stays false (no body fiction) — wrapper container owns the rejection`)
        assert.equal(fault.fx.calls.manifest, 0, `${tag}: no manifest for an unrecorded setup rejection`)
        assert.equal(fault.annotations.length, 1, `${tag}: wrapper reported the segment before rethrow`)
        if (counts) {
          const reads = Object.values(counts).reduce((a, b) => a + b, 0)
          assert.equal(reads, 0, `${tag}: hostile sentinel NEVER read through the safe chain`)
        }
      }
    }
  }
  // Ownerless sites through the FULL chain: mkdir and newContext rejections
  // invent no owner — no close, no attempt flag — with the same sentinel spread.
  for (const site of ['mkdirError', 'newContextError']) {
    for (const { name, make } of sentinelMakers) {
      const tag = `F11U:ownerless-${site}:${name}`
      await prereqRealChainCase(tag, () => buildRealChainCase({})) // matching healthy chain twin FIRST
      const { sentinel, counts } = make()
      const fault = buildRealChainCase({ [site]: sentinel })
      let caught: unknown, threw = false
      try { await fault.run() } catch (e) { threw = true; caught = e }
      assert.equal(threw, true, `${tag}: rejection presence`)
      assert.equal(Object.is(caught, sentinel), true, `${tag}: exact primary identity through the full chain`)
      assert.equal(fault.fx.calls.close, 0, `${tag}: NO close without an owned context`)
      assert.equal(fault.fx.calls.newPage, 0, `${tag}: context-owned setup never started`)
      assert.equal(fault.ledger[0]?.setupCleanupAttempted, false, `${tag}: no fictitious cleanup attempt flag`)
      assert.equal(fault.fx.calls.manifest, 0, `${tag}: no manifest written`)
      if (counts) {
        const reads = Object.values(counts).reduce((a, b) => a + b, 0)
        assert.equal(reads, 0, `${tag}: hostile sentinel NEVER read through the safe chain`)
      }
    }
  }
})
test('F10O SAFE finalizer ORDER: success order and continuation order, not counts', async () => {
  // Safe-mode success: tracingStart < traceStop < close < videoPath < rename < manifest
  await prereqSafeHelperNominal('F10O:success')
  const okFx = makeFixture({}, [])
  {
    const c = syntheticCollector()
    const r = await runHelper({}, async () => ({ notes: 'ok' }), safeOpts(c))
    assert.equal(r.threw, false, 'safe success resolves')
    for (const ev of ['tracingStart', 'traceStop', 'close', 'videoPath', 'rename', 'manifest']) {
      assert.equal(r.fx.order.includes(ev), true, `safe success: event ${ev} PRESENT (missing event cannot satisfy inequalities)`)
    }
    const idx = (n: string) => r.fx.order.indexOf(n)
    assert.equal(idx('tracingStart') < idx('traceStop'), true, 'safe order: tracingStart before traceStop')
    assert.equal(idx('traceStop') < idx('close'), true, 'safe order: traceStop before close')
    assert.equal(idx('close') < idx('videoPath'), true, 'safe order: close before videoPath')
    assert.equal(idx('videoPath') < idx('rename'), true, 'safe order: videoPath before rename')
    assert.equal(idx('rename') < idx('manifest'), true, 'safe order: rename before manifest')
    assert.equal(c.hasPrimary, false, 'success leaves hasPrimary false')
  }
  // Safe-mode secondary failure continuation: trace-stop failure does not
  // reorder or skip close/video/manifest — order positions, not just counts.
  await prereqSafeHelperNominal('F10O:trace-continuation')
  {
    const c = syntheticCollector()
    const r = await runHelper({ traceStopError: new Error('SYNTHETIC-TRACE') }, async () => ({ notes: 'ok' }), safeOpts(c))
    assert.equal(r.threw, false, 'secondary-only failure does not throw from the helper')
    for (const ev of ['tracingStart', 'traceStop', 'close', 'videoPath', 'rename', 'manifest']) {
      assert.equal(r.fx.order.includes(ev), true, `trace continuation: event ${ev} PRESENT (missing event cannot satisfy inequalities)`)
    }
    const idx = (n: string) => r.fx.order.indexOf(n)
    assert.equal(idx('tracingStart') < idx('traceStop'), true, 'continuation order: tracingStart before failed traceStop')
    assert.equal(idx('traceStop') < idx('close'), true, 'continuation order: close still ordered after failed traceStop')
    assert.equal(idx('close') < idx('videoPath'), true, 'continuation order: videoPath after close')
    assert.equal(idx('videoPath') < idx('rename'), true, 'continuation order: rename after videoPath')
    assert.equal(idx('rename') < idx('manifest'), true, 'continuation order: manifest after rename')
    assert.equal(c.traceStopFailed, true, 'traceStopFailed flag set')
  }
  // Safe-mode screenshot failure after a primary: screenshot attempt is
  // ordered INSIDE the catch, before the finally finalizers.
  await prereqSafeHelperNominal('F10O:screenshot-continuation')
  {
    const c = syntheticCollector()
    const sentinel = new Error('SYNTHETIC-PRIMARY')
    const r = await runHelper({ screenshotError: new Error('SYNTHETIC-SHOT-FAILURE') },
      async () => { throw sentinel }, safeOpts(c))
    assert.equal(r.threw, true, 'primary rejection presence')
    assert.equal(Object.is(r.caught, sentinel), true, 'exact primary identity')
    for (const ev of ['tracingStart', 'screenshot', 'traceStop', 'close', 'videoPath', 'rename', 'manifest']) {
      assert.equal(r.fx.order.includes(ev), true, `screenshot continuation: event ${ev} PRESENT (missing event cannot satisfy inequalities)`)
    }
    const idx = (n: string) => r.fx.order.indexOf(n)
    assert.equal(idx('tracingStart') < idx('screenshot'), true, 'screenshot ordered after tracing start (inside catch)')
    assert.equal(idx('screenshot') < idx('traceStop'), true, 'screenshot ordered before the finally traceStop')
    assert.equal(idx('traceStop') < idx('close'), true, 'finalizer order preserved after screenshot failure')
    assert.equal(idx('close') < idx('videoPath'), true, 'videoPath ordered after close despite screenshot failure')
    assert.equal(idx('videoPath') < idx('rename'), true, 'rename ordered after videoPath despite screenshot failure')
    assert.equal(idx('rename') < idx('manifest'), true, 'manifest still ordered last after screenshot failure')
    assert.equal(c.failureShotFailed, true, 'failureShotFailed required flag set')
  }
})
test('F11c exported segment: options forwarded verbatim; signIn INSIDE callback before body', async () => {
  // MATCHING healthy EXPORTED twin (same chain deps, healthy manifest) FIRST:
  // resolves cleanly and writes its manifest before the manifest fault runs.
  {
    const healthyOrder: string[] = []
    const healthyFx = makeFixture({}, healthyOrder)
    const healthyChain = buildRealChain({ ...healthyFx.sandboxBits, signIn: async () => { healthyOrder.push('signIn') } })
    let healthyThrew = false
    try {
      await healthyChain.signedInSegment(healthyFx.browser, ENVF, LABEL, 'a',
        async () => ({ notes: 'healthy' }), safeOpts(syntheticCollector()))
    } catch { healthyThrew = true }
    assert.equal(healthyThrew, false, 'prereq F11c: matching healthy EXPORTED twin resolves')
    assert.equal(healthyFx.calls.manifest, 1, 'prereq F11c: healthy exported twin wrote its manifest')
  }
  const order: string[] = []
  const fx = makeFixture({ manifestError: new Error('SYNTHETIC-MANIFEST') }, order)
  const chain = buildRealChain({ ...fx.sandboxBits, signIn: async () => { order.push('signIn') } })
  const c = syntheticCollector()
  let bodyEntered = false
  let caught: unknown, threw = false
  try {
    await chain.signedInSegment(fx.browser, ENVF, LABEL, 'synthetic+actor',
      async () => { bodyEntered = true; return { notes: 'body' } }, safeOpts(c))
  } catch (e) { threw = true; caught = e }
  void caught
  assert.equal(threw, false, 'healthy body resolves through exported segment')
  assert.equal(bodyEntered, true, 'caller body entered after signIn')
  assert.equal(order.includes('signIn'), true, 'signIn executed')
  assert.equal(order.indexOf('tracingStart') < order.indexOf('signIn'), true, 'signIn runs INSIDE the recording callback (after tracing start)')
  assert.equal(c.manifestWriteFailed, true, 'options forwarded verbatim to withRecordedContext (flag set)')
})
test('F11d exported segment: signIn rejection is a body failure, exact identity, body not entered', async () => {
  // MATCHING healthy sign-in nominal (same dependency class) FIRST: a chain
  // with a RESOLVING signIn enters the body and resolves cleanly.
  {
    const healthyFx = makeFixture({})
    let healthyEntered = false
    const healthyChain = buildRealChain({ ...healthyFx.sandboxBits, signIn: async () => {} })
    let healthyThrew = false
    try {
      await healthyChain.signedInSegment(healthyFx.browser, ENVF, LABEL, 'synthetic+actor',
        async () => { healthyEntered = true; return { notes: 'healthy' } }, safeOpts(syntheticCollector()))
    } catch { healthyThrew = true }
    assert.equal(healthyThrew, false, 'prereq F11d: healthy signIn chain resolves')
    assert.equal(healthyEntered, true, 'prereq F11d: healthy signIn enters the caller body')
  }
  const fx = makeFixture({})
  const sentinel = Object.create(null)
  const chain = buildRealChain({ ...fx.sandboxBits, signIn: async () => { throw sentinel } })
  const c = syntheticCollector()
  let bodyEntered = false
  let caught: unknown, threw = false
  try {
    await chain.signedInSegment(fx.browser, ENVF, LABEL, 'synthetic+actor',
      async () => { bodyEntered = true; return { notes: 'never' } }, safeOpts(c))
  } catch (e) { threw = true; caught = e }
  assert.equal(threw, true, 'signIn rejection propagates')
  assert.equal(Object.is(caught, sentinel), true, 'exact non-stringifiable sign-in primary')
  assert.equal(bodyEntered, false, 'caller body not entered on sign-in rejection')
  assert.equal(c.hasPrimary, true, 'classified as body primary (INFO flag set)')
  assert.equal(fx.calls.close, 1, 'finalizers still ran')
})

// ===========================================================================
// F02/F03/F04 — REAL T16A test callback wiring (same ledger, restoration, omission)
// ===========================================================================
test('F02R REAL bridge: callback → real wrapper/factory → real exported → real helper, healthy 7 phases', async () => {
  const fx = makeRealCallbackFx()
  let rejected = false
  try { await fx.callback({ browser: fx.fixture.browser }) } catch { rejected = true }
  assert.equal(rejected, false, 'real bridge resolves end to end (presence boolean)')
  assert.equal(fx.annotations.length, 7, 'seven wrapper annotations (one per real T16A call)')
  const phases = fx.annotations.map((a) => (JSON.parse(a.description) as Record<string, unknown>).phase)
  assert.deepEqual(phases, ['create-request', 'request-approval-step1', 'break-mail-transport',
    'approve-while-mail-broken', 'verify-advance', 'verify-inapp-notification-survived',
    'restore-mail-transport'], 'all seven real phases annotated in order')
  for (const a of fx.annotations) {
    const p = JSON.parse(a.description) as Record<string, unknown>
    assert.equal(a.type, 't16a-safe-recording-secondaries', 'fixed annotation type')
    // annotationExposed is set AFTER the push, so the projection legitimately
    // records the PRE-report state; end-state exposure is asserted in F02S.
    assert.equal(p.annotationExposed, false, 'projection records pre-report state')
    for (const k of COLLECTOR_KEYS) if (k !== 'annotationExposed') assert.equal(p[k], false, `healthy ${k} false`)
  }
  assert.equal(fx.fixture.manifests.length, 7, 'seven real manifests written')
  for (const m of fx.fixture.manifests) assert.equal(m.status, 'Pass', 'every real segment manifest Pass')
  const count = (n: string) => fx.uiCalls.filter((u) => u === n).length
  assert.equal(count('createRequestViaUi'), 1, 'create UI once')
  assert.equal(count('approveCurrentStepViaUi'), 2, 'approve UI twice (step1 + approve-while-broken)')
  assert.equal(count('setEmailSmtpPortViaUi'), 2, 'SMTP setter twice (break + restore)')
  assert.equal(count('expectMyActionItemRow'), 1, 'verify-advance UI once')
  assert.equal(count('expectBellNotificationForRequest'), 1, 'verify-inapp UI once')
  assert.equal(fx.order.filter((o) => o === 'signIn').length, 7, 'signIn ran INSIDE every recording callback')
})
test('F02S shadow-ledger instrumentation: 7 distinct fresh collectors retained BEFORE delegation/report, same ledger', async () => {
  const fx = makeRealCallbackFx({ shadowLedger: true })
  let rejected = false
  try { await fx.callback({ browser: fx.fixture.browser }) } catch { rejected = true }
  assert.equal(rejected, false, 'shadow variant resolves (presence boolean)')
  const ledger = fx.shadowLedger()
  assert.ok(Array.isArray(ledger), 'single shared ledger observable (pure-shadow canary-class instrumentation)')
  assert.equal(ledger.length, 7, 'exactly seven collectors retained')
  const distinct = new Set<Collector>(ledger)
  assert.equal(distinct.size, 7, 'seven DISTINCT fresh collectors (no reuse)')
  for (let i = 1; i < ledger.length; i++) assert.equal(Object.is(ledger[i - 1], ledger[i]), false, `collector ${i + 1} distinct from ${i}`)
  for (const o of fx.obs) {
    assert.equal(o.ledgerLen >= 1, true, 'collector retained in ledger before the body ran')
    assert.equal(o.ledgerLen === o.annotationCount + 1, true, `retained BEFORE delegation/report: ledgerLen ${o.ledgerLen} vs annotations ${o.annotationCount}`)
    assert.ok(o.freshAtBody, 'fresh snapshot observable at body entry')
    for (const k of COLLECTOR_KEYS) assert.equal(o.freshAtBody[k], false, `fresh at delegation: ${k} false (report not yet pushed)`)
  }
  const maxLen = fx.obs.reduce((m, o) => Math.max(m, o.ledgerLen), 0)
  assert.equal(maxLen, 7, 'all seven segments delegated through the real wrapper')
  for (const c of ledger) assert.equal(c.annotationExposed, true, 'every report completed by the end')
})
test('F03R REAL bridge phase-4 rejection: exact primary propagates, finally restore still runs, skips absent', async () => {
  // MATCHING healthy full bridge (same real deps, no injection) runs FIRST.
  {
    const healthy = makeRealCallbackFx()
    let rejected = false
    try { await healthy.callback({ browser: healthy.fixture.browser }) } catch { rejected = true }
    assert.equal(rejected, false, 'prereq F03R: matching healthy bridge resolves all 7 phases')
    assert.equal(healthy.annotations.length, 7, 'prereq F03R: matching healthy bridge annotated 7 segments')
  }
  const fx = makeRealCallbackFx({ failNthNewContext: 4 })
  let caught: unknown, threw = false
  try { await fx.callback({ browser: fx.fixture.browser }) } catch (e) { threw = true; caught = e }
  assert.equal(threw, true, 'phase-4 newContext rejection propagates out of the real callback')
  assert.equal(Object.is(caught, fx.sentinel), true, 'exact injected primary identity via Object.is')
  const phases = fx.annotations.map((a) => (JSON.parse(a.description) as Record<string, unknown>).phase)
  assert.deepEqual(phases, ['create-request', 'request-approval-step1', 'break-mail-transport',
    'approve-while-mail-broken', 'restore-mail-transport'], 'five segments reached incl finally restoration')
  const failed = JSON.parse(fx.annotations[3].description) as Record<string, unknown>
  assert.equal(failed.annotationExposed, false, 'failed segment reported its pre-report state (flag set after push)')
  assert.equal(failed.hasPrimary, false, 'pre-container rejection recorded without hasPrimary fiction')
  const manifestPhases = fx.fixture.manifests.map((m) => m.phase)
  assert.deepEqual(manifestPhases, ['create-request', 'request-approval-step1', 'break-mail-transport', 'restore-mail-transport'], 'no manifest for the failed segment; restoration manifest present')
  for (const m of fx.fixture.manifests) assert.equal(m.status, 'Pass', 'reached healthy segments all Pass')
  const count = (n: string) => fx.uiCalls.filter((u) => u === n).length
  assert.equal(count('approveCurrentStepViaUi'), 1, 'only step1 approve body ran (phase-4 body never entered)')
  assert.equal(count('setEmailSmtpPortViaUi'), 2, 'break AND finally-restore setters both ran')
  assert.equal(count('expectMyActionItemRow'), 0, 'skipped phase 5 UI absent')
  assert.equal(count('expectBellNotificationForRequest'), 0, 'skipped phase 6 UI absent')
})
test('F03S shadow-ledger phase-4 rejection: five distinct collectors retained, skipped segments absent', async () => {
  // MATCHING healthy SHADOW bridge (same instrumentation, no injection) FIRST.
  {
    const healthy = makeRealCallbackFx({ shadowLedger: true })
    let rejected = false
    try { await healthy.callback({ browser: healthy.fixture.browser }) } catch { rejected = true }
    assert.equal(rejected, false, 'prereq F03S: matching healthy shadow bridge resolves')
    assert.equal(healthy.shadowLedger()?.length, 7, 'prereq F03S: matching healthy shadow bridge retained 7 collectors')
  }
  const fx = makeRealCallbackFx({ failNthNewContext: 4, shadowLedger: true })
  let caught: unknown, threw = false
  try { await fx.callback({ browser: fx.fixture.browser }) } catch (e) { threw = true; caught = e }
  assert.equal(threw, true, 'shadow variant rejects identically')
  assert.equal(Object.is(caught, fx.sentinel), true, 'exact primary through shadow variant')
  const ledger = fx.shadowLedger()
  assert.ok(Array.isArray(ledger), 'ledger observable')
  assert.equal(ledger.length, 5, 'exactly FIVE collectors retained (failed segment + finally restore included)')
  assert.equal(new Set<Collector>(ledger).size, 5, 'five distinct collectors')
  const duringRestore = fx.obs.filter((o) => o.ledgerLen === 5)
  assert.equal(duringRestore.length > 0 && duringRestore.every((o) => o.annotationCount === 4), true, 'restore body saw 5 retained collectors before its own report')
  assert.equal(fx.obs.every((o) => o.ledgerLen <= 5), true, 'no observation of skipped segments 6/7')
})
test('F02 real callback: SAME test-owned ledger at all seven calls, initialized before first delegate', async () => {
  const fx = makeCallbackFx()
  await fx.callback({ browser: {} })
  assert.equal(fx.calls.length, 7, 'seven real calls')
  assert.equal(fx.wiringOk(), true, 'all seven receive the SAME defined ledger array')
  assert.equal(fx.calls[0].ledgerDefinedAtCall, true, 'ledger existed at first delegation')
})
test('F03 real callback: injected earlier failure → finally restoration still forwards SAME ledger, skipped calls not counted', async () => {
  // MATCHING healthy twin (same fake-alias callback-boundary harness, no
  // injection) FIRST: seven calls, same wiring, defined ledger at first
  // delegation. Fake-alias callback-boundary label — NOT a real-helper
  // full-chain claim; the separate F02 test does not dominate this obligation.
  {
    const healthy = makeCallbackFx()
    await healthy.callback({ browser: {} })
    assert.equal(healthy.calls.length, 7, 'prereq F03: healthy twin reached all 7 calls')
    assert.equal(healthy.wiringOk(), true, 'prereq F03: healthy twin wiring SAME ledger at every call')
    assert.equal(healthy.calls[0].ledgerDefinedAtCall, true, 'prereq F03: healthy twin ledger defined at first delegation')
  }
  const fx = makeCallbackFx({ failPhase: 'approve-while-mail-broken' })
  let caught: unknown, threw = false
  try { await fx.callback({ browser: {} }) } catch (e) { threw = true; caught = e }
  assert.equal(threw, true, 'injected segment failure propagates out of the real callback')
  assert.equal(Object.is(caught, fx.injectedSentinel), true, 'exact injected fixture sentinel identity (no caught-value inspection)')
  const phases = fx.calls.map((c) => c.phase)
  assert.deepEqual(phases, ['create-request', 'request-approval-step1', 'break-mail-transport',
    'approve-while-mail-broken', 'restore-mail-transport'], 'finally restoration ran; skipped calls absent')
  assert.equal(fx.calls.every((c) => c.ledgerDefinedAtCall && c.ledger === fx.calls[0].ledger), true,
    'restoration inside finally forwards the SAME ledger')
  assert.equal(fx.calls.length, 5, 'skipped verify calls are not counted as reached')
})
test('F04 omission sensitivity canary: dropping any one of the seven ledger arguments fails wiring', async () => {
  // count and mutate on the ORIGINAL TypeScript fragment: transpileModule
  // inlines trailing arguments onto one line, so the JS text is unsuitable
  const tsLines = req(CALLBACK_TEXT, 'T16A callback').split('\n')
  const isLedgerArg = (l: string) => /^\s*ledger,\s*$/.test(l)
  const occurrences = tsLines.filter(isLedgerArg).length
  if (occurrences === 0) {
    const fx = makeCallbackFx()
    await fx.callback({ browser: {} })
    assert.equal(fx.wiringOk(), false, 'pre-wiring source: wiring check correctly reports missing ledger (canary base state)')
    return
  }
  assert.equal(occurrences, 7, 'seven ledger argument sites present in real callback source')
  // HEALTHY BASE FIRST: the unmutated wiring EXECUTES and passes BEFORE any mutant.
  const fxHealthy = makeCallbackFx()
  await fxHealthy.callback({ browser: {} })
  assert.equal(fxHealthy.wiringOk(), true, 'unmutated wiring passes before any mutant (canary sensitivity, not product RED)')
  for (let i = 0; i < occurrences; i++) {
    let seen = 0
    const idx = tsLines.findIndex((l: string) => {
      if (!isLedgerArg(l)) return false
      if (seen === i) return true
      seen++
      return false
    })
    const mutatedTs = tsLines.slice(0, idx).concat(tsLines.slice(idx + 1)).join('\n')
    const mutatedJs = ts.transpileModule(mutatedTs, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText.replace(/;\s*$/, '')
    const fx2 = makeCallbackFx()
    const cb = new vm.Script(`(${mutatedJs})`, { filename: 't16a-callback.mutated.js' })
      .runInContext(fx2.ctx, { timeout: 30000 }) as CallbackFn
    await cb({ browser: {} })
    assert.equal(fx2.wiringOk(), false, `omitting ledger argument #${i + 1} fails the wiring assertion`)
  }
})

// ===========================================================================
// F12(b,c) — fresh retained state + reporting/projection boundaries
// ===========================================================================
test('F12b wrapper: reporter throw sets reportingFailed BEFORE terminal; primary still wins', async () => {
  await prereqWrapperNominal('F12b')
  const sentinel = 0
  const alias: AliasFn = async (browser, env, label, actorEmail, run, options) => {
    void browser; void env; void label; void actorEmail
    if (options) {
      options.secondaries.manifestWriteFailed = true
      options.secondaries.hasPrimary = true
    }
    throw sentinel
  }
  const { wrapper } = buildWrapperCtx(alias, recordingTestInfo([], 'throw'))
  const ledger: Collector[] = []
  let caught: unknown, threw = false
  try { await wrapper({}, T16A_LABEL, 'a', async () => ({ notes: 'x' }), ledger) } catch (e) { threw = true; caught = e }
  assert.equal(threw, true, 'rejection surfaces')
  assert.equal(Object.is(caught, sentinel), true, 'exact falsy primary wins over fixed terminal')
  assert.equal(ledger[0]?.reportingFailed, true, 'reportingFailed recorded on the retained ledger')
  assert.equal(ledger[0]?.manifestWriteFailed, true, 'earlier flags survive reporter failure')
})
test('F12c wrapper: annotation JSON is an explicit fixed projection only', async () => {
  await prereqWrapperNominal('F12c')
  const sink: { type: string; description: string }[] = []
  const alias: AliasFn = async (browser, env, label, actorEmail, run) => {
    void browser; void env; void label; void actorEmail
    await run({ page: {}, checkpoint: async () => {} })
    return undefined
  }
  const { wrapper } = buildWrapperCtx(alias, recordingTestInfo(sink))
  const ledger: Collector[] = []
  await wrapper({}, T16A_LABEL, 'a', async () => ({ notes: 'x' }), ledger)
  assert.equal(sink.length, 1, 'one annotation recorded')
  assert.equal(sink[0].type, 't16a-safe-recording-secondaries', 'fixed annotation type')
  const parsed = JSON.parse(sink[0].description) as Record<string, unknown>
  const expectedKeys = ['scenario', 'phase', ...COLLECTOR_KEYS].map(String).sort()
  assert.deepEqual(Object.keys(parsed).sort(), expectedKeys, 'projection keys are exactly scenario/phase + ten fixed booleans')
  assert.equal(parsed.scenario, T16A_LABEL.scenario, 'known scenario string only')
  for (const k of COLLECTOR_KEYS) assert.equal(typeof parsed[k], 'boolean', `projected ${k} is boolean`)
  assert.equal(ledger[0]?.annotationExposed, true, 'annotationExposed INFO set after success')
})
