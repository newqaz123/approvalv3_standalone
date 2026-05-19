'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { BudgetCodeSummary } from '@/types/budget'

interface BudgetCodeEditDialogProps {
  open: boolean
  budgetCode: BudgetCodeSummary | null
  departments: Array<{ id: string; name: string }>
  onOpenChange: (open: boolean) => void
  onSave: (input: { budgetAmount: number | null; departmentId: string | null }) => Promise<void>
}

export function BudgetCodeEditDialog({
  open,
  budgetCode,
  departments,
  onOpenChange,
  onSave,
}: BudgetCodeEditDialogProps) {
  const [budgetAmount, setBudgetAmount] = useState('')
  const [departmentId, setDepartmentId] = useState('none')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setBudgetAmount(budgetCode?.budgetAmount?.toString() ?? '')
    setDepartmentId(budgetCode?.department?.id ?? 'none')
  }, [budgetCode, open])

  async function handleSave() {
    setIsSaving(true)
    try {
      await onSave({
        budgetAmount: budgetAmount.trim() === '' ? null : Number(budgetAmount),
        departmentId: departmentId === 'none' ? null : departmentId,
      })
      onOpenChange(false)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit budget code</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="budget-code-edit-amount">Budget amount</Label>
            <Input
              id="budget-code-edit-amount"
              type="number"
              min="0"
              step="0.01"
              value={budgetAmount}
              onChange={(event) => setBudgetAmount(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Department budget</Label>
            <Select value={departmentId} onValueChange={setDepartmentId}>
              <SelectTrigger>
                <SelectValue placeholder="Select department" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No department</SelectItem>
                {departments.map((department) => (
                  <SelectItem key={department.id} value={department.id}>
                    {department.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSave} disabled={isSaving}>
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
