'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { SubmitterModal } from './submitter-modal'
import { ApproverModal } from './approver-modal'
import { CompletedRequestModal } from './completed-request-modal'
import { CompletedSolutionModal } from './completed-solution-modal'
import { SolutionModal } from './solution-modal'
import { CompletedFinalModal } from './completed-final-modal'
import { RequestResubmitModal } from './request-resubmit-modal'
import { FinalApprovalResubmitModal } from './final-approval-resubmit-modal'
import { SubmitFinalApprovalModal } from './submit-final-approval-modal'
import { getRequest, resubmitRequest } from '@/server-actions/requests'
import { getEngineeringSubTaskOptions } from '@/server-actions/engineering-sub-tasks'
import { canUserApprove, approveRequest, rejectRequest } from '@/server-actions/approvals'
import { approveSolution, rejectSolution, submitSolution, resubmitSolution, initiateFinalApproval } from '@/server-actions/solutions'
import { transformRequestToModalData } from '@/lib/modal-data-adapters'
import { canManageEngineeringSubTasks, isSubTaskVisibleForRequestStatus } from '@/lib/engineering-sub-tasks'
import { getModalTypeForStatus, canUserSubmitSolution, canUserSubmitFinalApproval } from '@/lib/permission-checks'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { FilePreviewDialog } from '@/components/requests/file-preview-dialog'
import { getFilePreviewUrl, normalizeStoredFilePath } from '@/lib/file-preview'
import type { ExportPackageRequestItem } from '@/lib/export-package'
import { SubTasksSection } from './sub-tasks-section'

interface RequestModalRouterProps {
  requestId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onActionComplete?: () => void
}

/**
 * Smart modal router that displays the appropriate modal variant
 * based on request status, user permissions, and current state
 */
