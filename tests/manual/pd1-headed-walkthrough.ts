import { chromium, expect, type Page } from '@playwright/test'
import { promises as fs, existsSync, watch } from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  createRequestViaUi, openRequestByTitle, approveCurrentStepViaUi,
  submitSolutionViaUi, initiateFinalApprovalViaUi, signIn,
} from '../business-e2e/business-flow-helpers'
import { validateManualDemoAccess, assertTopicCanContinue, validateTopicOneRecheck } from '../support/manual-pd1-headed-policy'

/** Manual demo ONLY. No migrations, reseeding, .env loading, API mutation or SMTP configuration. */
const BASE_URL = 'http://localhost:3100'
const TOPICS = [
  'Create an H1 request and verify its PD1 origin and approval candidates',
  'Pending request visibility: H1/H2, PD2 members, shared Department Manager, Factory Manager',
  'Approve the request in order: H1 Supervisor → PD1 Section Manager → Production Department Manager',
  'Sent to Engineering visibility and Engineer 1 solution submission',
  'Solution-pending visibility and ordered Engineering approvals',
  'Original requester initiates normal final approval; check visibility',
  'Final approvals through the PD1 branch; check Completed visibility',
] as const
const VISIBLE = ['h1-staff2', 'h2-staff1', 'h2-supervisor', 'production-department-manager', 'factory-manager']
const DENIED = ['pd2-staff1', 'pd2-staff2']
const REQUEST_APPROVERS = ['h1-supervisor', 'pd1-section-manager', 'production-department-manager']
const SOLUTION_APPROVERS = ['engineering-supervisor', 'engineering-section-manager', 'engineering-manager']

type Result = { topic: number; title: string; status: 'passed' | 'failed'; checks: string[]; error?: string }
type RunState = {
  status: 'running' | 'paused' | 'failed' | 'completed' | 'stopped'
  nextTopic: number | null; currentTopic: number; requestTitle: string; runId: string
  results: Result[]; pageErrors: string[]; pid: number
}
const [command, dirArg, extra] = process.argv.slice(2)
if (!dirArg || !['--start', '--recheck', '--continue', '--stop'].includes(command)) {
  console.error('Usage: tsx tests/manual/pd1-headed-walkthrough.ts --start <evidence-dir> [access-json]\n' +
    '       tsx tests/manual/pd1-headed-walkthrough.ts --recheck <fresh-evidence-dir> <prior-evidence-dir>\n' +
    '       tsx tests/manual/pd1-headed-walkthrough.ts --continue <evidence-dir> <topic-number>\n' +
    '       tsx tests/manual/pd1-headed-walkthrough.ts --stop <evidence-dir>')
  process.exit(2)
}
const dir = path.resolve(dirArg)
const stateFile = path.join(dir, 'run-state.json')

async function saveState(state: RunState): Promise<void> {
  await fs.writeFile(`${stateFile}.tmp`, JSON.stringify(state, null, 2), { mode: 0o600 })
  await fs.rename(`${stateFile}.tmp`, stateFile)
}

/** Explicit marker gate: neither a timeout nor an error can advance the next topic. */
async function waitForCommand(topic: number | null): Promise<'continue' | 'stop'> {
  const continuation = topic === null ? null : path.join(dir, `continue-${topic}`)
  const stop = path.join(dir, 'stop')
  return new Promise((resolve, reject) => {
    const watcher = watch(dir, check)
    const timer = setTimeout(() => { watcher.close(); reject(new Error('Owner pause expired after 24 hours')) }, 24 * 60 * 60_000)
    function check() {
      if (existsSync(stop)) { clearTimeout(timer); watcher.close(); resolve('stop') }
      else if (continuation && existsSync(continuation)) { clearTimeout(timer); watcher.close(); resolve('continue') }
    }
    check()
  })
}

async function control(): Promise<void> {
  const state = JSON.parse(await fs.readFile(stateFile, 'utf8')) as RunState
  if (command === '--continue') {
    const topic = Number(extra)
    assertTopicCanContinue(state, topic)
    await fs.writeFile(path.join(dir, `continue-${topic}`), '', { flag: 'wx', mode: 0o600 })
    console.log(`Released topic ${topic}: ${TOPICS[topic - 1]}`)
  } else {
    await fs.writeFile(path.join(dir, 'stop'), '', { flag: 'wx', mode: 0o600 })
    console.log('Stop requested; the current topic may finish before the browser closes.')
  }
}

