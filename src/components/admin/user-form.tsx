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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { createUser, updateUser, type UserRole } from '@/server-actions/users'
import type { departments as Department } from '@prisma/client'

// Extended Department type with levelNames
type DepartmentWithLevelNames = Department & {
  levelNames: Record<string, string> | null
}

const userFormSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  departmentId: z.string().min(1, 'Department is required'),
  role: z.enum(['admin', 'general_dept', 'engineering'] as const).optional(),
  level: z.number().int().min(1).max(10).optional().nullable(),
  password: z.union([z.string().min(8, 'Password must be at least 8 characters'), z.literal('')]).optional(),
})

export type UserFormValues = z.infer<typeof userFormSchema>

interface UserFormProps {
  departments: DepartmentWithLevelNames[]
  initialData?: UserFormValues & { id?: string }
  onSuccess?: () => void
  onCancel?: () => void
}

export function UserForm({ departments, initialData, onSuccess, onCancel }: UserFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const form = useForm<UserFormValues>({
    resolver: zodResolver(userFormSchema),
    defaultValues: initialData || {
      name: '',
      email: '',
      departmentId: '',
      role: 'general_dept',
      level: null,
      password: '',
    },
  })

  // Watch department selection to auto-determine role (as default)
  const selectedDepartmentId = form.watch('departmentId')
  const autoRole = selectedDepartmentId === 'ENG' ? 'engineering' : 'general_dept'

  async function onSubmit(data: UserFormValues) {
    setIsSubmitting(true)
    setError(null)

    try {
      // Use provided role, or autoRole as fallback
      const submitData = {
        ...data,
        role: data.role || autoRole,
        level: data.level ?? null,
      }

      if (initialData?.id) {
        await updateUser({
          ...submitData,
          id: initialData.id,
        })
      } else {
        await createUser({
          ...submitData,
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
          name="departmentId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Department</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {departments.map((dept) => (
                    <SelectItem key={dept.id} value={dept.id}>
                      {dept.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Role selection - editable with auto-determination as default */}
        <FormField
          control={form.control}
          name="role"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Role</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="general_dept">General Department User</SelectItem>
                  <SelectItem value="engineering">Engineering User</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Approval Level — shown when department is selected */}
        {selectedDepartmentId && (
          <FormField
            control={form.control}
            name="level"
            render={({ field }) => {
              const selectedDept = departments.find(d => d.id === selectedDepartmentId)
              const levelNames = selectedDept?.levelNames
              const hasLevelNames = levelNames && Object.keys(levelNames).length > 0

              return (
                <FormItem>
                  <FormLabel>Approval Level</FormLabel>
                  <FormControl>
                    {hasLevelNames ? (
                      <Select
                        onValueChange={(val) => field.onChange(val === 'none' ? null : Number(val))}
                        value={field.value?.toString() || 'none'}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select approval level" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {Object.entries(levelNames)
                            .sort(([a], [b]) => Number(a) - Number(b))
                            .map(([key, value]) => (
                              <SelectItem key={key} value={key}>
                                Level {key} - {String(value)}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        type="number"
                        min={1}
                        max={10}
                        placeholder="e.g., 1"
                        {...field}
                        value={field.value ?? ''}
                        onChange={(e) => {
                          const val = e.target.value
                          field.onChange(val === '' ? null : Number(val))
                        }}
                      />
                    )}
                  </FormControl>
                  <p className="text-xs text-muted-foreground">
                    {hasLevelNames
                      ? 'Select the approval hierarchy level for this user'
                      : 'Approval hierarchy level (1 = lowest, higher = more authority). Leave blank if not applicable.'}
                  </p>
                  <FormMessage />
                </FormItem>
              )
            }}
          />
        )}

        {/* Password - only for new users */}
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
