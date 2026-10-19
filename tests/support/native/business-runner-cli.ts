/**
 * Import-safe CLI surface for the native business runner (test-only).
 *
 * Extracted from run-native-business-tests.ts (whose module body executes
 * main()) so the focused-scenario CLI contract can be regression-tested
 * WITHOUT executing the runner. No top-level side effects.
 *
 * Focused scenario selection contract (validated options, no free-form grep):
 *  - `--scenario=T18B`, `--scenario=T18C2`, `--scenario=T04B`,
 *    `--scenario=T12A`, `--scenario=T15A`, `--scenario=T16A` and
 *    `--scenario=T11B` are the ONLY selectable scenarios (T18C2 added as a
 *    diagnosis-only selection; T04B added as a diagnosis-only selection by
 *    Task28 for the focused T04B retest; T12A added by Task41 to reproduce
 *    the known bell-click instability in isolation; T15A added by Task52 for
 *    the rapid double-click measurement slice; T16A and T11B added as
 *    diagnosis-only one-test selections). Each restricts the Playwright browser suite
 *    to its single test
 *    through a FIXED argv element (`--grep=\bT18B\b` / `--grep=\bT18C2\b` /
 *    `--grep=\bT04B\b` / `--grep=\bT12 in-app notification recipients\b` /
 *    `--grep=\bT15A\b` / `--grep=\bT16A\b` / `--grep=\bT11B\b`,
 *    each anchored with word boundaries — the T12A element anchors the exact
 *    browser test title because that title carries no T12A token). The grep is never
 *    built from free text, never passed through a shell (runChild spawns argv
 *    arrays), and there is deliberately NO generic grep passthrough.
 *  - The default (no --scenario) is UNCHANGED: the full suite runs with no
 *    grep argument at all.
 *  - Both scenarios belong to the "all-defaults" route profile and only to
 *    the full browser mode; any other combination is rejected before any
 *    resource is created.
 *  - Selection is re-verified at run time with a collection-only
 *    `playwright test --list` count over the exact same seam (cwd, config,
 *    env, grep): zero or multiple matched tests abort the run BEFORE any
 *    browser test executes.
 *  - `--list` performs ONLY that collection listing with a synthetic
 *    environment: no PostgreSQL, no app, no browser, no live HTTP, and
 *    explicitly no DATABASE_URL.
 */

import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runChild } from './runner-lifecycle'
import { BUSINESS_ROUTE_CONFIGURATION_NAMES } from '../business-workflow-fixture'

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(THIS_DIR, '..', '..', '..')

export const PLAYWRIGHT_BUSINESS_CONFIG = 'tests/playwright.business.config.ts'

/**
 * The validated focused scenarios. Each `grep` is anchored to the FULL
 * scenario token (word boundaries), so it can never match a longer id
 * (T18B1-style), a bare prefix (T18) or the other scenario's token.
 * `routesConfig` is the only route profile the scenario belongs to.
 * T18C2 (all-steps-vacant auto-complete) runs the existing browser spec and
 * writes the REQUIRED t18c2-browser-correlation.json; the runner-owned DB
 * evaluator asserts the persisted vacancy outcome against it (Task24).
 * T04B (supervisor-origin full all-defaults workflow) is a diagnosis-only
 * selection added by Task28: it changes NO expectation — the default
 * evaluator still runs the T04B checks, which honestly FAIL when the flow
 * does not complete (the runner's DB capture keeps the failing run's FINAL
 * candidates/instance rows for post-run diagnosis).
 * T12A (the T12 in-app notification spec) is a diagnosis-only selection
 * added by Task41 to reproduce the known bell-click instability in
 * isolation. Its grep is anchored to the EXACT browser test title head
 * ("T12 in-app notification recipients …") because that title carries no
 * T12A token — the T12A token is the REQUEST title prefix. The selection
 * keeps every restriction: full mode, all-defaults only, exactly-1 listing
 * gate. Task41 also makes the T12A recipient-matrix MAIL evidence REQUIRED
 * for the focused T12A run and the default full run (a missing request,
 * ambiguous prefix match or zero messages FAILS — never a skip); the other
 * focused selections skip the T12A matrix explicitly.
 * T15A (the rapid double-click Final-trigger measurement slice) is a
 * selection added by Task52. Task56 made its persisted-DB gate REQUIRED:
 * the t15a-browser-correlation.json the spec writes (exact title +
 * attempted clicks + observed POST count) is now consumed by the
 * runner-owned read-only single-transition evaluator for the default full
 * run AND this focused selection (missing/corrupt FAILS, never skips).
 * Every other scenario's requirement is preserved unchanged (T18B/T18C2
 * correlations and the T12A mail matrix stay REQUIRED for the default full
 * run and are explicit not-selected skips for the focused T15A run).
 * T16A and T11B are diagnosis-only selections under the same restrictions
 * (full mode, all-defaults only, fixed word-boundary grep, exactly-1 listing
 * gate, no arbitrary grep). They add no required evidence of their own.
 * Other scenarios' required correlations stay required for the default full
 * run and are explicit not-selected skips for these focused selections.
 */
