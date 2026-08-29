import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  renderDescriptionHtml,
  renderDescriptionPlainText,
} from '@/lib/formatted-text'
import { renderRequestEvidenceHTML, type RequestPDFData } from '@/lib/pdf'

const PDF_FIXTURE: RequestPDFData = {
  id: 'REQ-PDF-1',
  title: 'PDF palette fixture',
  description: '<p>plain</p>',
  requester: { name: 'Requester', email: 'requester@example.com', department: 'Operations' },
  department: 'Operations',
  status: 'Completed',
  createdAt: new Date('2026-05-01T08:00:00Z'),
  fileAttachments: [],
  approvalPhases: [],
  activities: [],
  generatedBy: 'Test runner',
}

describe('renderDescriptionHtml', () => {
  it('returns sanitized HTML for rich sources and legacy markup otherwise', () => {
    assert.ok(renderDescriptionHtml('<p onclick="x()">hi</p>').includes('<p>hi</p>'))
    assert.ok(!renderDescriptionHtml('<p onclick="x()">hi</p>').includes('onclick'))
    assert.equal(renderDescriptionHtml('plain **b**'), renderDescriptionHtml('plain **b**'))
    assert.ok(renderDescriptionHtml('plain **b**').includes('<strong>b</strong>'))
  })

  it('plain-text helper strips tags and keeps bold markers for legacy', () => {
    assert.ok(!renderDescriptionPlainText('<p>a<b>b</b></p>').includes('<'))
    assert.ok(renderDescriptionPlainText('x **y**').includes('y'))
  })

  it('preserves sanitized rich HTML when the visible text fits the budget', () => {
    const out = renderDescriptionHtml('<p>short <strong>rich</strong> text</p>', 280)
    assert.ok(out.includes('<strong>rich</strong>'), 'tags should survive for short rich text')
    assert.ok(out.includes('<p>'), 'block markup should survive')
  })

  it('preserves balanced trusted markup when rich text exceeds the budget', () => {
    const long = '<p><span data-text-color="blue">' + 'word '.repeat(100) + '</span></p>'
    const out = renderDescriptionHtml(long, 40)
    assert.match(out, /^<p><span style="color:#1D4ED8">/)
    assert.match(out, /<\/span><\/p>$/)
    assert.equal(out.replace(/<[^>]+>/g, '').length, 40)
  })
})

describe('PDF evidence rendering', () => {
  it('materializes the shared Calm Document palette and rejects arbitrary styles', async () => {
    const html = await renderRequestEvidenceHTML({
      ...PDF_FIXTURE,
      description: '<p><span data-text-color="blue" style="color:#ff00ff;position:fixed">Calm <mark data-highlight="yellow" style="background:var(--hostile)">Document</mark></span></p>',
    })

    assert.match(html, /<span style="color:#1D4ED8">Calm <mark style="background-color:#FEF3C7">Document<\/mark><\/span>/)
    assert.doesNotMatch(html, /data-text-color|data-highlight|#ff00ff|var\(|position:fixed/)
  })
})

describe('renderDescriptionHtml email placeholders', () => {
  const IMG = '123e4567-e89b-42d3-a456-426614174000'

  it('replaces approved images with escaped alt placeholders inside kept formatting', () => {
    const out = renderDescriptionHtml(
      `<p><strong>b</strong> <img src="/api/inline-images/${IMG}" alt="floor plan" data-align="left"> tail</p>`,
      280,
    )
    assert.ok(out.includes('<strong>b</strong>'), 'formatting preserved')
    assert.ok(out.includes('[Image: floor plan]'), 'placeholder present')
    assert.ok(!/<img\b/i.test(out), 'email HTML must not contain img tags')
    assert.ok(!out.includes('/api/inline-images'), 'no private image URL in email')
  })

  it('uses [Image] for empty alt text and keeps plain-text output aligned', () => {
    const source = `<p><img src="/api/inline-images/${IMG}" alt="" data-align="center"></p>`
    assert.ok(renderDescriptionHtml(source, 280).includes('[Image]'))
    assert.ok(renderDescriptionPlainText(source).includes('[Image]'))
    assert.ok(!renderDescriptionPlainText(source).includes('/api/inline-images'))
  })
})
