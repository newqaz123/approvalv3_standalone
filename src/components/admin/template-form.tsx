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
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { createTemplate, updateTemplate, type CreateTemplateInput, type UpdateTemplateInput } from '@/server-actions/templates'

const templateFormSchema = z.object({
  name: z.string().min(1, 'Internal name is required'),
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Description is required'),
  isDefault: z.boolean().optional(),
})

export type TemplateFormValues = z.infer<typeof templateFormSchema>

interface TemplateFormProps {
  initialData?: TemplateFormValues & { id?: string }
  onSuccess?: () => void
  onCancel?: () => void
}

export function TemplateForm({ initialData, onSuccess, onCancel }: TemplateFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    setIsSubmitting(true)
    setError(null)

    try {
      const submitData: CreateTemplateInput | UpdateTemplateInput = {
        name: data.name,
        title: data.title,
        description: data.description,
        ...(initialData?.id && { id: initialData.id }),
      }

      if (initialData?.id) {
        await updateTemplate(submitData as UpdateTemplateInput)
      } else {
        await createTemplate(submitData as CreateTemplateInput)
      }

      onSuccess?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save template')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Internal Name *</FormLabel>
              <FormControl>
                <Input placeholder="e.g., Equipment Upgrade Request" {...field} />
              </FormControl>
              <p className="text-xs text-muted-foreground">
                Internal identifier for admin use (not shown to users)
              </p>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Template Title *</FormLabel>
              <FormControl>
                <Input placeholder="e.g., Equipment Upgrade Request" {...field} />
              </FormControl>
              <p className="text-xs text-muted-foreground">
                Title that will be pre-filled for users selecting this template
              </p>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Template Description *</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Provide detailed description content..."
                  rows={6}
                  {...field}
                />
              </FormControl>
              <p className="text-xs text-muted-foreground">
                Content that will be pre-filled in the request description field
              </p>
              <FormMessage />
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
                  <FormLabel>Set as Default Template</FormLabel>
                  <p className="text-xs text-muted-foreground">
                    If selected, this template will be pre-selected for new requests
                  </p>
                </div>
              </FormItem>
            )}
          />
        )}

        <div className="flex justify-end gap-2">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : initialData?.id ? 'Update Template' : 'Create Template'}
          </Button>
        </div>
      </form>
    </Form>
  )
}
