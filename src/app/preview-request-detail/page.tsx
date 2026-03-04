'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { RequestDetailDesktop } from '@/components/requests/request-detail-desktop'

// Sample data matching your prototype
const sampleRequestData = {
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
          status: 'verified' as const,
          comment: 'Verified damage extent. Escalating to engineering.',
          timestamp: '2023-10-24T10:30:00',
          avatar: 'JW',
        },
        {
          id: 'step-003',
          name: 'Ken Liu',
          role: 'Project Coord',
          status: 'logged' as const,
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
          status: 'reviewed' as const,
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
          status: 'endorsed' as const,
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
  lastModified: '2023-10-28T11:15:00',
}

export default function PreviewPage() {
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
        <h1 className="text-2xl font-bold mb-4">Request Detail Desktop Preview</h1>
        <p className="text-slate-600 dark:text-slate-400 mb-8">
          Click the button below to see the desktop version of your request detail modal.
        </p>
        
        <Button 
          onClick={() => setOpen(true)}
          className="mb-4"
        >
          Open Request Detail (Desktop)
        </Button>

        <div className="bg-white dark:bg-slate-800 rounded-lg p-6 border border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold mb-2">Features:</h2>
          <ul className="list-disc list-inside space-y-1 text-sm text-slate-600 dark:text-slate-400">
            <li>Desktop-optimized layout with larger text and spacing</li>
            <li>2-column layout for description and files</li>
            <li>Approval flow with status indicators and avatars</li>
            <li>File attachments with type-specific icons</li>
            <li>Scrollable content with sticky header/footer</li>
            <li>Dark mode support</li>
          </ul>
        </div>

        <RequestDetailDesktop
          data={sampleRequestData}
          open={open}
          onOpenChange={setOpen}
          onDownloadPDF={handleDownloadPDF}
          onDownloadFile={handleDownloadFile}
        />
      </div>
    </div>
  )
}
