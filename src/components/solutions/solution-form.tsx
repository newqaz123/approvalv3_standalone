'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
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
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { CustomApprovalPicker } from './custom-approval-picker'
import { SolutionFileUpload } from './solution-file-upload'
import { SolutionPreview } from './solution-preview'
import { submitSolution } from '@/server-actions/solutions'
import { prepareFileUpload, confirmFileUpload, deleteFileAttachment } from '@/server-actions/files'

const solutionFormSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  description: z.string().min(1, 'Description is required').max(5000),
  costEstimate: z
    .number({ message: 'Enter a valid cost' })
    .positive('Cost must be greater than 0')
    .min(0.01, 'Minimum cost is 0.01')
    .optional(),
  currency: z.enum(['THB', 'USD', 'EUR']),
  timeline: z.string().max(200).optional(),
  conceptDesign: z.string().max(2000).optional(),
  useCustomApprovals: z.boolean(),
  customApproverIds: z.array(z.string()).optional(),
})

export type SolutionFormValues = z.infer<typeof solutionFormSchema>

interface SolutionFormProps {
  requestId: string
  requestTitle: string
  currentUserId: string
  allUsers: Array<{ id: string; name: string; email: string; level: number | null }>
  previousSolution?: {
    title: string
    description: string
    costEstimate?: number
    currency: string
    timeline?: string | null
    conceptDesign?: string | null
  }
  previousFiles?: Array<{ id: string; fileName: string; fileType: string; fileSize: number; filePath: string }>
}

interface SelectedFile {
  id: string
  file: File
  status: 'pending' | 'uploading' | 'success' | 'error'
  progress: number
  error?: string
  fileId?: string  // The actual file ID from prepareFileUpload
}

