import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sharingScopeUnitIds } from '@/lib/organization/sharing'
import { descendantUnitIds, nearestSharingScopeUnitId, NoSharingScopeError } from '@/lib/organization/hierarchy'
import type { OrganizationUnitNode } from '@/lib/organization/model'

const u = (id: string, parentId: string | null, over: Partial<OrganizationUnitNode> = {}): OrganizationUnitNode =>
  ({ id, name: id, parentId, isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null, ...over })

// Spec example, reproduced verbatim: Operations sharing-enabled contains
// separately sharing-enabled Sections A and B; Pat assigned to Operations sees
// both sections; Alice assigned to A sees A; Bob assigned to B sees B.
// Child sharing settings never remove descendants from an ancestor member's scope.
const specUnits = [
  u('company', null, { shareRequests: true }),
  u('operations', 'company', { shareRequests: true }),
  u('section-a', 'operations', { shareRequests: true }),
  u('section-a-child', 'section-a'),
  u('section-b', 'operations', { shareRequests: true }),
]

const sorted = (ids: readonly string[]): string[] => [...ids].sort()

describe('downward-inclusive sharing scope — spec matrix (Pat/Alice/Bob)', () => {
  it("Pat in Operations sees the complete subtree, including Sections A and B even though each is separately sharing-enabled", () => {
    assert.deepEqual(sorted(sharingScopeUnitIds(specUnits, 'operations')), sorted(['operations', 'section-a', 'section-a-child', 'section-b']))
  })

  it("Alice in Section A sees Section A and its descendants, never the sibling Section B", () => {
    assert.deepEqual(sorted(sharingScopeUnitIds(specUnits, 'section-a')), sorted(['section-a', 'section-a-child']))
    assert.equal(sharingScopeUnitIds(specUnits, 'section-a').includes('section-b'), false)
  })

  it("Bob in Section B sees only Section B and its descendants", () => {
    assert.deepEqual(sharingScopeUnitIds(specUnits, 'section-b'), ['section-b'])
  })

  it('is exactly the descendants of the nearest sharing ancestor (composed contract)', () => {
    assert.deepEqual(
      sorted(sharingScopeUnitIds(specUnits, 'section-a-child')),
      sorted(descendantUnitIds(specUnits, nearestSharingScopeUnitId(specUnits, 'section-a-child'))),
    )
  })
})

describe('downward-inclusive sharing scope — boundaries and fallback', () => {
  it('falls back to the company-root scope when no nearer sharing unit exists on the chain', () => {
    const tree = [
      u('company', null, { shareRequests: true }),
      u('ops', 'company'),
      u('leaf', 'ops'),
      u('sibling-under-root', 'company'),
    ]
    assert.deepEqual(sorted(sharingScopeUnitIds(tree, 'leaf')), sorted(['company', 'ops', 'leaf', 'sibling-under-root']))
  })

  it('throws the typed NoSharingScopeError (fail closed) when no active sharing unit exists at or above', () => {
    const noSharing = [u('company', null), u('leaf', 'company')]
    assert.throws(
      () => sharingScopeUnitIds(noSharing, 'leaf'),
      (err: unknown) => err instanceof NoSharingScopeError && err.code === 'NO_SHARING_SCOPE' && /NoSharingScope/i.test(err.message),
    )
  })

  it('binds a nearest nested sharing boundary: a deep unit with its own scope gets only its own subtree', () => {
    const tree = [
      u('company', null, { shareRequests: true }),
      u('operations', 'company', { shareRequests: true }),
      u('section-a', 'operations', { shareRequests: true }),
      u('a-first', 'section-a'),
      u('a-second', 'section-a', { shareRequests: true }),
      u('a-second-deep', 'a-second'),
      u('section-b', 'operations', { shareRequests: true }),
      u('b-first', 'section-b'),
    ]
    // a-second itself shares: its own scope is its subtree only.
    assert.deepEqual(sorted(sharingScopeUnitIds(tree, 'a-second')), sorted(['a-second', 'a-second-deep']))
    // a unit directly under the section-a boundary stays inside section-a, never leaking to section-b.
    assert.deepEqual(sorted(sharingScopeUnitIds(tree, 'a-first')), sorted(['section-a', 'a-first', 'a-second', 'a-second-deep']))
    assert.equal(sharingScopeUnitIds(tree, 'a-first').includes('b-first'), false)
  })

  it('includes deep descendants at arbitrary depth, beneath inactive intermediate units', () => {
    const depth = 500
    const chain: OrganizationUnitNode[] = Array.from({ length: depth }, (_, i) =>
      u(`n${i}`, i === 0 ? null : `n${i - 1}`, i === 0 ? { shareRequests: true } : {}))
    chain[5] = { ...chain[5], isActive: false }
    const ids = sharingScopeUnitIds(chain, 'n0')
    assert.equal(ids.length, depth)
    assert.ok(ids.includes(`n${depth - 1}`))
    assert.ok(ids.includes('n5'))
  })
})

describe('downward-inclusive sharing scope — inactive sharing ancestors', () => {
  it('skips an inactive sharing-enabled ancestor and continues to the nearest ACTIVE sharing ancestor', () => {
    const tree = [
      u('company', null, { shareRequests: true }),
      u('operations', 'company', { isActive: false, shareRequests: true }),
      u('section-a', 'operations', { shareRequests: true }),
    ]
    // section-a shares itself, so the nearest ACTIVE sharer is section-a.
    assert.deepEqual(sorted(sharingScopeUnitIds(tree, 'section-a')), sorted(['section-a']))
    // below any active sharer, the inactive sharing unit is skipped upward to the active root.
    const unsharedBelow = [
      u('company', null, { shareRequests: true }),
      u('operations', 'company', { isActive: false, shareRequests: true }),
      u('section-a', 'operations'),
      u('leaf', 'section-a'),
      u('sales', 'company'),
    ]
    assert.deepEqual(sorted(sharingScopeUnitIds(unsharedBelow, 'leaf')), sorted(['company', 'operations', 'section-a', 'leaf', 'sales']))
  })
})

describe('downward-inclusive sharing scope — fail-closed corrupt/missing input', () => {
  it('validates the tree globally before returning any scope', () => {
    assert.throws(() => sharingScopeUnitIds([u('a', 'b'), u('b', 'a')], 'a'), /cycle/i)
    assert.throws(() => sharingScopeUnitIds([u('only', 'missing')], 'only'), /missing/i)
    assert.throws(() => sharingScopeUnitIds([u('r1', null, { shareRequests: true }), u('r2', null, { shareRequests: true })], 'r1'), /more than one active root/i)
  })

  it('fails explicitly when the assignment unit id is missing from the units', () => {
    assert.throws(() => sharingScopeUnitIds(specUnits, 'nope'), /missing/i)
  })

  it('does not mutate the input units (read-only inputs)', () => {
    const before = JSON.parse(JSON.stringify(specUnits))
    sharingScopeUnitIds(specUnits, 'operations')
    sharingScopeUnitIds(specUnits, 'section-a-child')
    assert.deepEqual(JSON.parse(JSON.stringify(specUnits)), before)
  })
})
