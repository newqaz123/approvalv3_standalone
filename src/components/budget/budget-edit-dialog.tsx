'use client'

import { useTranslations } from '@/lib/i18n/client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface BudgetEditDialogProps {
  open: boolean
  title: string
  label: string
  initialValue: number | null
  onOpenChange: (open: boolean) => void
  onSave: (value: number | null) => Promise<void>
}

export function BudgetEditDialog({
  open,
  title,
  label,
  initialValue,
  onOpenChange,
  onSave,
}: BudgetEditDialogProps) {
  const t = useTranslations()
  const [value, setValue] = useState(initialValue?.toString() ?? '')
  const [isSaving, setIsSaving] = useState(false)
  const [hasError, setHasError] = useState(false)

  useEffect(() => {
    if (open) setValue(initialValue?.toString() ?? '')
  }, [initialValue, open])

  async function handleSave() {
    setHasError(false)
    setIsSaving(true)
    try {
      await onSave(value.trim() === '' ? null : Number(value))
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
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Label htmlFor="budget-edit-value">{label}</Label>
          <Input
            id="budget-edit-value"
            type="number"
            min="0"
            step="0.01"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          {hasError && <p role="alert" className="text-sm text-destructive">{t('budget.error.editEstimate')}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => {
              setHasError(false)
              onOpenChange(false)
            }}>
              {t('common.cancel')}
            </Button>
            <Button type="button" onClick={handleSave} disabled={isSaving}>
              {t('requests.save')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
