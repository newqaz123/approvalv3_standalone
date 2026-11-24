import { expect } from '@playwright/test'
import { decodeBase64Part, decodeQuotedPrintable, type CapturedSmtpMessage } from '../native/mail-capture'

export function readWorkflowMail(
  { raw, from, to }: CapturedSmtpMessage,
  request: { id: string; createdAt: Date },
  baseUrl: string,
) {
  const split = raw.indexOf('\n\n')
  expect(split).toBeGreaterThan(0)
  const headers = raw.slice(0, split).replace(/\n[ \t]+/g, ' ')
  const rawSubject = /^Subject: (.+)$/im.exec(headers)?.[1]
  const boundary = /boundary="([^"]+)"/i.exec(headers)?.[1]
  if (!rawSubject || !boundary) throw new Error('Expected a subject and a multipart workflow message')
  const subject = rawSubject.replace(/(\?=)[ \t]+(?==\?)/g, '$1')
    .replace(/=\?UTF-8\?([BQ])\?([^?]+)\?=/gi, (_, encoding: string, word: string) => {
      const decoded = encoding.toUpperCase() === 'B'
        ? decodeBase64Part(word)
        : decodeQuotedPrintable(word.replaceAll('_', ' '))
      if (decoded === null) throw new Error('Invalid encoded subject in workflow mail')
      return decoded
    })
  const parts = raw.slice(split + 2).split(`--${boundary}`)
  expect(parts).toHaveLength(4)
  const [preamble, plain, html, end] = parts
  expect(preamble).toBe('')
  expect(end.trim()).toBe('--')

  const actionItems = /^(Approval Needed|Final Approval Needed):/.test(subject)
  const link = `${baseUrl}${actionItems ? '/requests/my-actions' : '/requests'}?requestId=${encodeURIComponent(request.id)}`
  const date = new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(request.createdAt)

  function readPart(part: string, format: 'plain' | 'html') {
    const split = part.indexOf('\n\n')
    expect(split).toBeGreaterThan(0)
    const headers = part.slice(0, split)
    expect(headers).toContain(`Content-Type: text/${format}; charset=utf-8`)
    const body = part.slice(split + 2)
    const encoding = /^Content-Transfer-Encoding: (.+)$/im.exec(headers)?.[1]
    const decoded = encoding === 'quoted-printable' ? decodeQuotedPrintable(body)
      : encoding === 'base64' ? decodeBase64Part(body)
        : encoding === '7bit' || encoding === '8bit' ? body : null
    if (decoded === null) throw new Error(`Invalid ${format} workflow mail part`)
    // The fresh requests have different generated IDs and creation times. Pin
    // their exact printed values before normalizing only those fixture fields.
    const linkField = format === 'plain' ? `View Request: ${link}\n` : `href="${link}"`
    expect(decoded).toContain(linkField)
    const dateField = format === 'plain' ? `- Created: ${date}\n` : `>${date}</td>`
    expect(decoded).toContain(dateField)
    return {
      headers,
      body: decoded.replace(linkField, linkField.replace(request.id, '[fixture request ID]'))
        .replace(dateField, dateField.replace(date, '[fixture creation time]')),
    }
  }

  return { from, to, rawSubject, subject, plain: readPart(plain, 'plain'), html: readPart(html, 'html') }
}
