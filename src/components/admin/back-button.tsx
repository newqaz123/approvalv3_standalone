'use client'

import { useTranslations } from '@/lib/i18n/client'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

interface BackButtonProps {
  href?: string
  label?: string
  className?: string
}

export function BackButton({ href = '/admin', label, className = '' }: BackButtonProps) {
  const t = useTranslations()
  return (
    <Button variant="ghost" asChild className={`mb-6 ${className}`}>
      <Link href={href} className="flex items-center gap-2">
        <ArrowLeft className="h-4 w-4" />
        {label ?? t('admin.backToAdmin')}
      </Link>
    </Button>
  )
}
