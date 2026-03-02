'use client'

import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface StaleDataBannerProps {
  onRefresh: () => void
}

export function StaleDataBanner({ onRefresh }: StaleDataBannerProps) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-amber-900">
            This request was updated by another user
          </p>
          <p className="text-sm text-amber-700 mt-1">
            Click refresh to see the latest changes.
          </p>
        </div>
        <Button onClick={onRefresh} variant="outline" size="sm" className="flex-shrink-0">
          Refresh
        </Button>
      </div>
    </div>
  )
}
