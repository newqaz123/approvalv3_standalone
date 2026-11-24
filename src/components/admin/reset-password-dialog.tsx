'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { resetUserPassword } from '@/server-actions/users'
import { Lock, Eye, EyeOff } from 'lucide-react'
import { useTranslations } from '@/lib/i18n/client'

interface ResetPasswordDialogProps {
  userId: string
  userName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ResetPasswordDialog({
  userId,
  userName,
  open,
  onOpenChange,
}: ResetPasswordDialogProps) {
  const t = useTranslations()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (newPassword.length < 8) {
      setError(t('admin.passwordMinLength'))
      return
    }

    if (newPassword !== confirmPassword) {
      setError(t('admin.passwordsDoNotMatch'))
      return
    }

    setLoading(true)

    try {
      await resetUserPassword(userId, newPassword)
      setSuccess(true)
      router.refresh()
      // Reset after 2 seconds
      setTimeout(() => {
        setSuccess(false)
        setNewPassword('')
        setConfirmPassword('')
        onOpenChange(false)
      }, 2000)
    } catch (err) {
      setError(t('admin.resetPasswordFailed'))
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setError(null)
    setSuccess(false)
    setNewPassword('')
    setConfirmPassword('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            {t('admin.resetPassword')}
          </DialogTitle>
          <DialogDescription>
            {t('admin.resetPasswordDescription', { name: userName })}
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="py-6">
            <div className="rounded-md bg-green-50 p-4 text-sm text-green-700 text-center">
              <p className="font-medium">{t('admin.passwordResetSuccess')}</p>
              <p className="mt-1">{t('admin.passwordResetNextLogin')}</p>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 py-4">
            {error && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="newPassword">{t('admin.newPassword')}</Label>
              <div className="relative">
                <Input
                  id="newPassword"
                  type={showPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={t('admin.minEightCharacters')}
                  minLength={8}
                  required
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">{t('admin.confirmPassword')}</Label>
              <Input
                id="confirmPassword"
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t('admin.confirmNewPassword')}
                minLength={8}
                required
              />
            </div>

            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={handleClose} disabled={loading}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? t('admin.resettingPassword') : t('admin.resetPassword')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
