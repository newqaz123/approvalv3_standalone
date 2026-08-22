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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { cancellationReasonSchema } from '@/lib/schemas/cancellation-schemas'
import { cancelRequest } from '@/server-actions/requests'

const cancelSchema = z.object({
  reason: cancellationReasonSchema,
})

type CancelFormValues = z.infer<typeof cancelSchema>

interface CancelRequestDialogProps {
  requestId: string
  requestTitle: string
  onCancelled?: () => void
  /**
   * Cancellation submission. Defaults to the authoritative server action;
   * non-production hosts (the E2E UI harness) may inject their own callback.
   */
  onCancelRequest?: typeof cancelRequest
}

export function CancelRequestDialog({
  requestId,
  requestTitle,
  onCancelled,
  onCancelRequest = cancelRequest,
}: CancelRequestDialogProps) {
  const [open, setOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const form = useForm<CancelFormValues>({
    // Validate while the requester types so the submit button's isValid gate
    // tracks the 5-character minimum live (4 characters stay blocked).
    mode: 'onChange',
    resolver: zodResolver(cancelSchema),
    defaultValues: { reason: '' },
  })

  async function onSubmit(data: CancelFormValues) {
    setIsSubmitting(true)
    setError(null)

    try {
      const result = await onCancelRequest({
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
                  <FormDescription>Minimum 5 characters.</FormDescription>
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
