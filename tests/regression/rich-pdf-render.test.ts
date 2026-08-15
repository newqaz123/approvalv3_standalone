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

  it('falls back to escaped plain truncation when rich text exceeds the budget', () => {
    const long = '<p>' + 'word '.repeat(100) + '</p>'
    const out = renderDescriptionHtml(long, 40)
    assert.ok(!/<(p|strong|em|ul|ol|li|h2|h3|a)\b/.test(out), 'no tags in the truncated fallback')
    assert.ok(out.length > 0 && out.length <= 60, 'truncated to roughly the budget')
  })
})

describe('PDF and email render wiring', () => {
  it('PDF routes descriptions through the shared helper and prints link URLs', () => {
    const pdf = read('src/lib/pdf.ts')
    assert.match(pdf, /renderDescriptionHtml\(/)
    assert.doesNotMatch(pdf, /renderFormattedTextHtml\(data\.(solution\.)?description\)/)
    assert.match(pdf, /\.description a::after/)
    assert.match(pdf, /attr\(href\)/)
  })

  it('email routes descriptions through the shared helpers', () => {
    const mail = read('src/server-actions/notifications.ts')
    assert.match(mail, /renderDescriptionHtml\(/)
    assert.match(mail, /renderDescriptionPlainText\(/)
  })
})
