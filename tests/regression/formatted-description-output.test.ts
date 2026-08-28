import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderFormattedTextHtml, renderFormattedTextPlainText } from '@/lib/formatted-text'

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
})
