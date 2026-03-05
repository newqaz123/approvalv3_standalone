'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { SubmitterModal } from './submitter-modal'
import { ApproverModal } from './approver-modal'
import { CompletedRequestModal } from './completed-request-modal'
import { CompletedSolutionModal } from './completed-solution-modal'
import { CompletedFinalModal } from './completed-final-modal'
import { RequestResubmitModal } from './request-resubmit-modal'
import { FinalApprovalResubmitModal } from './final-approval-resubmit-modal'
import { SubmitFinalApprovalModal } from './submit-final-approval-modal'
import { getRequest, resubmitRequest } from '@/server-actions/requests'
import { canUserApprove, approveRequest, rejectRequest } from '@/server-actions/approvals'
import { approveSolution, rejectSolution, submitSolution, initiateFinalApproval } from '@/server-actions/solutions'
import { transformRequestToModalData } from '@/lib/modal-data-adapters'
import { getModalTypeForStatus, canUserSubmitSolution, canUserSubmitFinalApproval } from '@/lib/permission-checks'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

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
      
      // Check if user can approve
      const approvalCheck = await canUserApprove(requestId)
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

  // Check for rejections
  const hasRequestRejection = requestData.approvals?.some((a: any) => 
    a.status === 'rejected' && !a.isFinalApproval
  )
  const hasSolutionRejection = requestData.solutions?.[0]?.approvals?.some((a: any) => 
    a.status === 'rejected'
  )
  const hasFinalRejection = requestData.approvals?.some((a: any) => 
    a.status === 'rejected' && a.isFinalApproval
  )
  const hasRejection = hasRequestRejection || hasSolutionRejection || hasFinalRejection

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
    onActionComplete?.()
  }

  const handleApprove = async (comment: string) => {
    if (isSubmitting) return
    setIsSubmitting(true)
    
    try {
      // Determine which approval action to call based on status
      const hasSolution = !!requestData.solutions?.[0]
      const hasFinalApproval = requestData.approvals?.some((a: any) => a.isFinalApproval)
      
      let result
      if (hasFinalApproval) {
        // Final approval
        result = await approveRequest(requestId, comment)
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
      if (hasFinalApproval) {
        // Final approval rejection
        result = await rejectRequest(requestId, reason)
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
  switch (modalConfig.modalType) {
    case 'approver':
      return (
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
        />
      )

    case 'completed-request':
      return (
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
          onSubmitSolution={() => {
            // TODO: Open SubmitterModal for solution submission
            // For now, this will be handled by a separate modal state
            console.log('Open solution submission modal')
          }}
        />
      )

    case 'completed-solution':
      if (!modalData.solution) return null
      return (
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
          onSubmitFinalApproval={() => {
            // TODO: Open SubmitFinalApprovalModal
            // For now, this will be handled by a separate modal state
            console.log('Open final approval submission modal')
          }}
        />
      )

    case 'completed-final':
      if (!modalData.solution) return null
      return (
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
          onExport={() => {
            console.log('Export PDF')
          }}
        />
      )

    case 'resubmit-request':
      return (
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
        />
      )

    case 'resubmit-solution':
      return (
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
          }}
          onResubmit={(data) => {
            console.log('Resubmit solution:', data)
            handleClose()
          }}
        />
      )

    case 'resubmit-final':
      if (!modalData.solution) return null
      return (
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
        />
      )

    case 'submit-final':
      if (!modalData.solution) return null
      return (
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
        />
      )

    default:
      return null
  }
}
