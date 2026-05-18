import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { renderRequestEvidenceHTML, type RequestPDFData } from '../../src/lib/pdf'

const sampleData: RequestPDFData = {
  id: 'REQ-1',
  referenceId: 'REF-001',
  title: 'Cooling Tower Motor Replacement',
  description: 'Replace damaged motor and verify alignment.',
  requester: {
    name: 'Narin P.',
    email: 'narin@example.com',
    department: 'Operations',
  },
  department: 'Operations',
  status: 'Completed',
  createdAt: new Date('2026-05-01T08:00:00Z'),
  completedAt: new Date('2026-05-10T08:00:00Z'),
  solution: {
    title: 'Motor replacement',
    description: 'Use approved spare motor and test vibration.',
    costEstimate: 185000,
    currency: 'THB',
    timeline: '3 days',
    submittedBy: 'Engineer A',
    submittedAt: new Date('2026-05-03T08:00:00Z'),
    fileAttachments: [
      {
        fileName: 'calculation.pdf',
        fileSize: 1234,
        fileType: 'application/pdf',
        createdAt: new Date('2026-05-03T08:00:00Z'),
      },
    ],
  },
  fileAttachments: [
    {
      fileName: 'scope.pdf',
      fileSize: 1234,
      fileType: 'application/pdf',
      createdAt: new Date('2026-05-01T08:00:00Z'),
      uploadedBy: 'Narin P.',
    },
  ],
  approvalPhases: [
    {
      phaseName: 'Phase 1: Initial Review',
      phaseOrder: 1,
      approvals: [
        {
          approverName: 'Manager A',
          approverRole: 'Plant Manager <script>alert("role")</script>',
          approverDepartment: 'Operations',
          requiredLevel: 1,
          status: 'approved',
          comments: 'Approved <script>alert("comment")</script>.',
          approvedAt: new Date('2026-05-02T08:00:00Z'),
          order: 1,
          stage: 'Manager Review',
          isSolutionApproval: false,
        },
      ],
    },
  ],
  activities: [
    {
      action: 'approved',
      userName: 'Manager A',
      createdAt: new Date('2026-05-02T08:00:00Z'),
      comments: 'Approved.',
    },
  ],
  generatedBy: 'Admin User',
}

describe('compact approval evidence HTML', () => {
  it('renders compact packet sections and escapes unsafe content', () => {
    const html = renderRequestEvidenceHTML({
      ...sampleData,
      description: 'Safe <script>alert("x")</script>',
    })

    assert.match(html, /Approval Evidence Packet/)
    assert.match(html, /summary-panel/)
    assert.match(html, /Department/)
    assert.match(html, /Attachment Index/)
    assert.match(html, /Approval Chain/)
    assert.match(html, /Activity Log/)
    assert.match(html, /REF-001/)
    assert.match(html, /Level/)
    assert.doesNotMatch(html, /<th>Role<\/th>/)
    assert.doesNotMatch(html, /<th>Type<\/th>/)
    assert.doesNotMatch(html, /Decision Summary/)
    assert.doesNotMatch(html, /Approval Steps/)
    assert.doesNotMatch(html, /<span>Evidence<\/span>/)
    assert.match(html, /Approved &lt;script&gt;alert/)
    assert.doesNotMatch(html, /<script>alert/)
    assert.match(html, /&lt;script&gt;alert/)
  })
})
