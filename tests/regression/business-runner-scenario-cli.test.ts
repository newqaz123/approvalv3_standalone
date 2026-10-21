import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  BUSINESS_SCENARIO_SELECTION,
  collectionOnlyEnvironment,
  parseArgs,
  parseListedTestTotal,
  playwrightBusinessArgs,
  runScenarioListGate,
} from '../support/native/business-runner-cli'
import { decideBusinessEvidenceGate, t12aEvidenceApplies, t15aEvidenceApplies, t18bEvidenceApplies, t18c2EvidenceApplies } from '../support/native/business-evidence-gate'
import {
  assembleBusinessDbChecks,
  type DbEvidenceData,
} from '../support/native/capture-workflow-db-evidence'
import { evaluateCapturedMailEvidence, type CapturedMailSummaryMessage } from '../support/native/capture-workflow-mail-evidence'

/**
 * Regression coverage for the focused-scenario CLI option of the native
 * business runner (--scenario=T18B) and its evidence-gate compatibility.
 *
 * Everything here imports the ACTUAL seams the runner uses (the shared
 * business-runner-cli parseArgs/argv builder, the evidence gate, and the
 * DB/mail evaluators the runner calls after a focused run) — no re-implemented
 * copies. All tests are pure/synthetic: no database, no app, no browser.
 *
 * Contract under test (design-approved):
 *  - default CLI is UNCHANGED (full suite, no grep element, mode full);
 *  - each allowed --scenario value is accepted only with --mode=full and
 *    its own route configuration; every other selection is rejected;
 *  - the Playwright argv is a FIXED array whose grep element is anchored to
 *    the full scenario token (never free text, never shell interpolation);
 *  - a focused run still REQUIRES T18B browser correlation evidence (the
 *    focused run cannot skip T18B itself), while scenarios that did not
 *    execute produce explicit SKIPPED evidence entries (never failures) in
 *    both the DB and mail evaluators.
 */

function emptyDbData(): DbEvidenceData {
  return {
    requests: [],
    solutions: [],
    approvalInstances: [],
    candidateGroups: [],
    requestApprovals: [],
    solutionApprovals: [],
    instanceSkips: [],
    routeVersions: [],
    requestActivities: [],
  }
}

describe('business runner scenario CLI: default unchanged', () => {
  it('parses no arguments as the unchanged full run (mode full, no scenario, no listing)', () => {
    const options = parseArgs([])
    assert.equal(options.mode, 'full')
    assert.equal(options.scenario, undefined)
    assert.equal(options.list, false)
    assert.equal(options.routesConfig, 'all-defaults')
  })

  it('builds the exact historical Playwright argv when no scenario is selected (no grep element)', () => {
    assert.deepEqual(playwrightBusinessArgs(), ['test', '--config=tests/playwright.business.config.ts'])
  })

  it('still validates --routes-config and rejects unknown modes and arguments', () => {
    assert.throws(() => parseArgs(['--routes-config=unknown-profile']), /unknown --routes-config/)
    assert.throws(() => parseArgs(['--mode=fast']), /unknown mode/)
    assert.throws(() => parseArgs(['--grep=free-text']), /unknown argument/)
  })
})

describe('business runner scenario CLI: the allowed focused selections', () => {
  it('accepts --scenario=T18B with default mode and route configuration', () => {
    const options = parseArgs(['--scenario=T18B'])
    assert.equal(options.scenario, 'T18B')
    assert.equal(options.mode, 'full')
    assert.equal(options.routesConfig, 'all-defaults')
  })

  it('appends exactly one FIXED grep argv element anchored to the full scenario token', () => {
    assert.deepEqual(playwrightBusinessArgs('T18B'), [
      'test',
      '--config=tests/playwright.business.config.ts',
      `--grep=${BUSINESS_SCENARIO_SELECTION.T18B.grep}`,
    ])
    // Anchored to the FULL token (word boundaries): never a bare prefix that
    // could match T18/T18A-style neighbours, never free text.
    assert.equal(BUSINESS_SCENARIO_SELECTION.T18B.grep, '\\bT18B\\b')
    assert.equal(BUSINESS_SCENARIO_SELECTION.T18B.routesConfig, 'all-defaults')
  })

  it('rejects every unvalidated scenario value (including neighbour and lowercase ids)', () => {
    for (const bad of ['T18A', 'T18C1', 'T05', 't18b', '', 'T18B1']) {
      assert.throws(() => parseArgs([`--scenario=${bad}`]), /unknown --scenario .*selectable scenarios: T18B/, `--scenario=${bad}`)
    }
  })

  it('rejects the separated (two-argument) scenario form — only --scenario=NAME is accepted', () => {
    assert.throws(() => parseArgs(['--scenario', 'T18B']), /unknown argument/)
  })

  it('rejects incompatible combinations: other route profiles and non-full modes', () => {
    assert.throws(
      () => parseArgs(['--scenario=T18B', '--routes-config=solution-exception']),
      /--scenario T18B belongs to the "all-defaults" route configuration/,
    )
    assert.throws(() => parseArgs(['--scenario=T18B', '--mode=prepare']), /only valid with --mode=full/)
    assert.throws(() => parseArgs(['--scenario=T18B', '--mode=lifecycle-smoke']), /only valid with --mode=full/)
  })
})

describe('business runner scenario CLI: focused T18C2 selection (diagnosis)', () => {
  it('accepts --scenario=T18C2 under the SAME restrictions as T18B (full mode, all-defaults)', () => {
    const options = parseArgs(['--scenario=T18C2'])
    assert.equal(options.scenario, 'T18C2')
    assert.equal(options.mode, 'full')
    assert.equal(options.routesConfig, 'all-defaults')
  })

  it('appends exactly one FIXED grep argv element anchored to the full T18C2 token', () => {
    assert.deepEqual(playwrightBusinessArgs('T18C2'), [
      'test',
      '--config=tests/playwright.business.config.ts',
      `--grep=${BUSINESS_SCENARIO_SELECTION.T18C2.grep}`,
    ])
    assert.equal(BUSINESS_SCENARIO_SELECTION.T18C2.grep, '\\bT18C2\\b')
    assert.equal(BUSINESS_SCENARIO_SELECTION.T18C2.routesConfig, 'all-defaults')
    // The two anchored greps stay distinct full tokens: neither selection
    // can bleed into the other scenario's test.
    assert.notEqual(BUSINESS_SCENARIO_SELECTION.T18B.grep, BUSINESS_SCENARIO_SELECTION.T18C2.grep)
  })

  it('rejects T18C2 outside its restrictions: other route profiles, non-full modes, neighbour ids, separated form', () => {
    assert.throws(
      () => parseArgs(['--scenario=T18C2', '--routes-config=final-exception']),
      /--scenario T18C2 belongs to the "all-defaults" route configuration/,
    )
    assert.throws(() => parseArgs(['--scenario=T18C2', '--mode=prepare']), /--scenario T18C2 is only valid with --mode=full/)
    assert.throws(() => parseArgs(['--scenario=T18C2', '--mode=lifecycle-smoke']), /--scenario T18C2 is only valid with --mode=full/)
    for (const bad of ['T18C3', 'T18C', 'T18C1', 't18c2', '']) {
      assert.throws(() => parseArgs([`--scenario=${bad}`]), /unknown --scenario /, `--scenario=${bad}`)
    }
    assert.throws(() => parseArgs(['--scenario', 'T18C2']), /unknown argument/)
  })

  it('still rejects arbitrary grep/user regex passthrough alongside the focused selection', () => {
    assert.throws(() => parseArgs(['--scenario=T18C2', '--grep=.*']), /unknown argument/)
    assert.throws(() => parseArgs(['--scenario=T18C2', '--grep=T18']), /unknown argument/)
  })

  it('lists with the same fixed grep as the real run, and --list stays collection-only', () => {
    const focused = parseArgs(['--list', '--scenario=T18C2'])
    assert.equal(focused.list, true)
    assert.equal(focused.scenario, 'T18C2')
    assert.deepEqual(playwrightBusinessArgs('T18C2', { list: true }), [
      'test',
      '--list',
      '--config=tests/playwright.business.config.ts',
      '--grep=\\bT18C2\\b',
    ])
    assert.throws(() => parseArgs(['--list', '--scenario=T18C2', '--mode=full']), /--list is collection-only/)
  })
})

