import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Editor, type JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { NodeSelection } from '@tiptap/pm/state'
import {
  attachInlineImageResizeEscapeGuard,
  createInlineImageResizeSession,
  discardInlineImageResizeSession,
} from '../../src/components/rich-text/inline-image-resize'
import {
  InlineImageExtension,
  inlineImageUploadSuccessAttributes,
} from '../../src/components/rich-text/inline-image-extension'
import {
  InlineImageNodeView,
  applyInlineImageAttributes,
  inlineImageResizeStartWidth,
} from '../../src/components/rich-text/inline-image-node-view'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../src/components/ui/tooltip'
import type { InlineImageUpload } from '../../src/lib/inline-images/policy'
import {
  INLINE_IMAGE_MAX_DISPLAY_WIDTH,
  INLINE_IMAGE_MIN_DISPLAY_WIDTH,
  computeInlineImageFrameGeometry,
} from '../../src/lib/inline-images/presentation'

const IMAGE_ID = '123e4567-e89b-42d3-a456-426614174001'
const UPLOAD_ID = 'upload-a'
const IMAGE_SRC = `/api/inline-images/${IMAGE_ID}`

function successfulUpload(width = 1600, height = 900): InlineImageUpload {
  return {
    id: IMAGE_ID,
    src: IMAGE_SRC,
    alt: 'diagram',
    fileType: 'image/png',
    fileSize: 10,
    width,
    height,
  }
}

function createEditor(content: JSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'before' }] }],
}) {
  return new Editor({
    element: null,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: false,
        underline: false,
        blockquote: false,
        code: false,
        codeBlock: false,
        hardBreak: false,
        horizontalRule: false,
      }),
      InlineImageExtension.configure({}),
    ],
    content,
  })
}

function imageDoc(displayWidth: number | null): JSONContent {
  return {
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [{
        type: 'inlineImage',
        attrs: {
          src: IMAGE_SRC,
          alt: 'diagram',
          align: 'center',
          displayWidth,
        },
      }],
    }],
  }
}

