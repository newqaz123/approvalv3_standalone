'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { RequestDetailDesktopV2 } from '@/components/requests/request-detail-desktop-v2'

// Sample data matching your prototype - V2 with simplified statuses
const sampleRequestDataV2 = {
  id: 'req-001',
  referenceId: '#STR-2023-0442',
  title: 'Structural Integrity Report - Project X',
  status: 'completed' as const,
  submitter: {
    name: 'Sarah Jenkins',
    role: 'Struct. Eng',
    email: 's.jenkins@firm.com',
    initials: 'SJ',
  },
  cost: 142500,
  currency: 'USD',
  solutionDescription: 'To address the structural deficiency, we recommend the implementation of CFRP (Carbon Fiber Reinforced Polymer) strengthening on the underside of Girders G-12 through G-18. This solution provides the necessary 25% increase in tensile strength.',
  requestDescription: 'The initial request involves a comprehensive structural assessment of the Northern Wing expansion for Project X. Concerns were raised regarding the load-bearing capacity of the primary steel girders under the proposed updated mechanical equipment layout. The scope includes site inspections, material fatigue testing, and a revised stress analysis.',
  files: [
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
    {
      id: 'file-004',
      fileName: 'Compliance_Statement.docx',
      fileType: 'docx',
      description: 'ISO 9001 adherence',
    },
  ],
  stages: [
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
        {
          id: 'step-003',
          name: 'Ken Liu',
          role: 'Project Coord',
          status: 'approved' as const,
          comment: 'Ticket created in ERP system. ID #99821.',
          timestamp: '2023-10-24T11:00:00',
          avatar: 'KL',
        },
      ],
    },
    {
      stageNumber: 2,
      stageName: 'Engineering Solution',
      steps: [
        {
          id: 'step-004',
          name: 'Robert Chen',
          role: 'Engineering L3',
          status: 'approved' as const,
          comment: 'Specs meet safety thresholds. CFRP is appropriate.',
          timestamp: '2023-10-26T09:45:00',
        },
        {
          id: 'step-005',
          name: 'Amanda Thorne',
          role: 'QC Level 2',
          status: 'approved' as const,
          comment: 'Compliance check completed. Methodology aligns.',
          timestamp: '2023-10-27T14:20:00',
        },
        {
          id: 'step-006',
          name: 'Sarah Mills',
          role: 'HSE Officer',
          status: 'approved' as const,
          comment: 'Safety protocols for height work approved.',
          timestamp: '2023-10-27T15:10:00',
        },
      ],
    },
    {
      stageNumber: 3,
      stageName: 'Final Approval',
      steps: [
        {
          id: 'step-007',
          name: 'Dr. Alan Grant',
          role: 'Chief Engineer',
          status: 'approved' as const,
          comment: 'Safety factor > 2.0. Proceed with implementation.',
          timestamp: '2023-10-27T16:45:00',
        },
        {
          id: 'step-008',
          name: 'M. Sterling',
          role: 'Dept. Head',
          status: 'approved' as const,
          comment: 'Project cleared. Funding allocated in Q4 budget.',
          timestamp: '2023-10-28T11:15:00',
        },
        {
          id: 'step-009',
          name: 'Director Board',
          role: 'Executive Review',
          status: 'pending' as const,
          comment: 'Awaiting final executive sign-off.',
          timestamp: '-',
        },
      ],
    },
  ],
  activities: [
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
      action: 'Logged to ERP',
      user: 'Ken Liu',
      timestamp: '2023-10-24T11:00:00',
      details: 'Ticket #99821 created in ERP system',
    },
    {
      id: 'act-004',
      action: 'Solution approved',
      user: 'Robert Chen',
      timestamp: '2023-10-26T09:45:00',
      details: 'Engineering L3 approved CFRP solution',
    },
    {
      id: 'act-005',
      action: 'QC approved',
      user: 'Amanda Thorne',
      timestamp: '2023-10-27T14:20:00',
      details: 'Quality control check passed',
    },
    {
      id: 'act-006',
      action: 'HSE reviewed',
      user: 'Sarah Mills',
      timestamp: '2023-10-27T15:10:00',
      details: 'Safety protocols approved',
    },
    {
      id: 'act-007',
      action: 'Endorsed',
      user: 'Dr. Alan Grant',
      timestamp: '2023-10-27T16:45:00',
      details: 'Chief engineer endorsement granted',
    },
    {
      id: 'act-008',
      action: 'Final approval',
      user: 'M. Sterling',
      timestamp: '2023-10-28T11:15:00',
      details: 'Department head approved Q4 funding',
    },
  ],
  lastModified: '2023-10-28T11:15:00',
}

export default function PreviewPageV2() {
  const [open, setOpen] = useState(false)

  const handleDownloadPDF = () => {
    console.log('Downloading PDF...')
    alert('PDF download would be triggered here')
  }

  const handleDownloadFile = (fileId: string) => {
    console.log('Downloading file:', fileId)
    alert(`File download would be triggered for: ${fileId}`)
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-4">
          <span className="bg-emerald-500 text-white text-xs font-bold px-2 py-1 rounded">V2</span>
          <h1 className="text-2xl font-bold">Request Detail Desktop Preview</h1>
        </div>
        
        <p className="text-slate-600 dark:text-slate-400 mb-6">
          Updated prototype with simplified status actions and Activity Timeline for audit trail.
        </p>

        <div className="space-y-3 mb-8">
          <Button 
            onClick={() => setOpen(true)}
            className="mr-3"
          >
            Open Request Detail (V2)
          </Button>
          
          <Button 
            variant="outline"
            onClick={() => window.location.href = '/preview-request-detail'}
          >
            Go to V1
          </Button>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-lg p-6 border border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold mb-4">V2 Changes:</h2>
          <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
            <li className="flex items-start gap-2">
              <span className="text-emerald-500 font-bold">✓</span>
              <span><strong>Green checkmark</strong> - Approved steps now show bright green check icons</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-500 font-bold">✓</span>
              <span><strong>Simplified statuses</strong> - Only SUBMITTED, APPROVED, PENDING</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-500 font-bold">✓</span>
              <span><strong>Activity Timeline</strong> - Audit trail log at the bottom with timeline visualization</span>
            </li>
          </ul>
        </div>

        <div className="mt-6 bg-slate-100 dark:bg-slate-800/50 rounded-lg p-4 text-sm text-slate-600 dark:text-slate-400">
          <h3 className="font-semibold mb-2">Status Colors:</h3>
          <div className="flex gap-4">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-blue-500"></span>
              Submitted
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-emerald-500"></span>
              Approved
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-slate-400"></span>
              Pending
            </span>
          </div>
        </div>

        <RequestDetailDesktopV2
          data={sampleRequestDataV2}
          open={open}
          onOpenChange={setOpen}
          onDownloadPDF={handleDownloadPDF}
          onDownloadFile={handleDownloadFile}
        />
      </div>
    </div>
  )
}
