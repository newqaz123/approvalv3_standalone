// Clean-start create-unit dialog (Plan C Task 10, supervisor ruling A).
// Component harness: renderToStaticMarkup (sibling UI pattern:
// tests/regression/clean-start-ui-unit-panel.test.ts). Source contracts pin
// the page wiring: the previously inert header "Create unit" button is
// replaced by the dialog trigger, and the dialog calls the existing
// createOrganizationUnit action (name + parent; leftover unitType SECTION
// until B15 — no inferred type, the company root exists from setup only).
// NO Prisma, NO database, NO env, NO schema/server ops.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { OrganizationUnitNode } from '@/lib/organization/model'
import {
  CreateUnitDialogView,
  createUnitParentOptions,
} from '@/components/organization/CreateUnitDialog'

const read = (path: string) => readFileSync(path, 'utf8')

function unit(
  id: string,
  name: string,
  parentId: string | null,
  extra: Partial<OrganizationUnitNode> = {},
): OrganizationUnitNode {
  return {
    id,
    name,
    parentId,
    isActive: true,
    shareRequests: false,
    canWorkOnSolutions: false,
    managerUserId: null,
    ...extra,
  }
}

describe('createUnitParentOptions', () => {
  it('lists only active units sorted by name — every unit is a legal parent (the root exists from setup only)', () => {
    const options = createUnitParentOptions([
      unit('company', 'Company', null),
      unit('ops', 'Operations', 'company'),
      unit('zeta', 'Zeta Line', 'ops', { isActive: false }),
      unit('section-b', 'Section B', 'ops'),
      unit('section-a', 'Section A', 'ops'),
    ])
    assert.deepEqual(
      options.map((row) => row.id),
      ['company', 'ops', 'section-a', 'section-b'],
    )
  })
})

describe('CreateUnitDialogView (SSR)', () => {
  function render(props: Partial<Parameters<typeof CreateUnitDialogView>[0]> = {}) {
    return renderToStaticMarkup(
      createElement(CreateUnitDialogView, {
        units: [unit('company', 'Company', null), unit('ops', 'Operations', 'company')],
        name: '',
        parentId: '',
        error: null,
        saving: false,
        onNameChange: () => {},
        onParentChange: () => {},
        onSave: () => {},
        onCancel: () => {},
        ...props,
      }),
    )
  }

  it('renders the name input, parent select, and Save/Cancel controls with stable testids', () => {
    const markup = render()
    assert.match(markup, /data-testid="create-unit-dialog"/)
    assert.match(markup, /data-testid="create-unit-name-input"/)
    assert.match(markup, /data-testid="create-unit-parent-select"/)
    assert.match(markup, /data-testid="create-unit-save"/)
    assert.match(markup, /data-testid="create-unit-cancel"/)
    assert.match(markup, /Unit name/)
    assert.match(markup, /Parent unit/)
    assert.doesNotMatch(markup, /create-unit-error/)
  })

  it('renders the adjacent error alert when a create fails', () => {
    const markup = render({ error: 'Name must be unique among sibling units' })
    assert.match(markup, /data-testid="create-unit-error"/)
    assert.match(markup, /role="alert"/)
    assert.match(markup, /Name must be unique among sibling units/)
  })

  it('disables Save while saving or before name and parent are chosen', () => {
    const idleEmpty = render()
    assert.match(idleEmpty, /data-testid="create-unit-save"[^>]*disabled/)
    const ready = render({ name: 'Journey Unit', parentId: 'ops' })
    assert.doesNotMatch(ready, /data-testid="create-unit-save"[^>]*disabled/)
    const busy = render({ name: 'Journey Unit', parentId: 'ops', saving: true })
    assert.match(busy, /data-testid="create-unit-save"[^>]*disabled/)
  })
})

describe('CreateUnitDialog source contracts', () => {
  const dialogSource = read('src/components/organization/CreateUnitDialog.tsx')
  const pageSource = read('src/app/admin/organization/page.tsx')

  it('calls the existing createOrganizationUnit action and refreshes the workspace on success', () => {
    assert.match(dialogSource, /import \{[^}]*createOrganizationUnit[^}]*\} from '@\/server-actions\/organization'/)
    assert.match(dialogSource, /router\.refresh\(\)/)
    assert.match(dialogSource, /await createOrganizationUnit\(\{\s*name,\s*parentId,?\s*\}\)/)
  })

  it('exposes the header trigger testid used by the browser journey', () => {
    assert.match(dialogSource, /data-testid="create-unit-open"/)
  })

  it('page.tsx wires the dialog in the header instead of the inert Create unit button', () => {
    assert.match(pageSource, /<CreateUnitDialog units=\{snapshot\.units\} \/>/)
    assert.doesNotMatch(pageSource, /<Button type="button">Create unit<\/Button>/)
  })

  it('no inferred unit type is surfaced (leftover unitType stays server-side until B15)', () => {
    assert.doesNotMatch(dialogSource, /unitType/)
  })
})