describe('inline image resize controller', () => {
  it('previews continuously but commits one clamped width', () => {
    const previews: number[] = []
    const commits: Array<number | null> = []
    const resize = createInlineImageResizeSession({
      edge: 'right',
      startPointerX: 100,
      startWidth: 400,
      editorWidth: 600,
      onPreview: width => previews.push(width),
      onCommit: width => commits.push(width),
    })
    assert.equal(resize.preview(450), 600)
    assert.equal(resize.commit(), 600)
    assert.deepEqual(commits, [600])
  })

  it('mirrors pointer deltas for the left edge', () => {
    const previews: number[] = []
    const resize = createInlineImageResizeSession({
      edge: 'left',
      startPointerX: 100,
      startWidth: 400,
      editorWidth: 600,
      onPreview: width => previews.push(width),
      onCommit: () => undefined,
    })
    // Dragging the left edge leftward widens the image.
    assert.equal(resize.preview(60), 440)
    // Dragging the left edge rightward narrows the image.
    assert.equal(resize.preview(140), 360)
    assert.deepEqual(previews, [440, 360])
  })

  it('clamps previews to the presentation minimum, global maximum, and editor width', () => {
    const resize = (startWidth: number, editorWidth: number) => {
      const seen: number[] = []
      return {
        seen,
        session: createInlineImageResizeSession({
          edge: 'right',
          startPointerX: 0,
          startWidth,
          editorWidth,
          onPreview: width => seen.push(width),
          onCommit: () => undefined,
        }),
      }
    }

    const narrow = resize(100, 4000)
    assert.equal(narrow.session.preview(-1000), INLINE_IMAGE_MIN_DISPLAY_WIDTH)

    const wide = resize(2000, 4000)
    assert.equal(wide.session.preview(6000), INLINE_IMAGE_MAX_DISPLAY_WIDTH)

    const editor = resize(400, 600)
    assert.equal(editor.session.preview(6000), 600)
  })

  it('commits exactly once and ignores a second commit', () => {
    const commits: Array<number | null> = []
    const resize = createInlineImageResizeSession({
      edge: 'right',
      startPointerX: 0,
      startWidth: 300,
      editorWidth: 800,
      onPreview: () => undefined,
      onCommit: width => commits.push(width),
    })
    resize.preview(350)
    assert.equal(resize.commit(), 650)
    assert.equal(resize.commit(), null)
    resize.preview(400)
    assert.equal(resize.commit(), null)
    assert.deepEqual(commits, [650])
  })

  it('emits no commit when the pointer never moved', () => {
    const commits: Array<number | null> = []
    const resize = createInlineImageResizeSession({
      edge: 'right',
      startPointerX: 0,
      startWidth: 300,
      editorWidth: 800,
      onPreview: () => undefined,
      onCommit: width => commits.push(width),
    })
    assert.equal(resize.commit(), null)
    assert.deepEqual(commits, [])
  })

  it('cancel restores the starting width without committing', () => {
    const previews: number[] = []
    const commits: Array<number | null> = []
    const resize = createInlineImageResizeSession({
      edge: 'right',
      startPointerX: 0,
      startWidth: 300,
      editorWidth: 800,
      onPreview: width => previews.push(width),
      onCommit: width => commits.push(width),
    })
    resize.preview(250)
    resize.preview(120)
    assert.equal(resize.cancel(), 300)
    assert.deepEqual(previews, [550, 420, 300])
    assert.equal(resize.commit(), null)
    assert.deepEqual(commits, [])
  })

  it('supports keyboard increments of 1px and Shift 10px', () => {
    const previews: number[] = []
    const resize = createInlineImageResizeSession({
      edge: 'right',
      startPointerX: 0,
      startWidth: 400,
      editorWidth: 800,
      onPreview: width => previews.push(width),
      onCommit: () => undefined,
    })
    assert.equal(resize.keyboard('ArrowRight', false), 401)
    assert.equal(resize.keyboard('ArrowLeft', false), 400)
    assert.equal(resize.keyboard('ArrowLeft', true), 390)
    assert.equal(resize.keyboard('ArrowRight', true), 400)
    assert.deepEqual(previews, [401, 400, 390, 400])
  })

  it('clamps keyboard increments to the editor width bounds', () => {
    const commits: Array<number | null> = []
    const resize = createInlineImageResizeSession({
      edge: 'right',
      startPointerX: 0,
      startWidth: 80,
      editorWidth: 600,
      onPreview: () => undefined,
      onCommit: width => commits.push(width),
    })
    assert.equal(resize.keyboard('ArrowLeft', true), INLINE_IMAGE_MIN_DISPLAY_WIDTH)
    const grown = createInlineImageResizeSession({
      edge: 'right',
      startPointerX: 0,
      startWidth: 598,
      editorWidth: 600,
      onPreview: () => undefined,
      onCommit: () => undefined,
    })
    assert.equal(grown.keyboard('ArrowRight', false), 599)
    assert.equal(grown.keyboard('ArrowRight', true), 600)
    assert.equal(grown.keyboard('ArrowRight', true), 600)
  })

  it('treats Home as a reset request and commits null once', () => {
    const commits: Array<number | null> = []
    const resize = createInlineImageResizeSession({
      edge: 'right',
      startPointerX: 0,
      startWidth: 400,
      editorWidth: 800,
      onPreview: () => undefined,
      onCommit: width => commits.push(width),
    })
    resize.keyboard('ArrowRight', true)
    assert.equal(resize.keyboard('Home', false), null)
    assert.equal(resize.commit(), null)
    assert.equal(resize.commit(), null)
    assert.deepEqual(commits, [null])
  })
})

