// Clean-start inline rename blur-save follow-up (owner-approved bounded UI).
// Component harness: session helpers + renderToStaticMarkup (sibling UI pattern:
// tests/regression/clean-start-ui-inline-rename.test.ts). Pure session machine
// only: NO Prisma, NO database, NO env, NO schema/server ops.
//
// Approved behavior under test:
// - unit AND position rename saves on blur (outside click or Tab)
// - Enter saves; Escape cancels WITHOUT blur resaving
// - failed saves retain the edited text and the adjacent error
// - no duplicate Enter+blur writes, no stale responses across edits/entity
//   switches, no unchanged-value writes
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  InlineNameEditView,
  applyInlineNameEditResult,
  cancelInlineNameEdit,
  handleInlineNameEditKeyDown,
  requestInlineNameEditSubmit,
  startInlineNameEdit,
  submitInlineNameEdit,
  typeInlineNameEdit,
} from '@/components/organization/InlineNameEdit'

const read = (path: string) => readFileSync(path, 'utf8')

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('InlineNameEdit blur/Enter/Escape session machine', () => {
  it('blur on a changed draft requests a save with the pending epoch', () => {
    let session = startInlineNameEdit('Operations')
    session = typeInlineNameEdit(session, 'West Operations')
    const request = requestInlineNameEditSubmit(session)
    assert.equal(request.submit, true)
    assert.equal(request.session.pendingEpoch, session.epoch)
    assert.equal(request.session.editing, true)
    assert.equal(request.session.draft, 'West Operations')
  })

  it('blur on an unchanged draft closes the editor without saving', () => {
    let session = startInlineNameEdit('Operations')
    session = typeInlineNameEdit(session, 'Operations')
    const request = requestInlineNameEditSubmit(session)
    assert.equal(request.submit, false)
    assert.equal(request.session.editing, false)
    assert.equal(request.session.draft, 'Operations')
    assert.equal(request.session.original, 'Operations')
    assert.equal(request.session.error, null)
    assert.equal(request.session.epoch, session.epoch + 1)
  })

  it('blur on a whitespace-only change to the same trimmed name closes without saving', () => {
    let session = startInlineNameEdit('Operations')
    session = typeInlineNameEdit(session, '  Operations  ')
    const request = requestInlineNameEditSubmit(session)
    assert.equal(request.submit, false)
    assert.equal(request.session.editing, false)
    assert.equal(request.session.draft, 'Operations')
  })

  it('blur while a save is pending does not request a second save', () => {
    let session = startInlineNameEdit('Operations')
    session = typeInlineNameEdit(session, 'West Operations')
    const enter = handleInlineNameEditKeyDown(session, 'Enter')
    assert.equal(enter.submit, true)
    const blur = requestInlineNameEditSubmit(enter.session)
    assert.equal(blur.submit, false)
    assert.equal(blur.session.pendingEpoch, enter.session.pendingEpoch)
    assert.equal(blur.session.editing, true)
  })

  it('blur while not editing is a no-op (epoch not bumped)', () => {
    let session = startInlineNameEdit('Operations')
    session = cancelInlineNameEdit(session)
    const request = requestInlineNameEditSubmit(session)
    assert.equal(request.submit, false)
    assert.deepEqual(request.session, session)
  })

  it('Enter on an unchanged draft closes the editor without writing', () => {
    let session = startInlineNameEdit('Operations')
    session = typeInlineNameEdit(session, 'Operations')
    const enter = handleInlineNameEditKeyDown(session, 'Enter')
    assert.equal(enter.submit, false)
    assert.equal(enter.session.editing, false)
    assert.equal(enter.session.draft, 'Operations')
  })

  it('Escape then blur does not resave: the canceled session is idle and blur is a no-op', () => {
    let session = startInlineNameEdit('Operations')
    session = typeInlineNameEdit(session, 'West Operations')
    session = handleInlineNameEditKeyDown(session, 'Escape').session
    assert.equal(session.editing, false)
    // The blur that follows the unmount of the input must be inert: the shared
    // request refuses to submit, so the component's runSave never reaches
    // onSave (runSave only submits when request.submit is true).
    const blur = requestInlineNameEditSubmit(session)
    assert.equal(blur.submit, false)
    assert.deepEqual(blur.session, session)
  })

  it('a failed blur save retains the edited text and the adjacent error', async () => {
    let session = startInlineNameEdit('Operations')
    session = typeInlineNameEdit(session, 'Section A')
    const request = requestInlineNameEditSubmit(session)
    assert.equal(request.submit, true)
    const result = await submitInlineNameEdit(request.session, async () => {
      throw new Error('Name must be unique among sibling units')
    })
    assert.equal(result.editing, true)
    assert.equal(result.draft, 'Section A')
    assert.equal(result.original, 'Operations')
    assert.match(result.error ?? '', /unique/i)

    const html = renderToStaticMarkup(createElement(InlineNameEditView, {
      session: result,
      errorId: 'inline-name-error',
      disabled: false,
      onStart: () => undefined,
      onDraftChange: () => undefined,
      onKeyDown: () => undefined,
      onBlur: () => undefined,
    }))
    assert.match(html, /value="Section A"/)
    assert.match(html, /aria-describedby="inline-name-error"/)
    assert.match(html, /Name must be unique among sibling units/)
  })

  it('Enter then blur produces exactly one save', async () => {
    const saves: string[] = []
    let session = startInlineNameEdit('Operations')
    session = typeInlineNameEdit(session, 'West Operations')
    const enter = handleInlineNameEditKeyDown(session, 'Enter')
    assert.equal(enter.submit, true)
    session = enter.session
    const blur = requestInlineNameEditSubmit(session)
    assert.equal(blur.submit, false)
    session = await submitInlineNameEdit(session, async (next) => {
      saves.push(next)
    })
    assert.deepEqual(saves, ['West Operations'])
    assert.equal(session.editing, false)
    assert.equal(session.original, 'West Operations')
  })

  it('a late blur-save success after Escape is dropped so the canceled editor stays canceled', async () => {
    const save = deferred<void>()
    let session = startInlineNameEdit('Operations')
    session = typeInlineNameEdit(session, 'West Operations')
    const blur = requestInlineNameEditSubmit(session)
    assert.equal(blur.submit, true)
    session = blur.session
    const epoch = session.epoch
    const completion = submitInlineNameEdit(session, async () => {
      await save.promise
    }).then((result) => {
      session = applyInlineNameEditResult(session, epoch, result)
    })
    session = handleInlineNameEditKeyDown(session, 'Escape').session
    assert.equal(session.editing, false)
    save.resolve()
    await completion
    assert.equal(session.editing, false)
    assert.equal(session.draft, 'Operations')
    assert.equal(session.original, 'Operations')
    assert.equal(session.pendingEpoch, null)
  })

  it('a late blur-save rejection after further typing keeps the newer draft', async () => {
    const save = deferred<void>()
    let session = startInlineNameEdit('Operations')
    session = typeInlineNameEdit(session, 'West Operations')
    const blur = requestInlineNameEditSubmit(session)
    session = blur.session
    const epoch = session.epoch
    const completion = submitInlineNameEdit(session, async () => {
      await save.promise
    }).then((result) => {
      session = applyInlineNameEditResult(session, epoch, result)
    })
    session = typeInlineNameEdit(session, 'Section C')
    save.reject(new Error('Name must be unique among sibling units'))
    await completion
    assert.equal(session.draft, 'Section C')
    assert.equal(session.editing, true)
    assert.equal(session.error, null)
    assert.equal(session.pendingEpoch, null)
  })
})

describe('blur wiring covers both rename flows', () => {
  it('the input carries onBlur and the component funnels Enter and blur through requestInlineNameEditSubmit', () => {
    const editor = read('src/components/organization/InlineNameEdit.tsx')
    assert.match(editor, /onBlur=\{/)
    assert.match(editor, /requestInlineNameEditSubmit/)
  })

  it('unit rows (TreeNodeRow) and position rows (PositionAdminPanel) share InlineNameEdit', () => {
    const tree = read('src/components/organization/TreeNodeRow.tsx')
    assert.match(tree, /InlineNameEdit/)
    const positions = read('src/components/organization/PositionAdminPanel.tsx')
    assert.match(positions, /InlineNameEdit/)
    assert.match(positions, /renamePosition/)
  })
})
