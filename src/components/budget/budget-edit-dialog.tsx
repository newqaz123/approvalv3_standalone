'use client'

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
  const [value, setValue] = useState(initialValue?.toString() ?? '')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (open) setValue(initialValue?.toString() ?? '')
  }, [initialValue, open])

  async function handleSave() {
    setIsSaving(true)
    try {
      await onSave(value.trim() === '' ? null : Number(value))
      onOpenChange(false)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
