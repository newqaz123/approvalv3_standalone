'use client'

import { useTranslations } from '@/lib/i18n/client'
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
  useFormField,
} from '@/components/ui/form'
import { CANCELLATION_REASON_MIN_LENGTH, cancellationReasonSchema } from '@/lib/schemas/cancellation-schemas'
import { cancelRequest } from '@/server-actions/requests'

const cancelSchema = z.object({
  reason: cancellationReasonSchema,
})

type CancelFormValues = z.infer<typeof cancelSchema>

function CancellationReasonMessage({ value }: { value: string }) {
  const t = useTranslations()
  const { error, formMessageId } = useFormField()
  if (!error) return null
  const key = value.trim().length < CANCELLATION_REASON_MIN_LENGTH
    ? 'requests.error.cancellationMinimum'
    : 'requests.error.cancellationMaximum'
  return <p id={formMessageId} className="text-[0.8rem] font-medium text-destructive">{t(key)}</p>
}

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
  const t = useTranslations()
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
        setError(t('requests.error.cancellationValidation'))
      }
    } catch (err) {
      setError(t('requests.error.cancel'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm">
          {t('requests.cancelRequest')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('requests.cancelHeading')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('requests.cancelConfirmation', { title: requestTitle })}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('requests.cancelReason')}</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder={t('requests.cancelReasonHint')}
                      rows={3}
                    />
                  </FormControl>
                  <FormDescription>{t('requests.cancelReasonMinimum')}</FormDescription>
                  <CancellationReasonMessage value={field.value} />
                </FormItem>
              )}
            />

            {error && (
              <p className="text-sm text-red-500">{error}</p>
            )}

            <AlertDialogFooter>
              <AlertDialogCancel disabled={isSubmitting}>
                {t('requests.keepRequest')}
              </AlertDialogCancel>
              <Button
                type="submit"
                variant="destructive"
                disabled={isSubmitting || !form.formState.isValid}
              >
                {isSubmitting ? t('requests.cancelling') : t('requests.cancelRequest')}
              </Button>
            </AlertDialogFooter>
          </form>
        </Form>
      </AlertDialogContent>
    </AlertDialog>
  )
}