export const BUSINESS_SCENARIO_SELECTION = {
  T18B: { grep: '\\bT18B\\b', routesConfig: 'all-defaults' },
  T18C2: { grep: '\\bT18C2\\b', routesConfig: 'all-defaults' },
  T04B: { grep: '\\bT04B\\b', routesConfig: 'all-defaults' },
  T12A: { grep: '\\bT12 in-app notification recipients\\b', routesConfig: 'all-defaults' },
  T15A: { grep: '\\bT15A\\b', routesConfig: 'all-defaults' },
  T16A: { grep: '\\bT16A\\b', routesConfig: 'all-defaults' },
  T11B: { grep: '\\bT11B\\b', routesConfig: 'all-defaults' },
} as const

export type BusinessScenarioName = keyof typeof BUSINESS_SCENARIO_SELECTION
export const BUSINESS_SCENARIO_NAMES = Object.keys(BUSINESS_SCENARIO_SELECTION) as readonly BusinessScenarioName[]

export const RUNNER_MODES = ['lifecycle-smoke', 'prepare', 'full'] as const
export type RunnerMode = (typeof RUNNER_MODES)[number]

export interface RunnerCliOptions {
  mode: RunnerMode
  evidenceDir: string
  routesConfig: string
  /** Focused browser scenario (undefined = full suite, the unchanged default). */
  scenario?: BusinessScenarioName
  /** Collection-only listing; no runtime resources are created. */
  list: boolean
}

/**
 * Parse the runner CLI. Rejects every unvalidated scenario value, every
 * incompatible scenario combination, and `--list` combined with an explicit
 * `--mode` (listing is collection-only and mode-independent).
 */
export function parseArgs(argv: readonly string[]): RunnerCliOptions {
  let mode: RunnerMode = 'full'
  let evidenceDir = path.join(REPO_ROOT, 'test-results', 'business-native')
  let routesConfig = 'all-defaults'
  let scenario: BusinessScenarioName | undefined
  let list = false
  let modeGiven = false
  for (const arg of argv) {
    if (arg.startsWith('--mode=')) {
      const value = arg.slice('--mode='.length)
      if (!(RUNNER_MODES as readonly string[]).includes(value)) throw new Error(`unknown mode ${value}`)
      mode = value as RunnerMode
      modeGiven = true
    } else if (arg.startsWith('--evidence-dir=')) {
      evidenceDir = path.resolve(arg.slice('--evidence-dir='.length))
    } else if (arg.startsWith('--routes-config=')) {
      routesConfig = arg.slice('--routes-config='.length)
    } else if (arg.startsWith('--scenario=')) {
      const value = arg.slice('--scenario='.length)
      if (!(BUSINESS_SCENARIO_NAMES as readonly string[]).includes(value as BusinessScenarioName)) {
        throw new Error(
          `unknown --scenario ${value} (selectable scenarios: ${BUSINESS_SCENARIO_NAMES.join(', ')})`,
        )
      }
      scenario = value as BusinessScenarioName
    } else if (arg === '--list') {
      list = true
    } else {
      throw new Error(`unknown argument ${arg}`)
    }
  }
  if (scenario) {
    const requiredConfig = BUSINESS_SCENARIO_SELECTION[scenario].routesConfig
    if (routesConfig !== requiredConfig) {
      throw new Error(
        `--scenario ${scenario} belongs to the "${requiredConfig}" route configuration (active: "${routesConfig}") — incompatible selection`,
      )
    }
    if (mode !== 'full') {
      throw new Error(`--scenario ${scenario} is only valid with --mode=full (active mode: ${mode}) — incompatible selection`)
    }
  }
  if (list && modeGiven) {
    throw new Error('--list is collection-only listing and cannot be combined with --mode')
  }
  // The SAME validated name is seeded, handed to the browser suite and given
  // to the DB-evidence evaluator, so the three layers can never disagree
  // about which profile a run covers.
  if (!(BUSINESS_ROUTE_CONFIGURATION_NAMES as readonly string[]).includes(routesConfig)) {
    throw new Error(`unknown --routes-config ${routesConfig} (known configurations: ${BUSINESS_ROUTE_CONFIGURATION_NAMES.join(', ')})`)
  }
  return { mode, evidenceDir, routesConfig, scenario, list }
}

