'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { RequestModalRouter } from './request-modal-router'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface RequestDeepLinkModalProps {
  requestId?: string | null
  returnTo: string
}

export function RequestDeepLinkModal({ requestId, returnTo }: RequestDeepLinkModalProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    const hasRequestId = Boolean(requestId)
    setOpen(hasRequestId)
    setIsLoading(hasRequestId)
    setLoadError(null)
  }, [requestId])

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen && requestId) {
      router.replace(returnTo)
    }
  }

  if (!requestId) {
    return null
  }

  return (
    <>
      {(isLoading || loadError) && (
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{loadError ? 'Could not open request' : 'Opening request'}</DialogTitle>
              <DialogDescription>
                {loadError || 'Loading the request from your email link.'}
              </DialogDescription>
            </DialogHeader>
            {loadError ? (
              <div className="flex justify-end">
                <Button type="button" onClick={() => handleOpenChange(false)}>
                  Close
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading request...
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}

      <RequestModalRouter
        requestId={requestId}
        open={open}
        onOpenChange={handleOpenChange}
        onLoadStateChange={setIsLoading}
        onLoadError={setLoadError}
      />
    </>
  )
}