describe('inline image resize editor integration', () => {
  it('dispatches exactly one document transaction for a drag of many previews', () => {
    const editor = createEditor(imageDoc(400))
    try {
      let documentChanges = 0
      editor.on('transaction', ({ transaction }) => {
        if (transaction.docChanged) documentChanges += 1
      })
      editor.view.dispatch(
        editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 1)),
      )
      const baseline = documentChanges

      const resize = createInlineImageResizeSession({
        edge: 'right',
        startPointerX: 100,
        startWidth: 400,
        editorWidth: 600,
        onPreview: () => undefined,
        onCommit: width => {
          assert.notEqual(width, null)
          editor.chain().focus().updateAttributes('inlineImage', { displayWidth: width }).run()
        },
      })
      resize.preview(150)
      resize.preview(200)
      resize.preview(250)
      resize.preview(300)
      assert.equal(documentChanges, baseline, 'previews must not dispatch transactions')

      assert.equal(resize.commit(), 600)
      assert.equal(documentChanges, baseline + 1, 'commit must dispatch exactly one transaction')
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'inlineImage') {
          assert.equal(node.attrs.displayWidth, 600)
          return false
        }
        return true
      })
    } finally {
      editor.destroy()
    }
  })

  it('starts a cropped image resize from the clipped frame width without display width', () => {
    const cropGeometry = computeInlineImageFrameGeometry({
      crop: { x: 2500, y: 1000, width: 5000, height: 4000 },
      naturalWidth: 1600,
      naturalHeight: 900,
      displayWidth: null,
    })
    assert.ok(cropGeometry)

    assert.equal(inlineImageResizeStartWidth({
      renderedWidth: null,
      cropGeometry,
      naturalWidth: 1600,
      measuredImageWidth: 1600,
    }), cropGeometry.frameWidth)
    assert.notEqual(cropGeometry.frameWidth, 1600)
  })

  it('keeps the node selected across one attribute commit transaction', () => {
    const editor = createEditor(imageDoc(400))
    try {
      let documentChanges = 0
      editor.on('transaction', ({ transaction }) => {
        if (transaction.docChanged) documentChanges += 1
      })
      editor.view.dispatch(
        editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 1)),
      )
      const baseline = documentChanges

      applyInlineImageAttributes(editor, 1, { displayWidth: 600 })

      assert.equal(documentChanges, baseline + 1, 'one commit stays one transaction')
      assert.ok(editor.state.selection instanceof NodeSelection, 'the image stays selected')
      assert.equal(editor.state.doc.nodeAt(1)?.attrs.displayWidth, 600)
    } finally {
      editor.destroy()
    }
  })

  it('populates natural dimensions on upload success through the shared attr seam', () => {
    const editor = createEditor({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'inlineImage',
          attrs: {
            src: null,
            alt: 'diagram',
            align: 'center',
            uploadId: UPLOAD_ID,
            status: 'uploading',
            progress: 10,
          },
        }],
      }],
    })
    try {
      const attrs = inlineImageUploadSuccessAttributes(successfulUpload(1600, 900), 'diagram', 'center')
      assert.equal(attrs.naturalWidth, 1600)
      assert.equal(attrs.naturalHeight, 900)
      assert.equal(attrs.status, 'success')

      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(1, editor.state.doc.nodeAt(1)?.type, {
          ...editor.state.doc.nodeAt(1)?.attrs,
          ...attrs,
          src: IMAGE_SRC,
        }),
      )
      const node = editor.state.doc.nodeAt(1)
      assert.ok(node)
      assert.equal(node.attrs.naturalWidth, 1600)
      assert.equal(node.attrs.naturalHeight, 900)
      assert.equal(node.attrs.status, 'success')
      assert.doesNotMatch(JSON.stringify(node.attrs), /progress":(?!100)/)
    } finally {
      editor.destroy()
    }
  })
})

function fakeElement(attributes: Record<string, string>): HTMLElement {
  return {
    getAttribute(name: string) {
      return attributes[name] ?? null
    },
  } as unknown as HTMLElement
}