describe('business runner scenario CLI: focused T04B selection (diagnosis, Task28)', () => {
  it('accepts --scenario=T04B under the SAME restrictions as T18B/T18C2 (full mode, all-defaults only)', () => {
    const options = parseArgs(['--scenario=T04B'])
    assert.equal(options.scenario, 'T04B')
    assert.equal(options.mode, 'full')
    assert.equal(options.routesConfig, 'all-defaults')
  })

  it('appends exactly one FIXED grep argv element anchored to the full T04B token (never T04B1-style ids)', () => {
    assert.deepEqual(playwrightBusinessArgs('T04B'), [
      'test',
      '--config=tests/playwright.business.config.ts',
      `--grep=${BUSINESS_SCENARIO_SELECTION.T04B.grep}`,
    ])
    assert.equal(BUSINESS_SCENARIO_SELECTION.T04B.grep, '\\bT04B\\b')
    assert.equal(BUSINESS_SCENARIO_SELECTION.T04B.routesConfig, 'all-defaults')
    // Each anchored grep stays a distinct FULL token: no selection can bleed
    // into another scenario's test.
    assert.notEqual(BUSINESS_SCENARIO_SELECTION.T04B.grep, BUSINESS_SCENARIO_SELECTION.T18B.grep)
    assert.notEqual(BUSINESS_SCENARIO_SELECTION.T04B.grep, BUSINESS_SCENARIO_SELECTION.T18C2.grep)
    assert.equal(BUSINESS_SCENARIO_SELECTION.T18B.grep, '\\bT18B\\b')
    assert.equal(BUSINESS_SCENARIO_SELECTION.T18C2.grep, '\\bT18C2\\b')
  })

  it('rejects T04B outside its restrictions: other route profiles, non-full modes, neighbour ids, separated form', () => {
    assert.throws(
      () => parseArgs(['--scenario=T04B', '--routes-config=solution-exception']),
      /--scenario T04B belongs to the "all-defaults" route configuration/,
    )
    assert.throws(() => parseArgs(['--scenario=T04B', '--mode=prepare']), /--scenario T04B is only valid with --mode=full/)
    assert.throws(() => parseArgs(['--scenario=T04B', '--mode=lifecycle-smoke']), /--scenario T04B is only valid with --mode=full/)
    for (const bad of ['T04A', 'T04C', 'T04', 't04b', '', 'T04B1']) {
      assert.throws(() => parseArgs([`--scenario=${bad}`]), /unknown --scenario /, `--scenario=${bad}`)
    }
    assert.throws(() => parseArgs(['--scenario', 'T04B']), /unknown argument/)
  })

  it('still rejects arbitrary grep/user regex passthrough alongside the focused T04B selection', () => {
    assert.throws(() => parseArgs(['--scenario=T04B', '--grep=.*']), /unknown argument/)
    assert.throws(() => parseArgs(['--scenario=T04B', '--grep=T04']), /unknown argument/)
  })

  it('lists with the same fixed grep as the real run, and --list stays collection-only', () => {
    const focused = parseArgs(['--list', '--scenario=T04B'])
    assert.equal(focused.list, true)
    assert.equal(focused.scenario, 'T04B')
    assert.deepEqual(playwrightBusinessArgs('T04B', { list: true }), [
      'test',
      '--list',
      '--config=tests/playwright.business.config.ts',
      '--grep=\\bT04B\\b',
    ])
    assert.throws(() => parseArgs(['--list', '--scenario=T04B', '--mode=full']), /--list is collection-only/)
  })

  it('applies the SAME fail-closed exactly-1 listing gate to the T04B selection', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 't04b-list-gate-'))
    const nodeBin = process.execPath
    const childScript = (lines: string[], exitCode = 0): string[] => [
      '-e',
      `${JSON.stringify(lines)}.forEach((l) => console.log(l)); process.exit(${exitCode})`,
    ]
    const T04B_LISTED = ['Listing tests:', '  [business-chromium] > T04B all-defaults full workflow: …', 'Total: 1 test in 1 file']
    const ok = await runScenarioListGate({
      command: nodeBin,
      args: childScript(T04B_LISTED),
      cwd: base,
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
      baseDir: base,
      scenario: 'T04B',
    })
    assert.equal(ok.total, 1)
    for (const output of [['Total: 0 tests in 0 files'], ['Total: 2 tests in 2 files']]) {
      await assert.rejects(
        runScenarioListGate({
          command: nodeBin,
          args: childScript(output),
          cwd: base,
          env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
          baseDir: base,
          scenario: 'T04B',
        }),
        /matched \d+ tests \(expected exactly 1\)/,
      )
    }
    await assert.rejects(
      runScenarioListGate({
        command: nodeBin,
        args: childScript(T04B_LISTED, 1),
        cwd: base,
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
        baseDir: base,
        scenario: 'T04B',
      }),
      /exited 1/,
    )
  })
})

describe('business runner scenario CLI: evidence gate semantics for a focused T04B run', () => {
  it('T18B and T18C2 correlations are NOT required for the focused T04B run, but the DEFAULT full run still REQUIRES BOTH', () => {
    assert.equal(t18bEvidenceApplies('full', 'all-defaults', 'T04B'), false)
    assert.equal(t18c2EvidenceApplies('full', 'all-defaults', 'T04B'), false)
    // Default (no scenario): both correlations stay required — unchanged.
    assert.equal(t18bEvidenceApplies('full', 'all-defaults', undefined), true)
    assert.equal(t18c2EvidenceApplies('full', 'all-defaults', undefined), true)
  })

  it('marks T18B and T18C2 NOT SELECTED for the focused T04B run — explicit skips, never failures, never claimed coverage', () => {
    // Exact runner call shape: the focused scenario is threaded into the DB
    // capture (requireT18b/requireT18c2 from the applies seams).
    const checks = assembleBusinessDbChecks(emptyDbData(), 'all-defaults', { status: 'missing' }, {
      requireT18b: t18bEvidenceApplies('full', 'all-defaults', 'T04B'),
      requireT18c2: t18c2EvidenceApplies('full', 'all-defaults', 'T04B'),
      focusedScenario: 'T04B',
    })
    const t18bNotSelected = checks.find(
      (check) => check.name === 'db-evidence/Business T18B/stranded-restart/browser-correlation-not-selected',
    )
    assert.equal(t18bNotSelected?.status, 'skipped')
    assert.match(t18bNotSelected?.detail ?? '', /T18B was not selected in this focused T04B run/i)
    const t18c2NotSelected = checks.find(
      (check) => check.name === 'db-evidence/Business T18C2/vacancy-auto-complete/browser-correlation-not-selected',
    )
    assert.equal(t18c2NotSelected?.status, 'skipped')
    assert.match(t18c2NotSelected?.detail ?? '', /T18C2 was not selected in this focused T04B run/i)
    // No unexecuted scenario produced a failure: the focused T04B run passes
    // or fails on T04B's OWN evidence only.
    assert.deepEqual(checks.filter((check) => check.status === 'fail'), [])
  })

  it('the DB capture itself stays GENERIC fail-closed for the focused T04B run (thrown/null capture is never zero failures)', () => {
    for (const dbCapture of ['thrown', 'null', 'not-applicable', 'failed'] as const) {
      const gate = decideBusinessEvidenceGate({
        mode: 'full',
        routesConfig: 'all-defaults',
        dbCapture,
        dbFailureCount: dbCapture === 'failed' ? 1 : 0,
        mailCapture: 'success',
      })
      assert.equal(gate.status, 'failed', `dbCapture=${dbCapture} must fail the gate`)
      assert.equal(gate.exitCode, 1)
    }
  })

  it('the runner wiring is scenario-generic (no T04B-specific branches in the runner)', () => {
    const runnerSource = readFileSync('tests/support/native/run-native-business-tests.ts', 'utf8')
    assert.match(runnerSource, /t18bEvidenceApplies\(options\.mode, options\.routesConfig, options\.scenario\)/)
    assert.match(runnerSource, /t18c2EvidenceApplies\(options\.mode, options\.routesConfig, options\.scenario\)/)
    assert.match(runnerSource, /focusedScenario: options\.scenario/)
  })
})

