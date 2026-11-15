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
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { createUser, updateUser } from '@/server-actions/users'

const userFormSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  isAdmin: z.boolean(),
  password: z.union([z.string().min(8, 'Password must be at least 8 characters'), z.literal('')]).optional(),
})

export type UserFormValues = z.infer<typeof userFormSchema>

interface UserFormProps {
  initialData?: UserFormValues & { id?: string }
  onSuccess?: () => void
  onCancel?: () => void
}

export function UserForm({ initialData, onSuccess, onCancel }: UserFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

      if (initialData?.id) {
        await updateUser({
          ...submitData,
          id: initialData.id,
          ...(dirtyFields.isAdmin ? { isAdmin: data.isAdmin } : {}),
        })
      } else {
        await createUser({
          ...submitData,
          isAdmin: data.isAdmin,
          password: data.password || undefined,
        })
      }
      onSuccess?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save user')
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
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder="John Doe" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" placeholder="john@example.com" {...field} />
              </FormControl>
              <FormMessage />
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
                <FormLabel>Administrator</FormLabel>
                <FormDescription>Can open the Admin area.</FormDescription>
                <FormMessage />
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
                <FormLabel>Initial Password</FormLabel>
                <FormControl>
                  <Input
                    type="password"
                    placeholder="Min 8 characters (default: changeme)"
                    {...field}
                  />
                </FormControl>
                <p className="text-xs text-muted-foreground">
                  User must change password on first login. Leave blank to use default &quot;changeme&quot;.
                </p>
                <FormMessage />
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
            {isSubmitting ? 'Saving...' : initialData?.id ? 'Update User' : 'Create User'}
          </Button>
        </div>
      </form>
    </Form>
  )
}
