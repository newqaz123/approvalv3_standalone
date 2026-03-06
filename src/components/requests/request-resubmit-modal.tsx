'use client'

import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import {
  X,
  Upload,
  Info,
  Paperclip,
  FileImage,
  FileSpreadsheet,
  File,
  FileText,
  AlertTriangle,
  RotateCcw,
  Trash2,
  Send,
  FileUp,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

// Types
interface FileAttachment {
  id: string
  fileName: string
  fileType: 'pdf' | 'image' | 'docx' | 'xlsx' | string
  description?: string
}

interface RequestResubmitModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialData: {
    title: string
    description: string
    templateId?: string
    rejectionReason: string
    rejectedBy: string
    rejectedAt: string
    files: FileAttachment[]
  }
  onResubmit: (data: {
    title: string
    description: string
    templateId?: string
    files: File[]
    deletedFileIds?: string[]
  }) => void
}

// File icon helper
function getFileIcon(fileType: string) {
  switch (fileType) {
    case 'pdf':
      return <FileText className="w-5 h-5 text-red-500" />
    case 'image':
      return <FileImage className="w-5 h-5 text-purple-500" />
    case 'xlsx':
      return <FileSpreadsheet className="w-5 h-5 text-emerald-500" />
    case 'docx':
      return <FileText className="w-5 h-5 text-blue-500" />
    default:
      return <File className="w-5 h-5 text-slate-400" />
  }
}

