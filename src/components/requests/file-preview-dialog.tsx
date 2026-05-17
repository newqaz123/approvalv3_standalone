'use client'

import { useEffect, useMemo, useState } from 'react'
import { Download, FileText, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { getFilePreviewKind, type FilePreviewKind } from '@/lib/file-preview'

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
  const fileTypeLabel = file?.fileType || previewKind.toUpperCase()

  const downloadButton = file ? (
    <Button size="sm" variant="outline" onClick={() => onDownload(file)}>
      <Download className="h-4 w-4 mr-1" />
      Download
    </Button>
  ) : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[88vh] max-h-[88vh] grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
        <DialogHeader className="pr-8">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <DialogTitle className="truncate">{file?.fileName || 'File preview'}</DialogTitle>
              <DialogDescription className="mt-1 flex flex-wrap items-center gap-2">
                {fileSizeLabel && <span>{fileSizeLabel}</span>}
                {fileSizeLabel && <span aria-hidden="true">•</span>}
                <span>{fileTypeLabel}</span>
              </DialogDescription>
            </div>
            <div className="shrink-0 pr-8">{downloadButton}</div>
          </div>
        </DialogHeader>

        <div className="min-h-0 overflow-auto rounded-lg border bg-slate-50">
          {renderPreviewContent(previewKind, url, loadState)}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function renderPreviewContent(kind: FilePreviewKind, url: string | null, loadState: LoadState) {
  if (!url) {
    return <PreviewMessage message={DEFAULT_ERROR} />
  }

  if (kind === 'pdf') {
    return <iframe src={url} title="PDF preview" className="h-full min-h-[70vh] w-full bg-white" />
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
    return <PreviewMessage message="Preview is not available for this file type. Download the file to view it." />
  }

  if (loadState.status === 'loading') {
    return (
      <div className="flex min-h-[50vh] items-center justify-center gap-2 text-sm text-slate-600">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading preview...
      </div>
    )
  }

  if (loadState.status === 'error') {
    return <PreviewMessage message={loadState.message} />
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

function PreviewMessage({ message }: { message: string }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-6 text-center text-slate-600">
      <FileText className="h-10 w-10 text-slate-400" />
      <p className="max-w-md text-sm">{message}</p>
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
