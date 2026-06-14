'use client'

import { useState, useEffect, useRef } from 'react'
import { format } from 'date-fns'
import { FileText, Download, Eye, User, CheckCircle2, Trash2, Wrench } from 'lucide-react'
import { useSession } from 'next-auth/react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { StatusBadge } from './status-badge'
import { RejectedBadge } from './rejected-badge'
import { CancelRequestDialog } from './cancel-request-dialog'
import { ResubmitRequestDialog } from './resubmit-request-dialog'
import { DeleteRequestDialog } from './delete-request-dialog'
import { getRequest } from '@/server-actions/requests'
import { getRequestApprovals, canUserApprove } from '@/server-actions/approvals'
import { getSolutionByRequestId, getSolutionApprovals, canUserApproveSolution, approveSolution, rejectSolution, canUserApproveFinalApproval } from '@/server-actions/solutions'
import { ApprovalProgress } from '@/components/approvals/approval-progress'
import { ApprovalActions } from '@/components/approvals/approval-actions'
import { MarkCompleteButton } from '@/components/solutions/mark-complete-button'
import { RequestDetailSkeleton } from '@/components/loading/request-detail-skeleton'
import { StaleDataBanner } from '@/components/requests/stale-data-banner'
import {
  InitiateFinalApprovalButton,
  FinalApprovalActions,
  FinalApprovalStatus,
} from '@/components/solutions/final-approval-actions'
import { ActivityTimeline } from '@/components/dashboard/activity-timeline'
import { RequestDrawer } from '@/components/mobile/request-drawer'
import { MobileApprovalActions } from '@/components/mobile/mobile-approval-actions'
import { useIsMobile } from '@/hooks/use-media-query'
import { RejectSolutionDialog } from '@/components/solutions/reject-solution-dialog'
import { FilePreviewDialog } from '@/components/requests/file-preview-dialog'
import { getFileDownloadUrl, getFilePreviewUrl } from '@/lib/file-preview'
import { CompletedApprovalExportBuilder } from '@/components/reports/completed-approval-export-builder'
import type { ExportPackageRequestItem } from '@/lib/export-package'
import Link from 'next/link'

/**
 * PERFORMANCE OPTIMIZATION: Static JSX elements hoisted outside component
 * These icons don't use props/state, so hoisting prevents re-creation on every render
 * Reference: Vercel React Best Practices - Hoist Static JSX
 */
const USER_ICON = <User className="h-4 w-4" />
const FILE_TEXT_ICON = <FileText className="h-4 w-4" />
const WRENCH_ICON = <Wrench className="h-4 w-4" />
const CHECK_CIRCLE_ICON = <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" />
const CHECK_CIRCLE_SMALL_ICON = <CheckCircle2 className="h-4 w-4" />

interface RequestDetailModalProps {
  requestId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onActionComplete?: () => void
}

