import { createServer, type Server, type Socket } from 'node:net'
import { Parser } from 'htmlparser2'
import { createFailClosedMailCapturePlan } from '../business-workflow-safety'

/**
 * Fail-closed loopback SMTP capture endpoint for the business test runtime.
 *
 * Speaks just enough SMTP for the application's Nodemailer transport
 * (greeting, EHLO, MAIL FROM, RCPT TO, DATA, RSET, NOOP, QUIT), retains every
 * accepted message in memory (raw wire form plus parsed envelope), and binds
 * ONLY to the runner-owned loopback port from the fail-closed mail plan. The
 * application is configured against this endpoint through a seeded
 * `email_settings` row, and the outbound allowlist preload blocks every other
 * destination, so no real network SMTP can ever be reached.
 */

export interface CapturedSmtpMessage {
  receivedAt: string
  from: string
  to: string[]
  raw: string
}

export interface MailCaptureHandle {
  plan: ReturnType<typeof createFailClosedMailCapturePlan>
  port: number
  messages(): readonly CapturedSmtpMessage[]
  close(): Promise<void>
}

interface SessionState {
  inData: boolean
  buffer: string
  from: string | null
  to: string[]
  dataLines: string[]
}

export async function startMailCapture(planInput: {
  host: string
  port: number
}): Promise<MailCaptureHandle> {
  // Reuses the existing disposable-CI safety module so loopback-only binding
  // and the DISABLED fallback contract are enforced by shared code. The
  // validation failures surface as promise rejections (never synchronous
  // throws) so runners can .catch them uniformly.
  const plan = createFailClosedMailCapturePlan({
    host: planInput.host,
    port: planInput.port,
    fallbackTransport: 'DISABLED',
  })
  const messages: CapturedSmtpMessage[] = []
  const sessions = new WeakMap<Socket, SessionState>()

  function resetSession(state: SessionState): void {
    state.inData = false
    state.from = null
    state.to = []
    state.dataLines = []
  }

  function handleCommand(state: SessionState, line: string, socket: Socket): string | null {
    const verb = line.slice(0, 4).toUpperCase()
    if (verb === 'EHLO' || verb === 'HELO') {
      if (verb === 'EHLO') {
        socket.write('250-business-test-capture\r\n250-8BITMIME\r\n250-SIZE 26214400\r\n250 OK\r\n')
        return null
      }
      return '250 business-test-capture'
    }
    if (line.toUpperCase().startsWith('MAIL FROM:')) {
      state.from = line.slice(10).trim().replace(/^<|>$/g, '')
      return '250 OK'
    }
    if (line.toUpperCase().startsWith('RCPT TO:')) {
      state.to.push(line.slice(8).trim().replace(/^<|>$/g, ''))
      return '250 OK'
    }
    if (verb === 'DATA') {
      state.inData = true
      return '354 End data with <CR><LF>.<CR><LF>'
    }
    if (verb === 'RSET') {
      resetSession(state)
      return '250 OK'
    }
    if (verb === 'NOOP') return '250 OK'
    if (verb === 'QUIT') return '221 business-test-capture closing'
    if (verb === 'VRFY') return '252 Cannot VRFY'
    return '502 Command not implemented'
  }

  const server: Server = createServer((socket: Socket) => {
    const state: SessionState = {
      inData: false,
      buffer: '',
      from: null,
      to: [],
      dataLines: [],
    }
    sessions.set(socket, state)
    socket.write('220 business-test-capture ESMTP test-only\r\n')
    socket.on('data', (chunk: Buffer) => {
      state.buffer += chunk.toString('utf8')
      let index: number
      while ((index = state.buffer.indexOf('\r\n')) >= 0) {
        const line = state.buffer.slice(0, index)
        state.buffer = state.buffer.slice(index + 2)
        if (state.inData) {
          if (line === '.') {
            state.inData = false
            messages.push({
              receivedAt: new Date().toISOString(),
              from: state.from ?? '',
              to: [...state.to],
              raw: state.dataLines.join('\n'),
            })
            resetSession(state)
            socket.write('250 OK message captured\r\n')
          } else {
            state.dataLines.push(line.startsWith('..') ? line.slice(1) : line)
          }
          continue
        }
        if (line.length === 0) continue
        const response = handleCommand(state, line, socket)
        if (response) socket.write(`${response}\r\n`)
      }
    })
    socket.on('error', () => socket.destroy())
  })

  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error)
    server.once('error', onError)
    server.listen(plan.port, plan.host, () => {
      server.removeListener('error', onError)
      resolve({
        plan,
        port: plan.port,
        messages: () => messages.map((message) => ({ ...message, to: [...message.to] })),
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            server.close((error) => (error ? rejectClose(error) : resolveClose()))
            // Capture servers never have half-open client sockets in practice,
            // but do not hang cleanup on them.
            ;(server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.()
          }),
      })
    })
  })
}

