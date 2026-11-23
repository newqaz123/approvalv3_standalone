'use client'

import { useTranslations } from '@/lib/i18n/client'
import { useEffect, useMemo, useState, useTransition } from 'react'
import { ArrowDown, ArrowUp, CheckCircle2, FileArchive, FileText, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  buildDefaultExportPackageItems,
  buildSelectedExportPackageRequestItems,
  moveExportPackageItem,
  reorderExportPackageItems,
  type ExportPackageAttachment,
  type ExportPackageItem,
  type ExportPackageRequestItem,
} from '@/lib/export-package'
import { cn } from '@/lib/utils'

interface CompletedApprovalExportBuilderProps {
  requestAttachments: ExportPackageAttachment[]
  solutionAttachments: ExportPackageAttachment[]
  onExportPackage: (items: ExportPackageRequestItem[]) => Promise<void>
}

const sourceLabelKey = {
  'approval-report': 'requests.packetReportName',
  'request-attachment': 'requests.packetRequest',
  'solution-attachment': 'requests.packetSolution',
} as const

const kindLabelKey = {
  'approval-report': 'requests.packetReport',
  image: 'editor.image',
  docx: 'requests.packetDocx',
  xlsx: 'requests.packetXlsx',
  unsupported: 'requests.packetUnsupported',
} as const

export function CompletedApprovalExportBuilder({
  requestAttachments,
  solutionAttachments,
  onExportPackage,
}: CompletedApprovalExportBuilderProps) {
  const t = useTranslations()
  const packageItemsKey = buildPackageItemsKey(requestAttachments, solutionAttachments)
  const defaultItems = useMemo(
    () => buildDefaultExportPackageItems({ requestAttachments, solutionAttachments }),
    // Parent modal data can be rebuilt on unrelated state changes. Depend on
    // attachment content so user selection/order survives those re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [packageItemsKey]
  )
  const [items, setItems] = useState(defaultItems)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    setItems(defaultItems)
  }, [defaultItems])

  const itemLabel = (item: ExportPackageItem) => item.type === 'approval-report' ? t('requests.packetReportName') : item.fileName
  const orderedItems = reorderExportPackageItems(items)
  const selectedMergeableCount = orderedItems.filter((item) => item.selected && item.mergeable).length
  const reportSelected = orderedItems.some(
    (item) => item.type === 'approval-report' && item.selected
  )

  const setItemSelected = (itemId: string, selected: boolean) => {
    setItems((current) =>
      current.map((item) =>
        item.id === itemId
          ? { ...item, selected: item.mergeable && selected }
          : item
      )
    )
  }

  const moveItem = (itemId: string, direction: 'up' | 'down') => {
    const current = reorderExportPackageItems(items)
    const currentIndex = current.findIndex((item) => item.id === itemId)
    const target = direction === 'up'
      ? current[currentIndex - 1]
      : current[currentIndex + 1]

    if (!target) return
    setItems(moveExportPackageItem(current, itemId, target.id))
  }

  const handleExport = () => {
    setError(null)
    const requestItems = buildSelectedExportPackageRequestItems(items)

    if (requestItems.length === 0) {
      setError(t('requests.exportSelectReport'))
      return
    }

    startTransition(async () => {
      try {
        await onExportPackage(requestItems)
      } catch (err) {
        setError(t('requests.error.exportPackage'))
      }
    })
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-black text-slate-900 dark:text-slate-100">
            <FileArchive className="h-4 w-4 text-emerald-600" />
            {t('requests.exportPacketTitle')}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {t('requests.exportPacketHelp')}
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {t('requests.selectedCount', { count: selectedMergeableCount })}
        </div>
      </div>

      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {orderedItems.map((item, index) => (
          <div
            key={item.id}
            className={cn(
              'grid grid-cols-[auto_1fr_auto] gap-3 px-4 py-3',
              item.type !== 'approval-report' && 'bg-slate-50/70 dark:bg-slate-950/30'
            )}
          >
            <Checkbox
              checked={item.selected}
              disabled={!item.mergeable}
              onCheckedChange={(checked) => setItemSelected(item.id, checked === true)}
              aria-label={t('requests.selectNamed', { name: itemLabel(item) })}
            />

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <FileText className="h-4 w-4 text-slate-500" />
                <span className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">
                  {itemLabel(item)}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-medium text-slate-500">
                <span>{t(sourceLabelKey[item.type])}</span>
                <span className="h-1 w-1 rounded-full bg-slate-300" />
                <span className={item.mergeable ? 'text-emerald-700' : 'text-amber-700'}>
                  {item.kind === 'pdf' ? 'PDF' : t(kindLabelKey[item.kind])}
                </span>
                {item.description && (
                  <>
                    <span className="h-1 w-1 rounded-full bg-slate-300" />
                    <span className="truncate">{item.description}</span>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                disabled={index === 0}
                onClick={() => moveItem(item.id, 'up')}
                aria-label={t('requests.moveNamedUp', { name: itemLabel(item) })}
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                disabled={index === orderedItems.length - 1}
                onClick={() => moveItem(item.id, 'down')}
                aria-label={t('requests.moveNamedDown', { name: itemLabel(item) })}
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3 border-t border-slate-100 p-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-slate-500">
          {t('requests.exportUnsupported')}
        </p>
        <Button
          type="button"
          onClick={handleExport}
          disabled={isPending || !reportSelected}
          className="bg-emerald-600 text-white hover:bg-emerald-700"
        >
          {isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('requests.buildingPacket')}</>
          ) : (
            <>
              <FileArchive className="mr-2 h-4 w-4" />
              {t('requests.exportPacket')}</>
          )}
        </Button>
      </div>

      {error && (
        <div className="border-t border-red-100 bg-red-50 px-4 py-3 text-xs font-medium text-red-700">
          {error}
        </div>
      )}
    </section>
  )
}

function buildPackageItemsKey(
  requestAttachments: ExportPackageAttachment[],
  solutionAttachments: ExportPackageAttachment[]
): string {
  const serialize = (source: 'request' | 'solution', attachment: ExportPackageAttachment) =>
    [
      source,
      attachment.id,
      attachment.fileName,
      attachment.fileType ?? '',
      attachment.fileSize ?? '',
      attachment.filePath ?? '',
      attachment.description ?? '',
    ].join(':')

  return [
    ...requestAttachments.map((attachment) => serialize('request', attachment)),
    ...solutionAttachments.map((attachment) => serialize('solution', attachment)),
  ].join('|')
}
