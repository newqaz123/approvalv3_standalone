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
  'src/components/requests/completed-request-modal.tsx',
  'src/components/solutions/solution-detail.tsx',
  'src/components/solutions/solution-preview.tsx',
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

  it('solution preview uses visible formatted truncation instead of raw source slice', () => {
    const source = read('src/components/solutions/solution-preview.tsx')
    assert.match(source, /import \{ FormattedText \} from ['"]@\/components\/ui\/formatted-text['"]/)
    assert.match(source, /visibleFormattedText/)
    assert.match(source, /FormattedText/)
    assert.match(source, /maxVisibleCharacters/)
    assert.doesNotMatch(source, /\.slice\(\s*0\s*,\s*300\s*\)/)
    assert.doesNotMatch(source, /data\.description\.length/)
    assert.match(
      source,
      /visibleFormattedText\(data\.description\)/,
    )
  })
})
