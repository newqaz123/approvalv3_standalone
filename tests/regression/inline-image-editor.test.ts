import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Editor, type JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { FileHandlePlugin } from '@tiptap/extension-file-handler'
import {
  InlineImageExtension,
  collectInlineImageUploads,
  createInlineImageCropCommandsController,
  createInlineImageMimeFilter,
  createInlineImageTransactionCleanupController,
} from '../../src/components/rich-text/inline-image-extension'
import { removeInlineImageNode } from '../../src/components/rich-text/inline-image-node-view'
import {
  HighlightColorTokenMark,
  TextColorTokenMark,
} from '../../src/components/rich-text/rich-text-color-extensions'
import { sanitizeRichText } from '../../src/lib/rich-text-sanitizer'
import { emitSanitizedRichTextChange } from '../../src/components/rich-text/rich-text-editor'
import { createInlineImageCoordinator } from '../../src/hooks/use-inline-description-images'
import {
  createInlineImageCropDraft,
  inlineImageCropApplyAttributes,
  zoomInlineImageCrop,
} from '../../src/components/rich-text/inline-image-crop'
import type { InlineImageUpload } from '../../src/lib/inline-images/policy'

const IMAGE_ID = '123e4567-e89b-42d3-a456-426614174001'
const UPLOAD_ID = 'upload-a'
const IMAGE_SRC = `/api/inline-images/${IMAGE_ID}`
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

function createEditor(content: JSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
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
      TextColorTokenMark,
      HighlightColorTokenMark,
    ],
    content,
  })
}

function fakeElement(attributes: Record<string, string>): HTMLElement {
  return {
    getAttribute(name: string) {
      return attributes[name] ?? null
    },
  } as unknown as HTMLElement
}

function imageParseAttrs(attributes: Record<string, string>) {
  const extension = InlineImageExtension.configure({})
  const rules = (extension.config.parseHTML as any).call(extension) as Array<{ getAttrs?: (element: HTMLElement) => false | Record<string, unknown> }>
  return rules[0].getAttrs!(fakeElement(attributes))
}

function imageRenderSpec(editor: Editor, attrs: Record<string, unknown>) {
  const node = editor.schema.nodeFromJSON({ type: 'inlineImage', attrs })
  const extension = InlineImageExtension.configure({})
  return (extension.config.renderHTML as any).call(extension, { node })
}

function pasteEvent(file: File) {
  let prevented = false
  let stopped = false
  return {
    event: {
      clipboardData: {
        files: [file],
        getData: () => '',
      },
      preventDefault: () => { prevented = true },
      stopPropagation: () => { stopped = true },
    } as unknown as ClipboardEvent,
    wasPrevented: () => prevented,
    wasStopped: () => stopped,
  }
}

function dropEvent(file: File) {
  let prevented = false
  let stopped = false
  return {
    event: {
      dataTransfer: {
        files: [file],
        types: [],
      },
      clientX: 10,
      clientY: 20,
      preventDefault: () => { prevented = true },
      stopPropagation: () => { stopped = true },
    } as unknown as DragEvent,
    wasPrevented: () => prevented,
    wasStopped: () => stopped,
  }
}

