'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { Upload, File, X, LayoutTemplate } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { createRequest } from '@/server-actions/requests'
import { prepareFileUpload, confirmFileUpload } from '@/server-actions/files'
import { MobileFileUpload, type MobileFile } from '@/components/mobile/mobile-file-upload'

const requestFormSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title must be less than 200 characters'),
  description: z.string().min(1, 'Description is required').max(5000, 'Description must be less than 5000 characters'),
})

const MAX_FILE_DESCRIPTION_LENGTH = 60

export type RequestFormValues = z.infer<typeof requestFormSchema>

export interface Template {
  id: string
  name: string
  title: string
  description: string
  isDefault: boolean
}

interface RequestFormProps {
  templates?: Template[]
  defaultTemplateId?: string
  onSuccess?: () => void
}

interface SelectedFile {
  id: string
  file: File
  status: 'pending' | 'uploading' | 'success' | 'error'
  progress: number
  error?: string
  description?: string
  preview?: string
}

export function RequestForm({ templates = [], defaultTemplateId, onSuccess }: RequestFormProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([])

  // Find default template
  const defaultTemplate = templates.find(t => t.id === defaultTemplateId)

  const form = useForm<RequestFormValues>({
    resolver: zodResolver(requestFormSchema),
    defaultValues: {
      title: defaultTemplate?.title || '',
      description: defaultTemplate?.description || '',
    },
  })

  // State for selected template dropdown value
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | undefined>(
    defaultTemplateId
  )

  // Handle template selection
  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplateId(templateId)

    if (templateId === 'blank') {
      // Clear form when "Blank" is selected
      form.setValue('title', '', { shouldDirty: true })
      form.setValue('description', '', { shouldDirty: true })
    } else {
      // Find template and populate form
      const template = templates.find(t => t.id === templateId)
      if (template) {
        form.setValue('title', template.title, { shouldDirty: true })
        form.setValue('description', template.description, { shouldDirty: true })
      }
    }
  }

  const handleFileSelect = (files: File[]) => {
    // Validate file types and sizes
    const validFiles: SelectedFile[] = []
    const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'image/jpeg', 'image/png', 'image/gif']
    const maxSize = 10 * 1024 * 1024 // 10MB

    for (const file of files) {
      if (!allowedTypes.includes(file.type)) {
        alert(`${file.name}: File type not supported`)
        continue
      }
      if (file.size > maxSize) {
        alert(`${file.name}: File size exceeds 10MB limit`)
        continue
      }

      // Create preview for images
      let preview: string | undefined
      if (file.type.startsWith('image/')) {
        preview = URL.createObjectURL(file)
      }

      validFiles.push({
        id: Math.random().toString(36).substring(7),
        file,
        status: 'pending',
        progress: 0,
        preview,
      })
    }

    setSelectedFiles((prev) => [...prev, ...validFiles])
  }

  // Legacy handler for desktop file input
  const handleDesktopFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    handleFileSelect(Array.from(files))
    e.target.value = '' // Reset input
  }

  const removeFile = (id: string) => {
    setSelectedFiles((prev) => prev.filter((f) => f.id !== id))
  }

  const updateFileDescription = (id: string, description: string) => {
    setSelectedFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, description } : f))
    )
  }

  const uploadFile = async (selectedFile: SelectedFile, requestId: string) => {
    try {
      // Update status to uploading
      setSelectedFiles((prev) =>
        prev.map((f) => (f.id === selectedFile.id ? { ...f, status: 'uploading' as const } : f))
      )

      // Step 1: Prepare upload
      const prepareResult = await prepareFileUpload({
        fileName: selectedFile.file.name,
        fileType: selectedFile.file.type,
        fileSize: selectedFile.file.size,
        requestId,
      })

      if (!prepareResult.success || !prepareResult.uploadUrl) {
        throw new Error(prepareResult.error || 'Failed to prepare upload')
      }

      // Step 2: Upload file with progress
      const formData = new FormData()
      formData.append('file', selectedFile.file)
      formData.append('requestId', requestId)

      let uploadData: any

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const progress = Math.round((e.loaded / e.total) * 100)
            setSelectedFiles((prev) =>
              prev.map((f) => (f.id === selectedFile.id ? { ...f, progress } : f))
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

      // Step 3: Confirm upload
      const confirmResult = await confirmFileUpload({
        requestId,
        fileId: prepareResult.fileId!,
        fileName: selectedFile.file.name,
        fileType: selectedFile.file.type,
        fileSize: selectedFile.file.size,
        filePath: uploadData.filePath,
        description: selectedFile.description,
      })

      if (!confirmResult.success) {
        throw new Error('Failed to save file metadata')
      }

      // Mark as success
      setSelectedFiles((prev) =>
        prev.map((f) => (f.id === selectedFile.id ? { ...f, status: 'success' as const, progress: 100 } : f))
      )
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Upload failed'
      setSelectedFiles((prev) =>
        prev.map((f) => (f.id === selectedFile.id ? { ...f, status: 'error' as const, error: errorMessage } : f))
      )
      throw err
    }
  }

  const onSubmit = async (data: RequestFormValues) => {
    setIsSubmitting(true)
    setError(null)

    try {
      // Step 1: Create request
      const result = await createRequest(data)

      if (!result.success) {
        if (result.errors) {
          Object.entries(result.errors).forEach(([field, errors]) => {
            if (errors) {
              form.setError(field as keyof RequestFormValues, {
                message: errors[0],
              })
            }
          })
        } else {
          setError(result.error || 'Failed to create request')
        }
        return
      }

      const requestId = result.requestId!

      // Step 2: Upload all selected files
      if (selectedFiles.length > 0) {
        for (const file of selectedFiles) {
          if (file.status !== 'success') {
            await uploadFile(file, requestId)
          }
        }
      }

      // Step 3: Redirect to requests list
      onSuccess?.()
      router.push('/requests')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 md:space-y-6">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {/* Template Selector */}
        <div className="space-y-2">
          <Label className="text-base md:text-sm">Template (Optional)</Label>
          <Select
            value={selectedTemplateId || 'blank'}
            onValueChange={handleTemplateChange}
          >
            <SelectTrigger className="min-h-11 h-11">
              <SelectValue placeholder="Select a template to pre-fill form" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="blank" className="min-h-11">
                <div className="flex items-center gap-2">
                  <LayoutTemplate className="h-4 w-4 text-muted-foreground" />
                  <span>Blank Request</span>
                </div>
              </SelectItem>
              {templates.length > 0 && (
                <>
                  {templates.map((template) => (
                    <SelectItem key={template.id} value={template.id} className="min-h-11">
                      <div className="flex items-center gap-2">
                        <LayoutTemplate className="h-4 w-4 text-primary" />
                        <span>{template.name}</span>
                        {template.isDefault && (
                          <span className="text-xs text-muted-foreground">(default)</span>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </>
              )}
            </SelectContent>
          </Select>
          <p className="text-[0.8rem] text-muted-foreground">
            Choose a template to pre-fill common request types.
          </p>
        </div>

        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-base md:text-sm">Title *</FormLabel>
              <FormControl>
                <Input placeholder="Brief summary of your request" {...field} className="min-h-11" />
              </FormControl>
              <FormDescription className="text-base md:text-sm">
                A clear, concise title helps reviewers understand your request quickly.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-base md:text-sm">Description *</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Provide detailed information about your request..."
                  rows={6}
                  {...field}
                  className="min-h-32 resize-y"
                />
              </FormControl>
              <FormDescription className="text-base md:text-sm">
                Include background, requirements, and any relevant context.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-base md:text-lg">Attachments (Optional)</CardTitle>
            <CardDescription className="text-base md:text-sm">
              Attach supporting documents (PDF, Word, Excel, Images)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Mobile file upload - shown only on mobile */}
            <div className="md:hidden">
              <MobileFileUpload
                onFilesSelected={handleFileSelect}
                selectedFiles={selectedFiles.map(f => ({ id: f.id, file: f.file, preview: f.preview }))}
                onRemove={removeFile}
                disabled={isSubmitting}
              />
            </div>

            {/* Desktop file upload - hidden on mobile */}
            <div className="hidden md:block">
              {/* File input */}
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                <input
                  type="file"
                  id="file-upload"
                  multiple
                  onChange={handleDesktopFileSelect}
                  disabled={isSubmitting}
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif"
                  className="hidden"
                />
                <label
                  htmlFor="file-upload"
                  className={`cursor-pointer ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <Upload className="mx-auto h-12 w-12 text-gray-400" />
                  <p className="mt-2 text-sm text-gray-600">
                    Click to upload or drag and drop
                  </p>
                  <p className="text-xs text-gray-500">
                    PDF, Word, Excel, Images (max 10MB each)
                  </p>
                </label>
              </div>
            </div>

            {/* Selected files list */}
            {selectedFiles.length > 0 && (
              <div className="space-y-3">
                {selectedFiles.map((file) => (
                  <div
                    key={file.id}
                    className="p-3 border rounded-lg bg-white space-y-2"
                  >
                    <div className="flex items-center gap-3">
                      <File className="h-5 w-5 text-gray-400 flex-shrink-0" />

                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{file.file.name}</p>
                        <p className="text-xs text-gray-500">
                          {formatFileSize(file.file.size)}
                          {file.status === 'uploading' && ` - ${file.progress}%`}
                          {file.status === 'success' && ' - Uploaded'}
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

                      {file.status === 'pending' && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeFile(file.id)}
                          disabled={isSubmitting}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>

                    {/* Description input for pending files */}
                    {file.status === 'pending' && (
                      <div className="space-y-1">
                        <Textarea
                          placeholder="Add description (optional)"
                          value={file.description || ''}
                          onChange={(e) => updateFileDescription(file.id, e.target.value)}
                          disabled={isSubmitting}
                          rows={2}
                          maxLength={MAX_FILE_DESCRIPTION_LENGTH}
                          className="text-sm"
                        />
                        <p className="text-xs text-gray-400 text-right">
                          {file.description?.length || 0} / {MAX_FILE_DESCRIPTION_LENGTH}
                        </p>
                      </div>
                    )}

                    {/* Show description for uploaded files */}
                    {file.status !== 'pending' && file.description && (
                      <p className="text-xs text-gray-600 italic">{file.description}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col-reverse md:flex-row justify-end gap-2 md:gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={isSubmitting}
            className="w-full md:w-auto min-h-11"
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting} className="w-full md:w-auto min-h-11">
            {isSubmitting
              ? selectedFiles.length > 0
                ? 'Creating & Uploading...'
                : 'Creating...'
              : 'Create Request'}
          </Button>
        </div>
      </form>
    </Form>
  )
}
