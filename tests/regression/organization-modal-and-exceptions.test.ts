import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { InTreeModal } from '@/components/organization/InTreeModal'
import { PositionDeleteConfirmation } from '@/components/organization/PositionAdminPanel'
import { RouteExceptionDeletionSection } from '@/components/organization/ApprovalChainsPanel'
import { normalizeEditorSteps } from '@/components/organization/RouteEditorPanel'

const read = (path: string) => readFileSync(path, 'utf8')

describe('organization modal presentation contract', () => {
  it('renders an opaque centered card with an in-card close control and reserved content lane', () => {
    const html = renderToStaticMarkup(createElement(
      InTreeModal,
      {
        open: true,
        onClose: () => {},
        ariaLabel: 'Test modal',
        className: 'max-w-sm',
        children: createElement('div', { 'data-testid': 'modal-child' }, 'Content'),
      },
    ))
    const dialogStart = html.indexOf('role="dialog"')
    const closeAt = html.indexOf('aria-label="Close"')
    const childAt = html.indexOf('data-testid="modal-child"')
    assert.ok(dialogStart >= 0, 'the open modal must render a dialog')
    assert.ok(closeAt > dialogStart, 'the close control must be inside the dialog')
    assert.ok(childAt > closeAt, 'content must follow the reserved close lane')
    const dialog = html.slice(dialogStart, childAt)
    assert.match(dialog, /rounded-lg/)
    assert.match(dialog, /border/)
    assert.match(dialog, /bg-card/)
    assert.match(dialog, /shadow/)
    assert.match(dialog, /max-h-\[calc\(100dvh-2rem\)\]/)
    assert.match(dialog, /overflow-hidden/)
    assert.match(html, /bg-black\/80/)
  })

  it('keeps dismiss behavior and makes the close callback stable across parent renders', () => {
    const modal = read('src/components/organization/InTreeModal.tsx')
    assert.match(modal, /onCloseRef/)
    assert.match(modal, /onCloseRef\.current\(\)/)
    assert.match(modal, /\}, \[open\]\)/)
    assert.match(modal, /event\.key === 'Escape'/)
    assert.match(modal, /event\.target === event\.currentTarget/)
    assert.match(modal, /onClick=\{onClose\}/)
  })

  it('keeps the Positions panel on its tab route without a header Close link', () => {
    const panel = read('src/components/organization/PositionAdminPanel.tsx')
    assert.doesNotMatch(panel, /data-testid="position-panel-close"/)
    assert.match(panel, /InTreeModal/)
    assert.match(panel, /ariaLabel="Edit position rank"/)
    assert.match(panel, /ariaLabel="Add position"/)
  })
})

describe('permanent position deletion confirmation', () => {
  it('names the inactive target and explains reference protection before mutation', () => {
    const html = renderToStaticMarkup(createElement(PositionDeleteConfirmation, {
      positionName: 'Legacy Reviewer',
      confirming: true,
      deleting: false,
      error: null,
      onConfirm: () => {},
      onCancel: () => {},
    }))
    assert.match(html, /data-testid="position-delete-confirmation"/)
    assert.match(html, /Legacy Reviewer/)
    assert.match(html, /permanently/i)
    assert.match(html, /referenc/i)
    assert.match(html, /histor/i)
    assert.match(html, /data-testid="position-delete-confirm"/)
    assert.match(html, /data-testid="position-delete-cancel"/)
  })

  it('does not expose the confirm action until the row is explicitly confirming', () => {
    const html = renderToStaticMarkup(createElement(PositionDeleteConfirmation, {
      positionName: 'Legacy Reviewer',
      confirming: false,
      deleting: false,
      error: null,
      onConfirm: () => {},
      onCancel: () => {},
    }))
    assert.doesNotMatch(html, /data-testid="position-delete-confirm"/)
    assert.doesNotMatch(html, /data-testid="position-delete-confirmation"/)
  })
})

describe('approval-chain rank ordering', () => {
  it('keeps selected steps ascending by rank and leaves unassigned placeholders last', () => {
    const positions = [
      { id: 'staff', name: 'Staff', rank: 1, isActive: true },
      { id: 'manager', name: 'Manager', rank: 3, isActive: true },
      { id: 'director', name: 'Director', rank: 4, isActive: true },
    ]
    const normalized = normalizeEditorSteps([
      { order: 1, positionId: 'director' },
      { order: 2, positionId: '' },
      { order: 3, positionId: 'staff' },
      { order: 4, positionId: 'manager' },
    ], positions)
    assert.deepEqual(normalized.map((step) => step.positionId), ['staff', 'manager', 'director', ''])
    assert.deepEqual(normalized.map((step) => step.order), [1, 2, 3, 4])
  })
})

describe('unit exception deletion confirmation', () => {
  it('names the unit and phase and explains inherited future routing plus history safety', () => {
    const html = renderToStaticMarkup(createElement(RouteExceptionDeletionSection, {
      unitName: 'Operations',
      phase: 'REQUEST',
      confirming: true,
      deleting: false,
      error: null,
      onConfirm: () => {},
      onCancel: () => {},
    }))
    assert.match(html, /data-testid="chains-exception-delete-confirmation"/)
    assert.match(html, /Operations/)
    assert.match(html, /Request/)
    assert.match(html, /inherited/i)
    assert.match(html, /future/i)
    assert.match(html, /histor/i)
    assert.match(html, /data-testid="chains-exception-delete-confirm"/)
    assert.match(html, /data-testid="chains-exception-delete-cancel"/)
  })
})
