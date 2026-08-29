import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  renderDescriptionHtml,
  renderDescriptionPlainText,
  renderFormattedTextHtml,
  renderFormattedTextPlainText,
} from '@/lib/formatted-text'

const read = (path: string) => readFileSync(path, 'utf8')

describe('formatted description output contexts', () => {
  it('renders safe HTML and plain text from the shared output helpers', () => {
    assert.equal(renderFormattedTextHtml('A **bold**\n<script>alert(1)</script>'), 'A <strong>bold</strong><br />&lt;script&gt;alert(1)&lt;/script&gt;')
    assert.equal(renderFormattedTextPlainText('A **bold**\nB'), 'A bold\nB')
  })

  it('uses shared formatted output in notification email generation', () => {
    const source = read('src/server-actions/notifications.ts')
    assert.match(source, /renderDescriptionHtml\(details\.description, 280\)/)
    assert.match(source, /renderDescriptionPlainText\(details\.description, 280\)/)
    assert.doesNotMatch(source, /buildDetailRow\('Description',[^\n]*escapeHtml\(value\)/)
  })

  it('resolves descriptions through the owner-scoped inline image resolver in PDF generation', () => {
    const source = read('src/lib/pdf.ts')
    assert.match(source, /resolveInlineImagesForPdf\(\{\s*html: data\.solution\.description,\s*owner: \{ kind: ["']solution["'], id: data\.solution\.id \}/)
    assert.match(source, /resolveInlineImagesForPdf\(\{\s*html: data\.description,\s*owner: \{ kind: ["']request["'], id: data\.id \}/)
    assert.doesNotMatch(source, /escapeHtml\(data\.description\)/)
    assert.doesNotMatch(source, /escapeHtml\(data\.solution\.description\)/)
  })

  it('does not emit dangerous HTML from output helpers', () => {
    const html = renderFormattedTextHtml('**<img src=x onerror=alert(1)>**')
    assert.equal(html, '<strong>&lt;img src=x onerror=alert(1)&gt;</strong>')
    // Escaped text may still contain the substring "onerror="; assert no raw tag opens.
    assert.doesNotMatch(html, /<img\b/i)
    assert.doesNotMatch(html, /<(?!strong\b|\/strong\b|br\b)[^>]*>/i)
  })

  it('preserves approved palette presentation in HTML email and strips it from plain text', () => {
    const source = '<p><span data-text-color="red">Keep <mark data-highlight="gray">these words</mark></span></p>'

    assert.equal(
      renderDescriptionHtml(source),
      '<p><span style="color:#B91C1C">Keep <mark style="background-color:#E2E8F0">these words</mark></span></p>',
    )
    assert.equal(renderDescriptionPlainText(source), 'Keep these words')
  })

  it('fix 3: removes private image references from ordinary HTML-email text only', () => {
    const source = '<p><strong>Before /api/inline-images/123e4567-e89b-42d3-a456-426614174000 middle data:image/png;base64,AAAA after</strong></p>'
    const html = renderDescriptionHtml(source)

    assert.match(html, /^<p><strong>Before .* middle .* after<\/strong><\/p>$/)
    assert.doesNotMatch(html, /\/api\/inline-images\/[0-9a-f-]{36}|data:image\//i)
    assert.match(renderDescriptionPlainText(source), /\/api\/inline-images|data:image\//)

    const legacyHtml = renderDescriptionHtml(
      'Before **/api/inline-images/123e4567-e89b-42d3-a456-426614174000** and data:image/webp;base64,BBBB after',
    )
    assert.match(legacyHtml, /^Before <strong>.*<\/strong> and .* after$/)
    assert.doesNotMatch(legacyHtml, /\/api\/inline-images\/[0-9a-f-]{36}|data:image\//i)
  })

  it('fix round 2: preserves unrelated email formatting around split forbidden references', () => {
    const html = renderDescriptionHtml(
      '<p><strong>Safe before </strong>/api/inline-<em>images/123e4567-e89b-42d3-a456-426614174000</em><mark data-highlight="pink"> safe middle </mark>data:<u>image/webp;base64,BBBB</u><strong> safe after</strong></p>',
    )

    assert.equal(
      html,
      '<p><strong>Safe before </strong>[redacted]<mark style="background-color:#FCE7F3"> safe middle </mark>[redacted]<strong> safe after</strong></p>',
    )
    assert.doesNotMatch(
      html.replace(/<[^>]+>/g, ''),
      /\/api\/inline-images\/[0-9a-f-]{36}|data:image\//i,
    )
  })
})
