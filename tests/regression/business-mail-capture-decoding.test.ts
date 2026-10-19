import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import nodemailer, { type SendMailOptions } from 'nodemailer'

import {
  summarizeCapturedMessages,
  type CapturedSmtpMessage,
} from '../support/native/mail-capture'
import {
  evaluateCapturedMailEvidence,
  type CapturedMailSummaryMessage,
  type MailEvidenceRequestRow,
} from '../support/native/capture-workflow-mail-evidence'

/**
 * Regression for the T12/T13 mail requestId decoding bug (Task31 diagnosis):
 * summarizeCapturedMessages ran /requestId=([A-Za-z0-9_-]+)/ over the RAW
 * SMTP wire, so quoted-printable bodies yielded '=3D'-prefixed,
 * soft-break-truncated fragments (e.g. '3D66865424-2695-44cd-9a') that
 * could never equal the DB request id — the strict-id evaluator then
 * false-failed status_changed / Request Completed joins.
 *
 * Fix contract under test:
 *  - the requestId is extracted ONLY from transfer-decoded text/* MIME part
 *    bodies (quoted-printable incl. =3D and CRLF/LF soft breaks, base64,
 *    7bit/8bit passthrough); headers and unencoded non-part raw are never
 *    regexed or =xx-rewritten;
 *  - conflicting ids across/inside parts fail CLOSED (requestId null plus a
 *    bounded payload-free requestIdIssue category, never a wrong valid id);
 *  - unknown/malformed transfer encodings fail closed the same way;
 *  - summaries keep their identity (envelope + subject only, no bodies);
 *  - the evaluator still joins title-less mails by the exact DB id and never
 *    falls back to title matching when an explicit id conflicts.
 *
 * Mail fixtures are rendered by the actual producer path — Nodemailer's
 * offline stream transport (buffer mode) — then normalized exactly the way
 * the capture endpoint retains DATA lines (CRLF framing stripped, leading
 * dot un-stuffed, '\n'-joined; mail-capture.ts). No SMTP server, no network.
 */

const TITLE = 'Business T12A 1789800000000-1234'
const REQUESTER_A = 'user-requester-a@business.test'
const SUPERVISOR_P = 'user-supervisor-p@business.test'
const SECOND_APPROVER = 'user-second-approver@business.test'

/** Renders a mail exactly as Nodemailer would put it on the wire, then
 * mirrors the capture endpoint's DATA retention (no SMTP conversation). */
async function renderWireMail(mail: SendMailOptions): Promise<string> {
  const transport = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: 'crlf',
  })
  const info = await transport.sendMail(mail)
  assert.ok(Buffer.isBuffer(info.message), 'stream transport must buffer the message')
  return info.message
    .toString('utf8')
    .split('\r\n')
    .map((line) => (line.startsWith('..') ? line.slice(1) : line))
    .join('\n')
}

function capturedMessage(raw: string, to: string[]): CapturedSmtpMessage {
  return {
    receivedAt: '2026-09-19T00:00:00.000Z',
    from: 'business-workflow-test@business.test',
    to,
    raw,
  }
}

/** The notification email shape (notifications.ts): multipart alternative,
 * html anchor + plain-text request line, both linking the request. The long
 * prefix/style keep the fixtures representative of the captured evidence:
 * the UUID region folds across a quoted-printable soft break. */
function notificationMail(input: { id: string; subject: string; htmlId?: string }): SendMailOptions {
  const link = (id: string) => `http://localhost:3000/requests?requestId=${id}`
  return {
    from: 'business-workflow-test@business.test',
    to: REQUESTER_A,
    subject: input.subject,
    text: `${input.subject}\n\nView the full request details here: ${link(input.id)}\n`,
    html: `<html><body><p>${input.subject}</p><p><a href="${link(input.htmlId ?? input.id)}" style="display:inline-block;padding:12px 24px;background-color:#2563eb;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:700;">View Request</a></p></body></html>`,
  }
}

