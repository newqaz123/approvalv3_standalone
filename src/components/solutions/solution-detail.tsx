'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { SolutionApprovalActions } from '@/components/approvals/solution-approval-actions'
import { CheckCircle, XCircle, Clock, FileText } from 'lucide-react'
import { format } from 'date-fns'

interface SolutionDetailProps {
  solution: {
    id: string
    title: string
    description: string
    costEstimate: number | { toNumber: () => number }
    currency: string
    timeline: string | null
    conceptDesign: string | null
    submittedBy: { name: string; email: string }
    submittedAt: Date
  }
  approvals: Array<{
    id: string
    order: number
    status: 'pending' | 'approved' | 'rejected'
    requiredLevel: number | null
    requiredApproverId: string | null
    requiredApprover?: { name: string } | null
    approver?: { name: string } | null
    comments: string | null
    approvedAt: Date | null
    isCustomChain: boolean
  }>
  files?: Array<{
    id: string
    fileName: string
    fileType: string
    filePath: string
    createdAt: Date
  }>
  canApprove: boolean
  showApprovalActions: boolean
}

export function SolutionDetail({
  solution,
  approvals,
  files = [],
  canApprove,
  showApprovalActions,
}: SolutionDetailProps) {
  // Format cost estimate (handle Prisma Decimal type)
  const costValue = typeof solution.costEstimate === 'number'
    ? solution.costEstimate
    : solution.costEstimate.toNumber()

  const formattedCost = new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: solution.currency,
  }).format(costValue)

  // Get current pending approval for approval actions
  const currentApproval = approvals.find(a => a.status === 'pending')

  return (
    <div className="space-y-6">
      {/* Solution Header */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <CardTitle className="text-xl">{solution.title}</CardTitle>
              <p className="mt-1 text-sm text-gray-600">
                Submitted by {solution.submittedBy.name} ({solution.submittedBy.email})
              </p>
              <p className="text-xs text-gray-500">
                {format(new Date(solution.submittedAt), 'PPP p')}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Cost Estimate */}
          <div>
            <h4 className="mb-1 text-sm font-medium">Cost Estimate</h4>
            <p className="text-2xl font-bold text-green-700">{formattedCost}</p>
          </div>

          {/* Timeline (if present) */}
          {solution.timeline && (
            <div>
              <h4 className="mb-1 text-sm font-medium">Timeline</h4>
              <p className="text-sm text-gray-700">{solution.timeline}</p>
            </div>
          )}

          <Separator />

          {/* Description */}
          <div>
            <h4 className="mb-2 text-sm font-medium">Description</h4>
            <ScrollArea className="h-40 rounded-md border p-3">
              <p className="whitespace-pre-wrap text-sm text-gray-700">
                {solution.description}
              </p>
            </ScrollArea>
          </div>

          {/* Concept Design (if present) */}
          {solution.conceptDesign && (
            <div>
              <h4 className="mb-2 text-sm font-medium">Concept Design</h4>
              <ScrollArea className="h-32 rounded-md border bg-gray-50 p-3">
                <p className="whitespace-pre-wrap text-sm text-gray-700">
                  {solution.conceptDesign}
                </p>
              </ScrollArea>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Files Section */}
      {files.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Attached Files ({files.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {files.map((file) => (
                <a
                  key={file.id}
                  href={`/${file.filePath}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded-lg border p-3 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex-1">
                    <p className="text-sm font-medium">{file.fileName}</p>
                    <p className="text-xs text-gray-500">
                      {format(new Date(file.createdAt), 'PPP')}
                    </p>
                  </div>
                  <Badge variant="outline">{file.fileType}</Badge>
                </a>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Approval Progress Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Approval Progress</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {approvals.map((approval, index) => {
              const isPending = approval.status === 'pending'
              const isApproved = approval.status === 'approved'
              const isRejected = approval.status === 'rejected'
              const isCurrent = isPending && index === approvals.findIndex(a => a.status === 'pending')

              return (
                <div
                  key={approval.id}
                  className={`relative rounded-lg border p-4 ${
                    isCurrent
                      ? 'border-blue-300 bg-blue-50'
                      : isRejected
                      ? 'border-red-200 bg-red-50'
                      : 'border-gray-200'
                  }`}
                >
                  {/* Order Number */}
                  <div className="absolute left-2 top-1/2 -translate-y-1/2">
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                        isApproved
                          ? 'bg-green-100 text-green-700'
                          : isRejected
                          ? 'bg-red-100 text-red-700'
                          : isCurrent
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {index + 1}
                    </div>
                  </div>

                  <div className="ml-12 space-y-2">
                    {/* Approver Info */}
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        {approval.isCustomChain ? (
                          <p className="text-sm font-medium">
                            {approval.requiredApprover?.name || 'Unknown Approver'}
                          </p>
                        ) : (
                          <p className="text-sm font-medium">
                            Level {approval.requiredLevel} Approval
                          </p>
                        )}
                      </div>
                      <Badge
                        variant={
                          isApproved
                            ? 'default'
                            : isRejected
                            ? 'destructive'
                            : 'secondary'
                        }
                        className={
                          isApproved
                            ? 'bg-green-600'
                            : isRejected
                            ? 'bg-red-600'
                            : ''
                        }
                      >
                        {isApproved && <CheckCircle className="mr-1 h-3 w-3" />}
                        {isRejected && <XCircle className="mr-1 h-3 w-3" />}
                        {isPending && <Clock className="mr-1 h-3 w-3" />}
                        {approval.status.charAt(0).toUpperCase() + approval.status.slice(1)}
                      </Badge>
                    </div>

                    {/* Approval Details */}
                    {approval.approver && (
                      <div className="text-sm text-gray-600">
                        <p>Approved by: {approval.approver.name}</p>
                        {approval.approvedAt && (
                          <p className="text-xs text-gray-500">
                            {format(new Date(approval.approvedAt), 'PPP p')}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Comments */}
                    {approval.comments && (
                      <div className="rounded-md bg-white p-2 text-sm text-gray-700">
                        <p className="font-medium">Comments:</p>
                        <p className="whitespace-pre-wrap">{approval.comments}</p>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Approval Actions (only for current approvers) */}
            {showApprovalActions && canApprove && currentApproval && (
              <div className="mt-6 pt-6 border-t">
                <h4 className="mb-3 text-sm font-medium">Your Action Required</h4>
                <SolutionApprovalActions
                  solutionId={solution.id}
                  canApprove={canApprove}
                  currentApproval={{
                    id: currentApproval.id,
                    requiredLevel: currentApproval.requiredLevel,
                    requiredApproverId: currentApproval.requiredApproverId,
                    isCustomChain: currentApproval.isCustomChain,
                  }}
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