describe('business runner scenario CLI: collection-only --list', () => {
  it('parses --list alone and focused with --scenario=T18B, but not combined with --mode', () => {
    assert.equal(parseArgs(['--list']).list, true)
    const focused = parseArgs(['--list', '--scenario=T18B'])
    assert.equal(focused.list, true)
    assert.equal(focused.scenario, 'T18B')
    assert.throws(() => parseArgs(['--list', '--mode=full']), /--list is collection-only/)
  })

  it('lists with the same fixed grep as the real run', () => {
    assert.deepEqual(playwrightBusinessArgs('T18B', { list: true }), [
      'test',
      '--list',
      '--config=tests/playwright.business.config.ts',
      '--grep=\\bT18B\\b',
    ])
    assert.deepEqual(playwrightBusinessArgs(undefined, { list: true }), [
      'test',
      '--list',
      '--config=tests/playwright.business.config.ts',
    ])
  })

  it('parses the matched-test total from playwright --list output (50 default, 1 focused, 0 rejected)', () => {
    assert.equal(parseListedTestTotal('Total: 50 tests in 13 files'), 50)
    assert.equal(parseListedTestTotal('Total: 1 test in 1 file'), 1)
    assert.equal(parseListedTestTotal('Total: 0 tests in 0 files'), 0)
    assert.equal(parseListedTestTotal('Error: No tests found\nTotal: 0 tests in 0 files'), 0)
    assert.equal(parseListedTestTotal('something else entirely'), null)
  })

  it('builds a synthetic listing environment with a loopback-format base URL and NO DATABASE_URL', () => {
    const env = collectionOnlyEnvironment('/tmp/synthetic-evidence')
    assert.equal(env.BUSINESS_TEST_BASE_URL, 'http://127.0.0.1:1')
    assert.equal(env.BUSINESS_ROUTES_CONFIG, 'all-defaults')
    assert.ok(env.BUSINESS_EVIDENCE_DIR)
    assert.ok(env.BUSINESS_E2E_PASSWORD)
    assert.ok(!('DATABASE_URL' in env), 'the collection environment must never carry DATABASE_URL')
  })
})

describe('business runner scenario CLI: fail-closed collection listing gate (Astra P1 fix)', () => {
  /**
   * These drive the ACTUAL runner-used listing seam (runScenarioListGate,
   * which allocates a fresh per-invocation log dir and requires the listing
   * child to complete successfully) with tiny controlled children — no
   * Playwright, no browser, no server, no DB.
   */
  const nodeBin = process.execPath
  const childScript = (lines: string[], exitCode = 0): string[] => [
    '-e',
    `${JSON.stringify(lines)}.forEach((l) => console.log(l)); process.exit(${exitCode})`,
  ]
  const TOTAL_1 = ['Listing tests:', '  [business-chromium] > T18B stranded attempt: ...', 'Total: 1 test in 1 file']

  async function freshBase(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 't18b-list-gate-'))
  }

  it('REJECTS a failed collection child even when a stale Total: 1 log already exists (no rescue-parse of prior evidence)', async () => {
    const base = await freshBase()
    // Prior successful invocation's evidence, left in place (must be preserved, never re-read as the current total).
    const priorDir = path.join(base, 'playwright-list-prior')
    await fs.mkdir(priorDir, { recursive: true })
    await fs.writeFile(path.join(priorDir, 'playwright-list.log'), `${TOTAL_1.join('\n')}\n`)
    await assert.rejects(
      runScenarioListGate({
        command: nodeBin,
        args: childScript(['Error: collection crashed'], 1),
        cwd: base,
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
        baseDir: base,
        scenario: 'T18B',
      }),
      /exited 1|TIMEOUT/,
    )
    // The stale prior evidence must still be there untouched.
    const prior = await fs.readFile(path.join(base, 'playwright-list-prior', 'playwright-list.log'), 'utf8')
    assert.match(prior, /Total: 1 test in 1 file/)
  })

  it('REJECTS a nonzero-exit collection child whose OWN output contains Total: 1 (a failed process is never a successful selection)', async () => {
    const base = await freshBase()
    await assert.rejects(
      runScenarioListGate({
        command: nodeBin,
        args: childScript(TOTAL_1, 1),
        cwd: base,
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
        baseDir: base,
        scenario: 'T18B',
      }),
      /exited 1/,
    )
  })

  it('propagates the zero-match collection failure (Playwright exits nonzero with Total: 0)', async () => {
    const base = await freshBase()
    await assert.rejects(
      runScenarioListGate({
        command: nodeBin,
        args: childScript(['Error: No tests found', 'Total: 0 tests in 0 files'], 1),
        cwd: base,
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
        baseDir: base,
        scenario: 'T18B',
      }),
      /exited 1/,
    )
  })

  it('ACCEPTS a successful focused collection with exactly Total: 1, in a fresh unique log that never overwrites prior evidence', async () => {
    const base = await freshBase()
    const first = await runScenarioListGate({
      command: nodeBin,
      args: childScript(TOTAL_1),
      cwd: base,
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
      baseDir: base,
      scenario: 'T18B',
    })
    assert.equal(first.total, 1)
    const second = await runScenarioListGate({
      command: nodeBin,
      args: childScript(TOTAL_1),
      cwd: base,
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
      baseDir: base,
      scenario: 'T18B',
    })
    assert.equal(second.total, 1)
    assert.notEqual(first.logFile, second.logFile, 'each invocation parses its own fresh log')
    await fs.access(first.logFile)
    await fs.access(second.logFile)
  })

  it('REJECTS a successful focused collection whose total is 0 or multiple (must be exactly 1)', async () => {
    const base = await freshBase()
    for (const output of [['Total: 0 tests in 0 files'], ['Total: 3 tests in 3 files']]) {
      await assert.rejects(
        runScenarioListGate({
          command: nodeBin,
          args: childScript(output),
          cwd: base,
          env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
          baseDir: base,
          scenario: 'T18B',
        }),
        /matched \d+ tests \(expected exactly 1\)/,
      )
    }
  })

  it('applies the SAME fail-closed exactly-1 gate to the T18C2 selection', async () => {
    const base = await freshBase()
    const T18C2_LISTED = ['Listing tests:', '  [business-chromium] > T18C2 every step vacant at creation: …', 'Total: 1 test in 1 file']
    const ok = await runScenarioListGate({
      command: nodeBin,
      args: childScript(T18C2_LISTED),
      cwd: base,
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
      baseDir: base,
      scenario: 'T18C2',
    })
    assert.equal(ok.total, 1)
    for (const output of [['Total: 0 tests in 0 files'], ['Total: 2 tests in 2 files']]) {
      await assert.rejects(
        runScenarioListGate({
          command: nodeBin,
          args: childScript(output),
          cwd: base,
          env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
          baseDir: base,
          scenario: 'T18C2',
        }),
        /matched \d+ tests \(expected exactly 1\)/,
      )
    }
    await assert.rejects(
      runScenarioListGate({
        command: nodeBin,
        args: childScript(T18C2_LISTED, 1),
        cwd: base,
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
        baseDir: base,
        scenario: 'T18C2',
      }),
      /exited 1/,
    )
  })

  it('ACCEPTS the default full-suite collection (Total: 50) without a scenario', async () => {
    const base = await freshBase()
    const result = await runScenarioListGate({
      command: nodeBin,
      args: childScript(['Total: 50 tests in 13 files']),
      cwd: base,
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
      baseDir: base,
    })
    assert.equal(result.total, 50)
  })
})

