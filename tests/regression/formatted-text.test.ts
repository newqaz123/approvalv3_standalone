import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  renderFormattedTextHtml,
  renderFormattedTextPlainText,
  tokenizeFormattedText,
  truncateFormattedText,
  visibleFormattedText,
} from '@/lib/formatted-text'

describe('formatted description tokenizer', () => {
  it('keeps plain text unchanged', () => {
    assert.deepEqual(tokenizeFormattedText('plain text'), [{ type: 'text', value: 'plain text' }])
    assert.equal(visibleFormattedText('plain text'), 'plain text')
    assert.equal(renderFormattedTextPlainText('plain text'), 'plain text')
  })

  it('creates bold tokens for multiple non-empty paired spans', () => {
    assert.deepEqual(tokenizeFormattedText('A **bold** and **strong**.'), [
      { type: 'text', value: 'A ' },
      { type: 'bold', value: 'bold' },
      { type: 'text', value: ' and ' },
      { type: 'bold', value: 'strong' },
      { type: 'text', value: '.' },
    ])
    assert.equal(visibleFormattedText('A **bold** and **strong**.'), 'A bold and strong.')
  })

  it('turns each newline into a line-break token and preserves it in plain text', () => {
    assert.deepEqual(tokenizeFormattedText('first\nsecond\r\nthird').filter(token => token.type === 'lineBreak'), [
      { type: 'lineBreak' },
      { type: 'lineBreak' },
    ])
    assert.equal(visibleFormattedText('first\nsecond\r\nthird'), 'first\nsecond\nthird')
  })

  it('leaves unmatched and malformed markers literal', () => {
    assert.deepEqual(tokenizeFormattedText('before **unmatched'), [{ type: 'text', value: 'before **unmatched' }])
    assert.deepEqual(tokenizeFormattedText('****'), [{ type: 'text', value: '****' }])
    assert.deepEqual(tokenizeFormattedText('**  **'), [{ type: 'text', value: '**  **' }])
    assert.deepEqual(tokenizeFormattedText('****text'), [{ type: 'text', value: '****text' }])
  })

  it('renders non-empty bold spans that include trailing whitespace before the closer', () => {
    // Stored values from the selection-wrap bug: "**Topic : ** test"
    assert.deepEqual(tokenizeFormattedText('**Topic : ** test'), [
      { type: 'bold', value: 'Topic : ' },
      { type: 'text', value: ' test' },
    ])
    assert.equal(
      renderFormattedTextHtml('**Topic : ** test'),
      '<strong>Topic : </strong> test',
    )
    assert.deepEqual(tokenizeFormattedText('**open ** close'), [
      { type: 'bold', value: 'open ' },
      { type: 'text', value: ' close' },
    ])
    assert.equal(visibleFormattedText('**open ** close'), 'open  close')
  })

  it('treats HTML and script-looking input as text and escapes HTML output', () => {
    const source = '<script>alert(1)</script> **<img src=x onerror=alert(1)>**'
    assert.equal(visibleFormattedText(source), '<script>alert(1)</script> <img src=x onerror=alert(1)>')
    assert.equal(
      renderFormattedTextHtml(source),
      '&lt;script&gt;alert(1)&lt;/script&gt; <strong>&lt;img src=x onerror=alert(1)&gt;</strong>',
    )
  })

  it('supports bold spans at the beginning and end of the source', () => {
    assert.deepEqual(tokenizeFormattedText('**start** middle **end**'), [
      { type: 'bold', value: 'start' },
      { type: 'text', value: ' middle ' },
      { type: 'bold', value: 'end' },
    ])
  })

  it('truncates visible content without leaving raw markers or a partial source span', () => {
    const tokens = truncateFormattedText('before **bold words** after', 12)
    assert.equal(tokens.map(token => token.type === 'lineBreak' ? '\n' : token.value).join(''), 'before bold...')
    assert.equal(renderFormattedTextPlainText('before **bold words** after', 12), 'before bold...')
    assert.doesNotMatch(renderFormattedTextHtml('before **bold words** after', 12), /\*\*/)
  })

  it('truncates by Unicode code points so non-BMP characters are not split', () => {
    const tokens = truncateFormattedText('👍extra', 1)
    const visible = tokens.map(token => (token.type === 'lineBreak' ? '\n' : token.value)).join('')
    assert.equal(visible, '👍...')
    for (const token of tokens) {
      if (token.type === 'lineBreak') continue
      // Reject lone UTF-16 surrogates from code-unit slicing.
      assert.doesNotMatch(token.value, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u)
      assert.doesNotMatch(token.value, /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u)
    }
    assert.equal(renderFormattedTextPlainText('👍extra', 1), '👍...')
    assert.equal(renderFormattedTextHtml('👍extra', 1), '👍...')
  })

  it('preserves a counted trailing newline when truncating and only trims horizontal whitespace', () => {
    const tokens = truncateFormattedText('ab\ncd', 3)
    assert.deepEqual(tokens, [
      { type: 'text', value: 'ab' },
      { type: 'lineBreak' },
      { type: 'text', value: '...' },
    ])
    assert.equal(renderFormattedTextPlainText('ab\ncd', 3), 'ab\n...')
    assert.equal(renderFormattedTextHtml('ab\ncd', 3), 'ab<br />...')

    const spaced = truncateFormattedText('ab \ncd', 4)
    assert.deepEqual(spaced, [
      { type: 'text', value: 'ab' },
      { type: 'lineBreak' },
      { type: 'text', value: '...' },
    ])
    assert.equal(renderFormattedTextPlainText('ab \ncd', 4), 'ab\n...')
  })
})
