'use client'

import { useState } from 'react'
import {
  FileText,
  CheckCircle2,
  RotateCcw,
  Users,
  ArrowRight,
  Send,
  ThumbsUp,
  ThumbsDown,
  Shield,
  Info,
  Check,
  Package,
  Printer,
  Play,
  AlertTriangle,
} from 'lucide-react'
import { SubmitterModal } from '@/components/requests/submitter-modal'
import { ApproverModal } from '@/components/requests/approver-modal'
import { CompletedRequestModal } from '@/components/requests/completed-request-modal'
import { CompletedSolutionModal } from '@/components/requests/completed-solution-modal'
import { SubmitFinalApprovalModal } from '@/components/requests/submit-final-approval-modal'
import { CompletedFinalModal } from '@/components/requests/completed-final-modal'
import { RequestResubmitModal } from '@/components/requests/request-resubmit-modal'
import { FinalApprovalResubmitModal } from '@/components/requests/final-approval-resubmit-modal'
import { cn } from '@/lib/utils'

// Sample data
const sampleAvailableUsers = [
  { id: '1', name: 'Dr. Alan Grant', email: 'alan@firm.com', role: 'Chief Engineer', level: 1 },
  { id: '2', name: 'Ellie Sattler', email: 'ellie@firm.com', role: 'Senior Engineer', level: 2 },
  { id: '3', name: 'Ian Malcolm', email: 'ian@firm.com', role: 'Risk Analyst', level: 2 },
  { id: '4', name: 'John Hammond', email: 'john@firm.com', role: 'Director', level: 3 },
  { id: '5', name: 'M. Sterling', email: 'sterling@firm.com', role: 'Dept. Head', level: 3 },
]

const sampleActivities = [
  {
    id: 'act-001',
    action: 'Request submitted',
    user: 'Sarah Jenkins',
    timestamp: '2023-10-27T10:30:00',
    details: 'Initial improvement request created',
  },
  {
    id: 'act-002',
    action: 'Stage 1 approved',
    user: 'Dr. Alan Grant',
    timestamp: '2023-10-27T14:15:00',
    details: 'Technical feasibility confirmed',
  },
]

const sampleSolutionActivities = [
  ...sampleActivities,
  {
    id: 'act-003',
    action: 'Solution submitted',
    user: 'Engineering Team',
    timestamp: '2023-10-28T09:00:00',
    details: 'Carbon fiber reinforcement proposal',
  },
  {
    id: 'act-004',
    action: 'Design & Cost approved',
    user: 'John Hammond',
    timestamp: '2023-10-29T11:30:00',
    details: 'Budget allocated',
  },
]

const sampleFinalActivities = [
  ...sampleSolutionActivities,
  {
    id: 'act-005',
    action: 'Final approval initiated',
    user: 'David Miller',
    timestamp: '2023-10-30T08:00:00',
    details: 'Started 2-level approval chain',
  },
  {
    id: 'act-006',
    action: 'Level 1 approved',
    user: 'Dr. Alan Grant',
    timestamp: '2023-10-30T10:00:00',
    details: 'Technical review passed',
  },
  {
    id: 'act-007',
    action: 'Final approval completed',
    user: 'M. Sterling',
    timestamp: '2023-10-31T14:00:00',
    details: 'All approvals granted',
  },
]

const sampleFiles = [
  { id: 'file-001', fileName: 'Project_X_Specs.pdf', fileType: 'pdf', description: 'Technical specifications' },
  { id: 'file-002', fileName: 'Site_Photos.zip', fileType: 'image', description: 'Site condition photos' },
]

const sampleSolutionFiles = [
  { id: 'sol-001', fileName: 'Engineering_Calcs.pdf', fileType: 'pdf', description: 'Stress analysis' },
  { id: 'sol-002', fileName: 'Cost_Breakdown.xlsx', fileType: 'xlsx', description: 'Material costs' },
]

