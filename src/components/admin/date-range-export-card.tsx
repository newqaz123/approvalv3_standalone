"use client"

import { useState } from "react"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Download, Loader2 } from "lucide-react"
import { differenceInDays } from "date-fns"
import { toast } from "sonner"

export function DateRangeExportCard() {
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [format, setFormat] = useState<"csv" | "json">("csv")
  const [isExporting, setIsExporting] = useState(false)

  // Calculate date range in days
  const dateRangeDays = startDate && endDate
    ? differenceInDays(new Date(endDate), new Date(startDate)) + 1
    : 0

  // Validation
  const isValid =
    startDate &&
    endDate &&
    new Date(endDate) >= new Date(startDate) &&
    dateRangeDays <= 90

  async function handleExport() {
    if (!isValid) return

    try {
      setIsExporting(true)
      const response = await fetch(
        `/api/audit/export/date-range?startDate=${startDate}&endDate=${endDate}&format=${format}`
      )

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Export failed")
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `audit-trail-${startDate}-to-${endDate}.${format}`
      a.click()
      window.URL.revokeObjectURL(url)

      toast.success(`Exported as ${format.toUpperCase()}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to export audit trail")
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Export by Date Range</CardTitle>
        <CardDescription>
          Export audit trail for a date range (maximum 90 days)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="startDate">Start Date</Label>
            <Input
              id="startDate"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="endDate">End Date</Label>
            <Input
              id="endDate"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="format">Format</Label>
          <Select value={format} onValueChange={(value) => setFormat(value as "csv" | "json")}>
            <SelectTrigger id="format">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="csv">CSV</SelectItem>
              <SelectItem value="json">JSON</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {dateRangeDays > 90 && (
          <p className="text-sm text-destructive">
            Date range cannot exceed 90 days. Current: {dateRangeDays} days
          </p>
        )}

        <Button
          onClick={handleExport}
          disabled={!isValid || isExporting}
          className="w-full"
        >
          {isExporting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Exporting...
            </>
          ) : (
            <>
              <Download className="mr-2 h-4 w-4" />
              Export
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  )
}
