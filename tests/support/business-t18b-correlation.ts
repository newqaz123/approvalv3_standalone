/**
 * Browser-recorded T18B identity (test-only).
 *
 * The stranded-attempt list renders phase/attempt/origin only — not the
 * created request title — so an origin filter cannot prove which request was
 * restarted. The browser writes this file into the runner evidence directory
 * (no DATABASE_URL). The runner-owned read-only projection reads it back and
 * correlates the exact title with the selected old instance id.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

export const T18B_RESTART_REASON =
  'T18B: all saved approvers were inactive; Production 1 manager replaced by the spare to unblock the stranded attempt.'

export const T18B_BROWSER_CORRELATION_FILE = 't18b-browser-correlation.json'

export interface T18bBrowserCorrelation {
  /** Exact title returned by uniqueBusinessTitle('T18B'), not a prefix. */
  requestTitle: string
  /** requestId from the createRequest result, matched to the stranded row before restart. */
  requestId: string
  /** data-testid suffix of the stranded row that was actually restarted. */
  oldInstanceId: string
}

export type T18bCorrelationRead =
  | { status: 'present'; correlation: T18bBrowserCorrelation }
  | { status: 'missing' }
  | { status: 'corrupt' }

export function parseT18bBrowserCorrelation(raw: string): T18bCorrelationRead {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return { status: 'corrupt' }
  }
  if (parsed === null || typeof parsed !== 'object') return { status: 'corrupt' }
  const record = parsed as { requestTitle?: unknown; requestId?: unknown; oldInstanceId?: unknown }
  if (typeof record.requestTitle !== 'string' || typeof record.requestId !== 'string' || typeof record.oldInstanceId !== 'string') {
    return { status: 'corrupt' }
  }
  const requestTitle = record.requestTitle.trim()
  const requestId = record.requestId.trim()
  const oldInstanceId = record.oldInstanceId.trim()
  if (!requestTitle.startsWith('Business T18B ') || requestTitle === 'Business T18B') {
    return { status: 'corrupt' }
  }
  if (requestId.length === 0 || requestId.includes(' ') || requestId.startsWith('origin')) {
    return { status: 'corrupt' }
  }
  if (oldInstanceId.length === 0 || oldInstanceId.includes(' ') || oldInstanceId.startsWith('origin')) {
    return { status: 'corrupt' }
  }
  return { status: 'present', correlation: { requestTitle, requestId, oldInstanceId } }
}

const CREATE_REQUEST_FILE = 'server-actions/requests.ts'
const CREATE_REQUEST_EXPORT = 'createRequest'
const ACTION_ENTRY_LOADER_MARKER = 'next-flight-action-entry-loader.js?actions='

export interface CreateRequestActionObservation {
  actionId: string | null
  postData: string | null
  responseBytes: Uint8Array
}

/** Resolve createRequest's id from this run's server-reference manifest. Never reads encryptionKey. */
export function readCreateRequestActionId(manifestText: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(manifestText)
  } catch {
    throw new Error('createRequest action id is not available')
  }
  const node = (parsed as { node?: unknown } | null)?.node
  if (!node || typeof node !== 'object') throw new Error('createRequest action id is not available')
  const ids = new Set<string>()
  for (const entry of Object.values(node as Record<string, { workers?: unknown }>)) {
    const workers = entry?.workers
    if (!workers || typeof workers !== 'object') continue
    for (const worker of Object.values(workers as Record<string, { moduleId?: unknown }>)) {
      if (typeof worker?.moduleId !== 'string') continue
      for (const registered of decodeActionExports(worker.moduleId)) {
        if (registered.filename === CREATE_REQUEST_FILE && registered.exportName === CREATE_REQUEST_EXPORT) {
          ids.add(registered.id)
        }
      }
    }
  }
  if (ids.size !== 1) throw new Error('createRequest action id is not available')
  return [...ids][0]
}

