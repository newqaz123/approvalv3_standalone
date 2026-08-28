import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  sanitizeRichText,
  containsRichTextHtml,
  richTextToPlainText,
} from '@/lib/rich-text-sanitizer'

describe('sanitizeRichText', () => {
  it('keeps every whitelisted tag and its text', () => {
    const html = '<h2>Title</h2><p>Plain <strong>bold</strong> <em>italic</em> <u>under</u> <s>strike</s></p><ul><li>one</li><li>two</li></ul><ol><li>first</li></ol><h3>Sub</h3><p><a href="https://example.com">link</a></p>'
    const out = sanitizeRichText(html)
    for (const tag of ['<h2>', '<strong>', '<em>', '<u>', '<s>', '<ul>', '<ol>', '<li>', '<h3>']) {
      assert.ok(out.includes(tag), `missing ${tag}`)
    }
    assert.ok(out.includes('href="https://example.com"'))
    assert.ok(out.includes('target="_blank"'))
    assert.ok(out.includes('rel="noopener noreferrer"'))
  })

  it('strips scripts, event handlers, and hostile hrefs', () => {
    const hostile = '<p onclick="x()">a</p><script>alert(1)</script><a href="javascript:alert(1)">j</a><a href="data:text/html,x">d</a><img src=x onerror=alert(1)>'
    const out = sanitizeRichText(hostile)
    assert.ok(!out.includes('script'))
    assert.ok(!out.includes('onclick'))
    assert.ok(!out.includes('javascript:'))
    assert.ok(!out.includes('data:text/html'))
    assert.ok(!out.includes('<img'))
  })

  it('strips protocol-relative and obfuscated hostile hrefs', () => {
    for (const href of [
      '//evil.com',
      'JAVASCRIPT:alert(1)',
      'java\tscript:alert(1)',
      '&#106;avascript:alert(1)',
      'vbscript:alert(1)',
    ]) {
      const out = sanitizeRichText(`<a href="${href}">hostile</a>`)
      assert.ok(!/<a\b[^>]*\bhref=/i.test(out), `href should be stripped: ${href}`)
    }
  })

  it('keeps allowed-scheme hrefs and strips scheme-less relative ones', () => {
    for (const href of ['https://example.com', 'http://example.com', 'mailto:user@example.com', 'HTTPS://example.com']) {
      const out = sanitizeRichText(`<a href="${href}">safe</a>`)
      assert.ok(out.includes(`href="${href}"`), `href should survive: ${href}`)
    }
    for (const href of ['/relative', 'relative/path']) {
      const out = sanitizeRichText(`<a href="${href}">rel</a>`)
      assert.ok(!/<a\b[^>]*\bhref=/i.test(out), `href should be stripped: ${href}`)
      assert.ok(out.includes('>rel</a>'), `link text should be kept: ${href}`)
    }
  })

  it('strips disallowed structural markup and styling attributes', () => {
    const out = sanitizeRichText('<table><tr><td>t</td></tr></table><p style="color:red" class="x" id="y">keep</p><span style="font-size:99px">s</span>')
    assert.ok(!out.includes('<table'))
    assert.ok(!out.includes('style='))
    assert.ok(!out.includes('class='))
    assert.ok(!out.includes('id='))
    assert.ok(out.includes('keep'))
  })

  it('preserves canonical inline images and strips unapproved attributes', () => {
    const out = sanitizeRichText('<p><img src="/api/inline-images/123e4567-e89b-42d3-a456-426614174000" alt="Plan" data-align="center" onerror="alert(1)" style="width:10px" class="x" id="img" srcset="/x 2x"></p>')
    assert.ok(out.includes('<img'))
    assert.ok(out.includes('src="/api/inline-images/123e4567-e89b-42d3-a456-426614174000"'))
    assert.ok(out.includes('alt="Plan"'))
    assert.ok(out.includes('data-align="center"'))
    for (const disallowed of ['onerror=', 'style=', 'class=', 'id=', 'srcset=']) {
      assert.ok(!out.includes(disallowed), `unexpected ${disallowed}`)
    }
  })

  it('removes inline images with invalid sources', () => {
    for (const src of [
      'https://example.com/image.png',
      'data:image/png,x',
      'blob:x',
      '/api/inline-images/123e4567-e89b-42d3-a456-426614174000.svg',
    ]) {
      const out = sanitizeRichText(`<p><img src="${src}" alt="Plan" data-align="left"></p>`)
      assert.ok(!out.includes('<img'), `image should be removed: ${src}`)
    }
  })

  it('canonicalizes inline image src, truncates alt, and defaults invalid alignment', () => {
    const alt = 'x'.repeat(301)
    const out = sanitizeRichText(`<img src="/api/inline-images/123E4567-E89B-42D3-A456-426614174000" alt="${alt}" data-align="top">`)
    assert.ok(out.includes('src="/api/inline-images/123e4567-e89b-42d3-a456-426614174000"'))
    assert.ok(out.includes(`alt="${'x'.repeat(300)}"`))
    assert.ok(!out.includes(`alt="${alt}"`))
    assert.ok(out.includes('data-align="center"'))
  })

  it('never throws on garbage input', () => {
    assert.doesNotThrow(() => sanitizeRichText('<<<>>><p'))
    assert.doesNotThrow(() => sanitizeRichText(''))
  })
})

describe('containsRichTextHtml', () => {
  it('accepts TipTap-shaped sources starting with a whitelisted tag', () => {
    assert.ok(containsRichTextHtml('<p>hi</p>'))
    assert.ok(containsRichTextHtml('  <h2>t</h2>'))
    assert.ok(containsRichTextHtml('<ul><li>x</li></ul>'))
  })

  it('rejects prose that merely mentions a tag mid-sentence', () => {
    assert.ok(!containsRichTextHtml('Use <h2> for headings'))
    assert.ok(!containsRichTextHtml('5 < 6 and **bold**'))
    assert.ok(!containsRichTextHtml('plain **bold** text'))
    assert.ok(!containsRichTextHtml(''))
  })
})

describe('richTextToPlainText', () => {
  it('strips tags, decodes entities, and collapses whitespace', () => {
    assert.equal(richTextToPlainText('<p>a &amp; b</p><strong>c</strong>').trim(), 'a & b c')
    assert.equal(richTextToPlainText('<p> a   b </p>'), 'a b')
  })
})
