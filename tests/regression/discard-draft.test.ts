import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  isDraftFieldDirty,
  requestDiscardDraft,
  shouldConfirmDiscardDraft,
} from '@/lib/discard-draft'

const read = (path: string) => readFileSync(path, 'utf8')

const CLEAN = {
  formIsDirty: false,
  hasFiles: false,
  hasInlineImageDrafts: false,
} as const

describe('shouldConfirmDiscardDraft', () => {
  it('does not confirm when the draft is untouched', () => {
    assert.equal(shouldConfirmDiscardDraft(CLEAN), false)
  })

  it('confirms when the form has unsaved field changes', () => {
    assert.equal(shouldConfirmDiscardDraft({ ...CLEAN, formIsDirty: true }), true)
  })

  it('confirms when files are staged', () => {
    assert.equal(shouldConfirmDiscardDraft({ ...CLEAN, hasFiles: true }), true)
  })

  it('confirms when inline image drafts are staged', () => {
    assert.equal(
      shouldConfirmDiscardDraft({ ...CLEAN, hasInlineImageDrafts: true }),
      true,
    )
  })
})

describe('isDraftFieldDirty', () => {
  it('treats empty markup as untouched', () => {
    assert.equal(isDraftFieldDirty('', ''), false)
    assert.equal(isDraftFieldDirty('<p></p>', ''), false)
    assert.equal(isDraftFieldDirty('<p></p>', '<p></p>'), false)
  })

  it('treats an inserted table as work to lose', () => {
    assert.equal(
      isDraftFieldDirty(
        '<table><tbody><tr><td></td></tr></tbody></table>',
        '',
      ),
      true,
    )
  })

  it('does not confirm when template HTML is unchanged', () => {
    const html = '<p>Template body</p>'
    assert.equal(isDraftFieldDirty(html, html), false)
  })
})

describe('requestDiscardDraft', () => {
  it('leaves immediately when the draft is untouched', () => {
    const calls: string[] = []
    requestDiscardDraft(CLEAN, () => calls.push('confirm'), () => calls.push('leave'))
    assert.deepEqual(calls, ['leave'])
  })

  it('asks for confirmation when the draft has work to lose', () => {
    const calls: string[] = []
    requestDiscardDraft(
      { ...CLEAN, formIsDirty: true },
      () => calls.push('confirm'),
      () => calls.push('leave'),
    )
    assert.deepEqual(calls, ['confirm'])
  })
})

describe('description table width', () => {
  it('lets description tables size to content instead of stretching full width', () => {
    const css = read('src/app/globals.css')
    const block = css.match(/\.rich-text table \{([^}]+)\}/)?.[1]
    assert.ok(block, 'expected a .rich-text table rule')
    assert.match(block, /width:\s*auto/)
    assert.match(block, /max-width:\s*100%/)
    assert.match(block, /table-layout:\s*fixed/)
    assert.doesNotMatch(block, /(?<!max-)width:\s*100%/)
  })

  it('gives inserted cells enough room for a caret without stretching full width', () => {
    const css = read('src/app/globals.css')
    const block = css.match(/\.rich-text th,\s*\.rich-text td \{([^}]+)\}/)?.[1]
    assert.ok(block, 'expected a .rich-text th, td rule')
    assert.match(block, /min-width:\s*8rem/)
    assert.match(block, /min-height:\s*2\.25rem/)
    const kit = read('src/components/rich-text/rich-table-extensions.ts')
    assert.match(kit, /Table\.configure\(\{ resizable: true, cellMinWidth: 120 \}\)/)
  })
})

describe('draft form cancel wiring', () => {
  it('request form confirms before discarding a dirty draft', () => {
    const source = read('src/components/requests/request-form.tsx')
    assert.match(source, /from ['"]@\/lib\/discard-draft['"]/)
    assert.match(source, /from ['"]@\/components\/ui\/discard-draft-dialog['"]/)
    assert.match(source, /requestDiscardDraft\(/)
    assert.match(source, /formIsDirty:\s*isDirty/)
    assert.match(source, /hasFiles:\s*selectedFiles\.length > 0/)
    assert.match(source, /hasInlineImageDrafts:\s*inlineImages\.getState\(\)\.length > 0/)
    assert.match(source, /<DiscardDraftDialog/)
    assert.match(source, /onClick=\{handleCancelClick\}/)
    const leave = source.split('const handleCancel = async')[1]?.split('const formatFileSize')[0] ?? ''
    assert.match(leave, /await inlineImages\.reset\(\)/)
    assert.match(leave, /router\.back\(\)/)
  })

  it('submitter modal confirms before discarding a dirty draft', () => {
    const source = read('src/components/requests/submitter-modal.tsx')
    assert.match(source, /from ['"]@\/lib\/discard-draft['"]/)
    assert.match(source, /from ['"]@\/components\/ui\/discard-draft-dialog['"]/)
    assert.match(source, /requestDiscardDraft\(/)
    assert.match(source, /isDraftFieldDirty\(/)
    assert.match(source, /hasFiles:\s*files\.length > 0 \|\| attachmentItems\.length > 0/)
    assert.match(source, /hasInlineImageDrafts:\s*inlineImages\.getState\(\)\.length > 0/)
    assert.match(source, /<DiscardDraftDialog/)
    assert.match(source, /const handleCloseWithCleanup = async/)
    assert.match(source, /await inlineImages\.reset\(\)/)
  })

  it('solution form confirms before discarding a dirty draft', () => {
    const source = read('src/components/solutions/solution-form.tsx')
    assert.match(source, /from ['"]@\/lib\/discard-draft['"]/)
    assert.match(source, /from ['"]@\/components\/ui\/discard-draft-dialog['"]/)
    assert.match(source, /requestDiscardDraft\(/)
    assert.match(source, /formIsDirty:\s*isDirty/)
    assert.match(source, /hasFiles:\s*items\.length > 0/)
    assert.match(source, /hasInlineImageDrafts:\s*inlineImages\.getState\(\)\.length > 0/)
    assert.match(source, /<DiscardDraftDialog/)
    assert.match(source, /onClick=\{handleCancelClick\}/)
    const leave = source.split('const handleCancel = async')[1]?.split('const handleSubmit')[0] ?? ''
    assert.match(leave, /await reset\(\)/)
    assert.match(leave, /await inlineImages\.reset\(\)/)
    assert.match(leave, /router\.back\(\)/)
  })
})
