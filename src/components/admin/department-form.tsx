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
import { createDepartment, updateDepartment } from '@/server-actions/departments'
import { DepartmentType } from '@prisma/client'
import { Plus, Trash2 } from 'lucide-react'

const departmentFormSchema = z.object({
  id: z.string().min(1, 'ID is required').max(10, 'ID must be 10 characters or less'),
  name: z.string().min(2, 'Name must be at least 2 characters'),
  type: z.enum(['GENERAL', 'ENGINEERING']),
  levelNames: z.record(z.string(), z.string()).optional(),
})

export type DepartmentFormValues = z.infer<typeof departmentFormSchema>

interface DepartmentFormProps {
  initialData?: DepartmentFormValues & { levelNames?: Record<string, string> | null }
  onSuccess?: () => void
  onCancel?: () => void
}

export function DepartmentForm({ initialData, onSuccess, onCancel }: DepartmentFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Parse initialData levelNames (may be a JSON object from Prisma)
  const parsedLevelNames: Record<string, string> = {}
  if (initialData?.levelNames) {
    const raw = initialData.levelNames
    if (typeof raw === 'object' && raw !== null) {
      Object.entries(raw).forEach(([k, v]) => {
        parsedLevelNames[k] = String(v)
      })
    }
  }

  // Manage level entries as a local array of {key, value} for the UI
  const [levelEntries, setLevelEntries] = useState<{ key: string; value: string }[]>(() => {
    const entries = Object.entries(parsedLevelNames)
    if (entries.length === 0) return []
    return entries
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([key, value]) => ({ key, value }))
  })

  const form = useForm<DepartmentFormValues>({
    resolver: zodResolver(departmentFormSchema),
    defaultValues: {
      id: initialData?.id || '',
      name: initialData?.name || '',
      type: initialData?.type || 'GENERAL',
    },
  })

  function addLevel() {
    if (levelEntries.length >= 5) return
    const nextKey = String(levelEntries.length + 1)
    setLevelEntries((prev) => [...prev, { key: nextKey, value: '' }])
  }

  function removeLevel(index: number) {
    setLevelEntries((prev) => {
      const updated = prev.filter((_, i) => i !== index)
      // Re-number keys sequentially
      return updated.map((entry, i) => ({ ...entry, key: String(i + 1) }))
    })
  }

  function updateLevelValue(index: number, value: string) {
    setLevelEntries((prev) =>
      prev.map((entry, i) => (i === index ? { ...entry, value } : entry))
    )
  }

  async function onSubmit(data: DepartmentFormValues) {
    setIsSubmitting(true)
    setError(null)

    try {
      // Build levelNames map from entries (omit empty values)
      const levelNames: Record<string, string> = {}
      levelEntries.forEach(({ key, value }) => {
        if (value.trim()) {
          levelNames[key] = value.trim()
        }
      })

      const submitData = {
        ...data,
        levelNames: Object.keys(levelNames).length > 0 ? levelNames : undefined,
      }

      if (initialData?.id) {
        await updateDepartment({ ...submitData, id: initialData.id })
      } else {
        await createDepartment(submitData)
      }
      onSuccess?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save department')
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
          name="id"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Department ID</FormLabel>
              <FormControl>
                <Input
                  placeholder="QC"
                  disabled={!!initialData?.id}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Department Name</FormLabel>
              <FormControl>
                <Input placeholder="Quality Control" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="type"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Department Type</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="GENERAL">General Department</SelectItem>
                  <SelectItem value="ENGINEERING">Engineering</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Level Names Configuration */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium leading-none">
              Approval Level Names
            </label>
            {levelEntries.length < 5 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addLevel}
              >
                <Plus className="h-3 w-3 mr-1" />
                Add Level
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Configure names for each approval level (e.g., Level 1 = Supervisor)
          </p>

          {levelEntries.length === 0 && (
            <div className="text-sm text-muted-foreground border border-dashed rounded-md p-3 text-center">
              No levels configured. Click &quot;Add Level&quot; to define approval levels.
            </div>
          )}

          <div className="space-y-2">
            {levelEntries.map((entry, index) => (
              <div key={index} className="flex items-center gap-2">
                <span className="text-sm font-medium w-16 text-muted-foreground shrink-0">
                  Level {entry.key}
                </span>
                <Input
                  placeholder={`e.g., Supervisor`}
                  value={entry.value}
                  onChange={(e) => updateLevelValue(index, e.target.value)}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeLevel(index)}
                  className="text-red-500 hover:text-red-700"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : initialData?.id ? 'Update Department' : 'Create Department'}
          </Button>
        </div>
      </form>
    </Form>
  )
}
