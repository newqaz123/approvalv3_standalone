'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import {
  X,
  Download,
  Info,
  Paperclip,
  TrendingUp,
  Lock,
  History,
  FileImage,
  FileSpreadsheet,
  File,
  FileText,
  Check,
  Clock,
  Send,
  Activity,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  RotateCcw,
  ThumbsUp,
  ThumbsDown,
  MessageSquare,
  CheckCircle2,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

// Types
interface ApprovalStep {
  id: string
  name: string
  role: string
  status: 'submitted' | 'approved' | 'pending' | 'rejected'
  comment: string
  timestamp: string
  avatar?: string
}

interface ApprovalStage {
  stageNumber: number
  stageName: string
  steps: ApprovalStep[]
}

interface FileAttachment {
  id: string
  fileName: string
  fileType: 'pdf' | 'image' | 'docx' | 'xlsx' | string
  description?: string
}

interface ActivityItem {
  id: string
  action: string
  user: string
  timestamp: string
  details?: string
}

interface RequestDetailData {
  id: string
  referenceId: string
  title: string
  status: 'request' | 'solution' | 'final_approval' | 'completed' | 'rejected'
  submitter: {
    name: string
    role: string
    email: string
    initials: string
  }
  requestDescription: string
  files: FileAttachment[]
  stages: ApprovalStage[]
  activities: ActivityItem[]
  lastModified: string
  // For solution status
  solution?: {
    description: string
    cost: number
    currency: string
    submittedBy: string
    submittedAt: string
    files?: FileAttachment[]
  }
  // For rejection info
  rejection?: {
    reason: string
    rejectedBy: string
    rejectedAt: string
  }
}

interface StatusModalProps {
  data: RequestDetailData
  open: boolean
  onOpenChange: (open: boolean) => void
  onDownloadFile?: (fileId: string) => void
  onApprove?: () => void
  onReject?: (reason: string) => void
  onResubmit?: () => void
}

// Status configs
const statusConfig = {
  request: {
    label: 'Request Submitted',
    className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    dotClass: 'bg-blue-500',
  },
  solution: {
    label: 'Solution Submitted',
    className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    dotClass: 'bg-purple-500',
  },
  final_approval: {
    label: 'Final Approval',
    className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    dotClass: 'bg-amber-500',
  },
  completed: {
    label: 'Completed',
    className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    dotClass: 'bg-emerald-500',
  },
  rejected: {
    label: 'Rejected',
    className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    dotClass: 'bg-red-500',
  },
}

const stepStatusConfig = {
  submitted: { 
    label: 'SUBMITTED', 
    className: 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400',
  },
  approved: { 
    label: 'APPROVED', 
    className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400',
  },
  pending: { 
    label: 'PENDING', 
    className: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
  },
  rejected: {
    label: 'REJECTED',
    className: 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400',
  },
}

// File icon helper
function getFileIcon(fileType: string) {
  switch (fileType.toLowerCase()) {
    case 'pdf':
      return <div className="shrink-0 size-8 rounded bg-red-50 dark:bg-red-900/20 flex items-center justify-center text-red-600"><FileText className="w-4 h-4" /></div>
    case 'image':
    case 'png':
    case 'jpg':
    case 'jpeg':
      return <div className="shrink-0 size-8 rounded bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center text-blue-600"><FileImage className="w-4 h-4" /></div>
    case 'docx':
    case 'doc':
      return <div className="shrink-0 size-8 rounded bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-400"><File className="w-4 h-4" /></div>
    case 'xlsx':
    case 'xls':
      return <div className="shrink-0 size-8 rounded bg-green-50 dark:bg-green-900/20 flex items-center justify-center text-green-600"><FileSpreadsheet className="w-4 h-4" /></div>
    default:
      return <div className="shrink-0 size-8 rounded bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-400"><File className="w-4 h-4" /></div>
  }
}

// Avatar components
function ApprovedAvatar() {
  return (
    <div className="shrink-0 size-7 rounded-full bg-emerald-500 flex items-center justify-center text-white shadow-md">
      <Check className="w-4 h-4 stroke-[3]" />
    </div>
  )
}

function PendingAvatar() {
  return (
    <div className="shrink-0 size-7 rounded-full bg-slate-100 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-400 shadow-sm">
      <Clock className="w-4 h-4" />
    </div>
  )
}

function SubmittedAvatar({ initials }: { initials: string }) {
  return (
    <div className="shrink-0 size-7 rounded-full bg-blue-100 dark:bg-blue-900/30 border-2 border-blue-200 dark:border-blue-800 flex items-center justify-center text-blue-600 dark:text-blue-400 text-[10px] font-bold shadow-sm">
      {initials}
    </div>
  )
}

