import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  renderDescriptionHtml,
  renderDescriptionPlainText,
  renderFormattedTextHtml,
  renderFormattedTextPlainText,
} from '@/lib/formatted-text'
import {
  computeInlineImageFrameGeometry,
  INLINE_IMAGE_CROP_SCALE,
} from '@/lib/inline-images/presentation'
import { materializeRichTextForApp } from '@/lib/rich-text-presentation'

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

  it('fix round 3: does not redact fragments separated by an email block boundary', () => {
    const html = renderDescriptionHtml(
      '<strong>Safe /api/inline-</strong><p>images/123e4567-e89b-42d3-a456-426614174000 safe block</p>',
    )

    assert.equal(
      html,
      '<strong>Safe /api/inline-</strong><p>images/123e4567-e89b-42d3-a456-426614174000 safe block</p>',
    )
  })
})

const IMAGE_ID = '123e4567-e89b-42d3-a456-426614174000'
const IMAGE_SRC = `/api/inline-images/${IMAGE_ID}`
const FULL_CROP = {
  x: 0,
  y: 0,
  width: INLINE_IMAGE_CROP_SCALE,
  height: INLINE_IMAGE_CROP_SCALE,
}
const PARTIAL_CROP = { x: 1000, y: 2000, width: 3000, height: 4000 }

function appImage(extra: string, align = 'center'): string {
  return `<img src="${IMAGE_SRC}" alt="Floor plan" data-align="${align}"${extra}>`
}

describe('application image placement and rotation output', () => {
  const cases = [
    { layout: 'inline', rotation: 0, cropped: false },
    { layout: 'inline', rotation: 90, cropped: false },
    { layout: 'inline', rotation: 270, cropped: true },
    { layout: 'block', rotation: 180, cropped: true },
  ] as const

  it('materializes inline/block placement, swapped quarter-turn aspect, and trusted geometry', () => {
    for (const testCase of cases) {
      const align = testCase.layout === 'block' ? 'right' : 'center'
      const attrs = [
        testCase.layout === 'inline' ? ' data-layout="inline"' : '',
        testCase.rotation === 0 ? '' : ` data-rotation="${testCase.rotation}"`,
        ' data-width="160"',
        ' data-natural-width="800"',
        ' data-natural-height="600"',
        testCase.cropped
          ? ` data-crop-x="${PARTIAL_CROP.x}" data-crop-y="${PARTIAL_CROP.y}" data-crop-width="${PARTIAL_CROP.width}" data-crop-height="${PARTIAL_CROP.height}"`
          : '',
      ].join('')
      const html = materializeRichTextForApp(`<p>before ${appImage(attrs, align)} after</p>`)

      assert.match(html, /^<p>before /)
      assert.match(html, / after<\/p>$/)

      if (testCase.layout === 'inline') {
        assert.match(html, /class="rich-text__image-frame"[^>]*data-layout="inline"/)
        assert.match(html, /style="[^"]*width:160px/)
      } else {
        assert.match(html, /<span class="rich-text__image-frame" data-align="right"/)
        assert.doesNotMatch(html, /data-layout="inline"/)
      }

      if (testCase.rotation === 0) {
        assert.doesNotMatch(html, /transform:rotate/)
        continue
      }

      const geometry = computeInlineImageFrameGeometry({
        crop: testCase.cropped ? PARTIAL_CROP : FULL_CROP,
        naturalWidth: 800,
        naturalHeight: 600,
        displayWidth: 160,
        rotation: testCase.rotation,
      })
      assert.ok(geometry)
      assert.equal(geometry.frameWidth, 160)
      if (testCase.rotation === 90 || testCase.rotation === 270) {
        assert.notEqual(geometry.aspectRatio, 800 / 600)
      }
      assert.match(html, new RegExp(`aspect-ratio:${String(geometry.aspectRatio)}`))
      assert.match(html, new RegExp(`transform:rotate\\(${testCase.rotation}deg\\)`))
      assert.match(html, /class="rich-text__image-scene"/)
    }
  })

  it('strips stored style, class, and arbitrary rotation from generated application output', () => {
    const html = materializeRichTextForApp(
      `<p>before ${appImage(
        ' class="evil" style="transform:rotate(45deg)" data-layout="inline" data-rotation="45" data-width="160"',
      )} after</p>`,
    )

    assert.match(html, /data-layout="inline"/)
    assert.match(html, /style="[^"]*width:160px/)
    assert.doesNotMatch(html, /evil|45deg|rotate\(45|data-rotation/)
  })

  it('keeps email placeholders and never leaks layout, rotation, canonical URLs, or image bytes', () => {
    const source = `<p>before ${appImage(
      ' data-layout="inline" data-rotation="90" data-width="160" data-natural-width="800" data-natural-height="600"',
    )} after</p>`
    const html = renderDescriptionHtml(source)

    assert.match(html, /^<p>before \[Image: Floor plan\] after<\/p>$/)
    assert.doesNotMatch(html, /<img|\/api\/inline-images|data:image|data-layout|data-rotation/i)
    assert.equal(renderDescriptionPlainText(source), 'before [Image: Floor plan] after')
  })
})
