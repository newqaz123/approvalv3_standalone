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
  CheckCircle2,
  DollarSign,
  Clock3,
  Shield,
  MessageSquare,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
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
  stageNumber: string | number
  stageName: string
  submittedBy?: string
  submittedAt?: string
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

interface ApproverModalProps {
  mode: 'request' | 'solution' | 'final'
  open: boolean
  onOpenChange: (open: boolean) => void
  data: {
    id: string
    referenceId: string
    title: string
    status: 'request' | 'solution' | 'solution_rejected' | 'final_approval' | 'final_rejected'
    submitter: {
      name: string
      role: string
      email: string
      initials: string
    }
    requestDescription: string
    solution?: {
      title: string
      description: string
      cost: number
      currency: string
      timeline?: string
      submittedBy: string
      submittedAt: string
      files?: FileAttachment[]
    }
    requestFiles: FileAttachment[]
    stages: ApprovalStage[]
    activities: ActivityItem[]
    lastModified: string
    rejection?: {
      reason: string
      rejectedBy: string
      rejectedAt: string
    }
    finalApproval?: {
      initiatedBy: string
      initiatedAt: string
      currentLevel: number
      totalLevels: number
      nextApprover?: string
    }
  }
  canApprove?: boolean
  onApprove?: (comment: string) => void
  onReject?: (reason: string) => void
  onDownloadRequestFile?: (fileId: string) => void
  onDownloadSolutionFile?: (fileId: string) => void
}

// File icon helper
function getFileIcon(fileType: string) {
  switch (fileType) {
    case 'pdf':
      return <FileText className="w-5 h-5 text-red-500" />
    case 'image':
      return <FileImage className="w-5 h-5 text-purple-500" />
    case 'xlsx':
      return <FileSpreadsheet className="w-5 h-5 text-emerald-500" />
    case 'docx':
      return <FileText className="w-5 h-5 text-blue-500" />
    default:
      return <File className="w-5 h-5 text-slate-400" />
  }
}

// Step status configs
const stepStatusConfig = {
  submitted: { label: 'Submitted', className: 'bg-slate-100 text-slate-700' },
  approved: { label: 'Approved', className: 'bg-emerald-100 text-emerald-700' },
  pending: { label: 'Pending', className: 'bg-amber-100 text-amber-700' },
  rejected: { label: 'Rejected', className: 'bg-red-100 text-red-700' },
}

// Status configs
const statusConfig = {
  request: { label: 'Request', className: 'bg-blue-100 text-blue-700', dotClass: 'bg-blue-500' },
  solution: { label: 'Solution', className: 'bg-purple-100 text-purple-700', dotClass: 'bg-purple-500' },
  solution_rejected: { label: 'Solution Rejected', className: 'bg-red-100 text-red-700', dotClass: 'bg-red-500' },
  final_approval: { label: 'Final Approval', className: 'bg-amber-100 text-amber-700', dotClass: 'bg-amber-500' },
  final_rejected: { label: 'Final Rejected', className: 'bg-red-100 text-red-700', dotClass: 'bg-red-500' },
}

// Avatar components
function ApprovedAvatar() {
  return (
    <div className="shrink-0 size-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
      <Check className="w-4 h-4 text-emerald-600" />
    </div>
  )
}

function PendingAvatar() {
  return (
    <div className="shrink-0 size-8 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
      <Clock className="w-4 h-4 text-amber-600" />
    </div>
  )
}

function RejectedAvatar() {
  return (
    <div className="shrink-0 size-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
      <ThumbsDown className="w-4 h-4 text-red-600" />
    </div>
  )
}

function SubmittedAvatar({ initials }: { initials: string }) {
  return (
    <div className="shrink-0 size-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-600 dark:text-slate-400">
      {initials}
    </div>
  )
}

