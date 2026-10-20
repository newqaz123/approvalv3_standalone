/**
 * Rejection/Recovery Matrix — owned-runtime UI driver (TASK 3 executor).
 * TEST-ONLY. Plan/orchestration come from the pure module; this file implements
 * the MatrixUi boundary with real Playwright flows and owns the matrix runtime
 * lifecycle. ZERO product source imports.
 *
 * Evidence: typed builders query the owned DB via READ ONLY single SELECTs with
 * row_to_json projections and ACTIVE-instance correlation (no attempt column —
 * attempts come from approval_instances). Validators require REAL ids, the
 * EXPECTED actor/order/phase/attempt and the intended custom chain.
 * Exactly-once: journal (FULL ledger) is awaited before every business click;
 * confirmations require the typed evidence. Approvals are single real clicks
 * with phase-correct controls. FINAL recovery: Engineering revise/resubmit ->
 * SOLUTION reapprovals -> requester re-initiation -> FINAL approvals.
 * Stale negatives: held dialog (never submitted) + before/after terminal
 * snapshot comparison after Completed is proven. Any page error or unexpected
 * failure stops the entire matrix.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect as baseExpect, type Browser, type BrowserContext, type Page, type Locator } from '@playwright/test'
import {
  assertApprovalEvidence,
  assertClickAllowed,
  assertCompletedEvidence,
  assertFinalInitiationEvidence,
  assertRejectionEvidence,
  assertRequestCreateEvidence,
  assertResubmitEvidence,
  assertSnapshotsEqual,
  assertSolutionSubmitEvidence,
  activeInstanceSql,
  approvalRowSql,
  buildCasePlan,
  buildInventory,
  buildStaleNegativeChecks,
  CUSTOM_CHAINS,
  customChainSelectionClicks,
  emptyMatrixJournal,
  encloseFailedSetup,
  enableCustomHierarchy,
  expectedPostRejectStatus,
  expectedRouteSource,
  finalizeTraceArtifact,
  FIXTURE_ACTORS,
  fixtureActorIdFromMatrix,
  LIVE_CO_CANDIDATE_VERIFICATION,
  matrixActorEmail,
  matrixActorId,
  matrixBrowserProfile,
  MATRIX_ASSERT_TIMEOUT_MS,
  MatrixLedger,
  type ObservedApprovalRow,
  instanceRouteSql,
  latestSolutionSql,
  pendingChainSql,
  pendingCustomActorId,
  phaseHistorySql,
  RANK_CHAINS,
  activeAssignmentSql,
  assembleRouteProof,
  buildActionBaseline,
  buildFinalInitiationEvidence,
  buildRevisionBaseline,
  buildSolutionSubmitEvidence,
  classifyPendingChain,
  persistScopedCaseEvidence,
  proveFinalInitiation,
  publishedRouteProofSql,
  scopedBusinessEvidenceSql,
  renderMatrixProgress,
  retainProfileAggregate,
  requestByTitleSql,
  retainCaseJournal,
  runMatrixCase,
  terminalSnapshotSql,
  validateCasePlan,
  type ActivePhaseRef,
  type ApprovalEvidence,
  type CompletedEvidence,
  type FinalInitiationEvidence,
  type HeldRejectDialog,
  type MatrixJournal,
  type MatrixRow,
  type MatrixUi,
  type Phase,
  type PlanStep,
  type RejectionEvidence,
  type RequestCreateEvidence,
  type ResubmitEvidence,
  type RouteProfile,
  type SolutionSubmitEvidence,
  type TerminalSnapshot,
  type ToggleDriver,
} from '../support/rejection-recovery-matrix'
import {
  copyLogTail,
  runOwnedMatrixSession,
  startMatrixRuntime,
  writeFailureArtifacts,
  type MatrixRuntimeHandle,
} from '../support/native/rejection-recovery-runtime'

const BROWSER = matrixBrowserProfile()
const expect = baseExpect.configure({ timeout: MATRIX_ASSERT_TIMEOUT_MS })

interface Options {
  routesConfig: RouteProfile
  evidenceRoot: string
  caseIds?: string[]
  /** Explicit future opt-in. Default false. Never implied by implementation. */
  seedCleared: boolean
}

function parseOptions(): Options {
  const routesConfigArg = process.argv.find((a) => a.startsWith('--routes-config='))
  const evidenceRoot = process.argv.find((a) => a.startsWith('--evidence-root='))?.slice('--evidence-root='.length)
  if (!routesConfigArg || !evidenceRoot) {
    throw new Error('usage: --routes-config=<profile> --evidence-root=<abs dir> [--case-ids=a,b] [--seed-cleared=true]')
  }
  const caseIds = process.argv.find((a) => a.startsWith('--case-ids='))?.slice('--case-ids='.length).split(',')
  return {
    routesConfig: routesConfigArg.slice('--routes-config='.length) as RouteProfile,
    evidenceRoot,
    caseIds,
    seedCleared: process.argv.includes('--seed-cleared=true'),
  }
}

export interface CaseResult {
  caseId: string
  requestTitle: string
  status: 'passed' | 'failed' | 'blocked'
  staleNegative?: 'passed' | 'stale-window-unavailable' | 'failed'
  error?: string
}

const results: CaseResult[] = []
let handle: MatrixRuntimeHandle
let evidenceDir = ''
let shotSeq = 0
const activePageErrors: string[] = []
const allPageErrors: string[] = []
let activeLedger: MatrixLedger | null = null
let currentCaseId: string | null = null
let currentCaseDir: string | null = null
let activeHeldReject: HeldRejectDialog | null = null
const matrixJournal: MatrixJournal = emptyMatrixJournal()

function log(message: string): void {
  console.log(`[rrm ${new Date().toISOString()}] ${message}`)
}

function guardClick(): void {
  assertClickAllowed(activePageErrors)
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(value, null, 2))
}

/** Durable journal. The current case is updated in place; earlier cases stay. */
async function journal(note?: string): Promise<void> {
  if (activeLedger && currentCaseId) {
    retainCaseJournal(matrixJournal, currentCaseId, activeLedger.all, note)
    if (currentCaseDir) {
      await writeJson(path.join(currentCaseDir, 'ledger.json'), matrixJournal.cases[currentCaseId])
    }
  }
  await writeJson(path.join(evidenceDir, 'matrix-progress.json'), renderMatrixProgress(
    matrixJournal,
    Object.fromEntries(results.map((result) => [result.caseId, result])),
    allPageErrors,
  ))
  await writeJson(path.join(evidenceDir, 'ledger.json'), matrixJournal)
}

async function flushProgress(): Promise<void> {
  await journal('flush')
}

async function caseDir(evidenceRoot: string, row: MatrixRow): Promise<string> {
  const dir = path.join(evidenceRoot, row.profile, row.id)
  await fs.mkdir(path.join(dir, 'screenshots'), { recursive: true })
  await fs.mkdir(path.join(dir, 'videos'), { recursive: true })
  await fs.mkdir(path.join(dir, 'traces'), { recursive: true })
  return dir
}

