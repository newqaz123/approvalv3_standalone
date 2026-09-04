'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getFileDownloadUrl, getFilePreviewUrl } from '@/lib/file-preview'

export type AttachmentPreviewFile = {
  id: string
  fileName: string
  fileType?: string | null
  fileSize?: number | null
}

export function useAttachmentPreview() {
  const [previewFile, setPreviewFile] = useState<AttachmentPreviewFile | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const blobUrlRef = useRef<string | null>(null)

  const revokeBlobUrl = useCallback(() => {
    if (!blobUrlRef.current) return
    URL.revokeObjectURL(blobUrlRef.current)
    blobUrlRef.current = null
  }, [])

  const previewLocalFile = useCallback(
    (file: File) => {
      revokeBlobUrl()
      const objectUrl = URL.createObjectURL(file)
      blobUrlRef.current = objectUrl
      setPreviewFile({
        id: 'local',
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
      })
      setPreviewUrl(objectUrl)
      setPreviewOpen(true)
    },
    [revokeBlobUrl]
  )

  const previewSavedFile = useCallback(
    (file: AttachmentPreviewFile) => {
      revokeBlobUrl()
      setPreviewFile(file)
      setPreviewUrl(getFilePreviewUrl(file.id))
      setPreviewOpen(true)
    },
    [revokeBlobUrl]
  )

  const onPreviewOpenChange = useCallback(
    (open: boolean) => {
      setPreviewOpen(open)
      if (!open) {
        revokeBlobUrl()
        setPreviewFile(null)
        setPreviewUrl(null)
      }
    },
    [revokeBlobUrl]
  )

  const onDownloadPreview = useCallback((file: AttachmentPreviewFile) => {
    const href = blobUrlRef.current ?? getFileDownloadUrl(file.id)
    if (!href) return
    const link = document.createElement('a')
    link.href = href
    link.download = file.fileName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }, [])

  useEffect(() => () => revokeBlobUrl(), [revokeBlobUrl])

  return {
    previewFile,
    previewUrl,
    previewOpen,
    onPreviewOpenChange,
    previewLocalFile,
    previewSavedFile,
    onDownloadPreview,
  }
}
