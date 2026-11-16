// Add sub-unit from the organization tree: name form + popover shell.
// Component harness: renderToStaticMarkup (sibling UI pattern:
// tests/regression/clean-start-ui-create-unit.test.ts). The popover asks for a
// name only — the parent is the hovered unit — and calls the existing
// createOrganizationUnit action. Real-browser behavior (hover reveal, Enter,
// Escape, overflow menu) lives in tree-add-child-unit-clicks.test.ts.
// NO Prisma, NO database, NO env, NO schema/server ops.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  AddChildUnitFormView,
  AddChildUnitPopover,
} from '@/components/organization/AddChildUnitPopover'

function tagByTestId(html: string, testId: string): string {
  const match = new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`).exec(html)
  assert.ok(match, `missing element with data-testid="${testId}"`)
  return match[0]
}

describe('AddChildUnitFormView', () => {
  function render(props: Partial<Parameters<typeof AddChildUnitFormView>[0]> = {}) {
    return renderToStaticMarkup(
      createElement(AddChildUnitFormView, {
        parentName: 'QC Section',
        name: '',
        error: null,
        saving: false,
        onNameChange: () => {},
        onSave: () => {},
        onCancel: () => {},
        ...props,
      }),
    )
  }

  it('titles the form with the parent name and labels the single name field', () => {
    const html = render()
    assert.match(html, /New unit under QC Section/)
    const input = tagByTestId(html, 'add-child-unit-name-input')
    const inputId = /\sid="([^"]+)"/.exec(input)?.[1]
    assert.ok(inputId, 'name input needs an id for its label')
    assert.match(html, new RegExp(`<label[^>]*for="${inputId}"[^>]*>Unit name</label>`))
    // The parent is the hovered unit: no parent picker in this form.
    assert.doesNotMatch(html, /create-unit-parent-select/)
    assert.doesNotMatch(html, /Parent unit/)
  })

  it('disables Create for a blank or whitespace-only name', () => {
    assert.match(tagByTestId(render({ name: '' }), 'add-child-unit-save'), /\sdisabled=""/)
    assert.match(tagByTestId(render({ name: '   ' }), 'add-child-unit-save'), /\sdisabled=""/)
  })

  it('enables Create once a name is typed', () => {
    const html = render({ name: 'Line 1' })
    assert.doesNotMatch(tagByTestId(html, 'add-child-unit-save'), /\sdisabled=""/)
    assert.match(tagByTestId(html, 'add-child-unit-name-input'), /value="Line 1"/)
  })

  it('disables Create and Cancel while saving', () => {
    const html = render({ name: 'Line 1', saving: true })
    assert.match(tagByTestId(html, 'add-child-unit-save'), /\sdisabled=""/)
    assert.match(tagByTestId(html, 'add-child-unit-cancel'), /\sdisabled=""/)
  })

  it('shows the server error as an alert and keeps the typed name', () => {
    const html = render({ name: 'Line 1', error: 'Name must be unique among sibling units' })
    const alert = tagByTestId(html, 'add-child-unit-error')
    assert.match(alert, /role="alert"/)
    assert.match(html, /data-testid="add-child-unit-error"[^>]*>Name must be unique among sibling units</)
    assert.match(tagByTestId(html, 'add-child-unit-name-input'), /value="Line 1"/)
  })

  it('renders no error element when there is no error', () => {
    const html = render({ name: 'Line 1' })
    assert.doesNotMatch(html, /add-child-unit-error/)
    assert.doesNotMatch(html, /role="alert"/)
  })

  it('is a form with a submit Create and a plain-button Cancel, so Enter submits', () => {
    const html = render({ name: 'Line 1' })
    assert.match(tagByTestId(html, 'add-child-unit-form'), /^<form/)
    assert.match(tagByTestId(html, 'add-child-unit-save'), /type="submit"/)
    assert.match(tagByTestId(html, 'add-child-unit-cancel'), /type="button"/)
    assert.match(html, /data-testid="add-child-unit-save"[^>]*>Create</)
    assert.match(html, /data-testid="add-child-unit-cancel"[^>]*>Cancel</)
  })
})

describe('AddChildUnitPopover', () => {
  it('renders the trigger button and anchor while closed, without the form', () => {
    const html = renderToStaticMarkup(
      createElement(AddChildUnitPopover, {
        unit: { id: 'qc', name: 'QC Section' },
        open: false,
        onOpenChange: () => {},
      }),
    )
    const button = tagByTestId(html, 'unit-add-child-qc')
    assert.match(button, /^<button/)
    assert.match(button, /type="button"/)
    assert.match(html, /data-testid="unit-add-child-qc"[^>]*>(?:<[^>]*>|[^<])*\+ Add unit/)
    const slot = tagByTestId(html, 'unit-add-child-slot-qc')
    assert.match(slot, /class="[^"]*\borganization-unit-add-child\b(?!-)[^"]*"/)
    assert.match(slot, /data-open="false"/)
    const anchor = tagByTestId(html, 'unit-add-child-anchor-qc')
    assert.match(anchor, /aria-hidden="true"/)
    assert.match(anchor, /class="[^"]*\borganization-unit-add-child-anchor\b[^"]*"/)
    assert.doesNotMatch(html, /add-child-unit-form/)
  })
})
