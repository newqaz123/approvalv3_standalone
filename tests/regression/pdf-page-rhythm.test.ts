import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument, PDFName, PDFRawStream, PDFStream, PDFArray, PDFDict } from 'pdf-lib'
import zlib from 'node:zlib'
import {
  buildDocumentBannerTemplate,
  generateRequestPDF,
  resolvePdfRenderOptions,
  type RequestPDFData,
} from '../../src/lib/pdf'

/**
 * Focused regression coverage for the repeated document chrome and the
 * natural-flow pagination of the approval report.
 *
 * Sections render continuously in the approved order —
 *   Original Request → Engineering Solution → Attachment Index →
 *   Approval Chain → Activity Log —
 * and Chromium splits them wherever the current page runs out of room.
 * Page count therefore varies with content length; no section is forced
 * onto a fresh page.
 */

const parseTopMarginMm = (top: unknown): number => {
  const match = /^(\d+(?:\.\d+)?)mm$/.exec(String(top ?? ''))
  assert.ok(match, `expected a mm top margin, got ${String(top)}`)
  return Number(match[1])
}

/**
 * Extracts the text drawn on one PDF page. Chromium PDF text is emitted as
 * hex glyph runs mapped through per-font ToUnicode CMaps, so the helper
 * inflates the page content streams and the font CMaps and decodes the glyph
 * codes. Only used to locate section headings per page.
 */
