import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

const extensionSource = read('src/components/rich-text/inline-image-extension.ts')
const nodeViewSource = read('src/components/rich-text/inline-image-node-view.tsx')
const editorSource = read('src/components/rich-text/rich-text-editor.tsx')
const lazySource = read('src/components/rich-text/rich-text-editor-lazy.tsx')

describe('inline image TipTap extension', () => {
  it('uses a React node view and only parses canonical internal images', () => {
    assert.match(extensionSource, /ReactNodeViewRenderer\(InlineImageNodeView\)/)
    assert.match(extensionSource, /tag:\s*["']img["']/)
    assert.match(extensionSource, /parseInlineImageSrc/)
    assert.match(extensionSource, /canonicalInlineImageSrc/)
  })

  it('renders stable images and transient uploads as sanitizer-discarded placeholders', () => {
    assert.match(extensionSource, /node\.attrs\.src/)
    assert.match(extensionSource, /data-inline-upload-placeholder/)
    assert.match(extensionSource, /\['span',\s*\{\s*['"]data-inline-upload-placeholder['"]:\s*['"]true['"]\s*\}\]/)
    assert.match(extensionSource, /['"]data-align['"]\s*:/)
    assert.doesNotMatch(extensionSource, /['"]blob:/)
  })

  it('keeps transient attributes out of rendered HTML', () => {
    for (const attribute of ['uploadId', 'status', 'progress', 'error']) {
      assert.match(extensionSource, new RegExp(attribute))
    }
    assert.match(extensionSource, /rendered:\s*false/)
  })
})

describe('inline image node view controls', () => {
  it('shows upload progress and retry/remove controls', () => {
    assert.match(nodeViewSource, /progress/i)
    assert.match(nodeViewSource, /Retry/)
    assert.match(nodeViewSource, /Remove/)
    assert.match(nodeViewSource, /coordinator\.remove/)
    assert.match(nodeViewSource, /updateAttributes/)
  })

  it('provides capped alt text and exactly three alignment choices', () => {
    assert.match(nodeViewSource, /MAX_INLINE_ALT_LENGTH|300/)
    for (const alignment of ['left', 'center', 'right']) {
      assert.match(extensionSource, new RegExp(`['"]${alignment}['"]`))
    }
    for (const label of ['Left', 'Center', 'Right']) {
      assert.match(nodeViewSource, new RegExp(label))
    }
    assert.match(nodeViewSource, /aria-label=.*alt/i)
  })
})

describe('RichTextEditor inline image insertion', () => {
  it('registers one image-only FileHandler for paste and drop', () => {
    assert.match(editorSource, /FileHandler\.configure/)
    assert.match(editorSource, /allowedMimeTypes:\s*Array\.from\(INLINE_IMAGE_MIMES\)/)
    assert.match(editorSource, /onPaste/)
    assert.match(editorSource, /onDrop/)
    assert.match(editorSource, /insertFiles\(files/)
  })

  it('exposes an accessible image picker and disables it when uploads are unavailable', () => {
    assert.match(editorSource, /aria-label=["']Image["']/)
    assert.match(editorSource, /type=["']file["']/)
    assert.match(editorSource, /accept=["']image\/(?:jpeg|png|webp|gif)/)
    assert.match(editorSource, /inlineImages/)
    assert.match(editorSource, /immediatelyRender:\s*false/)
  })

  it('sanitizes emitted HTML and never emits transient upload state', () => {
    assert.match(editorSource, /sanitizeRichText\(current\.getHTML\(\)\)/)
    assert.match(editorSource, /lastEmitted\.current\s*=\s*next/)
    assert.match(editorSource, /uploadId/)
    assert.match(editorSource, /status/)
    assert.match(editorSource, /crypto\.randomUUID/)
    assert.match(editorSource, /filenameAlt/)
  })
})

describe('RichTextEditor lazy fallback', () => {
  it('passes the original HTML to FormattedTextarea without image controls', () => {
    assert.match(lazySource, /value=\{props\.value\}/)
    assert.match(lazySource, /FormattedTextarea/)
    assert.doesNotMatch(lazySource, /inlineImages=\{props\.inlineImages\}/)
  })
})
