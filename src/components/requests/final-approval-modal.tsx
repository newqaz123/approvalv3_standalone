'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import {
  X,
  Download,
  Eye,
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
  Users,
  Settings2,
  Plus,
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  UserCheck,
  Shield,
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

interface User {
  id: string
  name: string
  email: string
  role: string
  level?: number
}

interface FinalApprovalModalProps {
  data: {
    id: string
    referenceId: string
    title: string
    status: 'final_approval' | 'final_rejected'
    submitter: {
      name: string
      role: string
      email: string
      initials: string
    }
    requestDescription: string
    solution: {
      description: string
      cost: number
      currency: string
      submittedBy: string
      submittedAt: string
      files?: FileAttachment[]
    }
    requestFiles: FileAttachment[]
    stages: ApprovalStage[]
    activities: ActivityItem[]
    lastModified: string
    finalApproval?: {
      initiatedBy: string
      initiatedAt: string
      currentLevel: number
      totalLevels: number
      nextApprover?: string
    }
    rejection?: {
      reason: string
      rejectedBy: string
      rejectedAt: string
    }
  }
  open: boolean
  onOpenChange: (open: boolean) => void
  onDownloadFile?: (fileId: string) => void
  onDownloadSolutionFile?: (fileId: string) => void
  onPreviewFile?: (fileId: string) => void
  onPreviewSolutionFile?: (fileId: string) => void
  onApprove?: () => void
  onReject?: (reason: string) => void
  onInitiateFinalApproval?: (useCustom: boolean, customApprovers?: string[]) => void
  onRestartFinalApproval?: () => void
  availableUsers?: User[]
  canInitiate?: boolean
  canApprove?: boolean
  subTasksElement?: React.ReactNode
}

