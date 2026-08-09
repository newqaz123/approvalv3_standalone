import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

describe('formatted description editors', () => {
  it('uses the formatted textarea for new request descriptions', () => {
    const source = read('src/components/requests/request-form.tsx')
    assert.match(source, /FormattedTextarea/)
    assert.match(source, /name="description"/)
  })

  it('uses the formatted textarea in request resubmission', () => {
    const source = read('src/components/requests/request-resubmit-modal.tsx')
    assert.match(source, /FormattedTextarea/)
    assert.match(source, /id="description"/)
  })

  it('uses the formatted textarea for solution submission and resubmission', () => {
    const source = read('src/components/solutions/solution-form.tsx')
    const modal = read('src/components/requests/submitter-modal.tsx')
    assert.match(source, /FormattedTextarea/)
    assert.match(source, /name="description"/)
    assert.match(modal, /FormattedTextarea/)
    assert.match(modal, /solutionDescription/)
    assert.match(modal, /description/)
  })

  it('keeps the existing 5000-character validation limit', () => {
    assert.match(read('src/components/requests/request-form.tsx'), /max\(5000/)
    assert.match(read('src/components/solutions/solution-form.tsx'), /max\(5000/)
  })
})
