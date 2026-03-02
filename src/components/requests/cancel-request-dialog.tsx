'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { cancelRequest } from '@/server-actions/requests'

const cancelSchema = z.object({
  reason: z.string()
    .min(10, 'Reason must be at least 10 characters')
    .max(500, 'Reason too long'),
})

type CancelFormValues = z.infer<typeof cancelSchema>

interface CancelRequestDialogProps {
  requestId: string
  requestTitle: string
  onCancelled?: () => void
}

export function CancelRequestDialog({
  requestId,
  requestTitle,
  onCancelled,
}: CancelRequestDialogProps) {
  const [open, setOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const form = useForm<CancelFormValues>({
    resolver: zodResolver(cancelSchema),
    defaultValues: { reason: '' },
  })

  async function onSubmit(data: CancelFormValues) {
    setIsSubmitting(true)
    setError(null)

    try {
      const result = await cancelRequest({
        requestId,
        reason: data.reason,
      })

      if (result.success) {
        setOpen(false)
        form.reset()
        onCancelled?.()
      } else if (result.errors) {
        setError(Object.values(result.errors).flat().join(', '))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel request')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm">
          Cancel Request
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel Request?</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to cancel &quot;{requestTitle}&quot;? This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cancellation Reason (required)</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder="Please explain why you're cancelling this request..."
                      rows={3}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {error && (
              <p className="text-sm text-red-500">{error}</p>
            )}

            <AlertDialogFooter>
              <AlertDialogCancel disabled={isSubmitting}>
                Keep Request
              </AlertDialogCancel>
              <Button
                type="submit"
                variant="destructive"
                disabled={isSubmitting || !form.formState.isValid}
              >
                {isSubmitting ? 'Cancelling...' : 'Cancel Request'}
              </Button>
            </AlertDialogFooter>
          </form>
        </Form>
      </AlertDialogContent>
    </AlertDialog>
  )
}
