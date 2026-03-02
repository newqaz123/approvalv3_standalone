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
import { Pencil } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface EditDepartmentDialogProps {
  department: {
    id: string
    name: string
    type: 'GENERAL' | 'ENGINEERING'
    levelNames?: Record<string, string> | null
  }
}

export function EditDepartmentDialog({ department }: EditDepartmentDialogProps) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  const handleSuccess = () => {
    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Pencil className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Department</DialogTitle>
          <DialogDescription>
            Update department details and configure approval level names.
          </DialogDescription>
        </DialogHeader>
        <DepartmentForm
          initialData={{
            id: department.id,
            name: department.name,
            type: department.type,
            levelNames: department.levelNames ?? undefined,
          }}
          onSuccess={handleSuccess}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