/**
 * The exact argv the runner hands to runChild for the business Playwright
 * invocation. WITHOUT a scenario the array is byte-identical to the
 * historical full-suite invocation (no grep element at all). WITH a scenario
 * it appends ONE fixed element anchored to the full scenario token — no
 * shell interpolation is involved anywhere.
 */
export function playwrightBusinessArgs(scenario?: BusinessScenarioName, options: { list?: boolean } = {}): string[] {
  const args = ['test']
  if (options.list) args.push('--list')
  args.push(`--config=${PLAYWRIGHT_BUSINESS_CONFIG}`)
  if (scenario) args.push(`--grep=${BUSINESS_SCENARIO_SELECTION[scenario].grep}`)
  return args
}

/**
 * Parse the total matched-test count from `playwright test --list` output.
 * Returns null when no `Total: N tests` line is present.
 */
export function parseListedTestTotal(output: string): number | null {
  const matches = [...output.matchAll(/Total:\s+(\d+)\s+tests?\b/g)]
  if (matches.length === 0) return null
  return Number(matches[matches.length - 1][1])
}

/**
 * Synthetic environment for collection-only listing: every env var the
 * business config/specs require at MODULE LOAD, with values that never
 * connect anywhere (list mode performs no HTTP, no browser, no DB). Deliberately
 * contains NO DATABASE_URL — the browser layer never receives DB credentials.
 */
export function collectionOnlyEnvironment(evidenceDir: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: process.env.HOME ?? '/tmp',
    TMPDIR: process.env.TMPDIR ?? os.tmpdir(),
    BUSINESS_TEST_BASE_URL: 'http://127.0.0.1:1',
    BUSINESS_EVIDENCE_DIR: evidenceDir,
    BUSINESS_E2E_PASSWORD: 'collection-list-only-synthetic',
    BUSINESS_ROUTES_CONFIG: 'all-defaults',
    NEXT_TELEMETRY_DISABLED: '1',
  }
}

// ---------------------------------------------------------------------------
// Fail-closed collection listing gate (Astra round-15 P1 fix)
// ---------------------------------------------------------------------------

export interface ScenarioListGateInput {
  /** Executable to run (the runner passes the owned playwright bin; tests may substitute a controlled child). */
  command: string
  /** Args for the child. Defaults to the exact listing argv the runner uses. */
  args?: string[]
  cwd: string
  env: Record<string, string>
  /** Existing directory under which a FRESH per-invocation log dir is allocated. */
  baseDir: string
  scenario?: BusinessScenarioName
  timeoutMs?: number
}

export interface ScenarioListGateResult {
  total: number
  /** Fresh unique log file for THIS invocation only (prior evidence is never read or overwritten). */
  logFile: string
  output: string
}

/**
 * Run the collection-only `playwright test --list` and FAIL CLOSED:
 *
 *  - the listing child MUST complete successfully (exit 0). Any nonzero
 *    exit or timeout propagates — a failed collection process is NEVER a
 *    successful selection, even if its (or a prior) log contains a parseable
 *    total. Zero-match listings exit nonzero and therefore propagate too;
 *  - the total is parsed ONLY from THIS invocation's output: a fresh
 *    per-invocation directory is allocated under baseDir (mkdtemp), so
 *    runChild's append mode can never mix invocations and prior evidence is
 *    preserved untouched;
 *  - with a scenario selection the total must be EXACTLY 1; without one any
 *    successful listing total is returned (default full-suite listing).
 */
export async function runScenarioListGate(input: ScenarioListGateInput): Promise<ScenarioListGateResult> {
  const invocationDir = await fs.mkdtemp(path.join(input.baseDir, 'playwright-list-'))
  const logFile = path.join(invocationDir, 'playwright-list.log')
  // Any rejection (nonzero exit, spawn error, timeout) propagates untouched.
  await runChild(
    input.command,
    input.args ?? playwrightBusinessArgs(input.scenario, { list: true }),
    input.cwd,
    input.env,
    logFile,
    input.timeoutMs ?? 120_000,
  )
  const output = await fs.readFile(logFile, 'utf8')
  const total = parseListedTestTotal(output)
  if (total === null) {
    throw new Error(`could not parse the listed test total from this invocation's log ${logFile}`)
  }
  if (input.scenario && total !== 1) {
    throw new Error(
      `scenario selection ${input.scenario} matched ${total} tests (expected exactly 1) — refusing to continue; see ${logFile}`,
    )
  }
  return { total, logFile, output }
}
