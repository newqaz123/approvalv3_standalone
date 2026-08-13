import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

describe('ApproverSearchField', () => {
  it('exposes an accessible search field with live result count', () => {
    const source = read('src/components/approvals/approver-search-field.tsx')

    assert.match(source, /Search approvers/)
    assert.match(source, /Search by name, email, role, or level/)
    assert.match(source, /role="status"/)
    assert.match(source, /aria-live="polite"/)
    assert.match(source, /1 approver/)
    assert.match(source, /approvers/)
    assert.match(source, /min-h-(?:11|\[44px\])/)
    assert.match(source, /focus-visible:/)
  })

  it('uses Input by default and CommandInput for command kind without picker ownership', () => {
    const source = read('src/components/approvals/approver-search-field.tsx')

    assert.match(source, /from ['"]@\/components\/ui\/input['"]/)
    assert.match(source, /CommandInput/)
    assert.match(source, /from ['"]lucide-react['"]/)
    assert.match(source, /\bSearch\b/)
    assert.match(source, /inputKind\s*=\s*['"]input['"]/)
    assert.match(source, /<CommandInput/)
    assert.match(source, /<Input/)
    assert.doesNotMatch(source, /selectedIds|setOpen|filterApproversByQuery|onSelect/)
  })
})