describe('inline image TipTap behavior', () => {
  it('parses canonical internal images into the TipTap schema and rejects external images', () => {
    const editor = createEditor()
    try {
      const parsed = imageParseAttrs({
        src: `/api/inline-images/${IMAGE_ID.toUpperCase()}`,
        alt: 'diagram',
        'data-align': 'right',
      })
      assert.notEqual(parsed, false)
      const parsedNode = editor.schema.nodeFromJSON({ type: 'inlineImage', attrs: parsed as Record<string, unknown> })
      assert.equal(parsedNode.attrs.src, IMAGE_SRC)
      assert.equal(parsedNode.attrs.alt, 'diagram')
      assert.equal(parsedNode.attrs.align, 'right')

      assert.equal(imageParseAttrs({ src: 'https://example.test/image.png' }), false)
      assert.equal(imageParseAttrs({ src: 'blob:https://example.test/id' }), false)
    } finally {
      editor.destroy()
    }
  })

  it('emits only Task 1 serialized presentation data attributes for stable nodes', () => {
    const editor = createEditor()
    try {
      assert.deepEqual(imageRenderSpec(editor, {
        src: IMAGE_SRC,
        alt: 'diagram',
        align: 'right',
        uploadId: UPLOAD_ID,
        status: 'success',
        progress: 100,
        error: null,
        displayWidth: 480,
        naturalWidth: 1600,
        naturalHeight: 900,
        cropX: 1000,
        cropY: 2000,
        cropWidth: 5000,
        cropHeight: 4000,
      }), ['img', {
        src: IMAGE_SRC,
        alt: 'diagram',
        'data-align': 'right',
        'data-width': '480',
        'data-natural-width': '1600',
        'data-natural-height': '900',
        'data-crop-x': '1000',
        'data-crop-y': '2000',
        'data-crop-width': '5000',
        'data-crop-height': '4000',
      }])
    } finally {
      editor.destroy()
    }
  })

  it('renders stable and transient nodes through the real TipTap schema and sanitizer boundary', () => {
    const editor = createEditor()
    try {
      assert.deepEqual(imageRenderSpec(editor, {
        src: IMAGE_SRC,
        alt: 'diagram',
        align: 'right',
        uploadId: UPLOAD_ID,
        status: 'success',
        progress: 100,
        error: null,
      }), ['img', { src: IMAGE_SRC, alt: 'diagram', 'data-align': 'right' }])

      const transient = imageRenderSpec(editor, {
        src: null,
        alt: 'diagram',
        align: 'center',
        uploadId: UPLOAD_ID,
        status: 'uploading',
        progress: 42,
        error: null,
      })
      assert.deepEqual(transient, ['span', { 'data-inline-upload-placeholder': 'true' }])
      assert.equal(sanitizeRichText(`<span data-inline-upload-placeholder="true"></span>`), '')
      assert.equal(sanitizeRichText(`<img src="${IMAGE_SRC}" alt="diagram" data-align="right" data-upload-id="${UPLOAD_ID}">`), `<img src="${IMAGE_SRC}" alt="diagram" data-align="right" />`)
    } finally {
      editor.destroy()
    }
  })
})

describe('inline image FileHandler behavior', () => {
  it('does not consume image paste or drop events when the coordinator is unavailable or disabled', () => {
    const editor = createEditor()
    const file = new File(['image'], 'diagram.png', { type: 'image/png' })
    let enabled = false
    const pasted: File[][] = []
    const dropped: Array<{ files: File[]; position: number }> = []
    const plugin = FileHandlePlugin({
      editor,
      allowedMimeTypes: createInlineImageMimeFilter(() => enabled),
      consumePasteEvent: true,
      onPaste: (_editor, files) => pasted.push(files),
      onDrop: (_editor, files, position) => dropped.push({ files, position }),
    })
    const dropView = {
      posAtCoords: () => ({ pos: 7, inside: -1 }),
    } as unknown as typeof editor.view
    try {
      const disabledPaste = pasteEvent(file)
      assert.equal(plugin.props.handlePaste!.call(plugin, editor.view, disabledPaste.event, undefined as never), false)
      assert.equal(disabledPaste.wasPrevented(), false)
      assert.equal(disabledPaste.wasStopped(), false)

      const disabledDrop = dropEvent(file)
      assert.equal(plugin.props.handleDrop!.call(plugin, dropView, disabledDrop.event, undefined as never, false), false)
      assert.equal(disabledDrop.wasPrevented(), false)
      assert.equal(disabledDrop.wasStopped(), false)
      assert.deepEqual(pasted, [])
      assert.deepEqual(dropped, [])

      enabled = true
      const enabledPaste = pasteEvent(file)
      assert.equal(plugin.props.handlePaste!.call(plugin, editor.view, enabledPaste.event, undefined as never), true)
      assert.equal(enabledPaste.wasPrevented(), true)
      assert.equal(enabledPaste.wasStopped(), true)

      const enabledDrop = dropEvent(file)
      assert.equal(plugin.props.handleDrop!.call(plugin, dropView, enabledDrop.event, undefined as never, false), true)
      assert.equal(enabledDrop.wasPrevented(), true)
      assert.equal(enabledDrop.wasStopped(), true)
      assert.deepEqual(pasted, [[file]])
      assert.deepEqual(dropped, [{ files: [file], position: 7 }])
    } finally {
      editor.destroy()
    }
  })

  it('continues to ignore non-image files while the image handler is enabled', () => {
    const editor = createEditor()
    const file = new File(['text'], 'notes.txt', { type: 'text/plain' })
    const filesSeen: File[][] = []
    const plugin = FileHandlePlugin({
      editor,
      allowedMimeTypes: createInlineImageMimeFilter(() => true),
      consumePasteEvent: true,
      onPaste: (_editor, files) => filesSeen.push(files),
    })
    try {
      const event = pasteEvent(file)
      assert.equal(plugin.props.handlePaste!.call(plugin, editor.view, event.event, undefined as never), false)
      assert.equal(event.wasPrevented(), false)
      assert.deepEqual(filesSeen, [])
    } finally {
      editor.destroy()
    }
  })
})

