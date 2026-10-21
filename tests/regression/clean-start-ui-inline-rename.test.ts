// Clean-start inline unit/team rename (Plan C Task 3).
// Component harness: session helpers + renderToStaticMarkup (sibling UI pattern:
// tests/regression/formatted-text-ui.test.ts, clean-start-ui-tree.test.ts).
// Action tests: in-memory fake OrganizationMutationDb only.
// NO Prisma, NO database, NO env, NO schema/server ops.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { OrganizationUnitNode, TeamNode } from '@/lib/organization/model'
import { OrganizationValidationError } from '@/lib/organization/assignments'
import {
  renameOrganizationUnit,
  renameTeam,
  type OrganizationMutationDb,
} from '@/lib/organization/workspace-admin'
import {
  InlineNameEdit,
  InlineNameEditView,
  applyInlineNameEditResult,
  cancelInlineNameEdit,
  handleInlineNameEditKeyDown,
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

function team(
  id: string,
  unitId: string,
  name: string,
  extra: Partial<TeamNode> = {},
): TeamNode {
  return {
    id,
    unitId,
    name,
    reportsToAssignmentId: 'asg-pat',
    isActive: true,
    ...extra,
  }
}

function makeMutationDb(over: {
  units?: OrganizationUnitNode[]
  teams?: TeamNode[]
} = {}) {
  const units = (over.units ?? [
    unit('company', 'Company', null),
    unit('ops', 'Operations', 'company'),
    unit('section-a', 'Section A', 'ops'),
    unit('section-b', 'Section B', 'ops'),
    unit('old-ops', 'Operations', 'company', { isActive: false }),
  ]).map((row) => ({ ...row }))
  const teams = (over.teams ?? [
    team('team-alpha', 'ops', 'Alpha Team'),
    team('team-beta', 'ops', 'Beta Team'),
    team('team-old', 'ops', 'Alpha Team', { isActive: false }),
    team('team-other', 'section-a', 'Alpha Team'),
  ]).map((row) => ({ ...row }))
  const audits: Array<{ action: string; comments: string }> = []
  const revalidated: string[] = []
  const instanceTouches: string[] = []
  let exclusive = Promise.resolve()
  const db: OrganizationMutationDb & {
    units: OrganizationUnitNode[]
    teams: TeamNode[]
    audits: Array<{ action: string; comments: string }>
    revalidated: string[]
    instanceTouches: string[]
  } = {
    adminUserId: 'admin-1',
    units,
    teams,
    audits,
    revalidated,
    instanceTouches,
    async loadUnits() {
      return units.map((row) => ({ ...row }))
    },
    async loadTeams() {
      return teams.map((row) => ({ ...row }))
    },
    async updateUnitName(id, name) {
      const row = units.find((candidate) => candidate.id === id)
      if (!row) throw new Error(`missing unit ${id}`)
      row.name = name
    },
    async updateTeamName(id, name) {
      const row = teams.find((candidate) => candidate.id === id)
      if (!row) throw new Error(`missing team ${id}`)
      row.name = name
    },
    async writeAudit(entry) {
      audits.push({ ...entry })
    },
    async revalidateOrganization() {
      revalidated.push('/admin/organization')
    },
    async runSerializable(fn) {
      const run = exclusive.then(() => fn(db))
      exclusive = run.then(() => undefined, () => undefined)
      return run
    },
  }
  return db
}

describe('InlineNameEdit component harness', () => {
  it('retains the typed value and adjacent error when onSave rejects', async () => {
    const saves: string[] = []
    const onSave = async (next: string) => {
      saves.push(next)
      throw new Error('Name must be unique among sibling units')
    }
    let session = startInlineNameEdit('Operations')
    session = typeInlineNameEdit(session, 'Section A')
    session = await submitInlineNameEdit(session, onSave)
    assert.deepEqual(saves, ['Section A'])
    assert.equal(session.draft, 'Section A')
    assert.equal(session.editing, true)
    assert.equal(session.original, 'Operations')
    assert.match(session.error ?? '', /unique/i)

    const html = renderToStaticMarkup(createElement(InlineNameEditView, {
      session,
      errorId: 'inline-name-error',
      disabled: false,
      onStart: () => undefined,
      onDraftChange: () => undefined,
      onKeyDown: () => undefined,
      onBlur: () => undefined,
    }))
    assert.match(html, /value="Section A"/)
    assert.match(html, /aria-describedby="inline-name-error"/)
    assert.match(html, /id="inline-name-error"/)
    assert.match(html, /Name must be unique among sibling units/)
  })

  it('Escape restores the original without persisting', async () => {
    const saves: string[] = []
    let session = startInlineNameEdit('Operations')
    session = typeInlineNameEdit(session, 'Ops')
    session = cancelInlineNameEdit(session)
    assert.equal(session.editing, false)
    assert.equal(session.draft, 'Operations')
    assert.equal(session.original, 'Operations')
    assert.equal(session.error, null)
    assert.deepEqual(saves, [])
  })

  it('Enter calls onSave with the trimmed value', async () => {
    const saves: string[] = []
    let session = startInlineNameEdit('Operations')
    session = typeInlineNameEdit(session, '  New Name  ')
    session = await submitInlineNameEdit(session, async (next) => {
      saves.push(next)
    })
    assert.deepEqual(saves, ['New Name'])
    assert.equal(session.editing, false)
    assert.equal(session.original, 'New Name')
    assert.equal(session.draft, 'New Name')
    assert.equal(session.error, null)
  })

  it('renders the saved name with a pencil and no input until edit', () => {
    const html = renderToStaticMarkup(createElement(InlineNameEdit, {
      value: 'Operations',
      onSave: async () => undefined,
    }))
    assert.match(html, /Operations/)
    assert.match(html, /aria-label="Rename"/)
    assert.doesNotMatch(html, /<input/)
  })

  it('ignores a stale rejecting save after Escape so the canceled editor is not restored', async () => {
    const save = deferred<void>()
    const saves: string[] = []
    let session = startInlineNameEdit('Operations')
    session = typeInlineNameEdit(session, 'Section A')
    const enter = handleInlineNameEditKeyDown(session, 'Enter')
    assert.equal(enter.submit, true)
    session = enter.session
    const epoch = session.epoch
    const completion = submitInlineNameEdit(session, async (next) => {
      saves.push(next)
      await save.promise
    }).then((result) => {
      session = applyInlineNameEditResult(session, epoch, result)
    })
    session = handleInlineNameEditKeyDown(session, 'Escape').session
    assert.equal(session.editing, false)
    assert.equal(session.draft, 'Operations')
    save.reject(new Error('Name must be unique among sibling units'))
    await completion
    assert.equal(session.editing, false)
    assert.equal(session.draft, 'Operations')
    assert.equal(session.error, null)
    assert.deepEqual(saves, ['Section A'])
  })

  it('keeps newer input when a pending save later rejects', async () => {
    const save = deferred<void>()
    let session = startInlineNameEdit('Operations')
    session = typeInlineNameEdit(session, 'Section A')
    const enter = handleInlineNameEditKeyDown(session, 'Enter')
    session = enter.session
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

  it('does not start a second save when Enter is pressed while pending', async () => {
    const save = deferred<void>()
    const saves: string[] = []
    let session = startInlineNameEdit('Operations')
    session = typeInlineNameEdit(session, 'Section A')
    const first = handleInlineNameEditKeyDown(session, 'Enter')
    session = first.session
    assert.equal(first.submit, true)
    const second = handleInlineNameEditKeyDown(session, 'Enter')
    assert.equal(second.submit, false)
    const epoch = session.epoch
    const completion = submitInlineNameEdit(session, async (next) => {
      saves.push(next)
      await save.promise
    }).then((result) => {
      session = applyInlineNameEditResult(session, epoch, result)
    })
    save.resolve()
    await completion
    assert.deepEqual(saves, ['Section A'])
    assert.equal(session.editing, false)
    assert.equal(session.original, 'Section A')
  })
})

describe('renameOrganizationUnit / renameTeam fake db', () => {
  it('rejects a duplicate sibling unit name matching /unique/i without writing', async () => {
    const db = makeMutationDb()
    await assert.rejects(
      () => renameOrganizationUnit({ id: 'section-b', name: 'Section A' }, db),
      /unique/i,
    )
    assert.equal(db.units.find((row) => row.id === 'section-b')?.name, 'Section B')
    assert.equal(db.audits.length, 0)
    assert.deepEqual(db.revalidated, [])
  })

  it('rejects an empty unit name matching /required/i without writing', async () => {
    const db = makeMutationDb()
    await assert.rejects(
      () => renameOrganizationUnit({ id: 'ops', name: '   ' }, db),
      /required/i,
    )
    assert.equal(db.units.find((row) => row.id === 'ops')?.name, 'Operations')
    assert.equal(db.audits.length, 0)
    assert.deepEqual(db.revalidated, [])
  })

  it('rejects a duplicate team name within the unit matching /unique/i without writing', async () => {
    const db = makeMutationDb()
    await assert.rejects(
      () => renameTeam({ id: 'team-beta', name: 'Alpha Team' }, db),
      /unique/i,
    )
    assert.equal(db.teams.find((row) => row.id === 'team-beta')?.name, 'Beta Team')
    assert.equal(db.audits.length, 0)
    assert.deepEqual(db.revalidated, [])
  })

  it('rejects an empty team name matching /required/i without writing', async () => {
    const db = makeMutationDb()
    await assert.rejects(
      () => renameTeam({ id: 'team-alpha', name: '' }, db),
      /required/i,
    )
    assert.equal(db.teams.find((row) => row.id === 'team-alpha')?.name, 'Alpha Team')
    assert.equal(db.audits.length, 0)
  })

  it('trims, writes, audits, and revalidates a unique unit rename without touching attempts', async () => {
    const db = makeMutationDb()
    const result = await renameOrganizationUnit({ id: 'section-b', name: '  Section C  ' }, db)
    assert.deepEqual(result, { success: true })
    assert.equal(db.units.find((row) => row.id === 'section-b')?.name, 'Section C')
    assert.equal(db.audits.length, 1)
    assert.match(db.audits[0].action, /organization_unit_renamed/)
    assert.match(db.audits[0].comments, /Section B/)
    assert.match(db.audits[0].comments, /Section C/)
    assert.deepEqual(db.revalidated, ['/admin/organization'])
    assert.equal(db.instanceTouches.length, 0)
  })

  it('does not silently normalize inner whitespace beyond trim', async () => {
    const db = makeMutationDb()
    await renameOrganizationUnit({ id: 'ops', name: '  Ops   Unit  ' }, db)
    assert.equal(db.units.find((row) => row.id === 'ops')?.name, 'Ops   Unit')
  })

  it('rejects a concurrent sibling unit rename to the same unused name with /unique/i', async () => {
    const db = makeMutationDb()
    const innerLoad = db.loadUnits.bind(db)
    let loads = 0
    let releaseFirst!: () => void
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let seenFirst!: () => void
    const firstArrived = new Promise<void>((resolve) => {
      seenFirst = resolve
    })
    db.loadUnits = async () => {
      const rows = await innerLoad()
      loads += 1
      if (loads === 1) {
        seenFirst()
        await firstHeld
      }
      return rows
    }
    const first = renameOrganizationUnit({ id: 'section-a', name: 'Shared' }, db)
    const second = renameOrganizationUnit({ id: 'section-b', name: 'Shared' }, db)
    await firstArrived
    await Promise.resolve()
    await Promise.resolve()
    releaseFirst()
    const results = await Promise.allSettled([first, second])
    const fulfilled = results.filter((row) => row.status === 'fulfilled')
    const rejected = results.filter((row) => row.status === 'rejected')
    assert.equal(fulfilled.length, 1)
    assert.equal(rejected.length, 1)
    const reason = rejected[0].status === 'rejected' ? rejected[0].reason : undefined
    assert.equal(reason instanceof OrganizationValidationError, true)
    assert.match(String(reason), /unique/i)
    const shared = db.units.filter((row) => row.isActive && row.parentId === 'ops' && row.name === 'Shared')
    assert.equal(shared.length, 1)
  })

  it('rejects a concurrent same-unit team rename to the same unused name with /unique/i', async () => {
    const db = makeMutationDb()
    const innerLoad = db.loadTeams.bind(db)
    let loads = 0
    let releaseFirst!: () => void
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let seenFirst!: () => void
    const firstArrived = new Promise<void>((resolve) => {
      seenFirst = resolve
    })
    db.loadTeams = async () => {
      const rows = await innerLoad()
      loads += 1
      if (loads === 1) {
        seenFirst()
        await firstHeld
      }
      return rows
    }
    const first = renameTeam({ id: 'team-alpha', name: 'Shared Team' }, db)
    const second = renameTeam({ id: 'team-beta', name: 'Shared Team' }, db)
    await firstArrived
    await Promise.resolve()
    await Promise.resolve()
    releaseFirst()
    const results = await Promise.allSettled([first, second])
    const fulfilled = results.filter((row) => row.status === 'fulfilled')
    const rejected = results.filter((row) => row.status === 'rejected')
    assert.equal(fulfilled.length, 1)
    assert.equal(rejected.length, 1)
    const reason = rejected[0].status === 'rejected' ? rejected[0].reason : undefined
    assert.equal(reason instanceof OrganizationValidationError, true)
    assert.match(String(reason), /unique/i)
    const shared = db.teams.filter((row) => row.isActive && row.unitId === 'ops' && row.name === 'Shared Team')
    assert.equal(shared.length, 1)
  })

  it('maps unique and serialization conflicts to OrganizationValidationError matching /unique/i', async () => {
    const db = makeMutationDb()
    db.updateUnitName = async () => {
      throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
    }
    await assert.rejects(
      () => renameOrganizationUnit({ id: 'section-b', name: 'Section C' }, db),
      (error: unknown) => {
        assert.equal(error instanceof OrganizationValidationError, true)
        assert.match((error as Error).message, /unique/i)
        return true
      },
    )
    db.updateUnitName = async () => {
      throw Object.assign(
        new Error('Transaction failed due to a write conflict or a deadlock'),
        { code: 'P2034' },
      )
    }
    await assert.rejects(
      () => renameOrganizationUnit({ id: 'section-b', name: 'Section D' }, db),
      /unique/i,
    )
  })
})

describe('TreeNodeRow wires InlineNameEdit', () => {
  it('replaces read-only unit and team names with InlineNameEdit plus rename actions', () => {
    const row = read('src/components/organization/TreeNodeRow.tsx')
    assert.match(row, /InlineNameEdit/)
    assert.match(row, /renameOrganizationUnit/)
    assert.match(row, /renameTeam/)
    const editor = read('src/components/organization/InlineNameEdit.tsx')
    assert.match(editor, /export function InlineNameEdit/)
    assert.match(editor, /aria-describedby/)
    assert.match(editor, /handleInlineNameEditKeyDown/)
    assert.match(editor, /applyInlineNameEditResult/)
    assert.doesNotMatch(editor, /toLowerCase\(|normalize\(|replace\(\s*\/\\s\+/)
    const actions = read('src/lib/organization/workspace-admin.ts')
    assert.match(actions, /runSerializable/)
    assert.match(actions, /isolationLevel:\s*['"]Serializable['"]/)
    assert.match(actions, /P2002/)
    assert.match(actions, /P2034/)
  })
})
