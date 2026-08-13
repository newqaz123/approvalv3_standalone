import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { filterApproversByQuery } from '@/lib/approver-search'

const users = [
  { id: 'a', name: 'Kanokwan Srisawat', email: 'kanokwan@example.com', role: 'Procurement Lead', level: 2 },
  { id: 'b', name: 'Narin Chantarat', email: 'narin@example.com', role: 'System Admin', level: 1 },
  { id: 'c', name: 'Patthira Nopphakun', email: 'patthira@example.com', role: null, level: 3 },
]

describe('filterApproversByQuery', () => {
  it('matches name and email case-insensitively', () => {
    assert.deepEqual(filterApproversByQuery(users, 'KANOKWAN').map((u) => u.id), ['a'])
    assert.deepEqual(filterApproversByQuery(users, 'NARIN@EXAMPLE').map((u) => u.id), ['b'])
  })

  it('matches optional role and level metadata', () => {
    assert.deepEqual(filterApproversByQuery(users, 'procurement').map((u) => u.id), ['a'])
    assert.deepEqual(filterApproversByQuery(users, 'level 3').map((u) => u.id), ['c'])
  })

  it('returns all users for whitespace and none for a miss without mutating order', () => {
    assert.deepEqual(filterApproversByQuery(users, '   '), users)
    assert.deepEqual(filterApproversByQuery(users, 'no-match'), [])
  })

  it('accepts user shapes without role or level', () => {
    const minimal = [{ id: 'x', name: 'Somchai', email: 'somchai@example.com' }]
    assert.deepEqual(filterApproversByQuery(minimal, 'somchai'), minimal)
  })
})
