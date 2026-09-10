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
import { UserForm } from '@/components/admin/user-form'
import { Pencil } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface EditUserDialogProps {
  user: {
    id: string
    name: string
    email: string
    role: 'admin' | 'general_dept' | 'engineering'
  }
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function EditUserDialog({ user, open: externalOpen, onOpenChange: externalOnOpenChange }: EditUserDialogProps) {
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
            Update user details. Organization assignment is managed in Organization & Approvals.
          </DialogDescription>
        </DialogHeader>
        <UserForm
          initialData={{
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
          }}
          onSuccess={handleSuccess}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