/** The only request-link paths the notification producer emits
 * (notifications.ts buildNotificationRequestPath). Hosts cannot be validated
 * without a configured base URL, so link support is decided by PATH only. */
const SUPPORTED_REQUEST_PATHS = new Set(['/requests', '/requests/my-actions'])

/** Canonical charset a supported request id consists of. */
const REQUEST_ID_VALUE_PATTERN = /^[A-Za-z0-9_-]+$/

/** Raw control characters no URL may contain. WHATWG URL parsing strips or
 * normalizes tabs/newlines, so a raw control inside a link must be REJECTED
 * up front — invalid material may never be silently normalized into a
 * different (potentially valid) value. */
const RAW_URL_FORBIDDEN_CONTROL = /[\x00-\x1F\x7F]/

/** Characters the HTML grammar forbids inside an UNQUOTED attribute value.
 * '=' legitimately occurs in URL queries, but unquoted attribute syntax
 * forbids a literal '=' — and the actual producer always quotes — so an
 * unquoted value carrying one fails closed as a malformed link. The parser
 * reports the quote kind per attribute (null = unquoted), so the same rule
 * applies to the parser-reported value. */
const UNQUOTED_VALUE_FORBIDDEN = /["'`=<]/

/** Plain-text link tokens: absolute http(s) URLs or the supported relative
 * request paths. Prose fragments and substring lookalikes are never links. */
const PLAIN_URL_TOKEN_PATTERN = /(?:https?:\/\/[^\s'"<>]+|\/requests[^\n\s'"<>]*)/g

/** Bounded MIME walk caps (the capture endpoint advertises SIZE 26214400 and
 * notification emails are tiny; refuse pathological payloads and never let
 * decoding grow past the captured raw size class). */
const MAX_MIME_DEPTH = 8
const MAX_MIME_PARTS = 64
const MAX_PART_BYTES = 2 * 1024 * 1024

/** Payload-free fail-closed categories for an explicit-but-unusable id or
 * malformed MIME/link framing. */
type RequestIdIssue =
  | 'malformed-transfer-encoding'
  | 'unknown-content-transfer-encoding'
  | 'malformed-multipart-framing'
  | 'malformed-request-link'
  | 'malformed-request-id-encoding'
  | 'invalid-request-id-value'
  | 'empty-request-id-value'
  | 'unsupported-request-link'
  | 'conflicting-request-ids'

/** Deterministic diagnostic precedence when several categories apply. */
const REQUEST_ID_ISSUE_PRIORITY: ReadonlyArray<Exclude<RequestIdIssue, 'conflicting-request-ids'>> = [
  'malformed-transfer-encoding',
  'unknown-content-transfer-encoding',
  'malformed-multipart-framing',
  'malformed-request-link',
  'malformed-request-id-encoding',
  'invalid-request-id-value',
  'empty-request-id-value',
  'unsupported-request-link',
]

interface RequestIdExtraction {
  requestId: string | null
  requestIdIssue?: RequestIdIssue
}

interface MimePartScan {
  ids: Set<string>
  issues: Set<Exclude<RequestIdIssue, 'conflicting-request-ids'>>
  parts: number
}

/** Split headers from body at the first blank line (CRLF or LF framed). */
function splitHeadersAndBody(raw: string): { headers: string; body: string } | null {
  const separator = /\r?\n\r?\n/.exec(raw)
  if (!separator || separator.index === 0) return null
  return {
    headers: raw.slice(0, separator.index),
    body: raw.slice(separator.index + separator[0].length),
  }
}

/** Unfolded value of one header (case-insensitive, continuations joined). */
function mailHeaderValue(headers: string, name: string): string {
  const unfolded = headers.replace(/\r?\n[ \t]+/g, ' ')
  const match = new RegExp(`^${name}:([^\n]*)$`, 'im').exec(unfolded)
  return match ? match[1].trim() : ''
}

/** boundary parameter of a Content-Type value, quoted or bare. */
function boundaryParam(contentType: string): string | null {
  const match = /boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i.exec(contentType)
  return match ? match[1] ?? match[2] ?? null : null
}

/** Split the body into multipart segments on EXACT delimiter lines. A
 * delimiter is `--boundary` (opening) or `--boundary--` (closing), each
 * followed only by linear whitespace — boundary PREFIXES such as
 * `--boundary-extra` are ordinary body text, never delimiters. Complete
 * framing (at least one opening delimiter plus a closing delimiter) is
 * required; a truncated or delimiter-less body is reported so the caller
 * fails closed. Preamble and epilogue are never body parts, and each
 * segment is emitted exactly once. */
interface MultipartSplit {
  segments: string[]
  complete: boolean
}

function isMultipartDelimiterLine(line: string, delimiter: string, closing: boolean): boolean {
  if (!line.startsWith(delimiter)) return false
  if (closing && !line.startsWith('--', delimiter.length)) return false
  const rest = closing ? line.slice(delimiter.length + 2) : line.slice(delimiter.length)
  return /^[ \t]*$/.test(rest)
}

function splitMultipartBody(body: string, boundary: string): MultipartSplit {
  const delimiter = `--${boundary}`
  const segments: string[] = []
  let current: string[] | null = null
  let sawOpening = false
  let closed = false
  for (const line of body.split(/\r?\n/)) {
    if (isMultipartDelimiterLine(line, delimiter, false)) {
      if (current) segments.push(current.join('\n'))
      current = []
      sawOpening = true
      continue
    }
    if (isMultipartDelimiterLine(line, delimiter, true)) {
      if (current) segments.push(current.join('\n'))
      current = null
      closed = true
      break // epilogue ignored
    }
    if (current) current.push(line)
  }
  return { segments, complete: sawOpening && closed }
}

function hexValue(first: string | undefined, second: string | undefined): number {
  if (!first || !second) return -1
  const value = parseInt(`${first}${second}`, 16)
  return Number.isInteger(value) && /^[0-9A-Fa-f]$/.test(first) && /^[0-9A-Fa-f]$/.test(second) ? value : -1
}

/** Strict quoted-printable decode: strips CRLF/LF soft line breaks, expands
 * =XX escapes. Malformed escapes or forbidden raw bytes return null so the
 * caller fails closed instead of extracting a corrupt id. */
function decodeQuotedPrintable(input: string): string | null {
  if (input.length > MAX_PART_BYTES) return null
  const encoded = input.replace(/=\r?\n/g, '')
  const bytes: number[] = []
  for (let index = 0; index < encoded.length; index += 1) {
    const code = encoded.charCodeAt(index)
    if (encoded[index] !== '=') {
      if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code > 126) return null
      bytes.push(code)
      continue
    }
    const value = hexValue(encoded[index + 1], encoded[index + 2])
    if (value < 0) return null
    bytes.push(value)
    index += 2
  }
  return Buffer.from(bytes).toString('utf8')
}

/** Strict base64 decode of a body part; invalid input returns null. */
function decodeBase64Part(input: string): string | null {
  const compact = input.replace(/\s/g, '')
  if (compact.length === 0 || compact.length > MAX_PART_BYTES || compact.length % 4 !== 0) return null
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return null
  return Buffer.from(compact, 'base64').toString('utf8')
}

/** Split one whole link token into path + raw query (no scheme-relative or
 * opaque-scheme tokens). */
function splitLinkPathAndQuery(token: string): { path: string; query: string } | null {
  let rest = token
  const schemeAuthority = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i.exec(rest)
  if (schemeAuthority) {
    rest = rest.slice(schemeAuthority[0].length)
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(rest)) {
    return null // opaque scheme (mailto:…) — no path/query structure
  }
  const hash = rest.indexOf('#')
  if (hash >= 0) rest = rest.slice(0, hash)
  const queryStart = rest.indexOf('?')
  if (queryStart < 0) return { path: rest, query: '' }
  return { path: rest.slice(0, queryStart), query: rest.slice(queryStart + 1) }
}

/** Scan one whole link token: an EXACT `requestId` query key on a SUPPORTED
 * request path is the only id source. The raw value is percent-decoded per
 * the explicit contract — malformed escapes, decoded-invalid material and
 * empty values flag distinct payload-free issues; a complete valid value
 * joins. An exact key on an unsupported path flags `unsupported-request-link`
 * (an explicit identity is never silently discarded); links WITHOUT the
 * exact key contribute nothing (genuinely id-less, no issue). */
function scanLinkToken(token: string, scan: MimePartScan): void {
  const link = splitLinkPathAndQuery(token)
  if (!link) return
  const rawValues: string[] = []
  for (const pair of link.query.split('&')) {
    if (pair === '') continue
    const equals = pair.indexOf('=')
    const key = equals < 0 ? pair : pair.slice(0, equals)
    if (key !== 'requestId') continue
    rawValues.push(equals < 0 ? '' : pair.slice(equals + 1))
  }
  if (rawValues.length === 0) return
  if (!SUPPORTED_REQUEST_PATHS.has(link.path)) {
    scan.issues.add('unsupported-request-link')
    return
  }
  for (const rawValue of rawValues) {
    if (rawValue === '') {
      scan.issues.add('empty-request-id-value')
      continue
    }
    let decoded: string
    try {
      decoded = decodeURIComponent(rawValue)
    } catch {
      scan.issues.add('malformed-request-id-encoding')
      continue
    }
    if (!REQUEST_ID_VALUE_PATTERN.test(decoded)) {
      scan.issues.add('invalid-request-id-value')
      continue
    }
    scan.ids.add(decoded)
  }
}

/** Scan one whole link: raw control characters anywhere in the URL are a
 * malformed link (fail closed BEFORE any parsing/normalization could alter
 * the value); otherwise the exact-key/supported-path contract applies. */
function scanWholeLink(url: string, scan: MimePartScan): void {
  if (RAW_URL_FORBIDDEN_CONTROL.test(url)) {
    scan.issues.add('malformed-request-link')
    return
  }
  scanLinkToken(url, scan)
}

/** Collect supported request-link ids from one decoded text/* MIME part
 * body, split by MEDIA TYPE. text/html is parsed by the maintained
 * htmlparser2 tokenizer: ids come ONLY from actual `href` attributes on
 * real tags (comments, script/style rawtext and other attributes' values
 * are never attribute positions); entity-encoded query separators/keys/
 * values are decoded before the unchanged exact-URL validation. Any other
 * text/* (including the missing-Content-Type text/plain default) is the
 * visible-text token scan — text/plain has no tag semantics, so no HTML
 * exclusion applies to it. */
function collectRequestIdsFromDecodedText(text: string, scan: MimePartScan, isHtml: boolean): void {
  if (isHtml) {
    collectRequestIdsFromHtml(text, scan)
    return
  }
  for (const match of text.matchAll(PLAIN_URL_TOKEN_PATTERN)) {
    scanWholeLink(match[0], scan)
  }
}

/** HTML branch: real href attributes on real tags only. Root invariant:
 * every href attribute the parser reports is validated whole via the
 * unchanged scanWholeLink contract (raw control characters reject before
 * any normalization; exact `requestId` key on a supported path; malformed
 * escapes/decoded-invalid/empty values flag distinct payload-free issues).
 * Valueless, empty-unquoted, forbidden-character unquoted values, and a
 * SECOND href on the same tag (ambiguous explicit identity) all fail closed
 * as malformed-request-link.
 *
 * EOF TRUNCATION (Task40): htmlparser2 never emits `onopentag` for a tag it
 * is still inside at EOF — it silently flushes a synthetic close instead
 * (verified against 10.1.0 with offline probes; a quoted ">" inside an
 * earlier attribute also defeats any raw tail heuristic). The parser's own
 * event state is therefore the signal: a tag-name event without a matching
 * open-tag event at `onend` means the document ended inside tag syntax,
 * which flags malformed-request-link conservatively — even when the
 * truncated tag carries no href — so a dropped explicit link can never
 * degrade to an id-less summary that would re-enable title fallback.
 * Comments, rawtext and close-tag truncations never enter tag-name state
 * and cannot set the pending flag. */
function collectRequestIdsFromHtml(html: string, scan: MimePartScan): void {
  let tagSawHref = false
  let tagPending = false
  const parser = new Parser(
    {
      onopentagname() {
        tagSawHref = false
        tagPending = true
      },
      onopentag() {
        tagPending = false
      },
      onattribute(name, value, quote) {
        if (name.toLowerCase() !== 'href') return
        if (tagSawHref) {
          scan.issues.add('malformed-request-link')
          return
        }
        tagSawHref = true
        if (quote === undefined || (quote === null && value === '')) {
          // valueless href, or an unquoted value that terminated immediately
          scan.issues.add('malformed-request-link')
          return
        }
        if (quote === null && UNQUOTED_VALUE_FORBIDDEN.test(value)) {
          scan.issues.add('malformed-request-link')
          return
        }
        scanWholeLink(value, scan)
      },
      onend() {
        if (tagPending) scan.issues.add('malformed-request-link')
      },
    },
    { decodeEntities: true },
  )
  parser.write(html)
  parser.end()
}

function scanMimePart(headers: string, body: string, depth: number, scan: MimePartScan): void {
  if (depth > MAX_MIME_DEPTH || scan.parts >= MAX_MIME_PARTS || body.length > MAX_PART_BYTES) {
    scan.issues.add('malformed-transfer-encoding')
    return
  }
  scan.parts += 1
  const contentType = mailHeaderValue(headers, 'content-type')
  if (/^multipart\//i.test(contentType)) {
    const boundary = boundaryParam(contentType)
    if (boundary === null) {
      // A declared multipart without a boundary parameter cannot be framed —
      // fail closed instead of silently ignoring the parts.
      scan.issues.add('malformed-multipart-framing')
      return
    }
    const split = splitMultipartBody(body, boundary)
    if (!split.complete) scan.issues.add('malformed-multipart-framing')
    for (const segment of split.segments) {
      const part = splitHeadersAndBody(segment)
      if (!part) {
        // Every part needs its header/body separator; a separator-less part
        // is malformed framing, never a silently-empty body.
        scan.issues.add('malformed-multipart-framing')
        continue
      }
      scanMimePart(part.headers, part.body, depth + 1, scan)
    }
    return
  }
  // Only text/* leaves are link carriers; a missing Content-Type defaults to
  // text/plain (RFC 2045), matching how the notification emails are built.
  if (contentType !== '' && !/^text\//i.test(contentType)) return
  // The media type decides the scanning semantics: text/html is parsed as
  // HTML (href attributes on real tags only); every other text/* keeps the
  // visible-text plain-token scan.
  const isHtml = /^text\/html(?:[^\w-]|$)/i.test(contentType)
  const transferEncoding = mailHeaderValue(headers, 'content-transfer-encoding').toLowerCase()
  let decoded: string | null
  if (transferEncoding === '' || transferEncoding === '7bit' || transferEncoding === '8bit' || transferEncoding === 'binary') {
    decoded = body
  } else if (transferEncoding === 'quoted-printable') {
    decoded = decodeQuotedPrintable(body)
  } else if (transferEncoding === 'base64') {
    decoded = decodeBase64Part(body)
  } else {
    scan.issues.add('unknown-content-transfer-encoding')
    return
  }
  if (decoded === null) {
    scan.issues.add('malformed-transfer-encoding')
    return
  }
  collectRequestIdsFromDecodedText(decoded, scan, isHtml)
}

/** Extract the supported request-link query value from a captured raw wire
 * message. The id is read ONLY from transfer-decoded text/* MIME part bodies
 * (quoted-printable =3D + soft breaks, base64, 7bit/8bit passthrough); the
 * headers, the unencoded framing and any non-text part are never rewritten
 * or scanned. Undecodable or conflicting explicit ids fail CLOSED: null plus
 * a payload-free category, never a wrong-but-valid-looking id. */
function extractRequestIdFromRawMail(raw: string): RequestIdExtraction {
  const split = splitHeadersAndBody(raw)
  if (!split) return { requestId: null }
  const scan: MimePartScan = { ids: new Set(), issues: new Set(), parts: 0 }
  scanMimePart(split.headers, split.body, 0, scan)
  if (scan.ids.size > 1) return { requestId: null, requestIdIssue: 'conflicting-request-ids' }
  const issue = REQUEST_ID_ISSUE_PRIORITY.find((candidate) => scan.issues.has(candidate))
  if (issue) return { requestId: null, requestIdIssue: issue }
  return { requestId: scan.ids.size === 1 ? [...scan.ids][0] : null }
}

/** Flatten captured SMTP wire messages into evidence-safe records (no secrets). */
export function summarizeCapturedMessages(messages: readonly CapturedSmtpMessage[]): Array<{
  receivedAt: string
  from: string
  to: string[]
  subject: string
  /** Request id parsed from the notification email's request link (requestId=…)
 * — extracted from the TRANSFER-DECODED body MIME parts, so quoted-printable
 * (=3D, soft line breaks) and base64 bodies decode to the real id. */
  requestId: string | null
  /** Set only when a body referenced the request link but no single valid id
 * could be derived (undecodable transfer encoding or conflicting ids). A
 * bounded, payload-free category — consumers must treat it as no-join. */
  requestIdIssue?: RequestIdIssue
}> {
  return messages.map((message) => {
    const subject = message.raw
      .split('\n')
      .filter((line) => line.toLowerCase().startsWith('subject:'))
      .map((line) => line.slice(8).trim())
      .join(' ')
    const { requestId, requestIdIssue } = extractRequestIdFromRawMail(message.raw)
    const summary = {
      receivedAt: message.receivedAt,
      from: message.from,
      to: message.to,
      subject,
      requestId,
    }
    if (requestIdIssue) return { ...summary, requestIdIssue }
    return summary
  })
}
