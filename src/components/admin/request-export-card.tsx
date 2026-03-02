"use client"

import { useState } from "react"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AuditExportButton } from "@/components/admin/audit-export-button"

export function RequestExportCard() {
  const [requestId, setRequestId] = useState("")

  return (
    <Card>
      <CardHeader>
        <CardTitle>Export by Request</CardTitle>
        <CardDescription>
          Export audit trail for a specific request
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="requestId">Request ID</Label>
          <Input
            id="requestId"
            placeholder="Enter request ID"
            value={requestId}
            onChange={(e) => setRequestId(e.target.value)}
          />
        </div>
        <AuditExportButton
          requestId={requestId}
          disabled={!requestId.trim()}
        />
      </CardContent>
    </Card>
  )
}
