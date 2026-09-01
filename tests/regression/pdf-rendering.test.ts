import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument } from 'pdf-lib'
import {
  buildDocumentBannerTemplate,
  buildDocumentFooterTemplate,
  generateRequestPDF,
  renderRequestEvidenceHTML,
  resolvePdfRenderOptions,
  type RequestPDFData,
} from '../../src/lib/pdf'

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

describe('slate satin banner chrome', () => {
  it('builds the compact slate banner with white title, plain status label, and value-only inline metadata', () => {
    const banner = buildDocumentBannerTemplate(sampleData)

    // Compact premium slate-blue 8px-radius banner plate.
    assert.match(banner, /border-radius:\s*8px/)
    assert.match(banner, /linear-gradient\(110deg,\s*#3a5269\b/)
    assert.match(banner, /border:\s*1px solid #344b60/)
    // White large dynamic request name.
    assert.match(banner, /Cooling Tower Motor Replacement/)
    assert.match(banner, /font-size:\s*2[0-9]px/)
    assert.match(banner, /color:\s*#ffffff/)
    // Plain status text in the banner title row (no chip styling).
    assert.match(banner, /text-transform:\s*uppercase/)
    assert.match(banner, />Completed</)
    assert.doesNotMatch(banner, /border-radius:\s*999px/)
    // Value-only inline metadata (requester · department · date range).
    assert.match(banner, /Narin P\. · Operations · May 1, 2026 – May 10, 2026/)
    assert.doesNotMatch(banner, /Requester:|Department:|Dates:|Status:/)
  })

  it('repeats the banner through per-page header chrome and keeps live page numbers footer-only', () => {
    const options = resolvePdfRenderOptions({
      documentChrome: true,
      headerTemplate: buildDocumentBannerTemplate(sampleData),
      footerTemplate: buildDocumentFooterTemplate({
        reference: 'REF-001',
        generatedBy: 'Admin User',
      }),
    })

    assert.equal(options.displayHeaderFooter, true)
    // The banner chrome needs a banner-height top margin so it repeats on every
    // page without painting over the flowing body (tallest banner ~40mm).
    assert.match(String(options.margin?.top ?? ''), /^4[5-9]mm$|^5[0-9]mm$/, `expected banner-clearing top margin (>=45mm), got ${String(options.margin?.top)}`)
    assert.match(options.headerTemplate ?? '', /Cooling Tower Motor Replacement/)
    assert.ok(!options.headerTemplate?.includes('pageNumber'))
    assert.match(options.footerTemplate ?? '', /class="pageNumber"/)
    assert.match(options.footerTemplate ?? '', /class="totalPages"/)
    assert.match(options.footerTemplate ?? '', /Reference REF-001 · Generated on .* by Admin User/)
    assert.doesNotMatch(options.footerTemplate ?? '', /Approval System|Approval Evidence/i)
  })

  it('keeps the banner out of the flowing body so page one renders it exactly once', async () => {
    const html = await renderRequestEvidenceHTML(sampleData)

    assert.doesNotMatch(html, /document-header|class="banner"/)
    assert.doesNotMatch(html, /class="pageNumber"|class="totalPages"/)
    assert.doesNotMatch(html, /Page \d+ of \d+/)
  })

  it('keeps attachment pages full-view without document chrome by default', () => {
    const options = resolvePdfRenderOptions()

    assert.notEqual(options.displayHeaderFooter, true)
    assert.equal(options.footerTemplate, undefined)
    assert.equal(options.headerTemplate, undefined)
  })
})

describe('slate editorial report body', () => {
  it('flows sections in the approved order with Attachment Index after Engineering Solution', async () => {
    const html = await renderRequestEvidenceHTML(sampleData)
    const order = [
      'Original Request',
      'Engineering Solution',
      'Attachment Index',
      'Approval Chain',
      'Activity Log',
    ].map((label) => html.indexOf(label))

    assert.ok(order.every((index) => index !== -1), `missing a section, indexes: ${order.join(',')}`)
    assert.deepEqual([...order].sort((left, right) => left - right), order)
  })

  it('styles sections with tinted headers and hairline subheads instead of closed cards', async () => {
    const html = await renderRequestEvidenceHTML(sampleData)

    assert.match(html, /\.sec-head\s*\{[^}]*background:\s*#edf3f7/)
    assert.match(html, /\.sec-head\s*\{[^}]*text-transform:\s*uppercase/)
    assert.match(html, /\.subhead\s*\{[^}]*border-bottom:\s*1px solid #263b50/)
    assert.doesNotMatch(html, /\.section\b|section-card/)
  })

  it('renders approval status as plain typographic text without app-style chips', async () => {
    const html = await renderRequestEvidenceHTML(sampleData)

    assert.match(html, /<span class="pill approved">approved<\/span>/)
    assert.doesNotMatch(html, /\.status\b/)
    assert.doesNotMatch(html, /\.pill[^{]*\{[^}]*background/)
    assert.doesNotMatch(html, /\.pill[^{]*\{[^}]*border/)
  })

  it('renders Approved Cost as a full-width horizontal strip that does not constrain solution rich text', async () => {
    const html = await renderRequestEvidenceHTML(sampleData)

    assert.match(html, /\.cost-row\s*\{[^}]*grid-template-columns:\s*auto 1fr 1fr/)
    assert.match(html, /class="cost-row"/)
    assert.match(html, /Approved Cost/)
    // Currency renders with its ISO code like the approved mockup (THB 1.00).
    assert.match(html, /THB[\u00A0 ]185,000\.00/)
    assert.doesNotMatch(html, /solution-grid|solution-meta/)
    const solutionSection = html.indexOf('Engineering Solution')
    const costRow = html.indexOf('class="cost-row"')
    const solutionRichText = html.indexOf('Use approved spare motor')
    assert.ok(solutionSection !== -1 && costRow > solutionSection, 'cost strip belongs to the solution section')
    assert.ok(solutionRichText > costRow, 'solution rich text must follow the cost strip at full width')
  })

  it('escapes unsafe content across sections and keeps compact table columns', async () => {
    const html = await renderRequestEvidenceHTML({
      ...sampleData,
      description: 'Safe <script>alert("x")</script>',
    })

    assert.match(html, /Attachment Index/)
    assert.match(html, /Approval Chain/)
    assert.match(html, /Activity Log/)
    assert.match(html, /Level/)
    assert.doesNotMatch(html, /<th>Role<\/th>/)
    assert.doesNotMatch(html, /<th>Type<\/th>/)
    assert.doesNotMatch(html, /Decision Summary|Approval Steps|<span>Evidence<\/span>/)
    assert.match(html, /Approved &lt;script&gt;alert/)
    assert.doesNotMatch(html, /<script>alert/)
  })

  it('keeps Approval System and Approval Evidence branding out of the report', async () => {
    const html = await renderRequestEvidenceHTML(sampleData)
    const banner = buildDocumentBannerTemplate(sampleData)
    const footer = buildDocumentFooterTemplate({ reference: 'REF-001', generatedBy: 'Admin User' })

    for (const document of [html, banner, footer]) {
      assert.doesNotMatch(document, /Approval System|Approval Evidence|kicker/)
    }
  })

  it('requires owner ids so descriptions can resolve owner-scoped images', async () => {
    const html = await renderRequestEvidenceHTML(sampleData)
    assert.ok(html.length > 0)
    assert.match(html, /sec-head/)
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
    assert.match(
      html,
      /\.description \.rich-text__image-frame > img,\s*\.description \.rich-text__image-scene > img\s*\{[^}]*max-width:\s*none/,
    )
  })

  it('applies unambiguous left/center/right margins to bare images and crop frames', async () => {
    const html = await renderRequestEvidenceHTML(sampleData)

    assert.match(html, /\.description img\[data-align='left'\] \{ margin-left: 0; margin-right: auto; \}/)
    assert.match(html, /\.description img\[data-align='center'\] \{ margin-inline: auto; \}/)
    assert.match(html, /\.description img\[data-align='right'\] \{ margin-left: auto; margin-right: 0; \}/)
    assert.match(html, /\.description \.rich-text__image-frame\[data-align='left'\] \{ margin-left: 0; margin-right: auto; \}/)
    assert.match(html, /\.description \.rich-text__image-frame\[data-align='center'\] \{ margin-inline: auto; \}/)
    assert.match(html, /\.description \.rich-text__image-frame\[data-align='right'\] \{ margin-left: auto; margin-right: 0; \}/)
  })
})

describe('flowing packet pagination', () => {
  it('renders normal content as flowing A4 pages under the repeated chrome', async () => {
    const pdfBuffer = await generateRequestPDF(sampleData)
    const doc = await PDFDocument.load(pdfBuffer)
    const pageCount = doc.getPageCount()

    assert.ok(pageCount >= 1 && pageCount <= 6, `expected a compact flowing packet, got ${pageCount} pages`)
    const page = doc.getPage(0)
    assert.ok(Math.abs(page.getWidth() - 595.28) < 2, `unexpected page width ${page.getWidth()}`)
    assert.ok(Math.abs(page.getHeight() - 841.89) < 2, `unexpected page height ${page.getHeight()}`)
  })

  it('does not hard-code fixed page artwork in the flowing report HTML', async () => {
    const html = await renderRequestEvidenceHTML(sampleData)

    assert.doesNotMatch(html, /height:\s*297mm/)
    assert.doesNotMatch(html, /page-break-after:\s*always/)
    assert.doesNotMatch(html, /Continued on next page/)
  })

  it('lets sections flow continuously without forced page starts', async () => {
    const html = await renderRequestEvidenceHTML(sampleData)

    assert.doesNotMatch(html, /sec-new-page/)
    assert.doesNotMatch(html, /break-before:\s*page/)
    assert.doesNotMatch(html, /page-break-before:\s*always/)
  })

  it('repeats table headers and keeps report table rows unsplit across pages', async () => {
    const html = await renderRequestEvidenceHTML(sampleData)

    // Chromium repeats <thead> on continuation pages while every report
    // table row stays whole on a single page.
    assert.match(html, /thead\s*\{[^}]*display:\s*table-header-group/)
    assert.match(html, /\.sec tr\s*\{[^}]*break-inside:\s*avoid/)
    assert.match(html, /\.sec tr\s*\{[^}]*page-break-inside:\s*avoid/)
  })
})
