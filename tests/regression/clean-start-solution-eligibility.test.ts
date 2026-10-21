import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { canWorkOnSolutions } from '@/lib/solution-eligibility'
import type { OrganizationUnitNode } from '@/lib/organization/model'

const u = (id: string, parentId: string | null, over: Partial<OrganizationUnitNode> = {}): OrganizationUnitNode =>
  ({ id, name: id, parentId, isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null, ...over })

// Spec: admins explicitly mark an organization unit Can work on solutions
// (for example Engineering); people actively assigned to that unit or ANY
// descendant may submit and revise solutions. The flag is inherited downward,
// is not a per-person capability, and confers no approval rights.
const units = [
  u('company', null),
  u('engineering', 'company', { canWorkOnSolutions: true }),
  u('platform', 'engineering'),
  u('web', 'platform'),
  u('sales', 'company'),
]

describe('solution-work eligibility — unit flag inherited by descendants', () => {
  it('is true for a person assigned to the flagged unit itself', () => {
    assert.equal(canWorkOnSolutions(units, 'engineering'), true)
    assert.equal(typeof canWorkOnSolutions(units, 'engineering'), 'boolean')
  })

  it('is true for a person assigned to any descendant, through unflagged intermediate units', () => {
    assert.equal(canWorkOnSolutions(units, 'web'), true)
    assert.equal(canWorkOnSolutions(units, 'platform'), true)
  })

  it('is false for a person in an unflagged sibling subtree (no flagged self-or-ancestor)', () => {
    assert.equal(canWorkOnSolutions(units, 'sales'), false)
    assert.equal(canWorkOnSolutions(units, 'company'), false)
  })

  it('is false for an unassigned person (null unit)', () => {
    assert.equal(canWorkOnSolutions(units, null), false)
    assert.equal(typeof canWorkOnSolutions(units, null), 'boolean')
  })
})

describe('solution-work eligibility — inactive flagged units never confer', () => {
  it('skips an inactive flagged ancestor and continues traversal to an active flagged ancestor', () => {
    const tree = [
      u('company', null, { canWorkOnSolutions: true }),
      u('mid', 'company', { isActive: false, canWorkOnSolutions: true }),
      u('leaf', 'mid'),
    ]
    assert.equal(canWorkOnSolutions(tree, 'leaf'), true)
  })

  it('is false when the only flagged unit on the chain is inactive', () => {
    const tree = [
      u('company', null),
      u('mid', 'company', { isActive: false, canWorkOnSolutions: true }),
      u('leaf', 'mid'),
    ]
    assert.equal(canWorkOnSolutions(tree, 'leaf'), false)
  })

  it('never treats an inactive flagged queried unit as eligible', () => {
    const tree = [
      u('company', null),
      u('leaf', 'company', { isActive: false, canWorkOnSolutions: true }),
    ]
    assert.equal(canWorkOnSolutions(tree, 'leaf'), false)
  })
})

describe('solution-work eligibility — fail-closed corrupt/missing input', () => {
  it('validates the consulted chain BEFORE any flag is consulted: a flagged self with a corrupt ancestor chain throws', () => {
    const corrupt = [u('company', null, { canWorkOnSolutions: true }), u('leaf', 'ghost', { canWorkOnSolutions: true })]
    assert.throws(() => canWorkOnSolutions(corrupt, 'leaf'), /missing/i)
  })

  it('throws on a cyclic chain instead of silently returning false', () => {
    assert.throws(() => canWorkOnSolutions([u('a', 'b'), u('b', 'a')], 'a'), /cycle/i)
  })

  it('fails explicitly when the assignment unit id is missing from the units', () => {
    assert.throws(() => canWorkOnSolutions(units, 'nope'), /missing/i)
  })

  it('does not mutate the input units (read-only inputs)', () => {
    const before = JSON.parse(JSON.stringify(units))
    canWorkOnSolutions(units, 'web')
    canWorkOnSolutions(units, null)
    assert.deepEqual(JSON.parse(JSON.stringify(units)), before)
  })
})