function decodeActionExports(moduleId: string): Array<{ id: string; filename: string; exportName: string }> {
  let decoded: string
  try {
    decoded = decodeURIComponent(moduleId)
  } catch {
    return []
  }
  const marker = decoded.indexOf(ACTION_ENTRY_LOADER_MARKER)
  if (marker === -1) return []
  const query = decoded.slice(marker + ACTION_ENTRY_LOADER_MARKER.length).split('&')[0]
  let actions: unknown
  try {
    actions = JSON.parse(query)
  } catch {
    return []
  }
  if (!Array.isArray(actions)) return []
  const out: Array<{ id: string; filename: string; exportName: string }> = []
  for (const group of actions) {
    if (!Array.isArray(group) || group.length < 2 || !Array.isArray(group[1])) continue
    for (const entry of group[1] as Array<{ id?: unknown; filename?: unknown; exportedName?: unknown }>) {
      if (typeof entry?.id !== 'string' || typeof entry.filename !== 'string' || typeof entry.exportedName !== 'string') continue
      out.push({ id: entry.id, filename: entry.filename, exportName: entry.exportedName })
    }
  }
  return out
}

function actionBodyHasExactTitle(postData: string | null, expectedTitle: string): boolean {
  if (!postData) return false
  let parsed: unknown
  try {
    parsed = JSON.parse(postData)
  } catch {
    return false
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed[0] === null || typeof parsed[0] !== 'object') return false
  return (parsed[0] as { title?: unknown }).title === expectedTitle
}

const MAX_ACTION_ROWS = 8
// Hard bound on any response handed to the framing scan. A real createRequest
// Flight body (small action result plus a revalidated tree) is far below this;
// anything larger is treated as undecodable instead of scanned.
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024
const DECODE_FAILED = 'createRequest action result could not be decoded'

// Installed react-server-dom-webpack wire framing (client.node.development.js
// processBinaryChunk states 0-4): a row is `<hex-id>:` followed either by a
// length-prefixed raw payload (tag in this set: hex byte length up to `,`, then
// EXACTLY that many bytes, no terminator) or by a newline-terminated payload.
// Length rows may contain `\n` or any raw bytes; the next row starts immediately
// with no delimiter. Playwright's `response.body()` yields those exact bytes,
// so the scan below works on Uint8Array — a JS-string skip would mis-frame
// multi-byte UTF-8 payloads (e.g. 'é' is one UTF-16 unit but two UTF-8 bytes).
const LENGTH_TAG_BYTES = new Set<number>([...'TAOoUSsLlGgMmV'].map((tag) => tag.charCodeAt(0)))

function isHexDigitByte(byte: number): boolean {
  return (byte >= 0x30 && byte <= 0x39) || (byte >= 0x41 && byte <= 0x46) || (byte >= 0x61 && byte <= 0x66)
}

function hexDigitValue(byte: number): number {
  return byte >= 0x61 ? byte - 0x57 : byte >= 0x41 ? byte - 0x37 : byte - 0x30
}

function isModelPayloadByte(byte: number | undefined): boolean {
  return byte === 0x7b || byte === 0x5b || byte === 0x22 || byte === 0x6e || byte === 0x74 || byte === 0x66 || byte === 0x2d
    || (byte !== undefined && byte >= 0x30 && byte <= 0x39)
}

const flightJsonDecoder = new TextDecoder('utf-8', { fatal: true })

function decodeFlightText(payload: Uint8Array): string {
  return flightJsonDecoder.decode(payload)
}

const flightUtf8Encoder = new TextEncoder()

interface FlightRow {
  hex: string
  payload: Uint8Array
}

/** Fixed reason tokens for a framing-scan failure; the only varying words in a diagnostic. */
type FlightScanReason =
  | 'eof-before-colon'
  | 'empty-id'
  | 'invalid-id-digit'
  | 'id-overflow'
  | 'id-not-canonical'
  | 'eof-after-colon'
  | 'invalid-length-digit'
  | 'length-overflow'
  | 'eof-before-length-comma'
  | 'eof-before-control-newline'
  | 'length-past-eof'
  | 'duplicate-row-id'

/** Framing category of the last fully framed row. Fixed tokens only. */
type FlightScanLastRow = 'none' | 'length' | 'newline'