describe('inline image transaction cleanup', () => {
  function successfulUpload(): InlineImageUpload {
    return {
      id: IMAGE_ID,
      src: IMAGE_SRC,
      alt: 'diagram',
      fileType: 'image/png',
      fileSize: 10,
      width: 100,
      height: 80,
    }
  }

  function localImageContent(): JSONContent {
    return {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'inlineImage',
          attrs: {
            uploadId: UPLOAD_ID,
            src: IMAGE_SRC,
            alt: 'diagram',
            align: 'center',
            status: 'success',
            progress: 100,
          },
        }],
      }],
    }
  }

  function insertLocalImage(editor: Editor) {
    return editor.commands.insertContentAt(1, localImageContent().content![0].content![0])
  }

  it('cleans a local draft after keyboard deletion and prevents undo from resurrecting it', async () => {
    const editor = createEditor(localImageContent())
    const file = new File(['image'], 'diagram.png', { type: 'image/png' })
    const fileByUploadId = new Map([[UPLOAD_ID, file]])
    const insertionPositionByUploadId = new Map([[UPLOAD_ID, 1]])
    const localUploadIds = new Set([UPLOAD_ID])
    const removedUploadIds = new Set<string>()
    const removed: string[] = []
    const coordinator = createInlineImageCoordinator({
      uploadSessionId: '123e4567-e89b-42d3-a456-426614174099',
      upload: async () => successfulUpload(),
      remove: async (imageId) => { removed.push(imageId) },
    })
    const cleanup = createInlineImageTransactionCleanupController({
      getCoordinator: () => coordinator,
      fileByUploadId,
      insertionPositionByUploadId,
      localUploadIds,
      removedUploadIds,
    })
    cleanup.attach(editor)
    editor.on('transaction', ({ editor: current }) => cleanup.handleTransaction(current))

    try {
      await coordinator.upload(UPLOAD_ID, file, () => undefined)
      assert.equal(collectInlineImageUploads(editor.state.doc).get(UPLOAD_ID)?.imageId, IMAGE_ID)

      assert.equal(editor.commands.deleteRange({ from: 1, to: 2 }), true)
      await tick()
      assert.deepEqual(removed, [IMAGE_ID])
      assert.deepEqual(coordinator.getState(), [])
      assert.equal(localUploadIds.has(UPLOAD_ID), false)
      assert.equal(fileByUploadId.has(UPLOAD_ID), false)
      assert.equal(removedUploadIds.has(UPLOAD_ID), true)

      // A history undo re-inserts the deleted node in a later transaction.
      // Dispatch that document change directly because headless TipTap does not
      // mount its history plugin when `element` is null.
      const attrs = localImageContent().content![0].content![0].attrs
      editor.view.dispatch(editor.state.tr.insert(1, editor.schema.nodes.inlineImage.create(attrs)))
      assert.equal(collectInlineImageUploads(editor.state.doc).has(UPLOAD_ID), false)
    } finally {
      cleanup.detach(editor)
      coordinator.dispose()
      editor.destroy()
    }
  })

  it('restores a retryable node and coordinator state when keyboard cleanup fails', async () => {
    const editor = createEditor()
    const file = new File(['image'], 'diagram.png', { type: 'image/png' })
    const fileByUploadId = new Map([[UPLOAD_ID, file]])
    const insertionPositionByUploadId = new Map([[UPLOAD_ID, 1]])
    const localUploadIds = new Set([UPLOAD_ID])
    const removedUploadIds = new Set<string>()
    let attempts = 0
    const coordinator = createInlineImageCoordinator({
      uploadSessionId: '123e4567-e89b-42d3-a456-426614174099',
      upload: async () => successfulUpload(),
      remove: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('cleanup unavailable')
      },
    })
    const cleanup = createInlineImageTransactionCleanupController({
      getCoordinator: () => coordinator,
      fileByUploadId,
      insertionPositionByUploadId,
      localUploadIds,
      removedUploadIds,
    })
    cleanup.attach(editor)
    editor.on('transaction', ({ editor: current }) => cleanup.handleTransaction(current))

    try {
      await coordinator.upload(UPLOAD_ID, file, () => undefined)
      assert.equal(insertLocalImage(editor), true)
      assert.equal(editor.commands.deleteRange({ from: 1, to: 2 }), true)
      await tick()
      await tick()
      assert.equal(attempts, 1)
      assert.equal(coordinator.getState()[0]?.status, 'success')

      const restored = collectInlineImageUploads(editor.state.doc).get(UPLOAD_ID)
      assert.ok(restored)
      assert.equal(restored.imageId, IMAGE_ID)
      assert.equal(restored.attrs.status, 'removal-error')
      assert.match(String(restored.attrs.error), /cleanup unavailable/)
      assert.equal(coordinator.getState()[0]?.status, 'success')
      assert.equal(localUploadIds.has(UPLOAD_ID), true)
      assert.equal(fileByUploadId.get(UPLOAD_ID), file)
      assert.equal(removedUploadIds.has(UPLOAD_ID), false)

      assert.equal(editor.commands.deleteRange({ from: restored.pos, to: restored.pos + 1 }), true)
      await tick()
      assert.equal(attempts, 2)
      assert.deepEqual(coordinator.getState(), [])
      assert.equal(collectInlineImageUploads(editor.state.doc).has(UPLOAD_ID), false)
    } finally {
      cleanup.detach(editor)
      coordinator.dispose()
      editor.destroy()
    }
  })

  it('restores a deleted local upload when no coordinator is available', async () => {
    const editor = createEditor()
    const file = new File(['image'], 'diagram.png', { type: 'image/png' })
    const fileByUploadId = new Map([[UPLOAD_ID, file]])
    const insertionPositionByUploadId = new Map([[UPLOAD_ID, 1]])
    const localUploadIds = new Set([UPLOAD_ID])
    const removedUploadIds = new Set<string>()
    const cleanup = createInlineImageTransactionCleanupController({
      getCoordinator: () => undefined,
      fileByUploadId,
      insertionPositionByUploadId,
      localUploadIds,
      removedUploadIds,
    })
    cleanup.attach(editor)
    editor.on('transaction', ({ editor: current }) => cleanup.handleTransaction(current))
    try {
      assert.equal(insertLocalImage(editor), true)
      assert.equal(editor.commands.deleteRange({ from: 1, to: 2 }), true)
      await tick()

      const restored = collectInlineImageUploads(editor.state.doc).get(UPLOAD_ID)
      assert.ok(restored, 'node must be re-inserted when cleanup cannot run')
      assert.equal(restored.imageId, IMAGE_ID)
      assert.equal(restored.attrs.status, 'removal-error')
      assert.match(String(restored.attrs.error), /cleanup is unavailable/)
      assert.equal(localUploadIds.has(UPLOAD_ID), true)
      assert.equal(fileByUploadId.get(UPLOAD_ID), file)
      assert.equal(removedUploadIds.has(UPLOAD_ID), false)
    } finally {
      cleanup.detach(editor)
      editor.destroy()
    }
  })

  it('does not clean a committed image that was never tracked locally', async () => {
    const editor = createEditor()
    let removes = 0
    const cleanup = createInlineImageTransactionCleanupController({
      getCoordinator: () => ({
        uploadSessionId: '123e4567-e89b-42d3-a456-426614174099',
        upload: async () => successfulUpload(),
        remove: async () => { removes += 1 },
        beginImageEdit: () => undefined,
        endImageEdit: () => undefined,
        hasBlockingUploads: false,
        hasActiveImageEdits: false,
        hasBlockingOperations: false,
        blockingReason: null,
        reset: async () => undefined,
        clear: () => undefined,
      }),
      fileByUploadId: new Map(),
      insertionPositionByUploadId: new Map(),
      localUploadIds: new Set(),
      removedUploadIds: new Set(),
    })
    cleanup.attach(editor)
    editor.on('transaction', ({ editor: current }) => cleanup.handleTransaction(current))
    try {
      editor.commands.insertContentAt(1, {
        type: 'inlineImage',
        attrs: { src: IMAGE_SRC, alt: '', align: 'center' },
      })
      editor.commands.deleteRange({ from: 1, to: 2 })
      await tick()
      assert.equal(removes, 0)
    } finally {
      cleanup.detach(editor)
      editor.destroy()
    }
  })
})