// Status configs
const statusConfig = {
  final_approval: {
    label: 'Final Approval',
    className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    dotClass: 'bg-amber-500',
  },
  final_rejected: {
    label: 'Final Approval Rejected',
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
      return <div className="shrink-0 size-8 rounded bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center text-blue-600"><FileImage className="w-4 h-4" /></div>
    case 'docx':
      return <div className="shrink-0 size-8 rounded bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-400"><File className="w-4 h-4" /></div>
    case 'xlsx':
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

// Retractable Activity Timeline
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

// Initiate Final Approval Component with Custom Hierarchy
function InitiateFinalApproval({
  onInitiate,
  availableUsers = []
}: {
  onInitiate?: (useCustom: boolean, customApprovers?: string[]) => void
  availableUsers?: User[]
}) {
  const [useCustom, setUseCustom] = useState(false)
  const [customApprovers, setCustomApprovers] = useState<string[]>([])
  const [isExpanded, setIsExpanded] = useState(true)

  const selectedUsers = customApprovers
    .map(id => availableUsers.find(u => u.id === id))
    .filter((u): u is User => u !== undefined)

  const availableUsersFiltered = availableUsers.filter(u => !customApprovers.includes(u.id))

  return (
    <div className="bg-amber-50/80 dark:bg-amber-900/10 rounded-xl border border-amber-200 dark:border-amber-800/30 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Shield className="w-5 h-5 text-amber-600" />
        <h4 className="font-bold text-amber-900 dark:text-amber-400">
          Initiate Final Department Approval
        </h4>
      </div>
      <p className="text-xs text-amber-700 dark:text-amber-300 mb-4">
        Route this solution through the final department approval chain. Choose to use the default hierarchy or set a custom approval chain.
      </p>

      {/* Default vs Custom Toggle */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setUseCustom(false)}
          className={cn(
            "flex-1 p-3 rounded-lg border-2 text-left transition-colors",
            !useCustom
              ? "border-amber-500 bg-amber-100/50 dark:bg-amber-900/20"
              : "border-slate-200 hover:border-slate-300 dark:border-slate-700"
          )}
        >
          <div className="font-medium text-sm">Default Hierarchy</div>
          <div className="text-xs text-slate-500 mt-1">Use configured department levels</div>
        </button>
        <button
          onClick={() => setUseCustom(true)}
          className={cn(
            "flex-1 p-3 rounded-lg border-2 text-left transition-colors",
            useCustom
              ? "border-amber-500 bg-amber-100/50 dark:bg-amber-900/20"
              : "border-slate-200 hover:border-slate-300 dark:border-slate-700"
          )}
        >
          <div className="font-medium text-sm">Custom Chain</div>
          <div className="text-xs text-slate-500 mt-1">Select specific approvers</div>
        </button>
      </div>

      {/* Custom Approver Selection */}
      {useCustom && (
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-3 mb-4">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Select Approvers (in order)</p>
          
          {/* Selected Users */}
          {selectedUsers.length > 0 && (
            <div className="space-y-2 mb-3">
              {selectedUsers.map((user, index) => (
                <div 
                  key={user.id} 
                  className="flex items-center gap-2 p-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg"
                >
                  <span className="text-xs font-bold text-slate-400 w-5">{index + 1}.</span>
                  <div className="size-6 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center text-amber-700 dark:text-amber-400 text-[10px] font-bold">
                    {user.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{user.name}</p>
                    <p className="text-xs text-slate-400">{user.role}</p>
                  </div>
                  <button
                    onClick={() => setCustomApprovers(customApprovers.filter(id => id !== user.id))}
                    className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 rounded"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add Users Dropdown */}
          {availableUsersFiltered.length > 0 && (
            <div className="relative">
              <select
                onChange={(e) => {
                  if (e.target.value) {
                    setCustomApprovers([...customApprovers, e.target.value])
                    e.target.value = ''
                  }
                }}
                className="w-full p-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900"
              >
                <option value="">+ Add an approver...</option>
                {availableUsersFiltered.map(user => (
                  <option key={user.id} value={user.id}>
                    {user.name} - {user.role}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Submit Button */}
      <Button
        onClick={() => onInitiate?.(useCustom, useCustom ? customApprovers : undefined)}
        disabled={useCustom && customApprovers.length === 0}
        className="w-full bg-amber-500 hover:bg-amber-600 text-white"
      >
        <UserCheck className="w-4 h-4 mr-2" />
        {useCustom 
          ? `Start Custom Approval Chain (${customApprovers.length} approvers)`
          : 'Start Final Approval (Default Hierarchy)'
        }
      </Button>
    </div>
  )
}

// Final Approval Actions Component
function FinalApprovalActions({ 
  onApprove, 
  onReject,
  currentLevel,
  totalLevels,
  nextApprover
}: { 
  onApprove?: () => void
  onReject?: (reason: string) => void
  currentLevel?: number
  totalLevels?: number
  nextApprover?: string
}) {
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (showRejectForm) {
    return (
      <div className="space-y-3 rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/10 dark:border-red-800/30 p-4">
        <div className="flex items-center gap-2">
          <ThumbsDown className="w-5 h-5 text-red-600" />
          <h4 className="font-bold text-red-900 dark:text-red-400">
            Reject Final Approval
          </h4>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold text-red-900 dark:text-red-400">
            Rejection Reason *
          </label>
          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Please explain why you're rejecting this final approval..."
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
    <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-900/10 dark:border-amber-800/30 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Shield className="w-5 h-5 text-amber-600" />
        <h4 className="font-bold text-amber-900 dark:text-amber-400">
          Final Approval Required
        </h4>
      </div>
      
      {currentLevel && totalLevels && (
        <div className="mb-3">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-amber-700 dark:text-amber-300">Approval Progress</span>
            <span className="font-bold text-amber-900 dark:text-amber-400">{currentLevel} / {totalLevels}</span>
          </div>
          <div className="h-2 bg-amber-200 dark:bg-amber-800/50 rounded-full overflow-hidden">
            <div 
              className="h-full bg-amber-500 rounded-full transition-all"
              style={{ width: `${(currentLevel / totalLevels) * 100}%` }}
            />
          </div>
        </div>
      )}

      {nextApprover && (
        <p className="text-xs text-amber-700 dark:text-amber-300 mb-3">
          Waiting for: <span className="font-bold">{nextApprover}</span>
        </p>
      )}

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

// Main Final Approval Modal Component
export function FinalApprovalModal({
  data,
  open,
  onOpenChange,
  onDownloadFile,
  onDownloadSolutionFile,
  onPreviewFile,
  onPreviewSolutionFile,
  onApprove,
  onReject,
  onInitiateFinalApproval,
  onRestartFinalApproval,
  availableUsers = [],
  canInitiate = false,
  canApprove = false,
  subTasksElement,
}: FinalApprovalModalProps) {
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

        {/* Scrollable Content - Fixed overflow */}
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
                    Final Approval Rejected
                  </h4>
                  <p className="text-xs text-red-600 dark:text-red-300 mt-1">
                    Rejected by {data.rejection.rejectedBy} on {format(new Date(data.rejection.rejectedAt), 'MMM d, yyyy')}
                  </p>
                  <div className="mt-2 p-2 bg-white dark:bg-slate-900 rounded border border-red-100 dark:border-red-800/30">
                    <p className="text-xs text-slate-700 dark:text-slate-300 italic">
                      &ldquo;{data.rejection.reason}&rdquo;
                    </p>
                  </div>
                  {onRestartFinalApproval && (
                    <Button 
                      onClick={onRestartFinalApproval}
                      className="mt-3 bg-amber-600 hover:bg-amber-700 text-white"
                      size="sm"
                    >
                      <RotateCcw className="w-4 h-4 mr-1.5" />
                      Restart Final Approval
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Solution Section */}
          <section className="bg-amber-50/60 dark:bg-amber-900/10 rounded-xl p-5 border border-amber-200/60 dark:border-amber-800/30">
            <div className="flex justify-between items-start mb-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-amber-600" />
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

          {/* Final Approval Status Info */}
          {data.finalApproval && (
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

          {/* Separated Attachments Section */}
          <section>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-3 flex items-center gap-2">
              <Paperclip className="w-4 h-4 text-slate-400" />
              Attached Documentation
            </h3>
            
            {/* Initial Request Attachments */}
            {data.requestFiles.length > 0 && (
              <div className="mb-4">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Initial Request Attachments ({data.requestFiles.length})
                </h4>
                <div className="grid grid-cols-1 gap-2">
                  {data.requestFiles.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center p-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 hover:border-amber-400 dark:hover:border-amber-600 transition-colors group relative gap-3"
                    >
                      {getFileIcon(file.fileType)}
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => onPreviewFile?.(file.id)}
                          className="block max-w-full truncate text-left text-xs font-bold text-slate-900 underline-offset-4 hover:text-amber-600 hover:underline focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 dark:text-slate-100"
                        >
                          {file.fileName}
                        </button>
                        {file.description && (
                          <p className="text-[10px] text-slate-400 truncate">
                            &ldquo;{file.description}&rdquo;
                          </p>
                        )}
                      </div>
                      {onPreviewFile && (
                        <button
                          onClick={() => onPreviewFile(file.id)}
                          className="p-2 text-slate-400 hover:text-amber-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
                          title="Preview"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      )}
                      {onDownloadFile && (
                        <button
                          onClick={() => onDownloadFile(file.id)}
                          className="p-2 text-slate-400 hover:text-amber-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
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
            {data.solution.files && data.solution.files.length > 0 && (
              <div>
                <h4 className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-2">
                  Engineering Solution Attachments ({data.solution.files.length})
                </h4>
                <div className="grid grid-cols-1 gap-2">
                  {data.solution.files.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center p-3 border border-amber-200 dark:border-amber-800/30 rounded-lg bg-amber-50/30 dark:bg-amber-900/10 hover:border-amber-400 dark:hover:border-amber-600 transition-colors group relative gap-3"
                    >
                      {getFileIcon(file.fileType)}
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => onPreviewSolutionFile?.(file.id)}
                          className="block max-w-full truncate text-left text-xs font-bold text-slate-900 underline-offset-4 hover:text-amber-600 hover:underline focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 dark:text-slate-100"
                        >
                          {file.fileName}
                        </button>
                        {file.description && (
                          <p className="text-[10px] text-slate-400 truncate">
                            &ldquo;{file.description}&rdquo;
                          </p>
                        )}
                      </div>
                      {onPreviewSolutionFile && (
                        <button
                          onClick={() => onPreviewSolutionFile(file.id)}
                          className="p-2 text-slate-400 hover:text-amber-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
                          title="Preview"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      )}
                      {onDownloadSolutionFile && (
                        <button
                          onClick={() => onDownloadSolutionFile(file.id)}
                          className="p-2 text-slate-400 hover:text-amber-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
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
              Final Approval Chain
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

          {/* Actions Section */}
          {data.status === 'final_approval' && (
            <>
              {canInitiate && !data.finalApproval && (
                <InitiateFinalApproval
                  onInitiate={onInitiateFinalApproval}
                  availableUsers={availableUsers}
                />
              )}
              
              {canApprove && data.finalApproval && (
                <FinalApprovalActions
                  onApprove={onApprove}
                  onReject={onReject}
                  currentLevel={data.finalApproval.currentLevel}
                  totalLevels={data.finalApproval.totalLevels}
                  nextApprover={data.finalApproval.nextApprover}
                />
              )}
            </>
          )}

          {subTasksElement && (
            <>
              <Separator className="bg-slate-200 dark:bg-slate-700" />
              {subTasksElement}
            </>
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