describe('mail-capture requestId transfer decoding', () => {
  it('extracts the exact request id from a quoted-printable multipart whose UUID folds across a soft break (the proven bug)', async () => {
    const ID = '66865424-2695-44cd-9ab4-8f0e-0123456789ab'
    const raw = await renderWireMail(notificationMail({ id: ID, subject: 'Request Completed' }))
    // Fixture self-check: the raw wire really carries the corrupting shape —
    // '=' encoded as =3D and (for this length) a soft break inside the id.
    const rawOnlyMatch = raw.match(/requestId=([A-Za-z0-9_-]+)/)
    assert.ok(rawOnlyMatch, 'fixture must contain a requestId in the raw wire')
    assert.ok(rawOnlyMatch[1].startsWith('3D'), 'fixture: the wire = must be =3D-encoded')
    assert.notEqual(rawOnlyMatch[1], ID, 'fixture: the raw-regex id must differ from the true id')
    assert.match(
      raw,
      /requestId=3D[0-9a-f-]{20,}=\n[0-9a-f-]+/,
      'fixture: the id must fold across a soft break in the quoted-printable wire',
    )
    const summary = summarizeCapturedMessages([capturedMessage(raw, [REQUESTER_A])])[0]
    assert.equal(summary.requestId, ID)
    assert.equal(summary.requestIdIssue, undefined)
    assert.equal(summary.subject, 'Request Completed')
  })

  it('extracts the id from an original plain (7bit) single-part text mail unchanged', async () => {
    const raw = await renderWireMail({
      from: 'business-workflow-test@business.test',
      to: REQUESTER_A,
      subject: 'Request Status Changed',
      text: 'status changed\nView Request: http://localhost:3000/requests?requestId=abc123\n',
    })
    assert.match(raw, /Content-Transfer-Encoding: 7bit/)
    const summary = summarizeCapturedMessages([capturedMessage(raw, [REQUESTER_A])])[0]
    assert.equal(summary.requestId, 'abc123')
    assert.equal(summary.requestIdIssue, undefined)
  })

  it('extracts the id when the producer base64-encodes the text part (textEncoding B)', async () => {
    const ID = 'cmtestid00000000base64part'
    const raw = await renderWireMail({
      ...notificationMail({ id: ID, subject: 'Request Completed' }),
      textEncoding: 'base64',
    })
    assert.match(raw, /Content-Transfer-Encoding: base64/)
    assert.doesNotMatch(raw, /requestId=/, 'fixture: base64 must hide the id from any raw scan')
    const summary = summarizeCapturedMessages([capturedMessage(raw, [REQUESTER_A])])[0]
    assert.equal(summary.requestId, ID)
    assert.equal(summary.requestIdIssue, undefined)
  })

  it('joins multipart html and text parts when they carry the SAME id', async () => {
    const ID = 'cuid-consistent-001'
    const raw = await renderWireMail(notificationMail({ id: ID, subject: `Approval Needed: ${TITLE}` }))
    const summary = summarizeCapturedMessages([capturedMessage(raw, [SUPERVISOR_P, SECOND_APPROVER])])[0]
    assert.equal(summary.requestId, ID)
    assert.equal(summary.requestIdIssue, undefined)
    assert.equal(summary.subject, `Approval Needed: ${TITLE}`)
  })

  it('fails CLOSED on conflicting ids across parts (null id + explicit issue, never a picked fragment)', async () => {
    const raw = await renderWireMail(
      notificationMail({ id: 'cuid-text-part-001', htmlId: 'cuid-html-part-002', subject: `Approval Needed: ${TITLE}` }),
    )
    const summary = summarizeCapturedMessages([capturedMessage(raw, [SUPERVISOR_P])])[0]
    assert.equal(summary.requestId, null)
    assert.equal(summary.requestIdIssue, 'conflicting-request-ids')
  })

  it('fails CLOSED on malformed quoted-printable and unknown transfer encodings (synthetic raws)', () => {
    const malformedQp = [
      'Subject: Request Status Changed',
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'requestId=3Dcuid-malformed-00=ZZ',
    ].join('\n')
    const unknownCte = [
      'Subject: Request Status Changed',
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: x-uuencode',
      '',
      'requestId=3Dcuid-undecodable-00',
    ].join('\n')
    const summaries = summarizeCapturedMessages([
      capturedMessage(malformedQp, [REQUESTER_A]),
      capturedMessage(unknownCte, [REQUESTER_A]),
    ])
    assert.equal(summaries[0].requestId, null)
    assert.equal(summaries[0].requestIdIssue, 'malformed-transfer-encoding')
    assert.equal(summaries[1].requestId, null)
    assert.equal(summaries[1].requestIdIssue, 'unknown-content-transfer-encoding')
  })

  it('never scans headers for the id and keeps subject/recipient summaries unchanged', () => {
    // requestId appears ONLY in headers; no text part references it.
    const headerOnly = [
      'Subject: Approval Needed: ' + TITLE,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'body without any link',
    ].join('\n')
    const summary = summarizeCapturedMessages([capturedMessage(headerOnly, [SUPERVISOR_P, SECOND_APPROVER])])[0]
    assert.equal(summary.requestId, null)
    assert.equal(summary.requestIdIssue, undefined)
    assert.equal(summary.subject, `Approval Needed: ${TITLE}`)
    assert.deepEqual(summary.to, [SUPERVISOR_P, SECOND_APPROVER])
    assert.equal(summary.from, 'business-workflow-test@business.test')
  })
})