describe('inline image NodeView removal', () => {
  it('retains the node and local retry state when coordinator cleanup rejects', async () => {
    const file = new File(['image'], 'diagram.png', { type: 'image/png' })
    const fileByUploadId = new Map([[UPLOAD_ID, file]])
    const insertionPositionByUploadId = new Map([[UPLOAD_ID, 1]])
    const localUploadIds = new Set([UPLOAD_ID])
    const removedUploadIds = new Set<string>()
    let deleted = false
    const coordinator = createInlineImageCoordinator({
      uploadSessionId: '123e4567-e89b-42d3-a456-426614174099',
      upload: async () => ({
        id: IMAGE_ID,
        src: IMAGE_SRC,
        alt: 'diagram',
        fileType: 'image/png',
        fileSize: 10,
        width: 100,
        height: 80,
      }),
      remove: async () => { throw new Error('cleanup unavailable') },
    })
    try {
      await coordinator.upload(UPLOAD_ID, file, () => undefined)
      await assert.rejects(() => removeInlineImageNode({
        uploadId: UPLOAD_ID,
        imageId: IMAGE_ID,
        isLocalUpload: true,
        coordinator,
        fileByUploadId,
        insertionPositionByUploadId,
        localUploadIds,
        removedUploadIds,
        deleteNode: () => { deleted = true },
      }), /cleanup unavailable/)

      assert.equal(deleted, false)
      assert.equal(coordinator.getState()[0]?.status, 'success')
      assert.equal(localUploadIds.has(UPLOAD_ID), true)
      assert.equal(fileByUploadId.get(UPLOAD_ID), file)
      assert.equal(removedUploadIds.has(UPLOAD_ID), false)
    } finally {
      coordinator.dispose()
      await tick()
    }
  })
})