/**
 * Fail closed with a bounded structural diagnostic: a fixed reason token plus
 * finite numeric counters (buffer byte length, failing offset, rows framed,
 * last row framing category, declared payload length for length-tag rows).
 * No buffer bytes, decoded characters, titles/payload text, headers, or
 * underlying error text ever enter the message, and its size is fixed-bounded
 * (a handful of `key=<number>` fields), so the propagated error stays safe to
 * persist as spec evidence.
 */
function flightScanFailure(input: {
  reason: FlightScanReason
  bytes: Uint8Array
  offset: number
  rows: number
  last: FlightScanLastRow
  declaredLength?: number
}): never {
  let message = `${DECODE_FAILED} (flight-scan reason=${input.reason} off=${input.offset} len=${input.bytes.length} rows=${input.rows} last=${input.last}`
  if (input.declaredLength !== undefined) message += ` declared=${input.declaredLength}`
  throw new Error(`${message})`)
}

function canonicalRowId(raw: string): number | null {
  if (!/^[0-9a-f]+$/i.test(raw)) return null
  const id = Number.parseInt(raw, 16)
  return Number.isSafeInteger(id) ? id : null
}

function isDebugRecord(payload: Uint8Array): boolean {
  return payload[0] === 0x44 && isModelPayloadByte(payload[1])
}

function referencedRowId(value: string): number | null {
  if (value.length < 2 || value[0] !== '$' || value === '$') return null
  const hex = value[1] === '@' ? value.slice(2) : value.slice(1)
  if (!/^[0-9a-f]+$/i.test(hex)) return null
  return canonicalRowId(hex)
}

/**
 * Byte-exact Flight framing scan over the raw action-response bytes: hex row
 * id, then either the installed length-tag set (exact byte-count skip) or a
 * newline-terminated row. Omitted-ID control records (`:N` time origin, `:W`
 * console forward, `:H` hint — the only forms the installed DEV serializer
 * emits without a row id) are consumed and dropped before the value-map and
 * duplicate checks; any other `:`-leading tag stays fail-closed. Truncated
 * headers/payloads, non-hex ids or lengths, duplicate VALUE rows, and responses
 * over MAX_RESPONSE_BYTES fail closed;
 * every framing failure throws a bounded structural diagnostic (see
 * flightScanFailure) with no buffer content in the message.
 */
