'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  useFormField,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { RichTextEditor } from '@/components/rich-text/rich-text-editor-lazy'
import { createTemplate, updateTemplate, type CreateTemplateInput, type UpdateTemplateInput } from '@/server-actions/templates'
import {
  useInlineDescriptionImages,
} from '@/hooks/use-inline-description-images'
import { inlineImageBlockingKey, isMessageKey, type MessageKey } from '@/lib/i18n/messages'
import { useTranslations } from '@/lib/i18n/client'

function LocalizedFormMessage() {
  const t = useTranslations()
  const { error, formMessageId } = useFormField()
  if (!error) return null
  return <p id={formMessageId} className="text-[0.8rem] font-medium text-destructive">
    {t(isMessageKey(error.message) ? error.message : 'admin.invalidFormValue')}
  </p>
}

const templateFormSchema = z.object({
  name: z.string().min(1, 'admin.internalNameRequired' satisfies MessageKey),
  title: z.string().min(1, 'admin.templateTitleRequired' satisfies MessageKey),
  description: z.string().min(1, 'admin.templateDescriptionRequired' satisfies MessageKey),
  isDefault: z.boolean().optional(),
})

export type TemplateFormValues = z.infer<typeof templateFormSchema>

interface TemplateFormProps {
  initialData?: TemplateFormValues & { id?: string }
  onSuccess?: () => void
  onCancel?: () => void
}

export function TemplateForm({ initialData, onSuccess, onCancel }: TemplateFormProps) {
  const t = useTranslations()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<MessageKey | null>(null)
  // One inline image coordinator per mounted form; the editor uploads through
  // it and the save/cancel lifecycle below claims or cleans its draft session.
  const inlineImages = useInlineDescriptionImages()
  const inlineImageBlocking = inlineImageBlockingKey(inlineImages.blockingReason)

  const form = useForm<TemplateFormValues>({
    resolver: zodResolver(templateFormSchema),
    defaultValues: initialData || {
      name: '',
      title: '',
      description: '',
      isDefault: false,
    },
  })

  async function onSubmit(data: TemplateFormValues) {
    if (inlineImages.hasBlockingOperations) {
      setError(inlineImageBlocking)
      return
    }
    setIsSubmitting(true)
    setError(null)

    try {
      const submitData: CreateTemplateInput | UpdateTemplateInput = {
        name: data.name,
        title: data.title,
        description: data.description,
        inlineImageSessionId: inlineImages.uploadSessionId,
        ...(initialData?.id && { id: initialData.id }),
      }

      if (initialData?.id) {
        await updateTemplate(submitData as UpdateTemplateInput)
      } else {
        await createTemplate(submitData as CreateTemplateInput)
      }

      // The description images are committed template assets now; drop the
      // local draft session without deleting anything.
      inlineImages.clear()

      onSuccess?.()
    } catch (err) {
      setError('admin.saveTemplateFailed')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCancel = async () => {
    // Await draft cleanup before leaving. A cleanup failure keeps the form
    // mounted with a visible error so the user can retry or remove.
    try {
      await inlineImages.reset()
    } catch (err) {
      setError('admin.cleanupTemplateImagesFailed')
      return
    }
    onCancel?.()
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {t(error)}
          </div>
        )}

        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('admin.internalNameRequiredLabel')}</FormLabel>
              <FormControl>
                <Input placeholder={t('admin.templateExample')} {...field} />
              </FormControl>
              <p className="text-xs text-muted-foreground">
                {t('admin.internalNameHelp')}
              </p>
              <LocalizedFormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('admin.templateTitleLabel')}</FormLabel>
              <FormControl>
                <Input placeholder={t('admin.templateExample')} {...field} />
              </FormControl>
              <p className="text-xs text-muted-foreground">
                {t('admin.templateTitleHelp')}
              </p>
              <LocalizedFormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('admin.templateDescriptionLabel')}</FormLabel>
              <FormControl>
                <RichTextEditor
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  minHeight={180}
                  inlineImages={inlineImages}
                />
              </FormControl>
              <p className="text-xs text-muted-foreground">
                {t('admin.templateDescriptionHelp')}
              </p>
              <LocalizedFormMessage />
            </FormItem>
          )}
        />

        {!initialData?.id && (
          <FormField
            control={form.control}
            name="isDefault"
            render={({ field }) => (
              <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
                <div className="space-y-1 leading-none">
                  <FormLabel>{t('admin.setDefaultTemplate')}</FormLabel>
                  <p className="text-xs text-muted-foreground">
                    {t('admin.setDefaultTemplateHelp')}
                  </p>
                </div>
              </FormItem>
            )}
          />
        )}

        <div className="flex flex-col items-end gap-2">
          {inlineImageBlocking && (
            <p className="text-sm text-amber-700 self-start">
              {t(inlineImageBlocking)}
            </p>
          )}
          <div className="flex justify-end gap-2">
            {onCancel && (
              <Button type="button" variant="outline" onClick={handleCancel} disabled={isSubmitting}>
                {t('common.cancel')}
              </Button>
            )}
            <Button type="submit" disabled={isSubmitting || inlineImages.hasBlockingOperations}>
              {isSubmitting ? t('common.saving') : initialData?.id ? t('admin.updateTemplate') : t('admin.createTemplate')}
            </Button>
          </div>
        </div>
      </form>
    </Form>
  )
}
