import type { OrganizationUnitNode } from '@/lib/organization/model'

/**
 * Assign-person unit picker data (owner-approved): a searchable, depth-
 * indented tree-path dropdown. Each row carries the unit, its depth, and the
 * full ancestor path ("Factory › Production Division › Engineering
 * Department") so the option can show the path while staying searchable by
 * ANY ancestor name. This is a flat option list, not a second flowchart.
 */
export interface UnitPathRow {
  unit: OrganizationUnitNode
  depth: number
  path: string
}

export const UNIT_PATH_SEPARATOR = ' › '

function childrenByParentId(
  units: readonly OrganizationUnitNode[],
): Map<string | null, OrganizationUnitNode[]> {
  const byParent = new Map<string | null, OrganizationUnitNode[]>()
  for (const unit of units) {
    if (!unit.isActive) continue
    const list = byParent.get(unit.parentId) ?? []
    list.push(unit)
    byParent.set(unit.parentId, list)
  }
  for (const list of byParent.values()) {
    list.sort((left, right) => left.name.localeCompare(right.name))
  }
  return byParent
}

/** Depth-first rows: roots by name, each branch's children by name. */
export function unitPathRows(units: readonly OrganizationUnitNode[]): UnitPathRow[] {
  const byParent = childrenByParentId(units)
  const rows: UnitPathRow[] = []
  const walk = (parentId: string | null, depth: number, ancestorPath: string) => {
    for (const unit of byParent.get(parentId) ?? []) {
      const path = ancestorPath.length > 0
        ? `${ancestorPath}${UNIT_PATH_SEPARATOR}${unit.name}`
        : unit.name
      rows.push({ unit, depth, path })
      walk(unit.id, depth + 1, path)
    }
  }
  walk(null, 0, '')
  return rows
}

const FOLD = (value: string) => value.toLowerCase()

/**
 * Search matches the unit's own name OR any ancestor name (typing
 * "Production" finds "Factory › Production Division › Engineering
 * Department"). Empty query matches everything.
 */
export function searchUnitRows(rows: readonly UnitPathRow[], query: string): UnitPathRow[] {
  const needle = FOLD(query.trim())
  if (needle.length === 0) return [...rows]
  return rows.filter((row) => FOLD(row.path).includes(needle))
}

/** Left padding per depth level for the indented option rows. */
export function unitDepthIndent(depth: number): number {
  return Math.max(0, depth) * 14
}
