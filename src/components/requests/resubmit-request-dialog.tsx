'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Edit, File, FileText, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { resubmitRequest } from '@/server-actions/requests'
import { deleteFileAttachment } from '@/server-actions/files'
import { FileUploadZone } from '@/components/requests/file-upload-zone'
import { useRouter } from 'next/navigation'

const resubmitSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  description: z
    .string()
    .min(1, 'Description is required')
    .max(5000, 'Description too long'),
})

type ResubmitFormValues = z.infer<typeof resubmitSchema>

interface ResubmitRequestDialogProps {
  requestId: string
  currentTitle: string
  currentDescription: string
  existingFiles?: Array<{ id: string; fileName: string; fileType: string; fileSize: number; filePath: string }>
  onResubmitted?: () => void
}

export function ResubmitRequestDialog({
  requestId,
  currentTitle,
  currentDescription,
  existingFiles = [],
  onResubmitted,
}: ResubmitRequestDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [files, setFiles] = useState(existingFiles)
  const [isRemoving, setIsRemoving] = useState<string | null>(null)

  const form = useForm<ResubmitFormValues>({
    resolver: zodResolver(resubmitSchema),
    defaultValues: {
      title: currentTitle,
      description: currentDescription,
    },
  })

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  const getFileIcon = (fileType: string, fileName: string) => {
    if (fileType.startsWith('image/')) {
      return <File className="h-5 w-5 text-blue-500" />
    }
    if (fileName.toLowerCase().endsWith('.pdf')) {
      return <FileText className="h-5 w-5 text-red-500" />
    }
    return <File className="h-5 w-5 text-gray-500" />
  }

  const handleRemoveFile = async (fileId: string) => {
    setIsRemoving(fileId)
    try {
      await deleteFileAttachment({ fileId })
      setFiles((prev) => prev.filter((f) => f.id !== fileId))
      toast.success('File removed')
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to remove file'
      toast.error(errorMessage)
    } finally {
      setIsRemoving(null)
    }
  }

  async function onSubmit(data: ResubmitFormValues) {
    setIsSubmitting(true)
    setError(null)

    try {
      const result = await resubmitRequest({
        requestId,
        title: data.title,
        description: data.description,
      })

      if (result.success) {
        setOpen(false)
        form.reset()
        router.refresh()
        onResubmitted?.()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resubmit request')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="default" size="sm">
          <Edit className="h-4 w-4 mr-1" />
          Edit & Resubmit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit & Resubmit Request</DialogTitle>
          <DialogDescription>
            Update your request details and resubmit for approval. This will
            clear all previous approvals and rejections, starting fresh.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Brief title for your improvement request"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder="Describe the improvement you're requesting and why it's needed..."
                      rows={6}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Current Attachments Section */}
            {files.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-sm font-medium">Current Attachments</h4>
                <div className="space-y-2">
                  {files.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center gap-3 p-3 border rounded-lg bg-white"
                    >
                      {getFileIcon(file.fileType, file.fileName)}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{file.fileName}</p>
                        <p className="text-xs text-gray-500">{formatFileSize(file.fileSize)}</p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveFile(file.id)}
                        disabled={isRemoving === file.id || isSubmitting}
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* New File Upload Section */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Add New Attachments</h4>
              <FileUploadZone
                requestId={requestId}
                disabled={isSubmitting}
              />
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Resubmitting...' : 'Resubmit Request'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