let videoSeq = 0
async function checkpoint(page: Page, dir: string, label: string): Promise<void> {
  const file = path.join(dir, 'screenshots', `${String(++shotSeq).padStart(4, '0')}-${label.replace(/[^a-z0-9-]/gi, '-')}.png`)
  await page.screenshot({ path: file }) // viewport-only: real in-viewport proof
  log(`screenshot ${path.basename(file)}`)
  await page.waitForTimeout(BROWSER.checkpointMs)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function playwrightMatrixUi(browser: Browser, evidenceRoot: string): MatrixUi & { traces: string[] } {
  const traces: string[] = []
  const newContext = async (row: MatrixRow | null, label: string): Promise<{ context: BrowserContext; page: Page; closeContext: () => Promise<void> }> => {
    const videoDir = path.join(currentCaseDir ?? evidenceRoot, 'videos', `${label.replace(/[^a-z0-9-]/gi, '-')}-${++videoSeq}`)
    await fs.mkdir(videoDir, { recursive: true })
    const context = await browser.newContext({
      viewport: BROWSER.viewport,
      recordVideo: { dir: videoDir },
    })
    const traceBase = row
      ? path.join(evidenceRoot, row.profile, row.id, 'traces', `${label.replace(/[^a-z0-9-]/gi, '-')}-${Date.now()}`)
      : path.join(evidenceRoot, 'traces', `${label.replace(/[^a-z0-9-]/gi, '-')}-${Date.now()}`)
    let page: Page | undefined
    let intentionalClose = false
    return encloseFailedSetup({
      open: async () => ({
        capture: async () => {
          const failedTrace = `${traceBase}-setup-failed.zip`
          await fs.mkdir(path.dirname(failedTrace), { recursive: true })
          let captureError: unknown
          if (page) {
            try {
              await page.screenshot({ path: `${traceBase}-setup-failed.png` })
            } catch (error) {
              captureError = error
            }
          }
          try {
            await context.tracing.stop({ path: failedTrace })
          } catch (error) {
            const extra = error instanceof Error ? error.message : String(error)
            captureError = captureError
              ? new Error(`${captureError instanceof Error ? captureError.message : String(captureError)}; ${extra}`)
              : error
          }
          if (captureError) throw captureError
        },
        close: async () => {
          intentionalClose = true
          await context.close()
        },
      }),
      run: async () => {
        await fs.mkdir(path.dirname(traceBase), { recursive: true })
        await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
        page = await context.newPage()
        page.setDefaultTimeout(30_000)
        page.setDefaultNavigationTimeout(90_000)
        page.on('pageerror', (error: Error) => {
          activePageErrors.push(`${label}: ${error.message}`)
          allPageErrors.push(`${label}: ${error.message}`)
        })
        page.on('close', () => {
          if (!intentionalClose) activePageErrors.push(`${label}: page closed unexpectedly`)
        })
        await page.goto(`${handle.baseUrl}/sign-in`)
        await page.locator('#email').fill(actorEmail(label))
        await page.locator('#password').fill(handle.runtime.e2ePassword)
        await page.getByRole('button', { name: 'Sign in' }).click()
        await page.waitForURL((url) => !url.pathname.includes('/sign-in'))
        const closeContext = async (): Promise<void> => {
          intentionalClose = true
          const tracePath = `${traceBase}.zip`
          let traceError: unknown
          try {
            await finalizeTraceArtifact({
              stop: () => context.tracing.stop({ path: tracePath }),
              exists: async () => fs.stat(tracePath).then((stat) => stat.isFile() && stat.size > 0).catch(() => false),
              tracePath,
              index: traces,
            })
          } catch (error) {
            traceError = error
          } finally {
            try {
              await context.close()
            } catch (closeError) {
              const extra = closeError instanceof Error ? closeError.message : String(closeError)
              traceError = traceError
                ? new Error(`${traceError instanceof Error ? traceError.message : String(traceError)}; context close failed: ${extra}`)
                : closeError
            }
          }
          if (traceError) throw traceError
        }
        return { context, page, closeContext }
      },
    })
  }

  async function openRequest(page: Page, title: string, listPath = '/requests'): Promise<Locator> {
    await page.goto(`${handle.baseUrl}${listPath}`, { waitUntil: 'load' })
    const rowEl = page.getByRole('row', { name: new RegExp(`Open request ${escapeRegExp(title)}`) })
    await expect(rowEl).toBeVisible()
    await rowEl.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Loading request' })).toHaveCount(0)
    return dialog
  }

  function toggleDriver(form: Locator): ToggleDriver {
    const label = form.getByText('Custom Approval Hierarchy', { exact: true })
    return {
      clickSwitch: async () => {
        await label.scrollIntoViewIfNeeded()
        await form.getByRole('switch').click()
      },
      clickUnnamedFinalButton: async () => {
        await label.scrollIntoViewIfNeeded()
        const toggle = label.locator('xpath=../..').getByRole('button')
        await expect(toggle).toHaveCount(1)
        await toggle.click()
      },
      switchChecked: async () => (await form.getByRole('switch').getAttribute('aria-checked')) === 'true'
        || (await form.getByRole('switch').getAttribute('data-state')) === 'checked',
      finalOnVisible: async () => label.locator('xpath=../..').getByText(/^on$/i).isVisible(),
    }
  }

  async function enableCustom(form: Locator, surface: 'solution' | 'resubmit' | 'final'): Promise<void> {
    await enableCustomHierarchy(toggleDriver(form), surface)
  }

  /** Selects and reorders only. The caller enables the surface-correct toggle once. */
  async function pickCustomChain(page: Page, form: Locator, chain: readonly [string, string]): Promise<void> {
    const add = form.locator('[data-picker-open]')
    await expect(add).toBeVisible({ timeout: 20_000 })
    for (const actorId of customChainSelectionClicks(chain)) {
      await add.click()
      const item = form.locator('[data-picker-item]').filter({ hasText: actorEmail(actorId) })
      await expect(item).toBeVisible({ timeout: 20_000 })
      await item.click()
      await expect(form.locator('[data-picker-item]')).toHaveCount(0)
    }
    const firstRow = form.locator('div').filter({ hasText: actorIdEmail(chain[0]) }).filter({ has: page.getByRole('button') }).last()
    const secondRow = form.locator('div').filter({ hasText: actorIdEmail(chain[1]) }).filter({ has: page.getByRole('button') }).last()
    await firstRow.getByRole('button').first().click()
    await page.waitForTimeout(1500)
    const firstBox = await firstRow.boundingBox()
    const secondBox = await secondRow.boundingBox()
    if (!firstBox || !secondBox || !(firstBox.y < secondBox.y)) {
      throw new Error(`custom chain reorder failed (y ${firstBox?.y} !< ${secondBox?.y})`)
    }
  }

  async function findStageBlock(dialog: Locator, stageNumber: number): Promise<Locator> {
    const blocks = dialog.locator('div.flex.flex-col.sm\\:flex-row')
    const count = await blocks.count()
    for (let i = 0; i < count; i++) {
      const b = blocks.nth(i)
      const marker = await b.getByText(/^stage\s*\d$/i).first().innerText().catch(() => null)
      if (marker && new RegExp(`stage\\s*${stageNumber}`, 'i').test(marker.trim())) return b
    }
    throw new Error(`stage ${stageNumber} block not found (case-insensitive)`)
  }

  async function queryRows<T>(sql: string, readQuery?: (sql: string) => Promise<unknown>): Promise<T[]> {
    const parsed = await (readQuery ?? handle.queryReadOnly)(sql)
    if (!Array.isArray(parsed)) throw new Error('evidence query did not return a JSON array')
    return parsed as T[]
  }

  async function requestByTitle(title: string, readQuery?: (sql: string) => Promise<unknown>): Promise<{ id: string; status: string; title: string }> {
    const rows = await queryRows<{ id: string; status: string; title: string }>(requestByTitleSql(title), readQuery)
    if (rows.length !== 1) throw new Error(`request row for '${title}' not found (${rows.length})`)
    return rows[0]
  }

  async function activePhase(phase: Phase, requestId: string, readQuery?: (sql: string) => Promise<unknown>): Promise<ActivePhaseRef> {
    const rows = await queryRows<ActivePhaseRef & { requestId: string }>(activeInstanceSql(phase, requestId), readQuery)
    if (rows.length !== 1) throw new Error(`no active ${phase} instance for request ${requestId}`)
    if (rows[0].phase !== phase || !Number.isInteger(rows[0].attempt) || rows[0].attempt < 1) {
      throw new Error(`active ${phase} instance is not usable: ${JSON.stringify(rows[0])}`)
    }
    return { requestId: rows[0].requestId, instanceId: rows[0].instanceId, attempt: rows[0].attempt, phase }
  }

  async function pendingRows(phase: Phase, instanceId: string): Promise<Array<{ order: number; requiredApproverId: string | null; approverId: string | null; status: string; routingMode?: string }>> {
    return queryRows(pendingChainSql(phase, instanceId))
  }

  async function pendingActors(phase: Phase, instanceId: string): Promise<string[]> {
    const rows = await pendingRows(phase, instanceId)
    return rows.filter((row) => row.status === 'pending' && row.routingMode === 'CUSTOM_PERSON').map((row) => pendingCustomActorId(row))
  }

  async function requestCreateEvidence(title: string): Promise<RequestCreateEvidence> {
    const request = await requestByTitle(title)
    return { requestId: request.id, status: request.status as 'ImprovementRequest', title: request.title }
  }

  async function approvalEvidence(step: Extract<PlanStep, { kind: 'approve' }>, title: string, captured: { requestId: string; instanceId: string; attempt: number; approvalRowId: string }): Promise<ApprovalEvidence> {
    const rows = await queryRows<ApprovalEvidence>(approvalRowSql({
      phase: step.phase,
      requestId: captured.requestId,
      instanceId: captured.instanceId,
      attempt: captured.attempt,
      stepOrder: step.stepOrder,
      actor: step.actor,
      status: 'approved',
      rowId: captured.approvalRowId,
    }))
    if (rows.length !== 1) throw new Error(`no persisted approved ${step.phase} row at pos ${step.stepOrder} by ${step.actor} on ${captured.instanceId}`)
    const evidence = rows[0]
    return {
      phase: step.phase,
      attempt: Number(evidence.attempt),
      stepOrder: step.stepOrder,
      actor: evidence.actor,
      approvalRowId: evidence.approvalRowId,
      requestId: evidence.requestId,
      status: 'approved',
      order: Number(evidence.order),
      instanceId: evidence.instanceId,
    }
  }

  async function solutionSubmitEvidence(title: string, custom: boolean, profile: RouteProfile): Promise<SolutionSubmitEvidence> {
    const request = await requestByTitle(title)
    const active = await activePhase('SOLUTION', request.id)
    const solutionRows = await queryRows<{ id: string }>(latestSolutionSql(request.id))
    if (solutionRows.length !== 1) throw new Error('solution row missing after submission')
    const routeRows = await queryRows<{ routingMode: string; scopeUnitId: string | null }>(instanceRouteSql(active.instanceId))
    const chainRows = await queryRows<ObservedApprovalRow>(pendingChainSql('SOLUTION', active.instanceId))
    return buildSolutionSubmitEvidence({
      request,
      active,
      solutionId: solutionRows[0].id,
      rows: chainRows,
      route: routeRows[0] ?? null,
      custom,
      profile,
    })
  }

  async function rejectionEvidence(row: MatrixRow, title: string, rejector: string, captured: { requestId: string; instanceId: string; attempt: number; approvalRowId: string }): Promise<RejectionEvidence> {
    const request = await requestByTitle(title)
    if (request.id !== captured.requestId) throw new Error('rejection evidence request != pre-click request')
    const rows = await queryRows<{ approvalRowId: string; instanceId: string; actor: string; reason: string; order: number; attempt: number; requestId: string; isFinalApproval?: boolean }>(
      approvalRowSql({
        phase: row.phase,
        requestId: captured.requestId,
        instanceId: captured.instanceId,
        attempt: captured.attempt,
        stepOrder: row.rejectOrder,
        actor: rejector,
        status: 'rejected',
        rowId: captured.approvalRowId,
      }),
    )
    if (rows.length !== 1) throw new Error(`no persisted rejected ${row.phase} row by ${rejector} on captured instance ${captured.instanceId}`)
    const found = rows[0]
    if (found.reason !== row.reason) throw new Error('persisted rejection reason does not match the submitted reason')
    return {
      phase: row.phase,
      requestId: found.requestId,
      rejectionRowId: found.approvalRowId,
      status: request.status as RejectionEvidence['status'],
      actor: found.actor,
      reason: found.reason,
      rejectedRows: 1,
      instanceId: found.instanceId,
      attempt: Number(found.attempt),
      order: Number(found.order),
      isFinalApproval: row.phase === 'FINAL' ? true : row.phase === 'REQUEST' ? false : undefined,
    }
  }

  async function resubmitEvidence(phase: 'REQUEST' | 'SOLUTION', title: string, custom: boolean, readQuery?: (sql: string) => Promise<unknown>): Promise<ResubmitEvidence> {
    const request = await requestByTitle(title, readQuery)
    const active = await activePhase(phase, request.id, readQuery)
    const history = await queryRows<{ instanceId: string; attempt: number; supersededAt: string | null }>(phaseHistorySql(phase, request.id), readQuery)
    const previous = history.filter((item) => item.attempt < active.attempt).sort((a, b) => b.attempt - a.attempt)[0]
    if (!previous) throw new Error('previous attempt is missing from history; it must be captured before revision')
    const chain = await queryRows<ObservedApprovalRow>(pendingChainSql(phase, active.instanceId), readQuery)
    const classified = custom
      ? classifyPendingChain(chain, { routingMode: 'CUSTOM_PERSON', orderedActors: CUSTOM_CHAINS.SOLUTION.map((id) => matrixActorId(id)) })
      : undefined
    return {
      phase,
      requestId: request.id,
      previousAttempt: previous.attempt,
      newAttempt: active.attempt,
      previousInstanceId: previous.instanceId,
      newInstanceId: active.instanceId,
      previousSuperseded: previous.supersededAt !== null,
      carriedApprovals: chain.filter((item) => item.status === 'approved').length,
      customChainIds: classified?.customChainIds,
    }
  }

  async function finalInitiationEvidence(row: MatrixRow, title: string, custom: boolean, expectedAttempt: number): Promise<FinalInitiationEvidence> {
    const request = await requestByTitle(title)
    const active = await activePhase('FINAL', request.id)
    const rows = await queryRows<ObservedApprovalRow>(pendingChainSql('FINAL', active.instanceId))
    const routeRows = await queryRows<{ routingMode: string; scopeUnitId: string | null }>(instanceRouteSql(active.instanceId))
    return buildFinalInitiationEvidence({
      request,
      active,
      rows,
      route: routeRows[0] ?? null,
      custom,
      profile: row.profile,
      expectedAttempt,
    })
  }

  async function completedDbEvidence(requestId: string, bannerSeen: boolean, stage3InViewport: boolean): Promise<CompletedEvidence> {
    const snapshot = await handle.queryReadOnly(terminalSnapshotSql(requestId)) as TerminalSnapshot
    if (snapshot.status !== 'Completed') throw new Error(`observed completed status ${snapshot.status}`)
    return {
      requestId: snapshot.requestId,
      status: snapshot.status,
      requestPendingRows: Number(snapshot.requestPendingRows),
      solutionPendingRows: Number(snapshot.solutionPendingRows),
      finalPendingRows: Number(snapshot.finalPendingRows),
      bannerSeen,
      stage3InViewport,
    }
  }

  async function readSnapshot(title: string): Promise<TerminalSnapshot> {
    const request = await requestByTitle(title)
    const snapshot = await handle.queryReadOnly(terminalSnapshotSql(request.id)) as TerminalSnapshot
    return snapshot
  }

  const ui: MatrixUi & { traces: string[] } = {
    traces,
    hasFailed: () => activePageErrors.length > 0,
    readActivePhase: async (phase, title) => {
      const request = await requestByTitle(title)
      return activePhase(phase, request.id)
    },
    readRequestRef: async (title) => {
      const request = await requestByTitle(title)
      return { requestId: request.id, status: request.status }
    },
    readPublishedRouteProof: async (profile) => {
      const routes = await queryRows<{ phase: Phase; scopeUnitId: string; steps: Array<{ order: number; positionId: string }> }>(publishedRouteProofSql())
      const assignments = await queryRows<{ userId: string; unitId: string; positionId: string }>(activeAssignmentSql())
      return assembleRouteProof(profile, routes, assignments)
    },
    readActionBaseline: async (phase, title, order, expected) => {
      const request = await requestByTitle(title)
      const active = await activePhase(phase, request.id)
      const rows = await queryRows<ObservedApprovalRow>(pendingChainSql(phase, active.instanceId))
      const solutionRows = phase === 'SOLUTION' ? await queryRows<{ id: string }>(latestSolutionSql(request.id)) : []
      return buildActionBaseline({ phase, request, active, rows, order, solutionId: solutionRows[0]?.id ?? null, expected })
    },
    readRevisionBaseline: async (phase, title, expectedState, expectedInstanceId) => {
      const request = await requestByTitle(title)
      const history = await queryRows<{ instanceId: string; attempt: number; supersededAt: string | null }>(phaseHistorySql(phase, request.id))
      const prior = [...history].sort((a, b) => b.attempt - a.attempt)[0]
      const rows = prior ? await queryRows<ObservedApprovalRow>(pendingChainSql(phase, prior.instanceId)) : []
      const solutionRows = phase === 'SOLUTION' ? await queryRows<{ id: string }>(latestSolutionSql(request.id)) : []
      return buildRevisionBaseline({
        phase,
        request,
        history,
        rows: rows.map((row) => ({ ...row, instanceId: prior?.instanceId })),
        solutionId: solutionRows[0]?.id ?? null,
        expectedState,
        expectedInstanceId,
      })
    },
    readTerminalSnapshot: async (_row, title) => readSnapshot(title),

    async createRequest(row, title) {
      const { context, page, closeContext } = await newContext(row, FIXTURE_ACTORS.requesterA)
      try {
        guardClick()
        await page.goto(`${handle.baseUrl}/requests`)
        await page.getByRole('button', { name: 'New Request' }).click()
        const form = page.getByRole('dialog')
        await expect(form.getByRole('heading', { name: 'Submit New Request' })).toBeVisible()
        await form.locator('#title').fill(title)
        const editor = form.locator('[contenteditable="true"]').first()
        await editor.click()
        await editor.fill(`Rejection matrix ${row.id}: reject ${row.phase} position ${row.rejectOrder} (${row.chainKind}), recover to Completed.`)
        await checkpoint(page, currentCaseDir ?? evidenceRoot, `${row.id}-request-form`)
        guardClick()
        await form.getByRole('button', { name: 'Submit Request' }).click()
        await expect(page.getByText('Request created successfully')).toBeVisible({ timeout: 30_000 })
        await closeContext()
        const evidence = await requestCreateEvidence(title)
        assertRequestCreateEvidence(evidence)
        return JSON.stringify(evidence)
      } catch (error) {
        return failClosed(page, error, closeContext)
      }
    },

    async approveStep(row, step, title, baseline) {
      const { context, page, closeContext } = await newContext(row, step.actor)
      try {
        await page.goto(`${handle.baseUrl}/requests/my-actions`)
        const rowEl = page.getByRole('row', { name: new RegExp(`Open request ${escapeRegExp(title)}`) })
        await expect(rowEl).toBeVisible()
        await rowEl.click()
        const dialog = page.getByRole('dialog')
        await expect(dialog).toBeVisible()
        if (step.phase === 'SOLUTION') {
          // SOLUTION approvals are ONE direct "Approve Solution" mutation.
          await expect(dialog.getByRole('button', { name: 'Approve Solution' })).toHaveCount(1)
          await dialog.getByRole('button', { name: 'Approve Solution' }).scrollIntoViewIfNeeded()
          await page.waitForTimeout(BROWSER.checkpointMs)
          guardClick()
          await dialog.getByRole('button', { name: 'Approve Solution' }).click()
        } else {
          await expect(dialog.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(1)
          await dialog.getByRole('button', { name: 'Approve', exact: true }).scrollIntoViewIfNeeded()
          await page.waitForTimeout(BROWSER.checkpointMs)
          guardClick()
          await dialog.getByRole('button', { name: 'Approve', exact: true }).click()
          await expect(page.getByRole('button', { name: 'Confirm Approval' })).toBeVisible()
          guardClick()
          await page.getByRole('button', { name: 'Confirm Approval' }).click()
        }
        await expect(page.getByText('Approved successfully', { exact: true })).toBeVisible({ timeout: 30_000 })
        await closeContext()
        const evidence = await approvalEvidence(step, title, baseline)
        assertApprovalEvidence(evidence, {
          phase: baseline.phase,
          attempt: baseline.attempt,
          stepOrder: baseline.order,
          actor: step.actor,
          requestId: baseline.requestId,
          instanceId: baseline.instanceId,
        })
        return JSON.stringify(evidence)
      } catch (error) {
        return failClosed(page, error, closeContext)
      }
    },

    async submitSolution(row, title, custom, priorRequest) {
      const { context, page, closeContext } = await newContext(row, FIXTURE_ACTORS.engineerA)
      try {
        guardClick()
        await page.goto(`${handle.baseUrl}/requests`)
        const rowEl = page.getByRole('row', { name: new RegExp(`Open request ${escapeRegExp(title)}`) })
        await expect(rowEl).toBeVisible()
        await rowEl.click()
        const requestDialog = page.getByRole('dialog')
        await requestDialog.getByRole('button', { name: 'Submit Solution' }).click()
        const form = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Submit Engineering Solution' }) })
        await expect(form).toBeVisible()
        await form.locator('#solutionTitle').fill(`Solution ${row.id}`)
        const editor = form.locator('[contenteditable="true"]').first()
        await editor.click()
        await editor.fill(`Matrix solution ${row.id}`)
        await form.locator('#cost').fill('100')
        await form.locator('#timeline').fill('5 days')
        if (custom) {
          await enableCustom(form, 'solution')
          await pickCustomChain(page, form, CUSTOM_CHAINS.SOLUTION)
        }
        await checkpoint(page, currentCaseDir ?? evidenceRoot, `${row.id}-solution-form`)
        guardClick()
        await form.getByRole('button', { name: 'Submit Solution' }).click()
        await expect(page.getByText('Solution submitted successfully')).toBeVisible({ timeout: 30_000 })
        await closeContext()
        const evidence = await solutionSubmitEvidence(title, custom, row.profile)
        if (!priorRequest) throw new Error('submitSolution requires the pre-click request id')
        if (!evidence.observedInstanceId) throw new Error('solution submit did not return the observed instance id')
        assertSolutionSubmitEvidence(evidence, {
          requestId: priorRequest.requestId,
          instanceId: evidence.observedInstanceId,
          attempt: 1,
          customChainIds: custom ? CUSTOM_CHAINS.SOLUTION.map((id) => matrixActorId(id)) : undefined,
        })
        if (evidence.requestId !== priorRequest.requestId) throw new Error('solution evidence request != pre-click request')
        return JSON.stringify(evidence)
      } catch (error) {
        return failClosed(page, error, closeContext)
      }
    },

    async rejectCurrentStep(row, title, baseline) {
      const rejector = row.orderedActorIds[row.rejectOrder - 1]
      const { context, page, closeContext } = await newContext(row, rejector)
      try {
        await page.goto(`${handle.baseUrl}/requests/my-actions`)
        const rowEl = page.getByRole('row', { name: new RegExp(`Open request ${escapeRegExp(title)}`) })
        await expect(rowEl).toBeVisible()
        await rowEl.click()
        const dialog = page.getByRole('dialog')
        await expect(dialog).toBeVisible()
        const rejectButton = row.phase === 'SOLUTION' ? 'Reject Solution' : 'Reject'
        const placeholder = row.phase === 'SOLUTION' ? /rejecting this solution/i : /explain the reason/i
        await dialog.getByRole('button', { name: rejectButton, exact: true }).click()
        const confirm = page.getByRole('button', { name: 'Confirm Rejection' })
        await expect(confirm).toBeVisible()
        await expect(confirm).toBeDisabled() // REQUIRED blank-reason guard
        const reasonField = page.getByPlaceholder(placeholder)
        await expect(reasonField).toBeVisible()
        await checkpoint(page, currentCaseDir ?? evidenceRoot, `${row.id}-pre-reject-${rejector}`)
        await reasonField.fill(row.reason)
        guardClick()
        await confirm.click()
        await expect(page.getByText('Rejected successfully', { exact: true })).toBeVisible({ timeout: 30_000 })
        await closeContext()
        const evidence = await rejectionEvidence(row, title, rejector, {
          requestId: baseline.requestId,
          instanceId: baseline.instanceId,
          attempt: baseline.attempt,
          approvalRowId: baseline.approvalRowId,
        })
        assertRejectionEvidence(evidence, {
          phase: baseline.phase,
          requestId: baseline.requestId,
          status: expectedPostRejectStatus(row.phase),
          actor: rejector,
          reason: row.reason,
          order: baseline.order,
          instanceId: baseline.instanceId,
          attempt: baseline.attempt,
        })
        return JSON.stringify(evidence)
      } catch (error) {
        return failClosed(page, error, closeContext)
      }
    },

    async openHeldRejectDialog(row, title, baseline) {
      const rejector = row.orderedActorIds[row.rejectOrder - 1]
      const opened = await newContext(row, rejector)
      return encloseFailedSetup({
        open: async () => ({
          capture: async () => {
            const shot = path.join(currentCaseDir ?? evidenceRoot, 'failures', `${row.id}-held-setup.png`)
            await fs.mkdir(path.dirname(shot), { recursive: true })
            await opened.page.screenshot({ path: shot })
          },
          close: () => opened.closeContext(),
        }),
        run: async () => {
          const { page, closeContext } = opened
          await page.goto(`${handle.baseUrl}/requests/my-actions`)
          const rowEl = page.getByRole('row', { name: new RegExp(`Open request ${escapeRegExp(title)}`) })
          await expect(rowEl).toBeVisible()
          await rowEl.click()
          const dialog = page.getByRole('dialog')
          await expect(dialog).toBeVisible()
          const rejectButton = row.phase === 'SOLUTION' ? 'Reject Solution' : 'Reject'
          await dialog.getByRole('button', { name: rejectButton, exact: true }).click()
          const confirm = page.getByRole('button', { name: 'Confirm Rejection' })
          await expect(confirm).toBeVisible()
          const reasonField = page.getByPlaceholder(row.phase === 'SOLUTION' ? /rejecting this solution/i : /explain the reason/i)
          await reasonField.fill(`HELD stale dialog ${row.id}`)
          let closed = false
          const held: HeldRejectDialog = {
            target: {
              instanceId: baseline.instanceId,
              attempt: baseline.attempt,
              stepOrder: baseline.order,
              actor: row.orderedActorIds[row.rejectOrder - 1],
              approvalRowId: baseline.approvalRowId,
            },
            confirmAvailable: async () => (await confirm.isVisible()) && (await confirm.isEnabled()),
            staleConfirm: async () => {
              if (!(await confirm.isVisible().catch(() => false))) {
                return { outcome: 'unavailable', evidence: 'held confirm is not available' }
              }
              guardClick()
              await confirm.click()
              const deadline = Date.now() + 15_000
              let denied = false
              let succeeded = false
              while (Date.now() < deadline) {
                denied = await page.getByText('An error occurred while rejecting').isVisible().catch(() => false)
                succeeded = await page.getByText('Rejected successfully', { exact: true }).isVisible().catch(() => false)
                if (denied || succeeded) break
                await page.waitForTimeout(250)
              }
              if (succeeded) return { outcome: 'succeeded', evidence: 'Rejected successfully toast observed' }
              if (!denied) return { outcome: 'unknown', evidence: 'no denial toast and no success toast' }
              return { outcome: 'denied', evidence: 'denial toast; terminal/instance/audit snapshot compared before and after' }
            },
            close: async () => {
              if (closed) return
              closed = true
              await closeContext()
            },
          }
          activeHeldReject = held
          return held
        },
      })
    },

    async resubmit(row, phase, custom, title, baseline, deps?: {
      newContext?: (row: MatrixRow | null, label: string) => Promise<{ context: BrowserContext; page: Page; closeContext: () => Promise<void> }>
      baseUrl?: string
      queryReadOnly?: (sql: string) => Promise<unknown>
      opener?: { openerVisible?: (open: Locator, timeoutMs: number) => Promise<void> }
    }): Promise<string> {
      const actorId = phase === 'REQUEST' ? FIXTURE_ACTORS.requesterA : FIXTURE_ACTORS.engineerA
      const { context, page, closeContext } = await (deps?.newContext ?? newContext)(row, actorId)
      const readQuery = deps?.queryReadOnly ?? ((sql: string) => handle.queryReadOnly(sql))
      try {
        guardClick()
        await page.goto(`${deps?.baseUrl ?? handle.baseUrl}/requests`)
        const rowEl = page.getByRole('row', { name: new RegExp(`Open request ${escapeRegExp(title)}`) })
        await expect(rowEl).toBeVisible()
        await rowEl.click()
        const dialog = page.getByRole('dialog')
        await expect(dialog).toBeVisible()
        if (phase === 'REQUEST') {
          await expect(dialog.getByRole('heading', { name: 'Resubmit Request' })).toBeVisible()
          const editor = dialog.locator('[contenteditable="true"]').first()
          await editor.click()
          await editor.fill(`Corrected request ${row.id} (recovery attempt)`)
          guardClick()
          await dialog.getByRole('button', { name: 'Resubmit Request' }).click()
          await expect(page.getByText('Request resubmitted successfully')).toBeVisible({ timeout: 30_000 })
        } else {
          // The resubmit form may already be open; only click the opener when
          // the form is not visible yet.
          let form = page.getByRole('dialog', { name: /Resubmit Solution/ })
          const open = dialog.getByRole('button', { name: 'Resubmit Solution' })
          await ensureResubmitSolutionOpenerReadyAndOpen({ form, open, deps: deps?.opener })
          await expect(form).toBeVisible()
          const editor = form.locator('[contenteditable="true"]').first()
          await editor.click()
          await editor.fill(`Revised solution ${row.id} (Engineering redesign)`)
          await form.locator('#cost').fill('200')
          await form.locator('#timeline').fill('8 days')
          if (custom) {
            await enableCustom(form, 'resubmit')
            await pickCustomChain(page, form, CUSTOM_CHAINS.SOLUTION)
          }
          guardClick()
          await form.getByRole('button', { name: 'Resubmit Solution' }).click()
          await expect(page.getByText('Solution resubmitted successfully')).toBeVisible({ timeout: 30_000 })
        }
        await closeContext()
        const evidence = await resubmitEvidence(phase, title, custom, readQuery)
        assertResubmitEvidence(evidence, {
          requestId: baseline.requestId,
          previousAttempt: baseline.attempt,
          previousInstanceId: baseline.instanceId,
          customChainIds: custom ? CUSTOM_CHAINS.SOLUTION.map((id) => matrixActorId(id)) : undefined,
        })
        return JSON.stringify(evidence)
      } catch (error) {
        return failClosed(page, error, closeContext)
      }
    },

    async initiateFinal(row, title, custom, _priorRequest, expectedAttempt) {
      const { context, page, closeContext } = await newContext(row, FIXTURE_ACTORS.requesterA)
      try {
        const priorRequest = await requestByTitle(title)
        guardClick()
        await page.goto(`${handle.baseUrl}/requests`)
        const rowEl = page.getByRole('row', { name: new RegExp(`Open request ${escapeRegExp(title)}`) })
        await expect(rowEl).toBeVisible()
        await rowEl.click()
        const requestDialog = page.getByRole('dialog')
        await requestDialog.getByRole('button', { name: 'Submit Final Approval' }).click()
        const form = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Initiate Final Approval' }) })
        await expect(form).toBeVisible()
        if (custom) {
          await enableCustom(form, 'final')
          await pickCustomChain(page, form, CUSTOM_CHAINS.FINAL)
        }
        await checkpoint(page, currentCaseDir ?? evidenceRoot, `${row.id}-final-form`)
        guardClick()
        await form.getByRole('button', { name: 'Start Final Approval' }).click()
        await expect(page.getByText('Final approval initiated successfully')).toBeVisible({ timeout: 30_000 })
        await closeContext()
        const evidence = await finalInitiationEvidence(row, title, custom, expectedAttempt)
        proveFinalInitiation(evidence, {
          requestId: priorRequest.id,
          instanceId: evidence.observedInstanceId ?? evidence.instanceId,
          attempt: expectedAttempt,
          routingMode: custom ? 'CUSTOM_PERSON' : 'SNAPSHOT_GROUP',
          routeSource: custom ? 'CUSTOM_PERSON' : expectedRouteSource(row.profile, 'FINAL'),
          orderedActorIds: custom ? CUSTOM_CHAINS.FINAL.map((id) => matrixActorId(id)) : RANK_CHAINS[row.profile].FINAL.map((id) => matrixActorId(id)),
          customChainIds: custom ? CUSTOM_CHAINS.FINAL.map((id) => matrixActorId(id)) : undefined,
        })
        return JSON.stringify(evidence)
      } catch (error) {
        return failClosed(page, error, closeContext)
      }
    },

    async checkReviserControl(row, title) {
      const { context, page, closeContext } = await newContext(row, row.reviser)
      try {
        await page.goto(`${handle.baseUrl}/requests`)
        const rowEl = page.getByRole('row', { name: new RegExp(`Open request ${escapeRegExp(title)}`) })
        await expect(rowEl).toBeVisible()
        await rowEl.click()
        const dialog = page.getByRole('dialog')
        const control = row.phase === 'REQUEST' ? 'Resubmit Request' : 'Resubmit Solution'
        await expect(dialog.getByRole('button', { name: control })).toBeVisible()
        await checkpoint(page, currentCaseDir ?? evidenceRoot, `${row.id}-reviser-control-${row.reviser}`)
        await closeContext()
        return `${row.reviser} has ${control}`
      } catch (error) {
        return failClosed(page, error, closeContext)
      }
    },

    async checkUnauthorizedViewer(row, title) {
      const { context, page, closeContext } = await newContext(row, FIXTURE_ACTORS.staffB)
      try {
        await page.goto(`${handle.baseUrl}/requests`)
        const rowEl = page.getByRole('row', { name: new RegExp(`Open request ${escapeRegExp(title)}`) })
        await expect(rowEl).toBeVisible()
        await rowEl.click()
        const dialog = page.getByRole('dialog')
        await expect(dialog.getByRole('button', { name: /Resubmit/ })).toHaveCount(0)
        await expect(dialog.getByRole('button', { name: /^Approve/ })).toHaveCount(0)
        await expect(dialog.getByRole('button', { name: /Reject/ })).toHaveCount(0)
        await checkpoint(page, currentCaseDir ?? evidenceRoot, `${row.id}-unauthorized-readonly`)
        await closeContext()
        return 'unauthorized viewer read-only (loaded-list visibility only; no direct-link claim)'
      } catch (error) {
        return failClosed(page, error, closeContext)
      }
    },

    async verifyCompleted(row, title) {
      const { context, page, closeContext } = await newContext(row, FIXTURE_ACTORS.requesterA)
      try {
        guardClick()
        await page.goto(`${handle.baseUrl}/requests`)
        const rowEl = page.getByRole('row', { name: new RegExp(`Open request ${escapeRegExp(title)}`) })
        await expect(rowEl.getByText('Completed', { exact: true })).toBeVisible()
        await rowEl.click()
        const dialog = page.getByRole('dialog')
        // The dialog opens on a loading skeleton first; wait for the loaded banner.
        const bannerSeen = await expect(dialog.getByText('Final Approval Completed'))
          .toBeVisible({ timeout: 30_000 })
          .then(() => true, () => false)
        if (!bannerSeen) throw new Error('Final Approval Completed banner was not visible')
        const stage3 = await findStageBlock(dialog, 3)
        await stage3.scrollIntoViewIfNeeded()
        const stageBox = await stage3.boundingBox()
        const viewport = page.viewportSize()
        const stage3InViewport = Boolean(stageBox && viewport && stageBox.y >= 0 && stageBox.y < viewport.height)
        if (!stage3InViewport) throw new Error('stage 3 is not in the viewport')
        await page.waitForTimeout(BROWSER.checkpointMs)
        await page.screenshot({ path: path.join(currentCaseDir ?? evidenceRoot, 'screenshots', `completed-stage3-inviewport-${Date.now()}.png`) })
        await closeContext()
        const request = await requestByTitle(title)
        const evidence = await completedDbEvidence(request.id, bannerSeen, stage3InViewport)
        assertCompletedEvidence(evidence)
        return JSON.stringify(evidence)
      } catch (error) {
        return failClosed(page, error, closeContext)
      }
    },
  }
  return ui
}

export async function failClosed(
  page: Page | { screenshot(opts: { path: string }): Promise<unknown> },
  error: unknown,
  cleanup: () => Promise<void>,
  io?: { mkdir(dir: string, opts?: { recursive?: boolean }): Promise<unknown>; writeFile(file: string, body: string): Promise<unknown> },
): Promise<never> {
  const files = io ?? fs
  let failure: unknown = error
  const dir = path.join(currentCaseDir ?? evidenceDir, 'failures')
  const shot = path.join(dir, `context-${Date.now()}.png`)
  try {
    try {
      await files.mkdir(dir, { recursive: true })
      try {
        await page.screenshot({ path: shot })
      } catch (shotError) {
        try {
          await files.writeFile(path.join(dir, 'screenshot-failed.txt'), shotError instanceof Error ? shotError.message : String(shotError))
        } catch (writeError) {
          const shotText = shotError instanceof Error ? shotError.message : String(shotError)
          const writeText = writeError instanceof Error ? writeError.message : String(writeError)
          failure = new Error(`${failure instanceof Error ? failure.message : String(failure)}; screenshot failed: ${shotText}; screenshot record failed: ${writeText}`)
        }
      }
    } catch (writeError) {
      failure = new Error(`${failure instanceof Error ? failure.message : String(failure)}; artifact write failed: ${writeError instanceof Error ? writeError.message : String(writeError)}`)
    }
  } finally {
    try {
      await cleanup()
    } catch (cleanupError) {
      failure = new Error(`${failure instanceof Error ? failure.message : String(failure)}; cleanup failure: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`)
    }
  }
  throw failure
}

async function rethrowWithCleanup(error: unknown, cleanup: () => Promise<void>): Promise<never> {
  try {
    await cleanup()
  } catch (cleanupError) {
    const original = error instanceof Error ? error.message : String(error)
    const extra = cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
    throw new Error(`${original}; cleanup failure: ${extra}`)
  }
  throw error
}

export interface ScopedCaptureOutcome {
  errors: readonly string[]
  payload?: unknown
}

/** Single session-level caller gate around exactly one matrix case: runs the
 *  case, captures the required scoped evidence, records failure artifacts,
 *  attempts the final progress flush and decides the CaseResult. Required
 *  scoped evidence must persist with zero errors BEFORE a case is marked or
 *  logged as passed; otherwise the case fails, failure artifacts are attempted
 *  with the combined error, and the combined error propagates so no further
 *  case can run (session runtime and browser cleanup still execute
 *  unconditionally in the session enclosure). The failure path throws the
 *  primary error COMBINED with retained capture errors — never the original
 *  alone. The final progress flush runs INSIDE the gate on every completed
 *  case outcome, so a flush failure can never replace the pending gate error
 *  (the previous `finally { await flushProgress() }` in the loop did exactly
 *  that): flush failures are appended to the propagated error, and a flush
 *  failure after a green run still fails the case and stops the session. */
export async function runCaseWithEvidenceGate(input: {
  caseId: string
  result: CaseResult
  runCase: () => Promise<{ staleNegative: CaseResult['staleNegative'] }>
  captureEvidence: (outcome: 'passed' | 'failed' | 'ambiguous') => Promise<ScopedCaptureOutcome>
  recordFailureArtifacts: (error: Error, captured: ScopedCaptureOutcome) => Promise<void>
  flushProgress: () => Promise<void>
  log: (line: string) => void
}): Promise<void> {
  const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))
  const safeCapture = async (outcome: 'passed' | 'failed' | 'ambiguous'): Promise<ScopedCaptureOutcome> => {
    try {
      return await input.captureEvidence(outcome)
    } catch (error) {
      return { errors: [`capture crashed: ${message(error)}`] }
    }
  }
  const safeFlush = async (): Promise<string> => {
    try {
      await input.flushProgress()
      return ''
    } catch (error) {
      return `; progress flush failed: ${message(error)}`
    }
  }
  const preserveAndThrow = async (combined: Error, captured: ScopedCaptureOutcome, flushAttempted: boolean): Promise<never> => {
    let artifactNote = ''
    try {
      await input.recordFailureArtifacts(combined, captured)
    } catch (artifactError) {
      artifactNote = `; failure artifact write failed: ${message(artifactError)}`
    }
    const flushNote = flushAttempted ? '' : await safeFlush()
    throw new Error(`${combined.message}${artifactNote}${flushNote}`)
  }
  let green: { staleNegative: CaseResult['staleNegative'] } | null = null
  let primaryError: unknown = null
  try {
    green = await input.runCase()
  } catch (error) {
    primaryError = error
  }
  if (primaryError !== null || green === null) {
    const primaryMessage = primaryError !== null ? message(primaryError) : 'runCase returned no outcome'
    input.result.status = 'failed'
    input.result.error = primaryMessage
    input.log(`CASE ${input.caseId} FAILED: ${primaryMessage}`)
    const captured = await safeCapture(primaryMessage.includes('unknown') ? 'ambiguous' : 'failed')
    const combined = captured.errors.length > 0
      ? new Error(`${primaryMessage}; ${captured.errors.join('; ')}`)
      : primaryError instanceof Error ? primaryError : new Error(primaryMessage)
    await preserveAndThrow(combined, captured, false)
  }
  const captured = await safeCapture('passed')
  if (captured.errors.length > 0) {
    const combined = new Error(`${input.caseId} ran green but required scoped evidence did not persist: ${captured.errors.join('; ')}`)
    input.result.status = 'failed'
    input.result.error = combined.message
    input.log(`CASE ${input.caseId} FAILED: ${combined.message}`)
    await preserveAndThrow(combined, captured, false)
  }
  const flushNote = await safeFlush()
  if (flushNote) {
    const combined = new Error(`${input.caseId} ran green but the final progress flush failed${flushNote}`)
    input.result.status = 'failed'
    input.result.error = combined.message
    input.log(`CASE ${input.caseId} FAILED: ${combined.message}`)
    await preserveAndThrow(combined, captured, true)
  }
  input.result.status = 'passed'
  input.result.staleNegative = (green as { staleNegative: CaseResult['staleNegative'] }).staleNegative
  input.log(`CASE ${input.caseId} PASSED`)
}

