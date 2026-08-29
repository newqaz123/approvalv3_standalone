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
    id: 'SOL-1',
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
  it('renders compact packet sections and escapes unsafe content', async () => {
    const html = await renderRequestEvidenceHTML({
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

  it('requires owner ids so descriptions can resolve owner-scoped images', async () => {
    const html = await renderRequestEvidenceHTML(sampleData)
    assert.ok(html.length > 0)
    assert.match(html, /Approval Evidence Packet/)
  })

  it('prints crop frames with safe responsive and page-break CSS', async () => {
    const html = await renderRequestEvidenceHTML(sampleData)

    assert.match(html, /\.description \.rich-text__image-frame\s*\{[^}]*overflow:\s*hidden/)
    assert.match(html, /\.description \.rich-text__image-frame\s*\{[^}]*max-width:\s*100%/)
    assert.match(html, /\.description \.rich-text__image-frame\s*\{[^}]*break-inside:\s*avoid/)
    assert.match(html, /\.description \.rich-text__image-frame\s*\{[^}]*page-break-inside:\s*avoid/)
    assert.match(html, /\.description \.rich-text__image-frame\[data-align='left'\]/)
    assert.match(html, /\.description \.rich-text__image-frame\[data-align='center'\]/)
    assert.match(html, /\.description \.rich-text__image-frame\[data-align='right'\]/)
    assert.match(html, /\.description \.rich-text__image-frame > img\s*\{[^}]*max-width:\s*none/)
  })
})
