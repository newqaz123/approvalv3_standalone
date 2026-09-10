import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  ancestorUnitIds,
  assertSingleAcyclicRoot,
  descendantUnitIds,
  nearestSharingScopeUnitId,
  NoSharingScopeError,
} from '@/lib/organization/hierarchy'
import type { OrganizationUnitNode } from '@/lib/organization/model'

const u = (id: string, parentId: string | null, over: Partial<OrganizationUnitNode> = {}): OrganizationUnitNode =>
  ({ id, name: id, parentId, isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null, ...over })

const units = [
  u('company', null, { shareRequests: true }),
  u('operations', 'company', { shareRequests: true }),
  u('section-a', 'operations', { shareRequests: true }),
  u('section-b', 'operations', { shareRequests: true }),
  u('deep', 'section-a'),
]

describe('clean-start rooted tree — single active acyclic root', () => {
  it('indexes a valid tree and returns a unit map', () => {
    const byId = assertSingleAcyclicRoot(units)
    assert.equal(byId.size, units.length)
    assert.equal(byId.get('deep')?.parentId, 'section-a')
    assert.equal(byId.get('company')?.parentId, null)
  })

  it('allows exactly one active root, tolerating inactive non-root units in the chain', () => {
    const withInactiveMiddle = [
      u('company', null, { shareRequests: true }),
      u('mid', 'company', { isActive: false }),
      u('leaf', 'mid'),
    ]
    assert.equal(assertSingleAcyclicRoot(withInactiveMiddle).size, 3)
  })

  it('throws on duplicate unit ids', () => {
    const duplicated = [u('company', null, { shareRequests: true }), u('ops', 'company'), u('ops', 'company')]
    assert.throws(() => assertSingleAcyclicRoot(duplicated), /duplicate/i)
  })

  it('throws on a missing parent reference', () => {
    assert.throws(() => assertSingleAcyclicRoot([u('only', 'missing')]), /missing/i)
  })

  it('throws on detached cycles, including a self-parent', () => {
    assert.throws(() => assertSingleAcyclicRoot([u('a', 'b'), u('b', 'a')]), /cycle/i)
    assert.throws(() => assertSingleAcyclicRoot([u('self', 'self')]), /cycle/i)
  })

  it('throws with no active root even when an inactive root exists', () => {
    assert.throws(() => assertSingleAcyclicRoot([u('gone', null, { isActive: false })]), /no active root/i)
  })

  it('throws with more than one active root', () => {
    assert.throws(() => assertSingleAcyclicRoot([u('r1', null), u('r2', null)]), /more than one active root/i)
  })
})

describe('clean-start rooted tree — ancestor and descendant traversal', () => {
  it('returns the ancestor path including self, up to the root', () => {
    assert.deepEqual(ancestorUnitIds(units, 'deep'), ['deep', 'section-a', 'operations', 'company'])
    assert.deepEqual(ancestorUnitIds(units, 'company'), ['company'])
  })

  it('traverses inactive ancestors without dropping them from the path', () => {
    const withInactiveMiddle = [
      u('company', null, { shareRequests: true }),
      u('mid', 'company', { isActive: false }),
      u('leaf', 'mid'),
    ]
    assert.deepEqual(ancestorUnitIds(withInactiveMiddle, 'leaf'), ['leaf', 'mid', 'company'])
  })

  it('returns descendants including self and the whole subtree', () => {
    // NOTE: the plan's sample compared a sorted actual array against an unsorted
    // expected literal; this is the corrected comparison — sort BOTH sides.
    const actual = descendantUnitIds(units, 'operations')
    const expected = ['operations', 'section-a', 'section-b', 'deep']
    assert.deepEqual([...actual].sort(), [...expected].sort())
    assert.deepEqual(descendantUnitIds(units, 'section-b'), ['section-b'])
  })

  it('fails explicitly when the queried unit id is missing', () => {
    assert.throws(() => ancestorUnitIds(units, 'nope'), /missing/i)
    assert.throws(() => descendantUnitIds(units, 'nope'), /missing/i)
    assert.throws(() => nearestSharingScopeUnitId(units, 'nope'), /missing/i)
  })

  it('does not mutate the input units (read-only inputs)', () => {
    const before = JSON.parse(JSON.stringify(units))
    assertSingleAcyclicRoot(units)
    ancestorUnitIds(units, 'deep')
    descendantUnitIds(units, 'operations')
    nearestSharingScopeUnitId(units, 'deep')
    assert.deepEqual(JSON.parse(JSON.stringify(units)), before)
  })

  it('handles arbitrary depth without unbounded recursion', () => {
    const depth = 5000
    const chain: OrganizationUnitNode[] = Array.from({ length: depth }, (_, i) =>
      u(`n${i}`, i === 0 ? null : `n${i - 1}`, i === 0 ? { shareRequests: true } : {}))
    assert.equal(assertSingleAcyclicRoot(chain).size, depth)
    const path = ancestorUnitIds(chain, `n${depth - 1}`)
    assert.equal(path.length, depth)
    assert.equal(path[0], `n${depth - 1}`)
    assert.equal(path[path.length - 1], 'n0')
    assert.equal(descendantUnitIds(chain, 'n0').length, depth)
    assert.equal(nearestSharingScopeUnitId(chain, `n${depth - 1}`), 'n0')
  })
})

describe('clean-start rooted tree — nearest sharing scope', () => {
  it('resolves the nearest sharing-enabled self-or-ancestor, failing closed without one', () => {
    assert.equal(nearestSharingScopeUnitId(units, 'deep'), 'section-a')
    assert.equal(nearestSharingScopeUnitId(units, 'section-b'), 'section-b')
    const noSharing = [u('company', null), u('leaf', 'company')]
    assert.throws(() => nearestSharingScopeUnitId(noSharing, 'leaf'), /NoSharingScope/i)
  })

  it('throws the typed NoSharingScopeError with a stable code', () => {
    const noSharing = [u('company', null), u('leaf', 'company')]
    assert.throws(
      () => nearestSharingScopeUnitId(noSharing, 'leaf'),
      (err: unknown) => err instanceof NoSharingScopeError && err.code === 'NO_SHARING_SCOPE' && /NoSharingScope/i.test(err.message),
    )
  })

  it('never selects an inactive unit as the sharing scope, continuing upward instead', () => {
    const withInactiveSharer = [
      u('company', null, { shareRequests: true }),
      u('mid', 'company', { isActive: false, shareRequests: true }),
      u('leaf', 'mid'),
    ]
    assert.equal(nearestSharingScopeUnitId(withInactiveSharer, 'leaf'), 'company')
  })

  it('is unaffected by sharing flags on sibling or child branches (no scope widening)', () => {
    const tree = [
      u('company', null, { shareRequests: true }),
      u('mid', 'company'),
      u('leaf', 'mid'),
      u('other-branch', 'company', { shareRequests: true }),
    ]
    assert.equal(nearestSharingScopeUnitId(tree, 'leaf'), 'company')
    assert.equal(nearestSharingScopeUnitId(units, 'operations'), 'operations')
  })

  it('validates the tree before walking, so structural corruption fails explicitly', () => {
    assert.throws(() => nearestSharingScopeUnitId([u('a', 'b'), u('b', 'a')], 'a'), /cycle/i)
    assert.throws(() => nearestSharingScopeUnitId([u('only', 'missing')], 'only'), /missing/i)
  })
})
