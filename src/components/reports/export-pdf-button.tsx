'use client'

import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { exportRequestAsPDF } from '@/server-actions/reports'

export interface ExportPDFButtonProps {
  requestId: string
  requestStatus: string
  allApprovalsComplete: boolean
  disabled?: boolean
}

export function ExportPDFButton({
  requestId,
  requestStatus,
  allApprovalsComplete,
  disabled = false,
}: ExportPDFButtonProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Export only available for completed requests with all approvals complete
  const canExport =
    requestStatus === 'Completed' && allApprovalsComplete

  const handleExport = async () => {
    setError(null)
    setLoading(true)

    try {
      const result = await exportRequestAsPDF(requestId)

      if (!result.success) {
        setError(result.error || 'Failed to generate PDF')
        return
      }

      // Trigger download in browser
      if (result.data) {
        // Decode base64 to binary
        const byteCharacters = atob(result.data)
        const byteNumbers = new Array(byteCharacters.length)
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i)
        }
        const byteArray = new Uint8Array(byteNumbers)

        // Create blob and trigger download
        const blob = new Blob([byteArray], { type: result.contentType || 'application/pdf' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = result.filename || `request-${requestId}.pdf`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }
    } catch (err) {
      setError('An unexpected error occurred. Please try again.')
      console.error('PDF export error:', err)
    } finally {
      setLoading(false)
    }
  }

  if (!canExport) {
    return null
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        onClick={handleExport}
        disabled={disabled || loading}
        variant="outline"
        size="sm"
        className="w-full sm:w-auto"
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Generating PDF...
          </>
        ) : (
          <>
            <Download className="h-4 w-4 mr-2" />
            Export PDF
          </>
        )}
      </Button>
      {error && (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-red-600 break-words flex-1">{error}</span>
          <Button
            size="sm"
            variant="link"
            className="h-auto p-0 text-blue-600 whitespace-nowrap"
            onClick={handleExport}
          >
            Try again
          </Button>
        </div>
      )}
    </div>
  )
}