describe('business runner scenario CLI: evidence gate compatibility with a focused T18B run', () => {
  it('still requires T18B evidence for full + all-defaults (the focused run cannot skip T18B itself)', () => {
    assert.equal(t18bEvidenceApplies('full', 'all-defaults'), true)
  })

  it('fails the run when the REQUIRED T18B browser correlation is missing (exact runner call shape)', () => {
    // The runner calls assembleBusinessDbChecks via captureWorkflowDbEvidence
    // with requireT18b: t18bEvidenceApplies(mode, routesConfig) — true for the
    // focused selection, so a missing correlation must FAIL, not skip.
    const checks = assembleBusinessDbChecks(emptyDbData(), 'all-defaults', { status: 'missing' }, { requireT18b: true })
    const missing = checks.find((check) => check.name === 'db-evidence/Business T18B/stranded-restart/browser-correlation-missing')
    assert.ok(missing, 'the browser-correlation-missing check must be present')
    assert.equal(missing?.status, 'fail')
    const gate = decideBusinessEvidenceGate({
      mode: 'full',
      routesConfig: 'all-defaults',
      dbCapture: 'success',
      dbFailureCount: checks.filter((check) => check.status === 'fail').length,
      mailCapture: 'success',
      mailFailureCount: 0,
    })
    assert.equal(gate.status, 'failed')
    assert.equal(gate.exitCode, 1)
  })

  it('marks every UNEXECUTED scenario as skipped (never failed) in the DB evaluator', () => {
    // A focused T18B run executes no T02–T09/T12A request rows: those checks
    // must be explicit SKIPPED entries so the focused run passes on its own
    // evidence without claiming (or failing on) other scenarios' coverage.
    const checks = assembleBusinessDbChecks(emptyDbData(), 'all-defaults', { status: 'missing' }, { requireT18b: true })
    const scenarioFails = checks.filter((check) => check.status === 'fail' && check.name !== 'db-evidence/Business T18B/stranded-restart/browser-correlation-missing')
    assert.deepEqual(scenarioFails, [], 'no unexecuted scenario may produce a failure')
    const skipped = checks.filter((check) => check.status === 'skipped')
    assert.ok(skipped.length > 0, 'unexecuted scenarios produce explicit skipped entries')
    const crossProfile = checks.filter((check) => check.name.startsWith('db-evidence/config/'))
    assert.ok(crossProfile.every((check) => check.status === 'skipped'), 'cross-profile checks stay skipped')
  })

  it('keeps the mail evaluator green for a focused run: run-global envelope checks pass, T12A is skipped', () => {
    const checks = evaluateCapturedMailEvidence({ messages: [], requests: [], routesConfig: 'all-defaults', focusedScenario: 'T18B' })
    const failures = checks.filter((check) => check.status === 'fail')
    assert.deepEqual(failures, [], 'a focused run with only T18B mail must not fail mail evidence')
    const t12a = checks.find((check) => check.name === 'mail-evidence/Business T12A')
    assert.equal(t12a?.status, 'skipped')
    assert.ok(checks.some((check) => check.name === 'mail-evidence/fixture-domains-only' && check.status === 'pass'))
  })
})

describe('business runner scenario CLI: focused T12A selection (Task41)', () => {
  it('accepts --scenario=T12A under the SAME restrictions (full mode, all-defaults only)', () => {
    const options = parseArgs(['--scenario=T12A'])
    assert.equal(options.scenario, 'T12A')
    assert.equal(options.mode, 'full')
    assert.equal(options.routesConfig, 'all-defaults')
  })

  it('appends exactly one FIXED grep argv element anchored to the EXACT browser test title (the spec title carries no T12A token)', () => {
    // The T12A browser test is titled "T12 in-app notification recipients …"
    // (the T12A token is the REQUEST title prefix, not the test title), so a
    // \\bT12A\\b grep matches ZERO tests. The fixed element is therefore
    // anchored to the distinctive head of the exact test title with word
    // boundaries — verified to match exactly 1 test by the listing gate.
    assert.deepEqual(playwrightBusinessArgs('T12A'), [
      'test',
      '--config=tests/playwright.business.config.ts',
      `--grep=${BUSINESS_SCENARIO_SELECTION.T12A.grep}`,
    ])
    assert.equal(BUSINESS_SCENARIO_SELECTION.T12A.grep, '\\bT12 in-app notification recipients\\b')
    assert.equal(BUSINESS_SCENARIO_SELECTION.T12A.routesConfig, 'all-defaults')
    for (const other of ['T18B', 'T18C2', 'T04B'] as const) {
      assert.notEqual(BUSINESS_SCENARIO_SELECTION.T12A.grep, BUSINESS_SCENARIO_SELECTION[other].grep)
    }
    // Source pin: the fixed grep stays coupled to the actual spec title.
    const specSource = readFileSync('tests/business-e2e/business-notifications.spec.ts', 'utf8')
    assert.match(specSource, /test\('T12 in-app notification recipients at create/)
  })

  it('rejects T12A outside its restrictions: other route profiles, non-full modes, neighbour ids, separated form, free grep', () => {
    assert.throws(
      () => parseArgs(['--scenario=T12A', '--routes-config=solution-exception']),
      /--scenario T12A belongs to the "all-defaults" route configuration/,
    )
    assert.throws(() => parseArgs(['--scenario=T12A', '--mode=prepare']), /--scenario T12A is only valid with --mode=full/)
    assert.throws(() => parseArgs(['--scenario=T12A', '--mode=lifecycle-smoke']), /--scenario T12A is only valid with --mode=full/)
    for (const bad of ['T12B', 'T12', 't12a', '', 'T12A1']) {
      assert.throws(() => parseArgs([`--scenario=${bad}`]), /unknown --scenario /, `--scenario=${bad}`)
    }
    assert.throws(() => parseArgs(['--scenario', 'T12A']), /unknown argument/)
    assert.throws(() => parseArgs(['--scenario=T12A', '--grep=.*']), /unknown argument/)
  })

  it('lists with the same fixed grep as the real run, and --list stays collection-only', () => {
    const focused = parseArgs(['--list', '--scenario=T12A'])
    assert.equal(focused.list, true)
    assert.equal(focused.scenario, 'T12A')
    assert.deepEqual(playwrightBusinessArgs('T12A', { list: true }), [
      'test',
      '--list',
      '--config=tests/playwright.business.config.ts',
      '--grep=\\bT12 in-app notification recipients\\b',
    ])
    assert.throws(() => parseArgs(['--list', '--scenario=T12A', '--mode=full']), /--list is collection-only/)
  })

  it('applies the SAME fail-closed exactly-1 listing gate to the T12A selection', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 't12a-list-gate-'))
    const nodeBin = process.execPath
    const childScript = (lines: string[], exitCode = 0): string[] => [
      '-e',
      `${JSON.stringify(lines)}.forEach((l) => console.log(l)); process.exit(${exitCode})`,
    ]
    const T12A_LISTED = ['Listing tests:', '  [business-chromium] > route configuration: all-defaults > T12 in-app notification recipients …', 'Total: 1 test in 1 file']
    const ok = await runScenarioListGate({
      command: nodeBin,
      args: childScript(T12A_LISTED),
      cwd: base,
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
      baseDir: base,
      scenario: 'T12A',
    })
    assert.equal(ok.total, 1)
    for (const output of [['Total: 0 tests in 0 files'], ['Total: 2 tests in 2 files']]) {
      await assert.rejects(
        runScenarioListGate({
          command: nodeBin,
          args: childScript(output),
          cwd: base,
          env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
          baseDir: base,
          scenario: 'T12A',
        }),
        /matched \d+ tests \(expected exactly 1\)/,
      )
    }
    await assert.rejects(
      runScenarioListGate({
        command: nodeBin,
        args: childScript(T12A_LISTED, 1),
        cwd: base,
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
        baseDir: base,
        scenario: 'T12A',
      }),
      /exited 1/,
    )
  })
})

