import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { filterApproversByQuery } from '@/lib/approver-search'

const users = [
  { id: 'a', name: 'Kanokwan Srisawat', email: 'kanokwan@example.com', role: 'Procurement Lead', unitPathNames: ['Central Procurement'] },
  { id: 'b', name: 'Narin Chantarat', email: 'narin@example.com', role: 'System Admin', unitPathNames: ['Corporate Services'] },
  { id: 'c', name: 'Patthira Nopphakun', email: 'patthira@example.com', role: null, unitPathNames: [] },
]

describe('filterApproversByQuery', () => {
  it('matches name and email case-insensitively', () => {
    assert.deepEqual(filterApproversByQuery(users, 'KANOKWAN').map((u) => u.id), ['a'])
    assert.deepEqual(filterApproversByQuery(users, 'NARIN@EXAMPLE').map((u) => u.id), ['b'])
  })

  it('matches optional role and unit path metadata', () => {
    assert.deepEqual(filterApproversByQuery(users, 'procurement lead').map((u) => u.id), ['a'])
    assert.deepEqual(filterApproversByQuery(users, 'corporate services').map((u) => u.id), ['b'])
  })

  it('matches unit path names case-insensitively', () => {
    assert.deepEqual(filterApproversByQuery(users, 'CENTRAL PROCUREMENT').map((u) => u.id), ['a'])
    assert.deepEqual(filterApproversByQuery(users, 'corporate services').map((u) => u.id), ['b'])
  })

  it('returns all users for whitespace and none for a miss without mutating order', () => {
    assert.deepEqual(filterApproversByQuery(users, '   '), users)
    assert.deepEqual(filterApproversByQuery(users, 'no-match'), [])
  })

  it('accepts user shapes without role or unit path', () => {
    const minimal = [{ id: 'x', name: 'Somchai', email: 'somchai@example.com' }]
    assert.deepEqual(filterApproversByQuery(minimal, 'somchai'), minimal)
  })
})
