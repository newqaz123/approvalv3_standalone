'use client'

import { useTranslations } from '@/lib/i18n/client'
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
  onSave: (input: {
    name: string
    budgetAmount: number
    unitId: string | null
  }) => Promise<void>
}

export function BudgetCodeEditDialog({
  open,
  budgetCode,
  departments,
  onOpenChange,
  onSave,
}: BudgetCodeEditDialogProps) {
  const t = useTranslations()
  const [name, setName] = useState('')
  const [budgetAmount, setBudgetAmount] = useState('')
  const [unitId, setDepartmentId] = useState('none')
  const [isSaving, setIsSaving] = useState(false)
  const [hasError, setHasError] = useState(false)

  const parsedAmount = Number(budgetAmount)
  const canSubmit =
    name.trim() !== '' &&
    budgetAmount.trim() !== '' &&
    Number.isFinite(parsedAmount) &&
    parsedAmount >= 0

  useEffect(() => {
    if (!open) return
    setName(budgetCode?.name ?? '')
    setBudgetAmount(budgetCode?.budgetAmount?.toString() ?? '')
    setDepartmentId(budgetCode?.department?.id ?? 'none')
  }, [budgetCode, open])

  async function handleSave() {
    setHasError(false)
    setIsSaving(true)
    try {
      await onSave({
        name: name.trim(),
        budgetAmount: parsedAmount,
        unitId: unitId === 'none' ? null : unitId,
      })
      onOpenChange(false)
    } catch {
      setHasError(true)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen) setHasError(false)
      onOpenChange(nextOpen)
    }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('budget.editCode')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="budget-code-edit-name">{t('budget.codeName')}</Label>
            <Input
              id="budget-code-edit-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="budget-code-edit-amount">{t('budget.amount')}</Label>
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
            <Label>{t('budget.departmentBudget')}</Label>
            <Select value={unitId} onValueChange={setDepartmentId}>
              <SelectTrigger>
                <SelectValue placeholder={t('budget.selectDepartment')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('budget.noDepartment')}</SelectItem>
                {departments.map((department) => (
                  <SelectItem key={department.id} value={department.id}>
                    {department.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {hasError && <p role="alert" className="text-sm text-destructive">{t('budget.error.editCode')}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => {
              setHasError(false)
              onOpenChange(false)
            }}>
              {t('common.cancel')}
            </Button>
            <Button type="button" onClick={handleSave} disabled={isSaving || !canSubmit}>
              {t('requests.save')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
