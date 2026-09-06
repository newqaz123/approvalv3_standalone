import { ORGANIZATION_POSITION_LEVEL, type OrganizationPositionCode, type OrganizationPositionLevel, type OrganizationUnitNode } from './types'

export function positionLevel(position: OrganizationPositionCode): OrganizationPositionLevel {
  return ORGANIZATION_POSITION_LEVEL[position] as OrganizationPositionLevel
}

export function assertAcyclicOrganizationTree(units: readonly OrganizationUnitNode[]): void {
  const byId = new Map(units.map((unit) => [unit.id, unit]))
  if (byId.size !== units.length) throw new Error('Duplicate organization unit ID')
  const visiting = new Set<string>(), visited = new Set<string>()
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error(`Organization cycle detected at ${id}`)
    if (visited.has(id)) return
    const unit = byId.get(id)
    if (!unit) throw new Error(`Organization parent ${id} is missing`)
    visiting.add(id)
    if (unit.parentId) visit(unit.parentId)
    visiting.delete(id); visited.add(id)
  }
  for (const unit of units) visit(unit.id)
}

export function ancestorUnitIds(units: readonly OrganizationUnitNode[], originUnitId: string): string[] {
  assertAcyclicOrganizationTree(units)
  const byId = new Map(units.map((unit) => [unit.id, unit]))
  if (!byId.has(originUnitId)) throw new Error(`Organization unit ${originUnitId} is missing`)
  const result: string[] = []
  let current: string | null = originUnitId
  while (current) { result.push(current); current = byId.get(current)?.parentId ?? null }
  return result
}

export function descendantUnitIds(units: readonly OrganizationUnitNode[], rootUnitId: string): string[] {
  assertAcyclicOrganizationTree(units)
  const byId = new Map(units.map((unit) => [unit.id, unit]))
  if (!byId.has(rootUnitId)) throw new Error(`Organization unit ${rootUnitId} is missing`)
  const children = new Map<string, string[]>()
  for (const unit of units) if (unit.parentId) children.set(unit.parentId, [...(children.get(unit.parentId) ?? []), unit.id])
  const result = [rootUnitId], queue = [rootUnitId]
  while (queue.length) { const current = queue.shift()!; for (const child of children.get(current) ?? []) { result.push(child); queue.push(child) } }
  return result
}