export default function SequentialStagesPreview() {
  const [activeModal, setActiveModal] = useState<string | null>(null)
  const [userDepartment, setUserDepartment] = useState<string>('Engineering')

  // ============ REQUEST FLOW DATA ============
  const requestFlowData = {
    submitter: {
      name: 'Sarah Jenkins',
      role: 'Struct. Eng',
      email: 's.jenkins@firm.com',
      initials: 'SJ',
    },
    requestDescription: 'The initial request involves a comprehensive structural assessment of the Northern Wing expansion for Project X.',
    requestFiles: sampleFiles,
    stages: [
      {
        stageNumber: 1,
        stageName: 'Initial Review',
        steps: [
          {
            id: 'step-001',
            name: 'Dr. Alan Grant',
            role: 'Chief Engineer',
            status: 'submitted' as const,
            comment: 'Request received, pending review.',
            timestamp: '2023-10-27T10:30:00',
          },
        ],
      },
    ],
    activities: sampleActivities,
    lastModified: '2023-10-27T10:30:00',
  }

  // Completed Request Data (1.3)
  const completedRequestData = {
    ...requestFlowData,
    id: 'req-001',
    referenceId: '#STR-2023-0442',
    title: 'Structural Integrity Report - Project X',
    status: 'completed_request' as const,
    stages: [
      {
        stageNumber: 1,
        stageName: 'Initial Review',
        steps: [
          {
            id: 'step-001',
            name: 'Dr. Alan Grant',
            role: 'Chief Engineer',
            status: 'approved' as const,
            comment: 'Request approved. Proceed to engineering.',
            timestamp: '2023-10-27T14:15:00',
          },
        ],
      },
    ],
    sentToEngineerAt: '2023-10-27T15:00:00',
    engineerAssigned: 'Engineering Team A',
  }

  // Request Resubmit Data
  const requestResubmitData = {
    title: 'Structural Integrity Report - Project X',
    description: 'The initial request involves a comprehensive structural assessment...',
    templateId: 'template-1',
    rejectionReason: 'Insufficient detail on load requirements. Please provide more specific data on expected traffic loads and environmental conditions.',
    rejectedBy: 'Dr. Alan Grant',
    rejectedAt: '2023-10-27T12:00:00',
    files: sampleFiles,
  }

  // ============ SOLUTION FLOW DATA ============
  const solutionFlowData = {
    ...requestFlowData,
    id: 'req-001',
    referenceId: '#STR-2023-0442',
    title: 'Engineering Solution - Structural Reinforcement',
    status: 'solution' as const,
    solution: {
      title: 'Carbon Fiber Reinforcement Proposal',
      description: 'Implementation of carbon fiber reinforced polymer (CFRP) plates at critical stress points.',
      cost: 125000,
      currency: 'USD',
      timeline: '3 months',
      submittedBy: 'Engineering Team',
      submittedAt: '2023-10-28T09:00:00',
      files: sampleSolutionFiles,
    },
    stages: [
      {
        stageNumber: 1,
        stageName: 'Design Review',
        steps: [
          {
            id: 'step-001',
            name: 'Dr. Alan Grant',
            role: 'Chief Engineer',
            status: 'approved' as const,
            comment: 'Design approved. Cost reasonable.',
            timestamp: '2023-10-28T11:00:00',
          },
        ],
      },
      {
        stageNumber: 2,
        stageName: 'Cost Approval',
        steps: [
          {
            id: 'step-002',
            name: 'John Hammond',
            role: 'Director',
            status: 'pending' as const,
            comment: 'Awaiting budget review.',
            timestamp: '-',
          },
        ],
      },
    ],
    activities: sampleSolutionActivities,
  }

  // Completed Solution Data (2.3)
  const completedSolutionData = {
    ...solutionFlowData,
    status: 'completed_solution' as const,
    stages: [
      {
        stageNumber: 1,
        stageName: 'Design Review',
        steps: [
          {
            id: 'step-001',
            name: 'Dr. Alan Grant',
            role: 'Chief Engineer',
            status: 'approved' as const,
            comment: 'Design approved.',
            timestamp: '2023-10-28T11:00:00',
          },
        ],
      },
      {
        stageNumber: 2,
        stageName: 'Cost Approval',
        steps: [
          {
            id: 'step-002',
            name: 'John Hammond',
            role: 'Director',
            status: 'approved' as const,
            comment: 'Budget approved.',
            timestamp: '2023-10-29T11:30:00',
          },
        ],
      },
    ],
    sentToRequesterAt: '2023-10-29T14:00:00',
    requesterName: 'Sarah Jenkins',
  }

  // ============ FINAL APPROVAL FLOW DATA ============
  const finalApprovalFlowData = {
    ...solutionFlowData,
    title: 'Final Approval - Project X Solution',
    status: 'final_approval' as const,
    stages: [
      ...completedSolutionData.stages,
      {
        stageNumber: 3,
        stageName: 'Final Approval',
        steps: [
          {
            id: 'step-003',
            name: 'Dr. Alan Grant',
            role: 'Chief Engineer',
            status: 'approved' as const,
            comment: 'Technical sign-off.',
            timestamp: '2023-10-30T10:00:00',
          },
          {
            id: 'step-004',
            name: 'M. Sterling',
            role: 'Dept. Head',
            status: 'pending' as const,
            comment: 'Awaiting final sign-off.',
            timestamp: '-',
          },
        ],
      },
    ],
    finalApproval: {
      initiatedBy: 'David Miller',
      initiatedAt: '2023-10-30T08:00:00',
      currentLevel: 1,
      totalLevels: 2,
      nextApprover: 'M. Sterling',
    },
    activities: sampleFinalActivities,
  }

  // Completed Final Data (3.3)
  const completedFinalData = {
    ...finalApprovalFlowData,
    status: 'completed' as const,
    stages: [
      ...completedSolutionData.stages,
      {
        stageNumber: 3,
        stageName: 'Final Approval',
        steps: [
          {
            id: 'step-003',
            name: 'Dr. Alan Grant',
            role: 'Chief Engineer',
            status: 'approved' as const,
            comment: 'Technical sign-off.',
            timestamp: '2023-10-30T10:00:00',
          },
          {
            id: 'step-004',
            name: 'M. Sterling',
            role: 'Dept. Head',
            status: 'approved' as const,
            comment: 'Final approval granted.',
            timestamp: '2023-10-31T14:00:00',
          },
        ],
      },
    ],
    completedAt: '2023-10-31T14:00:00',
    finalApprovers: ['Dr. Alan Grant', 'M. Sterling'],
  }

  // Final Approval Resubmit Data
  const finalApprovalResubmitData = {
    ...finalApprovalFlowData,
    rejection: {
      reason: 'Budget constraints in Q4. Recommend postponing to Q1 next year when new funding is available.',
      rejectedBy: 'M. Sterling',
      rejectedAt: '2023-10-31T10:00:00',
      rejectedAtLevel: 2,
    },
    stages: [
      ...completedSolutionData.stages,
      {
        stageNumber: 3,
        stageName: 'Final Approval',
        steps: [
          {
            id: 'step-003',
            name: 'Dr. Alan Grant',
            role: 'Chief Engineer',
            status: 'approved' as const,
            comment: 'Technical sign-off.',
            timestamp: '2023-10-30T10:00:00',
          },
          {
            id: 'step-004',
            name: 'M. Sterling',
            role: 'Dept. Head',
            status: 'rejected' as const,
            comment: 'Budget not available.',
            timestamp: '2023-10-31T10:00:00',
          },
        ],
      },
    ],
  }

  // Stage cards configuration
  const stageCards = [
    // ============ REQUEST FLOW ============
    {
      flow: 'Request Flow',
      flowColor: 'bg-blue-500',
      stages: [
        {
          id: '1.1',
          modalId: 'request-submit',
          title: '1.1 Submit Request',
          subtitle: 'Improvement Request',
          description: 'Submitter creates new improvement request',
          icon: <Send className="w-5 h-5 text-blue-600" />,
          badge: 'Submitter',
          badgeColor: 'bg-blue-100 text-blue-700',
          features: ['Title & description', 'File attachments', 'Template selection'],
        },
        {
          id: '1.2',
          modalId: 'request-review',
          title: '1.2 Review Request',
          subtitle: 'Improvement Request',
          description: 'Approver reviews and decides on request',
          icon: <ThumbsUp className="w-5 h-5 text-emerald-600" />,
          badge: 'Approver',
          badgeColor: 'bg-emerald-100 text-emerald-700',
          features: ['Read-only view', 'Approve/Reject'],
        },
        {
          id: '1.2-resubmit',
          modalId: 'request-resubmit',
          title: '1.2 Resubmit Request',
          subtitle: 'Improvement Request',
          description: 'Submitter resubmits rejected request',
          icon: <RotateCcw className="w-5 h-5 text-amber-600" />,
          badge: 'Submitter',
          badgeColor: 'bg-amber-100 text-amber-700',
          features: ['Rejection banner', 'Edit & resubmit', 'Template selection', 'Delete attachments'],
        },
        {
          id: '1.3',
          modalId: 'request-completed',
          title: '1.3 Completed Request',
          subtitle: 'Sent to Engineer',
          description: 'Engineering sees Submit Solution button',
          icon: <Check className="w-5 h-5 text-emerald-600" />,
          badge: 'Completed',
          badgeColor: 'bg-emerald-100 text-emerald-700',
          features: ['Sent to engineer', 'Engineering: Submit Solution button'],
        },
      ],
    },
    // ============ SOLUTION FLOW ============
    {
      flow: 'Solution Flow',
      flowColor: 'bg-purple-500',
      stages: [
        {
          id: '2.1',
          modalId: 'solution-submit',
          title: '2.1 Submit Solution',
          subtitle: 'Design & Cost Approval',
          description: 'Engineer submits solution with hierarchy',
          icon: <CheckCircle2 className="w-5 h-5 text-purple-600" />,
          badge: 'Submitter',
          badgeColor: 'bg-purple-100 text-purple-700',
          features: ['Solution details', 'Custom hierarchy toggle', 'Timeline field', 'View original request'],
        },
        {
          id: '2.2',
          modalId: 'solution-review',
          title: '2.2 Review Solution',
          subtitle: 'Design & Cost Approval',
          description: 'Approver reviews engineering solution',
          icon: <ThumbsUp className="w-5 h-5 text-purple-600" />,
          badge: 'Approver',
          badgeColor: 'bg-purple-100 text-purple-700',
          features: ['Cost display', 'Timeline display', 'Approve/Reject'],
        },
        {
          id: '2.2-resubmit',
          modalId: 'solution-resubmit',
          title: '2.2 Resubmit Solution',
          subtitle: 'Design & Cost Approval',
          description: 'Engineer resubmits rejected solution',
          icon: <RotateCcw className="w-5 h-5 text-amber-600" />,
          badge: 'Submitter',
          badgeColor: 'bg-amber-100 text-amber-700',
          features: ['Rejection reason', 'Custom hierarchy', 'Delete existing attachments'],
        },
        {
          id: '2.3',
          modalId: 'solution-completed',
          title: '2.3 Completed Solution',
          subtitle: 'Sent to Requester',
          description: 'Requester sees Submit Final Approval button',
          icon: <Package className="w-5 h-5 text-purple-600" />,
          badge: 'Completed',
          badgeColor: 'bg-purple-100 text-purple-700',
          features: ['Sent to requester', 'Requester: Submit Final Approval button'],
        },
      ],
    },
    // ============ FINAL APPROVAL FLOW ============
    {
      flow: 'Final Approval Flow',
      flowColor: 'bg-amber-500',
      stages: [
        {
          id: '3.1',
          modalId: 'final-submit',
          title: '3.1 Submit Final Approval',
          subtitle: 'Final Approval',
          description: 'Initiate final approval with hierarchy',
          icon: <Play className="w-5 h-5 text-amber-600" />,
          badge: 'Submitter',
          badgeColor: 'bg-amber-100 text-amber-700',
          features: ['Initiate process', 'Custom hierarchy', 'Timeline display'],
        },
        {
          id: '3.2',
          modalId: 'final-review',
          title: '3.2 Review Final Approval',
          subtitle: 'Final Approval',
          description: 'Multi-level final approval review',
          icon: <Shield className="w-5 h-5 text-amber-600" />,
          badge: 'Approver',
          badgeColor: 'bg-amber-100 text-amber-700',
          features: ['Progress indicator', 'Timeline display', 'Approve/Reject'],
        },
        {
          id: '3.2-resubmit',
          modalId: 'final-resubmit',
          title: '3.2 Resubmit Final Approval',
          subtitle: 'Final Approval',
          description: 'Restart rejected final approval',
          icon: <RotateCcw className="w-5 h-5 text-red-600" />,
          badge: 'Submitter',
          badgeColor: 'bg-red-100 text-red-700',
          features: ['Rejection level', 'Restart process'],
        },
        {
          id: '3.3',
          modalId: 'final-completed',
          title: '3.3 Completed Final',
          subtitle: 'Completed',
          description: 'Fully approved with export option',
          icon: <Printer className="w-5 h-5 text-emerald-600" />,
          badge: 'Completed',
          badgeColor: 'bg-emerald-100 text-emerald-700',
          features: ['Export report only', 'Timeline display', 'No other actions'],
        },
      ],
    },
  ]

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 p-6 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-slate-100 mb-2">
            Sequential Stage Prototypes
          </h1>
          <p className="text-slate-600 dark:text-slate-400 max-w-3xl">
            Complete workflow visualization showing all stages across three flows. 
            Each flow has submit, review, resubmit (if rejected), and completed stages.
          </p>
        </div>

        {/* Department Selector */}
        <div className="mb-8 bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
          <label className="block text-sm font-bold text-slate-900 dark:text-slate-100 mb-2">
            Simulate User Department (for conditional button display):
          </label>
          <div className="flex flex-wrap gap-2">
            {['Engineering', 'Production 1', 'Production 2', 'Admin'].map((dept) => (
              <button
                key={dept}
                onClick={() => setUserDepartment(dept)}
                className={cn(
                  "px-4 py-2 rounded-lg text-sm font-bold transition-colors",
                  userDepartment === dept
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600"
                )}
              >
                {dept}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Current: <span className="font-bold text-emerald-600">{userDepartment}</span> — 
            {userDepartment === 'Engineering' 
              ? ' Will see "Submit Solution" button in Completed Request modal'
              : ' Will see "Submit Final Approval" button in Completed Solution modal (if Production dept)'
            }
          </p>
        </div>

        {/* Flow Stages */}
        {stageCards.map((flow) => (
          <div key={flow.flow} className="mb-10">
            <div className="flex items-center gap-3 mb-4">
              <div className={cn("w-3 h-3 rounded-full", flow.flowColor)} />
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">{flow.flow}</h2>
              <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {flow.stages.map((stage) => (
                <div
                  key={stage.id}
                  className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700 hover:border-emerald-400 dark:hover:border-emerald-600 transition-all cursor-pointer group relative"
                  onClick={() => setActiveModal(stage.modalId)}
                >
                  {/* Stage number badge */}
                  <div className="absolute -top-2 -left-2 w-8 h-8 rounded-full bg-slate-900 dark:bg-slate-700 text-white flex items-center justify-center text-xs font-bold">
                    {stage.id}
                  </div>

                  <div className="flex items-start justify-between mb-3 mt-2">
                    <div className="size-10 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center group-hover:bg-emerald-100 dark:group-hover:bg-emerald-900/30 transition-colors">
                      {stage.icon}
                    </div>
                    <ArrowRight className="w-5 h-5 text-slate-400 group-hover:text-emerald-500 transition-colors" />
                  </div>

                  <div className="mb-2">
                    <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                      {stage.title}
                    </h3>
                    <p className="text-xs text-slate-500">{stage.subtitle}</p>
                  </div>

                  <span className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase mb-2",
                    stage.badgeColor
                  )}>
                    {stage.badge}
                  </span>

                  <p className="text-xs text-slate-600 dark:text-slate-400 mb-3">
                    {stage.description}
                  </p>

                  <div className="space-y-1">
                    {stage.features.map((feature, idx) => (
                      <div key={idx} className="flex items-center gap-1.5 text-[10px] text-slate-500">
                        <div className="w-1 h-1 rounded-full bg-emerald-500" />
                        {feature}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Legend */}
        <div className="mt-8 bg-slate-100 dark:bg-slate-800 rounded-xl p-5">
          <h3 className="font-bold text-slate-900 dark:text-slate-100 mb-3 flex items-center gap-2">
            <Info className="w-5 h-5" />
            Stage Type Legend
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-blue-500" />
              <span className="text-slate-600 dark:text-slate-400">Submitter (Create)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-emerald-500" />
              <span className="text-slate-600 dark:text-slate-400">Approver (Review)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-amber-500" />
              <span className="text-slate-600 dark:text-slate-400">Resubmit (Fix)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-slate-400" />
              <span className="text-slate-600 dark:text-slate-400">Completed (Read-only)</span>
            </div>
          </div>
        </div>
      </div>

      {/* ============ MODALS ============ */}

      {/* 1.1 Submit Request */}
      <SubmitterModal
        mode="request"
        open={activeModal === 'request-submit'}
        onOpenChange={() => setActiveModal(null)}
        availableUsers={sampleAvailableUsers}
        onSubmitRequest={(data) => alert(`Request submitted: ${data.title}`)}
      />

      {/* 1.2 Review Request */}
      <ApproverModal
        mode="request"
        open={activeModal === 'request-review'}
        onOpenChange={() => setActiveModal(null)}
        data={{
          ...requestFlowData,
          id: 'req-001',
          referenceId: '#STR-2023-0442',
          title: 'Structural Integrity Report - Project X',
          status: 'request',
        }}
        canApprove={true}
        onApprove={(comment) => alert(`Approved: ${comment || 'No comment'}`)}
        onReject={(reason) => alert(`Rejected: ${reason}`)}
      />

      {/* 1.2 Resubmit Request */}
      <RequestResubmitModal
        open={activeModal === 'request-resubmit'}
        onOpenChange={() => setActiveModal(null)}
        initialData={requestResubmitData}
        onResubmit={(data) => alert(`Resubmitted: ${data.title}`)}
      />

      {/* 1.3 Completed Request */}
      <CompletedRequestModal
        open={activeModal === 'request-completed'}
        onOpenChange={() => setActiveModal(null)}
        data={completedRequestData}
        userDepartment={userDepartment}
        onSubmitSolution={() => {
          alert(`Submit Solution button clicked!\\nUser department: ${userDepartment}\\nThis would open the solution submission modal.`)
        }}
      />

      {/* 2.1 Submit Solution */}
      <SubmitterModal
        mode="solution"
        open={activeModal === 'solution-submit'}
        onOpenChange={() => setActiveModal(null)}
        availableUsers={sampleAvailableUsers}
        initialData={{
          requestId: 'req-001',
          requestTitle: 'Structural Integrity Report - Project X',
        }}
        onSubmitSolution={(data) => alert(`Solution submitted: ${data.title}\nCustom: ${data.useCustomHierarchy}`)}
      />

      {/* 2.2 Review Solution */}
      <ApproverModal
        mode="solution"
        open={activeModal === 'solution-review'}
        onOpenChange={() => setActiveModal(null)}
        data={solutionFlowData}
        canApprove={true}
        onApprove={(comment) => alert(`Solution approved: ${comment || 'No comment'}`)}
        onReject={(reason) => alert(`Solution rejected: ${reason}`)}
      />

      {/* 2.2 Resubmit Solution (uses SubmitterModal with resubmit mode) */}
      <SubmitterModal
        mode="resubmit"
        open={activeModal === 'solution-resubmit'}
        onOpenChange={() => setActiveModal(null)}
        availableUsers={sampleAvailableUsers}
        initialData={{
          solution: {
            title: 'Carbon Fiber Reinforcement Proposal',
            description: 'Implementation of CFRP plates at critical stress points.',
            cost: 125000,
            currency: 'USD',
            timeline: '3 months',
          },
          existingFiles: sampleSolutionFiles,
          rejectionReason: 'Cost exceeds Q4 budget. Please explore phased implementation.',
          rejectedBy: 'John Hammond',
          rejectedAt: '2023-10-29T10:30:00',
        }}
        onResubmit={(data) => alert(`Solution resubmitted with ${data.useCustomHierarchy ? 'custom' : 'default'} hierarchy\nDeleted files: ${data.deletedFileIds?.length || 0}`)}
      />

      {/* 2.3 Completed Solution */}
      <CompletedSolutionModal
        open={activeModal === 'solution-completed'}
        onOpenChange={() => setActiveModal(null)}
        data={completedSolutionData}
        userDepartment={userDepartment}
        onSubmitFinalApproval={() => {
          alert(`Submit Final Approval button clicked!\\nUser department: ${userDepartment}\\nThis would open the final approval submission modal.`)
        }}
      />

      {/* 3.1 Submit Final Approval */}
      <SubmitFinalApprovalModal
        open={activeModal === 'final-submit'}
        onOpenChange={() => setActiveModal(null)}
        data={{
          ...solutionFlowData,
          title: 'Final Approval - Project X Solution',
        }}
        availableUsers={sampleAvailableUsers}
        onSubmit={(data) => alert(`Final approval started with ${data.useCustomHierarchy ? 'custom' : 'default'} hierarchy`)}
      />

      {/* 3.2 Review Final Approval */}
      <ApproverModal
        mode="final"
        open={activeModal === 'final-review'}
        onOpenChange={() => setActiveModal(null)}
        data={finalApprovalFlowData}
        canApprove={true}
        onApprove={(comment) => alert(`Final approval granted: ${comment || 'No comment'}`)}
        onReject={(reason) => alert(`Final approval rejected: ${reason}`)}
      />

      {/* 3.2 Resubmit Final Approval */}
      <FinalApprovalResubmitModal
        open={activeModal === 'final-resubmit'}
        onOpenChange={() => setActiveModal(null)}
        data={finalApprovalResubmitData}
        availableUsers={sampleAvailableUsers}
        onRestart={(data) => alert(`Final approval restarted with ${data.useCustomHierarchy ? 'custom' : 'default'} hierarchy`)}
      />

      {/* 3.3 Completed Final */}
      <CompletedFinalModal
        open={activeModal === 'final-completed'}
        onOpenChange={() => setActiveModal(null)}
        data={completedFinalData}
        onExport={() => alert('Exporting final report...')}
      />
    </div>
  )
}
