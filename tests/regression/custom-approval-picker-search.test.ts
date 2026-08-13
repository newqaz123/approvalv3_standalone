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

describe('CustomApprovalPicker search', () => {
  const source = read('src/components/solutions/custom-approval-picker.tsx')

  it('imports both shared search primitives and keeps a single exported picker', () => {
    assert.match(source, /import \{ filterApproversByQuery \} from ['"]@\/lib\/approver-search['"]/)
    assert.match(source, /import \{ ApproverSearchField \} from ['"]@\/components\/approvals\/approver-search-field['"]/)
    assert.match(source, /export function CustomApprovalPicker/)
    assert.match(source, /export \{ CustomApprovalPicker as SharedApprovalPickerHarness \}/)
    assert.doesNotMatch(source, /function SharedApprovalPickerHarness/)
    assert.equal((source.match(/export function /g) || []).length, 1)
  })

  it('excludes the current user and selected ids before searching', () => {
    assert.match(source, /user\.id !== currentUserId/)
    assert.match(source, /!selectedIds\.includes\(user\.id\)/)
    assert.match(source, /const filteredUsers = filterApproversByQuery\(availableUsers, searchValue\)/)
  })

  it('uses the command search field with external filtering and a bounded list', () => {
    assert.match(source, /<Command shouldFilter=\{false\}/)
    assert.match(source, /<CommandList className="max-h-\[260px\] overflow-y-auto"/)
    assert.match(source, /<ApproverSearchField inputKind="command"/)
    assert.match(source, /resultCount=\{filteredUsers\.length\}/)
    assert.match(source, /onOpenChange=\{handleOpenChange\}/)
  })

  it('distinguishes a search miss from exhausted selection', () => {
    assert.match(source, /<CommandEmpty>No approvers found<\/CommandEmpty>/)
    assert.match(
      source,
      /availableUsers\.length === 0 && \(\s*<p className="text-xs text-muted-foreground">No more users available<\/p>\s*\)/
    )
    assert.match(source, /disabled=\{disabled \|\| availableUsers\.length === 0\}/)
    assert.match(
      source,
      /availableUsers\.length > 0 && filteredUsers\.length === 0 && \(\s*<CommandEmpty>No approvers found<\/CommandEmpty>\s*\)/
    )
    assert.doesNotMatch(source, /No users found\./)
  })

  it('resets search on close and after selection and shows non-null level metadata', () => {
    assert.match(
      source,
      /const handleOpenChange = \(nextOpen: boolean\) => \{\s*setOpen\(nextOpen\)\s*if \(!nextOpen\) setSearchValue\(''\)\s*\}/
    )
    assert.match(source, /setOpen\(false\)\s*setSearchValue\(''\)/)
    assert.match(source, /user\.level != null/)
    assert.match(source, /Level \{user\.level\}/)
  })
})