describe('inline image presentation attribute round trip', () => {
  function imageParseAttrs(attributes: Record<string, string>) {
    const extension = InlineImageExtension.configure({})
    const rules = (extension.config.parseHTML as any).call(extension) as Array<{
      getAttrs?: (element: HTMLElement) => false | Record<string, unknown>
    }>
    return rules[0].getAttrs!(fakeElement(attributes))
  }

  function imageRenderSpec(editor: Editor, attrs: Record<string, unknown>) {
    const node = editor.schema.nodeFromJSON({ type: 'inlineImage', attrs })
    const extension = InlineImageExtension.configure({})
    return (extension.config.renderHTML as any).call(extension, { node })
  }

  it('serializes presentation attrs and parses them back through one presentation module', () => {
    const editor = createEditor()
    try {
      const attrs = {
        src: IMAGE_SRC,
        alt: 'diagram',
        align: 'right',
        displayWidth: 480,
        naturalWidth: 1600,
        naturalHeight: 900,
        cropX: 1000,
        cropY: 2000,
        cropWidth: 5000,
        cropHeight: 4000,
      }
      const spec = imageRenderSpec(editor, attrs) as ['img', Record<string, string>]
      assert.equal(spec[0], 'img')
      assert.equal(spec[1]['data-width'], '480')
      assert.equal(spec[1]['data-natural-width'], '1600')
      assert.equal(spec[1]['data-natural-height'], '900')
      assert.equal(spec[1]['data-crop-x'], '1000')
      assert.equal(spec[1]['data-crop-y'], '2000')
      assert.equal(spec[1]['data-crop-width'], '5000')
      assert.equal(spec[1]['data-crop-height'], '4000')

      const parsed = imageParseAttrs(spec[1]) as Record<string, unknown>
      for (const key of [
        'displayWidth', 'naturalWidth', 'naturalHeight', 'cropX', 'cropY', 'cropWidth', 'cropHeight',
      ]) {
        assert.equal(parsed[key], attrs[key as keyof typeof attrs], key)
      }
    } finally {
      editor.destroy()
    }
  })

  it('drops invalid presentation metadata instead of storing it', () => {
    const parsed = imageParseAttrs({
      src: IMAGE_SRC,
      alt: 'diagram',
      'data-width': '79',
      'data-natural-width': '1600',
      'data-natural-height': '0',
      'data-crop-x': '1000',
      'data-crop-y': '2000',
      'data-crop-width': '5000',
      'data-crop-height': '4000',
    }) as Record<string, unknown>
    assert.equal(parsed.displayWidth, null)
    assert.equal(parsed.naturalWidth, null)
    assert.equal(parsed.naturalHeight, null)
    assert.equal(parsed.cropX, null)
  })
})

function renderNodeView(options: {
  selected: boolean
  attrs?: Record<string, unknown>
  updateAttributes?: (attributes: Record<string, unknown>) => void
}) {
  const editor = createEditor()
  try {
    const node = editor.schema.nodeFromJSON({
      type: 'inlineImage',
      attrs: {
        src: IMAGE_SRC,
        alt: 'diagram',
        align: 'center',
        ...options.attrs,
      },
    })
    const updates: Array<Record<string, unknown>> = []
    const markup = renderToStaticMarkup(createElement(InlineImageNodeView, {
      node,
      editor,
      view: editor.view,
      getPos: () => 1,
      selected: options.selected,
      extension: InlineImageExtension.configure({}),
      updateAttributes: options.updateAttributes ?? ((attributes: Record<string, unknown>) => updates.push(attributes)),
      deleteNode: () => undefined,
    } as never))
    return { markup, updates, editor }
  } catch (error) {
    editor.destroy()
    throw error
  }
}