describe('mail-capture request id integrity (Astra P1 findings)', () => {
  /** Title-bearing evaluator join helper: proves a summary must NOT join via subject. */
  function evaluatorCreateStatus(messages: CapturedMailSummaryMessage[], id: string): string | undefined {
    const checks = evaluateCapturedMailEvidence({
      messages,
      requests: [{ id, title: TITLE }],
      routesConfig: 'all-defaults',
    })
    return checks.find((check) => check.name === 'mail-evidence/Business T12A/create-approval-needed-to-current-candidates')?.status
  }

  it('never accepts a value prefix: requestId=abc%2Fother flags invalid and request abc never joins', async () => {
    const raw = await renderWireMail(notificationMail({ id: 'abc%2Fother', subject: `Approval Needed: ${TITLE}` }))
    const summary = summarizeCapturedMessages([capturedMessage(raw, [SUPERVISOR_P, SECOND_APPROVER])])[0]
    assert.equal(summary.requestId, null, 'a percent-encoded value must not be truncated to a prefix id')
    assert.equal(summary.requestIdIssue, 'invalid-request-id-value')
    assert.equal(evaluatorCreateStatus([summary], 'abc'), 'fail', 'request abc must not join via title for an explicit invalid value')
  })

  it('flags an explicit EMPTY requestId value instead of enabling title fallback', async () => {
    const raw = await renderWireMail(notificationMail({ id: '', subject: `Approval Needed: ${TITLE}` }))
    const summary = summarizeCapturedMessages([capturedMessage(raw, [SUPERVISOR_P, SECOND_APPROVER])])[0]
    assert.equal(summary.requestId, null)
    assert.equal(summary.requestIdIssue, 'empty-request-id-value')
    assert.equal(evaluatorCreateStatus([summary], 'abc'), 'fail', 'an explicit empty id must not join via title')
  })

  it('still accepts a legitimate id followed by more query parameters', async () => {
    const raw = await renderWireMail({
      from: 'business-workflow-test@business.test',
      to: REQUESTER_A,
      subject: 'Request Completed',
      text: `View: http://localhost:3000/requests?requestId=legit-id-007&tab=actions\n`,
    })
    const summary = summarizeCapturedMessages([capturedMessage(raw, [REQUESTER_A])])[0]
    assert.equal(summary.requestId, 'legit-id-007')
    assert.equal(summary.requestIdIssue, undefined)
  })

  /** Synthetic title-bearing multipart with a declared boundary and raw body lines. */
  function multipartRaw(declared: string, bodyLines: string[]): string {
    return [
      `Subject: Approval Needed: ${TITLE}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${declared}"`,
      '',
      ...bodyLines,
    ].join('\n')
  }

  const PART_HEADERS = 'Content-Type: text/plain; charset=utf-8'

  it('rejects missing multipart delimiters (declared boundary, none present) — no title fallback', () => {
    const raw = multipartRaw('b', [PART_HEADERS, '', 'View: http://localhost:3000/requests?requestId=abc'])
    const summary = summarizeCapturedMessages([capturedMessage(raw, [SUPERVISOR_P, SECOND_APPROVER])])[0]
    assert.equal(summary.requestId, null)
    assert.equal(summary.requestIdIssue, 'malformed-multipart-framing')
    assert.equal(evaluatorCreateStatus([summary], 'abc'), 'fail')
  })

  it('rejects wrong-boundary delimiters', () => {
    const raw = multipartRaw('b', ['--c', PART_HEADERS, '', 'requestId=abc', '--c--'])
    const summary = summarizeCapturedMessages([capturedMessage(raw, [SUPERVISOR_P])])[0]
    assert.equal(summary.requestId, null)
    assert.equal(summary.requestIdIssue, 'malformed-multipart-framing')
  })

  it('rejects boundary PREFIX lines (--b-extra is not a delimiter)', () => {
    const raw = multipartRaw('b', ['--b-extra', PART_HEADERS, '', 'requestId=abc', '--b--'])
    const summary = summarizeCapturedMessages([capturedMessage(raw, [SUPERVISOR_P])])[0]
    assert.equal(summary.requestId, null)
    assert.equal(summary.requestIdIssue, 'malformed-multipart-framing')
  })

  it('rejects near-delimiter lines (--bXX is not a closing delimiter)', () => {
    const raw = multipartRaw('b', ['--b', PART_HEADERS, '', 'requestId=abc', '--bXX'])
    const summary = summarizeCapturedMessages([capturedMessage(raw, [SUPERVISOR_P])])[0]
    assert.equal(summary.requestId, null)
    assert.equal(summary.requestIdIssue, 'malformed-multipart-framing')
  })

  it('rejects truncated multipart (opening delimiter, no closing)', () => {
    const raw = multipartRaw('b', ['--b', PART_HEADERS, '', 'View: http://localhost:3000/requests?requestId=abc'])
    const summary = summarizeCapturedMessages([capturedMessage(raw, [SUPERVISOR_P])])[0]
    assert.equal(summary.requestId, null)
    assert.equal(summary.requestIdIssue, 'malformed-multipart-framing')
    assert.equal(evaluatorCreateStatus([summary], 'abc'), 'fail')
  })

  it('scans a valid multipart exactly once per segment: epilogue ignored, no spurious conflict', () => {
    const raw = multipartRaw('b', [
      '--b',
      PART_HEADERS,
      '',
      'View: http://localhost:3000/requests?requestId=same-id-001',
      '--b',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<a href="http://localhost:3000/requests?requestId=same-id-001">View</a>',
      '--b--',
      'epilogue junk requestId=zzz-other-id',
    ])
    const summary = summarizeCapturedMessages([capturedMessage(raw, [SUPERVISOR_P])])[0]
    assert.equal(summary.requestId, 'same-id-001')
    assert.equal(summary.requestIdIssue, undefined, 'epilogue content and closing-segment re-scan must not add ids/issues')
  })

  it('scans the final segment before the closing delimiter (invalid value there still flags)', () => {
    const raw = multipartRaw('b', [
      '--b',
      PART_HEADERS,
      '',
      'View: http://localhost:3000/requests?requestId=ok-id-009',
      '--b',
      PART_HEADERS,
      '',
      'View: http://localhost:3000/requests?requestId=bad%2Fx',
      '--b--',
    ])
    const summary = summarizeCapturedMessages([capturedMessage(raw, [SUPERVISOR_P])])[0]
    assert.equal(summary.requestId, null)
    assert.equal(summary.requestIdIssue, 'invalid-request-id-value')
  })

  it('supports bounded nested multipart: valid inner framing extracts, truncated inner framing flags', () => {
    const validNested = multipartRaw('outer', [
      '--outer',
      'Content-Type: multipart/mixed; boundary="inner"',
      '',
      '--inner',
      PART_HEADERS,
      '',
      'View: http://localhost:3000/requests?requestId=nested-ok-001',
      '--inner--',
      '--outer--',
    ])
    const ok = summarizeCapturedMessages([capturedMessage(validNested, [REQUESTER_A])])[0]
    assert.equal(ok.requestId, 'nested-ok-001')
    assert.equal(ok.requestIdIssue, undefined)

    const truncatedNested = multipartRaw('outer', [
      '--outer',
      'Content-Type: multipart/mixed; boundary="inner"',
      '',
      '--inner',
      PART_HEADERS,
      '',
      'View: http://localhost:3000/requests?requestId=nested-bad-002',
      '--outer--',
    ])
    const bad = summarizeCapturedMessages([capturedMessage(truncatedNested, [REQUESTER_A])])[0]
    assert.equal(bad.requestId, null)
    assert.equal(bad.requestIdIssue, 'malformed-multipart-framing')
  })
})