export function RequestDetailModal({
  requestId,
  open,
  onOpenChange,
  onActionComplete,
}: RequestDetailModalProps) {
  const { data: session } = useSession(); const user = session?.user
  const isMobile = useIsMobile()
  const [request, setRequest] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [downloadUrls, setDownloadUrls] = useState<Record<string, string>>({})
  const [previewFile, setPreviewFile] = useState<any>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [approvals, setApprovals] = useState<any[]>([])
  const [canApprove, setCanApprove] = useState(false)
  const actionPerformedRef = useRef(false)

  // Solution-related state
  const [solution, setSolution] = useState<any>(null)
  const [solutionApprovals, setSolutionApprovals] = useState<any[]>([])
  const [canApproveSolution, setCanApproveSolution] = useState(false)
  const [solutionApprovalId, setSolutionApprovalId] = useState<string | null>(null)

  // Final approval state
  const [canApproveFinal, setCanApproveFinal] = useState(false)
  const [finalApproval, setFinalApproval] = useState<any>(null)
  const [finalApprovals, setFinalApprovals] = useState<any[]>([])
  const [departmentUsers, setDepartmentUsers] = useState<Array<{ id: string; name: string; email: string; level: number | null }>>([])
  const [showStaleWarning, setShowStaleWarning] = useState(false)
  const [isUserInteracting, setIsUserInteracting] = useState(false)
  const [interactionTimer, setInteractionTimer] = useState<NodeJS.Timeout | null>(null)
  const [contentVisible, setContentVisible] = useState(false)
  const [showExportBuilder, setShowExportBuilder] = useState(false)
  const exportBuilderRef = useRef<HTMLDivElement | null>(null)

  // Reject solution dialog state
  const [showRejectDialog, setShowRejectDialog] = useState(false)
  const [isRejecting, setIsRejecting] = useState(false)

  // Check for both request approvals and solution approvals rejections
  const hasRequestRejection = approvals.some(a => a.status === 'rejected')
  const hasSolutionRejection = solutionApprovals.some(a => a.status === 'rejected')
  const hasRejection = hasRequestRejection || hasSolutionRejection
  const hasApprovedApprovals = approvals.some(a => a.status === 'approved')
  const currentUserId = user?.id
  const [userRole, setUserRole] = useState<string | undefined>(undefined)

  // Determine if all approvals are complete for PDF export eligibility
  // PDF export requires all request approvals, solution approvals, and final approvals to be approved
  const allApprovalsComplete =
    approvals.length > 0 &&
    approvals.every(a => a.status === 'approved') &&
    solutionApprovals.every(a => a.status === 'approved') &&
    (finalApprovals.length === 0 || finalApprovals.every(a => a.status === 'approved'))

  useEffect(() => {
    // Update userRole from session
    if (user?.role) {
      setUserRole(user.role)
    } else if (user?.id) {
      setUserRole(undefined)
    }
  }, [user?.id, user?.role])

  useEffect(() => {
    if (open && requestId) {
      loadRequest()
    }
  }, [open, requestId])

  useEffect(() => {
    return () => {
      if (interactionTimer) {
        clearTimeout(interactionTimer)
      }
    }
  }, [interactionTimer])

  const handleFormInteraction = () => {
    setIsUserInteracting(true)
    // Clear existing timer
    if (interactionTimer) {
      clearTimeout(interactionTimer)
    }
    // Reset after 2 seconds of no interaction
    const timer = setTimeout(() => {
      setIsUserInteracting(false)
    }, 2000)
    setInteractionTimer(timer)
  }

  const loadRequest = async () => {
    // Block refresh if user is actively typing in form fields
    if (isUserInteracting) {
      console.log('[RequestDetailModal] Skipping refresh - user is actively typing')
      return
    }
    setShowStaleWarning(false)
    setLoading(true)
    setContentVisible(false)
    try {
      const [data, approvalsData, canApproveData] = await Promise.all([
        getRequest(requestId),
        getRequestApprovals(requestId),
        canUserApprove(requestId).then(res => res.canApprove).catch(() => false)
      ])

      setRequest(data)
      setApprovals(approvalsData)

      // Fetch user role from Prisma as source of truth (more reliable than Clerk metadata)
      if (user?.id) {
        try {
          const response = await fetch('/api/user/role', {
            headers: {
              'Content-Type': 'application/json',
            },
          })
          if (response.ok) {
            const roleData = await response.json()
            if (roleData.role) {
              console.log('[RequestDetailModal] User role from API:', roleData.role)
              setUserRole(roleData.role)
            }
          }
        } catch (error) {
          console.error('[RequestDetailModal] Failed to fetch user role:', error)
          // Fall back to Clerk metadata
          if (user?.role) {
            setUserRole(user.role as string)
          }
        }
      }
      setCanApprove(canApproveData)

      // Generate download URLs for files (local storage)
      if (data?.fileAttachments) {
        const urls: Record<string, string> = {}
        for (const file of data.fileAttachments) {
          // Use the stored filePath which includes UUID prefix
          const url = getFileDownloadUrl(file.filePath)
          if (url) urls[file.id] = url
        }
        setDownloadUrls(urls)
      }

      // Load solution data if request is in solution-related status
      if (data?.status === 'SentToEngineer' ||
          data?.status === 'DesignCostEstimationApproval' ||
          data?.status === 'SendBackToRequester' ||
          data?.status === 'FinalApproval' ||
          data?.status === 'Completed') {
        const solutionData = await getSolutionByRequestId(requestId)
        setSolution(solutionData)

        if (solutionData) {
          // Load solution approvals
          const approvals = await getSolutionApprovals(solutionData.id)
          setSolutionApprovals(approvals)

          // Check if current user can approve this solution
          const checkResult = await canUserApproveSolution(solutionData.id)
          setCanApproveSolution(checkResult.canApprove)
          if (checkResult.canApprove) {
            setSolutionApprovalId(checkResult.approval.id)
          } else {
            setSolutionApprovalId(null)
          }
        }
      } else {
        setSolution(null)
        setSolutionApprovals([])
        setCanApproveSolution(false)
        setSolutionApprovalId(null)
      }

      // Load final approval data if in FinalApproval or Completed status
      if (data?.status === 'FinalApproval' || data?.status === 'Completed') {
        const finalApprovalCheck = await canUserApproveFinalApproval(requestId)
        setCanApproveFinal(finalApprovalCheck.canApprove)
        setFinalApproval(finalApprovalCheck.approval)

        // Load all final approvals for progress display
        const allApprovals = await getRequestApprovals(requestId)
        const finalApprovalList = allApprovals.filter((a: any) => a.isFinalApproval)
        setFinalApprovals(finalApprovalList)
      } else if (data?.status === 'SendBackToRequester') {
        // Load department users for final approval initiation
        // We'll fetch users from the request's department
        if (data?.departmentId) {
          try {
            const response = await fetch(`/api/departments/${data.departmentId}/users`)
            if (response.ok) {
              const users = await response.json()
              setDepartmentUsers(users)
            }
          } catch (error) {
            console.error('Failed to load department users:', error)
          }
        }
      }

      // Reset final approval state when not in relevant statuses
      if (data?.status !== 'FinalApproval' && data?.status !== 'Completed') {
        setCanApproveFinal(false)
        setFinalApproval(null)
        setFinalApprovals([])
      }
    } catch (error) {
      console.error('Failed to load request:', error)
    } finally {
      setLoading(false)
      setContentVisible(true)
    }
  }

  const handleApproveSolution = async () => {
    if (!solution?.id || !request) return

    try {
      const result = await approveSolution(solution.id, undefined, request.updatedAt)

      if (result && 'stale' in result && result.stale) {
        setShowStaleWarning(true)
      } else {
        await loadRequest()
        actionPerformedRef.current = true
      }
    } catch (error) {
      console.error('Failed to approve solution:', error)
      alert('Failed to approve solution')
    }
  }

  const handleRejectSolution = async (comments: string) => {
    if (!solution?.id || !request) return

    setIsRejecting(true)
    try {
      const result = await rejectSolution(solution.id, comments, request.updatedAt)

      if (result && 'stale' in result && result.stale) {
        setShowStaleWarning(true)
      } else {
        await loadRequest()
        actionPerformedRef.current = true
        setShowRejectDialog(false)
      }
    } catch (error) {
      console.error('Failed to reject solution:', error)
      alert('Failed to reject solution')
    } finally {
      setIsRejecting(false)
    }
  }

  const getAttachmentUrl = (file: any) => {
    if (file?.filePath) {
      return getFilePreviewUrl(file.filePath)
    }

    return downloadUrls[file.id] || null
  }

  const handlePreview = (file: any) => {
    setPreviewFile(file)
    setPreviewUrl(getAttachmentUrl(file))
    setPreviewOpen(true)
  }

  const handleDownload = async (file: any) => {
    const url = getFileDownloadUrl(file?.filePath) ?? downloadUrls[file.id]
    if (url) {
      // Create hidden anchor and trigger download
      const a = document.createElement('a')
      a.href = url
      a.download = file.fileName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    }
  }

  const downloadBase64File = (data: string, contentType: string, filename: string) => {
    const byteCharacters = atob(data)
    const byteNumbers = new Array(byteCharacters.length)
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i)
    }
    const byteArray = new Uint8Array(byteNumbers)
    const blob = new Blob([byteArray], { type: contentType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleExportPackage = async (items: ExportPackageRequestItem[]) => {
    const { exportRequestPackageAsPDF } = await import('@/server-actions/reports')
    const result = await exportRequestPackageAsPDF(requestId, items)

    if (!result.success || !result.data) {
      throw new Error(result.error || 'Failed to generate PDF package')
    }

    downloadBase64File(
      result.data,
      result.contentType || 'application/pdf',
      result.filename || `approval-package-${requestId}.pdf`
    )
  }

  const renderExportBuilder = () => {
    if (request.status !== 'Completed' || !allApprovalsComplete) return null

    if (!showExportBuilder) {
      return (
        <div className="mt-3">
          <Button
            type="button"
            onClick={() => {
              setShowExportBuilder(true)
              window.requestAnimationFrame(() => {
                exportBuilderRef.current?.scrollIntoView({
                  behavior: 'smooth',
                  block: 'start',
                })
              })
            }}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
          >
            <Download className="mr-2 h-4 w-4" />
            Export Report
          </Button>
        </div>
      )
    }

    return (
      <div ref={exportBuilderRef} className="mt-3">
        <CompletedApprovalExportBuilder
          requestAttachments={request.fileAttachments ?? []}
          solutionAttachments={solution?.fileAttachments ?? []}
          onExportPackage={handleExportPackage}
        />
      </div>
    )
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  const renderAttachmentRow = (file: any, uploadedByLabel: string, showDescription = false) => (
    <div
      key={file.id}
      className="flex flex-col gap-3 p-3 border rounded-lg hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex-1 min-w-0">
        <button
          type="button"
          onClick={() => handlePreview(file)}
          className="block max-w-full truncate text-left text-sm font-medium text-slate-900 underline-offset-4 hover:text-indigo-600 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 rounded-sm"
        >
          {file.fileName}
        </button>
        <p className="text-xs text-gray-500">
          {formatFileSize(file.fileSize)}
          {showDescription && file.description && ` — ${file.description}`}
        </p>
        <p className="text-xs text-gray-400">
          Uploaded by {uploadedByLabel} • {format(new Date(file.createdAt), 'MMM d, yyyy')}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => handlePreview(file)}
        >
          <Eye className="h-4 w-4 mr-1" />
          Preview
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => handleDownload(file)}
        >
          <Download className="h-4 w-4 mr-1" />
          Download
        </Button>
      </div>
    </div>
  )

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setShowExportBuilder(false)
    }
    if (!open && actionPerformedRef.current) {
      onActionComplete?.()
      actionPerformedRef.current = false
    }
    onOpenChange(open)
  }

  if (loading) {
    return isMobile ? (
      <RequestDrawer open={open} onOpenChange={handleOpenChange} requestId={requestId} footer={undefined}>
        <RequestDetailSkeleton />
      </RequestDrawer>
    ) : (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-3xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Loading Request</DialogTitle>
          </DialogHeader>
          <RequestDetailSkeleton />
        </DialogContent>
      </Dialog>
    )
  }

  if (!request) {
    return isMobile ? (
      <RequestDrawer open={open} onOpenChange={handleOpenChange} requestId={requestId} footer={undefined}>
        <div className="text-center py-8 text-gray-500">
          Request not found
        </div>
      </RequestDrawer>
    ) : (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Request Not Found</DialogTitle>
          </DialogHeader>
          <div className="text-center py-8 text-gray-500">
            Request not found
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  // Extract mobile approval actions for sticky footer
  const mobileApprovalActions = canApprove && request.status !== 'FinalApproval' && request.status !== 'Completed' && (
    <MobileApprovalActions
      requestId={requestId}
      canApprove={canApprove}
      expectedUpdatedAt={request?.updatedAt}
      onFormInteraction={handleFormInteraction}
      onSuccess={() => {
        actionPerformedRef.current = true
        handleOpenChange(false)
      }}
    />
  )

  // Shared content component for both mobile drawer and desktop dialog
  const RequestContent = () => (
    <>
      {/* Header - only for mobile */}
      {isMobile && (
        <div className="mb-4">
          <div className="text-lg font-semibold pr-8">
            {request.title}
          </div>
          <div className="flex items-center gap-3 text-sm flex-wrap mt-2">
            <StatusBadge status={request.status} hasRejection={hasRejection} />
            {hasRejection && <RejectedBadge size="sm" />}
            <span className="text-gray-500">
              Created {format(new Date(request.createdAt), 'MMM d, yyyy')}
            </span>
          </div>
        </div>
      )}

      {showStaleWarning && (
        <div className={isMobile ? "mb-4" : "mb-4"}>
          <StaleDataBanner onRefresh={() => {
            setShowStaleWarning(false)
            loadRequest()
          }} />
        </div>
      )}

      <div className={isMobile ? "" : ""}>
          <div className={`space-y-6 py-4 ${contentVisible ? 'content-fade-in' : ''}`}>
            {/* Description */}
            <div className="bg-slate-50/50 rounded-xl p-4 border border-slate-100">
              <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
                <FileText className="h-4 w-4 text-indigo-500" />
                Description
              </h3>
              <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                {request.description}
              </p>
            </div>

            <Separator className="bg-slate-200" />

            {/* Requester Info */}
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                {USER_ICON}
                Requester
              </h3>
              <div className="text-sm">
                <p className="font-medium">{request.requester.name}</p>
                <p className="text-gray-500">{request.requester.email}</p>
                <p className="text-gray-500">{request.department?.name}</p>
              </div>
            </div>

            {/* Edit & Resubmit (if rejected and requester) */}
            {currentUserId &&
             request.requesterId === currentUserId &&
             hasRejection &&
             request.status === 'ImprovementRequest' && (
              <>
                <Separator />
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm font-medium text-amber-900 mb-2">
                    Request Rejected
                  </p>
                  <p className="text-sm text-amber-700 mb-3">
                    Your request was rejected during approval. Review the rejection feedback above and resubmit with updates to restart the approval process.
                  </p>
                  <ResubmitRequestDialog
                    requestId={request.id}
                    currentTitle={request.title}
                    currentDescription={request.description}
                    existingFiles={request.fileAttachments?.map((f: any) => ({
                      id: f.id,
                      fileName: f.fileName,
                      fileType: f.fileType,
                      fileSize: f.fileSize,
                      filePath: f.filePath,
                    })) || []}
                    onResubmitted={() => {
                      actionPerformedRef.current = true
                      loadRequest()
                    }}
                  />
                </div>
              </>
            )}

            {/* Cancel Request (if eligible) */}
            {currentUserId &&
             request.requesterId === currentUserId &&
             !hasApprovedApprovals &&
             request.status !== 'Completed' &&
             request.status !== 'Cancelled' && (
              <>
                <Separator />
                <div className="flex justify-start">
                  <CancelRequestDialog
                    requestId={request.id}
                    requestTitle={request.title}
                    onCancelled={() => {
                      actionPerformedRef.current = true
                      handleOpenChange(false)
                    }}
                  />
                </div>
              </>
            )}

            {/* Delete Request (Admin only) */}
            {currentUserId &&
             user?.role === 'admin' &&
             !request.isDeleted && (
              <>
                <Separator />
                <div className="flex justify-start">
                  <DeleteRequestDialog
                    requestId={request.id}
                    requestTitle={request.title}
                    trigger={
                      <Button variant="destructive" size="sm">
                        <Trash2 className="h-4 w-4 mr-1" />
                        Delete Request
                      </Button>
                    }
                    onDelete={() => {
                      actionPerformedRef.current = true
                      handleOpenChange(false)
                    }}
                  />
                </div>
              </>
            )}

            {/* Approval Actions (if user can approve) - desktop only */}
            {!isMobile && canApprove && request.status !== 'FinalApproval' && request.status !== 'Completed' && (
              <>
                <Separator />
                <ApprovalActions
                  requestId={requestId}
                  canApprove={canApprove}
                  onSuccess={() => {
                    actionPerformedRef.current = true
                    handleOpenChange(false)
                  }}
                  expectedUpdatedAt={request?.updatedAt}
                  onFormInteraction={handleFormInteraction}
                />
              </>
            )}

            {/* Engineering Solution Section */}
            {solution && (
              <>
                <Separator />
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                    {WRENCH_ICON}
                    Engineering Solution
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <p className="text-sm font-medium">{solution.title}</p>
                      <p className="text-sm text-gray-600 mt-1">{solution.description}</p>
                    </div>

                    {/* Cost Estimate */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-gray-500">Cost Estimate</p>
                        <p className="text-sm font-medium">
                          {new Intl.NumberFormat('th-TH', {
                            style: 'currency',
                            currency: solution.currency,
                          }).format(Number(solution.costEstimate))}
                        </p>
                      </div>
                      {solution.timeline && (
                        <div>
                          <p className="text-xs text-gray-500">Timeline</p>
                          <p className="text-sm font-medium">{solution.timeline}</p>
                        </div>
                      )}
                    </div>

                    {/* Concept Design */}
                    {solution.conceptDesign && (
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Concept Design</p>
                        <p className="text-sm text-gray-600">{solution.conceptDesign}</p>
                      </div>
                    )}

                    {/* Submitted By */}
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-gray-500">Submitted By</p>
                        <p className="text-sm font-medium">{solution.submittedBy?.name}</p>
                      </div>
                      <p className="text-xs text-gray-500">
                        {format(new Date(solution.submittedAt), 'MMM d, yyyy • h:mm a')}
                      </p>
                    </div>


                    {/* Solution Approval Actions */}
                    {canApproveSolution && (
                      <div className="flex gap-2 pt-2">
                        <Button onClick={handleApproveSolution} size="sm">
                          Approve Solution
                        </Button>
                        <Button
                          onClick={() => setShowRejectDialog(true)}
                          variant="destructive"
                          size="sm"
                        >
                          Reject Solution
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* All Attachments Grouped Section */}
            {((request.fileAttachments && request.fileAttachments.length > 0) ||
              (solution?.fileAttachments && solution.fileAttachments.length > 0)) && (
              <>
                <Separator />
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                    {FILE_TEXT_ICON}
                    All Attachments
                  </h3>

                  {/* Initial Request Attachments */}
                  {request.fileAttachments && request.fileAttachments.length > 0 && (
                    <div className="mb-4">
                      <h4 className="text-xs font-semibold text-gray-600 mb-2">
                        Initial Request Attachments ({request.fileAttachments.length})
                      </h4>
                      <div className="space-y-2">
                        {request.fileAttachments.map((file: any) =>
                          renderAttachmentRow(file, file.uploadedBy.name, true)
                        )}
                      </div>
                    </div>
                  )}

                  {/* Engineering Solution Attachments */}
                  {solution?.fileAttachments && solution.fileAttachments.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-gray-600 mb-2">
                        Engineering Solution Attachments ({solution.fileAttachments.length})
                      </h4>
                      <div className="space-y-2">
                        {solution.fileAttachments.map((file: any) =>
                          renderAttachmentRow(file, solution.submittedBy?.name || 'Engineering')
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Engineering Solution Approval Progress */}
            {solution && solutionApprovals.length > 0 && (
              <>
                <Separator />
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Engineering Solution Approval</h3>
                  <ApprovalProgress approvals={solutionApprovals} />
                </div>
              </>
            )}

            {/* Submit Solution Button - only visible to engineering users */}
            {request.status === 'SentToEngineer' && userRole === 'engineering' && (
              <>
                <Separator />
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                    {WRENCH_ICON}
                    Engineering Solution
                  </h3>
                  {solution && solutionApprovals.some(a => a.status === 'rejected') ? (
                    <>
                      <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
                        <p className="text-sm font-medium text-red-900">Solution Rejected</p>
                        <p className="text-sm text-red-700 mt-1">
                          The previous solution was rejected. Please review the feedback and submit a revised solution.
                        </p>
                      </div>
                      <Link href={`/engineering/solutions/${request.id}`}>
                        <Button>
                          <Wrench className="h-4 w-4 mr-2" />
                          Resubmit Solution
                        </Button>
                      </Link>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-gray-600 mb-3">
                        This request is awaiting an engineering solution.
                      </p>
                      <Link href={`/engineering/solutions/${request.id}`}>
                        <Button>
                          <Wrench className="h-4 w-4 mr-2" />
                          Submit Solution
                        </Button>
                      </Link>
                    </>
                  )}
                </div>
              </>
            )}

            {/* Completed Status Display */}
            {request.status === 'Completed' && (
              <>
                <Separator />
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    {CHECK_CIRCLE_ICON}
                    <div className="flex-1">
                      <p className="text-sm font-medium text-green-900">
                        Request Completed
                      </p>
                      <p className="text-sm text-green-700 mt-1">
                        This request has been marked as completed.
                      </p>
                      {/* Show completion info from activity log */}
                      {request.activities && request.activities.some((a: any) => a.action === 'manually_completed') && (
                        <div className="mt-2 text-xs text-green-600">
                          Completed by engineering
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                {renderExportBuilder()}
              </>
            )}

            {/* Solution Ready for Requester */}
            {solution && request.status === 'SendBackToRequester' && (
              <>
                <Separator />
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="text-sm font-medium text-blue-900">
                    Solution is ready for your review
                  </p>
                  <p className="text-sm text-blue-700 mt-1">
                    Engineering has submitted a solution with cost estimate. Please review the solution details above.
                  </p>
                </div>
              </>
            )}

            {/* Mark Complete Button for Engineering Users */}
            {solution && request.status === 'SendBackToRequester' && userRole === 'engineering' && (
              <>
                <Separator />
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium">Engineering Completion</h4>
                    <p className="text-sm text-gray-500">
                      Mark this request as complete when work is done
                    </p>
                  </div>
                  <MarkCompleteButton
                    requestId={request.id}
                    requestTitle={request.title}
                    onSuccess={() => {
                      actionPerformedRef.current = true
                      loadRequest()
                    }}
                  />
                </div>
              </>
            )}

            {/* Final Approval Section for SendBackToRequester */}
            {solution && request.status === 'SendBackToRequester' && userRole !== 'engineering' && (
              <>
                <Separator />
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                    {CHECK_CIRCLE_SMALL_ICON}
                    Final Department Approval
                  </h3>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-3">
                    <p className="text-sm font-medium text-blue-900">
                      Solution is ready for final approval
                    </p>
                    <p className="text-sm text-blue-700 mt-1">
                      Engineering has submitted a solution. Route this for final department approval to complete the request.
                    </p>
                  </div>
                  <InitiateFinalApprovalButton
                    requestId={request.id}
                    departmentUsers={departmentUsers}
                    onSuccess={() => {
                      actionPerformedRef.current = true
                      loadRequest()
                    }}
                  />
                </div>
              </>
            )}

            {/* Final Approval Progress for FinalApproval Status */}
            {request.status === 'FinalApproval' && (
              <>
                <Separator />
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Final Department Approval</h3>
                  <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 mb-3">
                    <p className="text-sm font-medium text-indigo-900">
                      Final approval in progress
                    </p>
                    <p className="text-sm text-indigo-700 mt-1">
                      This solution is being reviewed through the department approval chain.
                    </p>
                  </div>

                  {/* Final Approval Actions */}
                  {canApproveFinal ? (
                    <div className="mb-3">
                      <FinalApprovalActions
                        requestId={request.id}
                        canApprove={canApproveFinal}
                        approval={finalApproval}
                        onSuccess={() => {
                          actionPerformedRef.current = true
                          loadRequest()
                        }}
                        expectedUpdatedAt={request?.updatedAt}
                        onFormInteraction={handleFormInteraction}
                      />
                    </div>
                  ) : (
                    <div className="mb-3">
                      <FinalApprovalStatus approval={finalApproval} />
                    </div>
                  )}

                  {/* Final Approval Progress */}
                  {finalApprovals.length > 0 && (
                    <ApprovalProgress approvals={finalApprovals} />
                  )}
                </div>
              </>
            )}

            {/* Completed Status Display with Final Approval */}
            {request.status === 'Completed' && solution && finalApprovals.length > 0 && (
              <>
                <Separator />
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Final Department Approval</h3>
                  <ApprovalProgress approvals={finalApprovals} />
                </div>
              </>
            )}

            {/* Regular Department Approval Progress */}
            {approvals.length > 0 && !solution && (
              <>
                <Separator />
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Department Approval</h3>
                  <ApprovalProgress approvals={approvals} />
                </div>
              </>
            )}

            {/* Activity Timeline */}
            {request.activities && request.activities.length > 0 && (
              <>
                <Separator />
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-3">
                    Activity Timeline
                  </h3>
                  <ActivityTimeline activities={request.activities} />
                </div>
              </>
            )}
          </div>
        </div>

        {/* Reject Solution Dialog */}
        <RejectSolutionDialog
          open={showRejectDialog}
          onOpenChange={setShowRejectDialog}
          onConfirm={handleRejectSolution}
          isLoading={isRejecting}
        />
    </>
  )

  const previewDialog = (
    <FilePreviewDialog
      file={previewFile}
      url={previewUrl}
      open={previewOpen}
      onOpenChange={setPreviewOpen}
      onDownload={handleDownload}
      formatFileSize={formatFileSize}
    />
  )

  // Mobile: Render RequestDrawer
  if (isMobile) {
    return (
      <>
        <RequestDrawer open={open} onOpenChange={handleOpenChange} requestId={requestId} footer={mobileApprovalActions}>
          <RequestContent />
        </RequestDrawer>
        {previewDialog}
      </>
    )
  }

  // Desktop: Render Dialog
  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col bg-white/95 backdrop-blur-xl border border-slate-200/60 shadow-2xl shadow-slate-200/50 rounded-2xl">
        <DialogHeader className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-slate-100">
          <DialogTitle className="text-xl font-bold text-slate-900 pr-8 leading-tight">
            {request.title}
          </DialogTitle>
          <div className="flex items-center gap-3 text-sm flex-wrap mt-3">
            <StatusBadge status={request.status} hasRejection={hasRejection} />
            {hasRejection && <RejectedBadge size="sm" />}
            <span className="text-slate-500 flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Created {format(new Date(request.createdAt), 'MMM d, yyyy')}
            </span>
          </div>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-6">
          <div className={`space-y-6 py-4 ${contentVisible ? 'content-fade-in' : ''}`}>
            {showStaleWarning && (
              <StaleDataBanner onRefresh={() => {
                setShowStaleWarning(false)
                loadRequest()
              }} />
            )}

            {/* Description */}
            <div className="bg-slate-50/50 rounded-xl p-4 border border-slate-100">
              <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
                <FileText className="h-4 w-4 text-indigo-500" />
                Description
              </h3>
              <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                {request.description}
              </p>
            </div>

            <Separator className="bg-slate-200" />

            {/* Requester Info */}
            <div className="bg-slate-50/50 rounded-xl p-4 border border-slate-100">
              <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
                {USER_ICON}
                Requester
              </h3>
              <div className="text-sm space-y-1">
                <p className="font-medium text-slate-900">{request.requester.name}</p>
                <p className="text-slate-500">{request.requester.email}</p>
                <p className="text-slate-500">{request.department?.name}</p>
              </div>
            </div>

            {/* Edit & Resubmit (if rejected and requester) */}
            {currentUserId &&
             request.requesterId === currentUserId &&
             hasRejection &&
             request.status === 'ImprovementRequest' && (
              <>
                <Separator />
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm font-medium text-amber-900 mb-2">
                    Request Rejected
                  </p>
                  <p className="text-sm text-amber-700 mb-3">
                    Your request was rejected during approval. Review the rejection feedback above and resubmit with updates to restart the approval process.
                  </p>
                  <ResubmitRequestDialog
                    requestId={request.id}
                    currentTitle={request.title}
                    currentDescription={request.description}
                    existingFiles={request.fileAttachments?.map((f: any) => ({
                      id: f.id,
                      fileName: f.fileName,
                      fileType: f.fileType,
                      fileSize: f.fileSize,
                      filePath: f.filePath,
                    })) || []}
                    onResubmitted={() => {
                      actionPerformedRef.current = true
                      loadRequest()
                    }}
                  />
                </div>
              </>
            )}

            {/* Cancel Request (if eligible) */}
            {currentUserId &&
             request.requesterId === currentUserId &&
             !hasApprovedApprovals &&
             request.status !== 'Completed' &&
             request.status !== 'Cancelled' && (
              <>
                <Separator />
                <div className="flex justify-start">
                  <CancelRequestDialog
                    requestId={request.id}
                    requestTitle={request.title}
                    onCancelled={() => {
                      actionPerformedRef.current = true
                      handleOpenChange(false)
                    }}
                  />
                </div>
              </>
            )}

            {/* Delete Request (Admin only) */}
            {currentUserId &&
             user?.role === 'admin' &&
             !request.isDeleted && (
              <>
                <Separator />
                <div className="flex justify-start">
                  <DeleteRequestDialog
                    requestId={request.id}
                    requestTitle={request.title}
                    trigger={
                      <Button variant="destructive" size="sm">
                        <Trash2 className="h-4 w-4 mr-1" />
                        Delete Request
                      </Button>
                    }
                    onDelete={() => {
                      actionPerformedRef.current = true
                      handleOpenChange(false)
                    }}
                  />
                </div>
              </>
            )}

            {/* Approval Actions (if user can approve) - desktop only */}
            {!isMobile && canApprove && request.status !== 'FinalApproval' && request.status !== 'Completed' && (
              <>
                <Separator />
                <ApprovalActions
                  requestId={requestId}
                  canApprove={canApprove}
                  onSuccess={() => {
                    actionPerformedRef.current = true
                    handleOpenChange(false)
                  }}
                  expectedUpdatedAt={request?.updatedAt}
                  onFormInteraction={handleFormInteraction}
                />
              </>
            )}

            {/* Engineering Solution Section */}
            {solution && (
              <>
                <Separator />
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                    {WRENCH_ICON}
                    Engineering Solution
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <p className="text-sm font-medium">{solution.title}</p>
                      <p className="text-sm text-gray-600 mt-1">{solution.description}</p>
                    </div>

                    {/* Cost Estimate */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-gray-500">Cost Estimate</p>
                        <p className="text-sm font-medium">
                          {new Intl.NumberFormat('th-TH', {
                            style: 'currency',
                            currency: solution.currency,
                          }).format(Number(solution.costEstimate))}
                        </p>
                      </div>
                      {solution.timeline && (
                        <div>
                          <p className="text-xs text-gray-500">Timeline</p>
                          <p className="text-sm font-medium">{solution.timeline}</p>
                        </div>
                      )}
                    </div>

                    {/* Concept Design */}
                    {solution.conceptDesign && (
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Concept Design</p>
                        <p className="text-sm text-gray-600">{solution.conceptDesign}</p>
                      </div>
                    )}

                    {/* Submitted By */}
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-gray-500">Submitted By</p>
                        <p className="text-sm font-medium">{solution.submittedBy?.name}</p>
                      </div>
                      <p className="text-xs text-gray-500">
                        {format(new Date(solution.submittedAt), 'MMM d, yyyy • h:mm a')}
                      </p>
                    </div>


                    {/* Solution Approval Actions */}
                    {canApproveSolution && (
                      <div className="flex gap-2 pt-2">
                        <Button onClick={handleApproveSolution} size="sm">
                          Approve Solution
                        </Button>
                        <Button
                          onClick={() => setShowRejectDialog(true)}
                          variant="destructive"
                          size="sm"
                        >
                          Reject Solution
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* All Attachments Grouped Section */}
            {((request.fileAttachments && request.fileAttachments.length > 0) ||
              (solution?.fileAttachments && solution.fileAttachments.length > 0)) && (
              <>
                <Separator />
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                    {FILE_TEXT_ICON}
                    All Attachments
                  </h3>

                  {/* Initial Request Attachments */}
                  {request.fileAttachments && request.fileAttachments.length > 0 && (
                    <div className="mb-4">
                      <h4 className="text-xs font-semibold text-gray-600 mb-2">
                        Initial Request Attachments ({request.fileAttachments.length})
                      </h4>
                      <div className="space-y-2">
                        {request.fileAttachments.map((file: any) =>
                          renderAttachmentRow(file, file.uploadedBy.name, true)
                        )}
                      </div>
                    </div>
                  )}

                  {/* Engineering Solution Attachments */}
                  {solution?.fileAttachments && solution.fileAttachments.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-gray-600 mb-2">
                        Engineering Solution Attachments ({solution.fileAttachments.length})
                      </h4>
                      <div className="space-y-2">
                        {solution.fileAttachments.map((file: any) =>
                          renderAttachmentRow(file, solution.submittedBy?.name || 'Engineering')
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Engineering Solution Approval Progress */}
            {solution && solutionApprovals.length > 0 && (
              <>
                <Separator />
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Engineering Solution Approval</h3>
                  <ApprovalProgress approvals={solutionApprovals} />
                </div>
              </>
            )}

            {/* Submit Solution Button - only visible to engineering users */}
            {request.status === 'SentToEngineer' && userRole === 'engineering' && (
              <>
                <Separator />
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                    {WRENCH_ICON}
                    Engineering Solution
                  </h3>
                  {solution && solutionApprovals.some(a => a.status === 'rejected') ? (
                    <>
                      <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
                        <p className="text-sm font-medium text-red-900">Solution Rejected</p>
                        <p className="text-sm text-red-700 mt-1">
                          The previous solution was rejected. Please review the feedback and submit a revised solution.
                        </p>
                      </div>
                      <Link href={`/engineering/solutions/${request.id}`}>
                        <Button>
                          <Wrench className="h-4 w-4 mr-2" />
                          Resubmit Solution
                        </Button>
                      </Link>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-gray-600 mb-3">
                        This request is awaiting an engineering solution.
                      </p>
                      <Link href={`/engineering/solutions/${request.id}`}>
                        <Button>
                          <Wrench className="h-4 w-4 mr-2" />
                          Submit Solution
                        </Button>
                      </Link>
                    </>
                  )}
                </div>
              </>
            )}

            {/* Completed Status Display */}
            {request.status === 'Completed' && (
              <>
                <Separator />
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    {CHECK_CIRCLE_ICON}
                    <div className="flex-1">
                      <p className="text-sm font-medium text-green-900">
                        Request Completed
                      </p>
                      <p className="text-sm text-green-700 mt-1">
                        This request has been marked as completed.
                      </p>
                      {/* Show completion info from activity log */}
                      {request.activities && request.activities.some((a: any) => a.action === 'manually_completed') && (
                        <div className="mt-2 text-xs text-green-600">
                          Completed by engineering
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                {renderExportBuilder()}
              </>
            )}

            {/* Solution Ready for Requester */}
            {solution && request.status === 'SendBackToRequester' && (
              <>
                <Separator />
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="text-sm font-medium text-blue-900">
                    Solution is ready for your review
                  </p>
                  <p className="text-sm text-blue-700 mt-1">
                    Engineering has submitted a solution with cost estimate. Please review the solution details above.
                  </p>
                </div>
              </>
            )}

            {/* Mark Complete Button for Engineering Users */}
            {solution && request.status === 'SendBackToRequester' && userRole === 'engineering' && (
              <>
                <Separator />
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium">Engineering Completion</h4>
                    <p className="text-sm text-gray-500">
                      Mark this request as complete when work is done
                    </p>
                  </div>
                  <MarkCompleteButton
                    requestId={request.id}
                    requestTitle={request.title}
                    onSuccess={() => {
                      actionPerformedRef.current = true
                      loadRequest()
                    }}
                  />
                </div>
              </>
            )}

            {/* Final Approval Section for SendBackToRequester */}
            {solution && request.status === 'SendBackToRequester' && userRole !== 'engineering' && (
              <>
                <Separator />
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                    {CHECK_CIRCLE_SMALL_ICON}
                    Final Department Approval
                  </h3>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-3">
                    <p className="text-sm font-medium text-blue-900">
                      Solution is ready for final approval
                    </p>
                    <p className="text-sm text-blue-700 mt-1">
                      Engineering has submitted a solution. Route this for final department approval to complete the request.
                    </p>
                  </div>
                  <InitiateFinalApprovalButton
                    requestId={request.id}
                    departmentUsers={departmentUsers}
                    onSuccess={() => {
                      actionPerformedRef.current = true
                      loadRequest()
                    }}
                  />
                </div>
              </>
            )}

            {/* Final Approval Progress for FinalApproval Status */}
            {request.status === 'FinalApproval' && (
              <>
                <Separator />
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Final Department Approval</h3>
                  <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 mb-3">
                    <p className="text-sm font-medium text-indigo-900">
                      Final approval in progress
                    </p>
                    <p className="text-sm text-indigo-700 mt-1">
                      This solution is being reviewed through the department approval chain.
                    </p>
                  </div>

                  {/* Final Approval Actions */}
                  {canApproveFinal ? (
                    <div className="mb-3">
                      <FinalApprovalActions
                        requestId={request.id}
                        canApprove={canApproveFinal}
                        approval={finalApproval}
                        onSuccess={() => {
                          actionPerformedRef.current = true
                          loadRequest()
                        }}
                        expectedUpdatedAt={request?.updatedAt}
                        onFormInteraction={handleFormInteraction}
                      />
                    </div>
                  ) : (
                    <div className="mb-3">
                      <FinalApprovalStatus approval={finalApproval} />
                    </div>
                  )}

                  {/* Final Approval Progress */}
                  {finalApprovals.length > 0 && (
                    <ApprovalProgress approvals={finalApprovals} />
                  )}
                </div>
              </>
            )}

            {/* Completed Status Display with Final Approval */}
            {request.status === 'Completed' && solution && finalApprovals.length > 0 && (
              <>
                <Separator />
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Final Department Approval</h3>
                  <ApprovalProgress approvals={finalApprovals} />
                </div>
              </>
            )}

            {/* Regular Department Approval Progress */}
            {approvals.length > 0 && !solution && (
              <>
                <Separator />
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Department Approval</h3>
                  <ApprovalProgress approvals={approvals} />
                </div>
              </>
            )}

            {/* Activity Timeline */}
            {request.activities && request.activities.length > 0 && (
              <>
                <Separator />
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-3">
                    Activity Timeline
                  </h3>
                  <ActivityTimeline activities={request.activities} />
                </div>
              </>
            )}
          </div>
        </div>

        {/* Reject Solution Dialog */}
        <RejectSolutionDialog
          open={showRejectDialog}
          onOpenChange={setShowRejectDialog}
          onConfirm={handleRejectSolution}
          isLoading={isRejecting}
        />
        </DialogContent>
      </Dialog>
      {previewDialog}
    </>
  )
}