// Retractable Activity Timeline
function RetractableActivityTimeline({ activities }: { activities: ActivityItem[] }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-slate-500" />
          <span className="text-sm font-bold text-slate-700 dark:text-slate-300">Activity Timeline</span>
          <span className="text-xs text-slate-400">({activities.length})</span>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>

      {expanded && (
        <div className="p-4 space-y-3">
          {activities.map((activity, index) => (
            <div key={activity.id} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className="size-2 rounded-full bg-slate-300 dark:bg-slate-700" />
                {index !== activities.length - 1 && (
                  <div className="w-px flex-1 bg-slate-200 dark:bg-slate-700 my-1" />
                )}
              </div>
              <div className="flex-1 pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      {activity.action}
                    </p>
                    {activity.details && (
                      <p className="text-xs text-slate-500 mt-0.5">{activity.details}</p>
                    )}
                  </div>
                  <span className="text-xs text-slate-400 shrink-0">
                    {format(new Date(activity.timestamp), 'MMM d, h:mm a')}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">by {activity.user}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Approval Actions Component
function ApprovalActions({
  mode,
  onApprove,
  onReject,
}: {
  mode: 'request' | 'solution' | 'final'
  onApprove?: (comment: string) => void
  onReject?: (reason: string) => void
}) {
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [showApproveForm, setShowApproveForm] = useState(false)
  const [comment, setComment] = useState('')
  const [rejectReason, setRejectReason] = useState('')

  if (showRejectForm) {
    return (
      <div className="space-y-3 rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/10 dark:border-red-800/30 p-4">
        <div className="flex items-center gap-2">
          <ThumbsDown className="w-5 h-5 text-red-600" />
          <h4 className="font-bold text-red-900 dark:text-red-400">
            Reject {mode === 'final' ? 'Final Approval' : mode === 'solution' ? 'Solution' : 'Request'}
          </h4>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold text-red-900 dark:text-red-400">
            Rejection Reason <span className="text-red-500">*</span>
          </label>
          <Textarea
            value={rejectReason}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setRejectReason(e.target.value)}
            placeholder="Please explain the reason for rejection..."
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
                onReject?.(rejectReason)
                setShowRejectForm(false)
                setRejectReason('')
              }
            }}
            disabled={!rejectReason.trim()}
            className="bg-red-600 hover:bg-red-700 text-white"
            size="sm"
          >
            Confirm Rejection
          </Button>
        </div>
      </div>
    )
  }

  if (showApproveForm) {
    return (
      <div className={cn(
        "space-y-3 rounded-xl border p-4",
        mode === 'final'
          ? "border-amber-200 bg-amber-50 dark:bg-amber-900/10 dark:border-amber-800/30"
          : "border-emerald-200 bg-emerald-50 dark:bg-emerald-900/10 dark:border-emerald-800/30"
      )}>
        <div className="flex items-center gap-2">
          <ThumbsUp className={cn("w-5 h-5", mode === 'final' ? "text-amber-600" : "text-emerald-600")} />
          <h4 className={cn(
            "font-bold",
            mode === 'final' ? "text-amber-900 dark:text-amber-400" : "text-emerald-900 dark:text-emerald-400"
          )}>
            Approve {mode === 'final' ? 'Final Approval' : mode === 'solution' ? 'Solution' : 'Request'}
          </h4>
        </div>
        <div className="space-y-2">
          <label className={cn(
            "text-xs font-bold",
            mode === 'final' ? "text-amber-900 dark:text-amber-400" : "text-emerald-900 dark:text-emerald-400"
          )}>
            Approval Comment
          </label>
          <Textarea
            value={comment}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setComment(e.target.value)}
            placeholder="Add an optional comment for your approval..."
            rows={3}
            className="bg-white dark:bg-slate-900 text-sm"
          />
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setShowApproveForm(false)
              setComment('')
            }}
            size="sm"
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              onApprove?.(comment)
              setShowApproveForm(false)
              setComment('')
            }}
            className={cn(
              "text-white",
              mode === 'final'
                ? "bg-amber-600 hover:bg-amber-700"
                : "bg-emerald-600 hover:bg-emerald-700"
            )}
            size="sm"
          >
            Confirm Approval
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className={cn(
      "rounded-xl border p-4",
      mode === 'final'
        ? "border-amber-200 bg-amber-50 dark:bg-amber-900/10 dark:border-amber-800/30"
        : "border-slate-200 bg-slate-50 dark:bg-slate-800/50 dark:border-slate-800"
    )}>
      <div className="flex items-center gap-2 mb-3">
        {mode === 'final' ? (
          <Shield className="w-5 h-5 text-amber-600" />
        ) : (
          <MessageSquare className="w-5 h-5 text-slate-500" />
        )}
        <h4 className={cn(
          "font-bold",
          mode === 'final' ? "text-amber-900 dark:text-amber-400" : "text-slate-900 dark:text-slate-100"
        )}>
          {mode === 'final' ? 'Final Approval Required' : 'Review Decision'}
        </h4>
      </div>
      <div className="flex gap-2">
        <Button
          onClick={() => setShowApproveForm(true)}
          className={cn(
            "text-white",
            mode === 'final'
              ? "bg-amber-600 hover:bg-amber-700"
              : "bg-emerald-600 hover:bg-emerald-700"
          )}
          size="sm"
        >
          <ThumbsUp className="w-4 h-4 mr-1.5" />
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

