import path from 'node:path'

export interface ManualDemoAccess {
  runId: string
  root: string
  databasePort: number
  postmasterPid: number
  password: string
}

/** Fail closed before launching a browser or changing any request. Never load .env. */
export function validateManualDemoAccess(value: unknown): asserts value is ManualDemoAccess {
  if (!value || typeof value !== 'object') throw new Error('SAFETY: missing demo identity')
  const data = value as Partial<ManualDemoAccess>
  if (typeof data.runId !== 'string' || !/^business-test-\d{8}t\d{6}-[a-z0-9-]+$/.test(data.runId)) {
    throw new Error('SAFETY: not an owned demo run')
  }
  if (typeof data.root !== 'string' || !path.isAbsolute(data.root) ||
      !path.basename(data.root).startsWith(`${data.runId}-`)) {
    throw new Error('SAFETY: foreign runtime directory')
  }
  if (typeof data.databasePort !== 'number' || !Number.isInteger(data.databasePort) ||
      data.databasePort < 1024 || data.databasePort > 65535 || [3100, 5432].includes(data.databasePort)) {
    throw new Error('SAFETY: not an isolated database port')
  }
  if (typeof data.postmasterPid !== 'number' || !Number.isSafeInteger(data.postmasterPid) || data.postmasterPid < 1) {
    throw new Error('SAFETY: missing postmaster identity')
  }
  if (typeof data.password !== 'string' || !data.password.startsWith('business-e2e-') || data.password.length < 20) {
    throw new Error('SAFETY: only generated demo credentials are allowed')
  }
}

/** A command cannot skip/repeat topics, or revive a failed run as a pass. */
export function assertTopicCanContinue(state: { status: string; nextTopic: number | null }, topic: number): void {
  if (state.status !== 'paused' || state.nextTopic !== topic) {
    throw new Error('Cannot continue: run must be paused at exactly the requested next topic')
  }
}

/** Recheck a passed topic after an expired pause; never import its pass or replay creation. */
export function validateTopicOneRecheck(value: unknown, runId: string): asserts value is {
  requestTitle: string
} {
  if (!value || typeof value !== 'object') throw new Error('Cannot recheck: missing previous run')
  const state = value as {
    status?: string; currentTopic?: number; runId?: string; requestTitle?: string
    pageErrors?: unknown[]; results?: Array<{ topic?: number; status?: string }>
  }
  if (!['failed', 'paused', 'stopped'].includes(state.status ?? '') || state.currentTopic !== 1 ||
      state.runId !== runId || !state.requestTitle?.startsWith('Headed PD1 H1 ') ||
      !Array.isArray(state.pageErrors) || state.pageErrors.length !== 0 ||
      !Array.isArray(state.results) || state.results.length !== 1 ||
      state.results[0].topic !== 1 || state.results[0].status !== 'passed') {
    throw new Error('Cannot recheck: only a passed Topic 1 from this same demo is eligible')
  }
}