function scanFlightRows(bytes: Uint8Array): Map<number, FlightRow> {
  const rows = new Map<number, FlightRow>()
  let i = 0
  let last: FlightScanLastRow = 'none'
  while (i < bytes.length) {
    if (bytes[i] === 0x0a) {
      i += 1
      continue
    }
    const idStart = i
    let id = 0
    while (i < bytes.length && bytes[i] !== 0x3a) {
      if (!isHexDigitByte(bytes[i])) throw flightScanFailure({ reason: 'invalid-id-digit', bytes, offset: i, rows: rows.size, last })
      id = id * 16 + hexDigitValue(bytes[i])
      if (id > Number.MAX_SAFE_INTEGER) throw flightScanFailure({ reason: 'id-overflow', bytes, offset: i, rows: rows.size, last })
      i += 1
    }
    if (i === bytes.length || i === idStart) {
      if (i === idStart) {
        // Installed DEV serializer control records with an omitted row id. Only
        // N/W/H are allowlisted; every other `:`-tag (unknown or empty) falls
        // through to the fail-closed throw below. The record must be fully
        // newline-framed before eof, and it is dropped here so it never reaches
        // the value map, the duplicate check, or the re-encoded slice.
        const controlTag = i + 1 < bytes.length ? bytes[i + 1] : -1
        if (controlTag === 0x4e || controlTag === 0x57 || controlTag === 0x48) {
          const newline = bytes.indexOf(0x0a, i + 2)
          if (newline === -1) throw flightScanFailure({ reason: 'eof-before-control-newline', bytes, offset: i, rows: rows.size, last })
          i = newline + 1
          last = 'newline'
          continue
        }
      }
      throw flightScanFailure({
        reason: i === bytes.length ? 'eof-before-colon' : 'empty-id',
        bytes,
        offset: i,
        rows: rows.size,
        last,
      })
    }
    const hex = String.fromCharCode(...bytes.subarray(idStart, i))
    if (canonicalRowId(hex) === null) throw flightScanFailure({ reason: 'id-not-canonical', bytes, offset: i, rows: rows.size, last })
    const tagPos = i + 1
    if (tagPos >= bytes.length) throw flightScanFailure({ reason: 'eof-after-colon', bytes, offset: tagPos, rows: rows.size, last })
    const tag = bytes[tagPos]
    let payload: Uint8Array
    if (LENGTH_TAG_BYTES.has(tag)) {
      i = tagPos + 1
      let length = 0
      let sawComma = false
      while (i < bytes.length) {
        const byte = bytes[i]
        i += 1
        if (byte === 0x2c) {
          sawComma = true
          break
        }
        if (!isHexDigitByte(byte)) throw flightScanFailure({ reason: 'invalid-length-digit', bytes, offset: i, rows: rows.size, last })
        length = length * 16 + hexDigitValue(byte)
        if (length > MAX_RESPONSE_BYTES) throw flightScanFailure({ reason: 'length-overflow', bytes, offset: i, rows: rows.size, last, declaredLength: length })
      }
      if (!sawComma || i + length > bytes.length) {
        throw flightScanFailure({
          reason: sawComma ? 'length-past-eof' : 'eof-before-length-comma',
          bytes,
          offset: i,
          rows: rows.size,
          last,
          declaredLength: length,
        })
      }
      payload = bytes.subarray(tagPos, i + length)
      i += length
      last = 'length'
    } else {
      const newlineTagged = (tag >= 0x41 && tag <= 0x5a) || tag === 0x23 || tag === 0x72 || tag === 0x78
      i = newlineTagged ? tagPos + 1 : tagPos
      const newline = bytes.indexOf(0x0a, i)
      payload = bytes.subarray(tagPos, newline === -1 ? bytes.length : newline)
      i = newline === -1 ? bytes.length : newline + 1
      last = 'newline'
    }
    if (isDebugRecord(payload)) continue
    if (rows.has(id)) throw flightScanFailure({ reason: 'duplicate-row-id', bytes, offset: i, rows: rows.size, last })
    rows.set(id, { hex, payload })
  }
  return rows
}
export const CREATE_REQUEST_READ_DEADLINE_MS = 15_000

/**
 * Keep only the root action field and the model rows it references, preserving
 * every kept row's payload bytes exactly. Module `I` rows belonging to a
 * revalidated `.f` tree are omitted so the installed decoder is not asked to
 * load UI modules. A reference from `a` into a module or T/binary row fails
 * closed; unrelated T/binary rows (which may embed newlines and sit flush
 * against the next row) are skipped by byte count.
 */
export function sliceActionResultFlight(responseBytes: Uint8Array): Uint8Array {
  if (responseBytes.byteLength > MAX_RESPONSE_BYTES) throw new Error(DECODE_FAILED)
  const rows = scanFlightRows(responseBytes)
  const root = rows.get(0)
  if (!root || !isModelPayloadByte(root.payload[0])) throw new Error(DECODE_FAILED)
  let rootJson: unknown
  try {
    rootJson = JSON.parse(decodeFlightText(root.payload))
  } catch {
    throw new Error(DECODE_FAILED)
  }
  if (!rootJson || typeof rootJson !== 'object' || !('a' in rootJson)) {
    throw new Error(DECODE_FAILED)
  }
  const needed = new Map<number, FlightRow>([[0, root]])
  const queue: unknown[] = [(rootJson as { a: unknown }).a]
  while (queue.length > 0) {
    const value = queue.shift()
    if (typeof value === 'string') {
      const id = referencedRowId(value)
      if (id === null || needed.has(id)) continue
      const row = rows.get(id)
      if (!row || !isModelPayloadByte(row.payload[0])) throw new Error(DECODE_FAILED)
      if (needed.size >= MAX_ACTION_ROWS) throw new Error(DECODE_FAILED)
      needed.set(id, row)
      try {
        queue.push(JSON.parse(decodeFlightText(row.payload)))
      } catch {
        throw new Error(DECODE_FAILED)
      }
      continue
    }
    if (Array.isArray(value)) {
      queue.push(...value)
      continue
    }
    if (value && typeof value === 'object') queue.push(...Object.values(value))
  }
  const slicedRoot = { ...(rootJson as Record<string, unknown>), f: null }
  const parts: Uint8Array[] = [flightUtf8Encoder.encode(`0:${JSON.stringify(slicedRoot)}\n`)]
  for (const [id, row] of needed) {
    if (id === 0) continue
    parts.push(flightUtf8Encoder.encode(`${row.hex}:`), row.payload, flightUtf8Encoder.encode('\n'))
  }
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const sliced = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    sliced.set(part, offset)
    offset += part.byteLength
  }
  return sliced
}

