import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

describe('formatted description editors', () => {
  it('uses the rich text editor for new request descriptions', () => {
    const source = read('src/components/requests/request-form.tsx')
    assert.match(source, /RichTextEditor/)
    assert.doesNotMatch(source, /<FormattedTextarea/)
    assert.match(source, /name="description"/)
  })

  it("uses the rich text editor in request resubmission", () => {
    const source = read('src/components/requests/request-resubmit-modal.tsx')
    assert.match(source, /RichTextEditor/)
    assert.doesNotMatch(source, /<FormattedTextarea/)
    assert.match(source, /id="description"/)

    const liveDialog = read('src/components/requests/resubmit-request-dialog.tsx')
    assert.match(liveDialog, /RichTextEditor/)
    assert.doesNotMatch(liveDialog, /<FormattedTextarea/)
    assert.match(liveDialog, /name="description"/)
  })

  it("uses the rich text editor for solution submission and resubmission", () => {
    const source = read('src/components/solutions/solution-form.tsx')
    const modal = read('src/components/requests/submitter-modal.tsx')
    assert.match(source, /RichTextEditor/)
    assert.doesNotMatch(source, /<FormattedTextarea/)
    assert.match(source, /name="description"/)
    assert.match(modal, /RichTextEditor/)
    assert.doesNotMatch(modal, /FormattedTextarea/)
    assert.match(modal, /solutionDescription/)
    assert.match(modal, /description/)
  })

  it('keeps the 20000-character rich description limit on client forms', () => {
    assert.match(read('src/components/requests/request-form.tsx'), /max\(20000/)
    assert.match(read('src/components/solutions/solution-form.tsx'), /max\(20000/)
    assert.match(read('src/components/requests/resubmit-request-dialog.tsx'), /max\(20000/)
    assert.doesNotMatch(read('src/components/requests/request-form.tsx'), /max\(5000/)
    assert.doesNotMatch(read('src/components/solutions/solution-form.tsx'), /max\(5000/)
    assert.doesNotMatch(read('src/components/requests/resubmit-request-dialog.tsx'), /max\(5000/)
  })
})