export function SolutionForm({
  requestId,
  requestTitle,
  currentUserId,
  allUsers,
  previousSolution,
  previousFiles = [],
}: SolutionFormProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([])
  const [existingFiles, setExistingFiles] = useState(previousFiles)

  const form = useForm<SolutionFormValues>({
    resolver: zodResolver(solutionFormSchema),
    defaultValues: {
      title: previousSolution?.title || `Solution for: ${requestTitle}`,
      description: previousSolution?.description || '',
      costEstimate: previousSolution?.costEstimate || undefined,
      currency: (previousSolution?.currency as 'THB' | 'USD' | 'EUR') || 'THB',
      timeline: previousSolution?.timeline || '',
      conceptDesign: previousSolution?.conceptDesign || '',
      useCustomApprovals: false,
      customApproverIds: [],
    },
  }) as any // Using any to work around zod resolver type inference issue


  const useCustomApprovals = form.watch('useCustomApprovals')

  const uploadFile = async (selectedFile: SelectedFile) => {
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

      // Step 3: Confirm upload (save metadata to database)
      const confirmResult = await confirmFileUpload({
        requestId,
        fileId: prepareResult.fileId!,
        fileName: selectedFile.file.name,
        fileType: selectedFile.file.type,
        fileSize: selectedFile.file.size,
        filePath: uploadData.filePath,
      })

      if (!confirmResult.success) {
        throw new Error('Failed to save file metadata')
      }

      // Mark as success and store the file ID
      setSelectedFiles((prev) =>
        prev.map((f) => (f.id === selectedFile.id ? { ...f, status: 'success' as const, progress: 100, fileId: prepareResult.fileId } : f))
      )

      return prepareResult.fileId!
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Upload failed'
      setSelectedFiles((prev) =>
        prev.map((f) => (f.id === selectedFile.id ? { ...f, status: 'error' as const, error: errorMessage } : f))
      )
      throw err
    }
  }

  const handleRemoveExistingFile = async (fileId: string) => {
    try {
      await deleteFileAttachment({ fileId })
      setExistingFiles((prev) => prev.filter((f) => f.id !== fileId))
      toast.success('File removed')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to remove file'
      toast.error(errorMessage)
    }
  }

  const handleRemoveNewFile = (fileId: string) => {
    setSelectedFiles((prev) => prev.filter((f) => f.id !== fileId))
  }

  const handleSubmit = async (values: SolutionFormValues, isConfirmed: boolean = false) => {
    // If not yet previewing, show preview
    if (!isConfirmed) {
      setShowPreview(true)
      return
    }

    setIsSubmitting(true)

    try {
      // Upload files first and collect file IDs
      const pendingFiles = selectedFiles.filter((f) => f.status === 'pending' || f.status === 'error')
      const uploadedFileIds: string[] = []

      if (pendingFiles.length > 0) {
        for (const file of pendingFiles) {
          try {
            const fileId = await uploadFile(file)
            if (fileId) {
              uploadedFileIds.push(fileId)
            }
          } catch {
            // uploadFile already sets error state, continue to check failed files below
          }
        }
      }

      // Check for any failed uploads
      const failedFiles = selectedFiles.filter((f) => f.status === 'error')
      if (failedFiles.length > 0) {
        toast.error('Some files failed to upload. Please try again or remove them.')
        setIsSubmitting(false)
        return
      }

      // Submit solution with file IDs
      // Combine newly uploaded files with existing files that are already attached
      const existingFileIds = existingFiles.map((f) => f.id)
      const fileIds = [...existingFileIds, ...uploadedFileIds]

      const result = await submitSolution({
        requestId,
        title: values.title,
        description: values.description,
        costEstimate: values.costEstimate,
        currency: values.currency,
        timeline: values.timeline || undefined,
        conceptDesign: values.conceptDesign || undefined,
        useCustomApprovals: values.useCustomApprovals,
        customApproverIds: values.customApproverIds,
        fileIds,
      }) as { success: boolean; solutionId?: string; error?: string }

      if (!result.success) {
        toast.error(result.error || 'Failed to submit solution')
        setIsSubmitting(false)
        return
      }

      toast.success('Solution submitted successfully')

      // Redirect to engineering dashboard
      router.push('/engineering')
      router.refresh()
    } catch (error) {
      console.error('Submit solution error:', error)
      toast.error(error instanceof Error ? error.message : 'An error occurred')
      setIsSubmitting(false)
    }
  }

  const handleBackToEdit = () => {
    setShowPreview(false)
  }

  const handleConfirmSubmit = async () => {
    const values = form.getValues()
    await handleSubmit(values, true)
  }

  // Prepare preview data
  const customApprovers = form.watch('customApproverIds')
    ?.map((id: string) => allUsers.find((u: { id: string; name: string; email: string; level: number | null }) => u.id === id))
    .filter((u: any): u is { id: string; name: string; email: string; level: number | null } => u !== undefined)
    .map((u: { id: string; name: string; email: string; level: number | null }) => ({ id: u.id, name: u.name }))

  const previewData = {
    title: form.watch('title'),
    description: form.watch('description'),
    costEstimate: form.watch('costEstimate'),
    currency: form.watch('currency'),
    timeline: form.watch('timeline'),
    conceptDesign: form.watch('conceptDesign'),
    useCustomApprovals: form.watch('useCustomApprovals'),
    customApprovers,
    files: selectedFiles.filter((f) => f.status !== 'error'),
    existingFilesCount: existingFiles.length,
  }

  if (showPreview) {
    return (
      <SolutionPreview
        data={previewData}
        requestTitle={requestTitle}
        onEdit={handleBackToEdit}
        onConfirm={handleConfirmSubmit}
        isSubmitting={isSubmitting}
      />
    )
  }

  return (
    <div className="space-y-6">
      {/* Resubmission banner */}
      {previousSolution && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <p className="text-sm font-medium text-blue-900">Resubmission</p>
          <p className="text-sm text-blue-700">
            Your previous solution data has been pre-filled. Review the rejection feedback, make your corrections, and resubmit.
          </p>
        </div>
      )}

      {/* Request context */}
      <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/30">
        <div className="flex-1">
          <h3 className="font-medium">Request: {requestTitle}</h3>
          <a
            href={`/requests/${requestId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary hover:underline flex items-center gap-1 mt-1"
          >
            View original request
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit((values: SolutionFormValues) => handleSubmit(values, false))} className="space-y-6">
          {/* Title */}
          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Solution Title *</FormLabel>
                <FormControl>
                  <Input placeholder="Brief summary of your solution" {...field} />
                </FormControl>
                <FormDescription>
                  A clear, concise title helps reviewers understand your solution quickly.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Description */}
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Description *</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Provide detailed information about your solution..."
                    rows={6}
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  Include technical details, approach, and any relevant context.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Cost Estimate and Currency */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <FormField
              control={form.control}
              name="costEstimate"
              render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Cost Estimate</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      {...field}
                      onChange={(e) => {
                        const value = parseFloat(e.target.value)
                        field.onChange(isNaN(value) ? undefined : value)
                      }}
                    />
                  </FormControl>
                  <FormDescription>
                    Enter the estimated cost (optional)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="currency"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Currency</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="THB">THB (฿)</SelectItem>
                      <SelectItem value="USD">USD ($)</SelectItem>
                      <SelectItem value="EUR">EUR (€)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {/* Timeline (Optional) */}
          <FormField
            control={form.control}
            name="timeline"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Timeline (Optional)</FormLabel>
                <FormControl>
                  <Input placeholder="e.g., 2-3 weeks" {...field} />
                </FormControl>
                <FormDescription>
                  Estimated time to complete the implementation
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Concept Design (Optional) */}
          <FormField
            control={form.control}
            name="conceptDesign"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Concept Design (Optional)</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Describe your design concept and approach..."
                    rows={4}
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  Provide details about your design concept and implementation approach
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* File Attachments */}
          <SolutionFileUpload
            files={selectedFiles.filter((f) => f.status !== 'error').map((f) => f.file)}
            filesWithProgress={selectedFiles}
            onFilesChange={(files) => {
              // Preserve existing file state (id, status, fileId, progress)
              // Only add new files as 'pending'
              const existingFileMap = new Map(
                selectedFiles.map((sf) => [
                  `${sf.file.name}-${sf.file.size}-${sf.file.lastModified}`,
                  sf,
                ]),
              )

              const updatedFiles = files.map((file) => {
                const key = `${file.name}-${file.size}-${file.lastModified}`
                const existing = existingFileMap.get(key)

                // Preserve existing file state, or create new pending entry
                return (
                  existing || {
                    id: Math.random().toString(36).substring(7),
                    file,
                    status: 'pending' as const,
                    progress: 0,
                  }
                )
              })

              setSelectedFiles(updatedFiles)
            }}
            onRemoveFile={handleRemoveNewFile}
            disabled={isSubmitting}
            existingFiles={existingFiles}
            onRemoveExistingFile={handleRemoveExistingFile}
          />

          {/* Custom Approvals Toggle */}
          <FormField
            control={form.control}
            name="useCustomApprovals"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <FormLabel className="text-base">Custom Approval Chain</FormLabel>
                  <FormDescription>
                    Override default engineering hierarchy and select specific approvers
                  </FormDescription>
                </div>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={isSubmitting}
                  />
                </FormControl>
              </FormItem>
            )}
          />

          {/* Custom Approval Picker */}
          {useCustomApprovals && (
            <FormField
              control={form.control}
              name="customApproverIds"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <CustomApprovalPicker
                      users={allUsers}
                      selectedIds={field.value || []}
                      onChange={field.onChange}
                      currentUserId={currentUserId}
                      disabled={isSubmitting}
                    />
                  </FormControl>
                  <FormDescription>
                    Select and order the approval chain. You cannot approve your own submission.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          {/* Submit Button */}
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.back()}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              Review & Submit
            </Button>
          </div>
        </form>
      </Form>
    </div>
  )
}
