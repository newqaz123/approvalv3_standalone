/**
 * Terminal evidence gate for the business native runner (test-only).
 *
 * The runner calls this helper. Applicable full runs cannot treat a thrown
 * or missing DB capture as zero failures. T18B browser evidence is required
 * only when that scenario actually runs (full + all-defaults, with no OTHER
 * focused scenario selected); a focused run that did not select T18B records
 * it as an explicit skipped entry in the DB evaluator instead. A required
 * evidence failure sets a nonzero exit on every applicable mode, keeps any
 * primary error first, and never skips cleanup.
 */

export const BUSINESS_RUN_MODES = ['lifecycle-smoke', 'prepare', 'full'] as const
export type BusinessRunMode = (typeof BUSINESS_RUN_MODES)[number]

export type DbCaptureState = 'thrown' | 'null' | 'failed' | 'success' | 'not-applicable'

export interface BusinessEvidenceGateInput {
  mode: BusinessRunMode
  routesConfig: string
  dbCapture: DbCaptureState
  /** Terminal state of the mail-evidence capture for this run (full runs REQUIRE it). */
  mailCapture: DbCaptureState
  dbFailureCount?: number
  mailFailureCount?: number
  primaryError?: string
  cleanupFailures?: readonly string[]
}

export interface BusinessEvidenceGateDecision {
  status: 'passed' | 'failed'
  exitCode: 0 | 1
  error?: string
  /** Evidence failure must not skip resource cleanup. */
  runCleanup: true
  preservedPrimary?: string
}

/**
 * T18B browser correlation is required only when the T18B spec actually
 * runs: full + all-defaults, with NO other focused scenario selected. A
 * focused non-T18B selection (e.g. T18C2) executes no T18B test, so T18B
 * evidence is NOT required for it — the DB evaluator records that as an
 * explicit not-selected skip instead of a missing-correlation failure.
 */
export function t18bEvidenceApplies(mode: BusinessRunMode, routesConfig: string, scenario?: string): boolean {
  if (scenario && scenario !== 'T18B') return false
  return mode === 'full' && routesConfig === 'all-defaults'
}

/**
 * T18C2 browser correlation (exact unique title) is required whenever the
 * T18C2 spec actually runs: the DEFAULT full all-defaults run (every
 * scenario, T18C2 included) and the focused --scenario=T18C2 selection. A
 * focused T18B run executes no T18C2 test, so T18C2 evidence is NOT
 * required for it — the DB evaluator records that as an explicit
 * not-selected skip instead of a missing-correlation failure (Task24).
 */
export function t18c2EvidenceApplies(mode: BusinessRunMode, routesConfig: string, scenario?: string): boolean {
  if (scenario && scenario !== 'T18C2') return false
  return mode === 'full' && routesConfig === 'all-defaults'
}

/**
 * T12A recipient-matrix MAIL evidence is required whenever the T12A spec
 * actually runs: the DEFAULT full all-defaults run (every scenario, T12A
 * included) and the focused --scenario=T12A selection. A focused other
 * selection (T18B/T18C2/T04B) executes no T12A test, so the T12A matrix is
 * NOT required for it — the mail evaluator records that as an explicit
 * not-selected skip instead of a missing-request failure (Task41).
 */
export function t12aEvidenceApplies(mode: BusinessRunMode, routesConfig: string, scenario?: string): boolean {
  if (scenario && scenario !== 'T12A') return false
  return mode === 'full' && routesConfig === 'all-defaults'
}

/**
 * T15A persisted single-transition DB evidence (browser correlation exact
 * title) is required whenever the T15A spec actually runs: the DEFAULT full
 * all-defaults run (every scenario, T15A included) and the focused
 * --scenario=T15A selection. A focused other selection executes no T15A
 * test, so T15A evidence is NOT required for it — the DB evaluator records
 * that as an explicit not-selected skip instead of a missing-correlation
 * failure (Task56; every other scenario's requirement is unchanged).
 */
export function t15aEvidenceApplies(mode: BusinessRunMode, routesConfig: string, scenario?: string): boolean {
  if (scenario && scenario !== 'T15A') return false
  return mode === 'full' && routesConfig === 'all-defaults'
}

export function dbCaptureRequired(mode: BusinessRunMode): boolean {
  return mode !== 'lifecycle-smoke'
}

/**
 * The loopback mail capture (and its evaluator) only exists in full mode;
 * a full run therefore cannot treat a thrown/missing mail capture as zero
 * failures — the same fail-closed pattern as the DB capture (Task41).
 */
export function mailCaptureRequired(mode: BusinessRunMode): boolean {
  return mode === 'full'
}

export function decideBusinessEvidenceGate(input: BusinessEvidenceGateInput): BusinessEvidenceGateDecision {
  const evidenceErrors: string[] = []
  if (dbCaptureRequired(input.mode)) {
    if (input.dbCapture === 'thrown') {
      evidenceErrors.push('workflow DB evidence capture threw — required evidence is missing, not zero failures')
    } else if (input.dbCapture === 'null' || input.dbCapture === 'not-applicable') {
      evidenceErrors.push('workflow DB evidence was not captured')
    }
    if ((input.dbFailureCount ?? 0) > 0 || input.dbCapture === 'failed') {
      evidenceErrors.push(`workflow DB evidence checks failed (${input.dbFailureCount ?? 0})`)
    }
  }
  if (mailCaptureRequired(input.mode)) {
    if (input.mailCapture === 'thrown') {
      evidenceErrors.push('workflow mail evidence capture threw — required evidence is missing, not zero failures')
    } else if (input.mailCapture === 'null' || input.mailCapture === 'not-applicable') {
      evidenceErrors.push('workflow mail evidence was not captured')
    }
  }
  if ((input.mailFailureCount ?? 0) > 0 || input.mailCapture === 'failed') {
    evidenceErrors.push(`workflow mail evidence checks failed (${input.mailFailureCount ?? 0})`)
  }
  const cleanupFailures = input.cleanupFailures ?? []
  if (cleanupFailures.length > 0) {
    evidenceErrors.push(`cleanup failures (${cleanupFailures.length})`)
  }
  const primary = input.primaryError?.trim() ? input.primaryError.trim() : undefined
  const error = [primary, ...evidenceErrors].filter((part) => part && part.length > 0).join(' | ')
  const failed = error.length > 0
  return {
    status: failed ? 'failed' : 'passed',
    exitCode: failed ? 1 : 0,
    error: failed ? error : undefined,
    runCleanup: true,
    preservedPrimary: primary,
  }
}
