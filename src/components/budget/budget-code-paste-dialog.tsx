'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { classifyBudgetCodePasteRows, parseBudgetCodePaste } from '@/lib/budget-control'

export function BudgetCodePasteDialog({
  open,
  existingCodes,
  onOpenChange,
  onPaste,
}: {
  open: boolean
  existingCodes: Array<{ code: string }>
  onOpenChange: (open: boolean) => void
  onPaste: (
    rows: Array<{ code: string; name: string; budgetAmount: number }>
  ) => Promise<{ created: number; updated: number; skipped: number }>
}) {
  const [text, setText] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const parsed = useMemo(() => parseBudgetCodePaste(text), [text])
  const classified = useMemo(
    () => classifyBudgetCodePasteRows(parsed.valid, existingCodes),
    [existingCodes, parsed.valid]
  )
  const canSubmit = parsed.valid.length > 0 && !isSaving

  async function handleConfirm() {
    setIsSaving(true)
    try {
      await onPaste(parsed.valid.map((row) => ({
        code: row.displayCode,
        name: row.name,
        budgetAmount: row.budgetAmount,
      })))
      setText('')
      onOpenChange(false)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Paste budget codes</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="budget-code-paste">Budget code, name, amount</Label>
            <textarea
              id="budget-code-paste"
              className="min-h-40 w-full rounded-md border p-3 font-mono text-sm"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="AYT-PD1-GF-411, Filler upgrade, 50000"
            />
          </div>
          <p className="text-xs text-gray-500">
            {classified.creates.length} create · {classified.updates.length} update · {parsed.skipped.length} skipped
          </p>
          {parsed.skipped.length > 0 ? (
            <ul className="max-h-32 overflow-auto text-xs text-red-700">
              {parsed.skipped.map((row) => (
                <li key={`${row.line}-${row.reason}`}>
                  Line {row.line}: {row.reason}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleConfirm} disabled={!canSubmit}>
              Confirm
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
