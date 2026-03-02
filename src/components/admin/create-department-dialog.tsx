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
import { DepartmentForm } from '@/components/admin/department-form'
import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface CreateDepartmentDialogProps {
  // No props needed - will call seedInitialDepartments action
}

export function CreateDepartmentDialog(props: CreateDepartmentDialogProps) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  const handleSuccess = () => {
    setOpen(false)
    router.refresh() // Refresh server components to show new department
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Add Department
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Department</DialogTitle>
          <DialogDescription>
            Create a new department for organizing users.
          </DialogDescription>
        </DialogHeader>
        <DepartmentForm
          onSuccess={handleSuccess}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
