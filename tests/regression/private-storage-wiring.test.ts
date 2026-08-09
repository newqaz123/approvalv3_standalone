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
