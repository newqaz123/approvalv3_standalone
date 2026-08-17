'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BudgetCodeCard } from '@/components/budget/budget-code-card'
import { groupBudgetCodesByDepartment } from '@/lib/budget-control'
import type { BudgetCodeGroup } from '@/types/budget'

export function BudgetDepartmentPanel({
  groups,
  onEditBudgetCode,
  onPaste,
  onCreate,
}: {
  groups: BudgetCodeGroup[]
  onEditBudgetCode: (group: BudgetCodeGroup) => void
  onPaste: () => void
  onCreate: () => void
}) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const departments = groupBudgetCodesByDepartment(groups)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Budget by department</h2>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={onPaste}>
            Paste budget codes
          </Button>
          <Button type="button" variant="outline" onClick={onCreate}>
            <Plus className="mr-2 h-4 w-4" />
            New budget code
          </Button>
        </div>
      </div>
      <p className="font-mono text-xs text-gray-500">
        {departments.length} department{departments.length === 1 ? '' : 's'} · {groups.length} group
        {groups.length === 1 ? '' : 's'}
      </p>
      {departments.map((department) => (
        <section key={department.departmentId ?? 'none'}>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-medium">{department.departmentName}</h3>
            <span className="rounded-full border px-2 py-0.5 text-xs text-gray-500">
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
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
