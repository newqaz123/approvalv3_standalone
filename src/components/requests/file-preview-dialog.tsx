'use client'

import { useEffect, useMemo, useState } from 'react'
import { Download, FileText, Loader2, X } from 'lucide-react'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  getFilePreviewKind,
  getFilePreviewTypeLabel,
  type FilePreviewKind,
} from '@/lib/file-preview'
import { cn } from '@/lib/utils'

interface PreviewFile {
  id: string
  fileName: string
  fileType?: string | null
  fileSize?: number | null
}

interface FilePreviewDialogProps {
  file: PreviewFile | null
  url: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onDownload: (file: PreviewFile) => void
  formatFileSize?: (bytes: number) => string
}

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'text'; text: string }
  | { status: 'xlsx'; sheets: Array<{ name: string; rows: string[][] }> }
  | { status: 'error'; message: string }

const DEFAULT_ERROR = 'Preview is not available for this file. You can download the original file instead.'

function normalizeCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toLocaleString()
  return String(value)
}

export function FilePreviewDialog({
  file,
  url,
  open,
  onOpenChange,
  onDownload,
  formatFileSize,
}: FilePreviewDialogProps) {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'idle' })
  const previewKind = useMemo<FilePreviewKind>(
    () => (file ? getFilePreviewKind(file) : 'unsupported'),
    [file]
  )
  const fileTypeLabel = useMemo(
    () => (file ? getFilePreviewTypeLabel(file) : 'File'),
    [file]
  )

  useEffect(() => {
    let cancelled = false

    async function loadPreviewContent() {
      if (!open || !file || !url) {
        setLoadState({ status: 'idle' })
        return
      }

      if (previewKind !== 'text' && previewKind !== 'docx' && previewKind !== 'xlsx') {
        setLoadState({ status: 'idle' })
        return
      }

      setLoadState({ status: 'loading' })

      try {
        const response = await fetch(url)
        if (!response.ok) {
          throw new Error(`Preview request failed with ${response.status}`)
        }

        if (previewKind === 'text') {
          const text = await response.text()
          if (!cancelled) setLoadState({ status: 'text', text })
          return
        }

        const arrayBuffer = await response.arrayBuffer()

        if (previewKind === 'docx') {
          const mammoth = await import('mammoth')
          const result = await mammoth.extractRawText({ arrayBuffer })
          if (!cancelled) setLoadState({ status: 'text', text: result.value.trim() || 'No text content found.' })
          return
        }

        const XLSX = await import('xlsx')
        const workbook = XLSX.read(arrayBuffer, { type: 'array' })
        const sheets = workbook.SheetNames.map((name) => {
          const rows = XLSX.utils
            .sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, blankrows: false })
            .map((row) => row.map(normalizeCell))
          return { name, rows }
        })

        if (!cancelled) setLoadState({ status: 'xlsx', sheets })
      } catch (error) {
        console.error('[FilePreviewDialog] Failed to load preview:', error)
        if (!cancelled) setLoadState({ status: 'error', message: DEFAULT_ERROR })
      }
    }

    loadPreviewContent()

    return () => {
      cancelled = true
    }
  }, [file, open, previewKind, url])

  const fileSizeLabel = file?.fileSize && formatFileSize ? formatFileSize(file.fileSize) : null
  const showCanvasDownload =
    Boolean(file) && (previewKind === 'unsupported' || loadState.status === 'error' || !url)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        className="max-w-5xl gap-0 overflow-hidden p-0 grid-rows-[auto_minmax(0,1fr)] pointer-coarse:h-[92svh] pointer-fine:h-[88vh] pointer-fine:max-h-[88vh]"
      >
        <DialogHeader className="flex flex-row items-center gap-3 space-y-0 border-b px-3.5 pb-2 pt-7 text-left shrink-0 pointer-fine:pt-3">
          <div
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-[9.5px] font-bold tracking-wider',
              previewKind === 'pdf' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'
            )}
          >
            {fileTypeLabel}
          </div>
          <div className="min-w-0 flex-1">
            <DialogTitle className="line-clamp-2 break-words text-[15.5px] font-semibold leading-snug tracking-tight">
              {file?.fileName || 'File preview'}
            </DialogTitle>
            <DialogDescription className="mt-0.5 text-[12.5px] text-slate-500">
              {fileTypeLabel}
              {fileSizeLabel ? ` · ${fileSizeLabel}` : ''}
            </DialogDescription>
          </div>
          {file ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-11 w-11 shrink-0 text-slate-700"
              onClick={() => onDownload(file)}
            >
              <Download className="h-5 w-5" />
              <span className="sr-only">Download</span>
            </Button>
          ) : null}
          <DialogClose className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-700 transition-colors hover:bg-slate-100">
            <X className="h-5 w-5" />
            <span className="sr-only">Close</span>
          </DialogClose>
        </DialogHeader>

        <div className="min-h-0 overflow-auto bg-slate-100">
          {renderPreviewContent(
            previewKind,
            url,
            loadState,
            showCanvasDownload && file ? () => onDownload(file) : undefined
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function renderPreviewContent(
  kind: FilePreviewKind,
  url: string | null,
  loadState: LoadState,
  onDownload?: () => void
) {
  if (!url) {
    return <PreviewMessage message={DEFAULT_ERROR} onDownload={onDownload} />
  }

  if (kind === 'pdf') {
    // Phones get an svh floor so iOS toolbars cannot crop the document; the
    // desktop iframe keeps filling the tall fixed-height card.
    return <iframe src={url} title="PDF preview" className="h-full min-h-0 w-full bg-white pointer-fine:h-full pointer-fine:min-h-[70vh]" />
  }

  if (kind === 'image') {
    return (
      <div className="flex min-h-full items-start justify-center p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="Attachment preview" className="max-h-none max-w-full rounded bg-white object-contain" />
      </div>
    )
  }

  if (kind === 'unsupported') {
    return (
      <PreviewMessage
        message="Preview is not available for this file type. Download the file to view it."
        onDownload={onDownload}
      />
    )
  }

  if (loadState.status === 'loading') {
    return (
      <div className="flex min-h-full items-center justify-center gap-2 text-sm text-slate-600">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading preview...
      </div>
    )
  }

  if (loadState.status === 'error') {
    return <PreviewMessage message={loadState.message} onDownload={onDownload} />
  }

  if (loadState.status === 'text') {
    return (
      <pre className="min-h-full whitespace-pre-wrap break-words bg-white p-4 text-sm leading-6 text-slate-800">
        {loadState.text}
      </pre>
    )
  }

  if (loadState.status === 'xlsx') {
    return <WorkbookPreview sheets={loadState.sheets} />
  }

  return <PreviewMessage message="Preparing preview..." />
}

function PreviewMessage({
  message,
  onDownload,
}: {
  message: string
  onDownload?: () => void
}) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-3 p-6 text-center text-slate-600">
      <FileText className="h-10 w-10 text-slate-400" />
      <p className="max-w-md text-sm">{message}</p>
      {onDownload ? (
        <Button type="button" className="mt-2" onClick={onDownload}>
          <Download className="h-4 w-4" />
          Download
        </Button>
      ) : null}
    </div>
  )
}

function WorkbookPreview({ sheets }: { sheets: Array<{ name: string; rows: string[][] }> }) {
  if (sheets.length === 0) {
    return <PreviewMessage message="No spreadsheet data found." />
  }

  return (
    <div className="space-y-6 bg-white p-4">
      {sheets.map((sheet) => (
        <section key={sheet.name}>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">{sheet.name}</h3>
          {sheet.rows.length === 0 ? (
            <p className="text-sm text-slate-500">This sheet is empty.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="min-w-full border-collapse text-left text-xs">
                <tbody>
                  {sheet.rows.map((row, rowIndex) => (
                    <tr key={`${sheet.name}-${rowIndex}`} className={rowIndex === 0 ? 'bg-slate-100' : undefined}>
                      {row.map((cell, cellIndex) => (
                        <td key={`${sheet.name}-${rowIndex}-${cellIndex}`} className="border px-2 py-1 align-top">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </div>
  )
}
