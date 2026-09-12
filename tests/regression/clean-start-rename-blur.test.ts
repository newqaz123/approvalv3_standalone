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
// - review P1: a submit intent (Enter or blur) that arrives while a save is
//   in flight is QUEUED and serialized as ONE follow-up save of the latest
//   draft after the in-flight save settles — success OR failure; a success
//   reconciles the persisted baseline even when the draft is newer, so a
//   draft returned to the original still writes; Escape clears the queue
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
  takeQueuedInlineNameEditSubmit,
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

  it('blur while a save is pending queues the intent instead of requesting a second immediate save', () => {
    let session = startInlineNameEdit('Operations')
    session = typeInlineNameEdit(session, 'West Operations')
    const enter = requestInlineNameEditSubmit(session)
    assert.equal(enter.submit, true)
    const blur = requestInlineNameEditSubmit(enter.session)
    assert.equal(blur.submit, false)
    assert.equal(blur.session.pendingEpoch, enter.session.pendingEpoch)
    assert.equal(blur.session.editing, true)
    // The intent is preserved for the serialized follow-up, not dropped.
    assert.equal(blur.session.saveQueued, true)
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

  it('Escape clears a queued follow-up so the canceled editor cannot write later', () => {
    let session = startInlineNameEdit('Operations')
    session = typeInlineNameEdit(session, 'West Operations')
    session = requestInlineNameEditSubmit(session).session
    session = typeInlineNameEdit(session, 'Section C')
    session = requestInlineNameEditSubmit(session).session
    assert.equal(session.saveQueued, true)
    session = handleInlineNameEditKeyDown(session, 'Escape').session
    assert.equal(session.editing, false)
    assert.equal(session.saveQueued, false)
    const flush = takeQueuedInlineNameEditSubmit(session)
    assert.equal(flush.submit, false)
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

describe('serialized queued follow-up after an in-flight save settles (review P1)', () => {
  it('successful B then C: the blurred newer draft is submitted after B settles', async () => {
    const saves: string[] = []
    const settleB = deferred<void>()
    let session = startInlineNameEdit('Operations')
    session = typeInlineNameEdit(session, 'West Operations')
    const enter = requestInlineNameEditSubmit(session)
    assert.equal(enter.submit, true)
    session = enter.session
    const bEpoch = enter.session.epoch
    const bCompletion = submitInlineNameEdit(session, async (next) => {
      saves.push(next)
      await settleB.promise
    })
    // Type a newer draft and blur while B is still in flight.
    session = typeInlineNameEdit(session, 'Section C')
    const blur = requestInlineNameEditSubmit(session)
    assert.equal(blur.submit, false)
    assert.equal(blur.session.saveQueued, true)
    session = blur.session
    settleB.resolve()
    session = applyInlineNameEditResult(session, bEpoch, await bCompletion)
    // B succeeded while a newer draft existed: the persisted baseline is
    // reconciled to what the server holds, the newer draft is kept, and the
    // queued intent survives for the follow-up.
    assert.equal(session.original, 'West Operations')
    assert.equal(session.draft, 'Section C')
    assert.equal(session.editing, true)
    assert.equal(session.pendingEpoch, null)
    assert.equal(session.saveQueued, true)
    // The component flushes the queue as ONE follow-up save of the latest draft.
    const flush = takeQueuedInlineNameEditSubmit(session)
    assert.equal(flush.submit, true)
    assert.equal(flush.session.draft, 'Section C')
    assert.equal(flush.session.saveQueued, false)
    session = flush.session
    const cEpoch = flush.session.epoch
    const cCompletion = submitInlineNameEdit(session, async (next) => {
      saves.push(next)
    })
    session = applyInlineNameEditResult(session, cEpoch, await cCompletion)
    assert.deepEqual(saves, ['West Operations', 'Section C'])
    assert.equal(session.editing, false)
    assert.equal(session.original, 'Section C')
    assert.equal(session.draft, 'Section C')
    assert.equal(session.error, null)
    assert.equal(session.pendingEpoch, null)
    assert.equal(session.saveQueued, false)
  })

  it('rejected B then C: the queued follow-up still submits C after B fails', async () => {
    const saves: string[] = []
    const settleB = deferred<void>()
    let session = startInlineNameEdit('Operations')
    session = typeInlineNameEdit(session, 'West Operations')
    const enter = requestInlineNameEditSubmit(session)
    session = enter.session
    const bEpoch = enter.session.epoch
    const bCompletion = submitInlineNameEdit(session, async (next) => {
      saves.push(next)
      await settleB.promise
      throw new Error('Name must be unique among sibling units')
    })
    session = typeInlineNameEdit(session, 'Section C')
    session = requestInlineNameEditSubmit(session).session
    settleB.reject(new Error('Name must be unique among sibling units'))
    session = applyInlineNameEditResult(session, bEpoch, await bCompletion)
    // B failed against a newer draft: nothing persisted, the newer draft is
    // kept, and the queued intent survives the failure.
    assert.equal(session.original, 'Operations')
    assert.equal(session.draft, 'Section C')
    assert.equal(session.editing, true)
    assert.equal(session.pendingEpoch, null)
    assert.equal(session.saveQueued, true)
    const flush = takeQueuedInlineNameEditSubmit(session)
    assert.equal(flush.submit, true)
    session = flush.session
    const cEpoch = flush.session.epoch
    const cCompletion = submitInlineNameEdit(session, async (next) => {
      saves.push(next)
    })
    session = applyInlineNameEditResult(session, cEpoch, await cCompletion)
    assert.deepEqual(saves, ['West Operations', 'Section C'])
    assert.equal(session.editing, false)
    assert.equal(session.original, 'Section C')
    assert.equal(session.error, null)
  })

  it('latest failure: the queued C save that fails retains C and shows the adjacent error', async () => {
    const saves: string[] = []
    const settleB = deferred<void>()
    let session = startInlineNameEdit('Operations')
    session = typeInlineNameEdit(session, 'West Operations')
    const enter = requestInlineNameEditSubmit(session)
    session = enter.session
    const bEpoch = enter.session.epoch
    const bCompletion = submitInlineNameEdit(session, async (next) => {
      saves.push(next)
      await settleB.promise
    })
    session = typeInlineNameEdit(session, 'Section C')
    session = requestInlineNameEditSubmit(session).session
    settleB.resolve()
    session = applyInlineNameEditResult(session, bEpoch, await bCompletion)
    const flush = takeQueuedInlineNameEditSubmit(session)
    assert.equal(flush.submit, true)
    session = flush.session
    const cEpoch = flush.session.epoch
    const cCompletion = submitInlineNameEdit(session, async (next) => {
      saves.push(next)
      throw new Error('Name must be unique among sibling units')
    })
    session = applyInlineNameEditResult(session, cEpoch, await cCompletion)
    assert.deepEqual(saves, ['West Operations', 'Section C'])
    // The latest failure keeps the edited text, the editor, and an error.
    assert.equal(session.editing, true)
    assert.equal(session.draft, 'Section C')
    assert.equal(session.original, 'West Operations')
    assert.match(session.error ?? '', /unique/i)
    assert.equal(session.pendingEpoch, null)
    assert.equal(session.saveQueued, false)

    const html = renderToStaticMarkup(createElement(InlineNameEditView, {
      session,
      errorId: 'inline-name-error',
      disabled: false,
      onStart: () => undefined,
      onDraftChange: () => undefined,
      onKeyDown: () => undefined,
      onBlur: () => undefined,
    }))
    assert.match(html, /value="Section C"/)
    assert.match(html, /aria-describedby="inline-name-error"/)
    assert.match(html, /Name must be unique among sibling units/)
  })

  it('Escape cancels the queued follow-up: no second write, the canceled name stays', async () => {
    const saves: string[] = []
    const settleB = deferred<void>()
    let session = startInlineNameEdit('Operations')
    session = typeInlineNameEdit(session, 'West Operations')
    const enter = requestInlineNameEditSubmit(session)
    session = enter.session
    const bEpoch = enter.session.epoch
    const bCompletion = submitInlineNameEdit(session, async (next) => {
      saves.push(next)
      await settleB.promise
    })
    session = typeInlineNameEdit(session, 'Section C')
    session = requestInlineNameEditSubmit(session).session
    assert.equal(session.saveQueued, true)
    // Escape invalidates the queued work before B settles.
    session = handleInlineNameEditKeyDown(session, 'Escape').session
    assert.equal(session.editing, false)
    assert.equal(session.saveQueued, false)
    settleB.resolve()
    session = applyInlineNameEditResult(session, bEpoch, await bCompletion)
    // The already-issued B write is outside our control, but its late result
    // is dropped and no follow-up is flushed.
    assert.equal(session.editing, false)
    assert.equal(session.draft, 'Operations')
    const flush = takeQueuedInlineNameEditSubmit(session)
    assert.equal(flush.submit, false)
    assert.deepEqual(saves, ['West Operations'])
  })

  it('A to B and back to A: the reconciled baseline forces the write back to A', async () => {
    const saves: string[] = []
    const settleB = deferred<void>()
    let session = startInlineNameEdit('Operations')
    session = typeInlineNameEdit(session, 'West Operations')
    const enter = requestInlineNameEditSubmit(session)
    session = enter.session
    const bEpoch = enter.session.epoch
    const bCompletion = submitInlineNameEdit(session, async (next) => {
      saves.push(next)
      await settleB.promise
    })
    // Return the draft to the original name while B is pending, then blur.
    session = typeInlineNameEdit(session, 'Operations')
    session = requestInlineNameEditSubmit(session).session
    settleB.resolve()
    session = applyInlineNameEditResult(session, bEpoch, await bCompletion)
    // Without the reconciled baseline the stale original ('Operations') would
    // suppress the write and silently leave the server holding B.
    assert.equal(session.original, 'West Operations')
    assert.equal(session.draft, 'Operations')
    const flush = takeQueuedInlineNameEditSubmit(session)
    assert.equal(flush.submit, true)
    session = flush.session
    const aEpoch = flush.session.epoch
    const aCompletion = submitInlineNameEdit(session, async (next) => {
      saves.push(next)
    })
    session = applyInlineNameEditResult(session, aEpoch, await aCompletion)
    assert.deepEqual(saves, ['West Operations', 'Operations'])
    assert.equal(session.editing, false)
    assert.equal(session.original, 'Operations')
  })

  it('returning the draft to the original without a queued blur still writes after B settles', async () => {
    const saves: string[] = []
    const settleB = deferred<void>()
    let session = startInlineNameEdit('Operations')
    session = typeInlineNameEdit(session, 'West Operations')
    const enter = requestInlineNameEditSubmit(session)
    session = enter.session
    const bEpoch = enter.session.epoch
    const bCompletion = submitInlineNameEdit(session, async (next) => {
      saves.push(next)
      await settleB.promise
    })
    session = typeInlineNameEdit(session, 'Operations')
    settleB.resolve()
    session = applyInlineNameEditResult(session, bEpoch, await bCompletion)
    assert.equal(session.original, 'West Operations')
    assert.equal(session.draft, 'Operations')
    assert.equal(session.editing, true)
    assert.equal(session.saveQueued, false)
    // The later blur must still write: the draft differs from what the server
    // actually holds, not from the stale pre-B original.
    const blur = requestInlineNameEditSubmit(session)
    assert.equal(blur.submit, true)
    assert.deepEqual(saves, ['West Operations'])
  })

  it('queued intent is deduplicated: Enter, Enter, and blur while pending flush exactly one follow-up', async () => {
    const saves: string[] = []
    const settleB = deferred<void>()
    let session = startInlineNameEdit('Operations')
    session = typeInlineNameEdit(session, 'West Operations')
    const enter = requestInlineNameEditSubmit(session)
    session = enter.session
    const bEpoch = enter.session.epoch
    const bCompletion = submitInlineNameEdit(session, async (next) => {
      saves.push(next)
      await settleB.promise
    })
    session = typeInlineNameEdit(session, 'Section C')
    const secondEnter = requestInlineNameEditSubmit(session)
    assert.equal(secondEnter.submit, false)
    assert.equal(secondEnter.session.saveQueued, true)
    session = secondEnter.session
    const blur = requestInlineNameEditSubmit(session)
    assert.equal(blur.submit, false)
    assert.equal(blur.session.saveQueued, true)
    session = blur.session
    settleB.resolve()
    session = applyInlineNameEditResult(session, bEpoch, await bCompletion)
    const flush = takeQueuedInlineNameEditSubmit(session)
    assert.equal(flush.submit, true)
    session = flush.session
    const cEpoch = flush.session.epoch
    const cCompletion = submitInlineNameEdit(session, async (next) => {
      saves.push(next)
    })
    session = applyInlineNameEditResult(session, cEpoch, await cCompletion)
    assert.deepEqual(saves, ['West Operations', 'Section C'])
    assert.equal(session.editing, false)
  })

  it('unchanged queued draft closes without a second write after the settle', async () => {
    const saves: string[] = []
    const settleB = deferred<void>()
    let session = startInlineNameEdit('Operations')
    session = typeInlineNameEdit(session, 'West Operations')
    const enter = requestInlineNameEditSubmit(session)
    session = enter.session
    const bEpoch = enter.session.epoch
    const bCompletion = submitInlineNameEdit(session, async (next) => {
      saves.push(next)
      await settleB.promise
    })
    // Retype the same value (epoch bumps) and blur: the queued follow-up sees
    // an unchanged draft against the reconciled baseline and closes instead
    // of writing again.
    session = typeInlineNameEdit(session, 'West Operations')
    session = requestInlineNameEditSubmit(session).session
    settleB.resolve()
    session = applyInlineNameEditResult(session, bEpoch, await bCompletion)
    assert.equal(session.original, 'West Operations')
    const flush = takeQueuedInlineNameEditSubmit(session)
    assert.equal(flush.submit, false)
    assert.equal(flush.session.editing, false)
    assert.deepEqual(saves, ['West Operations'])
  })

  it('Enter then blur without typing settles without any follow-up write', async () => {
    const saves: string[] = []
    let session = startInlineNameEdit('Operations')
    session = typeInlineNameEdit(session, 'West Operations')
    const enter = requestInlineNameEditSubmit(session)
    session = enter.session
    const bEpoch = enter.session.epoch
    const bCompletion = submitInlineNameEdit(session, async (next) => {
      saves.push(next)
    })
    const blur = requestInlineNameEditSubmit(session)
    assert.equal(blur.submit, false)
    assert.equal(blur.session.saveQueued, true)
    session = blur.session
    session = applyInlineNameEditResult(session, bEpoch, await bCompletion)
    // Matching epoch: the success closes the editor and consumes the queue.
    assert.equal(session.editing, false)
    assert.equal(session.original, 'West Operations')
    assert.equal(session.saveQueued, false)
    const flush = takeQueuedInlineNameEditSubmit(session)
    assert.equal(flush.submit, false)
    assert.deepEqual(saves, ['West Operations'])
  })
})

describe('blur wiring covers both rename flows', () => {
  it('the input carries onBlur and the component funnels Enter and blur through requestInlineNameEditSubmit', () => {
    const editor = read('src/components/organization/InlineNameEdit.tsx')
    assert.match(editor, /onBlur=\{/)
    assert.match(editor, /requestInlineNameEditSubmit/)
  })

  it('the component serializes the queued follow-up after a save settles and guards it on teardown', () => {
    const editor = read('src/components/organization/InlineNameEdit.tsx')
    assert.match(editor, /flushQueuedSave/)
    assert.match(editor, /takeQueuedInlineNameEditSubmit/)
    assert.match(editor, /aliveRef/)
  })

  it('unit rows (TreeNodeRow) and position rows (PositionAdminPanel) share InlineNameEdit', () => {
    const tree = read('src/components/organization/TreeNodeRow.tsx')
    assert.match(tree, /InlineNameEdit/)
    const positions = read('src/components/organization/PositionAdminPanel.tsx')
    assert.match(positions, /InlineNameEdit/)
    assert.match(positions, /renamePosition/)
  })
})
