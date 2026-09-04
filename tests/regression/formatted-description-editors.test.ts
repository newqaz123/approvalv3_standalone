import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

describe('formatted description editors', () => {
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

  it('keeps the 20000-character rich description limit on active request and solution submissions', () => {
    const schemas = read('src/lib/schemas/solution-schemas.ts')
    const requests = read('src/server-actions/requests.ts')
    const modal = read('src/components/requests/submitter-modal.tsx')

    assert.match(schemas, /export const descriptionSchema = z[\s\S]*?\.max\(20000, 'Description too long'\)/)
    assert.match(requests, /description: descriptionSchema/)
    assert.match(modal, /id="description"[\s\S]*?inlineImages=\{inlineImages\}/)
    assert.match(modal, /id="solutionDescription"[\s\S]*?inlineImages=\{inlineImages\}/)
  })

  it('passes one inline image coordinator into every authoring editor surface', () => {
    for (const path of [
      'src/components/solutions/solution-form.tsx',
      'src/components/admin/template-form.tsx',
      'src/components/requests/resubmit-request-dialog.tsx',
      'src/components/requests/request-resubmit-modal.tsx',
    ]) {
      const source = read(path)
      assert.match(source, /useInlineDescriptionImages\(\)/, `${path} must create a coordinator`)
      assert.match(source, /inlineImages=\{inlineImages\}/, `${path} must pass the coordinator to its editor`)
    }

    // Both description modes in the submitter modal share one coordinator.
    const modal = read('src/components/requests/submitter-modal.tsx')
    assert.match(modal, /useInlineDescriptionImages\(\)/)
    assert.equal((modal.match(/inlineImages=\{inlineImages\}/g) ?? []).length, 2)
  })

  it('exposes paragraph alignment on the main formatting toolbar', () => {
    const source = read('src/components/rich-text/rich-text-editor.tsx')
    assert.match(source, /label="Align left"/)
    assert.match(source, /label="Align center"/)
    assert.match(source, /label="Align right"/)
    assert.match(source, /setRichTextBlockAlign/)
  })
})
