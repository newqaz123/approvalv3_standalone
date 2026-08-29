import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  materializeRichTextForApp,
  materializeRichTextForEmail,
  truncateSanitizedRichTextHtml,
} from '@/lib/rich-text-presentation'
import { sanitizeRichText } from '@/lib/rich-text-sanitizer'

const IMAGE_ID = '123e4567-e89b-42d3-a456-426614174000'
const IMAGE_SRC = `/api/inline-images/${IMAGE_ID}`

function image(attributes = ''): string {
  return `<img src="${IMAGE_SRC}" alt="Diagram" data-align="right"${attributes}>`
}

describe('trusted rich text presentation', () => {
  it('keeps uncropped images as bare sanitized images', () => {
    const html = materializeRichTextForApp(image(' data-width="400"'))

    assert.match(html, new RegExp(`<img src="${IMAGE_SRC}"`))
    assert.doesNotMatch(html, /rich-text__image-frame/)
    assert.doesNotMatch(html, /style=/)
  })

  it('renders a valid crop as a responsive frame using validated geometry', () => {
    const html = materializeRichTextForApp(image(
      ' data-width="400" data-natural-width="1600" data-natural-height="900" data-crop-x="1000" data-crop-y="2000" data-crop-width="5000" data-crop-height="4000"',
    ))

    assert.match(html, /^<span class="rich-text__image-frame" data-align="right" style="width:400px;aspect-ratio:2\.2222222222222223">/)
    assert.match(html, /<img src="\/api\/inline-images\/123e4567-e89b-42d3-a456-426614174000" alt="Diagram" style="width:200%;height:250%;left:-20%;top:-50%" \/>/)
    assert.match(html, /<\/span>$/)
  })

  it('falls back to an uncropped image when crop metadata is invalid', () => {
    const html = materializeRichTextForApp(image(
      ' data-width="400" data-natural-width="1600" data-natural-height="900" data-crop-x="9000" data-crop-y="0" data-crop-width="5000" data-crop-height="4000"',
    ))

    assert.match(html, /^<img\b/)
    assert.doesNotMatch(html, /rich-text__image-frame|style=/)
  })

  it('generates styles only from bounded metadata and never echoes hostile style text', () => {
    const html = materializeRichTextForApp(
      `<span data-text-color="blue" style="position:fixed">Safe</span>${image(
        ' style="width:expression(alert(1))" data-width="999999999999999999999" data-natural-width="1600" data-natural-height="900" data-crop-x="0;position:fixed" data-crop-y="0" data-crop-width="5000" data-crop-height="4000"',
      )}`,
    )

    assert.match(html, /color:#1D4ED8/)
    assert.doesNotMatch(html, /position|fixed|expression|alert|999999999999999999999/)
    assert.doesNotMatch(html, /rich-text__image-frame/)
  })

  it('truncates sanitized HTML by Unicode code points while preserving balanced palette marks', () => {
    const truncated = truncateSanitizedRichTextHtml(
      sanitizeRichText('<p><span data-text-color="blue">Hello <mark data-highlight="yellow">world</mark> tail</span></p>'),
      8,
    )

    assert.equal(
      truncated,
      '<p><span data-text-color="blue">Hello <mark data-highlight="yellow">wo</mark></span></p>',
    )
    assert.equal(
      truncateSanitizedRichTextHtml(sanitizeRichText('<strong>👍extra</strong>'), 1),
      '<strong>👍</strong>',
    )
  })

  it('fix 1: truncates decoded entity text at visible Unicode boundaries', () => {
    assert.equal(
      truncateSanitizedRichTextHtml('<p>A&amp;B</p>', 2),
      '<p>A&amp;</p>',
    )
    assert.equal(
      truncateSanitizedRichTextHtml('<p>A&lt;B</p>', 2),
      '<p>A&lt;</p>',
    )
    assert.equal(
      materializeRichTextForEmail(
        `<p>${image().replace('alt="Diagram"', 'alt="A &amp; B"')}</p>`,
        11,
      ),
      '<p>[Image: A &amp;</p>',
    )
  })

  it('fix 2: suppresses elements first encountered after truncation is exhausted', () => {
    const html = truncateSanitizedRichTextHtml(
      `<p>Keep${image()}<strong>later <em>nested</em></strong></p>`,
      4,
    )

    assert.equal(html, '<p>Keep</p>')
  })

  it('replaces email images before truncation, preserves palette styling, and emits no image source', () => {
    const html = materializeRichTextForEmail(
      `<p><span data-text-color="teal">Before ${image().replace('alt="Diagram"', 'alt="Receipt &lt;final&gt;"')} after</span></p>`,
    )

    assert.match(html, /<span style="color:#0F766E">Before \[Image: Receipt &lt;final&gt;\] after<\/span>/)
    assert.doesNotMatch(html, /<img|\/api\/inline-images|data:/i)

    const truncated = materializeRichTextForEmail(
      `<p><span data-text-color="teal">Before ${image()} after</span></p>`,
      8,
    )
    assert.equal(truncated, '<p><span style="color:#0F766E">Before [</span></p>')
  })

  it('keeps approved color and highlight tags balanced in over-budget email HTML', () => {
    const html = materializeRichTextForEmail(
      '<p><span data-text-color="blue">Hello <mark data-highlight="yellow">world</mark> tail</span></p>',
      8,
    )

    assert.equal(
      html,
      '<p><span style="color:#1D4ED8">Hello <mark style="background-color:#FEF3C7">wo</mark></span></p>',
    )
  })

  it('fix 3: redacts private image references from all email-visible text', () => {
    const html = materializeRichTextForEmail(
      `<p><span data-text-color="blue">Before ${IMAGE_SRC} and data:image/png;base64,AAAA after</span>${image().replace('alt="Diagram"', `alt="receipt ${IMAGE_SRC} data:image/webp;base64,BBBB"`)}</p>`,
    )

    assert.match(html, /<span style="color:#1D4ED8">Before .* and .* after<\/span>/)
    assert.match(html, /\[Image: receipt .* .*\]/)
    assert.doesNotMatch(html, /\/api\/inline-images\/[0-9a-f-]{36}|data:image\//i)
  })

  it('fix round 2: redacts forbidden references split across nested formatting', () => {
    const html = materializeRichTextForEmail(
      `<p>Before /api/inline-<strong>images/${IMAGE_ID}</strong> after <em>safe emphasis</em></p><p><span data-text-color="blue">Before data:<mark data-highlight="yellow">image/png;base64,AAAA</mark> after <u>safe underline</u></span></p>`,
    )

    assert.equal(
      html,
      '<p>Before [redacted] after <em>safe emphasis</em></p><p><span style="color:#1D4ED8">Before [redacted] after <u>safe underline</u></span></p>',
    )
    assert.doesNotMatch(
      html.replace(/<[^>]+>/g, ''),
      /\/api\/inline-images\/[0-9a-f-]{36}|data:image\//i,
    )
  })
})
