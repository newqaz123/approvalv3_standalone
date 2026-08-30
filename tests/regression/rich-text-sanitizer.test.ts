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

  it('keeps semantic paragraph alignment and strips invalid or styled alignment', () => {
    assert.equal(
      sanitizeRichText('<p data-text-align="center">Mid</p>'),
      '<p data-text-align="center">Mid</p>',
    )
    assert.equal(
      sanitizeRichText('<h2 data-text-align="right">Title</h2>'),
      '<h2 data-text-align="right">Title</h2>',
    )
    assert.equal(
      sanitizeRichText('<p data-text-align="left">Start</p>'),
      '<p>Start</p>',
    )
    assert.equal(
      sanitizeRichText('<p data-text-align="justify" style="text-align:right">Nope</p>'),
      '<p>Nope</p>',
    )
  })

  it('strips disallowed structural markup and styling attributes', () => {
    const out = sanitizeRichText('<div><section>s</section></div><p style="color:red" class="x" id="y">keep</p><span style="font-size:99px">s</span>')
    assert.ok(!out.includes('<div'))
    assert.ok(!out.includes('<section'))
    assert.ok(!out.includes('style='))
    assert.ok(!out.includes('class='))
    assert.ok(!out.includes('id='))
    assert.ok(out.includes('keep'))
  })

  it('keeps table structure with span and cell metadata', () => {
    const out = sanitizeRichText(
      '<table><thead><tr><th colspan="2" rowspan="1">Header</th></tr></thead><tbody><tr><td data-colwidth="100">a</td><td>b</td></tr></tbody></table>',
    )
    for (const tag of ['<table>', '<thead>', '<tbody>', '<tr>', '<th', '<td']) {
      assert.ok(out.includes(tag), `missing ${tag}`)
    }
    assert.ok(out.includes('colspan="2"'))
    assert.ok(out.includes('rowspan="1"'))
    assert.ok(out.includes('data-colwidth="100"'))
    assert.ok(out.includes('Header'))
  })

  it('strips hostile cell attributes and escapes hostile attribute values', () => {
    const out = sanitizeRichText('<td style="x" class="y" id="z" onclick="a()" bgcolor="red" width="50" colspan="<script>">c</td>')
    assert.ok(!out.includes('style='))
    assert.ok(!out.includes('class='))
    assert.ok(!out.includes('id='))
    assert.ok(!out.includes('onclick'))
    assert.ok(!out.includes('bgcolor'))
    assert.ok(!out.includes('width="50"'))
    assert.ok(!out.includes('<script'))
    assert.ok(out.includes('c</td>'))
  })

  it('keeps paragraph alignment inside table cells', () => {
    const out = sanitizeRichText('<td><p data-text-align="center">Mid</p></td>')
    assert.ok(out.includes('<td><p data-text-align="center">Mid</p></td>'))
  })

  it('keeps exact semantic tokens and strips arbitrary pasted color styles', () => {
    assert.equal(
      sanitizeRichText('<span data-text-color="blue" style="font-size:99px">A</span><span style="color:#ff00ff">B</span><mark data-highlight="yellow" class="x">C</mark>'),
      '<span data-text-color="blue">A</span><span>B</span><mark data-highlight="yellow">C</mark>',
    )
  })

  it('rejects invalid or case-mismatched tokens while preserving child text and formatting', () => {
    assert.equal(
      sanitizeRichText('<span data-text-color="Blue"><strong>A</strong></span><mark data-highlight="orange"><a href="https://example.com">B</a></mark>'),
      '<span><strong>A</strong></span><span><a target="_blank" rel="noopener noreferrer" href="https://example.com">B</a></span>',
    )
  })

  it('preserves child line breaks in neutral palette spans', () => {
    assert.equal(sanitizeRichText('<span data-text-color="invalid"><br></span>'), '<span><br /></span>')
  })

  it('keeps independently nested semantic marks with all existing rich text formatting', () => {
    assert.equal(
      sanitizeRichText('<p><span data-text-color="teal"><mark data-highlight="pink"><strong><em><u><s><a href="mailto:user@example.com">Nested</a></s></u></em></strong></mark></span></p>'),
      '<p><span data-text-color="teal"><mark data-highlight="pink"><strong><em><u><s><a target="_blank" rel="noopener noreferrer" href="mailto:user@example.com">Nested</a></s></u></em></strong></mark></span></p>',
    )
  })

  it('preserves canonical inline images and bounded presentation metadata', () => {
    const out = sanitizeRichText('<p><img src="/api/inline-images/123e4567-e89b-42d3-a456-426614174000" alt="Plan" data-align="center" data-width="480" data-natural-width="1600" data-natural-height="900" data-crop-x="1000" data-crop-y="2000" data-crop-width="5000" data-crop-height="4000" onerror="alert(1)" style="width:10px" class="x" id="img" srcset="/x 2x" width="999" height="999"></p>')
    assert.ok(out.includes('<img'))
    assert.ok(out.includes('src="/api/inline-images/123e4567-e89b-42d3-a456-426614174000"'))
    assert.ok(out.includes('alt="Plan"'))
    assert.ok(out.includes('data-align="center"'))
    for (const attribute of [
      'data-width="480"',
      'data-natural-width="1600"',
      'data-natural-height="900"',
      'data-crop-x="1000"',
      'data-crop-y="2000"',
      'data-crop-width="5000"',
      'data-crop-height="4000"',
    ]) {
      assert.ok(out.includes(attribute), `missing ${attribute}`)
    }
    for (const disallowed of ['onerror=', 'style=', 'class=', 'id=', 'srcset=', 'width="999"', 'height="999"']) {
      assert.ok(!out.includes(disallowed), `unexpected ${disallowed}`)
    }
  })

  it('removes malicious display width syntax independently', () => {
    for (const width of [
      '480px', '+480', '4e2', '480.5', '-480', '0480', '2049',
      '9007199254740992', '999999999999999999999999999999999999',
    ]) {
      const out = sanitizeRichText(`<img src="/api/inline-images/123e4567-e89b-42d3-a456-426614174000" data-width="${width}" data-natural-width="1600" data-natural-height="900">`)
      assert.ok(!out.includes('data-width='), `width should be removed: ${width}`)
      assert.ok(out.includes('data-natural-width="1600"'), `safe natural dimensions should survive: ${width}`)
      assert.ok(out.includes('data-natural-height="900"'), `safe natural dimensions should survive: ${width}`)
    }
  })

  it('removes invalid natural pairs and their dependent crop metadata', () => {
    for (const dimensions of [
      'data-natural-width="1600"',
      'data-natural-height="900"',
      'data-natural-width="0" data-natural-height="900"',
      'data-natural-width="65536" data-natural-height="900"',
      'data-natural-width="1600.5" data-natural-height="900"',
    ]) {
      const out = sanitizeRichText(`<img src="/api/inline-images/123e4567-e89b-42d3-a456-426614174000" data-width="480" ${dimensions} data-crop-x="0" data-crop-y="0" data-crop-width="10000" data-crop-height="10000">`)
      assert.ok(out.includes('data-width="480"'))
      assert.ok(!out.includes('data-natural-'), dimensions)
      assert.ok(!out.includes('data-crop-'), dimensions)
    }
  })

  it('removes incomplete, malformed, and uncontained crop groups as a unit', () => {
    for (const crop of [
      'data-crop-x="0" data-crop-y="0" data-crop-width="10000"',
      'data-crop-x="4000" data-crop-y="0" data-crop-width="7000" data-crop-height="10000"',
      'data-crop-x="0" data-crop-y="-1" data-crop-width="10000" data-crop-height="10000"',
      'data-crop-x="0" data-crop-y="0" data-crop-width="4e2" data-crop-height="10000"',
      'data-crop-x="0" data-crop-y="0" data-crop-width="10000.0" data-crop-height="10000"',
    ]) {
      const out = sanitizeRichText(`<img src="/api/inline-images/123e4567-e89b-42d3-a456-426614174000" data-width="480" data-natural-width="1600" data-natural-height="900" ${crop}>`)
      assert.ok(out.includes('data-width="480"'))
      assert.ok(out.includes('data-natural-width="1600"'))
      assert.ok(out.includes('data-natural-height="900"'))
      assert.ok(!out.includes('data-crop-'), crop)
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

  it('keeps semantic layout and rotation and strips arbitrary transforms', () => {
    const out = sanitizeRichText('<p><img src="/api/inline-images/123e4567-e89b-42d3-a456-426614174000" alt="Plan" data-align="center" data-layout="inline" data-rotation="90" style="transform:rotate(12deg)" class="evil"></p>')
    assert.ok(out.includes('<img'))
    assert.ok(out.includes('src="/api/inline-images/123e4567-e89b-42d3-a456-426614174000"'))
    assert.ok(out.includes('data-layout="inline"'))
    assert.ok(out.includes('data-rotation="90"'))
    assert.ok(!out.includes('style='))
    assert.ok(!out.includes('class='))
    assert.ok(!out.includes('rotate(12deg)'))
  })

  it('drops invalid layout and rotation while keeping the canonical image', () => {
    const out = sanitizeRichText('<img src="/api/inline-images/123e4567-e89b-42d3-a456-426614174000" alt="Plan" data-layout="float-left" data-rotation="45deg">')
    assert.ok(out.includes('<img'))
    assert.ok(out.includes('src="/api/inline-images/123e4567-e89b-42d3-a456-426614174000"'))
    assert.ok(!out.includes('data-layout='))
    assert.ok(!out.includes('data-rotation='))
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
    assert.ok(containsRichTextHtml('<table><tbody><tr><td>x</td></tr></tbody></table>'))
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

  it('separates table cell text so plain previews stay readable', () => {
    assert.equal(
      richTextToPlainText('<table><tbody><tr><td>alpha</td><td>beta</td></tr><tr><td>gamma</td><td>delta</td></tr></tbody></table>'),
      'alpha beta gamma delta',
    )
  })
})
