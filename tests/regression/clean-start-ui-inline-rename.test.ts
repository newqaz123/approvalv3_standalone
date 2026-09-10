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
import {
  renameOrganizationUnit,
  renameTeam,
  type OrganizationMutationDb,
} from '@/server-actions/organization'
import {
  InlineNameEdit,
  InlineNameEditView,
  cancelInlineNameEdit,
  startInlineNameEdit,
  submitInlineNameEdit,
  typeInlineNameEdit,
} from '@/components/organization/InlineNameEdit'

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
    assert.doesNotMatch(editor, /toLowerCase\(|normalize\(|replace\(\s*\/\\s\+/)
  })
})
