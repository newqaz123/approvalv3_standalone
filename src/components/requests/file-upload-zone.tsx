'use client'

import { useState, useCallback } from 'react'
import { Upload, File, X, Check } from 'lucide-react'
import { prepareFileUpload, confirmFileUpload } from '@/server-actions/files'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'

interface UploadedFile {
  id: string
  file: File
  status: 'pending' | 'uploading' | 'success' | 'error'
  progress: number
  error?: string
  description?: string
}

interface FileUploadZoneProps {
  requestId: string
  onFilesUploaded?: (files: Array<{ id: string; fileName: string }>) => void
  maxFiles?: number
  disabled?: boolean
}

export function FileUploadZone({
  requestId,
  onFilesUploaded,
  maxFiles = 10,
  disabled = false,
}: FileUploadZoneProps) {
  const [files, setFiles] = useState<UploadedFile[]>([])

  const handleFileSelect = useCallback(async (selectedFiles: FileList) => {
    const fileArray = Array.from(selectedFiles)

    // Check max files limit
    if (files.length + fileArray.length > maxFiles) {
      alert(`Maximum ${maxFiles} files allowed`)
      return
    }

    // Add files to state as pending
    const newFiles: UploadedFile[] = fileArray.map((file) => ({
      id: Math.random().toString(36),
      file,
      status: 'pending' as const,
      progress: 0,
    }))

    setFiles((prev) => [...prev, ...newFiles])

    // Upload each file
    for (const newFile of newFiles) {
      await uploadFile(newFile, requestId)
    }
  }, [files.length, maxFiles, requestId])

  const uploadFile = async (uploadedFile: UploadedFile, requestId: string) => {
    setFiles((prev) =>
      prev.map((f) =>
        f.id === uploadedFile.id ? { ...f, status: 'uploading' } : f
      )
    )

    try {
      // Step 1: Prepare upload with server
      const prepareResult = await prepareFileUpload({
        fileName: uploadedFile.file.name,
        fileType: uploadedFile.file.type,
        fileSize: uploadedFile.file.size,
        requestId,
      })

      if (!prepareResult.success || !prepareResult.uploadUrl) {
        throw new Error(prepareResult.error || 'Failed to prepare upload')
      }

      // Step 2: Upload to API route with progress tracking
      const formData = new FormData()
      formData.append('file', uploadedFile.file)
      formData.append('requestId', requestId)

      let uploadData: any

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const progress = Math.round((e.loaded / e.total) * 100)
            setFiles((prev) =>
              prev.map((f) =>
                f.id === uploadedFile.id ? { ...f, progress } : f
              )
            )
          }
        })

        xhr.addEventListener('load', () => {
          if (xhr.status === 200) {
            const response = JSON.parse(xhr.responseText)
            if (response.success) {
              uploadData = response
              resolve()
            } else {
              reject(new Error(response.error || 'Upload failed'))
            }
          } else {
            reject(new Error('Upload failed'))
          }
        })

        xhr.addEventListener('error', () => reject(new Error('Upload failed')))
        xhr.open('POST', prepareResult.uploadUrl!)
        xhr.send(formData)
      })

      if (!uploadData.success) {
        throw new Error('Failed to get file data')
      }

      // Step 3: Confirm upload and save metadata
      const confirmResult = await confirmFileUpload({
        requestId,
        fileId: prepareResult.fileId!,
        fileName: uploadedFile.file.name,
        fileType: uploadedFile.file.type,
        fileSize: uploadedFile.file.size,
        filePath: uploadData.filePath,
      })

      if (!confirmResult.success) {
        throw new Error('Failed to save file metadata')
      }

      // Mark as success
      setFiles((prev) =>
        prev.map((f) =>
          f.id === uploadedFile.id ? { ...f, status: 'success', progress: 100 } : f
        )
      )

      // Notify parent
      onFilesUploaded?.([{
        id: prepareResult.fileId!,
        fileName: uploadedFile.file.name,
      }])
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Upload failed'
      setFiles((prev) =>
        prev.map((f) =>
          f.id === uploadedFile.id ? { ...f, status: 'error', error: errorMessage } : f
        )
      )
    }
  }

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id))
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  return (
    <div className="space-y-4">
      {/* File input */}
      <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
        <input
          type="file"
          id="file-upload"
          multiple
          onChange={(e) => e.target.files && handleFileSelect(e.target.files)}
          disabled={disabled}
          accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif"
          className="hidden"
        />
        <label
          htmlFor="file-upload"
          className={`cursor-pointer ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <Upload className="mx-auto h-12 w-12 text-gray-400" />
          <p className="mt-2 text-sm text-gray-600">
            Click to upload or drag and drop
          </p>
          <p className="text-xs text-gray-500">
            PDF, Word, Excel, Images (max 10MB each, max {maxFiles} files)
          </p>
        </label>
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((file) => (
            <div
              key={file.id}
              className="flex items-center gap-3 p-3 border rounded-lg bg-white"
            >
              {file.status === 'success' ? (
                <Check className="h-5 w-5 text-green-500 flex-shrink-0" />
              ) : file.status === 'error' ? (
                <X className="h-5 w-5 text-red-500 flex-shrink-0" />
              ) : (
                <File className="h-5 w-5 text-gray-400 flex-shrink-0" />
              )}

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{file.file.name}</p>
                <p className="text-xs text-gray-500">
                  {formatFileSize(file.file.size)}
                  {file.status === 'uploading' && ` - ${file.progress}%`}
                </p>
                {file.status === 'error' && (
                  <p className="text-xs text-red-500">{file.error}</p>
                )}
              </div>

              {file.status === 'uploading' && (
                <div className="w-24">
                  <Progress value={file.progress} className="h-2" />
                </div>
              )}

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeFile(file.id)}
                disabled={file.status === 'uploading'}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
