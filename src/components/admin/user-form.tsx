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
import { createUser, updateUser } from '@/server-actions/users'
import {
  APPROVAL_LEVELS,
  MAX_APPROVAL_LEVEL,
  MIN_APPROVAL_LEVEL,
} from '@/lib/approval-levels'
import type { OrganizationPositionCode, OrganizationUnitType } from '@/lib/organization/types'
import type { departments as Department } from '@prisma/client'

// Extended Department type with levelNames
type DepartmentWithLevelNames = Department & {
  levelNames: Record<string, string> | null
}

export interface OrganizationUnitOption {
  id: string
  name: string
  unitType: OrganizationUnitType
}

const POSITION_CODES: OrganizationPositionCode[] = [
  'STAFF',
  'SUPERVISOR',
  'SECTION_MANAGER',
  'DEPARTMENT_MANAGER',
  'DIVISION_MANAGER',
  'FACTORY_MANAGER',
]

const POSITION_LABELS: Record<OrganizationPositionCode, string> = {
  STAFF: 'Staff (1)',
  SUPERVISOR: 'Supervisor (2)',
  SECTION_MANAGER: 'Section Manager (3)',
  DEPARTMENT_MANAGER: 'Department Manager (4)',
  DIVISION_MANAGER: 'Division Manager (5)',
  FACTORY_MANAGER: 'Factory Manager (6)',
}

const POSITION_UNIT: Record<OrganizationPositionCode, OrganizationUnitType> = {
  STAFF: 'SECTION',
  SUPERVISOR: 'SECTION',
  SECTION_MANAGER: 'SECTION',
  DEPARTMENT_MANAGER: 'DEPARTMENT',
  DIVISION_MANAGER: 'DIVISION',
  FACTORY_MANAGER: 'FACTORY',
}

const PARENT_MANAGER_POSITIONS = new Set<OrganizationPositionCode>([
  'DEPARTMENT_MANAGER',
  'DIVISION_MANAGER',
  'FACTORY_MANAGER',
])

const userFormSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  departmentId: z.string().optional(),
  role: z.enum(['admin', 'general_dept', 'engineering'] as const).optional(),
  level: z.number().int().min(MIN_APPROVAL_LEVEL).max(MAX_APPROVAL_LEVEL).optional().nullable(),
  password: z.union([z.string().min(8, 'Password must be at least 8 characters'), z.literal('')]).optional(),
  unitId: z.string().optional(),
  positionCode: z.enum([
    'STAFF',
    'SUPERVISOR',
    'SECTION_MANAGER',
    'DEPARTMENT_MANAGER',
    'DIVISION_MANAGER',
    'FACTORY_MANAGER',
  ] as const).optional(),
}).superRefine((data, ctx) => {
  const hasDepartment = Boolean(data.departmentId)
  const hasPosition = Boolean(data.unitId && data.positionCode)
  if (!hasDepartment && !hasPosition) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Select a department or a valid organization unit and position',
      path: ['unitId'],
    })
  }
})

export type UserFormValues = z.infer<typeof userFormSchema>

interface UserFormProps {
  departments: DepartmentWithLevelNames[]
  organizationUnits?: OrganizationUnitOption[]
  initialData?: UserFormValues & { id?: string }
  onSuccess?: () => void
  onCancel?: () => void
}

export function UserForm({ departments, organizationUnits = [], initialData, onSuccess, onCancel }: UserFormProps) {
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
      unitId: '',
      positionCode: undefined,
    },
  })

  const selectedDepartmentId = form.watch('departmentId')
  const selectedPositionCode = form.watch('positionCode')
  const autoRole = selectedDepartmentId === 'ENG' ? 'engineering' : 'general_dept'
  const parentUnitManager = selectedPositionCode ? PARENT_MANAGER_POSITIONS.has(selectedPositionCode) : false
  const unitsForPosition = selectedPositionCode
    ? organizationUnits.filter((unit) => unit.unitType === POSITION_UNIT[selectedPositionCode])
    : organizationUnits

  async function onSubmit(data: UserFormValues) {
    setIsSubmitting(true)
    setError(null)

    try {
      const submitData = {
        name: data.name,
        email: data.email,
        role: data.role || autoRole,
        level: data.level ?? null,
        positionAssignment: data.unitId && data.positionCode
          ? {
              unitId: data.unitId,
              positionCode: data.positionCode,
              reportingGroupId: null,
              isPrimary: true,
            }
          : undefined,
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
              <FormLabel>Legacy department (optional for NEW managers)</FormLabel>
              <Select
                onValueChange={(value) => field.onChange(value === 'none' ? '' : value)}
                value={field.value || 'none'}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {departments.map((dept) => (
                    <SelectItem key={dept.id} value={dept.id}>
                      {dept.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Not required when creating a NEW manager with a parent-unit position such as Factory Manager.
              </p>
              <FormMessage />
            </FormItem>
          )}
        />

        {organizationUnits.length > 0 && (
          <>
            <FormField
              control={form.control}
              name="positionCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Organization position</FormLabel>
                  <Select
                    onValueChange={(value) => {
                      field.onChange(value as OrganizationPositionCode)
                      form.setValue('unitId', '')
                    }}
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select position" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {POSITION_CODES.map((code) => (
                        <SelectItem key={code} value={code}>
                          {POSITION_LABELS[code]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="unitId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Organization unit</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select unit" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {unitsForPosition.map((unit) => (
                        <SelectItem key={unit.id} value={unit.id}>
                          {unit.name} ({unit.unitType.toLowerCase()})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        )}

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

        {/* Approval Level — shown for legacy department assignment; not required for NEW parent-unit managers */}
        {selectedDepartmentId && !parentUnitManager && (
          <FormField
            control={form.control}
            name="level"
            render={({ field }) => {
              const selectedDept = departments.find(d => d.id === selectedDepartmentId)
              const levelNames = selectedDept?.levelNames
              const configuredLevels = levelNames
                ? Object.entries(levelNames)
                    .filter(([key]) => APPROVAL_LEVELS.includes(Number(key)))
                    .sort(([a], [b]) => Number(a) - Number(b))
                : []
              const hasLevelNames = configuredLevels.length > 0

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
                          {configuredLevels.map(([key, value]) => (
                              <SelectItem key={key} value={key}>
                                Level {key} - {String(value)}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Select
                        onValueChange={(val) => field.onChange(val === 'none' ? null : Number(val))}
                        value={field.value?.toString() || 'none'}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select approval level" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {APPROVAL_LEVELS.map((level) => (
                            <SelectItem key={level} value={String(level)}>
                              Level {level}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </FormControl>
                  <p className="text-xs text-muted-foreground">
                    {hasLevelNames
                      ? 'Select the approval hierarchy level for this user'
                      : 'Select the approval hierarchy level (1 = lowest, higher = more authority), or None if not applicable.'}
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
