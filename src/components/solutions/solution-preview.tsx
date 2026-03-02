'use client'

import { useState } from 'react'
import { AlertCircle, FileText, File, FileImage, FileImage as FileCAD } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'

interface FileWithProgress {
  file: File
  id: string
  status: 'pending' | 'uploading' | 'success' | 'error'
  progress: number
  error?: string
}

interface SolutionPreviewProps {
  data: {
    title: string
    description: string
    costEstimate: number
    currency: string
    timeline?: string
    conceptDesign?: string
    useCustomApprovals: boolean
    customApprovers?: Array<{ id: string; name: string }>
    files?: FileWithProgress[]
  }
  requestTitle: string
  onEdit: () => void
  onConfirm: () => void
  isSubmitting: boolean
}

export function SolutionPreview({
  data,
  requestTitle,
  onEdit,
  onConfirm,
  isSubmitting,
}: SolutionPreviewProps) {
  const [showFullDescription, setShowFullDescription] = useState(false)
  const descriptionTooLong = data.description.length > 300

  const formatCost = (amount: number, currency: string) => {
    try {
      return new Intl.NumberFormat('th-TH', {
        style: 'currency',
        currency: currency,
      }).format(amount)
    } catch {
      return `${currency} ${amount.toFixed(2)}`
    }
  }

  const displayDescription = showFullDescription
    ? data.description
    : data.description.slice(0, 300) + (descriptionTooLong ? '...' : '')

  return (
    <div className="space-y-6">
      <Alert variant="default" className="border-amber-200 bg-amber-50">
        <AlertCircle className="h-4 w-4 text-amber-600" />
        <AlertDescription className="text-amber-800">
          Please review all details before submitting. Solutions cannot be edited after submission.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Request Being Addressed</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-3">
            <FileText className="h-5 w-5 text-muted-foreground mt-0.5" />
            <div className="flex-1">
              <p className="font-medium">{requestTitle}</p>
              <p className="text-sm text-muted-foreground mt-1">
                This solution is in response to the above request
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Solution Details</CardTitle>
          <CardDescription>Review all information before submitting</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Title */}
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">
              Solution Title
            </h3>
            <p className="text-base">{data.title}</p>
          </div>

          {/* Description */}
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">
              Description
            </h3>
            <p className="text-base whitespace-pre-wrap">{displayDescription}</p>
            {descriptionTooLong && (
              <button
                type="button"
                onClick={() => setShowFullDescription(!showFullDescription)}
                className="text-sm text-primary hover:underline mt-2"
              >
                {showFullDescription ? 'Show less' : 'Show more'}
              </button>
            )}
          </div>

          {/* Cost Estimate */}
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">
              Cost Estimate
            </h3>
            <p className="text-2xl font-semibold text-primary">
              {formatCost(data.costEstimate, data.currency)}
            </p>
          </div>

          {/* Timeline (if provided) */}
          {data.timeline && (
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">
                Timeline
              </h3>
              <p className="text-base">{data.timeline}</p>
            </div>
          )}

          {/* Concept Design (if provided) */}
          {data.conceptDesign && (
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">
                Concept Design
              </h3>
              <p className="text-base whitespace-pre-wrap">{data.conceptDesign}</p>
            </div>
          )}

          {/* File Attachments */}
          {data.files && data.files.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">
                File Attachments
              </h3>
              <div className="space-y-2">
                {data.files.map((fileItem) => {
                  const file = fileItem.file
                  const isUploading = fileItem.status === 'uploading'
                  const isError = fileItem.status === 'error'

                  return (
                    <div
                      key={fileItem.id}
                      className="flex items-center gap-3 p-3 border rounded-lg bg-muted/30"
                    >
                      <File className="h-5 w-5 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{file.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {(file.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                        {isUploading && (
                          <p className="text-xs text-blue-600 mt-1">
                            Uploading... {fileItem.progress}%
                          </p>
                        )}
                        {isError && (
                          <p className="text-xs text-red-600 mt-1">
                            {fileItem.error || 'Upload failed'}
                          </p>
                        )}
                      </div>
                      {fileItem.status === 'success' && (
                        <Badge variant="default" className="text-xs">
                          Ready
                        </Badge>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Approval Routing */}
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">
              Approval Routing
            </h3>
            {data.useCustomApprovals && data.customApprovers && data.customApprovers.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm">Custom approval chain:</p>
                <div className="flex flex-wrap gap-2">
                  {data.customApprovers.map((approver, index) => (
                    <Badge key={approver.id} variant="secondary" className="text-sm">
                      {index + 1}. {approver.name}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : (
              <Badge variant="outline" className="text-sm">
                Default engineering hierarchy
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={onEdit}
          disabled={isSubmitting}
        >
          Edit
        </Button>
        <Button
          type="button"
          onClick={onConfirm}
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Submitting...' : 'Confirm & Submit'}
        </Button>
      </div>
    </div>
  )
}
