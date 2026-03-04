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
} from 'lucide-react'
import { SubmitterModal } from '@/components/requests/submitter-modal'
import { ApproverModal } from '@/components/requests/approver-modal'
import { cn } from '@/lib/utils'

// Sample data
const sampleAvailableUsers = [
  { id: '1', name: 'Dr. Alan Grant', email: 'alan@firm.com', role: 'Chief Engineer', level: 1 },
  { id: '2', name: 'Ellie Sattler', email: 'ellie@firm.com', role: 'Senior Engineer', level: 2 },
  { id: '3', name: 'Ian Malcolm', email: 'ian@firm.com', role: 'Risk Analyst', level: 2 },
  { id: '4', name: 'John Hammond', email: 'john@firm.com', role: 'Director', level: 3 },
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

export default function RoleModalsPreview() {
  const [activeModal, setActiveModal] = useState<string | null>(null)

  // Submitter data
  const [submittedData, setSubmittedData] = useState<any>(null)

  // Sample approver data
  const approverRequestData = {
    id: 'req-001',
    referenceId: '#STR-2023-0442',
    title: 'Structural Integrity Report - Project X',
    status: 'request' as const,
    submitter: {
      name: 'Sarah Jenkins',
      role: 'Struct. Eng',
      email: 's.jenkins@firm.com',
      initials: 'SJ',
    },
    requestDescription: 'The initial request involves a comprehensive structural assessment of the Northern Wing expansion for Project X. We need to evaluate load-bearing capacity and identify potential reinforcement requirements.',
    requestFiles: [
      {
        id: 'file-001',
        fileName: 'Project_X_Specs.pdf',
        fileType: 'pdf',
        description: 'Technical specifications document',
      },
      {
        id: 'file-002',
        fileName: 'Site_Photos.zip',
        fileType: 'image',
        description: 'Current site condition photos',
      },
    ],
    stages: [
      {
        stageNumber: 1,
        stageName: 'Technical Review',
        steps: [
          {
            id: 'step-001',
            name: 'Dr. Alan Grant',
            role: 'Chief Engineer',
            status: 'submitted' as const,
            comment: 'Request received and under initial review.',
            timestamp: '2023-10-27T10:30:00',
          },
        ],
      },
    ],
    activities: sampleActivities,
    lastModified: '2023-10-27T10:30:00',
  }

  const approverSolutionData = {
    ...approverRequestData,
    status: 'solution' as const,
    title: 'Engineering Solution - Structural Reinforcement',
    solution: {
      title: 'Carbon Fiber Reinforcement Proposal',
      description: 'Implementation of carbon fiber reinforced polymer (CFRP) plates at critical stress points. This solution provides 40% increased load capacity while minimizing additional weight.',
      cost: 125000,
      currency: 'USD',
      submittedBy: 'Engineering Team',
      submittedAt: '2023-10-28T09:00:00',
      files: [
        {
          id: 'sol-file-001',
          fileName: 'Engineering_Calculations.pdf',
          fileType: 'pdf',
          description: 'Stress analysis calculations',
        },
        {
          id: 'sol-file-002',
          fileName: 'CFRP_Specs.xlsx',
          fileType: 'xlsx',
          description: 'Material specifications and costs',
        },
      ],
    },
    stages: [
      {
        stageNumber: 1,
        stageName: 'Technical Review',
        steps: [
          {
            id: 'step-001',
            name: 'Dr. Alan Grant',
            role: 'Chief Engineer',
            status: 'approved' as const,
            comment: 'Technical approach is sound. Cost estimate is reasonable.',
            timestamp: '2023-10-28T11:00:00',
          },
        ],
      },
      {
        stageNumber: 2,
        stageName: 'Management Approval',
        steps: [
          {
            id: 'step-002',
            name: 'John Hammond',
            role: 'Director',
            status: 'pending' as const,
            comment: 'Awaiting budget approval.',
            timestamp: '-',
          },
        ],
      },
    ],
    activities: [
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
        action: 'Technical review completed',
        user: 'Dr. Alan Grant',
        timestamp: '2023-10-28T11:00:00',
        details: 'Approved with recommendation',
      },
    ],
    lastModified: '2023-10-28T11:00:00',
  }

  const approverFinalData = {
    ...approverSolutionData,
    status: 'final_approval' as const,
    finalApproval: {
      initiatedBy: 'David Miller',
      initiatedAt: '2023-10-28T14:00:00',
      currentLevel: 1,
      totalLevels: 2,
      nextApprover: 'M. Sterling',
    },
    stages: [
      {
        stageNumber: 1,
        stageName: 'Level 1 Approval',
        steps: [
          {
            id: 'step-001',
            name: 'Dr. Alan Grant',
            role: 'Chief Engineer',
            status: 'approved' as const,
            comment: 'Technical review passed. Proceed to next level.',
            timestamp: '2023-10-28T09:00:00',
          },
        ],
      },
      {
        stageNumber: 2,
        stageName: 'Level 2 Approval',
        steps: [
          {
            id: 'step-002',
            name: 'M. Sterling',
            role: 'Dept. Head',
            status: 'pending' as const,
            comment: 'Awaiting final approval.',
            timestamp: '-',
          },
        ],
      },
    ],
  }

  const modalCards = [
    // SUBMITTER CARDS
    {
      id: 'submitter-request',
      role: 'submitter',
      title: '1. Submit New Request',
      description: 'Modal for users to submit a new improvement request',
      icon: <FileText className="w-5 h-5 text-blue-600" />,
      badge: 'Submitter',
      badgeColor: 'bg-blue-100 text-blue-700',
      features: ['Request title & description', 'File upload', 'Form validation'],
    },
    {
      id: 'submitter-solution',
      role: 'submitter',
      title: '2. Submit Solution',
      description: 'Modal for engineers to submit a solution with custom hierarchy option',
      icon: <CheckCircle2 className="w-5 h-5 text-purple-600" />,
      badge: 'Submitter',
      badgeColor: 'bg-purple-100 text-purple-700',
      features: ['Solution details & cost', 'Custom approval hierarchy toggle', 'Timeline & attachments'],
    },
    {
      id: 'submitter-resubmit',
      role: 'submitter',
      title: '3. Resubmit Solution',
      description: 'Modal for resubmitting a rejected solution with rejection banner',
      icon: <RotateCcw className="w-5 h-5 text-amber-600" />,
      badge: 'Submitter',
      badgeColor: 'bg-amber-100 text-amber-700',
      features: ['Rejection reason display', 'Edit solution details', 'Custom hierarchy retained'],
    },
    // APPROVER CARDS
    {
      id: 'approver-request',
      role: 'approver',
      title: '4. Review Request',
      description: 'Read-only modal for approvers to review a request',
      icon: <ThumbsUp className="w-5 h-5 text-emerald-600" />,
      badge: 'Approver',
      badgeColor: 'bg-emerald-100 text-emerald-700',
      features: ['Read-only request view', 'Approve/Reject actions', 'Activity timeline'],
    },
    {
      id: 'approver-solution',
      role: 'approver',
      title: '5. Review Solution',
      description: 'Read-only modal for reviewing engineering solutions',
      icon: <CheckCircle2 className="w-5 h-5 text-purple-600" />,
      badge: 'Approver',
      badgeColor: 'bg-purple-100 text-purple-700',
      features: ['Solution cost display', 'Separated file attachments', 'Approval workflow'],
    },
    {
      id: 'approver-final',
      role: 'approver',
      title: '6. Final Approval',
      description: 'Read-only modal for final approval chain',
      icon: <Shield className="w-5 h-5 text-amber-600" />,
      badge: 'Approver',
      badgeColor: 'bg-amber-100 text-amber-700',
      features: ['Final approval status', 'Progress indicator', 'Level tracking'],
    },
  ]

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 p-6 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-slate-100 mb-2">
            Role-Based Modal Prototypes
          </h1>
          <p className="text-slate-600 dark:text-slate-400 max-w-2xl">
            Two distinct modal types: <strong>Submitter</strong> (for creating/submitting content) 
            and <strong>Approver</strong> (for reviewing and approving). The custom hierarchy feature 
            belongs in the submitter modal when submitting solutions.
          </p>
        </div>

        {/* Role Explanation */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <div className="bg-blue-50 dark:bg-blue-900/10 rounded-xl p-5 border border-blue-200 dark:border-blue-800/30">
            <div className="flex items-center gap-3 mb-3">
              <div className="size-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <Send className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h3 className="font-bold text-blue-900 dark:text-blue-400">Submitter Modal</h3>
                <p className="text-xs text-blue-600 dark:text-blue-300">Create & Submit Content</p>
              </div>
            </div>
            <ul className="space-y-1.5 text-sm text-blue-800 dark:text-blue-300">
              <li>• Submit new requests</li>
              <li>• Submit engineering solutions</li>
              <li>• <strong>Custom approval hierarchy</strong> (solution only)</li>
              <li>• Resubmit rejected solutions</li>
              <li>• Upload attachments</li>
            </ul>
          </div>

          <div className="bg-emerald-50 dark:bg-emerald-900/10 rounded-xl p-5 border border-emerald-200 dark:border-emerald-800/30">
            <div className="flex items-center gap-3 mb-3">
              <div className="size-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <ThumbsUp className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <h3 className="font-bold text-emerald-900 dark:text-emerald-400">Approver Modal</h3>
                <p className="text-xs text-emerald-600 dark:text-emerald-300">Review & Make Decisions</p>
              </div>
            </div>
            <ul className="space-y-1.5 text-sm text-emerald-800 dark:text-emerald-300">
              <li>• Read-only request/solution view</li>
              <li>• Approve or reject content</li>
              <li>• View approval workflow</li>
              <li>• Download attachments</li>
              <li>• <strong>No custom hierarchy</strong> (already configured)</li>
            </ul>
          </div>
        </div>

        {/* Modal Cards Grid */}
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
          <Info className="w-5 h-5" />
          Click any card to preview the modal
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {modalCards.map((card) => (
            <div
              key={card.id}
              className="bg-white dark:bg-slate-800 rounded-xl p-5 border border-slate-200 dark:border-slate-700 hover:border-emerald-400 dark:hover:border-emerald-600 transition-all cursor-pointer group"
              onClick={() => setActiveModal(card.id)}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="size-10 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center group-hover:bg-emerald-100 dark:group-hover:bg-emerald-900/30 transition-colors">
                    {card.icon}
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                      {card.title}
                    </h3>
                    <span className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                      card.badgeColor
                    )}>
                      {card.badge}
                    </span>
                  </div>
                </div>
                <ArrowRight className="w-5 h-5 text-slate-400 group-hover:text-emerald-500 transition-colors" />
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                {card.description}
              </p>
              <div className="space-y-1">
                {card.features.map((feature, idx) => (
                  <div key={idx} className="flex items-center gap-1.5 text-xs text-slate-500">
                    <div className="w-1 h-1 rounded-full bg-emerald-500" />
                    {feature}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Key Difference Note */}
        <div className="mt-8 bg-slate-100 dark:bg-slate-800 rounded-xl p-5">
          <h3 className="font-bold text-slate-900 dark:text-slate-100 mb-2 flex items-center gap-2">
            <Users className="w-5 h-5" />
            Key Design Difference
          </h3>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            The <strong>custom approval hierarchy</strong> toggle is only available in the 
            <span className="text-purple-600 font-medium"> Submitter Modal</span> when submitting a solution. 
            This allows the submitter to define who should approve their solution. The 
            <span className="text-emerald-600 font-medium"> Approver Modal</span> is strictly read-only 
            for reviewing and making approval decisions - the hierarchy has already been set by the submitter 
            or uses the default chain.
          </p>
        </div>
      </div>

      {/* SUBMITTER MODALS */}
      <SubmitterModal
        mode="request"
        open={activeModal === 'submitter-request'}
        onOpenChange={() => setActiveModal(null)}
        availableUsers={sampleAvailableUsers}
        onSubmitRequest={(data) => {
          alert(`Request submitted: ${data.title}`)
          setSubmittedData(data)
        }}
      />

      <SubmitterModal
        mode="solution"
        open={activeModal === 'submitter-solution'}
        onOpenChange={() => setActiveModal(null)}
        availableUsers={sampleAvailableUsers}
        onSubmitSolution={(data) => {
          alert(`Solution submitted: ${data.title}\nCustom hierarchy: ${data.useCustomHierarchy}`)
        }}
      />

      <SubmitterModal
        mode="resubmit"
        open={activeModal === 'submitter-resubmit'}
        onOpenChange={() => setActiveModal(null)}
        availableUsers={sampleAvailableUsers}
        initialData={{
          solution: {
            title: 'CFRP Reinforcement Proposal',
            description: 'Implementation of carbon fiber reinforced polymer plates...',
            cost: 125000,
            currency: 'USD',
            timeline: '3 months',
          },
          rejectionReason: 'Budget exceeds Q4 allocation. Please explore alternative materials or phased implementation.',
          rejectedBy: 'John Hammond',
          rejectedAt: '2023-10-29T10:30:00',
        }}
        onResubmit={(data) => {
          alert(`Solution resubmitted with ${data.useCustomHierarchy ? 'custom' : 'default'} hierarchy`)
        }}
      />

      {/* APPROVER MODALS */}
      <ApproverModal
        mode="request"
        open={activeModal === 'approver-request'}
        onOpenChange={() => setActiveModal(null)}
        data={approverRequestData}
        canApprove={true}
        onApprove={(comment) => alert(`Request approved! Comment: ${comment || 'None'}`)}
        onReject={(reason) => alert(`Request rejected: ${reason}`)}
      />

      <ApproverModal
        mode="solution"
        open={activeModal === 'approver-solution'}
        onOpenChange={() => setActiveModal(null)}
        data={approverSolutionData}
        canApprove={true}
        onApprove={(comment) => alert(`Solution approved! Comment: ${comment || 'None'}`)}
        onReject={(reason) => alert(`Solution rejected: ${reason}`)}
      />

      <ApproverModal
        mode="final"
        open={activeModal === 'approver-final'}
        onOpenChange={() => setActiveModal(null)}
        data={approverFinalData}
        canApprove={true}
        onApprove={(comment) => alert(`Final approval granted! Comment: ${comment || 'None'}`)}
        onReject={(reason) => alert(`Final approval rejected: ${reason}`)}
      />
    </div>
  )
}
