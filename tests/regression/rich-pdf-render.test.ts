import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  renderDescriptionHtml,
  renderDescriptionPlainText,
} from '@/lib/formatted-text'

const read = (path: string) => readFileSync(path, 'utf8')

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

describe("PDF and email render wiring", () => {
  it('PDF resolves descriptions through the owner-scoped inline image resolver', () => {
    const pdf = read('src/lib/pdf.ts')
    assert.match(pdf, /await resolveInlineImagesForPdf\(/)
    assert.match(pdf, /owner: \{ kind: ["']request["'], id: data\.id \}/)
    assert.match(pdf, /owner: \{ kind: ["']solution["'], id: data\.solution\.id \}/)
    assert.doesNotMatch(pdf, /escapeHtml\(data\.(solution\.)?description\)/)
    assert.match(pdf, /\.description a::after/)
    assert.match(pdf, /attr\(href\)/)
  })

  it('email routes descriptions through the shared helpers', () => {
    const mail = read('src/server-actions/notifications.ts')
    assert.match(mail, /renderDescriptionHtml\(/)
    assert.match(mail, /renderDescriptionPlainText\(/)
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
