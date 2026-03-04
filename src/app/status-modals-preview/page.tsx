'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { StatusModal } from '@/components/requests/status-modal'
import { SolutionModal } from '@/components/requests/solution-modal'
import { FinalApprovalModal } from '@/components/requests/final-approval-modal'
import { 
  FileText, 
  CheckCircle2, 
  AlertTriangle, 
  Shield, 
  Users,
  ArrowRight,
  RotateCcw
} from 'lucide-react'

// Sample data for different statuses
const sampleFiles = [
  {
    id: 'file-001',
    fileName: 'Final_Schematics_Rev2.pdf',
    fileType: 'pdf',
    description: 'Updated per client feedback',
  },
  {
    id: 'file-002',
    fileName: 'Site_Photo_Girder_Detail.png',
    fileType: 'image',
    description: 'Visual evidence of corrosion',
  },
  {
    id: 'file-003',
    fileName: 'Stress_Analysis_Report.pdf',
    fileType: 'pdf',
    description: 'Calculations verified',
  },
]

const sampleActivities = [
  {
    id: 'act-001',
    action: 'Created request',
    user: 'David Miller',
    timestamp: '2023-10-24T08:15:00',
    details: 'Initial improvement request submitted',
  },
  {
    id: 'act-002',
    action: 'Approved',
    user: 'Jessica Wong',
    timestamp: '2023-10-24T10:30:00',
    details: 'Stage 1 verified - damage extent confirmed',
  },
  {
    id: 'act-003',
    action: 'Solution submitted',
    user: 'Robert Chen',
    timestamp: '2023-10-26T09:45:00',
    details: 'Engineering solution with cost estimate',
  },
]

const sampleStages = [
  {
    stageNumber: 1,
    stageName: 'Improvement Request',
    steps: [
      {
        id: 'step-001',
        name: 'David Miller',
        role: 'Field Supervisor',
        status: 'submitted' as const,
        comment: 'Observed minor cracking on G-12. Requesting review.',
        timestamp: '2023-10-24T08:15:00',
        avatar: 'DM',
      },
      {
        id: 'step-002',
        name: 'Jessica Wong',
        role: 'Site Manager',
        status: 'approved' as const,
        comment: 'Verified damage extent. Escalating to engineering.',
        timestamp: '2023-10-24T10:30:00',
        avatar: 'JW',
      },
    ],
  },
  {
    stageNumber: 2,
    stageName: 'Engineering Solution',
    steps: [
      {
        id: 'step-003',
        name: 'Robert Chen',
        role: 'Engineering L3',
        status: 'submitted' as const,
        comment: 'CFRP strengthening solution proposed.',
        timestamp: '2023-10-26T09:45:00',
      },
      {
        id: 'step-004',
        name: 'Amanda Thorne',
        role: 'QC Level 2',
        status: 'pending' as const,
        comment: 'Awaiting compliance verification.',
        timestamp: '-',
      },
    ],
  },
]

const sampleSolution = {
  description: 'To address the structural deficiency, we recommend the implementation of CFRP (Carbon Fiber Reinforced Polymer) strengthening on the underside of Girders G-12 through G-18. This solution provides the necessary 25% increase in tensile strength.',
  cost: 142500,
  currency: 'USD',
  submittedBy: 'Robert Chen',
  submittedAt: '2023-10-26T09:45:00',
}

const sampleAvailableUsers = [
  { id: 'u1', name: 'Robert Chen', email: 'robert@firm.com', role: 'Engineering L3', level: 3 },
  { id: 'u2', name: 'Amanda Thorne', email: 'amanda@firm.com', role: 'QC Level 2', level: 2 },
  { id: 'u3', name: 'Sarah Mills', email: 'sarah@firm.com', role: 'HSE Officer', level: 2 },
  { id: 'u4', name: 'Dr. Alan Grant', email: 'alan@firm.com', role: 'Chief Engineer', level: 4 },
  { id: 'u5', name: 'M. Sterling', email: 'sterling@firm.com', role: 'Dept. Head', level: 5 },
]

