'use client'

import { useTranslations } from '@/lib/i18n/client'
import { useEffect, useMemo, useState, type ClipboardEvent, type PointerEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  applyPasteToGrid,
  classifyBudgetCodePasteRows,
  detectPasteDelimiter,
  emptyPasteGrid,
  parseBudgetCodePaste,
  pasteGridToText,
  splitPasteLine,
  stripThousandsSeparators,
  type BudgetPasteGridRow,
} from '@/lib/budget-control'

type Cell = { row: number; col: 0 | 1 | 2 }

function inSelection(cell: Cell, start: Cell, end: Cell) {
  const minRow = Math.min(start.row, end.row)
  const maxRow = Math.max(start.row, end.row)
  const minCol = Math.min(start.col, end.col)
  const maxCol = Math.max(start.col, end.col)
  return cell.row >= minRow && cell.row <= maxRow && cell.col >= minCol && cell.col <= maxCol
}

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
  const t = useTranslations()
  const [rows, setRows] = useState<BudgetPasteGridRow[]>(() => emptyPasteGrid())
  const [isSaving, setIsSaving] = useState(false)
  const [hasError, setHasError] = useState(false)
  const [anchor, setAnchor] = useState<Cell | null>(null)
  const [focus, setFocus] = useState<Cell | null>(null)
  const [dragging, setDragging] = useState(false)
  const parsed = useMemo(() => parseBudgetCodePaste(pasteGridToText(rows)), [rows])
  const classified = useMemo(
    () => classifyBudgetCodePasteRows(parsed.valid, existingCodes),
    [existingCodes, parsed.valid]
  )
  const canSubmit = parsed.valid.length > 0 && !isSaving

  useEffect(() => {
    function stopDrag() {
      setDragging(false)
    }
    window.addEventListener('pointerup', stopDrag)
    return () => window.removeEventListener('pointerup', stopDrag)
  }, [])

  function updateCell(index: number, key: keyof BudgetPasteGridRow, value: string) {
    setRows((current) => current.map((row, rowIndex) => (
      rowIndex === index ? { ...row, [key]: value } : row
    )))
  }

  function startSelect(cell: Cell, event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return
    setAnchor(cell)
    setFocus(cell)
    setDragging(true)
  }

  function extendSelect(cell: Cell) {
    if (!dragging) return
    setFocus(cell)
  }

  function handleCellPaste(index: number, column: 0 | 1 | 2, event: ClipboardEvent<HTMLInputElement>) {
    const raw = event.clipboardData.getData('text')
    const text = stripThousandsSeparators(raw)
    const firstLine = text.split(/\r?\n/)[0] ?? ''
    const firstLineCells = splitPasteLine(firstLine, detectPasteDelimiter(text))
    const singleValue = firstLineCells.length === 1 && !text.includes('\n')
    const hasRange = Boolean(anchor && focus && (anchor.row !== focus.row || anchor.col !== focus.col))
    if (singleValue && !hasRange) return
    event.preventDefault()
    if (singleValue && anchor && focus) {
      const keys = ['code', 'name', 'amount'] as const
      setRows((current) => current.map((row, rowIndex) => {
        const next = { ...row }
        ;([0, 1, 2] as const).forEach((col) => {
          if (inSelection({ row: rowIndex, col }, anchor, focus)) next[keys[col]] = text
        })
        return next
      }))
      return
    }
    setRows((current) => applyPasteToGrid(current, index, column, text))
  }

  async function handleConfirm() {
    setHasError(false)
    setIsSaving(true)
    try {
      await onPaste(parsed.valid.map((row) => ({
        code: row.displayCode,
        name: row.name,
        budgetAmount: row.budgetAmount,
      })))
      setRows(emptyPasteGrid())
      onOpenChange(false)
    } catch {
      setHasError(true)
    } finally {
      setIsSaving(false)
    }
  }

  function renderInput(index: number, column: 0 | 1 | 2, key: keyof BudgetPasteGridRow, label: string) {
    const selected = Boolean(anchor && focus && inSelection({ row: index, col: column }, anchor, focus))
    return (
      <td
        className={`p-0 ${selected ? 'bg-blue-50' : ''}`}
        onPointerDown={(event) => startSelect({ row: index, col: column }, event)}
        onPointerEnter={() => extendSelect({ row: index, col: column })}
      >
        <input
          className="h-8 w-full border-0 bg-transparent px-2 outline-none"
          value={rows[index][key]}
          onChange={(event) => updateCell(index, key, event.target.value)}
          onFocus={() => {
            if (!dragging) {
              setAnchor({ row: index, col: column })
              setFocus({ row: index, col: column })
            }
          }}
          onPaste={(event) => handleCellPaste(index, column, event)}
          aria-label={t('budget.pasteRow', { label, line: index + 1 })}
        />
      </td>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen) setHasError(false)
      onOpenChange(nextOpen)
    }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('budget.paste')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t('budget.pasteIntro')}
          </p>
          <div className={`max-h-80 overflow-auto rounded-md border ${dragging ? 'select-none' : ''}`}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 text-left text-xs font-medium text-muted-foreground">
                <tr>
                  <th className="px-2 py-2">{t('budget.code')}</th>
                  <th className="px-2 py-2">{t('budget.codeName')}</th>
                  <th className="px-2 py-2">{t('budget.amount')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((_, index) => (
                  <tr key={index} className="border-t">
                    {renderInput(index, 0, 'code', t('budget.code'))}
                    {renderInput(index, 1, 'name', t('budget.codeName'))}
                    {renderInput(index, 2, 'amount', t('budget.amount'))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setRows((current) => [...current, ...emptyPasteGrid(3)])}>
            {t('budget.pasteAddRows')}
          </Button>
          <p className="text-xs text-muted-foreground">
            {t('budget.pasteSummary', { created: classified.creates.length, updated: classified.updates.length, skipped: parsed.skipped.length })}
          </p>
          {parsed.skipped.length > 0 ? (
            <ul className="max-h-24 overflow-auto text-xs text-red-700">
              {parsed.skipped.map((row) => (
                <li key={`${row.line}-${row.reasonCode}`}>
                  {t('budget.pasteSkip', { line: row.line, reason: t(`budget.pasteError.${row.reasonCode}`) })}
                </li>
              ))}
            </ul>
          ) : null}
          {hasError && <p role="alert" className="text-sm text-destructive">{t('budget.error.paste')}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => {
              setHasError(false)
              onOpenChange(false)
            }}>
              {t('common.cancel')}
            </Button>
            <Button type="button" onClick={handleConfirm} disabled={!canSubmit}>
              {t('budget.pasteConfirm')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
