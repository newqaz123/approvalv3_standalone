'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import {
  Download,
  Info,
  Paperclip,
  TrendingUp,
  Lock,
  History,
  Wrench,
  FileImage,
  FileSpreadsheet,
  File,
  FileText,
  Check,
  Clock,
  Send,
  Activity,
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
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

// Types for the component
interface ApprovalStep {
  id: string
  name: string
  role: string
  status: 'submitted' | 'approved' | 'pending'
  comment: string
  timestamp: string
  avatar?: string
}

interface ApprovalStage {
  stageNumber: string | number
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
  status: 'completed' | 'pending' | 'in_progress' | string
  submitter: {
    name: string
    role: string
    email: string
    initials: string
  }
  cost: number
  currency: string
  solutionDescription: string
  requestDescription: string
  files: FileAttachment[]
  stages: ApprovalStage[]
  activities: ActivityItem[]
  lastModified: string
}

interface RequestDetailDesktopV2Props {
  data: RequestDetailData
  open: boolean
  onOpenChange: (open: boolean) => void
  onDownloadPDF?: () => void
  onDownloadFile?: (fileId: string) => void
}

// Status badge variants
const statusConfig: Record<string, { label: string; className: string; dotClass: string }> = {
  completed: {
    label: 'Completed',
    className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    dotClass: 'bg-emerald-500',
  },
  pending: {
    label: 'Pending',
    className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    dotClass: 'bg-amber-500',
  },
  in_progress: {
    label: 'In Progress',
    className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    dotClass: 'bg-blue-500',
  },
}

// Step status badge variants - simplified to 3 statuses
const stepStatusConfig: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
  submitted: { 
    label: 'SUBMITTED', 
    className: 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400',
    icon: <Send className="w-3.5 h-3.5" />
  },
  approved: { 
    label: 'APPROVED', 
    className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400',
    icon: <Check className="w-4 h-4 text-emerald-500" />
  },
  pending: { 
    label: 'PENDING', 
    className: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
    icon: <Clock className="w-3.5 h-3.5" />
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
    case 'csv':
      return <div className="shrink-0 size-8 rounded bg-green-50 dark:bg-green-900/20 flex items-center justify-center text-green-600"><FileSpreadsheet className="w-4 h-4" /></div>
    default:
      return <div className="shrink-0 size-8 rounded bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-400"><File className="w-4 h-4" /></div>
  }
}

// Avatar component - green check for approved
function ApprovedAvatar() {
  return (
    <div className="shrink-0 size-7 rounded-full bg-emerald-500 flex items-center justify-center text-white shadow-md">
      <Check className="w-4 h-4 stroke-[3]" />
    </div>
  )
}

// Avatar component for pending steps
function PendingAvatar() {
  return (
    <div className="shrink-0 size-7 rounded-full bg-slate-100 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-400 shadow-sm">
      <Clock className="w-4 h-4" />
    </div>
  )
}

// Avatar component for submitted
function SubmittedAvatar({ initials }: { initials: string }) {
  return (
    <div className="shrink-0 size-7 rounded-full bg-blue-100 dark:bg-blue-900/30 border-2 border-blue-200 dark:border-blue-800 flex items-center justify-center text-blue-600 dark:text-blue-400 text-[10px] font-bold shadow-sm">
      {initials}
    </div>
  )
}

