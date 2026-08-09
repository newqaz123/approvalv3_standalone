import { it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

it('routes every attachment filesystem operation through private storage', () => {
  const filesAction = readFileSync('src/server-actions/files.ts', 'utf8')
  const requestsAction = readFileSync('src/server-actions/requests.ts', 'utf8')
  const pdfPackage = readFileSync('src/lib/pdf-package.ts', 'utf8')
  for (const source of [filesAction, requestsAction, pdfPackage]) {
    assert.doesNotMatch(source, /join\(process\.cwd\(\), ['"]public/)
  }
  assert.match(filesAction, /writeAttachmentFile/)
  assert.match(filesAction, /deleteAttachmentFile/)
  assert.match(requestsAction, /deleteAttachmentFile/)
  assert.match(pdfPackage, /readAttachmentFile/)
})

it('routes resubmitSolution attachments through private storage', () => {
  const solutions = readFileSync('src/server-actions/solutions.ts', 'utf8')
  // The live solution writer must not use the legacy public/uploads helpers.
  assert.doesNotMatch(solutions, /\bgenerateFilePath\b/)
  assert.doesNotMatch(solutions, /\bsaveFile\b/)
  // New solution attachments are written through the private storage layer with
  // a sanitized filename so exports (pdf-package/readAttachmentFile) resolve
  // them under the private root instead of ENOENT on public/uploads.
  assert.match(solutions, /createStoredAttachmentPath/)
  assert.match(solutions, /writeAttachmentFile/)
  assert.match(solutions, /sanitizeAttachmentFileName/)
})