async function extractPageText(doc: PDFDocument, pageIndex: number): Promise<string> {
  const page = doc.getPage(pageIndex)
  const inflate = (stream: PDFRawStream): string =>
    zlib.inflateSync(Buffer.from(stream.contents)).toString('latin1')

  const resources = page.node.Resources()
  const fontDict = resources?.lookupMaybe(PDFName.of('Font'), PDFDict)
  const cmaps = new Map<string, Map<number, string>>()
  if (fontDict) {
    for (const [name, ref] of fontDict.entries()) {
      const font = doc.context.lookup(ref)
      if (!(font instanceof PDFDict)) continue
      const toUnicode = font.lookupMaybe(PDFName.of('ToUnicode'), PDFStream)
      if (!(toUnicode instanceof PDFRawStream)) continue
      const cmap = new Map<number, string>()
      const cmapText = inflate(toUnicode)
      for (const block of cmapText.match(/beginbfchar[\s\S]*?endbfchar/g) ?? []) {
        for (const m of block.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
          cmap.set(parseInt(m[1], 16), hexToUnicode(m[2]))
        }
      }
      for (const block of cmapText.match(/beginbfrange[\s\S]*?endbfrange/g) ?? []) {
        for (const m of block.matchAll(
          /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([^\]]*)\])/g,
        )) {
          const lo = parseInt(m[1], 16)
          const hi = parseInt(m[2], 16)
          if (m[3]) {
            const base = parseInt(m[3], 16)
            for (let c = lo; c <= hi; c++) cmap.set(c, String.fromCodePoint(base + c - lo))
          } else if (m[4]) {
            const dsts = [...m[4].matchAll(/<([0-9A-Fa-f]+)>/g)].map((x) => hexToUnicode(x[1]))
            for (let i = 0; lo + i <= hi; i++) cmap.set(lo + i, dsts[i] ?? '')
          }
        }
      }
      cmaps.set(name.asString(), cmap)
    }
  }

  let content = ''
  const collect = (node: unknown): void => {
    const resolved =
      node instanceof PDFRawStream
        ? node
        : doc.context.lookupMaybe(node as Parameters<typeof doc.context.lookupMaybe>[0], PDFStream)
    if (node instanceof PDFArray) {
      for (let i = 0; i < node.size(); i++) collect(node.get(i))
    } else if (resolved instanceof PDFRawStream) {
      content += inflate(resolved)
    }
  }
  collect(doc.context.lookup(page.node.get(PDFName.of('Contents'))))

  const decode = (hex: string, map: Map<number, string> | undefined): string => {
    if (!map) return ''
    let out = ''
    const step = hex.length % 4 === 0 ? 4 : 2
    for (let i = 0; i + step <= hex.length; i += step) {
      out += map.get(parseInt(hex.slice(i, i + step), 16)) ?? ''
    }
    return out
  }

  let current: Map<number, string> | undefined
  let text = ''
  const tokens =
    content.matchAll(/\/(F\d+)\s+[\d.]+\s+Tf|<([0-9A-Fa-f\s]+)>\s*(?:Tj|'|")|\(((?:[^()\\]|\\.)*)\)\s*(?:Tj|'|")/g)
  for (const m of tokens) {
    if (m[1]) {
      current = cmaps.get(`/${m[1]}`)
    } else if (m[2] !== undefined) {
      text += decode(m[2].replace(/\s+/g, ''), current)
    } else if (m[3] !== undefined) {
      text += m[3]
    }
  }
  return text.replace(/\s+/g, '')
}

const hexToUnicode = (hex: string): string => {
  let out = ''
  for (let i = 0; i + 4 <= hex.length; i += 4) {
    out += String.fromCodePoint(parseInt(hex.slice(i, i + 4), 16))
  }
  return out
}

/** Section-start markers located in the per-page extracted text. */
const SECTIONS = {
  originalRequest: 'ORIGINALREQUEST',
  // The approved-cost strip always directly follows the Engineering Solution
  // section head (the head carries break-after: avoid), so it marks that the
  // section starts on the page.
  engineeringSolution: 'APPROVEDCOST',
  attachmentIndex: 'ATTACHMENTINDEX',
  approvalChain: 'APPROVALCHAIN',
  activityLog: 'ACTIVITYLOG',
} as const

/** Controlled rich normal-content fixture matching the approved reference density. */
const richFixture: RequestPDFData = {
  id: 'REQ-RHYTHM-1',
  referenceId: 'REF-RHYTHM-001',
  title: 'Q3 Multi-Region Infrastructure Upgrade',
  description:
    '<p>This document outlines the Q3 multi-region infrastructure upgrade to improve latency and availability.</p>' +
    '<p>The architecture will feature multi-tiered caching and data sharding to achieve p99 latency under 50ms.</p>' +
    '<p>High-availability requirements dictate cross-region replication with automated disaster recovery.</p>' +
    '<ol><li><strong>Provision additional cross-region nodes.</strong></li><li>Configure global load balancer health checks.</li><li>Third requirement item.</li></ol>' +
    '<table><thead><tr><th>Column 1</th><th>Column 2</th><th>Column 3</th></tr></thead><tbody><tr><td>Cell A</td><td>Cell B</td><td>Cell C</td></tr></tbody></table>',
  requester: { name: 'eng staff', email: 'eng@example.com', department: 'Engineering' },
  department: 'Engineering',
  status: 'Completed',
  createdAt: new Date('2026-08-30T12:34:00Z'),
  completedAt: new Date('2026-08-31T14:41:00Z'),
  solution: {
    id: 'SOL-RHYTHM-1',
    title: 'Active-active cluster rollout',
    description:
      '<p>The engineering team will deploy a new multi-region active-active cluster.</p>' +
      '<p>This deployment ensures zero-downtime during the Q3 migration window.</p>' +
      '<ol><li>Provision additional cross-region nodes.</li><li>Configure global load balancer health checks.</li><li>Implement multi-tiered Redis caching.</li><li>Shard primary database across three regions.</li><li>Synchronize data using CDC pipelines.</li><li>Update application routing configurations.</li><li>Execute automated disaster recovery drills.</li><li>Monitor system metrics for 24 hours.</li><li>Conduct final performance benchmarking.</li><li>Handover to operations team.</li></ol>',
    costEstimate: 185000,
    currency: 'THB',
    timeline: '3 days',
    submittedBy: 'Engineer A',
    submittedAt: new Date('2026-08-30T13:39:00Z'),
    fileAttachments: [
      {
        fileName: 'requests.xlsx',
        fileSize: 21812,
        fileType: 'application/vnd.ms-excel',
        createdAt: new Date('2026-08-26T08:00:00Z'),
      },
    ],
  },
  fileAttachments: [
    {
      fileName: 'logo_v2.png',
      fileSize: 265830,
      fileType: 'image/png',
      createdAt: new Date('2026-08-30T12:34:00Z'),
      uploadedBy: 'eng staff',
    },
  ],
  approvalPhases: [
    {
      phaseName: 'Phase 1: Initial Review',
      phaseOrder: 1,
      approvals: [
        {
          approverName: 'eng sup',
          approverRole: 'Chief Engineer',
          approverDepartment: 'Engineering',
          requiredLevel: 2,
          status: 'approved',
          comments: 'Approved at level 2',
          approvedAt: new Date('2026-08-30T13:35:00Z'),
          order: 1,
          stage: 'Initial Request',
          isSolutionApproval: false,
        },
      ],
    },
    {
      phaseName: 'Phase 2: Engineering Solution',
      phaseOrder: 2,
      approvals: [
        {
          approverName: 'eng sup',
          approverRole: 'Chief Engineer',
          approverDepartment: 'Engineering',
          requiredLevel: 2,
          status: 'approved',
          comments: 'Auto-approved (top-level submitter)',
          approvedAt: new Date('2026-08-30T13:39:00Z'),
          order: 1,
          stage: 'Solution Review',
          isSolutionApproval: true,
        },
      ],
    },
    {
      phaseName: 'Phase 3: Final Approval',
      phaseOrder: 3,
      approvals: [
        {
          approverName: 'eng sup',
          approverRole: 'Chief Engineer',
          approverDepartment: 'Engineering',
          requiredLevel: 2,
          status: 'approved',
          comments: 'Auto-approved (top-level initiator)',
          approvedAt: new Date('2026-08-30T13:41:00Z'),
          order: 1,
          stage: 'Final Approval 1',
          isSolutionApproval: false,
        },
      ],
    },
  ],
  activities: [
    { action: 'Final approval initiated', userName: 'eng sup', createdAt: new Date('2026-08-30T13:41:00Z'), comments: 'Final approval auto-approved (top-level initiator)' },
    { action: 'Status changed', userName: 'eng staff', createdAt: new Date('2026-08-30T13:41:00Z'), comments: 'Request marked as completed' },
    { action: 'Solution submitted', userName: 'eng sup', createdAt: new Date('2026-08-30T13:39:00Z'), comments: 'Solution submitted with cost estimate 185000 THB' },
    { action: 'Status changed', userName: 'eng staff', createdAt: new Date('2026-08-30T13:39:00Z'), comments: 'Solution auto-approved. Request sent back to requester for final review.' },
    { action: 'Engineers assigned', userName: 'eng sup', createdAt: new Date('2026-08-30T13:36:00Z'), comments: '1 engineer(s) assigned to request' },
    { action: 'Status changed', userName: 'eng staff', createdAt: new Date('2026-08-30T13:35:00Z'), comments: 'Status changed from ImprovementRequest to SentToEngineer' },
    { action: 'Approved', userName: 'eng sup', createdAt: new Date('2026-08-30T13:35:00Z'), comments: 'Approved at level 2' },
    { action: 'File attached', userName: 'eng staff', createdAt: new Date('2026-08-30T13:34:00Z'), comments: 'File attached: logo_v2.png' },
    { action: 'Created', userName: 'eng staff', createdAt: new Date('2026-08-30T13:34:00Z'), comments: 'Request created' },
  ],
  generatedBy: 'Admin User',
}

describe('document chrome banner clearance', () => {
  it('reserves a top margin that keeps the repeated banner fully above the body on every page', () => {
    const options = resolvePdfRenderOptions({
      documentChrome: true,
      headerTemplate: buildDocumentBannerTemplate(richFixture),
      footerTemplate: '<span></span>',
    })

    const topMm = parseTopMarginMm(options.margin?.top)
    // Chromium paints the margin-box banner from the page top inset; the
    // tallest measured banner (two-line title plus plate shadow) reaches
    // ~40mm. 45mm keeps a visible gap above the first section band.
    assert.ok(
      topMm >= 45 && topMm <= 60,
      `banner chrome needs a top margin of at least 45mm to clear the body, got ${topMm}mm`,
    )
  })

  it('sizes the banner plate to sit at the chrome top inset without pushing it into the body', () => {
    const banner = buildDocumentBannerTemplate(richFixture)

    // The header margin box already offsets content ~5.5mm below the page
    // top, matching the approved reference banner inset, so the template
    // itself must not stack extra top padding on top of that offset.
    assert.match(banner, /padding:0 12mm 0/)
    assert.doesNotMatch(banner, /padding:5\.5mm 12mm 0/)
  })
})

describe('natural-flow pagination', () => {
  it('flows sections continuously instead of forcing each onto a fresh page', async () => {
    const pdfBuffer = await generateRequestPDF(richFixture)
    const doc = await PDFDocument.load(pdfBuffer)
    const pageCount = doc.getPageCount()
    const pageText = await Promise.all(
      Array.from({ length: pageCount }, (_, i) => extractPageText(doc, i)),
    )

    // Natural flow must not reproduce the retired forced rhythm: this
    // normal-density fixture rendered as exactly four pages under forced
    // section breaks, so anything at or above four means a forced start is
    // back.
    assert.ok(
      pageCount < 4,
      `natural flow must not reproduce the forced four-page rhythm, got ${pageCount} pages:\n${pageText.map((t, i) => `page ${i + 1}: ${t.slice(0, 120)}`).join('\n')}`,
    )

    // Engineering Solution continues on page 1 right after Original Request
    // instead of being pushed onto its own page.
    assert.match(pageText[0], new RegExp(SECTIONS.originalRequest), 'Original Request must open page 1')
    assert.ok(
      pageText[0].includes(SECTIONS.engineeringSolution),
      'Engineering Solution must continue on page 1 after Original Request',
    )

    // Every section renders exactly once, in the approved order.
    const order = [
      SECTIONS.originalRequest,
      SECTIONS.engineeringSolution,
      SECTIONS.attachmentIndex,
      SECTIONS.approvalChain,
      SECTIONS.activityLog,
    ]
    const documentText = pageText.join('|')
    const positions = order.map((marker) => documentText.indexOf(marker))
    assert.ok(
      positions.every((position) => position !== -1),
      `every section must render, positions: ${positions.join(',')}`,
    )
    assert.deepEqual([...positions].sort((left, right) => left - right), positions)
  })

  it('keeps paginating naturally when rich content overflows', async () => {
    const longParagraphs = Array.from(
      { length: 160 },
      (_, i) => `<p>Overflow paragraph ${i + 1}: the natural-flow layout must keep paginating rich request content across as many pages as the content needs.</p>`,
    ).join('')
    const pdfBuffer = await generateRequestPDF({
      ...richFixture,
      description: `<p>Long-running request context.</p>${longParagraphs}`,
    })
    const doc = await PDFDocument.load(pdfBuffer)

    assert.ok(
      doc.getPageCount() > 2,
      `long content must keep paginating naturally, got ${doc.getPageCount()} pages`,
    )
  })
})