function RejectedAvatar() {
  return (
    <div className="shrink-0 size-7 rounded-full bg-red-100 dark:bg-red-900/30 border-2 border-red-200 dark:border-red-800 flex items-center justify-center text-red-600 shadow-sm">
      <ThumbsDown className="w-3.5 h-3.5" />
    </div>
  )
}

// Retractable Activity Timeline Component
function RetractableActivityTimeline({ activities }: { activities: ActivityItem[] }) {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <div className="bg-slate-50/80 dark:bg-slate-800/30 rounded-xl border border-slate-100 dark:border-slate-800/60 overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-100/50 dark:hover:bg-slate-800/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-slate-400" />
          <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
            Activity Timeline
          </span>
          <span className="text-xs text-slate-400">({activities.length} events)</span>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-slate-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-400" />
        )}
      </button>
      
      {isExpanded && (
        <div className="px-4 pb-4">
          <div className="space-y-0">
            {activities.map((activity, index) => (
              <div key={activity.id} className="relative pl-6 pb-4 last:pb-0">
                {index < activities.length - 1 && (
                  <div className="absolute left-2 top-4 bottom-0 w-0.5 bg-slate-200 dark:bg-slate-700" />
                )}
                <div className="absolute left-0 top-1 size-4 rounded-full bg-slate-300 dark:bg-slate-600 border-2 border-white dark:border-slate-800" />
                
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                  <div>
                    <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      {activity.user}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400"> • {activity.action}</span>
                    {activity.details && (
                      <p className="text-xs text-slate-400 italic mt-1">{activity.details}</p>
                    )}
                  </div>
                  <span className="text-[11px] text-slate-400 shrink-0">
                    {format(new Date(activity.timestamp), 'MMM d, yyyy • h:mm a')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Rejection Banner Component
function RejectionBanner({ 
  rejection, 
  onResubmit 
}: { 
  rejection: { reason: string; rejectedBy: string; rejectedAt: string }
  onResubmit?: () => void 
}) {
  return (
    <div className="bg-red-50 dark:bg-red-900/10 rounded-xl p-4 border border-red-200 dark:border-red-800/30 mb-4">
      <div className="flex items-start gap-3">
        <div className="shrink-0 size-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
          <AlertTriangle className="w-4 h-4 text-red-600" />
        </div>
        <div className="flex-1">
          <h4 className="text-sm font-bold text-red-900 dark:text-red-400">
            Request Rejected
          </h4>
          <p className="text-xs text-red-600 dark:text-red-300 mt-1">
            Rejected by {rejection.rejectedBy} on {format(new Date(rejection.rejectedAt), 'MMM d, yyyy')}
          </p>
          <div className="mt-2 p-2 bg-white dark:bg-slate-900 rounded border border-red-100 dark:border-red-800/30">
            <p className="text-xs text-slate-700 dark:text-slate-300 italic">
              &ldquo;{rejection.reason}&rdquo;
            </p>
          </div>
          {onResubmit && (
            <Button 
              onClick={onResubmit}
              className="mt-3 bg-red-600 hover:bg-red-700 text-white"
              size="sm"
            >
              <RotateCcw className="w-4 h-4 mr-1.5" />
              Resubmit Request
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

// Approval Actions Component
function ApprovalActions({ 
  onApprove, 
  onReject,
  type = 'request'
}: { 
  onApprove?: () => void
  onReject?: (reason: string) => void
  type?: 'request' | 'solution' | 'final'
}) {
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const typeLabels = {
    request: 'Request',
    solution: 'Solution',
    final: 'Final Approval'
  }

  if (showRejectForm) {
    return (
      <div className="space-y-3 rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/10 dark:border-red-800/30 p-4">
        <div className="flex items-center gap-2">
          <ThumbsDown className="w-5 h-5 text-red-600" />
          <h4 className="font-bold text-red-900 dark:text-red-400">
            Reject {typeLabels[type]}
          </h4>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold text-red-900 dark:text-red-400">
            Rejection Reason *
          </label>
          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder={`Please explain why you're rejecting this ${typeLabels[type].toLowerCase()}...`}
            rows={3}
            className="bg-white dark:bg-slate-900 text-sm"
          />
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setShowRejectForm(false)
              setRejectReason('')
            }}
            size="sm"
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (rejectReason.trim()) {
                setIsSubmitting(true)
                onReject?.(rejectReason)
                setIsSubmitting(false)
                setShowRejectForm(false)
                setRejectReason('')
              }
            }}
            disabled={!rejectReason.trim() || isSubmitting}
            className="bg-red-600 hover:bg-red-700 text-white"
            size="sm"
          >
            {isSubmitting ? 'Rejecting...' : 'Confirm Rejection'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50 dark:bg-blue-900/10 dark:border-blue-800/30 p-4">
      <div className="flex items-center gap-2">
        <ThumbsUp className="w-5 h-5 text-blue-600" />
        <h4 className="font-bold text-blue-900 dark:text-blue-400">
          Your Approval Needed
        </h4>
      </div>
      <p className="text-xs text-blue-700 dark:text-blue-300">
        This {typeLabels[type].toLowerCase()} requires your approval to proceed.
      </p>
      <div className="flex gap-2">
        <Button
          onClick={onApprove}
          className="bg-emerald-500 hover:bg-emerald-600 text-white"
          size="sm"
        >
          <Check className="w-4 h-4 mr-1.5" />
          Approve
        </Button>
        <Button
          onClick={() => setShowRejectForm(true)}
          variant="outline"
          className="border-red-300 text-red-700 hover:bg-red-50"
          size="sm"
        >
          <ThumbsDown className="w-4 h-4 mr-1.5" />
          Reject
        </Button>
      </div>
    </div>
  )
}

// Main Status Modal Component
export function StatusModal({
  data,
  open,
  onOpenChange,
  onDownloadFile,
  onDownloadSolutionFile,
  onApprove,
  onReject,
  onResubmit,
}: StatusModalProps & { onDownloadSolutionFile?: (fileId: string) => void }) {
  const status = statusConfig[data.status]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        className="max-w-5xl w-full max-h-[90vh] p-0 gap-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl rounded-xl overflow-hidden"
      >
        {/* Header with X button - Ref ID removed */}
        <DialogHeader className="flex-shrink-0 px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-20">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-3">
                <DialogTitle className="text-lg font-bold text-slate-900 dark:text-slate-100 tracking-tight m-0">
                  {data.title}
                </DialogTitle>
                <span className={cn(
                  "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wider",
                  status.className
                )}>
                  <span className={cn("size-2 rounded-full mr-1.5", status.dotClass)} />
                  {status.label}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 pr-4 border-r border-slate-100 dark:border-slate-800 mr-2">
                <div className="size-8 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400 font-bold text-xs">
                  {data.submitter.initials}
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-bold text-slate-900 dark:text-slate-100 leading-tight">
                    {data.submitter.name}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400 leading-tight">
                    {data.submitter.role} • {data.submitter.email}
                  </span>
                </div>
              </div>
              {/* X Close Button */}
              <button
                onClick={() => onOpenChange(false)}
                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </DialogHeader>

        {/* Scrollable Content - Fixed scroll */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6" style={{ maxHeight: 'calc(90vh - 140px)' }}>
          {/* Rejection Banner - if rejected */}
          {data.rejection && (
            <RejectionBanner rejection={data.rejection} onResubmit={onResubmit} />
          )}

          {/* Solution Section - for solution/final/completed status */}
          {(data.status === 'solution' || data.status === 'final_approval' || data.status === 'completed') && data.solution && (
            <section className="bg-purple-50/60 dark:bg-purple-900/10 rounded-xl p-5 border border-purple-200/60 dark:border-purple-800/30">
              <div className="flex justify-between items-start mb-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-purple-600" />
                  Engineering Solution
                </h3>
                <div className="text-right">
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Cost</p>
                  <p className="text-lg font-black text-slate-900 dark:text-slate-100">
                    {new Intl.NumberFormat('en-US', {
                      style: 'currency',
                      currency: data.solution.currency || 'USD',
                    }).format(data.solution.cost)}
                  </p>
                </div>
              </div>
              <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed mb-3">
                {data.solution.description}
              </p>
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Submitted by {data.solution.submittedBy}</span>
                <span>{format(new Date(data.solution.submittedAt), 'MMM d, yyyy')}</span>
              </div>
            </section>
          )}

          {/* Request Description */}
          <section>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-3 flex items-center gap-2">
              <Info className="w-4 h-4 text-slate-400" />
              Request Description
            </h3>
            <div className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed bg-slate-50/70 dark:bg-slate-800/30 rounded-xl p-4 border border-slate-100 dark:border-slate-800">
              <p>{data.requestDescription}</p>
            </div>
          </section>

          {/* Separated Attachments Section */}
          <section>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-3 flex items-center gap-2">
              <Paperclip className="w-4 h-4 text-slate-400" />
              Attached Documentation
            </h3>
            
            {/* Initial Request Attachments */}
            {data.files.length > 0 && (
              <div className="mb-4">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Initial Request Attachments ({data.files.length})
                </h4>
                <div className="grid grid-cols-1 gap-2">
                  {data.files.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center p-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 hover:border-emerald-400 dark:hover:border-emerald-600 transition-colors group relative gap-3"
                    >
                      {getFileIcon(file.fileType)}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                          {file.fileName}
                        </p>
                        {file.description && (
                          <p className="text-[10px] text-slate-400 truncate">
                            &ldquo;{file.description}&rdquo;
                          </p>
                        )}
                      </div>
                      {onDownloadFile && (
                        <button
                          onClick={() => onDownloadFile(file.id)}
                          className="p-2 text-slate-400 hover:text-emerald-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
                          title="Download"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Engineering Solution Attachments */}
            {data.solution?.files && data.solution.files.length > 0 && (
              <div>
                <h4 className="text-xs font-bold text-purple-600 uppercase tracking-wider mb-2">
                  Engineering Solution Attachments ({data.solution.files.length})
                </h4>
                <div className="grid grid-cols-1 gap-2">
                  {data.solution.files.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center p-3 border border-purple-200 dark:border-purple-800/30 rounded-lg bg-purple-50/30 dark:bg-purple-900/10 hover:border-purple-400 dark:hover:border-purple-600 transition-colors group relative gap-3"
                    >
                      {getFileIcon(file.fileType)}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                          {file.fileName}
                        </p>
                        {file.description && (
                          <p className="text-[10px] text-slate-400 truncate">
                            &ldquo;{file.description}&rdquo;
                          </p>
                        )}
                      </div>
                      {onDownloadSolutionFile && (
                        <button
                          onClick={() => onDownloadSolutionFile(file.id)}
                          className="p-2 text-slate-400 hover:text-purple-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
                          title="Download"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          <Separator className="bg-slate-200 dark:bg-slate-700" />

          {/* Approval Flow */}
          <section>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-slate-400" />
              Approval Flow
            </h3>
            <div className="flex flex-col gap-4">
              {data.stages.map((stage) => (
                <div
                  key={stage.stageNumber}
                  className="flex flex-col sm:flex-row items-start gap-4 p-4 rounded-xl bg-slate-50/80 dark:bg-slate-800/30 border border-slate-100 dark:border-slate-800/60"
                >
                  <div className="w-full sm:w-28 shrink-0 pt-1 flex flex-row sm:flex-col justify-between sm:justify-start items-center sm:items-start border-b sm:border-b-0 border-slate-200 dark:border-slate-700 pb-2 sm:pb-0 mb-2 sm:mb-0">
                    <div>
                      <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        Stage {stage.stageNumber}
                      </h4>
                      <p className="text-xs text-slate-400 leading-tight mt-0.5">{stage.stageName}</p>
                    </div>
                  </div>

                  <div className="flex-1 w-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {stage.steps.map((step) => {
                      const stepStatus = stepStatusConfig[step.status]
                      const isPending = step.status === 'pending'
                      const isApproved = step.status === 'approved'
                      const isSubmitted = step.status === 'submitted'
                      const isRejected = step.status === 'rejected'

                      return (
                        <div
                          key={step.id}
                          className={cn(
                            "flex gap-3 items-start bg-white dark:bg-slate-900/60 p-3 rounded-lg border shadow-sm",
                            isPending
                              ? "border-slate-100 dark:border-slate-800/80 opacity-60"
                              : isRejected
                                ? "border-red-100 dark:border-red-800/30"
                                : "border-slate-100 dark:border-slate-800/80"
                          )}
                        >
                          {isApproved ? (
                            <ApprovedAvatar />
                          ) : isPending ? (
                            <PendingAvatar />
                          ) : isRejected ? (
                            <RejectedAvatar />
                          ) : (
                            <SubmittedAvatar initials={step.avatar || step.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()} />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                                {step.name}
                              </span>
                              <span className={cn(
                                "text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0",
                                stepStatus.className
                              )}>
                                {stepStatus.label}
                              </span>
                            </div>
                            <span className="text-xs text-slate-400 block">{step.role}</span>
                            <p className="mt-2 text-xs text-slate-600 dark:text-slate-400 italic leading-relaxed">
                              &ldquo;{step.comment}&rdquo;
                            </p>
                            <div className="mt-2 text-[11px] text-slate-400 text-right">
                              {step.timestamp !== '-' ? format(new Date(step.timestamp), 'MMM d, h:mm a') : '-'}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Approval Actions - only show for pending/relevant statuses */}
          {(data.status === 'request' || data.status === 'solution' || data.status === 'final_approval') && (
            <ApprovalActions
              onApprove={onApprove}
              onReject={onReject}
              type={data.status === 'final_approval' ? 'final' : data.status}
            />
          )}

          <Separator className="bg-slate-200 dark:bg-slate-700" />

          {/* Retractable Activity Timeline */}
          <RetractableActivityTimeline activities={data.activities} />
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-400 font-medium shrink-0">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5" />
              Secure Read-Only
            </span>
            <span className="flex items-center gap-1.5">
              <History className="w-3.5 h-3.5" />
              Last Modified: {format(new Date(data.lastModified), 'MMM d, yyyy')}
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