describe('inline image crop editor contract', () => {
  it('publishes the crop commands controller through extension options', () => {
    const controller = createInlineImageCropCommandsController()
    const configured = InlineImageExtension.configure({ cropCommands: controller })
    assert.equal(configured.options.cropCommands, controller)

    const plain = InlineImageExtension.configure({})
    assert.equal(plain.options.cropCommands, undefined)
  })

  it('commits crop apply attributes through the serialized presentation boundary', () => {
    const editor = createEditor()
    try {
      const draft = zoomInlineImageCrop(
        createInlineImageCropDraft({
          displayWidth: 400,
          naturalWidth: 1600,
          naturalHeight: 900,
          crop: null,
        }),
        4,
      )
      const attrs = inlineImageCropApplyAttributes({
        draft,
        displayWidth: 400,
        naturalWidth: 1600,
        naturalHeight: 900,
      })
      assert.deepEqual(attrs, {
        displayWidth: 400,
        naturalWidth: 1600,
        naturalHeight: 900,
        cropX: 3750,
        cropY: 3750,
        cropWidth: 2500,
        cropHeight: 2500,
      })

      const spec = imageRenderSpec(editor, { src: IMAGE_SRC, alt: 'diagram', align: 'center', ...attrs }) as ['img', Record<string, string>]
      assert.deepEqual(spec, ['img', {
        src: IMAGE_SRC,
        alt: 'diagram',
        'data-align': 'center',
        'data-width': '400',
        'data-natural-width': '1600',
        'data-natural-height': '900',
        'data-crop-x': '3750',
        'data-crop-y': '3750',
        'data-crop-width': '2500',
        'data-crop-height': '2500',
      }])

      const parsed = imageParseAttrs(spec[1]) as Record<string, unknown>
      for (const [key, value] of Object.entries(attrs)) {
        assert.equal(parsed[key], value, key)
      }
    } finally {
      editor.destroy()
    }
  })
})