async function decodeFlightActionResult(responseBytes: Uint8Array): Promise<unknown> {
  const sliced = sliceActionResultFlight(responseBytes)
  const { createRequire } = await import('node:module')
  const { ReadableStream: NodeReadableStream } = await import('node:stream/web')
  const require = createRequire(path.join(process.cwd(), 'package.json'))
  const client = require('next/dist/compiled/react-server-dom-webpack/client.node.js') as {
    createFromReadableStream: (
      stream: ReadableStream,
      options: { serverConsumerManifest: { moduleMap: Record<string, never>; moduleLoading: { prefix: string; crossOrigin: null }; serverModuleMap: null } },
    ) => Promise<{ a?: unknown }>
  }
  const stream = new NodeReadableStream({
    start(controller) {
      controller.enqueue(sliced)
      controller.close()
    },
  })
  let decoded: { a?: unknown }
  try {
    decoded = await client.createFromReadableStream(stream as unknown as ReadableStream, {
      serverConsumerManifest: {
        moduleMap: {},
        moduleLoading: { prefix: '', crossOrigin: null },
        serverModuleMap: null,
      },
    })
  } catch {
    throw new Error('createRequest action result could not be decoded')
  }
  const result = decoded?.a
  return result && typeof (result as { then?: unknown }).then === 'function' ? await (result as Promise<unknown>) : result
}

export interface ResponseBodySource {
  headers(): Record<string, string>
  request(): { headers(): Record<string, string>; postData(): string | null }
  /** Raw response bytes (Playwright `Response#body`), never decoded as lossy text: Flight rows are byte-length framed. */
  body(): Promise<Uint8Array>
}

type ReadOutcome =
  | { status: 'bytes'; bytes: Uint8Array }
  | { status: 'rejected' }
  | { status: 'deadline' }

export type CreateRequestReadKind = 'rejected' | 'deadline'

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('createRequest response read deadline exceeded')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/**
 * Arm a response observer before the creation submit. Each body read is
 * converted to a nonrejecting outcome in the same turn, settlement is
 * bounded, secondary read failures are recorded as they settle (even while
 * the creation callback is still pending), and the listener is always
 * removed. A createRequestViaUi failure stays primary.
 */
export async function collectCreateRequestObservations(input: {
  expectedActionId: string
  arm: (listener: (source: ResponseBodySource) => void) => void
  disarm: (listener: (source: ResponseBodySource) => void) => void
  run: () => Promise<void>
  deadlineMs?: number
  onSecondaryRead?: (kind: CreateRequestReadKind) => void
}): Promise<CreateRequestActionObservation[]> {
  const observations: CreateRequestActionObservation[] = []
  const pending: Array<Promise<ReadOutcome>> = []
  const deadlineMs = input.deadlineMs ?? CREATE_REQUEST_READ_DEADLINE_MS
  const record = (kind: CreateRequestReadKind) => {
    try {
      const recorded = input.onSecondaryRead?.(kind) as unknown
      if (recorded && typeof (recorded as { then?: unknown }).then === 'function') {
        void (recorded as Promise<unknown>).catch(() => undefined)
      }
    } catch {
      // A checkpoint failure must not replace the creation or read error.
    }
  }
  const listener = (source: ResponseBodySource) => {
    const actionId = source.request().headers()['next-action'] ?? null
    if (actionId !== input.expectedActionId) return
    const observation: CreateRequestActionObservation = {
      actionId,
      postData: source.request().postData(),
      responseBytes: new Uint8Array(0),
    }
    observations.push(observation)
    // The stored promise never rejects, and the outcome is tagged the moment
    // it settles — even while the creation callback is still pending across
    // event-loop turns.
    pending.push(withDeadline(source.body(), deadlineMs).then(
      (bytes): ReadOutcome => ({ status: 'bytes', bytes }),
      (error): ReadOutcome => {
        const status: CreateRequestReadKind = error instanceof Error && error.message === 'createRequest response read deadline exceeded'
          ? 'deadline'
          : 'rejected'
        record(status)
        return { status }
      },
    ))
  }
  input.arm(listener)
  let primary: unknown
  try {
    await input.run()
  } catch (error) {
    primary = error
  } finally {
    input.disarm(listener)
  }
  const outcomes = await Promise.all(pending)
  outcomes.forEach((outcome, index) => {
    const observation = observations[index]
    if (!observation || outcome.status !== 'bytes') return
    observation.responseBytes = outcome.bytes
  })
  if (primary !== undefined) throw primary
  if (outcomes.some((outcome) => outcome.status === 'deadline')) {
    throw new Error('createRequest response read deadline exceeded')
  }
  if (outcomes.some((outcome) => outcome.status === 'rejected')) {
    throw new Error('createRequest response read failed')
  }
  return observations
}

