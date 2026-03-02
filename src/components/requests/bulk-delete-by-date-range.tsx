'use client'

import { useState, useEffect } from 'react'
import { useUser } from '@clerk/nextjs'
import { Trash2, AlertTriangle, Calendar, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { bulkDeleteRequestsByDateRange } from '@/server-actions/requests'
import { useRouter } from 'next/navigation'

export function BulkDeleteByDateRange() {
  const { user } = useUser()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [preview, setPreview] = useState<{ count: number; requests: any[] } | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)

  // Check if user is admin
  const isAdmin = user?.publicMetadata?.role === 'admin'

  // Reset state when dialog closes (must be before early return)
  useEffect(() => {
    if (!open) {
      setPreview(null)
      setShowConfirm(false)
      setConfirmText('')
      setError(null)
    }
  }, [open])

  if (!isAdmin) {
    return null // Don't show for non-admin users
  }

  const handlePreview = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setPreview(null)

    if (!dateFrom || !dateTo) {
      setError('Please select both from and to dates')
      return
    }

    setIsPreviewing(true)

    try {
      const result = await bulkDeleteRequestsByDateRange({
        mode: 'preview',
        dateFrom,
        dateTo,
      })

      if (result.success) {
        setPreview({
          count: result.count || 0,
          requests: result.requests || [],
        })
        setShowConfirm(true)
      } else {
        setError(result.error || 'Failed to preview requests')
      }
    } catch (err) {
      setError('An error occurred while previewing requests')
    } finally {
      setIsPreviewing(false)
    }
  }

  const handleDelete = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (confirmText !== 'DELETE') {
      setError('Please type "DELETE" to confirm')
      return
    }

    setIsSubmitting(true)

    try {
      const result = await bulkDeleteRequestsByDateRange({
        mode: 'delete',
        dateFrom,
        dateTo,
      })

      if (result.success) {
        setOpen(false)
        router.refresh()
      } else {
        setError(result.error || 'Failed to delete requests')
      }
    } catch (err) {
      setError('An error occurred while deleting requests')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
          <Trash2 className="h-4 w-4 mr-1" />
          Bulk Delete by Date
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" />
            Bulk Delete Requests by Date
          </DialogTitle>
          <DialogDescription className="space-y-2">
            <p>
              Soft delete multiple requests that were created within a specific date range.
            </p>
            <p className="font-semibold text-destructive">
              ⚠️ This will mark requests as deleted!
            </p>
          </DialogDescription>
        </DialogHeader>

        {!showConfirm ? (
          // Step 1: Select dates and preview
          <form onSubmit={handlePreview} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dateFrom">
                  <Calendar className="h-4 w-4 inline mr-1" />
                  From Date (Created)
                </Label>
                <input
                  id="dateFrom"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="dateTo">
                  <Calendar className="h-4 w-4 inline mr-1" />
                  To Date (Created)
                </Label>
                <input
                  id="dateTo"
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                />
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-sm">
              <p className="text-blue-800">
                This will find all requests created between{' '}
                <strong>{dateFrom || 'start date'}</strong> and{' '}
                <strong>{dateTo || 'end date'}</strong>.
              </p>
            </div>

            {error && (
              <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                {error}
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isPreviewing}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="default"
                disabled={isPreviewing || !dateFrom || !dateTo}
              >
                {isPreviewing ? (
                  <>
                    <Search className="h-4 w-4 mr-2 animate-spin" />
                    Previewing...
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4 mr-2" />
                    Preview
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          // Step 2: Show preview and confirm
          <form onSubmit={handleDelete} className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
              <h3 className="font-semibold text-blue-900 mb-2">
                Found {preview?.count || 0} requests to delete:
              </h3>
              <div className="max-h-60 overflow-y-auto space-y-2">
                {preview?.requests.map((request: any, index: number) => (
                  <div key={request.id} className="text-sm bg-white p-2 rounded border">
                    <p className="font-medium">{index + 1}. {request.title}</p>
                    <p className="text-xs text-gray-600">
                      Requester: {request.requester?.name} ({request.requester?.email})
                    </p>
                    <p className="text-xs text-gray-600">
                      Status: {request.status}
                    </p>
                    <p className="text-xs text-gray-600">
                      Created: {new Date(request.createdAt).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3">
              <p className="text-sm font-semibold text-destructive">
                ⚠️ Warning: This will soft delete {preview?.count || 0} requests!
              </p>
              <p className="text-xs text-destructive mt-1">
                Requests will be marked as deleted but can be restored from /admin/deleted-requests
              </p>
            </div>

            <div className="space-y-2">
              <Label>
                Type &ldquo;DELETE&rdquo; to confirm
              </Label>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="DELETE"
                className="w-full px-3 py-2 border rounded-md"
                required
              />
            </div>

            {error && (
              <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                {error}
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowConfirm(false)}
                disabled={isSubmitting}
              >
                Back
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={isSubmitting || confirmText !== 'DELETE'}
              >
                {isSubmitting ? 'Deleting...' : `Delete ${preview?.count || 0} Requests`}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
