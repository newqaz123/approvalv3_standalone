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
import { RichTextEditor } from '@/components/rich-text/rich-text-editor-lazy'
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
import { useSolutionAttachments } from '@/hooks/use-solution-attachments'
import { useInlineDescriptionImages } from '@/hooks/use-inline-description-images'

const solutionFormSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  description: z.string().min(1, 'Description is required').max(20000, 'Description too long'),
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
  allUsers: Array<{ id: string; name: string; email: string; departmentName: string | null; level: number | null }>
  previousSolution?: {
    title: string
    description: string
    costEstimate?: number
    currency: string
    timeline?: string | null
    conceptDesign?: string | null
  }
}

export function SolutionForm({
  requestId,
  requestTitle,
  currentUserId,
  allUsers,
  previousSolution,
}: SolutionFormProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  // One coordinator for the whole form lifetime, shared by the editor and the
  // final confirm so preview/edit transitions keep the same upload session.
  const inlineImages = useInlineDescriptionImages()
  const { items, addFiles, removeItem, ensureUploaded, clear, reset } = useSolutionAttachments({
    requestId,
  })

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

  const handleRemoveItem = async (id: string) => {
    try {
      await removeItem(id)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to remove file')
    }
  }

  // Retry is upload-only: it re-runs the authoritative coordinator for the
  // remaining non-success (errored/pending) items and reuses prior successes,
  // so a failed file can be retried in isolation without re-uploading the rest
  // or touching metadata. The metadata submit happens only via Confirm.
  const handleRetryItem = async () => {
    if (isSubmitting) return
    setIsSubmitting(true)
    try {
      const result = await ensureUploaded()
      if (!result.success) {
        const remaining = result.items.filter((entry) => entry.status === 'error')
        toast.error(
          remaining.length === 1
            ? '1 file still failed to upload'
            : `${remaining.length} files still failed to upload`
        )
        return
      }
      toast.success('All files uploaded successfully')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCancel = async () => {
    // Await hook reset() (cleanup unlinked drafts + clear local state) and the
    // inline image coordinator reset before navigating away. Surface cleanup
    // failure and do NOT navigate on error — the user can retry. After reset
    // succeeds the unmount safety net sees an empty ref, so there is no
    // double-cleanup.
    try {
      await reset()
      await inlineImages.reset()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to clean up draft files')
      return
    }
    router.back()
  }

  const handleSubmit = async (values: SolutionFormValues, isConfirmed: boolean = false) => {
    // If not yet previewing, show preview
    if (!isConfirmed) {
      setShowPreview(true)
      return
    }

    setIsSubmitting(true)

    try {
      // ensureUploaded() is authoritative: it uploads pending/errored items,
      // reuses prior successes, and returns the final batch result. Branch on
      // its result — never on pre-call UI state.
      const result = await ensureUploaded()
      if (!result.success) {
        toast.error('Some files failed to upload')
        // Surface the file list so the failed item is visibly errored with its
        // Retry action (SolutionFileUpload). The user retries in isolation,
        // then returns to preview + Confirm for the single metadata submit.
        setShowPreview(false)
        setIsSubmitting(false)
        return
      }

      const submitResult = await submitSolution({
        requestId,
        title: values.title,
        description: values.description,
        inlineImageSessionId: inlineImages.uploadSessionId,
        costEstimate: values.costEstimate,
        currency: values.currency,
        timeline: values.timeline || undefined,
        conceptDesign: values.conceptDesign || undefined,
        useCustomApprovals: values.useCustomApprovals,
        customApproverIds: values.customApproverIds,
        fileIds: result.attachmentIds,
      }) as { success: boolean; solutionId?: string; error?: string }

      if (!submitResult.success) {
        // Metadata submission failed — retain the successfully uploaded items
        // so the user can retry without re-uploading.
        toast.error(submitResult.error || 'Failed to submit solution')
        setIsSubmitting(false)
        return
      }

      toast.success('Solution submitted successfully')

      // The description images are committed solution assets now, so clear the
      // inline draft session without deleting anything. The drafts are now
      // linked to the committed solution. Clear local references WITHOUT
      // invoking cleanup (reset/cleanupDrafts would fail on the now
      // solutionId-scoped rows).
      inlineImages.clear()
      clear()

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
    // Defense in depth: the Confirm button is disabled while uploads are
    // blocking, but never submit a description whose images are not stable.
    if (inlineImages.hasBlockingUploads) {
      toast.error('Wait for image uploads, or retry/remove failed images.')
      return
    }
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
    files: items
      .filter((item) => item.status !== 'error')
      .map((item) => ({
        file: item.file,
        id: item.id,
        status: item.status,
        progress: item.status === 'success' ? 100 : 0,
        error: item.error,
      })),
  }

  if (showPreview) {
    return (
      <div className="space-y-6">
        {inlineImages.hasBlockingUploads && (
          <p className="text-sm text-amber-700">
            Wait for image uploads, or retry/remove failed images.
          </p>
        )}
        <SolutionPreview
          data={previewData}
          requestTitle={requestTitle}
          onEdit={handleBackToEdit}
          onConfirm={handleConfirmSubmit}
          isSubmitting={isSubmitting || inlineImages.hasBlockingUploads}
        />
      </div>
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
                  <RichTextEditor
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    minHeight={160}
                    inlineImages={inlineImages}
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
                      value={field.value || ''}
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
                  <Select onValueChange={field.onChange} value={field.value} defaultValue={field.value}>
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
            items={items}
            onAddFiles={addFiles}
            onRemoveItem={handleRemoveItem}
            onRetryItem={handleRetryItem}
            disabled={isSubmitting}
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
          <div className="flex flex-col items-end gap-2">
            {inlineImages.hasBlockingUploads && (
              <p className="text-sm text-amber-700 self-start md:self-auto">
                Wait for image uploads, or retry/remove failed images.
              </p>
            )}
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={handleCancel}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting || inlineImages.hasBlockingUploads}>
                Review &amp; Submit
              </Button>
            </div>
          </div>
        </form>
      </Form>
    </div>
  )
}