export const RESUBMIT_OPENER_READINESS_TIMEOUT_MS = 30_000

/** The request dialog may still show its loading skeleton when the recovery
 *  resubmit step opens it: the opener renders only after the modal data
 *  resolves. The Playwright default expect budget (5s) raced exactly that
 *  latency in profile-2 RRM-023, so the opener readiness uses an explicit
 *  bounded budget instead. This seam OWNS the single opener click: returns
 *  without touching anything when the resubmit form is already open
 *  (identical isVisible().catch(() => false) branch as before), otherwise
 *  waits the bounded budget and clicks the opener exactly once. No retry,
 *  polling, or extra click semantics live here; ledger/correlation are
 *  untouched. */
export async function ensureResubmitSolutionOpenerReadyAndOpen(input: {
  form: Locator
  open: Locator
  deps?: {
    formVisible?: (form: Locator) => Promise<boolean>
    openerVisible?: (open: Locator, timeoutMs: number) => Promise<void>
    click?: (open: Locator) => Promise<void>
  }
}): Promise<void> {
  const formVisible = input.deps?.formVisible ?? ((form: Locator) => form.isVisible().catch(() => false))
  if (await formVisible(input.form)) return
  const openerVisible = input.deps?.openerVisible ??
    ((open: Locator, timeoutMs: number) => expect(open).toBeVisible({ timeout: timeoutMs }))
  const click = input.deps?.click ?? ((open: Locator) => open.click())
  await openerVisible(input.open, RESUBMIT_OPENER_READINESS_TIMEOUT_MS)
  await click(input.open)
}