describe('business runner scenario CLI: focused T15A selection (Task52, UI rapid-click measurement slice)', () => {
  it('accepts --scenario=T15A under the SAME restrictions (full mode, all-defaults only)', () => {
    const options = parseArgs(['--scenario=T15A'])
    assert.equal(options.scenario, 'T15A')
    assert.equal(options.mode, 'full')
    assert.equal(options.routesConfig, 'all-defaults')
  })

  it('appends exactly one FIXED grep argv element anchored to the full T15A token (never T15B/C/D neighbours)', () => {
    assert.deepEqual(playwrightBusinessArgs('T15A'), [
      'test',
      '--config=tests/playwright.business.config.ts',
      `--grep=${BUSINESS_SCENARIO_SELECTION.T15A.grep}`,
    ])
    assert.equal(BUSINESS_SCENARIO_SELECTION.T15A.grep, '\\bT15A\\b')
    assert.equal(BUSINESS_SCENARIO_SELECTION.T15A.routesConfig, 'all-defaults')
    for (const other of ['T18B', 'T18C2', 'T04B', 'T12A'] as const) {
      assert.notEqual(BUSINESS_SCENARIO_SELECTION.T15A.grep, BUSINESS_SCENARIO_SELECTION[other].grep)
    }
    // Source pin: the fixed grep stays coupled to the actual spec title.
    const specSource = readFileSync('tests/business-e2e/business-races.spec.ts', 'utf8')
    assert.match(specSource, /test\('T15A double-submitting the Final trigger/)
  })

  it('rejects T15A outside its restrictions: other route profiles, non-full modes, neighbour ids, separated form, free grep', () => {
    assert.throws(
      () => parseArgs(['--scenario=T15A', '--routes-config=solution-exception']),
      /--scenario T15A belongs to the "all-defaults" route configuration/,
    )
    assert.throws(() => parseArgs(['--scenario=T15A', '--mode=prepare']), /--scenario T15A is only valid with --mode=full/)
    assert.throws(() => parseArgs(['--scenario=T15A', '--mode=lifecycle-smoke']), /--scenario T15A is only valid with --mode=full/)
    for (const bad of ['T15', 'T15B', 'T15C', 'T15D', 't15a', '', 'T15A1']) {
      assert.throws(() => parseArgs([`--scenario=${bad}`]), /unknown --scenario /, `--scenario=${bad}`)
    }
    assert.throws(() => parseArgs(['--scenario', 'T15A']), /unknown argument/)
    assert.throws(() => parseArgs(['--scenario=T15A', '--grep=.*']), /unknown argument/)
  })

  it('lists with the same fixed grep as the real run, and --list stays collection-only', () => {
    const focused = parseArgs(['--list', '--scenario=T15A'])
    assert.equal(focused.list, true)
    assert.equal(focused.scenario, 'T15A')
    assert.deepEqual(playwrightBusinessArgs('T15A', { list: true }), [
      'test',
      '--list',
      '--config=tests/playwright.business.config.ts',
      '--grep=\\bT15A\\b',
    ])
    assert.throws(() => parseArgs(['--list', '--scenario=T15A', '--mode=full']), /--list is collection-only/)
  })

  it('applies the SAME fail-closed exactly-1 listing gate to the T15A selection', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 't15a-list-gate-'))
    const nodeBin = process.execPath
    const childScript = (lines: string[], exitCode = 0): string[] => [
      '-e',
      `${JSON.stringify(lines)}.forEach((l) => console.log(l)); process.exit(${exitCode})`,
    ]
    const T15A_LISTED = ['Listing tests:', '  [business-chromium] › business-races.spec.ts:191:7 › route configuration: all-defaults › T15A double-submitting the Final trigger produces exactly one transition', 'Total: 1 test in 1 file']
    const ok = await runScenarioListGate({
      command: nodeBin,
      args: childScript(T15A_LISTED),
      cwd: base,
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
      baseDir: base,
      scenario: 'T15A',
    })
    assert.equal(ok.total, 1)
    for (const output of [['Total: 0 tests in 0 files'], ['Total: 2 tests in 2 files']]) {
      await assert.rejects(
        runScenarioListGate({
          command: nodeBin,
          args: childScript(output),
          cwd: base,
          env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
          baseDir: base,
          scenario: 'T15A',
        }),
        /matched \d+ tests \(expected exactly 1\)/,
      )
    }
    await assert.rejects(
      runScenarioListGate({
        command: nodeBin,
        args: childScript(T15A_LISTED, 1),
        cwd: base,
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
        baseDir: base,
        scenario: 'T15A',
      }),
      /exited 1/,
    )
  })
})

