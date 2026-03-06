'use client'

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
  Activity,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Shield,
  FileUp,
  Printer,
  Clock3,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { useState } from 'react'

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

interface CompletedFinalModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  data: {
    id: string
    referenceId: string
    title: string
    status: 'completed'
    submitter: {
      name: string
      role: string
      email: string
      initials: string
    }
    requestDescription: string
    solution: {
      title: string
      description: string
      cost: number
      currency: string
      timeline?: string
      submittedBy: string
      submittedAt: string
      files: FileAttachment[]
    }
    requestFiles: FileAttachment[]
    stages: ApprovalStage[]
    activities: ActivityItem[]
    lastModified: string
    completedAt: string
    finalApprovers: string[]
  }
  onDownloadRequestFile?: (fileId: string) => void
  onDownloadSolutionFile?: (fileId: string) => void
  onExport?: () => void
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

// Avatar components
function ApprovedAvatar() {
  return (
    <div className="shrink-0 size-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
      <Check className="w-4 h-4 text-emerald-600" />
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

export function CompletedFinalModal({
  open,
  onOpenChange,
  data,
  onDownloadRequestFile,
  onDownloadSolutionFile,
  onExport,
}: CompletedFinalModalProps) {
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
                <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wider bg-emerald-100 text-emerald-700">
                  <span className="size-2 rounded-full mr-1.5 bg-emerald-500" />
                  Completed
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
        <div className="flex-1 overflow-y-auto p-6 space-y-6" style={{ maxHeight: 'calc(90vh - 180px)' }}>
          {/* Completed Banner */}
          <div className="bg-emerald-50 dark:bg-emerald-900/10 rounded-xl p-4 border border-emerald-200 dark:border-emerald-800/30">
            <div className="flex items-start gap-3">
              <div className="shrink-0 size-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-bold text-emerald-900 dark:text-emerald-400">
                  Final Approval Completed
                </h4>
                <p className="text-xs text-emerald-600 dark:text-emerald-300 mt-1">
                  Completed on {format(new Date(data.completedAt), 'MMM d, yyyy')} • All approvals granted
                </p>
                {data.finalApprovers.length > 0 && (
                  <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">
                    Final approvers: <span className="font-medium">{data.finalApprovers.join(', ')}</span>
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Solution Section */}
          <section className="bg-amber-50/60 dark:bg-amber-900/10 rounded-xl p-5 border border-amber-200/60 dark:border-amber-800/30">
            <div className="flex justify-between items-start mb-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-amber-600" />
                Engineering Solution
              </h3>
              <div className="text-right">
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Approved Cost</p>
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

          {/* Request Description */}
          <section>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-3 flex items-center gap-2">
              <Info className="w-4 h-4 text-slate-400" />
              Original Request Description
            </h3>
            <div className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed bg-slate-50/70 dark:bg-slate-800/30 rounded-xl p-4 border border-slate-100 dark:border-slate-800">
              <p>{data.requestDescription}</p>
            </div>
          </section>

          {/* Attachments */}
          <section>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-3 flex items-center gap-2">
              <Paperclip className="w-4 h-4 text-slate-400" />
              Attached Documentation
            </h3>

            {data.requestFiles.length > 0 && (
              <div className="mb-4">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Request Attachments ({data.requestFiles.length})
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

            {data.solution.files.length > 0 && (
              <div>
                <h4 className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-2">
                  Solution Attachments ({data.solution.files.length})
                </h4>
                <div className="grid grid-cols-1 gap-2">
                  {data.solution.files.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center p-3 border border-amber-200 dark:border-amber-800/30 rounded-lg bg-amber-50/30 dark:bg-amber-900/10 hover:border-amber-400 dark:hover:border-amber-600 transition-colors group relative gap-3"
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
              Complete Approval Chain
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
                      const isApproved = step.status === 'approved'

                      return (
                        <div
                          key={step.id}
                          className="flex gap-3 items-start bg-white dark:bg-slate-900/60 p-3 rounded-lg border border-slate-100 dark:border-slate-800/80 shadow-sm"
                        >
                          {isApproved ? (
                            <ApprovedAvatar />
                          ) : (
                            <SubmittedAvatar initials={step.avatar || step.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()} />
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

          <Separator className="bg-slate-200 dark:bg-slate-700" />

          {/* Retractable Activity Timeline */}
          <RetractableActivityTimeline activities={data.activities} />
        </div>

        {/* Footer - Only Export Button */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4 text-xs text-slate-400 font-medium">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              All Approvals Complete
            </span>
            <span className="flex items-center gap-1.5">
              <History className="w-3.5 h-3.5" />
              Completed: {format(new Date(data.completedAt), 'MMM d, yyyy')}
            </span>
          </div>
          <Button
            onClick={onExport}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <Printer className="w-4 h-4 mr-1.5" />
            Export Report
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
