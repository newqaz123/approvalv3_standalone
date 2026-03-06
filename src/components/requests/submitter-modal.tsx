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
  Check,
  Send,
  AlertTriangle,
  RotateCcw,
  Users,
  Settings2,
  Plus,
  ArrowUp,
  ArrowDown,
  Trash2,
  CheckCircle2,
  DollarSign,
  Clock,
  FileUp,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import { ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FileAttachment {
  id: string
  fileName: string
  fileType: 'pdf' | 'image' | 'docx' | 'xlsx' | string
  description?: string
}

interface User {
  id: string
  name: string
  email: string
  role: string
  level?: number
}

interface SubmitterModalProps {
  mode: 'request' | 'solution' | 'resubmit'
  open: boolean
  onOpenChange: (open: boolean) => void
  initialData?: {
    title?: string
    description?: string
    templateId?: string
    requestId?: string
    requestTitle?: string
    requestDescription?: string
    existingFiles?: FileAttachment[]
    solution?: {
      title?: string
      description?: string
      cost?: number
      currency?: string
      timeline?: string
    }
    rejectionReason?: string
    rejectedBy?: string
    rejectedAt?: string
  }
  availableUsers?: User[]
  onSubmitRequest?: (data: {
    title: string
    description: string
    templateId?: string
    files: File[]
  }) => void
  onSubmitSolution?: (data: {
    title: string
    description: string
    cost: number
    currency: string
    timeline: string
    files: File[]
    deletedFileIds?: string[]
    useCustomHierarchy: boolean
    customApprovers: string[]
  }) => void
  onResubmit?: (data: {
    title?: string
    description: string
    templateId?: string
    cost: number
    currency: string
    timeline: string
    files: File[]
    deletedFileIds?: string[]
    useCustomHierarchy: boolean
    customApprovers: string[]
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

// Custom Approval Hierarchy Picker (for submitter to configure)
function CustomApprovalPicker({
  availableUsers,
  selectedApprovers,
  onChange,
}: {
  availableUsers: User[]
  selectedApprovers: string[]
  onChange: (approvers: string[]) => void
}) {
  const [isOpen, setIsOpen] = useState(false)

  const addApprover = (userId: string) => {
    if (!selectedApprovers.includes(userId)) {
      onChange([...selectedApprovers, userId])
    }
  }

  const removeApprover = (index: number) => {
    const newApprovers = [...selectedApprovers]
    newApprovers.splice(index, 1)
    onChange(newApprovers)
  }

  const moveUp = (index: number) => {
    if (index === 0) return
    const newApprovers = [...selectedApprovers]
    ;[newApprovers[index], newApprovers[index - 1]] = [newApprovers[index - 1], newApprovers[index]]
    onChange(newApprovers)
  }

  const moveDown = (index: number) => {
    if (index === selectedApprovers.length - 1) return
    const newApprovers = [...selectedApprovers]
    ;[newApprovers[index], newApprovers[index + 1]] = [newApprovers[index + 1], newApprovers[index]]
    onChange(newApprovers)
  }

  const getUserById = (id: string) => availableUsers.find((u) => u.id === id)

  return (
    <div className="space-y-3">
      {/* Selected Approvers */}
      <div className="space-y-2">
        {selectedApprovers.length === 0 && (
          <p className="text-sm text-slate-400 italic">No custom approvers selected</p>
        )}
        {selectedApprovers.map((userId, index) => {
          const user = getUserById(userId)
          if (!user) return null
          return (
            <div
              key={`${userId}-${index}`}
              className="flex items-center gap-2 p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                  Level {index + 1}: {user.name}
                </p>
                <p className="text-xs text-slate-400 truncate">
                  {user.role} • {user.email}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => moveUp(index)}
                  disabled={index === 0}
                  className="p-1.5 text-slate-400 hover:text-slate-600 disabled:opacity-30 rounded"
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
                <button
                  onClick={() => moveDown(index)}
                  disabled={index === selectedApprovers.length - 1}
                  className="p-1.5 text-slate-400 hover:text-slate-600 disabled:opacity-30 rounded"
                >
                  <ArrowDown className="w-4 h-4" />
                </button>
                <button
                  onClick={() => removeApprover(index)}
                  className="p-1.5 text-slate-400 hover:text-red-500 rounded"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Add Approver Dropdown */}
      <div className="relative">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-dashed border-slate-300 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Approver
        </button>

        {isOpen && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto">
            {availableUsers
              .filter((u) => !selectedApprovers.includes(u.id))
              .map((user) => (
                <button
                  key={user.id}
                  onClick={() => {
                    addApprover(user.id)
                    setIsOpen(false)
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm"
                >
                  <p className="font-medium text-slate-900 dark:text-slate-100">
                    {user.name}
                  </p>
                  <p className="text-xs text-slate-500">
                    {user.role} • {user.email}
                  </p>
                </button>
              ))}
            {availableUsers.filter((u) => !selectedApprovers.includes(u.id)).length === 0 && (
              <p className="px-3 py-2 text-sm text-slate-400 italic">No more users available</p>
            )}
          </div>
        )}
      </div>

      {/* Click outside to close */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setIsOpen(false)}
        />
      )}
    </div>
  )
}

// Main Submitter Modal Component
export function SubmitterModal({
  mode,
  open,
  onOpenChange,
  initialData,
  availableUsers = [],
  onSubmitRequest,
  onSubmitSolution,
  onResubmit,
}: SubmitterModalProps) {
  // Form states
  const [title, setTitle] = useState(initialData?.title || '')
  const [description, setDescription] = useState(initialData?.description || '')
  const [solutionTitle, setSolutionTitle] = useState(initialData?.solution?.title || '')
  const [solutionDescription, setSolutionDescription] = useState(initialData?.solution?.description || '')
  const [cost, setCost] = useState(initialData?.solution?.cost?.toString() || '')
  const [currency, setCurrency] = useState(initialData?.solution?.currency || 'USD')
  const [timeline, setTimeline] = useState(initialData?.solution?.timeline || '')
  const [files, setFiles] = useState<File[]>([])
  const [fileDescriptions, setFileDescriptions] = useState<Record<string, string>>({})

  // Template selection state (for request mode)
  const [selectedTemplate, setSelectedTemplate] = useState(initialData?.templateId || '')
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; title: string; description: string }>>([])  
  const [loadingTemplates, setLoadingTemplates] = useState(false)

  // Fetch templates from database
  useEffect(() => {
    if (mode === 'request' && open) {
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
  }, [mode, open])

  // Populate fields when template is selected
  useEffect(() => {
    if (selectedTemplate && templates.length > 0) {
      const template = templates.find(t => t.id === selectedTemplate)
      if (template) {
        setTitle(template.title)
        setDescription(template.description)
      }
    }
  }, [selectedTemplate, templates])

  // Existing files state (for resubmit mode)
  const [existingFiles, setExistingFiles] = useState<FileAttachment[]>(initialData?.existingFiles || [])
  const [deletedFileIds, setDeletedFileIds] = useState<string[]>([])
  const [useCustomHierarchy, setUseCustomHierarchy] = useState(false)
  const [customApprovers, setCustomApprovers] = useState<string[]>([])

  // Handle file upload
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files)
      setFiles((prev: File[]) => [...prev, ...newFiles])
    }
  }

  const removeFile = (index: number) => {
    setFiles((prev: File[]) => prev.filter((_: File, i: number) => i !== index))
  }

  const removeExistingFile = (fileId: string) => {
    setExistingFiles((prev) => prev.filter((f) => f.id !== fileId))
    setDeletedFileIds((prev) => [...prev, fileId])
  }

  const updateFileDescription = (fileName: string, description: string) => {
    setFileDescriptions((prev: Record<string, string>) => ({ ...prev, [fileName]: description }))
  }

  // Handle submission
  const handleSubmit = () => {
    console.log('handleSubmit called', { mode, title, description, hasCallback: !!onSubmitRequest })
    if (mode === 'request' && onSubmitRequest) {
      console.log('Submitting request with data:', { title, description, templateId: selectedTemplate, filesCount: files.length })
      onSubmitRequest({
        title,
        description,
        templateId: selectedTemplate || undefined,
        files,
      })
      onOpenChange(false)
    } else if (mode === 'solution' && onSubmitSolution) {
      console.log('Submitting solution with custom hierarchy:', { useCustomHierarchy, customApprovers })
      onSubmitSolution({
        title: solutionTitle,
        description: solutionDescription,
        cost: parseFloat(cost) || 0,
        currency,
        timeline,
        files,
        deletedFileIds,
        useCustomHierarchy,
        customApprovers,
      })
      // Don't close modal here - let parent handler close it after async work completes
    } else if (mode === 'resubmit' && onResubmit) {
      onResubmit({
        title: mode === 'resubmit' ? undefined : title,
        description: solutionDescription,
        cost: parseFloat(cost) || 0,
        currency,
        timeline,
        files,
        deletedFileIds,
        useCustomHierarchy,
        customApprovers,
      })
      // Don't close modal here - let parent handler close it after async work completes
    }
  }

  const isSubmitDisabled = () => {
    if (mode === 'request') {
      return !title.trim() || !description.trim()
    }
    return !solutionTitle.trim() || !solutionDescription.trim() || !cost || !timeline.trim()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-full max-h-[90vh] p-0 gap-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl rounded-xl overflow-hidden">
        {/* Header */}
        <DialogHeader className="flex-shrink-0 px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {mode === 'request' && <FileText className="w-5 h-5 text-blue-600" />}
              {mode === 'solution' && <CheckCircle2 className="w-5 h-5 text-purple-600" />}
              {mode === 'resubmit' && <RotateCcw className="w-5 h-5 text-amber-600" />}
              <DialogTitle className="text-lg font-bold text-slate-900 dark:text-slate-100 tracking-tight m-0">
                {mode === 'request' && 'Submit New Request'}
                {mode === 'solution' && 'Submit Engineering Solution'}
                {mode === 'resubmit' && 'Resubmit Solution'}
              </DialogTitle>
            </div>
            <DialogDescription className="sr-only">
              {mode === 'request' && 'Fill out the form to submit a new improvement request'}
              {mode === 'solution' && 'Provide engineering solution details and cost estimate'}
              {mode === 'resubmit' && 'Update and resubmit your solution'}
            </DialogDescription>
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
          {/* Rejection Banner (only for resubmit mode) */}
          {mode === 'resubmit' && initialData?.rejectionReason && (
            <div className="bg-red-50 dark:bg-red-900/10 rounded-xl p-4 border border-red-200 dark:border-red-800/30">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-bold text-red-900 dark:text-red-400">
                    Solution Was Rejected
                  </h4>
                  <p className="text-xs text-red-600 dark:text-red-300 mt-1">
                    Rejected by {initialData.rejectedBy} on{' '}
                    {initialData.rejectedAt && format(new Date(initialData.rejectedAt), 'MMM d, yyyy')}
                  </p>
                  <div className="mt-2 p-2 bg-white dark:bg-slate-900 rounded border border-red-100 dark:border-red-800/30">
                    <p className="text-xs text-slate-700 dark:text-slate-300 italic">
                      &ldquo;{initialData.rejectionReason}&rdquo;
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Request Mode Fields */}
          {mode === 'request' && (
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
          )}

          {/* Solution Mode Fields */}
          {(mode === 'solution' || mode === 'resubmit') && (
            <div className="space-y-4">
              {/* View Original Request Link (Stage 2.1) */}
              {mode === 'solution' && initialData?.requestId && (
                <div className="bg-blue-50 dark:bg-blue-900/10 rounded-lg p-3 border border-blue-200 dark:border-blue-800/30">
                  <a
                    href={`/requests/${initialData.requestId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-blue-700 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                    <span className="font-medium">View Original Request</span>
                    <span className="text-xs text-blue-500">
                      ({initialData.requestTitle || 'Request Details'})
                    </span>
                  </a>
                </div>
              )}
              {mode === 'solution' && (
                <div>
                  <Label htmlFor="solutionTitle" className="text-sm font-bold">
                    Solution Title <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="solutionTitle"
                    value={solutionTitle}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSolutionTitle(e.target.value)}
                    placeholder="Enter solution title..."
                    className="mt-1.5"
                  />
                </div>
              )}
              <div>
                <Label htmlFor="solutionDescription" className="text-sm font-bold">
                  Solution Description <span className="text-red-500">*</span>
                </Label>
                <Textarea
                  id="solutionDescription"
                  value={solutionDescription}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setSolutionDescription(e.target.value)}
                  placeholder="Describe the engineering solution..."
                  rows={4}
                  className="mt-1.5"
                />
              </div>

              {/* Cost and Timeline */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="cost" className="text-sm font-bold flex items-center gap-1.5">
                    <DollarSign className="w-4 h-4" />
                    Cost <span className="text-red-500">*</span>
                  </Label>
                  <div className="flex gap-2 mt-1.5">
                    <select
                      value={currency}
                      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setCurrency(e.target.value)}
                      className="px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm"
                    >
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                      <option value="GBP">GBP</option>
                      <option value="JPY">JPY</option>
                      <option value="THB">THB</option>
                    </select>
                    <Input
                      id="cost"
                      type="number"
                      value={cost}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCost(e.target.value)}
                      placeholder="0.00"
                      className="flex-1"
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="timeline" className="text-sm font-bold flex items-center gap-1.5">
                    <Clock className="w-4 h-4" />
                    Timeline <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="timeline"
                    value={timeline}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTimeline(e.target.value)}
                    placeholder="e.g., 2 weeks, 3 months"
                    className="mt-1.5"
                  />
                </div>
              </div>

              {/* Custom Approval Hierarchy Toggle - only for new solutions, not resubmit */}
              {mode === 'solution' && (
                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Settings2 className="w-4 h-4 text-slate-500" />
                      <span className="text-sm font-bold">Custom Approval Hierarchy</span>
                    </div>
                    <Switch
                      checked={useCustomHierarchy}
                      onCheckedChange={setUseCustomHierarchy}
                    />
                  </div>
                  <p className="text-xs text-slate-500 mb-3">
                    Enable to define a custom approval chain instead of using the default hierarchy.
                  </p>

                  {useCustomHierarchy && (
                    <div className="border-t border-slate-200 dark:border-slate-700 pt-3">
                      <CustomApprovalPicker
                        availableUsers={availableUsers}
                        selectedApprovers={customApprovers}
                        onChange={setCustomApprovers}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <Separator />

          {/* File Upload Section */}
          <section>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-3 flex items-center gap-2">
              <Paperclip className="w-4 h-4 text-slate-400" />
              Attachments
            </h3>

            {/* Existing Files (for resubmit mode) */}
            {mode === 'resubmit' && existingFiles.length > 0 && (
              <div className="mb-4">
                <h4 className="text-xs font-bold text-slate-500 mb-2">
                  Existing Attachments ({existingFiles.length})
                </h4>
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
              </div>
            )}

            {/* Upload Button */}
            <div className="mb-4">
              <label className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                <FileUp className="w-5 h-5 text-slate-400" />
                <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
                  Click to upload files
                </span>
                <input
                  type="file"
                  multiple
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
            </div>

            {/* File List */}
            {files.length > 0 && (
              <div className="space-y-2">
                {files.map((file: File, index: number) => (
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
            disabled={isSubmitDisabled()}
            className={cn(
              "text-white",
              mode === 'resubmit'
                ? "bg-amber-600 hover:bg-amber-700"
                : "bg-emerald-600 hover:bg-emerald-700"
            )}
          >
            {mode === 'request' && (
              <>
                <Send className="w-4 h-4 mr-1.5" />
                Submit Request
              </>
            )}
            {mode === 'solution' && (
              <>
                <CheckCircle2 className="w-4 h-4 mr-1.5" />
                Submit Solution
              </>
            )}
            {mode === 'resubmit' && (
              <>
                <RotateCcw className="w-4 h-4 mr-1.5" />
                Resubmit Solution
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