describe('business runner scenario CLI: evidence semantics for a focused T15A run (Task56 — T15A DB evidence now REQUIRED)', () => {
  it('focused T15A leaves T18B/T18C2/T12A unrequired and now REQUIRES its own persisted evidence; the DEFAULT full run requires ALL', () => {
    // Task56 superseded the Task52 "no required evidence" premise: the
    // t15a-browser-correlation.json is now the REQUIRED input of the
    // persisted single-transition DB gate (focused T15A + default full run).
    assert.equal(t15aEvidenceApplies('full', 'all-defaults', 'T15A'), true)
    assert.equal(t15aEvidenceApplies('full', 'all-defaults', undefined), true)
    assert.equal(t18bEvidenceApplies('full', 'all-defaults', 'T15A'), false)
    assert.equal(t18c2EvidenceApplies('full', 'all-defaults', 'T15A'), false)
    assert.equal(t12aEvidenceApplies('full', 'all-defaults', 'T15A'), false)
    // Default full run: every existing requirement is preserved unchanged.
    assert.equal(t18bEvidenceApplies('full', 'all-defaults', undefined), true)
    assert.equal(t18c2EvidenceApplies('full', 'all-defaults', undefined), true)
    assert.equal(t12aEvidenceApplies('full', 'all-defaults', undefined), true)
  })

  it('focused T15A records T18B/T18C2 as not-selected skips and no other failures (skip matrix preserved)', () => {
    const checks = assembleBusinessDbChecks(emptyDbData(), 'all-defaults', { status: 'missing' }, {
      requireT18b: t18bEvidenceApplies('full', 'all-defaults', 'T15A'),
      requireT18c2: t18c2EvidenceApplies('full', 'all-defaults', 'T15A'),
      // The T15A requirement itself (missing correlation FAILS for this
      // selection) is covered by the dedicated regression
      // business-t15a-persisted-evidence.test.ts; requireT15a:false keeps
      // THIS test's skip-matrix assertion scoped to T18B/T18C2.
      requireT15a: false,
      focusedScenario: 'T15A',
    })
    assert.equal(
      checks.find((check) => check.name === 'db-evidence/Business T18B/stranded-restart/browser-correlation-not-selected')?.status,
      'skipped',
    )
    assert.equal(
      checks.find((check) => check.name === 'db-evidence/Business T18C2/vacancy-auto-complete/browser-correlation-not-selected')?.status,
      'skipped',
    )
    assert.deepEqual(checks.filter((check) => check.status === 'fail'), [])
    // Task59: a focused T15A run now REQUIRES the T15A duplicate-mail
    // matrix (the same selection that requires the T15A DB evidence), so a
    // green focused-T15A capture carries the correlation, the request row
    // and the exact three FINAL-phase mails; T12A stays a not-selected skip
    // and zero mail failures — the preserved skip matrix, now with the
    // required T15A evidence satisfied rather than absent.
    const focusedT15aTitle = 'Business T15A 1789800000000-77'
    const focusedT15aMail: CapturedMailSummaryMessage[] = [
      { receivedAt: '2026-09-26T08:00:00Z', from: 'business-workflow-test@business.test', to: ['user-section-manager-p@business.test'], subject: `Final Approval Needed: ${focusedT15aTitle}`, requestId: 'req-t15a-focused' },
      { receivedAt: '2026-09-26T08:00:01Z', from: 'business-workflow-test@business.test', to: ['user-department-manager@business.test'], subject: `Final Approval Needed: ${focusedT15aTitle}`, requestId: 'req-t15a-focused' },
      { receivedAt: '2026-09-26T08:00:02Z', from: 'business-workflow-test@business.test', to: ['user-requester-a@business.test'], subject: 'Request Completed', requestId: 'req-t15a-focused' },
    ]
    const mailChecks = evaluateCapturedMailEvidence({
      messages: focusedT15aMail,
      requests: [{ id: 'req-t15a-focused', title: focusedT15aTitle }],
      routesConfig: 'all-defaults',
      focusedScenario: 'T15A',
      t15a: { status: 'present', correlation: { requestTitle: focusedT15aTitle, attemptedClicks: 2, observedRequestCalls: 2, status: 'measured' } },
    })
    assert.equal(mailChecks.find((check) => check.name === 'mail-evidence/Business T12A')?.status, 'skipped')
    assert.equal(mailChecks.find((check) => check.name === 'mail-evidence/Business T15A/final-approval-needed-exact-multiplicity')?.status, 'pass')
    assert.deepEqual(mailChecks.filter((check) => check.status === 'fail'), [])
  })
})

describe('business runner scenario CLI: evidence semantics for a focused T12A run', () => {
  const runnerSource = readFileSync('tests/support/native/run-native-business-tests.ts', 'utf8')

  it('the T12A mail matrix is REQUIRED for the default full run AND the focused T12A run, skipped for other selections', () => {
    assert.equal(t12aEvidenceApplies('full', 'all-defaults', undefined), true)
    assert.equal(t12aEvidenceApplies('full', 'all-defaults', 'T12A'), true)
    for (const other of ['T18B', 'T18C2', 'T04B']) {
      assert.equal(t12aEvidenceApplies('full', 'all-defaults', other), false, `focused ${other} must not require T12A mail`)
    }
    assert.equal(t12aEvidenceApplies('prepare', 'all-defaults', undefined), false)
    assert.equal(t12aEvidenceApplies('lifecycle-smoke', 'all-defaults', undefined), false)
    assert.equal(t12aEvidenceApplies('full', 'final-exception', undefined), false)
  })

  it('T18B and T18C2 correlations are NOT required for the focused T12A run — explicit not-selected skips, never failures', () => {
    const checks = assembleBusinessDbChecks(emptyDbData(), 'all-defaults', { status: 'missing' }, {
      requireT18b: t18bEvidenceApplies('full', 'all-defaults', 'T12A'),
      requireT18c2: t18c2EvidenceApplies('full', 'all-defaults', 'T12A'),
      focusedScenario: 'T12A',
    })
    assert.equal(
      checks.find((check) => check.name === 'db-evidence/Business T18B/stranded-restart/browser-correlation-not-selected')?.status,
      'skipped',
    )
    assert.equal(
      checks.find((check) => check.name === 'db-evidence/Business T18C2/vacancy-auto-complete/browser-correlation-not-selected')?.status,
      'skipped',
    )
    assert.deepEqual(checks.filter((check) => check.status === 'fail'), [])
  })

  it('the runner threads the focused scenario and the mail capture state into the mail evidence capture and the gate', () => {
    assert.match(runnerSource, /captureWorkflowMailEvidence\(runtime, runEvidenceDir, options\.routesConfig, mailSummary, options\.scenario\)/)
    assert.match(runnerSource, /mailCapture: artifacts\.mailCapture/)
    // The evaluator consumes the SAME shared requirement seam (no duplicated predicate).
    const evaluatorSource = readFileSync('tests/support/native/capture-workflow-mail-evidence.ts', 'utf8')
    assert.match(evaluatorSource, /t12aEvidenceApplies\('full', routesConfig, focusedScenario\)/)
  })
})

