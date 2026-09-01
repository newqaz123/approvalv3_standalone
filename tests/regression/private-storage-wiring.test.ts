import { it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

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
  // Appended attachments are read through the private storage layer; the
  // package helper must not reconstruct the legacy public/ root itself.
  assert.match(pdfPackage, /readAttachmentFile/)
  assert.doesNotMatch(pdfPackage, /node:fs|process\.cwd/)
})

it('routes resubmitSolution attachments through private storage', () => {
  const solutions = readFileSync('src/server-actions/solutions.ts', 'utf8')
  const filesAction = readFileSync('src/server-actions/files.ts', 'utf8')
  // The live solution writer must not use the legacy public/uploads helpers.
  assert.doesNotMatch(solutions, /\bgenerateFilePath\b/)
  assert.doesNotMatch(solutions, /\bsaveFile\b/)
  // resubmitSolution consumes staged attachment IDs only (Task 4): it never
  // creates stored paths, writes files, or sanitizes raw filenames itself. New
  // attachments are staged through the authorized draft upload action in
  // files.ts, which owns the private write path. resubmitSolution only deletes
  // physical files (post-commit cleanup) through the private storage layer.
  assert.doesNotMatch(solutions, /createStoredAttachmentPath/)
  assert.doesNotMatch(solutions, /writeAttachmentFile/)
  assert.doesNotMatch(solutions, /sanitizeAttachmentFileName/)
  assert.match(solutions, /deleteAttachmentFile/)
  assert.match(filesAction, /createStoredAttachmentPath/)
  assert.match(filesAction, /writeAttachmentFile/)
})

// Path-based download hrefs (e.g. `/${filePath}`) bypass the authorized
// /api/files/download route and only work against the now-removed public/uploads
// root. Every client/server surface must resolve downloads from the attachment
// id instead.
const PATH_HREF = /`\/\$\{[^}]*filePath[^}]*\}`/

it('wires the live request detail page through authorized ID-based download URLs', () => {
  const page = readFileSync('src/app/(dashboard)/requests/[requestId]/page.tsx', 'utf8')
  // No direct path-based download hrefs for request or solution attachments.
  assert.doesNotMatch(page, PATH_HREF)
  assert.doesNotMatch(page, /handleDownload\(file\.filePath/)
  // Imports the authorized URL builder and resolves downloads from file.id.
  assert.match(page, /getFileDownloadUrl[^'\n]*from '@\/lib\/file-preview'/)
  assert.match(page, /getFileDownloadUrl\(file\.id\)/)
})

it('wires the solution detail component through authorized ID-based download URLs', () => {
  const detail = readFileSync('src/components/solutions/solution-detail.tsx', 'utf8')
  assert.doesNotMatch(detail, PATH_HREF)
  assert.match(detail, /getFileDownloadUrl\(file\.id\)/)
})

it('removes the dead two-step upload actions from the files server actions', () => {
  // prepareFileUpload / confirmFileUpload / confirmSolutionFileUpload had no
  // callers (the /api/upload route was deleted) and trusted caller-supplied
  // filePath values. Only the ID-keyed single-call upload actions remain.
  const actions = readFileSync('src/server-actions/files.ts', 'utf8')
  assert.doesNotMatch(actions, /export async function prepareFileUpload\b/)
  assert.doesNotMatch(actions, /export async function confirmFileUpload\b/)
  assert.doesNotMatch(actions, /export async function confirmSolutionFileUpload\b/)
  // The zod schema/interface that only supported those actions is gone too.
  assert.doesNotMatch(actions, /from 'zod'/)
})

it('deletes the legacy public/uploads file helper module', () => {
  // src/lib/files.ts was rooted at public/uploads and had no callers.
  assert.equal(existsSync('src/lib/files.ts'), false)
})