export default function StatusModalsPreview() {
  const [activeModal, setActiveModal] = useState<string | null>(null)

  // Request Status Data
  const requestData = {
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
    requestDescription: 'The initial request involves a comprehensive structural assessment of the Northern Wing expansion for Project X. Concerns were raised regarding the load-bearing capacity of the primary steel girders under the proposed updated mechanical equipment layout.',
    files: sampleFiles,
    stages: sampleStages,
    activities: sampleActivities,
    lastModified: '2023-10-28T11:15:00',
  }

  // Solution Status Data
  const solutionData = {
    id: 'req-001',
    referenceId: '#STR-2023-0442',
    title: 'Structural Integrity Report - Project X',
    status: 'solution' as const,
    submitter: {
      name: 'Sarah Jenkins',
      role: 'Struct. Eng',
      email: 's.jenkins@firm.com',
      initials: 'SJ',
    },
    requestDescription: 'The initial request involves a comprehensive structural assessment of the Northern Wing expansion for Project X.',
    solution: {
      ...sampleSolution,
      files: [
        {
          id: 'sol-file-001',
          fileName: 'Engineering_Calculations.pdf',
          fileType: 'pdf',
          description: 'Stress analysis calculations',
        },
        {
          id: 'sol-file-002',
          fileName: 'CFRP_Specifications.xlsx',
          fileType: 'xlsx',
          description: 'Material specifications',
        },
      ],
    },
    requestFiles: sampleFiles,
    stages: sampleStages,
    activities: sampleActivities,
    lastModified: '2023-10-28T11:15:00',
  }

  // Solution Rejected Data
  const solutionRejectedData = {
    ...solutionData,
    status: 'solution_rejected' as const,
    rejection: {
      reason: 'The CFRP solution does not meet the required safety factor of 2.0 for this load condition. Please revise with additional reinforcement or alternative approach.',
      rejectedBy: 'Amanda Thorne',
      rejectedAt: '2023-10-27T14:20:00',
    },
  }

  // Final Approval Data
  const finalApprovalData = {
    id: 'req-001',
    referenceId: '#STR-2023-0442',
    title: 'Structural Integrity Report - Project X',
    status: 'final_approval' as const,
    submitter: {
      name: 'Sarah Jenkins',
      role: 'Struct. Eng',
      email: 's.jenkins@firm.com',
      initials: 'SJ',
    },
    requestDescription: 'The initial request involves a comprehensive structural assessment of the Northern Wing expansion for Project X.',
    solution: {
      ...sampleSolution,
      files: [
        {
          id: 'sol-file-001',
          fileName: 'Engineering_Calculations.pdf',
          fileType: 'pdf',
          description: 'Stress analysis calculations',
        },
      ],
    },
    requestFiles: sampleFiles,
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
            comment: 'Awaiting budget and resource approval.',
            timestamp: '-',
          },
        ],
      },
    ],
    activities: [
      ...sampleActivities,
      {
        id: 'act-004',
        action: 'Final approval initiated',
        user: 'David Miller',
        timestamp: '2023-10-28T08:00:00',
        details: 'Started 2-level approval chain',
      },
      {
        id: 'act-005',
        action: 'Level 1 approved',
        user: 'Dr. Alan Grant',
        timestamp: '2023-10-28T09:00:00',
        details: 'Technical review completed',
      },
    ],
    lastModified: '2023-10-28T11:15:00',
    finalApproval: {
      initiatedBy: 'David Miller',
      initiatedAt: '2023-10-28T08:00:00',
      currentLevel: 1,
      totalLevels: 2,
      nextApprover: 'M. Sterling',
    },
  }

  // Final Approval Rejected Data
  const finalApprovalRejectedData = {
    ...finalApprovalData,
    status: 'final_rejected' as const,
    rejection: {
      reason: 'Budget constraints in Q4. Recommend postponing to Q1 next year when new funding is available.',
      rejectedBy: 'M. Sterling',
      rejectedAt: '2023-10-29T10:30:00',
    },
  }

  const modalCards = [
    {
      id: 'request',
      title: '1. Request Status',
      description: 'Improvement request submitted, awaiting initial approval',
      icon: <FileText className="w-5 h-5 text-blue-600" />,
      status: 'request',
      features: ['Approval actions (approve/reject)', 'Activity timeline', 'File attachments'],
    },
    {
      id: 'solution',
      title: '2. Solution Status',
      description: 'Engineering solution submitted with custom hierarchy toggle',
      icon: <CheckCircle2 className="w-5 h-5 text-purple-600" />,
      status: 'solution',
      features: ['Custom approval hierarchy picker', 'Solution cost display', 'Approval/Reject actions'],
    },
    {
      id: 'solution-rejected',
      title: '2b. Solution Rejected',
      description: 'Solution was rejected with reason, awaiting resubmission',
      icon: <AlertTriangle className="w-5 h-5 text-red-600" />,
      status: 'solution_rejected',
      features: ['Rejection banner with reason', 'Resubmit button', 'Red status indicators'],
    },
    {
      id: 'final-approval',
      title: '3. Final Approval',
      description: 'Final department approval with custom chain initiation',
      icon: <Shield className="w-5 h-5 text-amber-600" />,
      status: 'final_approval',
      features: ['Initiate final approval button', 'Custom/default hierarchy toggle', 'Progress indicator'],
    },
    {
      id: 'final-rejected',
      title: '3b. Final Approval Rejected',
      description: 'Final approval was rejected, can restart process',
      icon: <AlertTriangle className="w-5 h-5 text-red-600" />,
      status: 'final_rejected',
      features: ['Rejection banner', 'Restart final approval button', 'Approval progress preserved'],
    },
  ]

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 p-6 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-slate-100 mb-2">
            Status Modal Prototypes
          </h1>
          <p className="text-slate-600 dark:text-slate-400 max-w-2xl">
            Preview all status-specific modal designs. Each modal is adapted for its specific workflow 
            with appropriate actions, custom hierarchy options, and rejection handling.
          </p>
        </div>

        {/* Features Summary */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-2 mb-2">
              <RotateCcw className="w-4 h-4 text-emerald-600" />
              <h3 className="font-bold text-sm">Retractable Timeline</h3>
            </div>
            <p className="text-xs text-slate-500">
              Activity timeline can be collapsed/expanded to save space
            </p>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-4 h-4 text-purple-600" />
              <h3 className="font-bold text-sm">Custom Hierarchy</h3>
            </div>
            <p className="text-xs text-slate-500">
              Solution and Final Approval support custom approval chains
            </p>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              <h3 className="font-bold text-sm">Reject Handling</h3>
            </div>
            <p className="text-xs text-slate-500">
              All statuses support rejection with reason and resubmission
            </p>
          </div>
        </div>

        {/* Modal Cards Grid */}
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
                    <h3 className="font-bold text-slate-900 dark:text-slate-100">
                      {card.title}
                    </h3>
                    <span className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                      card.status === 'request' && "bg-blue-100 text-blue-700",
                      card.status === 'solution' && "bg-purple-100 text-purple-700",
                      card.status === 'solution_rejected' && "bg-red-100 text-red-700",
                      card.status === 'final_approval' && "bg-amber-100 text-amber-700",
                      card.status === 'final_rejected' && "bg-red-100 text-red-700",
                    )}>
                      {card.status.replace('_', ' ')}
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

        {/* Instructions */}
        <div className="mt-8 bg-emerald-50 dark:bg-emerald-900/10 rounded-xl p-5 border border-emerald-200 dark:border-emerald-800/30">
          <h3 className="font-bold text-emerald-900 dark:text-emerald-400 mb-2">
            How to Use
          </h3>
          <ul className="space-y-1 text-sm text-emerald-800 dark:text-emerald-300">
            <li>• Click any card above to open the corresponding modal prototype</li>
            <li>• Each modal has a retractable activity timeline (click to expand/collapse)</li>
            <li>• Try the approval/reject actions and custom hierarchy toggles</li>
            <li>• Modal scrolls internally - page scroll is locked when modal is open</li>
          </ul>
        </div>
      </div>

      {/* Modals */}
      <StatusModal
        data={requestData}
        open={activeModal === 'request'}
        onOpenChange={() => setActiveModal(null)}
        onApprove={() => alert('Request approved!')}
        onReject={(reason) => alert(`Request rejected: ${reason}`)}
        onResubmit={() => alert('Resubmitting request...')}
      />

      <SolutionModal
        data={solutionData}
        open={activeModal === 'solution'}
        onOpenChange={() => setActiveModal(null)}
        onApprove={() => alert('Solution approved!')}
        onReject={(reason) => alert(`Solution rejected: ${reason}`)}
        availableUsers={sampleAvailableUsers}
      />

      <SolutionModal
        data={solutionRejectedData}
        open={activeModal === 'solution-rejected'}
        onOpenChange={() => setActiveModal(null)}
        onResubmit={() => alert('Resubmitting solution...')}
        availableUsers={sampleAvailableUsers}
      />

      <FinalApprovalModal
        data={finalApprovalData}
        open={activeModal === 'final-approval'}
        onOpenChange={() => setActiveModal(null)}
        onApprove={() => alert('Final approval granted!')}
        onReject={(reason) => alert(`Final approval rejected: ${reason}`)}
        onInitiateFinalApproval={(useCustom, approvers) => 
          alert(`Initiated final approval. Custom: ${useCustom}. Approvers: ${approvers?.length || 0}`)
        }
        availableUsers={sampleAvailableUsers}
        canInitiate={true}
        canApprove={true}
      />

      <FinalApprovalModal
        data={finalApprovalRejectedData}
        open={activeModal === 'final-rejected'}
        onOpenChange={() => setActiveModal(null)}
        onRestartFinalApproval={() => alert('Restarting final approval process...')}
        availableUsers={sampleAvailableUsers}
        canInitiate={true}
      />
    </div>
  )
}

// Helper for className
function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ')
}
