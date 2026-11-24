'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  useFormField,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { saveAdminUser } from '@/server-actions/users'
import { isMessageKey, type MessageKey } from '@/lib/i18n/messages'
import { useTranslations } from '@/lib/i18n/client'

function LocalizedFormMessage() {
  const t = useTranslations()
  const { error, formMessageId } = useFormField()
  if (!error) return null
  return <p id={formMessageId} className="text-[0.8rem] font-medium text-destructive">
    {t(isMessageKey(error.message) ? error.message : 'admin.invalidFormValue')}
  </p>
}

const userFormSchema = z.object({
  name: z.string().min(2, 'admin.nameMinLength' satisfies MessageKey),
  email: z.string().email('admin.invalidEmail' satisfies MessageKey),
  isAdmin: z.boolean(),
  password: z.union([z.string().min(8, 'admin.passwordMinLength' satisfies MessageKey), z.literal('')]).optional(),
})

export type UserFormValues = z.infer<typeof userFormSchema>

interface UserFormProps {
  initialData?: UserFormValues & { id?: string }
  onSuccess?: () => void
  onCancel?: () => void
}

export function UserForm({ initialData, onSuccess, onCancel }: UserFormProps) {
  const t = useTranslations()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<MessageKey | null>(null)

  const form = useForm<UserFormValues>({
    resolver: zodResolver(userFormSchema),
    defaultValues: initialData || {
      name: '',
      email: '',
      isAdmin: false,
      password: '',
    },
  })
  const { dirtyFields } = form.formState

  async function onSubmit(data: UserFormValues) {
    setIsSubmitting(true)
    setError(null)

    try {
      const submitData = {
        name: data.name,
        email: data.email,
      }

      const result = initialData?.id
        ? await saveAdminUser({
          ...submitData,
          id: initialData.id,
          ...(dirtyFields.isAdmin ? { isAdmin: data.isAdmin } : {}),
        })
        : await saveAdminUser({
          ...submitData,
          isAdmin: data.isAdmin,
          password: data.password || undefined,
        })
      if (!result.success) {
        setError(result.errorKey)
        return
      }
      onSuccess?.()
    } catch (err) {
      setError('admin.saveUserFailed')
    } finally {
      setIsSubmitting(false)
    }
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
              <FormLabel>{t('admin.name')}</FormLabel>
              <FormControl>
                <Input placeholder="John Doe" {...field} />
              </FormControl>
              <LocalizedFormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('admin.email')}</FormLabel>
              <FormControl>
                <Input type="email" placeholder="john@example.com" {...field} />
              </FormControl>
              <LocalizedFormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="isAdmin"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start space-x-3 space-y-0">
              <FormControl>
                <Checkbox
                  name={field.name}
                  ref={field.ref}
                  onBlur={field.onBlur}
                  checked={field.value}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                />
              </FormControl>
              <div className="space-y-1 leading-none">
                <FormLabel>{t('admin.administrator')}</FormLabel>
                <FormDescription>{t('admin.adminAccessDescription')}</FormDescription>
                <LocalizedFormMessage />
              </div>
            </FormItem>
          )}
        />

        {!initialData?.id && (
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('admin.initialPassword')}</FormLabel>
                <FormControl>
                  <Input
                    type="password"
                    placeholder={t('admin.initialPasswordPlaceholder')}
                    {...field}
                  />
                </FormControl>
                <p className="text-xs text-muted-foreground">
                  {t('admin.initialPasswordHelp')}
                </p>
                <LocalizedFormMessage />
              </FormItem>
            )}
          />
        )}

        <div className="flex justify-end gap-2">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel}>
              {t('common.cancel')}
            </Button>
          )}
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? t('common.saving') : initialData?.id ? t('admin.updateUser') : t('admin.createUser')}
          </Button>
        </div>
      </form>
    </Form>
  )
}
