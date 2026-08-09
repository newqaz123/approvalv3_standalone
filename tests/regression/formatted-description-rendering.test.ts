import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')
const displayFiles = [
  'src/app/(dashboard)/requests/[requestId]/page.tsx',
  'src/components/requests/request-detail-modal.tsx',
  'src/components/requests/approver-modal.tsx',
  'src/components/requests/solution-modal.tsx',
  'src/components/requests/status-modal.tsx',
  'src/components/requests/final-approval-modal.tsx',
  'src/components/requests/final-approval-resubmit-modal.tsx',
  'src/components/requests/submit-final-approval-modal.tsx',
  'src/components/requests/completed-solution-modal.tsx',
  'src/components/requests/completed-final-modal.tsx',
  'src/components/solutions/solution-detail.tsx',
]

describe('formatted description rendering', () => {
  it('uses the safe React renderer at every request/solution description boundary', () => {
    for (const path of displayFiles) {
      const source = read(path)
      assert.match(source, /FormattedText/, path)
      assert.doesNotMatch(source, /dangerouslySetInnerHTML/, path)
    }
  })
})
