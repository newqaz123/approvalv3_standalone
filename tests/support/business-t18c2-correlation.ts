/**
 * Browser-recorded T18C2 identity (test-only).
 *
 * T18C2 (all steps vacant → auto-completion) performs NO destructive
 * mutation after creation, so the exact unique title alone — matched against
 * exactly one persisted request — is sufficient identity. The browser test
 * writes this small dedicated file into the runner evidence directory (no
 * DATABASE_URL, no Flight-response provenance needed); the runner-owned
 * read-only DB evaluator reads it back and correlates the exact title with
 * the persisted REQUEST instance before asserting the vacancy outcome.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

export const T18C2_BROWSER_CORRELATION_FILE = 't18c2-browser-correlation.json'

export interface T18c2BrowserCorrelation {
  /** Exact title returned by uniqueBusinessTitle('T18C2'), not a prefix. */
  requestTitle: string
}

export type T18c2CorrelationRead =
  | { status: 'present'; correlation: T18c2BrowserCorrelation }
  | { status: 'missing' }
  | { status: 'corrupt' }

const TITLE_PREFIX = 'Business T18C2 '

export function parseT18c2BrowserCorrelation(raw: string): T18c2CorrelationRead {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return { status: 'corrupt' }
  }
  if (parsed === null || typeof parsed !== 'object') return { status: 'corrupt' }
  const record = parsed as { requestTitle?: unknown }
  if (typeof record.requestTitle !== 'string') return { status: 'corrupt' }
  const requestTitle = record.requestTitle.trim()
  if (!requestTitle.startsWith(TITLE_PREFIX) || requestTitle.slice(TITLE_PREFIX.length).trim() === '') {
    return { status: 'corrupt' }
  }
  return { status: 'present', correlation: { requestTitle } }
}

export async function writeT18c2BrowserCorrelation(
  evidenceDir: string,
  correlation: T18c2BrowserCorrelation,
): Promise<void> {
  const parsed = parseT18c2BrowserCorrelation(JSON.stringify(correlation))
  if (parsed.status !== 'present') {
    throw new Error('T18C2 browser correlation must be an exact unique request title')
  }
  await fs.mkdir(evidenceDir, { recursive: true })
  await fs.writeFile(
    path.join(evidenceDir, T18C2_BROWSER_CORRELATION_FILE),
    JSON.stringify(parsed.correlation),
    { encoding: 'utf8', mode: 0o600 },
  )
}

export async function readT18c2BrowserCorrelation(evidenceDir: string): Promise<T18c2CorrelationRead> {
  try {
    const raw = await fs.readFile(path.join(evidenceDir, T18C2_BROWSER_CORRELATION_FILE), 'utf8')
    return parseT18c2BrowserCorrelation(raw)
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : ''
    if (code === 'ENOENT') return { status: 'missing' }
    return { status: 'corrupt' }
  }
}