export function RequestModalRouter({
  requestId,
  open,
  onOpenChange,
  onActionComplete,
}: RequestModalRouterProps) {
  const { data: session } = useSession()
  const user = session?.user
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [requestData, setRequestData] = useState<any>(null)
  const [canApprove, setCanApprove] = useState(false)
  const [userDepartmentType, setUserDepartmentType] = useState<string | null>(null)
  const [userDepartmentId, setUserDepartmentId] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showSolutionModal, setShowSolutionModal] = useState(false)
  const [showResubmitSolutionModal, setShowResubmitSolutionModal] = useState(false)
  const [showSubmitFinalApprovalModal, setShowSubmitFinalApprovalModal] = useState(false)
  const [previewFile, setPreviewFile] = useState<any>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [subTaskOptions, setSubTaskOptions] = useState<{
    stages: Array<{ id: string; name: string; isOthers: boolean }>
    subcontractors: Array<{ id: string; name: string }>
  } | null>(null)

  // Debug: Log when resubmit modal state changes
  useEffect(() => {
    console.log('🔵 showResubmitSolutionModal changed to:', showResubmitSolutionModal)
  }, [showResubmitSolutionModal])
  const [availableUsers, setAvailableUsers] = useState<Array<{ id: string; name: string; email: string; level: number | undefined; role: string }>>([])

  useEffect(() => {
    if (open && requestId) {
      loadRequestData()
    }
  }, [open, requestId])

  const loadRequestData = async () => {
    setLoading(true)
    try {
      // Fetch request with all related data
      const request = await getRequest(requestId)

      if (!request) {
        setLoading(false)
        return
      }

      if (isSubTaskVisibleForRequestStatus(request.status)) {
        setSubTaskOptions(await getEngineeringSubTaskOptions())
      } else {
        setSubTaskOptions(null)
      }

      // Check if user can approve - use appropriate check based on status
      let approvalCheck = { canApprove: false }
      
      if (request.solutions?.[0] && request.status === 'DesignCostEstimationApproval') {
        // Check solution approval permissions
        const { canUserApproveSolution } = await import('@/server-actions/solutions')
        approvalCheck = await canUserApproveSolution(request.solutions[0].id)
      } else if (request.status === 'FinalApproval') {
        // Check final approval permissions
        const { canUserApproveFinalApproval } = await import('@/server-actions/solutions')
        approvalCheck = await canUserApproveFinalApproval(requestId)
      } else {
        // Check request approval permissions
        approvalCheck = await canUserApprove(requestId)
      }
      
      setCanApprove(approvalCheck.canApprove)

      // Get user department info
      if (user?.id) {
        const response = await fetch('/api/user/department')
        if (response.ok) {
          const deptData = await response.json()
          setUserDepartmentType(deptData.type)
          setUserDepartmentId(deptData.id)
        }
      }

      // Fetch available users for custom approval hierarchy
      const usersResponse = await fetch('/api/users?active=true')
      if (usersResponse.ok) {
        const usersData = await usersResponse.json()
        // Filter out current user and transform null to undefined
        const filteredUsers = usersData
          .filter((u: any) => u.id !== user?.id)
          .map((u: any) => ({
            ...u,
            level: u.level ?? undefined,
          }))
        setAvailableUsers(filteredUsers)
      }

      setRequestData(request)
    } catch (error) {
      console.error('Failed to load request data:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading || !requestData) {
    return null // Or a loading skeleton
  }

  // Transform data for modals
  const modalData = transformRequestToModalData(requestData)
  
  // Determine permissions
  const isEngineering = canUserSubmitSolution(userDepartmentType, user?.role)
  const isRequesterDepartment = canUserSubmitFinalApproval(
    user?.id || '',
    requestData.requesterId,
    userDepartmentId,
    requestData.departmentId
  )

  // Check for rejections - only consider rejections relevant to current workflow stage
  const hasRequestRejection = (requestData.status === 'ImprovementRequest' || requestData.status === 'RequestRejected') &&
    requestData.approvals?.some((a: any) => a.status === 'rejected' && !a.isFinalApproval)
  
  const hasSolutionRejection = (requestData.status === 'SentToEngineer' || requestData.status === 'DesignCostEstimationApproval') &&
    requestData.solutions?.[0]?.approvals?.some((a: any) => a.status === 'rejected')
  
  const hasFinalRejection = (requestData.status === 'FinalApproval' || requestData.status === 'FinalRejected') &&
    requestData.approvals?.some((a: any) => a.status === 'rejected' && a.isFinalApproval)
  
  // Special case: Final approval rejection that sent request back to engineering
  const hasFinalRejectionInEngineering = requestData.status === 'SentToEngineer' &&
    requestData.approvals?.some((a: any) => a.status === 'rejected' && a.isFinalApproval)
  
  const hasRejection = hasRequestRejection || hasSolutionRejection || hasFinalRejection || hasFinalRejectionInEngineering

  // Check if current user can cancel (requester only, before any approvals)
  const isRequester = user?.id === requestData.requesterId
  const hasApprovedApprovals = requestData.approvals?.some((a: any) => a.status === 'approved' && !a.isFinalApproval)
  const canCancel = isRequester &&
    !hasApprovedApprovals &&
    requestData.status !== 'Completed' &&
    requestData.status !== 'Cancelled'

  const canManageSubTasks = canManageEngineeringSubTasks(user)
  const subTasksElement = isSubTaskVisibleForRequestStatus(requestData.status) && subTaskOptions ? (
    <SubTasksSection
      key={`${requestData.id}-${open ? 'open' : 'closed'}`}
      requestId={requestData.id}
      subTasks={requestData.subTasks ?? []}
      workRequisitionReceived={requestData.workRequisitionReceived}
      stages={subTaskOptions.stages}
      subcontractors={subTaskOptions.subcontractors}
      canManage={canManageSubTasks}
      onChanged={() => {
        void loadRequestData()
        router.refresh()
        window.dispatchEvent(new Event('approvalapp:request-data-changed'))
        onActionComplete?.()
      }}
    />
  ) : undefined

  // Determine modal type
  const modalConfig = getModalTypeForStatus(
    requestData.status,
    hasRejection,
    !!requestData.solutions?.[0],
    requestData.approvals?.some((a: any) => a.isFinalApproval),
    canApprove,
    isRequesterDepartment,
    isEngineering
  )

  // Common handlers
  const handleClose = () => {
    onOpenChange(false)
    window.dispatchEvent(new Event('approvalapp:request-data-changed'))
    onActionComplete?.()
  }

  const handleDownloadFile = async (fileId: string) => {
    try {
      const file = requestData.fileAttachments?.find((f: any) => f.id === fileId)

      if (!file) {
        toast.error('File not found')
        return
      }

      const normalizedPath = normalizeStoredFilePath(file.filePath)
      if (!normalizedPath) {
        toast.error('File is no longer available')
        return
      }

      const res = await fetch(`/api/files/download?path=${encodeURIComponent(normalizedPath)}`)

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'File is no longer available')
        return
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = file.fileName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Download error:', error)
      toast.error('Failed to download file')
    }
  }

  const handleDownloadSolutionFile = async (fileId: string) => {
    try {
      const file = requestData.solutions?.[0]?.fileAttachments
        ?.find((f: any) => f.id === fileId)

      if (!file) {
        toast.error('File not found')
        return
      }

      const normalizedPath = normalizeStoredFilePath(file.filePath)
      if (!normalizedPath) {
        toast.error('File is no longer available')
        return
      }

      const res = await fetch(`/api/files/download?path=${encodeURIComponent(normalizedPath)}`)

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'File is no longer available')
        return
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = file.fileName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Download error:', error)
      toast.error('Failed to download file')
    }
  }

  const getFileUrl = (file: any) => {
    if (!file?.filePath) return null
    return getFilePreviewUrl(file.filePath)
  }

  const handlePreviewFile = (fileId: string) => {
    const file = requestData.fileAttachments?.find((f: any) => f.id === fileId)

    if (!file) {
      toast.error('File not found')
      return
    }

    setPreviewFile(file)
    setPreviewUrl(getFileUrl(file))
    setPreviewOpen(true)
  }

  const handlePreviewSolutionFile = (fileId: string) => {
    const file = requestData.solutions?.[0]?.fileAttachments
      ?.find((f: any) => f.id === fileId)

    if (!file) {
      toast.error('File not found')
      return
    }

    setPreviewFile(file)
    setPreviewUrl(getFileUrl(file))
    setPreviewOpen(true)
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

  const handleExportReport = async () => {
    try {
      const { exportRequestAsPDF } = await import('@/server-actions/reports')
      const result = await exportRequestAsPDF(requestId)

      if (!result.success || !result.data) {
        toast.error(result.error || 'Failed to generate PDF')
        return
      }

      downloadBase64File(
        result.data,
        result.contentType || 'application/pdf',
        result.filename || `request-${requestId}.pdf`
      )
      toast.success('PDF exported successfully')
    } catch (error) {
      console.error('PDF export error:', error)
      toast.error('Failed to export PDF')
    }
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
    toast.success('Evidence package exported successfully')
  }

  const handleApprove = async (comment: string) => {
    if (isSubmitting) return
    setIsSubmitting(true)
    
    try {
      // Determine which approval action to call based on status
      const hasSolution = !!requestData.solutions?.[0]
      
      let result
      if (requestData.status === 'FinalApproval') {
        // Final approval
        const { approveFinalApproval } = await import('@/server-actions/solutions')
        result = await approveFinalApproval(requestId, comment)
      } else if (hasSolution && requestData.status === 'DesignCostEstimationApproval') {
        // Solution approval
        const solutionId = requestData.solutions[0].id
        result = await approveSolution(solutionId, comment)
      } else {
        // Request approval
        result = await approveRequest(requestId, comment)
      }
      
      if (result.success) {
        toast.success('Approved successfully')
        handleClose()
        router.refresh()
      } else {
        toast.error(result.message || 'Failed to approve')
      }
    } catch (error) {
      console.error('Approval error:', error)
      toast.error('An error occurred while approving')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleReject = async (reason: string) => {
    if (isSubmitting) return
    setIsSubmitting(true)
    
    try {
      // Determine which rejection action to call based on status
      const hasSolution = !!requestData.solutions?.[0]
      const hasFinalApproval = requestData.approvals?.some((a: any) => a.isFinalApproval)
      
      let result
      if (requestData.status === 'FinalApproval') {
        // Final approval rejection
        const { rejectFinalApproval } = await import('@/server-actions/solutions')
        result = await rejectFinalApproval(requestId, reason)
      } else if (hasSolution && requestData.status === 'DesignCostEstimationApproval') {
        // Solution rejection
        const solutionId = requestData.solutions[0].id
        result = await rejectSolution(solutionId, reason)
      } else {
        // Request rejection
        result = await rejectRequest(requestId, reason)
      }
      
      if (result.success) {
        toast.success('Rejected successfully')
        handleClose()
        router.refresh()
      } else {
        toast.error(result.message || 'Failed to reject')
      }
    } catch (error) {
      console.error('Rejection error:', error)
      toast.error('An error occurred while rejecting')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSubmitSolution = async (data: {
    title: string
    description: string
    costEstimate?: number
    currency?: string
    timeline?: string
    conceptDesign?: string
    useCustomApprovals?: boolean
    customApproverIds?: string[]
    fileIds?: string[]
  }) => {
    if (isSubmitting) return
    setIsSubmitting(true)
    
    try {
      const result = await submitSolution({
        requestId,
        title: data.title,
        description: data.description,
        costEstimate: data.costEstimate,
        currency: (data.currency as 'THB' | 'USD' | 'EUR') || 'THB',
        timeline: data.timeline,
        conceptDesign: data.conceptDesign,
        useCustomApprovals: data.useCustomApprovals || false,
        customApproverIds: data.customApproverIds,
        fileIds: data.fileIds,
      })
      
      if (result.success) {
        toast.success('Solution submitted successfully')
        handleClose()
        router.refresh()
      } else {
        toast.error('Failed to submit solution')
      }
    } catch (error) {
      console.error('Submit solution error:', error)
      toast.error('An error occurred while submitting solution')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSubmitFinalApproval = async (data: {
    useCustomChain: boolean
    customApproverIds?: string[]
  }) => {
    if (isSubmitting) return
    setIsSubmitting(true)
    
    try {
      const result = await initiateFinalApproval(
        requestId,
        data.useCustomChain,
        data.customApproverIds
      )
      
      if (result.success) {
        toast.success('Final approval initiated successfully')
        handleClose()
        router.refresh()
      } else {
        toast.error('Failed to initiate final approval')
      }
    } catch (error) {
      console.error('Final approval error:', error)
      toast.error('An error occurred while initiating final approval')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleResubmitRequest = async (data: {
    title: string
    description: string
  }) => {
    if (isSubmitting) return
    setIsSubmitting(true)
    
    try {
      const result = await resubmitRequest({
        requestId,
        title: data.title,
        description: data.description,
      })
      
      if (result.success) {
        toast.success('Request resubmitted successfully')
        handleClose()
        router.refresh()
      } else {
        toast.error('Failed to resubmit request')
      }
    } catch (error) {
      console.error('Resubmit request error:', error)
      toast.error('An error occurred while resubmitting request')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRestartFinalApproval = async (data: {
    useCustomChain: boolean
    customApproverIds?: string[]
  }) => {
    if (isSubmitting) return
    setIsSubmitting(true)
    
    try {
      // Restart final approval is the same as initiating it again
      const result = await initiateFinalApproval(
        requestId,
        data.useCustomChain,
        data.customApproverIds
      )
      
      if (result.success) {
        toast.success('Final approval restarted successfully')
        handleClose()
        router.refresh()
      } else {
        toast.error('Failed to restart final approval')
      }
    } catch (error) {
      console.error('Restart final approval error:', error)
      toast.error('An error occurred while restarting final approval')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Render appropriate modal based on config
  let modalContent: React.ReactNode = null
  
  switch (modalConfig.modalType) {
    case 'submitter':
      modalContent = (
        <SubmitterModal
          mode={modalConfig.mode as 'request' | 'solution' | 'resubmit'}
          open={open}
          onOpenChange={onOpenChange}
          initialData={{
            title: requestData.title,
            description: requestData.description,
          }}
        />
      )
      break

    case 'approver':
      modalContent = (
        <ApproverModal
          mode={modalConfig.mode as 'request' | 'solution' | 'final'}
          open={open}
          onOpenChange={onOpenChange}
          data={{
            ...modalData,
            status: requestData.status,
          }}
          canApprove={canApprove}
          onApprove={handleApprove}
          onReject={handleReject}
          onPreviewFile={handlePreviewFile}
          onPreviewSolutionFile={handlePreviewSolutionFile}
          onDownloadRequestFile={handleDownloadFile}
          onDownloadSolutionFile={handleDownloadSolutionFile}
          showCancel={canCancel}
          requestId={requestData.id}
          requestTitle={requestData.title}
          onCancelled={handleClose}
          subTasksElement={subTasksElement}
        />
      )
      break

    case 'solution':
      if (!modalData.solution) return null
      modalContent = (
        <SolutionModal
          open={open && !showResubmitSolutionModal}
          onOpenChange={onOpenChange}
          data={{
            ...modalData,
            status: ((hasSolutionRejection || hasFinalRejection || hasFinalRejectionInEngineering) && !canApprove) ? 'solution_rejected' : 'solution',
            solution: {
              ...modalData.solution,
              files: modalData.solution?.files || [],
            },
            rejection: (hasSolutionRejection || hasFinalRejection || hasFinalRejectionInEngineering) ? {
              reason: modalData.rejection?.reason || '',
              rejectedBy: modalData.rejection?.rejectedBy || '',
              rejectedAt: modalData.rejection?.rejectedAt || '',
            } : undefined,
          }}
          onApprove={canApprove ? () => handleApprove('') : undefined}
          onReject={canApprove ? (reason: string) => handleReject(reason) : undefined}
          onResubmit={(!canApprove && requestData.status === 'SentToEngineer' && isEngineering && (hasSolutionRejection || hasFinalRejection || hasFinalRejectionInEngineering)) ? () => {
            console.log('🔴 Resubmit button clicked!')
            console.log('Setting showResubmitSolutionModal to true')
            setShowResubmitSolutionModal(true)
          } : undefined}
          onSubmitFinalApproval={!canApprove && isRequesterDepartment ? () => setShowSubmitFinalApprovalModal(true) : undefined}
          userDepartment={userDepartmentType || undefined}
          onDownloadFile={handleDownloadFile}
          onDownloadSolutionFile={handleDownloadSolutionFile}
          onPreviewFile={handlePreviewFile}
          onPreviewSolutionFile={handlePreviewSolutionFile}
          availableUsers={availableUsers}
          subTasksElement={subTasksElement}
        />
      )
      break

    case 'resubmit-solution':
      if (!modalData.solution) return null
      modalContent = (
        <SubmitterModal
          mode="resubmit"
          open={open}
          onOpenChange={onOpenChange}
          initialData={{
            solution: modalData.solution,
            existingFiles: modalData.solution?.files,
            rejectionReason: modalData.rejection?.reason,
            rejectedBy: modalData.rejection?.rejectedBy,
            rejectedAt: modalData.rejection?.rejectedAt,
            requestId: requestData?.id,
            requestTitle: requestData?.title,
            requestDescription: requestData?.description,
          }}
          availableUsers={availableUsers}
          onSubmitSolution={async (data) => {
            setIsSubmitting(true)
            try {
              const result = await resubmitSolution({
                requestId: requestData.id,
                title: data.title || modalData.solution?.title || '',
                description: data.description,
                cost: typeof data.cost === 'string' ? parseFloat(data.cost) : (data.cost || 0),
                currency: data.currency || 'THB',
                timeline: data.timeline,
                files: data.files || [],
                deletedFileIds: data.deletedFileIds || [],
                useCustomHierarchy: data.useCustomHierarchy || false,
                customApprovers: data.customApprovers || [],
              })
              
              if (result.success) {
                toast.success('Solution resubmitted successfully')
                onOpenChange(false)
                window.dispatchEvent(new Event('approvalapp:request-data-changed'))
                onActionComplete?.()
                router.refresh()
              }
            } catch (error) {
              console.error('Failed to resubmit solution:', error)
              toast.error(error instanceof Error ? error.message : 'Failed to resubmit solution')
            } finally {
              setIsSubmitting(false)
            }
          }}
        />
      )
      break

    case 'completed-request':
      modalContent = (
        <CompletedRequestModal
          open={open}
          onOpenChange={onOpenChange}
          data={{
            ...modalData,
            status: 'completed_request',
            sentToEngineerAt: requestData.updatedAt.toISOString(),
            engineerAssigned: 'Engineering Team',
          }}
          userDepartment={userDepartmentType || undefined}
          onSubmitSolution={() => setShowSolutionModal(true)}
          onDownloadFile={handleDownloadFile}
          onPreviewFile={handlePreviewFile}
          subTasksElement={subTasksElement}
        />
      )
      break

    case 'completed-solution':
      if (!modalData.solution) return null
      modalContent = (
        <CompletedSolutionModal
          open={open}
          onOpenChange={onOpenChange}
          data={{
            ...modalData,
            solution: modalData.solution,
            status: 'completed_solution',
            sentToRequesterAt: requestData.updatedAt.toISOString(),
            requesterName: requestData.requester.name,
          }}
          userDepartment={userDepartmentType || undefined}
          isRequesterDepartment={isRequesterDepartment}
          onSubmitFinalApproval={() => setShowSubmitFinalApprovalModal(true)}
          onDownloadRequestFile={handleDownloadFile}
          onDownloadSolutionFile={handleDownloadSolutionFile}
          onPreviewFile={handlePreviewFile}
          onPreviewSolutionFile={handlePreviewSolutionFile}
          subTasksElement={subTasksElement}
        />
      )
      break

    case 'completed-final':
      if (!modalData.solution) return null
      modalContent = (
        <CompletedFinalModal
          open={open}
          onOpenChange={onOpenChange}
          data={{
            ...modalData,
            solution: modalData.solution,
            status: 'completed',
            completedAt: requestData.updatedAt.toISOString(),
            finalApprovers: requestData.approvals
              ?.filter((a: any) => a.isFinalApproval && a.status === 'approved')
              .map((a: any) => a.approver?.name || 'Unknown'),
          }}
          onDownloadRequestFile={handleDownloadFile}
          onDownloadSolutionFile={handleDownloadSolutionFile}
          onPreviewFile={handlePreviewFile}
          onPreviewSolutionFile={handlePreviewSolutionFile}
          onExport={handleExportReport}
          onExportPackage={handleExportPackage}
          subTasksElement={subTasksElement}
        />
      )
      break

    case 'resubmit-request':
      modalContent = (
        <RequestResubmitModal
          open={open}
          onOpenChange={onOpenChange}
          initialData={{
            title: requestData.title,
            description: requestData.description,
            rejectionReason: modalData.rejection?.reason || '',
            rejectedBy: modalData.rejection?.rejectedBy || '',
            rejectedAt: modalData.rejection?.rejectedAt || '',
            files: modalData.requestFiles,
          }}
          onResubmit={handleResubmitRequest}
          showCancel={canCancel}
          requestId={requestData.id}
          requestTitle={requestData.title}
          onCancelled={handleClose}
        />
      )
      break

    case 'resubmit-final':
      if (!modalData.solution) return null
      modalContent = (
        <FinalApprovalResubmitModal
          open={open}
          onOpenChange={onOpenChange}
          data={{
            ...modalData,
            solution: modalData.solution,
            rejection: {
              reason: modalData.rejection?.reason || '',
              rejectedBy: modalData.rejection?.rejectedBy || '',
              rejectedAt: modalData.rejection?.rejectedAt || '',
              rejectedAtLevel: 1, // TODO: Calculate from approvals
            },
          }}
          availableUsers={[]} // TODO: Fetch available users
          onRestart={(data) => handleRestartFinalApproval({
            useCustomChain: data.useCustomHierarchy,
            customApproverIds: data.customApprovers,
          })}
          subTasksElement={subTasksElement}
        />
      )
      break

    case 'submit-final':
      if (!modalData.solution) return null
      modalContent = (
        <SubmitFinalApprovalModal
          open={open}
          onOpenChange={onOpenChange}
          data={{
            ...modalData,
            solution: modalData.solution,
          }}
          availableUsers={[]} // TODO: Fetch available users
          onSubmit={(data) => handleSubmitFinalApproval({
            useCustomChain: data.useCustomHierarchy,
            customApproverIds: data.customApprovers,
          })}
          onDownloadRequestFile={handleDownloadFile}
          onDownloadSolutionFile={handleDownloadSolutionFile}
          onPreviewFile={handlePreviewFile}
          onPreviewSolutionFile={handlePreviewSolutionFile}
          subTasksElement={subTasksElement}
        />
      )
      break

    default:
      return null
  }

  // Solution submission modal
  return (
    <>
      {modalContent}
      <SubmitterModal
        mode="solution"
        open={showSolutionModal}
        onOpenChange={setShowSolutionModal}
        initialData={{
          requestId: requestData?.id,
          requestTitle: requestData?.title,
          requestDescription: requestData?.description,
        }}
        availableUsers={availableUsers}
        onSubmitSolution={async (data) => {
          console.log('Modal received data:', data)
          setIsSubmitting(true)
          try {
            // Upload files first if any
            let fileIds: string[] = []
            if (data.files && data.files.length > 0) {
              const { uploadFileAction } = await import('@/server-actions/files')

              for (const file of data.files) {
                const formData = new FormData()
                formData.append('file', file)
                formData.append('requestId', requestData.id)

                const result = await uploadFileAction(null, formData)

                if (result.success && result.fileAttachment) {
                  fileIds.push(result.fileAttachment.id)
                }
              }
            }
            
            console.log('Submitting to server with:', {
              useCustomApprovals: data.useCustomHierarchy,
              customApproverIds: data.customApprovers,
            })
            
            const result = await submitSolution({
              requestId: requestData.id,
              title: data.title,
              description: data.description,
              costEstimate: data.cost,
              currency: data.currency as 'THB' | 'USD' | 'EUR',
              timeline: data.timeline,
              fileIds,
              useCustomApprovals: data.useCustomHierarchy,
              customApproverIds: data.customApprovers,
            })
            
            if (result.success) {
              toast.success('Solution submitted successfully')
              setShowSolutionModal(false)
              onOpenChange(false)
              window.dispatchEvent(new Event('approvalapp:request-data-changed'))
              onActionComplete?.()
              router.refresh()
            }
          } catch (error) {
            console.error('Failed to submit solution:', error)
            toast.error(error instanceof Error ? error.message : 'Failed to submit solution')
          } finally {
            setIsSubmitting(false)
          }
        }}
      />
      {modalData.solution && (
        <SubmitterModal
          mode="resubmit"
          open={showResubmitSolutionModal}
          onOpenChange={(open) => {
            console.log('🟢 Resubmit modal onOpenChange called with:', open)
            setShowResubmitSolutionModal(open)
          }}
          initialData={{
            solution: modalData.solution,
            existingFiles: modalData.solution?.files,
            rejectionReason: modalData.rejection?.reason,
            rejectedBy: modalData.rejection?.rejectedBy,
            rejectedAt: modalData.rejection?.rejectedAt,
            requestId: requestData?.id,
            requestTitle: requestData?.title,
            requestDescription: requestData?.description,
          }}
          availableUsers={availableUsers}
          onResubmit={async (data) => {
            console.log('🟢 onResubmit called with data:', data)
            setIsSubmitting(true)
            try {
              const result = await resubmitSolution({
                requestId: requestData.id,
                title: data.title || modalData.solution?.title || '',
                description: data.description,
                cost: typeof data.cost === 'string' ? parseFloat(data.cost) : (data.cost || 0),
                currency: data.currency || 'THB',
                timeline: data.timeline,
                files: data.files || [],
                deletedFileIds: data.deletedFileIds || [],
                useCustomHierarchy: data.useCustomHierarchy || false,
                customApprovers: data.customApprovers || [],
              })
              
              if (result.success) {
                toast.success('Solution resubmitted successfully')
                setShowResubmitSolutionModal(false)
                onOpenChange(false)
                window.dispatchEvent(new Event('approvalapp:request-data-changed'))
                onActionComplete?.()
                router.refresh()
              }
            } catch (error) {
              console.error('Failed to resubmit solution:', error)
              toast.error(error instanceof Error ? error.message : 'Failed to resubmit solution')
            } finally {
              setIsSubmitting(false)
            }
          }}
        />
      )}
      {modalData.solution && (
        <SubmitFinalApprovalModal
          open={showSubmitFinalApprovalModal}
          onOpenChange={setShowSubmitFinalApprovalModal}
          data={{
            ...modalData,
            solution: modalData.solution,
          }}
          availableUsers={availableUsers}
          onSubmit={async (data) => {
            setIsSubmitting(true)
            try {
              const result = await initiateFinalApproval(
                requestId,
                data.useCustomHierarchy,
                data.customApprovers
              )
              
              if (result.success) {
                toast.success('Final approval initiated successfully')
                setShowSubmitFinalApprovalModal(false)
                onOpenChange(false)
                window.dispatchEvent(new Event('approvalapp:request-data-changed'))
                onActionComplete?.()
                router.refresh()
              } else {
                toast.error('Failed to initiate final approval')
              }
            } catch (error) {
              console.error('Final approval error:', error)
              toast.error('An error occurred while initiating final approval')
            } finally {
              setIsSubmitting(false)
            }
          }}
          onDownloadRequestFile={handleDownloadFile}
          onDownloadSolutionFile={handleDownloadSolutionFile}
          onPreviewFile={handlePreviewFile}
          onPreviewSolutionFile={handlePreviewSolutionFile}
          subTasksElement={subTasksElement}
        />
      )}
      <FilePreviewDialog
        file={previewFile}
        url={previewUrl}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        onDownload={(file) => handleDownloadFile(file.id)}
        formatFileSize={(bytes) => {
          if (bytes < 1024) return bytes + ' B'
          if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
          return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
        }}
      />
    </>
  )
}