// Main Approver Modal Component
export function ApproverModal({
  mode,
  open,
  onOpenChange,
  data,
  canApprove = false,
  onApprove,
  onReject,
  onDownloadRequestFile,
  onDownloadSolutionFile,
}: ApproverModalProps) {
  const status = statusConfig[data.status] || statusConfig.request

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-full max-h-[90vh] p-0 gap-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl rounded-xl overflow-hidden">
        {/* Header */}
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
              <button
                onClick={() => onOpenChange(false)}
                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </DialogHeader>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6" style={{ maxHeight: 'calc(90vh - 140px)' }}>
          {/* Rejection Banner */}
          {data.rejection && (
            <div className="bg-red-50 dark:bg-red-900/10 rounded-xl p-4 border border-red-200 dark:border-red-800/30">
              <div className="flex items-start gap-3">
                <div className="shrink-0 size-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                  <AlertTriangle className="w-4 h-4 text-red-600" />
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-bold text-red-900 dark:text-red-400">
                    {mode === 'final' ? 'Final Approval Rejected' : mode === 'solution' ? 'Solution Rejected' : 'Request Rejected'}
                  </h4>
                  <p className="text-xs text-red-600 dark:text-red-300 mt-1">
                    Rejected by {data.rejection.rejectedBy} on {format(new Date(data.rejection.rejectedAt), 'MMM d, yyyy')}
                  </p>
                  <div className="mt-2 p-2 bg-white dark:bg-slate-900 rounded border border-red-100 dark:border-red-800/30">
                    <p className="text-xs text-slate-700 dark:text-slate-300 italic">
                      &ldquo;{data.rejection.reason}&rdquo;
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Solution Section (for solution/final modes) */}
          {data.solution && (mode === 'solution' || mode === 'final') && (
            <section className={cn(
              "rounded-xl p-5 border",
              mode === 'final'
                ? "bg-amber-50/60 dark:bg-amber-900/10 border-amber-200/60 dark:border-amber-800/30"
                : "bg-purple-50/60 dark:bg-purple-900/10 border-purple-200/60 dark:border-purple-800/30"
            )}>
              <div className="flex justify-between items-start mb-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <CheckCircle2 className={cn("w-5 h-5", mode === 'final' ? "text-amber-600" : "text-purple-600")} />
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
              {/* Timeline Display */}
              {data.solution.timeline && (
                <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 mb-3">
                  <Clock3 className="w-4 h-4 text-slate-400" />
                  <span className="font-medium">Timeline:</span>
                  <span>{data.solution.timeline}</span>
                </div>
              )}
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Submitted by {data.solution.submittedBy}</span>
                <span>{format(new Date(data.solution.submittedAt), 'MMM d, yyyy')}</span>
              </div>
            </section>
          )}

          {/* Final Approval Status */}
          {mode === 'final' && data.finalApproval && (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-amber-200 dark:border-amber-800/30 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Shield className="w-5 h-5 text-amber-600" />
                <h4 className="font-bold text-slate-900 dark:text-slate-100">Final Approval Status</h4>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs text-slate-500">Initiated By</p>
                  <p className="font-medium">{data.finalApproval.initiatedBy}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Initiated Date</p>
                  <p className="font-medium">{format(new Date(data.finalApproval.initiatedAt), 'MMM d, yyyy')}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Progress</p>
                  <p className="font-medium">Level {data.finalApproval.currentLevel} of {data.finalApproval.totalLevels}</p>
                </div>
                {data.finalApproval.nextApprover && (
                  <div>
                    <p className="text-xs text-slate-500">Waiting For</p>
                    <p className="font-medium text-amber-600">{data.finalApproval.nextApprover}</p>
                  </div>
                )}
              </div>
            </div>
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

          {/* Attachments Section */}
          <section>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-3 flex items-center gap-2">
              <Paperclip className="w-4 h-4 text-slate-400" />
              Attached Documentation
            </h3>

            {/* Request Attachments */}
            {data.requestFiles.length > 0 && (
              <div className="mb-4">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Initial Request Attachments ({data.requestFiles.length})
                </h4>
                <div className="grid grid-cols-1 gap-2">
                  {data.requestFiles.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center p-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 hover:border-slate-400 dark:hover:border-slate-600 transition-colors group relative gap-3"
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
                      {onDownloadRequestFile && (
                        <button
                          onClick={() => onDownloadRequestFile(file.id)}
                          className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
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

            {/* Solution Attachments */}
            {data.solution?.files && data.solution.files.length > 0 && (
              <div>
                <h4 className={cn(
                  "text-xs font-bold uppercase tracking-wider mb-2",
                  mode === 'final' ? "text-amber-600" : "text-purple-600"
                )}>
                  Engineering Solution Attachments ({data.solution.files.length})
                </h4>
                <div className="grid grid-cols-1 gap-2">
                  {data.solution.files.map((file) => (
                    <div
                      key={file.id}
                      className={cn(
                        "flex items-center p-3 border rounded-lg transition-colors group relative gap-3",
                        mode === 'final'
                          ? "border-amber-200 dark:border-amber-800/30 bg-amber-50/30 dark:bg-amber-900/10 hover:border-amber-400"
                          : "border-purple-200 dark:border-purple-800/30 bg-purple-50/30 dark:bg-purple-900/10 hover:border-purple-400"
                      )}
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
                          className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
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
              {mode === 'final' ? 'Final Approval Chain' : 'Approval Flow'}
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
                      {stage.submittedBy && (
                        <p className="text-[10px] text-slate-400 leading-tight mt-1.5">
                          by {stage.submittedBy}
                        </p>
                      )}
                      {stage.submittedAt && (
                        <p className="text-[10px] text-slate-400 leading-tight">
                          {format(new Date(stage.submittedAt), 'MMM d, h:mm a')}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex-1 w-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {stage.steps.map((step) => {
                      const stepStatus = stepStatusConfig[step.status]
                      const isPending = step.status === 'pending'
                      const isApproved = step.status === 'approved'
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

          {/* Approval Actions */}
          {canApprove && !data.rejection && (
            <ApprovalActions
              mode={mode}
              onApprove={onApprove}
              onReject={onReject}
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