describe('inline image node view chrome', () => {
  it('renders the floating toolbar with accessible icon names above the image', () => {
    const { markup } = renderNodeView({ selected: true, attrs: { displayWidth: 480 } })
    for (const name of [
      'Crop image',
      'Rotate image left',
      'Rotate image right',
      'Reset image size',
      'Remove image',
    ]) {
      assert.ok(markup.includes(`aria-label="${name}"`), `${name} must be an accessible name`)
    }
    assert.match(markup, /role="toolbar"/)
  })

  it('renders four corner resize handles with focus support and no stored styles', () => {
    const { markup } = renderNodeView({ selected: true, attrs: { displayWidth: 480 } })
    for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
      assert.match(markup, new RegExp(`aria-label="Resize image ${corner}"`))
    }
    const handleCount = (markup.match(/inline-image-resize-handle/g) ?? []).length
    assert.ok(handleCount >= 4, 'four corner handles must render')
    assert.ok(markup.includes('data-width="480"'), 'committed width is visible as data-width')
    const img = markup.match(/<img[^>]*>/)?.[0] ?? ''
    assert.doesNotMatch(img, /style=/, 'the live editor img must not carry a style attribute')
    assert.ok(markup.includes('focus-visible'), 'handles and toolbar expose focus-visible styles')
  })

  it('hides the chrome when the image is not selected', () => {
    const { markup } = renderNodeView({ selected: false, attrs: { displayWidth: 480 } })
    assert.ok(markup.includes('data-width="480"'))
    assert.doesNotMatch(markup, /role="toolbar"/)
    assert.doesNotMatch(markup, /inline-image-resize-handle/)
  })

  it('replaces the old full-width action row', () => {
    const { markup } = renderNodeView({ selected: true })
    assert.doesNotMatch(markup, /Image controls/, 'the legacy action row label is gone')
    assert.doesNotMatch(markup, /mt-2 flex flex-wrap/, 'the legacy action row layout is gone')
  })
})

describe('inline image resize escape guard', () => {
  type FakeKeyboardEvent = {
    key: string
    defaultPrevented: boolean
    propagationStopped: boolean
    preventDefault(): void
    stopPropagation(): void
  }

  function fakeKeydown(key: string): FakeKeyboardEvent {
    return {
      key,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() { this.defaultPrevented = true },
      stopPropagation() { this.propagationStopped = true },
    }
  }

  /** Mirrors DOM keydown order: window capture listeners run before the
   * document-level listeners a Radix dialog uses for Escape dismissal. */
  function createFakeWindow() {
    const windowCapture: Array<(event: FakeKeyboardEvent) => void> = []
    const documentBubble: Array<(event: FakeKeyboardEvent) => void> = []
    return {
      addEventListener(
        type: string,
        listener: (event: FakeKeyboardEvent) => void,
        options?: { capture?: boolean },
      ) {
        if (type !== 'keydown') return
        if (options?.capture) windowCapture.push(listener)
        else documentBubble.push(listener)
      },
      removeEventListener(
        type: string,
        listener: (event: FakeKeyboardEvent) => void,
        options?: { capture?: boolean },
      ) {
        if (type !== 'keydown') return
        const list = options?.capture ? windowCapture : documentBubble
        const index = list.indexOf(listener)
        if (index !== -1) list.splice(index, 1)
      },
      dispatchKeydown(event: FakeKeyboardEvent) {
        for (const listener of windowCapture) listener(event)
        if (!event.propagationStopped) {
          for (const listener of documentBubble) listener(event)
        }
        return { reachedDocument: !event.propagationStopped }
      },
    }
  }

  it('intercepts Escape on the window capture phase and stops dialog-level dismissal', () => {
    const target = createFakeWindow()
    const dialogDismissals: string[] = []
    target.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') dialogDismissals.push('dialog dismissed')
    })
    const discards: string[] = []
    const detach = attachInlineImageResizeEscapeGuard(target, () => discards.push('discard'))

    const escape = fakeKeydown('Escape')
    const result = target.dispatchKeydown(escape)
    assert.equal(result.reachedDocument, false, 'stopPropagation must halt the event before document listeners')
    assert.equal(escape.defaultPrevented, true)
    assert.deepEqual(dialogDismissals, [], 'the dialog must not see Escape while a resize drag is live')
    assert.deepEqual(discards, ['discard'])

    const tab = fakeKeydown('Tab')
    const tabResult = target.dispatchKeydown(tab)
    assert.equal(tabResult.reachedDocument, true)
    assert.equal(tab.defaultPrevented, false)
    assert.deepEqual(discards, ['discard'], 'only Escape discards the session')

    detach()
    const laterEscape = fakeKeydown('Escape')
    target.dispatchKeydown(laterEscape)
    assert.deepEqual(dialogDismissals, ['dialog dismissed'], 'after detach the dialog regains Escape handling')
    assert.deepEqual(discards, ['discard'])
  })

  it('Escape during an active drag commits nothing and leaves no preview on the real editor', () => {
    const editor = createEditor(imageDoc(400))
    try {
      editor.view.dispatch(
        editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 1)),
      )
      let documentChanges = 0
      editor.on('transaction', ({ transaction }) => {
        if (transaction.docChanged) documentChanges += 1
      })
      const baseline = documentChanges

      let previewWidth: number | null = null
      const commits: Array<number | null> = []
      const session = createInlineImageResizeSession({
        edge: 'right',
        startPointerX: 0,
        startWidth: 400,
        editorWidth: 800,
        onPreview: (width) => { previewWidth = width },
        onCommit: (width) => {
          commits.push(width)
          if (width !== null) {
            applyInlineImageAttributes(editor, 1, { displayWidth: width })
          }
        },
      })
      session.preview(250)
      session.preview(300)
      assert.equal(previewWidth, 700)
      assert.equal(documentChanges, baseline, 'previews must not dispatch')

      const target = createFakeWindow()
      const detach = attachInlineImageResizeEscapeGuard(
        target,
        () => discardInlineImageResizeSession(session, () => { previewWidth = null }),
      )
      target.dispatchKeydown(fakeKeydown('Escape'))
      detach()

      assert.deepEqual(commits, [], 'Escape must not commit a width')
      assert.equal(previewWidth, null, 'the local preview width must not outlive the cancelled drag')
      assert.equal(documentChanges, baseline)
      const renderedWidth = previewWidth ?? editor.state.doc.nodeAt(1)?.attrs.displayWidth
      assert.equal(renderedWidth, 400, 'rendering falls back to the committed width')
      assert.equal(editor.state.doc.nodeAt(1)?.attrs.displayWidth, 400)
    } finally {
      editor.destroy()
    }
  })
})