function actorEmail(actorId: string): string {
  try {
    return matrixActorEmail(fixtureActorIdFromMatrix(actorId))
  } catch {
    return matrixActorEmail(actorId)
  }
}

function actorIdEmail(actorId: string): string {
  return actorEmail(actorId)
}

async function main(): Promise<void> {
  const options = parseOptions()
  evidenceDir = path.join(options.evidenceRoot, options.routesConfig, 'runtime')
  await fs.mkdir(evidenceDir, { recursive: true })
  const allRows = buildInventory()
  // State-machine validation of EVERY selected plan before any runtime exists.
  for (const row of allRows) validateCasePlan(row, buildCasePlan(row))
  const staleChecks = buildStaleNegativeChecks(allRows)
  const rows = allRows.filter(
    (r) => r.profile === options.routesConfig && (!options.caseIds || options.caseIds.includes(r.id)),
  )
  if (rows.length === 0) throw new Error('no matching inventory rows')
  log(`profile ${options.routesConfig}: ${rows.length} selected case(s); all plans state-machine validated; co-candidate verification ${LIVE_CO_CANDIDATE_VERIFICATION}`)
  await journal('startup')

  handle = await startMatrixRuntime({
    routesConfig: options.routesConfig,
    log,
    seedCleared: options.seedCleared,
    artifactCapture: async (note) => { await journal(`runtime artifact capture (${note})`) },
  })
  handle.setArtifactCapture(async () => {
    await journal('pre-stop artifact capture')
    const mailFile = path.join(evidenceDir, 'mail.json')
    const messages = handle.mail?.messages() ?? []
    await fs.writeFile(mailFile, JSON.stringify(messages, null, 2))
    // The run root (with next-dev.log) is deleted after a clean stop; keep the log tail for diagnosis.
    await copyLogTail(path.join(handle.runtime.paths.logsDir, 'next-dev.log'), path.join(evidenceDir, 'next-dev.log'))
      .catch((error: unknown) => log(`app log tail not kept: ${error instanceof Error ? error.message : String(error)}`))
    const aggregatePath = path.join(options.evidenceRoot, 'all-profiles.json')
    let existing: Record<string, unknown> = {}
    try {
      existing = JSON.parse(await fs.readFile(aggregatePath, 'utf8')) as Record<string, unknown>
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(`all-profiles aggregate is unreadable: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const next = retainProfileAggregate(existing, options.routesConfig, {
      mailFile,
      cases: results.map((result) => result.caseId),
      updatedAt: new Date().toISOString(),
    })
    await fs.writeFile(aggregatePath, JSON.stringify(next, null, 2))
  })
  let traces: string[] = []
  await runOwnedMatrixSession({
    handle,
    log,
    launchBrowser: () => chromium.launch({ headless: BROWSER.headless, slowMo: BROWSER.slowMo }),
    run: async (browser) => {
      const ui = playwrightMatrixUi(browser as Browser, options.evidenceRoot)
      traces = ui.traces
      const captureCaseEvidence = async (caseId: string, title: string, outcome: 'passed' | 'failed' | 'ambiguous') => {
        const unresolved = activeLedger?.all.find((entry) => entry.stage === 'attempting')
        let requestId = 'missing-request'
        try {
          const found = await handle.queryReadOnly(requestByTitleSql(title))
          if (Array.isArray(found) && found[0] && typeof found[0] === 'object' && 'id' in found[0]) requestId = String(found[0].id)
        } catch (error) {
          requestId = `lookup-failed:${error instanceof Error ? error.message : String(error)}`
        }
        const aggregatePath = path.join(options.evidenceRoot, 'all-profiles.json')
        const casePath = path.join(currentCaseDir ?? evidenceDir, outcome === 'passed' ? 'business-evidence.json' : path.join('failures', 'business-evidence.json'))
        return persistScopedCaseEvidence({
          requestId,
          profile: options.routesConfig,
          caseId,
          outcome,
          unresolvedTarget: unresolved?.instanceId && unresolved.rowId && unresolved.phase && unresolved.attempt
            ? { instanceId: unresolved.instanceId, attempt: unresolved.attempt, approvalRowId: unresolved.rowId, phase: unresolved.phase }
            : null,
          query: (sql) => handle.queryReadOnly(sql),
          readAggregate: () => fs.readFile(aggregatePath, 'utf8').catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return ''
            throw error
          }),
          writeAggregate: (body) => fs.writeFile(aggregatePath, body),
          writeCase: async (body) => {
            await fs.mkdir(path.dirname(casePath), { recursive: true })
            await fs.writeFile(casePath, body)
          },
          cleanup: () => journal(`evidence cleanup ${caseId}`),
        })
      }
      for (const row of rows) {
        currentCaseId = row.id
        currentCaseDir = await caseDir(options.evidenceRoot, row)
        const title = `RRM ${row.id} ${row.profile} ${row.phase} pos${row.rejectOrder} ${Date.now()}`
        const result: CaseResult = { caseId: row.id, requestTitle: title, status: 'failed' }
        results.push(result)
        activeLedger?.assertNoUnresolvedAttempting()
        const ledger = new MatrixLedger()
        activeLedger = ledger
        retainCaseJournal(matrixJournal, row.id, ledger.all, 'case-start')
        await runCaseWithEvidenceGate({
          caseId: row.id,
          result,
          runCase: () => runMatrixCase(row, ui, ledger, journal, title),
          captureEvidence: (outcome) => captureCaseEvidence(row.id, title, outcome),
          recordFailureArtifacts: async (failureError, captured) => {
            let mailText = ''
            try { mailText = JSON.stringify(handle.mail?.messages() ?? []) } catch (mailError) {
              mailText = `mail capture failed: ${mailError instanceof Error ? mailError.message : String(mailError)}`
            }
            await writeFailureArtifacts({
              dir: path.join(currentCaseDir ?? evidenceDir, 'failures'),
              label: row.id,
              error: failureError,
              dbText: JSON.stringify(captured.payload),
              auditText: JSON.stringify((captured.payload as { activities?: unknown }).activities ?? captured.payload),
              notificationText: JSON.stringify((captured.payload as { notifications?: unknown }).notifications ?? captured.payload),
              mailText,
              progressText: JSON.stringify({ runId: handle.runtime.runId, dataDir: handle.runtime.paths.dataDir, databasePort: handle.runtime.ports.databasePort, journal: matrixJournal }),
            })
            await journal(`FAILED case ${row.id}`)
            const failedLines = await Promise.all(ui.traces.map(async (trace) => {
              const stat = await fs.stat(trace).catch(() => null)
              return stat?.isFile() && stat.size > 0 ? `PASSED ${trace}` : `FAILED ${trace}`
            }))
            await fs.writeFile(path.join(evidenceDir, 'traces-index.txt'), failedLines.join('\n'))
          },
          flushProgress,
          log,
        })
      }
      const lines: string[] = []
      for (const trace of ui.traces) {
        const stat = await fs.stat(trace).catch(() => null)
        lines.push(stat?.isFile() && stat.size > 0 ? `PASSED ${trace}` : `FAILED ${trace}`)
      }
      await fs.writeFile(path.join(evidenceDir, 'traces-index.txt'), lines.join('\n'))
      if (lines.some((line) => line.startsWith('FAILED '))) throw new Error(`trace index contains missing artifacts: ${lines.filter((line) => line.startsWith('FAILED ')).join('; ')}`)
      log(`MATRIX PASSED: ${results.length} case(s) on ${options.routesConfig}.`)
    },
  })
  if (activeHeldReject) await activeHeldReject.close()
  void traces
  void staleChecks
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
