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
import { useTranslations } from '@/lib/i18n/client'

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
  const t = useTranslations()
  const [isLoading, setIsLoading] = useState(false)

  async function handleExport(format: "csv" | "json") {
    if (!requestId.trim()) {
      toast.error(t('admin.requestIdRequired'))
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

      toast.success(t('admin.exportedAs', { format: format.toUpperCase() }))
    } catch (error) {
      toast.error(
        t('admin.exportAuditFailed')
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
              {t('admin.exporting')}
            </>
          ) : (
            <>
              <Download className="mr-2 h-4 w-4" />
              {t('admin.exportAudit')}
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => handleExport("csv")}>
          {t('admin.exportCsv')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport("json")}>
          {t('admin.exportJson')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
