'use client'

import { useRef, useState } from 'react'
import { Camera, Upload, X, FileImage, File } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface MobileFile {
  id: string
  file: File
  preview?: string
}

interface MobileFileUploadProps {
  onFilesSelected: (files: File[]) => void
  selectedFiles: MobileFile[]
  onRemove: (id: string) => void
  disabled?: boolean
  maxFileSize?: number // in bytes
  allowedTypes?: string[]
}

const DEFAULT_MAX_SIZE = 10 * 1024 * 1024 // 10MB
const DEFAULT_ALLOWED_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
  'image/gif',
]

export function MobileFileUpload({
  onFilesSelected,
  selectedFiles,
  onRemove,
  disabled = false,
  maxFileSize = DEFAULT_MAX_SIZE,
  allowedTypes = DEFAULT_ALLOWED_TYPES,
}: MobileFileUploadProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  const validateAndProcessFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return

    setError(null)
    const validFiles: File[] = []
    const fileArray = Array.from(files)

    for (const file of fileArray) {
      // Check file type
      if (!allowedTypes.includes(file.type)) {
        setError(`${file.name}: File type not supported`)
        continue
      }

      // Check file size
      if (file.size > maxFileSize) {
        setError(`${file.name}: File size exceeds ${formatFileSize(maxFileSize)} limit`)
        continue
      }

      validFiles.push(file)
    }

    if (validFiles.length > 0) {
      onFilesSelected(validFiles)
    }

    // Reset inputs
    if (cameraInputRef.current) cameraInputRef.current.value = ''
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleCameraCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    validateAndProcessFiles(e.target.files)
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    validateAndProcessFiles(e.target.files)
  }

  const openCamera = () => {
    if (!disabled) {
      cameraInputRef.current?.click()
    }
  }

  const openFilePicker = () => {
    if (!disabled) {
      fileInputRef.current?.click()
    }
  }

  const isImageFile = (file: File) => file.type.startsWith('image/')

  return (
    <div className="space-y-3">
      {/* Error message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
          {error}
        </div>
      )}

      {/* Upload buttons - stacked vertically on mobile */}
      <div className="grid grid-cols-2 gap-3">
        {/* Camera button */}
        <button
          type="button"
          onClick={openCamera}
          disabled={disabled}
          className={cn(
            'flex flex-col items-center justify-center gap-2 min-h-24 w-full',
            'rounded-lg border-2 border-dashed border-gray-300 bg-gray-50',
            'active:bg-gray-100 active:border-gray-400',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            'transition-colors'
          )}
        >
          <Camera className="h-6 w-6 text-gray-600" />
          <span className="text-sm font-medium text-gray-700">Take Photo</span>
          <span className="text-xs text-gray-500">Use camera</span>
        </button>

        {/* File picker button */}
        <button
          type="button"
          onClick={openFilePicker}
          disabled={disabled}
          className={cn(
            'flex flex-col items-center justify-center gap-2 min-h-24 w-full',
            'rounded-lg border-2 border-dashed border-gray-300 bg-gray-50',
            'active:bg-gray-100 active:border-gray-400',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            'transition-colors'
          )}
        >
          <Upload className="h-6 w-6 text-gray-600" />
          <span className="text-sm font-medium text-gray-700">Choose File</span>
          <span className="text-xs text-gray-500">Browse files</span>
        </button>
      </div>

      {/* Hidden file inputs */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleCameraCapture}
        disabled={disabled}
        className="hidden"
      />
      <input
        ref={fileInputRef}
        type="file"
        accept={allowedTypes.join(',')}
        multiple
        onChange={handleFileSelect}
        disabled={disabled}
        className="hidden"
      />

      {/* Selected files list */}
      {selectedFiles.length > 0 && (
        <div className="space-y-2 mt-4">
          <p className="text-sm font-medium text-gray-700">
            Selected Files ({selectedFiles.length})
          </p>
          {selectedFiles.map((mobileFile) => (
            <div
              key={mobileFile.id}
              className="flex items-start gap-3 p-3 bg-white border border-gray-200 rounded-lg"
            >
              {/* Thumbnail or icon */}
              <div className="flex-shrink-0 w-12 h-12 rounded bg-gray-100 flex items-center justify-center">
                {mobileFile.preview ? (
                  <img
                    src={mobileFile.preview}
                    alt={mobileFile.file.name}
                    className="w-full h-full object-cover rounded"
                  />
                ) : isImageFile(mobileFile.file) ? (
                  <FileImage className="h-6 w-6 text-gray-400" />
                ) : (
                  <File className="h-6 w-6 text-gray-400" />
                )}
              </div>

              {/* File info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {mobileFile.file.name}
                </p>
                <p className="text-xs text-gray-500">
                  {formatFileSize(mobileFile.file.size)}
                </p>
              </div>

              {/* Remove button */}
              <button
                type="button"
                onClick={() => onRemove(mobileFile.id)}
                disabled={disabled}
                className={cn(
                  'flex-shrink-0 p-2 rounded-md',
                  'text-gray-400 hover:text-red-600',
                  'hover:bg-red-50 active:bg-red-100',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  'transition-colors'
                )}
                aria-label="Remove file"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Helper text */}
      <p className="text-xs text-gray-500 text-center">
        PDF, Word, Excel, Images (max {formatFileSize(maxFileSize)} each)
      </p>
    </div>
  )
}