describe('business runner scenario CLI: evidence gate semantics for a focused T18C2 run', () => {
  const runnerSource = readFileSync('tests/support/native/run-native-business-tests.ts', 'utf8')

  it('T18B evidence stays REQUIRED for the default full run AND the focused T18B run (scenario argument)', () => {
    assert.equal(t18bEvidenceApplies('full', 'all-defaults', undefined), true)
    assert.equal(t18bEvidenceApplies('full', 'all-defaults', 'T18B'), true)
    // Non-applicable modes/configs stay false exactly as before.
    assert.equal(t18bEvidenceApplies('prepare', 'all-defaults', undefined), false)
    assert.equal(t18bEvidenceApplies('full', 'solution-exception', undefined), false)
  })

  it('marks T18B NOT SELECTED for the focused T18C2 run — a skip, never a missing-correlation failure', () => {
    assert.equal(t18bEvidenceApplies('full', 'all-defaults', 'T18C2'), false)
    // Exact runner call shape: focusedScenario is threaded into the DB capture.
    const checks = assembleBusinessDbChecks(emptyDbData(), 'all-defaults', { status: 'missing' }, {
      requireT18b: t18bEvidenceApplies('full', 'all-defaults', 'T18C2'),
      focusedScenario: 'T18C2',
    })
    const notSelected = checks.find(
      (check) => check.name === 'db-evidence/Business T18B/stranded-restart/browser-correlation-not-selected',
    )
    assert.ok(notSelected, 'the T18B not-selected entry must be present')
    assert.equal(notSelected?.status, 'skipped')
    assert.match(notSelected?.detail ?? '', /T18B was not selected in this focused T18C2 run/i)
    // The T18B stranded-restart checks did NOT run: T18B evidence is never
    // counted (or failed) as T18C2 coverage.
    const t18bChecks = checks.filter((check) => check.name.includes('T18B'))
    assert.deepEqual(t18bChecks.map((check) => check.status), ['skipped'])
    // No failures anywhere: a focused T18C2 run passes on its own evidence.
    assert.deepEqual(checks.filter((check) => check.status === 'fail'), [])
    const gate = decideBusinessEvidenceGate({
      mode: 'full',
      routesConfig: 'all-defaults',
      dbCapture: 'success',
      dbFailureCount: 0,
      mailCapture: 'success',
    })
    assert.equal(gate.status, 'passed')
    assert.equal(gate.exitCode, 0)
  })

  it('still FAILS CLOSED when a run is (mis)wired to require T18B correlation it did not capture', () => {
    // If the scenario wiring were lost, the old behavior reappears: the
    // missing correlation is a FAILURE — never a silent skip.
    const checks = assembleBusinessDbChecks(emptyDbData(), 'all-defaults', { status: 'missing' }, { requireT18b: true })
    const missing = checks.find(
      (check) => check.name === 'db-evidence/Business T18B/stranded-restart/browser-correlation-missing',
    )
    assert.equal(missing?.status, 'fail')
  })

  it('Task24 CLOSED the former coverage gap: focused T18C2 REQUIRES T18C2 DB evidence — missing correlation fails', () => {
    // Before Task24 nothing claimed DB-verified T18C2. Now the focused run
    // wires requireT18c2 and a missing/corrupt correlation is a FAILURE —
    // never a silent skip, never claimed coverage without the evaluator.
    const checks = assembleBusinessDbChecks(emptyDbData(), 'all-defaults', { status: 'missing' }, {
      requireT18b: false,
      requireT18c2: t18c2EvidenceApplies('full', 'all-defaults', 'T18C2'),
      focusedScenario: 'T18C2',
    })
    const missing = checks.find(
      (check) => check.name === 'db-evidence/Business T18C2/vacancy-auto-complete/browser-correlation-missing',
    )
    assert.equal(missing?.status, 'fail')
    const corrupt = assembleBusinessDbChecks(emptyDbData(), 'all-defaults', { status: 'missing' }, {
      requireT18c2: true,
      t18c2: { status: 'corrupt' },
      focusedScenario: 'T18C2',
    })
    assert.equal(
      corrupt.find((check) => check.name === 'db-evidence/Business T18C2/vacancy-auto-complete/browser-correlation-missing')?.status,
      'fail',
    )
    // The evaluator DID run for the empty database: the required request is
    // missing, which fails — never skipped.
    assert.equal(
      checks.find((check) => check.name === 'db-evidence/Business T18C2/vacancy-auto-complete/request-present')?.status,
      undefined,
      'a missing correlation short-circuits before row evaluation (the correlation failure is the surfaced reason)',
    )
  })

  it('focused T18B marks T18C2 NOT SELECTED — an explicit skip, never claimed coverage', () => {
    const checks = assembleBusinessDbChecks(emptyDbData(), 'all-defaults', { status: 'missing' }, {
      requireT18b: true,
      requireT18c2: t18c2EvidenceApplies('full', 'all-defaults', 'T18B'),
      focusedScenario: 'T18B',
    })
    const notSelected = checks.find(
      (check) => check.name === 'db-evidence/Business T18C2/vacancy-auto-complete/browser-correlation-not-selected',
    )
    assert.equal(notSelected?.status, 'skipped')
    assert.match(notSelected?.detail ?? '', /T18C2 was not selected in this focused T18B run/i)
  })

  it('the runner wires the focused scenario into the T18B requirement and the DB-evidence capture', () => {
    assert.match(runnerSource, /t18bEvidenceApplies\(options\.mode, options\.routesConfig, options\.scenario\)/)
    assert.match(runnerSource, /focusedScenario: options\.scenario/)
  })

  it('Task24: the runner wires the T18C2 requirement into the DB-evidence capture with the same applies seam', () => {
    assert.match(runnerSource, /t18c2EvidenceApplies\(options\.mode, options\.routesConfig, options\.scenario\)/)
    assert.match(runnerSource, /requireT18c2: t18c2EvidenceApplies/)
    // The requirement matrix is pinned in the evaluator tests too; here the
    // DEFAULT full all-defaults run must require T18C2 evidence as well.
    assert.equal(t18c2EvidenceApplies('full', 'all-defaults', undefined), true)
  })
})