export function RequestDetailDesktopV2({
  data,
  open,
  onOpenChange,
  onDownloadPDF,
  onDownloadFile,
}: RequestDetailDesktopV2Props) {
  const status = statusConfig[data.status] || statusConfig.pending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-full max-h-[95vh] p-0 gap-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl rounded-xl overflow-hidden">
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
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                Ref ID: {data.referenceId}
              </p>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3 pr-4 border-r border-slate-100 dark:border-slate-800 mr-2">
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
              {onDownloadPDF && (
                <Button
                  onClick={onDownloadPDF}
                  className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg font-bold text-sm transition-colors shadow-md h-auto"
                >
                  <Download className="w-4 h-4" />
                  PDF
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>

        {/* Scrollable Content */}
        <ScrollArea className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-6">
            {/* Engineering Solution Section */}
            <section className="bg-emerald-50/60 dark:bg-emerald-900/10 rounded-xl p-5 border border-emerald-200/60 dark:border-emerald-800/30">
              <div className="flex justify-between items-start mb-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Wrench className="w-5 h-5 text-emerald-600" />
                  Engineering Solution
                </h3>
                <div className="text-right">
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Cost</p>
                  <p className="text-lg font-black text-slate-900 dark:text-slate-100">
                    {new Intl.NumberFormat('en-US', {
                      style: 'currency',
                      currency: data.currency || 'USD',
                    }).format(data.cost)}
                  </p>
                </div>
              </div>
              <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                {data.solutionDescription}
              </p>
            </section>

            {/* Two Column Layout: Description & Files */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Request Description */}
              <section className="h-full">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-3 flex items-center gap-2">
                  <Info className="w-4 h-4 text-slate-400" />
                  Request Description
                </h3>
                <div className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed bg-slate-50/70 dark:bg-slate-800/30 rounded-xl p-4 border border-slate-100 dark:border-slate-800 h-full">
                  <p>{data.requestDescription}</p>
                </div>
              </section>

              {/* Attached Documentation */}
              <section>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-3 flex items-center gap-2">
                  <Paperclip className="w-4 h-4 text-slate-400" />
                  Attached Documentation ({data.files.length})
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                          className="text-slate-400 hover:text-emerald-500 transition-colors"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            </div>

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
                    {/* Stage Label */}
                    <div className="w-full sm:w-28 shrink-0 pt-1 flex flex-row sm:flex-col justify-between sm:justify-start items-center sm:items-start border-b sm:border-b-0 border-slate-200 dark:border-slate-700 pb-2 sm:pb-0 mb-2 sm:mb-0">
                      <div>
                        <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                          Stage {stage.stageNumber}
                        </h4>
                        <p className="text-xs text-slate-400 leading-tight mt-0.5">{stage.stageName}</p>
                      </div>
                    </div>

                    {/* Approval Steps */}
                    <div className="flex-1 w-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {stage.steps.map((step) => {
                        const stepStatus = stepStatusConfig[step.status]
                        const isPending = step.status === 'pending'
                        const isApproved = step.status === 'approved'
                        const isSubmitted = step.status === 'submitted'

                        return (
                          <div
                            key={step.id}
                            className={cn(
                              "flex gap-3 items-start bg-white dark:bg-slate-900/60 p-3 rounded-lg border shadow-sm",
                              isPending
                                ? "border-slate-100 dark:border-slate-800/80 opacity-60"
                                : "border-slate-100 dark:border-slate-800/80"
                            )}
                          >
                            {isApproved ? (
                              <ApprovedAvatar />
                            ) : isPending ? (
                              <PendingAvatar />
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

            <Separator className="bg-slate-200 dark:bg-slate-700" />

            {/* Activity Timeline - Audit Trail */}
            <section>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
                <Activity className="w-5 h-5 text-slate-400" />
                Activity Timeline
              </h3>
              <div className="bg-slate-50/80 dark:bg-slate-800/30 rounded-xl border border-slate-100 dark:border-slate-800/60 p-4">
                <div className="space-y-0">
                  {data.activities.map((activity, index) => (
                    <div key={activity.id} className="relative pl-6 pb-4 last:pb-0">
                      {/* Timeline connector line */}
                      {index < data.activities.length - 1 && (
                        <div className="absolute left-2 top-4 bottom-0 w-0.5 bg-slate-200 dark:bg-slate-700" />
                      )}
                      {/* Timeline dot */}
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
            </section>
          </div>
        </ScrollArea>

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
