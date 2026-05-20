'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface BudgetCodeCreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  departments: Array<{ id: string; name: string }>
  onCreate: (input: { budgetCode: string; budgetAmount: number | null; departmentId: string | null }) => Promise<void>
}

export function BudgetCodeCreateDialog({ open, onOpenChange, departments, onCreate }: BudgetCodeCreateDialogProps) {
  const [budgetCode, setBudgetCode] = useState('')
  const [budgetAmount, setBudgetAmount] = useState('')
  const [departmentId, setDepartmentId] = useState<string>('none')
  const [isSaving, setIsSaving] = useState(false)

  async function handleCreate() {
    setIsSaving(true)
    try {
      await onCreate({
        budgetCode,
        budgetAmount: budgetAmount.trim() === '' ? null : Number(budgetAmount),
        departmentId: departmentId === 'none' ? null : departmentId,
      })
      setBudgetCode('')
      setBudgetAmount('')
      setDepartmentId('none')
      onOpenChange(false)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New budget code</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="new-budget-code">Budget code</Label>
            <Input
              id="new-budget-code"
              value={budgetCode}
              onChange={(event) => setBudgetCode(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-budget-amount">Budget amount</Label>
            <Input
              id="new-budget-amount"
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
            <Button type="button" onClick={handleCreate} disabled={isSaving || budgetCode.trim() === ''}>
              Create
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
