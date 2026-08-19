'use client'

import { useState } from 'react'
import { BudgetCodeCard } from '@/components/budget/budget-code-card'
import { groupBudgetCodesByDepartment } from '@/lib/budget-control'
import type { BudgetCodeGroup } from '@/types/budget'

export function BudgetDepartmentPanel({
  groups,
  onEditBudgetCode,
  onUnassign,
  onOpenRequest,
}: {
  groups: BudgetCodeGroup[]
  onEditBudgetCode: (group: BudgetCodeGroup) => void
  onUnassign: (requestId: string) => void
  onOpenRequest: (requestId: string) => void
}) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(groups.map((group) => group.budgetCode.id))
  )
  const departments = groupBudgetCodesByDepartment(groups)

  return (
    <div className="space-y-8">
      {departments.map((department) => (
        <section key={department.departmentId ?? 'none'}>
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-gray-900">{department.departmentName}</h3>
            <span className="text-xs text-muted-foreground">
              {department.groups.length} group{department.groups.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="space-y-3">
            {department.groups.map((group) => (
              <BudgetCodeCard
                key={group.budgetCode.id}
                group={group}
                collapsed={collapsedGroups.has(group.budgetCode.id)}
                onCollapsedChange={(collapsed) => {
                  const next = new Set(collapsedGroups)
                  if (collapsed) next.add(group.budgetCode.id)
                  else next.delete(group.budgetCode.id)
                  setCollapsedGroups(next)
                }}
                onEditBudgetCode={() => onEditBudgetCode(group)}
                onUnassign={onUnassign}
                onOpenRequest={onOpenRequest}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
