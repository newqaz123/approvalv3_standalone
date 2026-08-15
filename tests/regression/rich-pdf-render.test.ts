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
})

describe('PDF and email render wiring', () => {
  it('PDF routes descriptions through the shared helper', () => {
    const pdf = read('src/lib/pdf.ts')
    assert.match(pdf, /renderDescriptionHtml\(/)
    assert.doesNotMatch(pdf, /renderFormattedTextHtml\(data\.(solution\.)?description\)/)
  })

  it('email routes descriptions through the shared helpers', () => {
    const mail = read('src/server-actions/notifications.ts')
    assert.match(mail, /renderDescriptionHtml\(/)
    assert.match(mail, /renderDescriptionPlainText\(/)
  })
})