describe('inline image resize discard', () => {
  it('clears the local preview after cancel restores, leaving no lingering width', () => {
    let previewWidth: number | null = null
    const previews: number[] = []
    const commits: Array<number | null> = []
    const session = createInlineImageResizeSession({
      edge: 'right',
      startPointerX: 0,
      startWidth: 400,
      editorWidth: 800,
      onPreview: (width) => { previews.push(width); previewWidth = width },
      onCommit: (width) => commits.push(width),
    })
    session.preview(200)
    assert.equal(previewWidth, 600)

    discardInlineImageResizeSession(session, () => { previewWidth = null })

    assert.equal(previewWidth, null, 'the clear must win over cancel’s start-width preview')
    assert.deepEqual(commits, [])
    assert.deepEqual(previews, [600, 400], 'cancel still previews its restore before the clear')
    assert.equal(session.commit(), null)
    assert.deepEqual(commits, [])
  })
})

describe('tooltip wrapper', () => {
  it('merges the trigger through asChild and reflects open tooltip state on it', () => {
    // ReactDOMServer cannot render portal content, so open-state wiring is
    // asserted on the trigger; portal/tooltip rendering is verified live.
    const markup = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(
          Tooltip,
          { defaultOpen: true },
          createElement(TooltipTrigger, { asChild: true }, createElement('button', { type: 'button', 'aria-label': 'Align left' }, 'L')),
          createElement(TooltipContent, { forceMount: true }, 'Align left'),
        ),
      ),
    )
    assert.match(markup, /^<button[^>]*aria-label="Align left"/, 'asChild renders the button without a wrapper element')
    assert.match(markup, /data-state="instant-open"/, 'an open tooltip reflects its state on the trigger')
    assert.match(markup, /aria-describedby=/, 'the open tooltip links its content to the trigger')
  })
})
