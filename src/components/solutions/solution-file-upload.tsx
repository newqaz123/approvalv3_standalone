'use client'

import { useState, useCallback } from 'react'
import { Upload, File, FileImage, FileText, X, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { AttachmentUploadItem } from '@/lib/attachments/upload-batch'
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_FORM,
  ATTACHMENT_EXTENSIONS,
  validateAttachmentMetadata,
} from '@/lib/attachments/policy'

/**
 * Items-first solution attachment uploader. The sole caller
 * (SolutionForm) drives this through the `useSolutionAttachments` hook,
 * passing `items` + add/remove/retry callbacks. The legacy parallel
 * File[]-based API was removed in Task 6 after the caller migration.
 */
interface SolutionFileUploadProps {
  items: AttachmentUploadItem[]
  onAddFiles?: (files: File[]) => void
  onRemoveItem?: (id: string) => void
  onRetryItem?: (id: string) => void

  disabled?: boolean
  maxFiles?: number
  maxSizeBytes?: number
  existingFiles?: Array<{ id: string; fileName: string; fileType: string; fileSize: number; filePath: string }>
  onRemoveExistingFile?: (fileId: string) => void
}

export function SolutionFileUpload({
  items,
  onAddFiles,
  onRemoveItem,
  onRetryItem,
  disabled = false,
  maxFiles = MAX_ATTACHMENTS_PER_FORM,
  maxSizeBytes = MAX_ATTACHMENT_BYTES,
  existingFiles = [],
  onRemoveExistingFile,
}: SolutionFileUploadProps) {
  const [dragActive, setDragActive] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  const currentCount = items.length
  const totalFileCount = existingFiles.length + currentCount

  const getFileExtension = (filename: string): string => {
    return filename.slice(((filename.lastIndexOf('.') - 1) >>> 0) + 2).toLowerCase()
  }

  const getFileIcon = (file: File) => {
    const extension = getFileExtension(file.name)

    if (file.type.startsWith('image/')) {
      return <FileImage className="h-5 w-5 text-blue-500" />
    }

    if (extension === 'pdf') {
      return <FileText className="h-5 w-5 text-red-500" />
    }

    if (['dwg', 'dxf', 'step', 'stp', 'iges', 'igs'].includes(extension)) {
      return <File className="h-5 w-5 text-purple-500" />
    }

    return <File className="h-5 w-5 text-gray-500" />
  }

  const getFileIconByName = (fileName: string, fileType: string) => {
    const extension = getFileExtension(fileName)

    if (fileType.startsWith('image/')) {
      return <FileImage className="h-5 w-5 text-blue-500" />
    }

    if (extension === 'pdf') {
      return <FileText className="h-5 w-5 text-red-500" />
    }

    if (['dwg', 'dxf', 'step', 'stp', 'iges', 'igs'].includes(extension)) {
      return <File className="h-5 w-5 text-purple-500" />
    }

    return <File className="h-5 w-5 text-gray-500" />
  }

  const validateFile = (file: File): string | null => {
    return validateAttachmentMetadata({
      name: file.name,
      type: file.type,
      size: file.size,
    })
  }

  const handleFiles = useCallback(
    (newFiles: FileList | File[]) => {
      const fileArray = Array.from(newFiles)
      const validFiles: File[] = []
      const newErrors: string[] = []

      // Check if adding files would exceed max (including existing files)
      if (totalFileCount + fileArray.length > maxFiles) {
        newErrors.push(`Maximum ${maxFiles} files allowed (you have ${existingFiles.length} existing files)`)
        setErrors(newErrors)
        return
      }

      for (const file of fileArray) {
        const error = validateFile(file)
        if (error) {
          newErrors.push(error)
        } else {
          validFiles.push(file)
        }
      }

      if (newErrors.length > 0) {
        setErrors(newErrors)
        // Auto-clear errors after 5 seconds
        setTimeout(() => setErrors([]), 5000)
      }

      if (validFiles.length > 0) {
        // The hook owns state and handles the append via addFiles.
        onAddFiles?.(validFiles)
      }
    },
    [onAddFiles, maxFiles, totalFileCount, existingFiles.length]
  )

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDragActive(false)

      if (disabled) return

      const droppedFiles = e.dataTransfer.files
      handleFiles(droppedFiles)
    },
    [disabled, handleFiles]
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      e.preventDefault()
      if (disabled || !e.target.files) return

      handleFiles(e.target.files)
      // Reset input value to allow selecting the same file again
      e.target.value = ''
    },
    [disabled, handleFiles]
  )

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>File Attachments (Optional)</CardTitle>
        <CardDescription>
          Attach supporting documents (PDF, Images, CAD files, Office docs)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Error messages */}
        {errors.length > 0 && (
          <div className="space-y-2">
            {errors.map((error, index) => (
              <div key={index} className="text-sm text-red-600 bg-red-50 p-2 rounded">
                {error}
              </div>
            ))}
          </div>
        )}

        {/* Existing Files Section */}
        {existingFiles.length > 0 && (
          <div className="border rounded-lg p-4 bg-blue-50/50">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-blue-900">Existing Attachments</h4>
              <span className="text-xs text-blue-700">{existingFiles.length} file(s)</span>
            </div>
            <div className="space-y-2">
              {existingFiles.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center gap-3 p-3 border border-blue-200 rounded-lg bg-white"
                >
                  {getFileIconByName(file.fileName, file.fileType)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{file.fileName}</p>
                    <p className="text-xs text-gray-500">{formatFileSize(file.fileSize)}</p>
                  </div>
                  {onRemoveExistingFile && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onRemoveExistingFile(file.id)}
                      disabled={disabled}
                      className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Drag and drop zone */}
        <div
          className={cn(
            'border-2 border-dashed rounded-lg p-6 text-center transition-colors',
            dragActive
              ? 'border-primary bg-primary/5'
              : 'border-gray-300 hover:border-gray-400',
            disabled && 'opacity-50 cursor-not-allowed'
          )}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <input
            type="file"
            id="solution-file-upload"
            multiple
            onChange={handleChange}
            disabled={disabled || currentCount >= maxFiles}
            accept={ATTACHMENT_EXTENSIONS.map((ext) => `.${ext}`).join(',')}
            className="hidden"
          />
          <label
            htmlFor="solution-file-upload"
            className={cn(
              'cursor-pointer block',
              disabled && 'cursor-not-allowed'
            )}
          >
            <Upload
              className={cn(
                'mx-auto h-12 w-12 transition-colors',
                dragActive ? 'text-primary' : 'text-gray-400'
              )}
            />
            <p className="mt-2 text-sm text-gray-600">
              Click to upload or drag and drop
            </p>
            <p className="text-xs text-gray-500 mt-1">
              PDF, Images, CAD files, Office docs (max {Math.round(maxSizeBytes / 1024 / 1024)}MB each)
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {existingFiles.length > 0
                ? `${existingFiles.length} existing + ${currentCount} new / ${maxFiles} files`
                : `${currentCount} / ${maxFiles} files`
              }
            </p>
          </label>
        </div>

        {/* Selected files list */}
        {items.length > 0 && (
          <div className="space-y-3">
            {items.map((item) => {
              const file = item.file
              const showProgress = item.status === 'uploading'
              const isSuccess = item.status === 'success'
              const isError = item.status === 'error'

              return (
                <div
                  key={item.id}
                  className="flex items-center gap-3 p-3 border rounded-lg bg-white"
                >
                  {getFileIcon(file)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium truncate">{file.name}</p>
                      <span className="text-xs text-gray-500">{formatFileSize(file.size)}</span>
                    </div>
                    {showProgress && (
                      <p className="text-xs text-gray-500 mt-1">Uploading...</p>
                    )}
                    {isError && item.error && (
                      <p className="text-xs text-red-600 mt-1">{item.error}</p>
                    )}
                    {isSuccess && (
                      <p className="text-xs text-green-600 mt-1">Uploaded</p>
                    )}
                  </div>
                  {/* Retry action: error items stay in the list and remain
                      retryable via the items-first API. */}
                  {isError && onRetryItem && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onRetryItem(item.id)}
                      disabled={disabled}
                      className="h-8 px-2 text-blue-600 hover:text-blue-700"
                    >
                      <RotateCcw className="h-4 w-4" />
                      <span className="text-xs ml-1">Retry</span>
                    </Button>
                  )}
                  {!showProgress && !isSuccess && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onRemoveItem?.(item.id)}
                      disabled={disabled}
                      className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