export function RequestResubmitModal({
  open,
  onOpenChange,
  initialData,
  onResubmit,
}: RequestResubmitModalProps) {
  const [title, setTitle] = useState(initialData.title)
  const [description, setDescription] = useState(initialData.description)
  const [selectedTemplate, setSelectedTemplate] = useState(initialData.templateId || '')
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; title: string; description: string }>>([])  
  const [loadingTemplates, setLoadingTemplates] = useState(false)
  const [existingFiles, setExistingFiles] = useState<FileAttachment[]>(initialData.files)
  const [deletedFileIds, setDeletedFileIds] = useState<string[]>([])
  const [newFiles, setNewFiles] = useState<File[]>([])

  // Fetch templates from database
  useEffect(() => {
    if (open) {
      const fetchTemplates = async () => {
        setLoadingTemplates(true)
        try {
          const response = await fetch('/api/templates')
          if (response.ok) {
            const data = await response.json()
            setTemplates(data)
          }
        } catch (error) {
          console.error('Failed to fetch templates:', error)
        } finally {
          setLoadingTemplates(false)
        }
      }
      fetchTemplates()
    }
  }, [open])
  const [fileDescriptions, setFileDescriptions] = useState<Record<string, string>>({})

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files)
      setNewFiles((prev: File[]) => [...prev, ...files])
    }
  }

  const removeFile = (index: number) => {
    setNewFiles((prev: File[]) => prev.filter((_: File, i: number) => i !== index))
  }

  const removeExistingFile = (fileId: string) => {
    setExistingFiles((prev) => prev.filter((f) => f.id !== fileId))
    setDeletedFileIds((prev) => [...prev, fileId])
  }

  const updateFileDescription = (fileName: string, desc: string) => {
    setFileDescriptions((prev: Record<string, string>) => ({ ...prev, [fileName]: desc }))
  }

  const handleSubmit = () => {
    onResubmit({
      title,
      description,
      templateId: selectedTemplate || undefined,
      files: newFiles,
      deletedFileIds,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-full max-h-[90vh] p-0 gap-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl rounded-xl overflow-hidden">
        {/* Header */}
        <DialogHeader className="flex-shrink-0 px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <RotateCcw className="w-5 h-5 text-amber-600" />
              <DialogTitle className="text-lg font-bold text-slate-900 dark:text-slate-100 tracking-tight m-0">
                Resubmit Request
              </DialogTitle>
            </div>
            <button
              onClick={() => onOpenChange(false)}
              className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-slate-600"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </DialogHeader>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6" style={{ maxHeight: 'calc(90vh - 180px)' }}>
          {/* Rejection Banner */}
          <div className="bg-red-50 dark:bg-red-900/10 rounded-xl p-4 border border-red-200 dark:border-red-800/30">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-bold text-red-900 dark:text-red-400">
                  Request Was Rejected
                </h4>
                <p className="text-xs text-red-600 dark:text-red-300 mt-1">
                  Rejected by {initialData.rejectedBy} on{' '}
                  {format(new Date(initialData.rejectedAt), 'MMM d, yyyy')}
                </p>
                <div className="mt-2 p-2 bg-white dark:bg-slate-900 rounded border border-red-100 dark:border-red-800/30">
                  <p className="text-xs text-slate-700 dark:text-slate-300 italic">
                    &ldquo;{initialData.rejectionReason}&rdquo;
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Form Fields */}
          <div className="space-y-4">
            {/* Template Selection */}
            <div>
              <Label htmlFor="template" className="text-sm font-bold">
                Template
              </Label>
              <Select value={selectedTemplate} onValueChange={setSelectedTemplate} disabled={loadingTemplates}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder={loadingTemplates ? "Loading templates..." : "Select a template (optional)"} />
                </SelectTrigger>
                <SelectContent>
                  {templates.length === 0 && !loadingTemplates && (
                    <SelectItem value="none" disabled>No templates available</SelectItem>
                  )}
                  {templates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500 mt-1">
                Select a template to pre-fill common fields (optional)
              </p>
            </div>
            <div>
              <Label htmlFor="title" className="text-sm font-bold">
                Request Title <span className="text-red-500">*</span>
              </Label>
              <Input
                id="title"
                value={title}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
                placeholder="Enter a clear title for your request..."
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="description" className="text-sm font-bold">
                Description <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
                placeholder="Describe the improvement request in detail..."
                rows={5}
                className="mt-1.5"
              />
            </div>
          </div>

          <Separator />

          {/* Existing Files (with delete option) */}
          {existingFiles.length > 0 && (
            <section>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-3 flex items-center gap-2">
                <Paperclip className="w-4 h-4 text-slate-400" />
                Existing Attachments ({existingFiles.length})
              </h3>
              <div className="space-y-2">
                {existingFiles.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-start gap-3 p-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-800/50"
                  >
                    {getFileIcon(file.fileType)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                        {file.fileName}
                      </p>
                      {file.description && (
                        <p className="text-xs text-slate-500 truncate">
                          {file.description}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => removeExistingFile(file.id)}
                      className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                      title="Remove file"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-400 mt-2 italic">
                Removed files will be deleted when you resubmit
              </p>
            </section>
          )}

          {/* New File Upload */}
          <section>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-3 flex items-center gap-2">
              <FileUp className="w-4 h-4" />
              Add New Attachments
            </h3>

            <div className="mb-4">
              <label className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                <FileUp className="w-5 h-5 text-slate-400" />
                <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
                  Click to upload additional files
                </span>
                <input
                  type="file"
                  multiple
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
            </div>

            {newFiles.length > 0 && (
              <div className="space-y-2">
                {newFiles.map((file: File, index: number) => (
                  <div
                    key={`${file.name}-${index}`}
                    className="flex items-start gap-3 p-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900"
                  >
                    {getFileIcon(file.name.split('.').pop()?.toLowerCase() || '')}
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                          {file.name}
                        </p>
                        <button
                          onClick={() => removeFile(index)}
                          className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <input
                        type="text"
                        value={fileDescriptions[file.name] || ''}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateFileDescription(file.name, e.target.value)}
                        placeholder="Add a description for this file..."
                        className="w-full text-xs px-2 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!title.trim() || !description.trim()}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            <RotateCcw className="w-4 h-4 mr-1.5" />
            Resubmit Request
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