describe('business runner scenario CLI: focused T16A and T11B selections (diagnosis-only)', () => {
  const selections = [
    {
      name: 'T16A' as const,
      grep: '\\bT16A\\b',
      spec: 'tests/business-e2e/business-failure-isolation.spec.ts',
      title: /test\('T16A a forced mail failure after commit/,
      neighbours: ['T16', 'T16B', 't16a', '', 'T16A1'],
    },
    {
      name: 'T11B' as const,
      grep: '\\bT11B\\b',
      spec: 'tests/business-e2e/business-visibility.spec.ts',
      title: /test\('T11B sharing OFF/,
      neighbours: ['T11', 'T11A', 'T11C', 't11b', '', 'T11B1'],
    },
  ]

  for (const selection of selections) {
    it(`accepts --scenario=${selection.name} under the same restrictions (full mode, all-defaults only)`, () => {
      const options = parseArgs([`--scenario=${selection.name}`])
      assert.equal(options.scenario, selection.name)
      assert.equal(options.mode, 'full')
      assert.equal(options.routesConfig, 'all-defaults')
      assert.equal(options.list, false)
    })

    it(`appends exactly one fixed grep for ${selection.name} and does not change the default full-suite argv`, () => {
      assert.equal(BUSINESS_SCENARIO_SELECTION[selection.name].grep, selection.grep)
      assert.equal(BUSINESS_SCENARIO_SELECTION[selection.name].routesConfig, 'all-defaults')
      assert.deepEqual(playwrightBusinessArgs(selection.name), [
        'test',
        '--config=tests/playwright.business.config.ts',
        `--grep=${selection.grep}`,
      ])
      assert.deepEqual(playwrightBusinessArgs(undefined), [
        'test',
        '--config=tests/playwright.business.config.ts',
      ])
      for (const other of Object.keys(BUSINESS_SCENARIO_SELECTION)) {
        if (other === selection.name) continue
        assert.notEqual(BUSINESS_SCENARIO_SELECTION[selection.name].grep, BUSINESS_SCENARIO_SELECTION[other as keyof typeof BUSINESS_SCENARIO_SELECTION].grep)
      }
      assert.match(readFileSync(selection.spec, 'utf8'), selection.title)
    })

    it(`rejects ${selection.name} outside its restrictions`, () => {
      assert.throws(
        () => parseArgs([`--scenario=${selection.name}`, '--routes-config=solution-exception']),
        new RegExp(`--scenario ${selection.name} belongs to the "all-defaults" route configuration`),
      )
      assert.throws(
        () => parseArgs([`--scenario=${selection.name}`, '--mode=prepare']),
        new RegExp(`--scenario ${selection.name} is only valid with --mode=full`),
      )
      assert.throws(
        () => parseArgs([`--scenario=${selection.name}`, '--mode=lifecycle-smoke']),
        new RegExp(`--scenario ${selection.name} is only valid with --mode=full`),
      )
      for (const bad of selection.neighbours) {
        assert.throws(() => parseArgs([`--scenario=${bad}`]), /unknown --scenario /, `--scenario=${bad}`)
      }
      assert.throws(() => parseArgs(['--scenario', selection.name]), /unknown argument/)
      assert.throws(() => parseArgs([`--scenario=${selection.name}`, '--grep=.*']), /unknown argument/)
    })

    it(`lists ${selection.name} with the same fixed grep, and --list stays collection-only`, () => {
      const focused = parseArgs(['--list', `--scenario=${selection.name}`])
      assert.equal(focused.list, true)
      assert.equal(focused.scenario, selection.name)
      assert.equal(focused.mode, 'full')
      assert.deepEqual(playwrightBusinessArgs(selection.name, { list: true }), [
        'test',
        '--list',
        '--config=tests/playwright.business.config.ts',
        `--grep=${selection.grep}`,
      ])
      assert.throws(() => parseArgs(['--list', `--scenario=${selection.name}`, '--mode=full']), /--list is collection-only/)
    })

    it(`does not require another scenario's evidence for a focused ${selection.name} run`, () => {
      assert.equal(t18bEvidenceApplies('full', 'all-defaults', selection.name), false)
      assert.equal(t18c2EvidenceApplies('full', 'all-defaults', selection.name), false)
      assert.equal(t12aEvidenceApplies('full', 'all-defaults', selection.name), false)
      assert.equal(t15aEvidenceApplies('full', 'all-defaults', selection.name), false)
      assert.equal(t18bEvidenceApplies('full', 'all-defaults', undefined), true)
      assert.equal(t18c2EvidenceApplies('full', 'all-defaults', undefined), true)
      assert.equal(t12aEvidenceApplies('full', 'all-defaults', undefined), true)
      assert.equal(t15aEvidenceApplies('full', 'all-defaults', undefined), true)

      const checks = assembleBusinessDbChecks(emptyDbData(), 'all-defaults', { status: 'missing' }, {
        requireT18b: t18bEvidenceApplies('full', 'all-defaults', selection.name),
        requireT18c2: t18c2EvidenceApplies('full', 'all-defaults', selection.name),
        requireT15a: t15aEvidenceApplies('full', 'all-defaults', selection.name),
        focusedScenario: selection.name,
      })
      assert.equal(
        checks.find((check) => check.name === 'db-evidence/Business T18B/stranded-restart/browser-correlation-not-selected')?.status,
        'skipped',
      )
      assert.equal(
        checks.find((check) => check.name === 'db-evidence/Business T18C2/vacancy-auto-complete/browser-correlation-not-selected')?.status,
        'skipped',
      )
      assert.deepEqual(checks.filter((check) => check.status === 'fail'), [])

      const mailChecks = evaluateCapturedMailEvidence({
        messages: [],
        requests: [],
        routesConfig: 'all-defaults',
        focusedScenario: selection.name,
      })
      assert.equal(mailChecks.find((check) => check.name === 'mail-evidence/Business T12A')?.status, 'skipped')
      assert.equal(mailChecks.find((check) => check.name === 'mail-evidence/Business T15A')?.status, 'skipped')
      assert.deepEqual(mailChecks.filter((check) => check.status === 'fail'), [])
    })
  }
})

describe('business runner scenario CLI: focused T08E and T10C selections (Final-trigger denial)', () => {
  const selections = [
    {
      name: 'T08E' as const,
      grep: '\\bT08E\\b',
      routesConfig: 'all-defaults',
      otherConfig: 'solution-exception',
      title: /test\('T08E the parent-department Department manager is DENIED the Final trigger/,
      neighbours: ['T08', 'T08A', 'T08F', 't08e', '', 'T08E1'],
    },
    {
      name: 'T10C' as const,
      grep: '\\bT10 Final routing follows the ORIGINAL requester when the parent Department manager is denied\\b',
      routesConfig: 'final-exception',
      otherConfig: 'all-defaults',
      title: /test\(`T10 Final routing follows the ORIGINAL requester when \$\{deniedParentManagerFirst \? 'the parent Department manager is denied and ' : ''\}/,
      neighbours: ['T10', 'T10A', 'T10B', 'T10D', 't10c', '', 'T10C1'],
    },
  ]

  for (const selection of selections) {
    it(`accepts --scenario=${selection.name} only with the ${selection.routesConfig} profile in full mode`, () => {
      const options = parseArgs([`--scenario=${selection.name}`, `--routes-config=${selection.routesConfig}`])
      assert.equal(options.scenario, selection.name)
      assert.equal(options.mode, 'full')
      assert.equal(options.routesConfig, selection.routesConfig)
      assert.equal(options.list, false)
      assert.throws(
        () => parseArgs([`--scenario=${selection.name}`, `--routes-config=${selection.otherConfig}`]),
        new RegExp(`--scenario ${selection.name} belongs to the "${selection.routesConfig}" route configuration`),
      )
      assert.throws(
        () => parseArgs([`--scenario=${selection.name}`, `--routes-config=${selection.routesConfig}`, '--mode=prepare']),
        new RegExp(`--scenario ${selection.name} is only valid with --mode=full`),
      )
      for (const bad of selection.neighbours) {
        assert.throws(() => parseArgs([`--scenario=${bad}`]), /unknown --scenario /, `--scenario=${bad}`)
      }
      assert.throws(() => parseArgs([`--scenario=${selection.name}`, '--grep=.*']), /unknown argument/)
    })

    it(`appends exactly one fixed grep for ${selection.name} that names a real browser test`, () => {
      assert.equal(BUSINESS_SCENARIO_SELECTION[selection.name].grep, selection.grep)
      assert.equal(BUSINESS_SCENARIO_SELECTION[selection.name].routesConfig, selection.routesConfig)
      assert.deepEqual(playwrightBusinessArgs(selection.name), [
        'test',
        '--config=tests/playwright.business.config.ts',
        `--grep=${selection.grep}`,
      ])
      assert.deepEqual(playwrightBusinessArgs(selection.name, { list: true }), [
        'test',
        '--list',
        '--config=tests/playwright.business.config.ts',
        `--grep=${selection.grep}`,
      ])
      for (const other of Object.keys(BUSINESS_SCENARIO_SELECTION)) {
        if (other === selection.name) continue
        assert.notEqual(
          BUSINESS_SCENARIO_SELECTION[selection.name].grep,
          BUSINESS_SCENARIO_SELECTION[other as keyof typeof BUSINESS_SCENARIO_SELECTION].grep,
        )
      }
      assert.match(readFileSync('tests/business-e2e/business-final-trigger.spec.ts', 'utf8'), selection.title)
    })

    it(`does not require another scenario's evidence for a focused ${selection.name} run`, () => {
      assert.equal(t18bEvidenceApplies('full', selection.routesConfig, selection.name), false)
      assert.equal(t18c2EvidenceApplies('full', selection.routesConfig, selection.name), false)
      assert.equal(t12aEvidenceApplies('full', selection.routesConfig, selection.name), false)
      assert.equal(t15aEvidenceApplies('full', selection.routesConfig, selection.name), false)
    })
  }
})
