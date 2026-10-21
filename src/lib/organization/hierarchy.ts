// Clean-start rooted-tree hierarchy operations (Plan A Task 2).
// Iterative traversal throughout: arbitrary depth must not depend on the
// call stack. Imports nothing from the legacy organization modules.
import type { OrganizationUnitNode } from './model'

/** Fail-closed signal that no active sharing-enabled unit exists at or above the queried unit; setup makes the company root sharing-enabled. */
export class NoSharingScopeError extends Error {
  readonly code = 'NO_SHARING_SCOPE'
}

function indexById(units: readonly OrganizationUnitNode[]): Map<string, OrganizationUnitNode> {
  const byId = new Map<string, OrganizationUnitNode>()
  for (const unit of units) {
    if (byId.has(unit.id)) {
      throw new Error(`duplicate organization unit id "${unit.id}"`)
    }
    byId.set(unit.id, unit)
  }
  return byId
}

/**
 * Validates the unit forest globally and returns the units indexed by id.
 * Throws on duplicate ids, missing parent references, cycles (including
 * detached cycles), and on zero or more-than-one ACTIVE root
 * (parentId === null && isActive). Inactive units may appear anywhere
 * except they never count toward the single-active-root requirement.
 */
export function assertSingleAcyclicRoot(units: readonly OrganizationUnitNode[]): Map<string, OrganizationUnitNode> {
  const byId = indexById(units)
  // Iterative three-state walk up the parent chain: 1 = on the current chain,
  // 2 = verified terminating at a root. A node seen twice on one chain is a cycle.
  const state = new Map<string, 1 | 2>()
  for (const unit of units) {
    if (state.get(unit.id) === 2) continue
    const chain: string[] = []
    let cursor: OrganizationUnitNode | undefined = unit
    while (cursor !== undefined && state.get(cursor.id) !== 2) {
      if (state.get(cursor.id) === 1) {
        throw new Error(`organization unit cycle detected at unit "${cursor.id}" (chain: ${[...chain, cursor.id].join(' -> ')})`)
      }
      state.set(cursor.id, 1)
      chain.push(cursor.id)
      if (cursor.parentId === null) break
      const parent: OrganizationUnitNode | undefined = byId.get(cursor.parentId)
      if (parent === undefined) {
        throw new Error(`organization unit "${cursor.id}" references missing parent unit id "${cursor.parentId}"`)
      }
      cursor = parent
    }
    for (const id of chain) state.set(id, 2)
  }
  const activeRoots = units.filter((unit) => unit.parentId === null && unit.isActive)
  if (activeRoots.length === 0) {
    throw new Error('no active root: the organization requires exactly one active unit with parentId null')
  }
  if (activeRoots.length > 1) {
    throw new Error(`more than one active root: ${activeRoots.map((root) => root.id).join(', ')}`)
  }
  return byId
}

/**
 * Ancestor path INCLUDING the queried unit: [unit, parent, ..., root].
 * Inactive ancestors are traversed, not skipped. Throws on a missing queried
 * id, a missing parent reference, or a cycle on the walked chain.
 */
export function ancestorUnitIds(units: readonly OrganizationUnitNode[], unitId: string): string[] {
  const byId = indexById(units)
  const start: OrganizationUnitNode | undefined = byId.get(unitId)
  if (start === undefined) {
    throw new Error(`ancestorUnitIds: unit id "${unitId}" is missing from the given units`)
  }
  const path: string[] = []
  const visited = new Set<string>()
  let cursor: OrganizationUnitNode | undefined = start
  while (cursor !== undefined) {
    if (visited.has(cursor.id)) {
      throw new Error(`organization unit cycle detected at unit "${cursor.id}"`)
    }
    visited.add(cursor.id)
    path.push(cursor.id)
    if (cursor.parentId === null) break
    const parent: OrganizationUnitNode | undefined = byId.get(cursor.parentId)
    if (parent === undefined) {
      throw new Error(`organization unit "${cursor.id}" references missing parent unit id "${cursor.parentId}"`)
    }
    cursor = parent
  }
  return path
}

/**
 * Descendant set INCLUDING the queried unit, breadth-first in input order.
 * A visited set bounds traversal even on corrupt cyclic input; structural
 * validation is assertSingleAcyclicRoot's job.
 */
export function descendantUnitIds(units: readonly OrganizationUnitNode[], rootUnitId: string): string[] {
  const byId = indexById(units)
  const start: OrganizationUnitNode | undefined = byId.get(rootUnitId)
  if (start === undefined) {
    throw new Error(`descendantUnitIds: unit id "${rootUnitId}" is missing from the given units`)
  }
  const children = new Map<string, OrganizationUnitNode[]>()
  for (const unit of units) {
    if (unit.parentId === null) continue
    const siblings = children.get(unit.parentId)
    if (siblings === undefined) children.set(unit.parentId, [unit])
    else siblings.push(unit)
  }
  const result: string[] = []
  const queue: OrganizationUnitNode[] = [start]
  const visited = new Set<string>([rootUnitId])
  for (let head = queue.shift(); head !== undefined; head = queue.shift()) {
    result.push(head.id)
    for (const child of children.get(head.id) ?? []) {
      if (visited.has(child.id)) continue
      visited.add(child.id)
      queue.push(child)
    }
  }
  return result
}

/**
 * Nearest sharing scope: the first ACTIVE shareRequests unit on the
 * self -> ancestor chain. Inactive units are traversed through but never
 * selected. The tree is validated first (assertSingleAcyclicRoot); without
 * any eligible unit this throws NoSharingScopeError (fail closed).
 */
export function nearestSharingScopeUnitId(units: readonly OrganizationUnitNode[], unitId: string): string {
  const byId = assertSingleAcyclicRoot(units)
  let cursor: OrganizationUnitNode | undefined = byId.get(unitId)
  if (cursor === undefined) {
    throw new Error(`nearestSharingScopeUnitId: unit id "${unitId}" is missing from the given units`)
  }
  while (cursor !== undefined) {
    if (cursor.isActive && cursor.shareRequests) return cursor.id
    cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId)
  }
  throw new NoSharingScopeError(`NoSharingScope: no active sharing-enabled unit at or above unit "${unitId}"`)
}