async function start(): Promise<void> {
  const accessFile = command === '--recheck' ? '/tmp/approval-corrected-org-access.json' : extra ?? '/tmp/approval-corrected-org-access.json'
  const rawAccess: unknown = JSON.parse(await fs.readFile(accessFile, 'utf8'))
  validateManualDemoAccess(rawAccess)
  const access = rawAccess
  let previousRequestTitle: string | undefined
  if (command === '--recheck') {
    if (!extra) throw new Error('Cannot recheck: prior evidence directory is required')
    const previous: unknown = JSON.parse(await fs.readFile(path.join(path.resolve(extra), 'run-state.json'), 'utf8'))
    validateTopicOneRecheck(previous, access.runId)
    previousRequestTitle = previous.requestTitle
  }
  // Verify exact live isolated postmaster identity without connecting to any database.
  const pidLines = (await fs.readFile(path.join(access.root, 'pgdata', 'postmaster.pid'), 'utf8')).split('\n')
  if (Number(pidLines[0]) !== access.postmasterPid ||
      await fs.realpath(pidLines[1]) !== await fs.realpath(path.join(access.root, 'pgdata')) ||
      Number(pidLines[3]) !== access.databasePort) throw new Error('SAFETY: demo postmaster identity changed')
  const pgCommand = execFileSync('ps', ['-p', String(access.postmasterPid), '-o', 'command='], { encoding: 'utf8' })
  if (!pgCommand.includes(`-D ${path.join(access.root, 'pgdata')}`)) throw new Error('SAFETY: foreign postgres process')
  const listener = execFileSync('lsof', ['-nP', '-tiTCP:3100', '-sTCP:LISTEN'], { encoding: 'utf8' }).trim()
  if (!/^\d+$/.test(listener)) throw new Error('SAFETY: missing or ambiguous app listener')
  const appCwd = execFileSync('lsof', ['-a', '-p', listener, '-d', 'cwd', '-Fn'], { encoding: 'utf8' })
  const cwd = await fs.realpath(process.cwd())
  if (!appCwd.split('\n').includes(`n${cwd}`) || !cwd.endsWith('/.worktrees/organization-approval-redesign')) {
    throw new Error('SAFETY: port 3100 is not serving the redesign worktree')
  }
  let ancestor = listener
  let demoLauncher = false
  for (let i = 0; i < 6 && ancestor !== '1'; i++) {
    const commandLine = execFileSync('ps', ['-p', ancestor, '-o', 'command='], { encoding: 'utf8' })
    if (commandLine.includes('/tmp/approval-corrected-org-demo.cts')) { demoLauncher = true; break }
    ancestor = execFileSync('ps', ['-p', ancestor, '-o', 'ppid='], { encoding: 'utf8' }).trim()
  }
  if (!demoLauncher) throw new Error('SAFETY: listener lacks the explicitly isolated demo launcher')
  await fs.mkdir(dir, { recursive: true, mode: 0o700 })
  if (existsSync(stateFile)) throw new Error('Use a fresh evidence directory; do not overwrite a prior run')
  await fs.mkdir(path.join(dir, 'screenshots'), { mode: 0o700 })
  const state: RunState = {
    status: 'running', currentTopic: 0, nextTopic: null, runId: access.runId,
    requestTitle: previousRequestTitle ?? `Headed PD1 H1 ${new Date().toISOString()}`,
    results: [], pageErrors: [], pid: process.pid,
  }
  await saveState(state)
  const browser = await chromium.launch({ headless: false, slowMo: 1200 })
  const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1440, height: 1000 } })
  const page: Page = await context.newPage()
  page.setDefaultTimeout(30_000)
  page.setDefaultNavigationTimeout(90_000)
  page.on('pageerror', error => { state.pageErrors.push(error.message) })
  let shotNumber = 0
  let checks: string[] = []
  let currentActor = ''
  async function checkpoint(label: string) {
    const filename = `${String(++shotNumber).padStart(3, '0')}-${label.replace(/[^a-z0-9-]/gi, '-').slice(0, 130)}.png`
    await page.screenshot({ path: path.join(dir, 'screenshots', filename), fullPage: true })
    // Deliberate viewing pause, not a substitute for readiness assertions.
    await page.waitForTimeout(4000)
  }
  async function actor(id: string) {
    currentActor = id
    console.log(`  Account: ${id}@demo.test`)
    await context.clearCookies()
    await signIn(page, `${id}@demo.test`, access.password)
    await page.bringToFront()
  }
  async function list() {
    await page.goto('/requests', { waitUntil: 'load' })
    await expect(page.getByRole('heading', { name: 'Requests', exact: true })).toBeVisible()
    await expect(page.getByPlaceholder('Search title or description...')).toBeVisible()
    return page.getByRole('row', { name: `Open request ${state.requestTitle}`, exact: true })
  }
  async function visibility(stage: string) {
    for (const id of VISIBLE) {
      await actor(id)
      const row = await list()
      await expect(row).toBeVisible()
      const dialog = await openRequestByTitle(page, state.requestTitle)
      await expect(dialog.getByRole('heading', { name: state.requestTitle, exact: true })).toBeVisible()
      // Sharing/viewing alone must not turn these users into the CURRENT approver.
      await expect(dialog.getByRole('button', { name: /^(Approve|Approve Solution)$/ })).toHaveCount(0)
      checks.push(`${stage}: ${id} can read list/detail, but cannot approve the current step`)
      await checkpoint(`${stage}-${id}-visible`)
    }
    for (const id of DENIED) {
      await actor(id)
      await expect(await list()).toHaveCount(0)
      checks.push(`${stage}: ${id} cannot see the request in the loaded list`)
      await checkpoint(`${stage}-${id}-denied`)
    }
  }
  async function rowStatus(label: string) {
    const row = await list()
    await expect(row).toBeVisible()
    await expect(row.getByText(label, { exact: true })).toBeVisible()
    checks.push(`Request row status: ${label}`)
  }
  const actions = [
    async () => {
      await actor('h1-staff1')
      if (!previousRequestTitle) {
        await createRequestViaUi(page, checkpoint, state.requestTitle, 'H1 team request: watch shared PD1 visibility, isolated PD2 visibility and Engineering solution workflow.')
      } else {
        console.log('  Rechecking the existing request; no new request will be created.')
      }
      const row = await list()
      await expect(row.getByText('Improvement Request', { exact: true })).toBeVisible()
      await expect(row.getByText('PD1 Section', { exact: true })).toBeVisible()
      const dialog = await openRequestByTitle(page, state.requestTitle)
      for (const name of ['H1 Supervisor', 'PD1 Section Manager', 'Production Department Manager']) {
        await expect(dialog.getByText(name, { exact: true }).first()).toBeVisible()
      }
      await expect(dialog.getByText('H2 Supervisor', { exact: true })).toHaveCount(0)
      checks.push('PD1 Section origin and H1/Section/shared Department Manager candidates; H2 Supervisor absent')
      await checkpoint('topic-1-created-request-chain')
    },
    async () => { await visibility('request-pending') },
    async () => {
      for (const id of REQUEST_APPROVERS) {
        await actor(id)
        await approveCurrentStepViaUi(page, state.requestTitle)
        checks.push(`REQUEST current step approved by ${id}`)
        await checkpoint(`request-approved-${id}`)
      }
      await rowStatus('Sent to Engineer')
    },
    async () => {
      await visibility('sent-to-engineering')
      await actor('engineer1')
      await submitSolutionViaUi(page, checkpoint, state.requestTitle, {
        title: 'Headed Engineering Solution', description: 'Engineering solution for the PD1 H1 request.', cost: '1000', timeline: '7 days',
      })
      checks.push('Engineer 1 submitted the normal solution through the UI')
      await checkpoint('engineering-solution-submitted')
    },
    async () => {
      await visibility('solution-pending')
      for (const id of SOLUTION_APPROVERS) {
        await actor(id)
        const dialog = await openRequestByTitle(page, state.requestTitle, '/requests/my-actions')
        await dialog.getByRole('button', { name: 'Approve Solution', exact: true }).click()
        await expect(page.getByText('Approved successfully', { exact: true })).toBeVisible()
        checks.push(`SOLUTION current step approved by ${id}`)
        await checkpoint(`solution-approved-${id}`)
      }
      await actor('h1-staff1')
      await rowStatus('Send Back to Requester')
    },
    async () => {
      await actor('h1-staff1')
      await initiateFinalApprovalViaUi(page, state.requestTitle)
      await rowStatus('Final Approval')
      checks.push('Original H1 requester initiated normal Final approval')
      await visibility('final-pending')
    },
    async () => {
      for (const id of REQUEST_APPROVERS) {
        await actor(id)
        await approveCurrentStepViaUi(page, state.requestTitle)
        checks.push(`FINAL current step approved by ${id}`)
        await checkpoint(`final-approved-${id}`)
      }
      await rowStatus('Completed')
      await visibility('completed')
    },
  ]
  try {
    for (let i = 0; i < actions.length; i++) {
      state.currentTopic = i + 1; state.status = 'running'; state.nextTopic = null
      checks = []
      await saveState(state)
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
      console.log(`TOPIC ${i + 1}: ${TOPICS[i]}`)
      try {
        await actions[i]()
        expect(state.pageErrors, 'No unhandled browser exceptions').toEqual([])
        state.results.push({ topic: i + 1, title: TOPICS[i], status: 'passed', checks: [...checks] })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        state.results.push({ topic: i + 1, title: TOPICS[i], status: 'failed', checks: [...checks], error: `${currentActor}: ${message}` })
        state.status = 'failed'; state.nextTopic = null
        await checkpoint(`FAILED-topic-${i + 1}`).catch(() => undefined)
        throw error
      } finally {
        await context.tracing.stop({ path: path.join(dir, `topic-${i + 1}-trace.zip`) })
        await saveState(state)
      }
      state.status = i === actions.length - 1 ? 'completed' : 'paused'
      state.nextTopic = i === actions.length - 1 ? null : i + 2
      await saveState(state)
      console.log(`${state.status.toUpperCase()}: topic ${i + 1} passed. ${state.nextTopic ? `Awaiting explicit continue for topic ${state.nextTopic}.` : 'Awaiting stop; browser remains open.'}`)
      const action = await waitForCommand(state.nextTopic)
      if (action === 'stop') { if (state.status !== 'completed') state.status = 'stopped'; break }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    if (state.status !== 'failed') state.status = 'failed'
    state.nextTopic = null
    await saveState(state)
    console.error('FAILED: no further topic will run. Browser stays open for inspection; use --stop.')
    await waitForCommand(null).catch(() => undefined)
    process.exitCode = 1
  } finally {
    await saveState(state)
    await context.close()
    await browser.close()
  }
}

(['--start', '--recheck'].includes(command) ? start() : control()).catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
