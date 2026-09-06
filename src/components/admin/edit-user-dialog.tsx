'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { UserForm, type OrganizationUnitOption } from '@/components/admin/user-form'
import { AdditionalDepartmentsSection } from '@/components/admin/additional-departments-section'
import { Pencil } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type { departments as Department } from '@prisma/client'
import type { OrganizationPositionCode } from '@/lib/organization/types'

interface EditUserDialogProps {
  user: {
    id: string
    name: string
    email: string
    departmentId: string | null
    role: 'admin' | 'general_dept' | 'engineering'
    level: number | null
    unitId?: string
    positionCode?: OrganizationPositionCode
  }
  departments: Department[]
  organizationUnits?: OrganizationUnitOption[]
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function EditUserDialog({ user, departments, organizationUnits = [], open: externalOpen, onOpenChange: externalOnOpenChange }: EditUserDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = externalOpen !== undefined ? externalOpen : internalOpen
  const setOpen = externalOnOpenChange || setInternalOpen
  const router = useRouter()

  const handleSuccess = () => {
    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {externalOpen === undefined && (
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm">
            <Pencil className="h-4 w-4" />
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit User</DialogTitle>
          <DialogDescription>
            Update user details and assign approval level.
          </DialogDescription>
        </DialogHeader>
        <UserForm
          departments={departments as (Department & { levelNames: Record<string, string> | null })[]}
          organizationUnits={organizationUnits}
          initialData={{
            id: user.id,
            name: user.name,
            email: user.email,
            departmentId: user.departmentId || '',
            role: user.role,
            level: user.level,
            unitId: user.unitId || '',
            positionCode: user.positionCode,
          }}
          onSuccess={handleSuccess}
          onCancel={() => setOpen(false)}
        />
        {user.departmentId ? (
          <AdditionalDepartmentsSection
            userId={user.id}
            userRole={user.role}
            userHomeDepartmentId={user.departmentId}
            departments={departments as (Department & { levelNames: Record<string, string> | null })[]}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
