'use client'

import { useTranslations } from '@/lib/i18n/client'
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
  onCreate: (input: {
    budgetCode: string
    name: string
    budgetAmount: number
    unitId: string | null
  }) => Promise<void>
}

export function BudgetCodeCreateDialog({ open, onOpenChange, departments, onCreate }: BudgetCodeCreateDialogProps) {
  const t = useTranslations()
  const [budgetCode, setBudgetCode] = useState('')
  const [name, setName] = useState('')
  const [budgetAmount, setBudgetAmount] = useState('')
  const [unitId, setDepartmentId] = useState<string>('none')
  const [isSaving, setIsSaving] = useState(false)
  const [hasError, setHasError] = useState(false)

  const parsedAmount = Number(budgetAmount)
  const canSubmit =
    budgetCode.trim() !== '' &&
    name.trim() !== '' &&
    budgetAmount.trim() !== '' &&
    Number.isFinite(parsedAmount) &&
    parsedAmount >= 0

  async function handleCreate() {
    setHasError(false)
    setIsSaving(true)
    try {
      await onCreate({
        budgetCode,
        name: name.trim(),
        budgetAmount: parsedAmount,
        unitId: unitId === 'none' ? null : unitId,
      })
      setBudgetCode('')
      setName('')
      setBudgetAmount('')
      setDepartmentId('none')
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('budget.newCode')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t('budget.newCodeIntro')}
          </p>
          <div className="space-y-2">
            <Label htmlFor="new-budget-code">{t('budget.code')}</Label>
            <Input
              id="new-budget-code"
              value={budgetCode}
              onChange={(event) => setBudgetCode(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-budget-code-name">{t('budget.codeName')}</Label>
            <Input
              id="new-budget-code-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-budget-amount">{t('budget.amount')}</Label>
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
          {hasError && <p role="alert" className="text-sm text-destructive">{t('budget.error.create')}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => {
              setHasError(false)
              onOpenChange(false)
            }}>
              {t('common.cancel')}
            </Button>
            <Button type="button" onClick={handleCreate} disabled={isSaving || !canSubmit}>
              {t('budget.create')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
