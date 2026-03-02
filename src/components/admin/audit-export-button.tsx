"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Download, Loader2 } from "lucide-react"
import { toast } from "sonner"

interface AuditExportButtonProps {
  requestId: string
  variant?: "default" | "ghost" | "outline"
  disabled?: boolean
}

export function AuditExportButton({
  requestId,
  variant = "default",
  disabled = false,
}: AuditExportButtonProps) {
  const [isLoading, setIsLoading] = useState(false)

  async function handleExport(format: "csv" | "json") {
    if (!requestId.trim()) {
      toast.error("Request ID is required")
      return
    }

    try {
      setIsLoading(true)
      const response = await fetch(
        `/api/audit/export/request/${requestId}?format=${format}`
      )

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Export failed")
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `audit-trail-${requestId}.${format}`
      a.click()
      window.URL.revokeObjectURL(url)

      toast.success(`Exported as ${format.toUpperCase()}`)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to export audit trail"
      )
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} disabled={disabled || isLoading}>
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Exporting...
            </>
          ) : (
            <>
              <Download className="mr-2 h-4 w-4" />
              Export Audit Trail
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => handleExport("csv")}>
          Export as CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport("json")}>
          Export as JSON
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