function nonemptyRequestId(result: unknown): string {
  if (!result || typeof result !== 'object') throw new Error('createRequest action result missing')
  const record = result as { success?: unknown; requestId?: unknown }
  if (record.success !== true || typeof record.requestId !== 'string' || record.requestId.trim() === '' || /\s/.test(record.requestId)) {
    throw new Error('createRequest action result missing')
  }
  return record.requestId
}

/**
 * Identity of the createRequest submission decided before submit: the
 * same-run action id plus the structured arg title. The id comes only from
 * decoded Flight `response.a` (references included). `response.f` and
 * unrelated bodies are not results.
 */
export async function readCreatedRequestIdFromCreateAction(input: {
  expectedActionId: string
  expectedTitle: string
  observations: readonly CreateRequestActionObservation[]
}): Promise<string> {
  if (input.expectedActionId.trim() === '' || input.expectedTitle.trim() === '') {
    throw new Error('createRequest action result missing')
  }
  const matched = input.observations.filter((observation) => (
    observation.actionId === input.expectedActionId
    && actionBodyHasExactTitle(observation.postData, input.expectedTitle)
  ))
  if (matched.length !== 1) throw new Error('createRequest action result missing')
  const result = await decodeFlightActionResult(matched[0].responseBytes)
  return nonemptyRequestId(result)
}

export function selectStrandedRowForRequest<
  T extends { requestId: string | null; instanceId: string },
>(rows: readonly T[], createdRequestId: string): T {
  if (createdRequestId.trim() === '') {
    throw new Error('created request id is required before restart')
  }
  const matches = rows.filter((row) => row.requestId === createdRequestId)
  if (matches.length !== 1) {
    throw new Error(`created request ${createdRequestId} matched ${matches.length} stranded rows`)
  }
  return matches[0]
}

export async function writeT18bBrowserCorrelation(
  evidenceDir: string,
  correlation: T18bBrowserCorrelation,
): Promise<void> {
  const parsed = parseT18bBrowserCorrelation(JSON.stringify(correlation))
  if (parsed.status !== 'present') {
    throw new Error('T18B browser correlation must be an exact request title plus the selected old instance id')
  }
  await fs.mkdir(evidenceDir, { recursive: true })
  await fs.writeFile(
    path.join(evidenceDir, T18B_BROWSER_CORRELATION_FILE),
    JSON.stringify(parsed.correlation),
    { encoding: 'utf8', mode: 0o600 },
  )
}

export async function readT18bBrowserCorrelation(evidenceDir: string): Promise<T18bCorrelationRead> {
  try {
    const raw = await fs.readFile(path.join(evidenceDir, T18B_BROWSER_CORRELATION_FILE), 'utf8')
    return parseT18bBrowserCorrelation(raw)
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : ''
    if (code === 'ENOENT') return { status: 'missing' }
    return { status: 'corrupt' }
  }
}
