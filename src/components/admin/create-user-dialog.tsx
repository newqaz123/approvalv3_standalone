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
import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from '@/lib/i18n/client'

export function CreateUserDialog() {
  const t = useTranslations()
  const [open, setOpen] = useState(false)
  const router = useRouter()

  const handleSuccess = () => {
    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          {t('admin.addUser')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.createUser')}</DialogTitle>
          <DialogDescription>
            {t('admin.createUserDescription')}
          </DialogDescription>
        </DialogHeader>
        <UserForm
          onSuccess={handleSuccess}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
