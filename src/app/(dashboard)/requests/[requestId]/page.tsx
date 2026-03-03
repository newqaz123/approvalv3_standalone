import { auth } from '@/lib/auth-config'
import { redirect, notFound } from 'next/navigation'
import { format } from 'date-fns'
import { ArrowLeft, Download, Calendar, User, Building2, FileText, History, CheckCircle2, Wrench } from 'lucide-react'
import Link from 'next/link'
import prisma from '@/lib/prisma'
import { StatusBadge } from '@/components/requests/status-badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

interface RequestDetailPageProps {
  params: Promise<{
    requestId: string
  }>
}

export default async function RequestDetailPage({ params }: RequestDetailPageProps) {
  const session = await auth()
  const { requestId } = await params

  if (!session?.user?.id) {
    redirect('/sign-in')
  }
  const userId = session.user.id

  // Single comprehensive query with includes - optimal for fetching all related data
  // Prisma handles joins efficiently, avoiding N+1 query problems
  const request = await prisma.requests.findFirst({
    where: {
      id: requestId,
      isDeleted: false,
    },
    include: {
      requester: {
        select: { id: true, name: true, email: true },
      },
      department: {
        select: { id: true, name: true, type: true },
      },
      fileAttachments: {
        include: {
          uploadedBy: {
            select: { name: true },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
      activities: {
        include: {
          user: {
            select: { name: true, email: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      },
      approvals: {
        include: {
          approver: {
            select: { name: true, email: true },
          },
          requiredApprover: {
            select: { name: true },
          },
        },
        orderBy: { requiredLevel: 'asc' },
      },
      solutions: {
        include: {
          submittedBy: {
            select: { name: true, email: true },
          },
          fileAttachments: {
            include: {
              uploadedBy: {
                select: { name: true },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
          approvals: {
            include: {
              approver: {
                select: { name: true, email: true },
              },
              requiredApprover: {
                select: { name: true },
              },
            },
            orderBy: { requiredLevel: 'asc' },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  })

  if (!request) {
    notFound()
  }

  const solution = request.solutions[0] || null
  const hasRejection = request.approvals.some((a) => a.status === 'rejected')
  const hasApprovedApprovals = request.approvals.some((a) => a.status === 'approved')

  const handleDownload = (filePath: string, fileName: string) => {
    // For server components, we'll return the direct link
    // The browser will handle the download
    return `/${filePath}`
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  function formatActionLabel(action: string): string {
    const labels: Record<string, string> = {
      created: 'Request created',
      status_changed: 'Status changed',
      file_attached: 'File attached',
      approved: 'Approved',
      rejected: 'Rejected',
      cancelled: 'Cancelled',
      solution_submitted: 'Solution submitted',
      solution_approved: 'Solution approved',
      solution_rejected: 'Solution rejected',
      manually_completed: 'Marked as complete',
    }
    return labels[action] || action
  }

  return (
    <div className="container mx-auto py-6 max-w-5xl">
      {/* Header with Back Button */}
      <div className="mb-6">
        <Link href="/dashboard">
          <Button variant="ghost" className="mb-4">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>
        </Link>

        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h1 className="text-3xl font-bold">{request.title}</h1>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <StatusBadge status={request.status} />
              {hasRejection && (
                <span className="text-sm text-red-600 font-medium">Rejected</span>
              )}
              <span className="text-sm text-gray-500">
                Created {format(new Date(request.createdAt), 'MMM d, yyyy')}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="space-y-6">
        {/* Description */}
        <div className="bg-white rounded-lg border p-6">
          <h2 className="text-lg font-semibold mb-3">Description</h2>
          <p className="text-gray-700 whitespace-pre-wrap">{request.description}</p>
        </div>

        {/* Requester Info */}
        <div className="bg-white rounded-lg border p-6">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <User className="h-5 w-5" />
            Requester Information
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500">Name</p>
              <p className="font-medium">{request.requester.name}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Email</p>
              <p className="font-medium">{request.requester.email}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500 flex items-center gap-1">
                <Building2 className="h-4 w-4" />
                Department
              </p>
              <p className="font-medium">{request.department?.name}</p>
            </div>
          </div>
        </div>

        {/* Engineering Solution Section */}
        {solution && (
          <div className="bg-white rounded-lg border p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Wrench className="h-5 w-5" />
              Engineering Solution
            </h2>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-500">Solution Title</p>
                <p className="font-medium">{solution.title}</p>
              </div>

              <div>
                <p className="text-sm text-gray-500">Description</p>
                <p className="text-gray-700 mt-1">{solution.description}</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500">Cost Estimate</p>
                  <p className="text-lg font-semibold">
                    {new Intl.NumberFormat('th-TH', {
                      style: 'currency',
                      currency: solution.currency,
                    }).format(Number(solution.costEstimate))}
                  </p>
                </div>
                {solution.timeline && (
                  <div>
                    <p className="text-sm text-gray-500">Timeline</p>
                    <p className="font-medium">{solution.timeline}</p>
                  </div>
                )}
              </div>

              {solution.conceptDesign && (
                <div>
                  <p className="text-sm text-gray-500 mb-1">Concept Design</p>
                  <p className="text-gray-700">{solution.conceptDesign}</p>
                </div>
              )}

              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <p className="text-sm text-gray-500">Submitted By</p>
                  <p className="font-medium">{solution.submittedBy?.name}</p>
                </div>
                <p className="text-sm text-gray-500">
                  {format(new Date(solution.submittedAt), 'MMM d, yyyy • h:mm a')}
                </p>
              </div>

              {/* Solution File Attachments */}
              {solution.fileAttachments && solution.fileAttachments.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-2">Solution Attachments</p>
                  <div className="space-y-2">
                    {solution.fileAttachments.map((file) => (
                      <div
                        key={file.id}
                        className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{file.fileName}</p>
                          <p className="text-xs text-gray-500">
                            {formatFileSize(file.fileSize)} • {' '}
                            {format(new Date(file.createdAt), 'MMM d, yyyy')}
                          </p>
                        </div>
                        <Button size="sm" variant="outline" asChild>
                          <a href={handleDownload(file.filePath, file.fileName)} download={file.fileName}>
                            <Download className="h-4 w-4 mr-1" />
                            Download
                          </a>
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Solution Approval Progress */}
              {solution.approvals && solution.approvals.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-2">Solution Approval Progress</p>
                  <div className="space-y-2">
                    {solution.approvals.map((approval) => (
                      <div
                        key={approval.id}
                        className="flex items-center justify-between p-3 border rounded-lg"
                      >
                        <div className="flex-1">
                          <p className="text-sm font-medium">
                            {approval.isCustomChain
                              ? approval.requiredApprover?.name || 'Unknown'
                              : `Level ${approval.requiredLevel}`}
                          </p>
                          <p className="text-xs text-gray-500">
                            Step {approval.order} • {approval.status}
                          </p>
                          {approval.comments && (
                            <p className="text-xs text-gray-600 mt-1">{approval.comments}</p>
                          )}
                        </div>
                        <div
                          className={`h-3 w-3 rounded-full ${
                            approval.status === 'approved'
                              ? 'bg-green-500'
                              : approval.status === 'rejected'
                              ? 'bg-red-500'
                              : 'bg-gray-300'
                          }`}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Completed Status Display */}
        {request.status === 'Completed' && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-6">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-6 w-6 text-green-600 mt-0.5" />
              <div className="flex-1">
                <p className="text-lg font-semibold text-green-900">Request Completed</p>
                <p className="text-green-700 mt-1">
                  This request has been marked as completed.
                </p>
                {request.activities &&
                  request.activities.some((a) => a.action === 'manually_completed') && (
                    <div className="mt-2 text-sm text-green-600">
                      Completed by engineering team
                    </div>
                  )}
              </div>
            </div>
          </div>
        )}

        {/* Initial Approval Progress */}
        {request.approvals && request.approvals.length > 0 && (
          <div className="bg-white rounded-lg border p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5" />
              Initial Approvals
            </h2>
            <div className="space-y-3">
              {request.approvals.map((approval) => (
                <div
                  key={approval.id}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="flex-1">
                    <p className="text-sm font-medium">
                      {approval.isCustomChain
                        ? approval.requiredApprover?.name || 'Unknown'
                        : `Level ${approval.requiredLevel}`}
                    </p>
                    <p className="text-xs text-gray-500">
                      {approval.approver?.name || 'Pending'} • {approval.status}
                    </p>
                    {approval.comments && (
                      <p className="text-xs text-gray-600 mt-1">{approval.comments}</p>
                    )}
                  </div>
                  <div
                    className={`h-3 w-3 rounded-full ${
                      approval.status === 'approved'
                        ? 'bg-green-500'
                        : approval.status === 'rejected'
                        ? 'bg-red-500'
                        : 'bg-gray-300'
                    }`}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* File Attachments */}
        {request.fileAttachments && request.fileAttachments.length > 0 && (
          <div className="bg-white rounded-lg border p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Attachments ({request.fileAttachments.length})
            </h2>
            <div className="space-y-3">
              {request.fileAttachments.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{file.fileName}</p>
                    <p className="text-xs text-gray-500">
                      {formatFileSize(file.fileSize)}
                      {file.description && ` — ${file.description}`}
                    </p>
                    <p className="text-xs text-gray-400">
                      Uploaded by {file.uploadedBy?.name || 'Unknown'} •{' '}
                      {format(new Date(file.createdAt), 'MMM d, yyyy')}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" asChild>
                    <a href={handleDownload(file.filePath, file.fileName)} download={file.fileName}>
                      <Download className="h-4 w-4 mr-1" />
                      Download
                    </a>
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Activity Log */}
        {request.activities && request.activities.length > 0 && (
          <div className="bg-white rounded-lg border p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <History className="h-5 w-5" />
              Activity History
            </h2>
            <div className="space-y-4">
              {request.activities.map((activity) => (
                <div key={activity.id} className="flex gap-3">
                  <div className="flex-shrink-0 w-2.5 h-2.5 mt-1.5 rounded-full bg-blue-500" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{formatActionLabel(activity.action)}</p>
                    {activity.comments && (
                      <p className="text-sm text-gray-600 mt-1">{activity.comments}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-1">
                      {activity.user.name} •{' '}
                      {format(new Date(activity.createdAt), 'MMM d, yyyy • h:mm a')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer with Back Button */}
        <div className="flex justify-center pt-4">
          <Link href="/dashboard">
            <Button variant="outline" size="lg">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Dashboard
            </Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