describe('inline image editor contract', () => {
  it('emits sanitized canonical HTML through the onChange boundary and suppresses duplicates', () => {
    const lastEmitted = { current: null as string | null }
    const changes: string[] = []
    const html = `<p>Diagram</p><img src="${IMAGE_SRC}" alt="diagram" data-align="right" data-upload-id="${UPLOAD_ID}">`

    emitSanitizedRichTextChange(html, lastEmitted, (next) => changes.push(next))
    emitSanitizedRichTextChange(html, lastEmitted, (next) => changes.push(next))

    assert.deepEqual(changes, [`<p>Diagram</p><img src="${IMAGE_SRC}" alt="diagram" data-align="right" />`])
    assert.equal(lastEmitted.current, changes[0])
  })

  it('preserves semantic palette marks without weakening canonical image sanitization', () => {
    const lastEmitted = { current: null as string | null }
    const changes: string[] = []
    const html = `<p><span data-text-color="blue" style="color:#ff00ff">Diagram</span><mark data-highlight="yellow">Check</mark><img src="${IMAGE_SRC.toUpperCase()}" alt="diagram" data-align="right" data-width="480" data-natural-width="1600" data-natural-height="900" style="width:999px" onerror="alert(1)"></p>`

    emitSanitizedRichTextChange(html, lastEmitted, (next) => changes.push(next))

    assert.deepEqual(changes, [`<p><span data-text-color="blue">Diagram</span><mark data-highlight="yellow">Check</mark><img src="${IMAGE_SRC}" alt="diagram" data-align="right" data-width="480" data-natural-width="1600" data-natural-height="900" /></p>`])
    assert.doesNotMatch(changes[0], /style=|onerror=/)
  })

  it('combines palette marks with image nodes without adding presentation styles', () => {
    const editor = createEditor({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Diagram' },
          { type: 'inlineImage', attrs: { src: IMAGE_SRC, alt: 'diagram', align: 'center' } },
        ],
      }],
    })
    try {
      editor.commands.setTextSelection({ from: 1, to: 8 })
      assert.equal(editor.commands.setTextColorToken('blue'), true)
      assert.equal(editor.commands.setHighlightColorToken('yellow'), true)
      const text = editor.getJSON().content?.[0]?.content?.[0]
      assert.deepEqual(text?.marks?.map((mark) => mark.type).sort(), ['highlightColorToken', 'textColorToken'])
      assert.deepEqual(editor.getJSON().content?.[0]?.content?.[1]?.type, 'inlineImage')
      assert.doesNotMatch(JSON.stringify(editor.getJSON()), /style/)
    } finally {
      editor.destroy()
    }
  })

  it('keeps a live transient node out of the sanitized onChange emission', () => {
    const editor = createEditor()
    try {
      // getHTML needs a browser DOM, so compose the exact fragment the editor
      // serializes for a transient node: its verified render spec inline.
      const placeholder = imageRenderSpec(editor, {
        src: null,
        alt: 'diagram',
        align: 'center',
        uploadId: UPLOAD_ID,
        status: 'uploading',
        progress: 42,
        error: null,
      })
      assert.deepEqual(placeholder, ['span', { 'data-inline-upload-placeholder': 'true' }])

      const lastEmitted = { current: null as string | null }
      const changes: string[] = []
      const emitted = `<p>Draft text<span data-inline-upload-placeholder="true"></span></p>`
      emitSanitizedRichTextChange(emitted, lastEmitted, (next) => changes.push(next))
      assert.deepEqual(changes, ['<p>Draft text</p>'])
      assert.doesNotMatch(changes[0], new RegExp(`${UPLOAD_ID}|placeholder|blob:`))
    } finally {
      editor.destroy()
    }
  })

  it('keeps transient upload state out of the canonical output and caps parser alt text', () => {
    const editor = createEditor()
    try {
      const longAlt = 'a'.repeat(400)
      const parsed = imageParseAttrs({ src: IMAGE_SRC, alt: longAlt, 'data-align': 'invalid' }) as Record<string, unknown>
      const node = editor.schema.nodeFromJSON({ type: 'inlineImage', attrs: parsed })
      const extension = InlineImageExtension.configure({})
      const spec = (extension.config.renderHTML as any).call(extension, { node })
      assert.equal((node.attrs.alt as string).length, 300)
      assert.equal(node.attrs.align, 'center')
      assert.deepEqual(spec, ['img', { src: IMAGE_SRC, alt: 'a'.repeat(300), 'data-align': 'center' }])
      assert.doesNotMatch(JSON.stringify(spec), /uploadId|status|progress|error|blob:/)
    } finally {
      editor.destroy()
    }
  })
})