describe('mail-capture request id link-context integrity (Task34 P1s)', () => {
  function evaluatorCreateStatus(messages: CapturedMailSummaryMessage[], request: { id: string; title: string }): string | undefined {
    const checks = evaluateCapturedMailEvidence({
      messages,
      requests: [request],
      routesConfig: 'all-defaults',
    })
    return checks.find((check) => check.name === 'mail-evidence/Business T12A/create-approval-needed-to-current-candidates')?.status
  }

  function plainTextRaw(body: string): string {
    return ['Subject: Approval Needed: ' + TITLE, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', body].join('\n')
  }

  function htmlRaw(body: string): string {
    return ['Subject: Approval Needed: ' + TITLE, 'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8', '', body].join('\n')
  }

  function summarizeOne(raw: string): CapturedMailSummaryMessage {
    return summarizeCapturedMessages([capturedMessage(raw, [SUPERVISOR_P, SECOND_APPROVER])])[0]
  }

  it('quoted href value is taken WHOLE: requestId=abc)other is invalid, never prefix abc', () => {
    const summary = summarizeOne(htmlRaw('<a href="/requests?requestId=abc)other">View</a>'))
    assert.equal(summary.requestId, null, 'a parenthesis inside the quoted URL must not terminate the value')
    assert.equal(summary.requestIdIssue, 'invalid-request-id-value')
    assert.equal(evaluatorCreateStatus([summary], { id: 'abc', title: TITLE }), 'fail', 'request abc must not join')
  })

  it('exact query key only: /requests?notrequestId=abc extracts NOTHING and raises no issue', () => {
    const summary = summarizeOne(plainTextRaw('see /requests?notrequestId=abc now'))
    assert.equal(summary.requestId, null, 'no requestId query key exists — nothing may be extracted')
    assert.equal(summary.requestIdIssue, undefined)
    // Genuinely id-less: the intended title fallback still applies (a
    // non-query-key lookalike is prose, not an explicit unusable id).
    assert.equal(evaluatorCreateStatus([summary], { id: 'abc', title: TITLE }), 'pass', 'genuine id-less title join is retained')
    // And it never joins a DIFFERENT request's row when the title mismatches
    // (mismatched-title negative; still a T12A-prefixed row so the scenario
    // checks are actually emitted).
    assert.equal(evaluatorCreateStatus([summary], { id: 'abc', title: 'Business T12A OTHER-ROW' }), 'fail')
  })

  it('exact requestId on an UNSUPPORTED link path flags unsupported-request-link (no title fallback)', () => {
    const summary = summarizeOne(plainTextRaw('track https://analytics.example.com/track?requestId=abc end'))
    assert.equal(summary.requestId, null)
    assert.equal(summary.requestIdIssue, 'unsupported-request-link')
    assert.equal(evaluatorCreateStatus([summary], { id: 'abc', title: TITLE }), 'fail', 'explicit id on a foreign link must not title-fallback')
  })

  it('distinguishes malformed percent escapes from percent-valid but decoded-invalid values', () => {
    const malformed = summarizeOne(plainTextRaw('a /requests?requestId=abc%ZZ b'))
    assert.equal(malformed.requestId, null)
    assert.equal(malformed.requestIdIssue, 'malformed-request-id-encoding')
    const dangling = summarizeOne(plainTextRaw('a /requests?requestId=abc% b'))
    assert.equal(dangling.requestId, null)
    assert.equal(dangling.requestIdIssue, 'malformed-request-id-encoding')
    // Percent-VALID escape that decodes outside the canonical charset:
    const decodedInvalid = summarizeOne(plainTextRaw('a /requests?requestId=abc%2Fother b'))
    assert.equal(decodedInvalid.requestId, null)
    assert.equal(decodedInvalid.requestIdIssue, 'invalid-request-id-value')
    // Percent-valid escape decoding INTO the canonical charset is accepted
    // per the decode contract (producer ids need no escaping, but decoding is
    // canonical-validated when present).
    const decodedValid = summarizeOne(plainTextRaw('a /requests?requestId=a%2Db b'))
    assert.equal(decodedValid.requestId, 'a-b')
    assert.equal(decodedValid.requestIdIssue, undefined)
  })

  it('flags a multipart PART missing its header/body separator (no title fallback)', () => {
    const raw = [
      'Subject: Approval Needed: ' + TITLE,
      'MIME-Version: 1.0',
      'Content-Type: multipart/alternative; boundary="b"',
      '',
      '--b',
      'Content-Type: text/plain; charset=utf-8',
      'no blank line; requestId=conflicting-link',
      '--b--',
    ].join('\n')
    const summary = summarizeOne(raw)
    assert.equal(summary.requestId, null)
    assert.equal(summary.requestIdIssue, 'malformed-multipart-framing')
    assert.equal(evaluatorCreateStatus([summary], { id: 'abc', title: TITLE }), 'fail', 'malformed part framing must not title-fallback')
  })

  it('flags multipart content-type without a boundary parameter (no title fallback)', () => {
    const raw = [
      'Subject: Approval Needed: ' + TITLE,
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed',
      '',
      'requestId=abc',
    ].join('\n')
    const summary = summarizeOne(raw)
    assert.equal(summary.requestId, null)
    assert.equal(summary.requestIdIssue, 'malformed-multipart-framing')
    assert.equal(evaluatorCreateStatus([summary], { id: 'abc', title: TITLE }), 'fail')
  })

  it('retains producer-shaped generated MIME links after the context switch (wire smoke)', async () => {
    const raw = await renderWireMail(notificationMail({ id: 'wire-still-works-01', subject: 'Request Completed' }))
    const summary = summarizeCapturedMessages([capturedMessage(raw, [REQUESTER_A])])[0]
    assert.equal(summary.requestId, 'wire-still-works-01')
    assert.equal(summary.requestIdIssue, undefined)
  })
})

describe('mail-capture multiline quoted href integrity (Task35 P1)', () => {
  function evaluatorCreateStatus(messages: CapturedMailSummaryMessage[], request: { id: string; title: string }): string | undefined {
    const checks = evaluateCapturedMailEvidence({
      messages,
      requests: [request],
      routesConfig: 'all-defaults',
    })
    return checks.find((check) => check.name === 'mail-evidence/Business T12A/create-approval-needed-to-current-candidates')?.status
  }

  function htmlSummary(body: string): CapturedMailSummaryMessage {
    const raw = ['Subject: Approval Needed: ' + TITLE, 'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8', '', body].join('\n')
    return summarizeCapturedMessages([capturedMessage(raw, [SUPERVISOR_P, SECOND_APPROVER])])[0]
  }

  it('multiline LF inside a quoted href is taken WHOLE and rejected — never prefix abc, no title join', () => {
    const summary = htmlSummary('<a href="/requests?requestId=abc\nother">View</a>')
    assert.equal(summary.requestId, null, 'a newline inside the quoted URL must not let a prefix leak')
    assert.equal(summary.requestIdIssue, 'malformed-request-link')
    assert.equal(evaluatorCreateStatus([summary], { id: 'abc', title: TITLE }), 'fail', 'request abc must not join even with matching title')
  })

  it('CRLF and single-quote multiline href variants reject the same way', () => {
    const crlf = htmlSummary('<a href="/requests?requestId=abc\r\nother">View</a>')
    assert.equal(crlf.requestId, null)
    assert.equal(crlf.requestIdIssue, 'malformed-request-link')
    const single = htmlSummary("<a href='/requests?requestId=abc\nother'>View</a>")
    assert.equal(single.requestId, null)
    assert.equal(single.requestIdIssue, 'malformed-request-link')
  })

  it('a raw TAB inside a quoted href is rejected as a malformed link (no silent normalization)', () => {
    const summary = htmlSummary('<a href="/requests?requestId=abc\tother">View</a>')
    assert.equal(summary.requestId, null)
    assert.equal(summary.requestIdIssue, 'malformed-request-link')
  })

  it('an UNCLOSED href quote fails closed — the plain scan cannot salvage a prefix inside it', () => {
    const summary = htmlSummary('<a href="/requests?requestId=abc trailing text without a close')
    assert.equal(summary.requestId, null)
    assert.equal(summary.requestIdIssue, 'malformed-request-link')
    assert.equal(evaluatorCreateStatus([summary], { id: 'abc', title: TITLE }), 'fail')
  })

  it('whitespace around the href equals sign is still a supported quoted attribute', () => {
    const summary = htmlSummary('<a href = "/requests?requestId=spaced-attr-01">View</a>')
    assert.equal(summary.requestId, 'spaced-attr-01')
    assert.equal(summary.requestIdIssue, undefined)
  })

  it('valid single-line producer href links still extract exactly (wire smoke)', async () => {
    const raw = await renderWireMail(notificationMail({ id: 'producer-ok-35', subject: 'Request Completed' }))
    const summary = summarizeCapturedMessages([capturedMessage(raw, [REQUESTER_A])])[0]
    assert.equal(summary.requestId, 'producer-ok-35')
    assert.equal(summary.requestIdIssue, undefined)
  })
})

describe('mail-capture href equals-whitespace integrity (Task36 P1)', () => {
  function evaluatorCreateStatus(messages: CapturedMailSummaryMessage[], request: { id: string; title: string }): string | undefined {
    const checks = evaluateCapturedMailEvidence({
      messages,
      requests: [request],
      routesConfig: 'all-defaults',
    })
    return checks.find((check) => check.name === 'mail-evidence/Business T12A/create-approval-needed-to-current-candidates')?.status
  }

  function htmlSummary(body: string): CapturedMailSummaryMessage {
    const raw = ['Subject: Approval Needed: ' + TITLE, 'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8', '', body].join('\n')
    return summarizeCapturedMessages([capturedMessage(raw, [SUPERVISOR_P, SECOND_APPROVER])])[0]
  }

  /** HTML ASCII whitespace exactly: space, tab, LF, FF, CR (never arbitrary
   * Unicode \s) — the spec's allowed separators around an attribute equals
   * sign. */
  const HTML_ASCII_WS = [' ', '\t', '\n', '\f', '\r'] as const
  const QUOTES = ['"', "'"] as const

  it('table: every ASCII whitespace before/after the equals sign is a quoted attribute (valid URLs still extract)', () => {
    let validCases = 0
    for (const ws of HTML_ASCII_WS) {
      for (const quote of QUOTES) {
        for (const [before, after] of [[ws, ''], ['', ws], [ws, ws]] as const) {
          const summary = htmlSummary(`<a href${before}=${after}${quote}/requests?requestId=tab-ok-01${quote}>View</a>`)
          assert.equal(summary.requestId, 'tab-ok-01', `valid URL lost for ws=${JSON.stringify(ws)} quote=${quote} before=${JSON.stringify(before)} after=${JSON.stringify(after)}`)
          assert.equal(summary.requestIdIssue, undefined)
          validCases += 1
        }
      }
    }
    assert.ok(validCases >= 30, `table cross-product executed (${validCases} cases)`)
  })

  it('table: multiline malformed URLs behind equals-whitespace never yield abc (evaluator negatives)', () => {
    for (const ws of HTML_ASCII_WS) {
      for (const quote of QUOTES) {
        for (const [before, after] of [[ws, ''], ['', ws], [ws, ws]] as const) {
          const summary = htmlSummary(`<a href${before}=${after}${quote}/requests?requestId=abc\nother${quote}>View</a>`)
          assert.equal(summary.requestId, null, `prefix leaked for ws=${JSON.stringify(ws)} quote=${quote}`)
          assert.equal(summary.requestIdIssue, 'malformed-request-link')
          assert.equal(
            evaluatorCreateStatus([summary], { id: 'abc', title: TITLE }),
            'fail',
            `request abc joined for ws=${JSON.stringify(ws)} quote=${quote} with matching title`,
          )
        }
      }
    }
  })

  it('CRLF sequences and mixed whitespace around the equals sign behave identically', () => {
    for (const mixed of ['\r\n', ' \t\n\r\f ', '\t\r\n']) {
      const valid = htmlSummary(`<a href${mixed}=${mixed}"/requests?requestId=mixed-ok-01">View</a>`)
      assert.equal(valid.requestId, 'mixed-ok-01', `valid URL lost for mixed ws=${JSON.stringify(mixed)}`)
      assert.equal(valid.requestIdIssue, undefined)
      const malformed = htmlSummary(`<a href${mixed}=${mixed}"/requests?requestId=abc\nother">View</a>`)
      assert.equal(malformed.requestId, null, `prefix leaked for mixed ws=${JSON.stringify(mixed)}`)
      assert.equal(malformed.requestIdIssue, 'malformed-request-link')
      assert.equal(evaluatorCreateStatus([malformed], { id: 'abc', title: TITLE }), 'fail')
    }
  })
})

describe('mail-capture unquoted href integrity (Task37 P1)', () => {
  function evaluatorCreateStatus(messages: CapturedMailSummaryMessage[], request: { id: string; title: string }): string | undefined {
    const checks = evaluateCapturedMailEvidence({
      messages,
      requests: [request],
      routesConfig: 'all-defaults',
    })
    return checks.find((check) => check.name === 'mail-evidence/Business T12A/create-approval-needed-to-current-candidates')?.status
  }

  function htmlSummary(body: string): CapturedMailSummaryMessage {
    const raw = ['Subject: Approval Needed: ' + TITLE, 'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8', '', body].join('\n')
    return summarizeCapturedMessages([capturedMessage(raw, [SUPERVISOR_P, SECOND_APPROVER])])[0]
  }

  it('reviewer case: href= ="…abc\nother…" is a malformed attribute — never abc, no title join', () => {
    const summary = htmlSummary('<a href= ="/requests?requestId=abc\nother">View</a>')
    assert.equal(summary.requestId, null, 'the unquoted branch must not leave the attribute interior to the plain scan')
    assert.equal(summary.requestIdIssue, 'malformed-request-link')
    assert.equal(evaluatorCreateStatus([summary], { id: 'abc', title: TITLE }), 'fail', 'matching title must not join request abc')
  })

  it('unquoted values containing = (query separator), quotes, backtick or < are malformed, fail closed', () => {
    for (const body of [
      '<a href=/requests?requestId=abc>View</a>',
      '<a href=/requests?requestId="abc>View</a>',
      '<a href=`/requests?requestId=abc>View</a>',
      '<a href=/requests?<filter>>View</a>',
    ]) {
      const summary = htmlSummary(body)
      assert.equal(summary.requestId, null, `prefix must not leak for ${JSON.stringify(body)}`)
      assert.equal(summary.requestIdIssue, 'malformed-request-link', `expected malformed-request-link for ${JSON.stringify(body)}`)
    }
  })

  it('empty or missing unquoted href values are malformed (no silent id-less)', () => {
    for (const body of ['<a href=>View</a>', '<a href= >View</a>', '<a href=\n>View</a>']) {
      const summary = htmlSummary(body)
      assert.equal(summary.requestId, null)
      assert.equal(summary.requestIdIssue, 'malformed-request-link', `expected malformed-request-link for ${JSON.stringify(body)}`)
    }
  })

  it('valid unquoted href values (no forbidden chars) consume cleanly and collide with nothing', () => {
    for (const body of [
      '<a href=/requests>View</a>',
      '<a href=/requests/my-actions>View</a>',
      '<a href=https://localhost:3000/requests>View</a>',
      '<a href\n=\n/requests>View</a>',
    ]) {
      const summary = htmlSummary(body)
      assert.equal(summary.requestId, null, `no id expected for ${JSON.stringify(body)}`)
      assert.equal(summary.requestIdIssue, undefined, `valid unquoted attribute must not flag for ${JSON.stringify(body)}`)
    }
  })

  it('plain tokens are never scanned inside HTML tag syntax (non-href attributes too)', () => {
    const inside = htmlSummary('<img src="/requests?requestId=abc" alt="pic">')
    assert.equal(inside.requestId, null, 'an img-src URL inside tag syntax must not be plain-scanned')
    assert.equal(inside.requestIdIssue, undefined, 'non-href tag content is genuinely id-less, not an error')
    // The same URL in PLAIN TEXT (outside any tag) still extracts — text/plain
    // mails are unaffected by the tag-syntax exclusion.
    const plainRaw = ['Subject: Approval Needed: ' + TITLE, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', 'see /requests?requestId=abc end'].join('\n')
    const plain = summarizeCapturedMessages([capturedMessage(plainRaw, [SUPERVISOR_P, SECOND_APPROVER])])[0]
    assert.equal(plain.requestId, 'abc')
    assert.equal(plain.requestIdIssue, undefined)
  })
})

describe('mail-capture htmlparser2 HTML-context integrity (Task39)', () => {
  function evaluatorCreateStatus(messages: CapturedMailSummaryMessage[], request: { id: string; title: string }): string | undefined {
    const checks = evaluateCapturedMailEvidence({
      messages,
      requests: [request],
      routesConfig: 'all-defaults',
    })
    return checks.find((check) => check.name === 'mail-evidence/Business T12A/create-approval-needed-to-current-candidates')?.status
  }

  function htmlSummary(body: string): CapturedMailSummaryMessage {
    const raw = ['Subject: Approval Needed: ' + TITLE, 'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8', '', body].join('\n')
    return summarizeCapturedMessages([capturedMessage(raw, [SUPERVISOR_P, SECOND_APPROVER])])[0]
  }

  function plainSummary(body: string): CapturedMailSummaryMessage {
    const raw = ['Subject: Approval Needed: ' + TITLE, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', body].join('\n')
    return summarizeCapturedMessages([capturedMessage(raw, [SUPERVISOR_P, SECOND_APPROVER])])[0]
  }

  it('Astra span-title with "> /requests?requestId=abc": no id, no issue, mismatched title never joins; matching title still joins', () => {
    const summary = htmlSummary('<span title="> /requests?requestId=abc">Text</span>')
    assert.equal(summary.requestId, null, 'a quoted non-link attribute must not close a tag early')
    assert.equal(summary.requestIdIssue, undefined, 'a non-link attribute is genuinely id-less, not an error')
    assert.equal(evaluatorCreateStatus([summary], { id: 'abc', title: TITLE }), 'pass', 'genuine id-less title join is retained')
    assert.equal(evaluatorCreateStatus([summary], { id: 'abc', title: 'Business T12A MISMATCHED-ROW' }), 'fail', 'mismatched title must not join request abc')
  })

  it('Astra span-title with nested href=…: the quoted title value is not an href attribute — no id, no issue, no mismatched-title join', () => {
    const summary = htmlSummary("<span title=\"href='/requests?requestId=abc'\">Text</span>")
    assert.equal(summary.requestId, null, 'href= inside another attribute value is not an attribute position')
    assert.equal(summary.requestIdIssue, undefined)
    assert.equal(evaluatorCreateStatus([summary], { id: 'abc', title: TITLE }), 'pass', 'genuine id-less title join is retained')
    assert.equal(evaluatorCreateStatus([summary], { id: 'abc', title: 'Business T12A MISMATCHED-ROW' }), 'fail')
  })

  it('href/URL inside a comment or script/style rawtext manufactures nothing (genuinely id-less)', () => {
    for (const body of [
      '<!-- <a href="/requests?requestId=abc">hidden</a> --><p>visible</p>',
      '<script>var u = "/requests?requestId=abc";</script>',
      '<style>a[href^="/requests?requestId=abc"] { color: red; }</style>',
    ]) {
      const summary = htmlSummary(body)
      assert.equal(summary.requestId, null, `comment/rawtext content must not be scanned for ${JSON.stringify(body)}`)
      assert.equal(summary.requestIdIssue, undefined, `comment/rawtext is genuinely id-less for ${JSON.stringify(body)}`)
    }
  })

  it('entity-decoded query separators and keys behave as their decoded characters', () => {
    const equals = htmlSummary('<a href="/requests?requestId&#61;entity-ok-01">View</a>')
    assert.equal(equals.requestId, 'entity-ok-01')
    assert.equal(equals.requestIdIssue, undefined)
    const amp = htmlSummary('<a href="/requests?tab=1&amp;requestId=entity-ok-02">View</a>')
    assert.equal(amp.requestId, 'entity-ok-02')
    assert.equal(amp.requestIdIssue, undefined)
  })

  it('media-type split: text/html never plain-scans visible URLs; text/plain has no tag semantics', () => {
    // HTML: the producer puts URLs ONLY in href attributes — a bare URL in
    // element text is not a link and must not be scanned.
    const html = htmlSummary('<p>see /requests?requestId=abc here</p>')
    assert.equal(html.requestId, null, 'text/html must not run the plain-URL scan')
    assert.equal(html.requestIdIssue, undefined)
    assert.equal(evaluatorCreateStatus([html], { id: 'abc', title: TITLE }), 'pass', 'genuinely id-less title join retained')
    // PLAIN: angle brackets are literal prose characters in text/plain, so
    // an anchor-looking token carries a visible URL (the prior harness
    // wrongly ran HTML tag exclusion on text/plain because the call site
    // dropped the media type). Fixture adapted to the proper media type.
    const plain = plainSummary('see <a href="/requests?requestId=abc">View</a> end')
    assert.equal(plain.requestId, 'abc')
    assert.equal(plain.requestIdIssue, undefined)
  })

  it('duplicate href on one tag is an ambiguous explicit identity — malformed, no title fallback', () => {
    const summary = htmlSummary('<a href="/requests?requestId=dup-a" href="/requests?requestId=dup-b">View</a>')
    assert.equal(summary.requestId, null)
    assert.equal(summary.requestIdIssue, 'malformed-request-link')
    assert.equal(evaluatorCreateStatus([summary], { id: 'dup-a', title: TITLE }), 'fail', 'ambiguous explicit ids must block title fallback')
  })

  it('double-equals href=="…" keeps the unquoted-value fail-closed semantics', () => {
    const summary = htmlSummary('<a href=="/requests?requestId=abc">View</a>')
    assert.equal(summary.requestId, null)
    assert.equal(summary.requestIdIssue, 'malformed-request-link')
    assert.equal(evaluatorCreateStatus([summary], { id: 'abc', title: TITLE }), 'fail')
  })

  it('a tag truncated at EOF (or an unclosed href quote) is never silently dropped to id-less — no partial join', () => {
    for (const body of [
      '<a href="/requests?requestId=abc',
      '<a href="/requests?requestId=abc >text without a close',
      '<p>ok</p><a href="/requests?requestId=abc',
    ]) {
      const summary = htmlSummary(body)
      assert.equal(summary.requestId, null, `truncated tag must not yield a partial id for ${JSON.stringify(body)}`)
      assert.equal(summary.requestIdIssue, 'malformed-request-link', `dropped explicit href must fail closed for ${JSON.stringify(body)}`)
      assert.equal(evaluatorCreateStatus([summary], { id: 'abc', title: TITLE }), 'fail', `matching title must not join for ${JSON.stringify(body)}`)
    }
  })

  it('mixed-case HREF on a real tag extracts; href as a substring of another attribute name does not', () => {
    const mixed = htmlSummary('<A HREF="/requests?requestId=case-ok-01">View</A>')
    assert.equal(mixed.requestId, 'case-ok-01')
    assert.equal(mixed.requestIdIssue, undefined)
    const substring = htmlSummary('<a data-href="/requests?requestId=abc">View</a>')
    assert.equal(substring.requestId, null, 'only actual href attributes on real tags are link positions')
    assert.equal(substring.requestIdIssue, undefined)
  })
})

describe('mail-capture EOF truncated-tag state integrity (Task40)', () => {
  function evaluatorCreateStatus(messages: CapturedMailSummaryMessage[], request: { id: string; title: string }): string | undefined {
    const checks = evaluateCapturedMailEvidence({
      messages,
      requests: [request],
      routesConfig: 'all-defaults',
    })
    return checks.find((check) => check.name === 'mail-evidence/Business T12A/create-approval-needed-to-current-candidates')?.status
  }

  function htmlSummary(body: string): CapturedMailSummaryMessage {
    const raw = ['Subject: Approval Needed: ' + TITLE, 'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8', '', body].join('\n')
    return summarizeCapturedMessages([capturedMessage(raw, [SUPERVISOR_P, SECOND_APPROVER])])[0]
  }

  it('Astra P1: <a title=">" href=/requests?requestId=abc (EOF) fails closed — no id, malformed, NO title fallback even with matching title', () => {
    // The quoted ">" in title defeats a [^>]* tail heuristic and the
    // tokenizer never flushes the unfinished unquoted value; the tag state
    // itself (tagname seen, never completed) is the truncation signal.
    for (const body of [
      '<a title=">" href=/requests?requestId=abc',
      '<a title=">" href=/requests?requestId=abc ',
      '<a title=">" href="/requests?requestId=abc',
    ]) {
      const summary = htmlSummary(body)
      assert.equal(summary.requestId, null, `no partial id may join for ${JSON.stringify(body)}`)
      assert.equal(summary.requestIdIssue, 'malformed-request-link', `truncated explicit link must fail closed for ${JSON.stringify(body)}`)
      assert.equal(evaluatorCreateStatus([summary], { id: 'abc', title: TITLE }), 'fail', `matching title must NOT join for ${JSON.stringify(body)}`)
    }
  })

  it('a truncated tag with NO href is conservatively malformed too (fixed explicit behavior, never id-less)', () => {
    const summary = htmlSummary('<p>ok</p> tail <a class="x"')
    assert.equal(summary.requestId, null)
    assert.equal(summary.requestIdIssue, 'malformed-request-link')
  })

  it('truncations that never enter tag-name state stay genuinely id-less (no over-flagging)', () => {
    // EOF inside a tag NAME and a truncated CLOSE tag emit no tag-name event
    // (offline probe), and a comment/rawtext never enters tag state — none
    // of these can set the pending-tag flag.
    for (const body of ['text <', 'text <a', 'text </div', '<!-- <a href="/requests?requestId=abc"> --']) {
      const summary = htmlSummary(body)
      assert.equal(summary.requestId, null, `no id expected for ${JSON.stringify(body)}`)
      assert.equal(summary.requestIdIssue, undefined, `no issue expected for ${JSON.stringify(body)}`)
    }
  })

  it('valid tags before a truncation still extract; only the malformed part fails the summary', () => {
    const summary = htmlSummary('<a href="/requests?requestId=ok-t40">y</a> tail <a href=/requests?requestId=abc')
    assert.equal(summary.requestId, null)
    assert.equal(summary.requestIdIssue, 'malformed-request-link')
  })
})

describe('mail evidence evaluator integration over decoded request ids', () => {
  it('decoded status_changed wire mail joins the EXACT DB request id — and under the in-app-only policy (owner decision 2026-09-25, Task45) that mail FAILS; Request Completed still passes', async () => {
    const REQUEST_ID = '66865424-2695-44cd-9ab4-8f0e-0123456789ab'
    const statusChanged = await renderWireMail(notificationMail({ id: REQUEST_ID, subject: 'Request Status Changed' }))
    const completed = await renderWireMail(notificationMail({ id: REQUEST_ID, subject: 'Request Completed' }))
    const messages = summarizeCapturedMessages([
      capturedMessage(statusChanged, [REQUESTER_A]),
      capturedMessage(completed, [REQUESTER_A]),
    ])
    assert.equal(messages[0].requestId, REQUEST_ID)
    assert.equal(messages[1].requestId, REQUEST_ID)
    const requests: MailEvidenceRequestRow[] = [{ id: REQUEST_ID, title: TITLE }]
    const checks = evaluateCapturedMailEvidence({ messages, requests, routesConfig: 'all-defaults' })
    const byName = new Map(checks.map((check) => [check.name, check.status]))
    // The decoding join is proven above; under the in-app-only channel
    // policy a "Request Status Changed" mail joined to the correlated
    // request is a policy violation, so the evaluator check FAILS (this
    // doubles as the exact-request scoping proof: the join worked).
    assert.equal(byName.get('mail-evidence/Business T12A/status-changed-in-app-only-no-email'), 'fail')
    assert.equal(byName.get('mail-evidence/Business T12A/request-completed-to-requester'), 'pass')
  })

  it('never title-fallbacks a title-bearing mail whose explicit ids conflict (no evaluator weakening)', async () => {
    const raw = await renderWireMail(
      notificationMail({ id: 'cuid-text-part-001', htmlId: 'cuid-html-part-002', subject: `Approval Needed: ${TITLE}` }),
    )
    const summary = summarizeCapturedMessages([capturedMessage(raw, [SUPERVISOR_P])])[0]
    const message: CapturedMailSummaryMessage = summary
    const requests: MailEvidenceRequestRow[] = [{ id: 'cuid-text-part-001', title: TITLE }]
    const checks = evaluateCapturedMailEvidence({ messages: [message], requests, routesConfig: 'all-defaults' })
    const create = checks.find((check) => check.name === 'mail-evidence/Business T12A/create-approval-needed-to-current-candidates')
    assert.ok(create)
    assert.equal(create.status, 'fail', 'conflicting explicit ids must not join via the title-bearing subject')
  })

  it('still title-joins genuinely id-less title-bearing mail (unchanged evaluator behavior)', () => {
    const message: CapturedMailSummaryMessage = {
      receivedAt: '2026-09-19T00:00:00.000Z',
      from: 'business-workflow-test@business.test',
      to: [SUPERVISOR_P, SECOND_APPROVER],
      subject: `Approval Needed: ${TITLE}`,
      requestId: null,
    }
    const requests: MailEvidenceRequestRow[] = [{ id: 'cuid-any-003', title: TITLE }]
    const checks = evaluateCapturedMailEvidence({ messages: [message], requests, routesConfig: 'all-defaults' })
    const create = checks.find((check) => check.name === 'mail-evidence/Business T12A/create-approval-needed-to-current-candidates')
    assert.ok(create)
    assert.equal(create.status, 'pass', 'an id-less title mail still joins by subject (pre-fix behavior)')
  })
})
