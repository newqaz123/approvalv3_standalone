import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')
const displayFiles = [
  'src/components/requests/approver-modal.tsx',
  'src/components/requests/solution-modal.tsx',
  'src/components/requests/status-modal.tsx',
  'src/components/requests/final-approval-modal.tsx',
  'src/components/requests/final-approval-resubmit-modal.tsx',
  'src/components/requests/submit-final-approval-modal.tsx',
  'src/components/requests/completed-solution-modal.tsx',
  'src/components/requests/completed-final-modal.tsx',
  'src/components/requests/completed-request-modal.tsx',
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

  it('completed-request modal renders request descriptions through FormattedText', () => {
    const source = read('src/components/requests/completed-request-modal.tsx')
    assert.match(source, /import \{ FormattedText \} from ['"]@\/components\/ui\/formatted-text['"]/)
    assert.match(source, /<FormattedText\s+source=\{data\.requestDescription\}\s*\/>/)
    assert.doesNotMatch(source, /<p>\s*\{data\.requestDescription\}\s*<\/p>/)
  })
})
