import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Editor, type JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { NodeSelection } from '@tiptap/pm/state'
import {
  INLINE_IMAGE_CROP_SCALE,
  computeInlineImageFrameGeometry,
  cropAspectRatio,
  type InlineImagePresentation,
} from '../../src/lib/inline-images/presentation'
import {
  INLINE_IMAGE_MIN_CROP_EXTENT,
  applyInlineImageCropPreset,
  createInlineImageCropDraft,
  inlineImageCropApplyAttributes,
  inlineImageCropDisplayDelta,
  normalizeInlineImageCropPinchZoom,
  normalizeInlineImageCropWheelZoom,
  panInlineImageCrop,
  resizeInlineImageCropEdge,
  stepInlineImageCropEdge,
  stepInlineImageCropRegion,
  zoomInlineImageCrop,
} from '../../src/components/rich-text/inline-image-crop'
import {
  INLINE_IMAGE_CROP_UNAVAILABLE_GUIDANCE,
  InlineImageCropEditor,
  rebaseInlineImageCropSurfaceDrag,
  endInlineImageCropSession,
  focusInlineImageCropButton,
  startInlineImageCropSession,
  type InlineImageCropNodeSession,
} from '../../src/components/rich-text/inline-image-crop-editor'
import {
  InlineImageExtension,
  createInlineImageCropCommandsController,
} from '../../src/components/rich-text/inline-image-extension'
import {
  InlineImageNodeFrame,
  applyInlineImageAttributes,
} from '../../src/components/rich-text/inline-image-node-view'
import { attachInlineImageResizeEscapeGuard } from '../../src/components/rich-text/inline-image-resize'
import type { InlineImageCoordinator } from '../../src/hooks/use-inline-description-images'

const IMAGE_ID = '123e4567-e89b-42d3-a456-426614174001'
const IMAGE_SRC = `/api/inline-images/${IMAGE_ID}`
const NATURAL_WIDTH = 1600
const NATURAL_HEIGHT = 900

const FULL_CROP = { x: 0, y: 0, width: INLINE_IMAGE_CROP_SCALE, height: INLINE_IMAGE_CROP_SCALE }

function presentation(overrides: Partial<InlineImagePresentation> = {}): InlineImagePresentation {
  return {
    displayWidth: null,
    naturalWidth: NATURAL_WIDTH,
    naturalHeight: NATURAL_HEIGHT,
    crop: null,
    ...overrides,
  }
}

function croppedDraft() {
  return createInlineImageCropDraft(presentation({
    crop: { x: 1000, y: 1000, width: 5000, height: 5000 },
  }))
}

describe('inline image crop draft model', () => {
  it('seeds a full-image draft from a presentation without crop', () => {
    const draft = createInlineImageCropDraft(presentation({ displayWidth: 480 }))
    assert.deepEqual(draft.crop, FULL_CROP)
    assert.equal(draft.zoom, 1)
    assert.equal(draft.panX, 0)
    assert.equal(draft.panY, 0)
    assert.equal(draft.preset, 'original')
  })

  it('seeds the parsed crop and marks the draft free', () => {
    const crop = { x: 1000, y: 2000, width: 5000, height: 4000 }
    const draft = createInlineImageCropDraft(presentation({ crop }))
    assert.deepEqual(draft.crop, crop)
    assert.equal(draft.preset, 'free')
    assert.equal(draft.zoom, 1)
  })

  it('original preset selects the full source and resets pan and zoom', () => {
    const draft = applyInlineImageCropPreset(
      zoomInlineImageCrop(panInlineImageCrop(croppedDraft(), 800, -600), 3),
      'original',
      NATURAL_WIDTH,
      NATURAL_HEIGHT,
    )
    assert.deepEqual(draft.crop, FULL_CROP)
    assert.equal(draft.zoom, 1)
    assert.equal(draft.panX, 0)
    assert.equal(draft.panY, 0)
    assert.equal(draft.preset, 'original')
  })

  it('free preset keeps the current geometry', () => {
    const before = croppedDraft()
    const draft = applyInlineImageCropPreset(before, 'free', NATURAL_WIDTH, NATURAL_HEIGHT)
    assert.deepEqual(draft.crop, before.crop)
    assert.equal(draft.preset, 'free')
  })

  it('1:1 preset produces the largest physical square centered on the current crop center', () => {
    const draft = applyInlineImageCropPreset(
      createInlineImageCropDraft(presentation()),
      '1:1',
      NATURAL_WIDTH,
      NATURAL_HEIGHT,
    )
    assert.deepEqual(draft.crop, { x: 2188, y: 0, width: 5625, height: 10_000 })
    const ratio = cropAspectRatio({ crop: draft.crop, naturalWidth: NATURAL_WIDTH, naturalHeight: NATURAL_HEIGHT })
    assert.ok(Math.abs(ratio - 1) < 0.01, `expected square aspect, got ${ratio}`)
  })

  it('4:3 and 16:9 presets match their physical aspect inside the source bounds', () => {
    const fourByThree = applyInlineImageCropPreset(
      croppedDraft(),
      '4:3',
      NATURAL_WIDTH,
      NATURAL_HEIGHT,
    )
    const fourRatio = cropAspectRatio({
      crop: fourByThree.crop,
      naturalWidth: NATURAL_WIDTH,
      naturalHeight: NATURAL_HEIGHT,
    })
    assert.ok(Math.abs(fourRatio - 4 / 3) < 0.01, `expected 4:3 aspect, got ${fourRatio}`)
    assert.ok(fourByThree.crop.x >= 0 && fourByThree.crop.y >= 0)
    assert.ok(
      fourByThree.crop.x + fourByThree.crop.width <= INLINE_IMAGE_CROP_SCALE
      && fourByThree.crop.y + fourByThree.crop.height <= INLINE_IMAGE_CROP_SCALE,
    )

    const sixteenByNine = applyInlineImageCropPreset(
      croppedDraft(),
      '16:9',
      NATURAL_WIDTH,
      NATURAL_HEIGHT,
    )
    // A 1600x900 source already is 16:9, so the preset keeps the full frame.
    assert.deepEqual(sixteenByNine.crop, FULL_CROP)
  })

  it('keeps every crop inside the normalized source after pan and resize', () => {
    const moved = panInlineImageCrop(
      { crop: { x: 1000, y: 1000, width: 5000, height: 5000 }, zoom: 1, panX: 0, panY: 0, preset: 'free' },
      9000,
      -9000,
    )
    assert.ok(moved.crop.x >= 0 && moved.crop.y >= 0)
    assert.ok(moved.crop.x + moved.crop.width <= 10_000)
    assert.ok(moved.crop.y + moved.crop.height <= 10_000)
  })

  it('pan moves the rectangle opposite the drag and accumulates pan coordinates', () => {
    const draft = panInlineImageCrop(croppedDraft(), 500, 250)
    assert.deepEqual(draft.crop, { x: 500, y: 750, width: 5000, height: 5000 })
    assert.equal(draft.panX, 500)
    assert.equal(draft.panY, 250)
  })

  it('zoom clamps to the supported range and scales the crop about its center', () => {
    const max = zoomInlineImageCrop(createInlineImageCropDraft(presentation()), 99)
    assert.equal(max.zoom, 4)
    assert.deepEqual(max.crop, { x: 3750, y: 3750, width: 2500, height: 2500 })

    const min = zoomInlineImageCrop(max, 0.1)
    assert.equal(min.zoom, 1)
    assert.deepEqual(min.crop, FULL_CROP)
  })

  it('zoom never shrinks a crop below the minimum extent', () => {
    const tiny = createInlineImageCropDraft(presentation({
      crop: { x: 4950, y: 4950, width: INLINE_IMAGE_MIN_CROP_EXTENT, height: INLINE_IMAGE_MIN_CROP_EXTENT },
    }))
    const zoomed = zoomInlineImageCrop(tiny, 4)
    assert.equal(zoomed.crop.width, INLINE_IMAGE_MIN_CROP_EXTENT)
    assert.equal(zoomed.crop.height, INLINE_IMAGE_MIN_CROP_EXTENT)
    assert.ok(zoomed.crop.x + zoomed.crop.width <= INLINE_IMAGE_CROP_SCALE)
    assert.ok(zoomed.crop.y + zoomed.crop.height <= INLINE_IMAGE_CROP_SCALE)
  })

  it('moves each of the eight edges and corners while the opposite edge stays fixed', () => {
    const base = () => createInlineImageCropDraft(presentation({
      crop: { x: 2000, y: 1000, width: 3000, height: 4000 },
    }))

    assert.deepEqual(resizeInlineImageCropEdge(base(), 'right', 1000, 0).crop, { x: 2000, y: 1000, width: 4000, height: 4000 })
    assert.deepEqual(resizeInlineImageCropEdge(base(), 'right', -1000, 0).crop, { x: 2000, y: 1000, width: 2000, height: 4000 })
    assert.deepEqual(resizeInlineImageCropEdge(base(), 'left', 1000, 0).crop, { x: 3000, y: 1000, width: 2000, height: 4000 })
    assert.deepEqual(resizeInlineImageCropEdge(base(), 'left', -1000, 0).crop, { x: 1000, y: 1000, width: 4000, height: 4000 })
    assert.deepEqual(resizeInlineImageCropEdge(base(), 'top', 0, 500).crop, { x: 2000, y: 1500, width: 3000, height: 3500 })
    assert.deepEqual(resizeInlineImageCropEdge(base(), 'bottom', 0, 500).crop, { x: 2000, y: 1000, width: 3000, height: 4500 })
    assert.deepEqual(
      resizeInlineImageCropEdge(base(), 'top-left', -500, 500).crop,
      { x: 1500, y: 1500, width: 3500, height: 3500 },
    )
    assert.deepEqual(
      resizeInlineImageCropEdge(base(), 'bottom-right', 500, -500).crop,
      { x: 2000, y: 1000, width: 3500, height: 3500 },
    )
    assert.deepEqual(
      resizeInlineImageCropEdge(base(), 'top-right', 500, -500).crop,
      { x: 2000, y: 500, width: 3500, height: 4500 },
    )
    assert.deepEqual(
      resizeInlineImageCropEdge(base(), 'bottom-left', -500, 500).crop,
      { x: 1500, y: 1000, width: 3500, height: 4500 },
    )
  })

  it('enforces the minimum crop extent on every edge beyond the source bounds', () => {
    const narrow = createInlineImageCropDraft(presentation({
      crop: { x: 0, y: 0, width: 1000, height: 1000 },
    }))
    const fromRight = resizeInlineImageCropEdge(narrow, 'right', -99_999, 0)
    assert.equal(fromRight.crop.width, INLINE_IMAGE_MIN_CROP_EXTENT)
    assert.equal(fromRight.crop.x, 0)

    const fromLeft = resizeInlineImageCropEdge(narrow, 'left', 99_999, 0)
    assert.equal(fromLeft.crop.width, INLINE_IMAGE_MIN_CROP_EXTENT)
    assert.equal(fromLeft.crop.x, 900)

    const fromTop = resizeInlineImageCropEdge(narrow, 'top', 0, 99_999)
    assert.equal(fromTop.crop.height, INLINE_IMAGE_MIN_CROP_EXTENT)
    assert.equal(fromTop.crop.y, 900)

    const fromBottom = resizeInlineImageCropEdge(narrow, 'bottom', 0, -99_999)
    assert.equal(fromBottom.crop.height, INLINE_IMAGE_MIN_CROP_EXTENT)
    assert.equal(fromBottom.crop.y, 0)
  })

  it('keeps the opposite edge fixed when a resize drag reaches a source bound', () => {
    const base = createInlineImageCropDraft(presentation({
      crop: { x: 2000, y: 1000, width: 3000, height: 4000 },
    }))

    assert.deepEqual(
      resizeInlineImageCropEdge(base, 'right', 99_999, 0).crop,
      { x: 2000, y: 1000, width: 8000, height: 4000 },
    )
    assert.deepEqual(
      resizeInlineImageCropEdge(base, 'left', -99_999, 0).crop,
      { x: 0, y: 1000, width: 5000, height: 4000 },
    )
    assert.deepEqual(
      resizeInlineImageCropEdge(base, 'bottom', 0, 99_999).crop,
      { x: 2000, y: 1000, width: 3000, height: 9000 },
    )
    assert.deepEqual(
      resizeInlineImageCropEdge(base, 'top', 0, -99_999).crop,
      { x: 2000, y: 0, width: 3000, height: 5000 },
    )
  })

  it('keyboard steps move an edge one small or large normalized step', () => {
    const base = () => createInlineImageCropDraft(presentation({
      crop: { x: 2000, y: 1000, width: 3000, height: 4000 },
    }))
    assert.deepEqual(stepInlineImageCropEdge(base(), 'right', 'ArrowRight', false).crop, { x: 2000, y: 1000, width: 3010, height: 4000 })
    assert.deepEqual(stepInlineImageCropEdge(base(), 'right', 'ArrowRight', true).crop, { x: 2000, y: 1000, width: 3100, height: 4000 })
    assert.deepEqual(stepInlineImageCropEdge(base(), 'left', 'ArrowRight', false).crop, { x: 2010, y: 1000, width: 2990, height: 4000 })
    assert.deepEqual(stepInlineImageCropEdge(base(), 'top', 'ArrowUp', false).crop, { x: 2000, y: 990, width: 3000, height: 4010 })
    assert.deepEqual(stepInlineImageCropEdge(base(), 'bottom', 'ArrowDown', true).crop, { x: 2000, y: 1000, width: 3000, height: 4100 })
  })

  it('keyboard steps move the whole crop region without changing its size', () => {
    const base = () => createInlineImageCropDraft(presentation({
      crop: { x: 2000, y: 1000, width: 3000, height: 4000 },
    }))
    const right = stepInlineImageCropRegion(base(), 'ArrowRight', false)
    assert.deepEqual(right.crop, { x: 2010, y: 1000, width: 3000, height: 4000 })
    const upLarge = stepInlineImageCropRegion(base(), 'ArrowUp', true)
    assert.deepEqual(upLarge.crop, { x: 2000, y: 900, width: 3000, height: 4000 })

    const pinned = createInlineImageCropDraft(presentation({
      crop: { x: 9900, y: 0, width: 100, height: 10_000 },
    }))
    assert.deepEqual(stepInlineImageCropRegion(pinned, 'ArrowRight', true).crop, pinned.crop)
  })

  it('wheel zoom normalizes one notch per event and clamps at the range bounds', () => {
    assert.equal(normalizeInlineImageCropWheelZoom(1, -100), 1.25)
    assert.equal(normalizeInlineImageCropWheelZoom(1.25, -100), 1.5)
    assert.equal(normalizeInlineImageCropWheelZoom(1, 100), 1)
    assert.equal(normalizeInlineImageCropWheelZoom(3.9, -100), 4)
    assert.equal(normalizeInlineImageCropWheelZoom(2.5, 0), 2.5)
  })

  it('pinch zoom multiplies by the gesture scale and clamps', () => {
    assert.equal(normalizeInlineImageCropPinchZoom(2, 1.5), 3)
    assert.equal(normalizeInlineImageCropPinchZoom(3.9, 1.5), 4)
    assert.equal(normalizeInlineImageCropPinchZoom(2, 0.5), 1)
    assert.equal(normalizeInlineImageCropPinchZoom(1, 0.5), 1)
  })

  it('rebases one-finger pan from the post-pinch draft after the other pointer lifts', () => {
    const beforePinch = createInlineImageCropDraft(presentation({
      crop: { x: 1000, y: 1000, width: 8000, height: 8000 },
    }))
    const postPinch = zoomInlineImageCrop(
      beforePinch,
      normalizeInlineImageCropPinchZoom(beforePinch.zoom, 2),
    )
    const rebased = rebaseInlineImageCropSurfaceDrag({
      drag: {
        kind: 'surface',
        originDraft: beforePinch,
        originX: 100,
        originY: 100,
        pointerIds: [1, 2],
        pinch: { distance: 120, draft: beforePinch },
      },
      draft: postPinch,
      remainingPointer: { pointerId: 2, x: 180, y: 160 },
    })

    assert.equal(rebased.pinch, null)
    assert.deepEqual(rebased.originDraft, postPinch)
    assert.deepEqual(rebased.pointerIds, [2])
    assert.equal(rebased.originX, 180)
    assert.equal(rebased.originY, 160)

    const afterPan = panInlineImageCrop(rebased.originDraft, 500, -250)
    assert.deepEqual(afterPan.crop, { x: 2500, y: 3250, width: 4000, height: 4000 })
    assert.notDeepEqual(afterPan.crop, panInlineImageCrop(beforePinch, 500, -250).crop)
  })

  it('converts display pixel deltas through the shared pixel-to-normalized converter', () => {
    const delta = inlineImageCropDisplayDelta({
      dxPixels: 100,
      dyPixels: 50,
      displayedWidth: 400,
      displayedHeight: 225,
      naturalWidth: NATURAL_WIDTH,
      naturalHeight: NATURAL_HEIGHT,
    })
    assert.equal(delta.dx, 2500)
    assert.equal(delta.dy, 2222)

    const negative = inlineImageCropDisplayDelta({
      dxPixels: -100,
      dyPixels: -50,
      displayedWidth: 400,
      displayedHeight: 225,
      naturalWidth: NATURAL_WIDTH,
      naturalHeight: NATURAL_HEIGHT,
    })
    assert.equal(negative.dx, -2500)
    assert.equal(negative.dy, -2222)

    const unusable = inlineImageCropDisplayDelta({
      dxPixels: 100,
      dyPixels: 50,
      displayedWidth: 0,
      displayedHeight: 0,
      naturalWidth: NATURAL_WIDTH,
      naturalHeight: NATURAL_HEIGHT,
    })
    assert.deepEqual(unusable, { dx: 0, dy: 0 })
  })
})

describe('inline image crop apply serialization', () => {
  it('keeps display width and natural dimensions with a partial crop', () => {
    const draft = createInlineImageCropDraft(presentation({
      displayWidth: 480,
      crop: { x: 2000, y: 1000, width: 3000, height: 4000 },
    }))
    assert.deepEqual(inlineImageCropApplyAttributes({
      draft,
      displayWidth: 480,
      naturalWidth: NATURAL_WIDTH,
      naturalHeight: NATURAL_HEIGHT,
    }), {
      displayWidth: 480,
      naturalWidth: NATURAL_WIDTH,
      naturalHeight: NATURAL_HEIGHT,
      cropX: 2000,
      cropY: 1000,
      cropWidth: 3000,
      cropHeight: 4000,
    })
  })

  it('a full-image apply removes the four crop attributes but keeps natural dimensions and display width', () => {
    const draft = applyInlineImageCropPreset(
      createInlineImageCropDraft(presentation({ displayWidth: 480, crop: { x: 2000, y: 1000, width: 3000, height: 4000 } })),
      'original',
      NATURAL_WIDTH,
      NATURAL_HEIGHT,
    )
    assert.deepEqual(inlineImageCropApplyAttributes({
      draft,
      displayWidth: 480,
      naturalWidth: NATURAL_WIDTH,
      naturalHeight: NATURAL_HEIGHT,
    }), {
      displayWidth: 480,
      naturalWidth: NATURAL_WIDTH,
      naturalHeight: NATURAL_HEIGHT,
      cropX: null,
      cropY: null,
      cropWidth: null,
      cropHeight: null,
    })
  })

  it('drops presentation-invalid values instead of committing them', () => {
    const draft = createInlineImageCropDraft(presentation())
    assert.equal(inlineImageCropApplyAttributes({
      draft,
      displayWidth: 47,
      naturalWidth: NATURAL_WIDTH,
      naturalHeight: NATURAL_HEIGHT,
    }).displayWidth, null)
  })
})

function spyCoordinator() {
  const begun: string[] = []
  const ended: string[] = []
  const coordinator = {
    uploadSessionId: '123e4567-e89b-42d3-a456-426614174099',
    upload: async () => { throw new Error('not used') },
    remove: async () => undefined,
    beginImageEdit: (editId: string) => { begun.push(editId) },
    endImageEdit: (editId: string) => { ended.push(editId) },
    get hasBlockingUploads() { return false },
    get hasActiveImageEdits() { return begun.length > ended.length },
    get hasBlockingOperations() { return begun.length > ended.length },
    get blockingReason() { return begun.length > ended.length ? 'image-edit' as const : null },
    reset: async () => undefined,
    clear: () => undefined,
  }
  return { coordinator: coordinator as unknown as InlineImageCoordinator, begun, ended }
}

describe('inline image crop session lifecycle', () => {
  it('begins one edit token with the crop token id pattern and publishes command disablement', () => {
    const { coordinator, begun, ended } = spyCoordinator()
    const cropCommands = createInlineImageCropCommandsController()
    const result = startInlineImageCropSession({
      src: IMAGE_SRC,
      presentation: presentation({ displayWidth: 480, crop: { x: 1000, y: 1000, width: 5000, height: 5000 } }),
      decodedDimensions: null,
      coordinator,
      cropCommands,
    })

    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.match(result.session.editId, new RegExp(`^crop:${IMAGE_SRC}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`))
    assert.deepEqual(begun, [result.session.editId])
    assert.deepEqual(ended, [])
    assert.equal(cropCommands.hasActiveCrop(), true)
    assert.equal(result.session.naturalWidth, NATURAL_WIDTH)
    assert.equal(result.session.naturalHeight, NATURAL_HEIGHT)
    assert.deepEqual(result.session.snapshot.crop, { x: 1000, y: 1000, width: 5000, height: 5000 })

    endInlineImageCropSession({ session: result.session, coordinator, cropCommands })
    assert.deepEqual(ended, [result.session.editId])
    assert.equal(cropCommands.hasActiveCrop(), false)
  })

  it('seeds the snapshot through the presentation parser so invalid attrs never enter a session', () => {
    const { coordinator } = spyCoordinator()
    const result = startInlineImageCropSession({
      src: IMAGE_SRC,
      presentation: {
        displayWidth: 47,
        naturalWidth: NATURAL_WIDTH,
        naturalHeight: NATURAL_HEIGHT,
        crop: { x: 0, y: 0, width: 10_001, height: 100 },
      },
      decodedDimensions: null,
      coordinator,
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.session.snapshot.displayWidth, null)
    assert.equal(result.session.snapshot.crop, null)
    endInlineImageCropSession({ session: result.session, coordinator })
  })

  it('refuses entry without natural or decoded dimensions and explains accessibly', () => {
    const { coordinator, begun } = spyCoordinator()
    const cropCommands = createInlineImageCropCommandsController()
    const result = startInlineImageCropSession({
      src: IMAGE_SRC,
      presentation: { displayWidth: 480, naturalWidth: null, naturalHeight: null, crop: null },
      decodedDimensions: null,
      coordinator,
      cropCommands,
    })

    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.guidance, INLINE_IMAGE_CROP_UNAVAILABLE_GUIDANCE)
    assert.deepEqual(begun, [])
    assert.equal(cropCommands.hasActiveCrop(), false)
  })

  it('falls back to decoded dimensions from the loaded image and persists them on apply', () => {
    const { coordinator } = spyCoordinator()
    const result = startInlineImageCropSession({
      src: IMAGE_SRC,
      presentation: { displayWidth: 480, naturalWidth: null, naturalHeight: null, crop: null },
      decodedDimensions: { width: 640, height: 480 },
      coordinator,
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.session.naturalWidth, 640)
    assert.equal(result.session.naturalHeight, 480)

    const draft = applyInlineImageCropPreset(
      createInlineImageCropDraft(result.session.snapshot),
      '1:1',
      640,
      480,
    )
    const attrs = inlineImageCropApplyAttributes({
      draft,
      displayWidth: result.session.snapshot.displayWidth,
      naturalWidth: result.session.naturalWidth,
      naturalHeight: result.session.naturalHeight,
    })
    assert.equal(attrs.naturalWidth, 640)
    assert.equal(attrs.naturalHeight, 480)
    assert.equal((attrs.cropWidth as number) > 0, true)
    endInlineImageCropSession({ session: result.session, coordinator })
  })

  it('refuses invalid decoded dimensions instead of rounding them into a session', () => {
    const { coordinator, begun } = spyCoordinator()
    const result = startInlineImageCropSession({
      src: IMAGE_SRC,
      presentation: { displayWidth: 480, naturalWidth: null, naturalHeight: null, crop: null },
      decodedDimensions: { width: 640.5, height: 480 },
      coordinator,
    })

    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.guidance, INLINE_IMAGE_CROP_UNAVAILABLE_GUIDANCE)
    assert.deepEqual(begun, [])
  })

  it('ending the session ends the token exactly once and returns focus to the crop button', () => {
    const { coordinator, ended } = spyCoordinator()
    const result = startInlineImageCropSession({
      src: IMAGE_SRC,
      presentation: presentation(),
      decodedDimensions: null,
      coordinator,
    })
    if (!result.ok) return
    let focusCalls = 0
    const input = {
      session: result.session,
      coordinator,
      focusCropButton: () => { focusCalls += 1 },
    }
    endInlineImageCropSession(input)
    endInlineImageCropSession(input)
    assert.deepEqual(ended, [result.session.editId], 'endImageEdit must fire exactly once')
    assert.equal(focusCalls, 1)
  })

  it('unmount-style cleanup ends any still-active token', () => {
    const { coordinator, begun, ended } = spyCoordinator()
    const cropCommands = createInlineImageCropCommandsController()
    const result = startInlineImageCropSession({
      src: IMAGE_SRC,
      presentation: presentation(),
      decodedDimensions: null,
      coordinator,
      cropCommands,
    })
    if (!result.ok) return
    // Teardown path: end without focus and without applying anything.
    endInlineImageCropSession({ session: result.session, coordinator, cropCommands })
    assert.deepEqual(ended, begun)
    assert.equal(cropCommands.hasActiveCrop(), false)
  })
})

function createEditor(content: JSONContent) {
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

function imageDoc(attrs: Record<string, unknown>): JSONContent {
  return {
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [{
        type: 'inlineImage',
        attrs: { src: IMAGE_SRC, alt: 'diagram', align: 'center', ...attrs },
      }],
    }],
  }
}

describe('inline image crop editor integration', () => {
  it('Apply commits crop attributes in exactly one transaction and keeps the node selected', () => {
    const editor = createEditor(imageDoc({
      displayWidth: 400,
      naturalWidth: NATURAL_WIDTH,
      naturalHeight: NATURAL_HEIGHT,
    }))
    try {
      let documentChanges = 0
      editor.on('transaction', ({ transaction }) => {
        if (transaction.docChanged) documentChanges += 1
      })
      editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 1)))
      const baseline = documentChanges

      const snapshot: InlineImagePresentation = {
        displayWidth: 400,
        naturalWidth: NATURAL_WIDTH,
        naturalHeight: NATURAL_HEIGHT,
        crop: null,
      }
      const draft = zoomInlineImageCrop(createInlineImageCropDraft(snapshot), 4)
      const attrs = inlineImageCropApplyAttributes({
        draft,
        displayWidth: snapshot.displayWidth,
        naturalWidth: snapshot.naturalWidth!,
        naturalHeight: snapshot.naturalHeight!,
      })
      applyInlineImageAttributes(editor, 1, attrs)

      assert.equal(documentChanges, baseline + 1, 'Apply must dispatch exactly one transaction')
      const node = editor.state.doc.nodeAt(1)
      assert.equal(node?.attrs.cropX, 3750)
      assert.equal(node?.attrs.cropY, 3750)
      assert.equal(node?.attrs.cropWidth, 2500)
      assert.equal(node?.attrs.cropHeight, 2500)
      assert.equal(node?.attrs.displayWidth, 400)
      assert.ok(editor.state.selection instanceof NodeSelection, 'the image stays selected after Apply')
    } finally {
      editor.destroy()
    }
  })

  it('Cancel leaves the node attributes exactly as they were without a new transaction', () => {
    const editor = createEditor(imageDoc({
      displayWidth: 400,
      naturalWidth: NATURAL_WIDTH,
      naturalHeight: NATURAL_HEIGHT,
      cropX: 1000,
      cropY: 2000,
      cropWidth: 5000,
      cropHeight: 4000,
    }))
    const { coordinator } = spyCoordinator()
    try {
      let documentChanges = 0
      editor.on('transaction', ({ transaction }) => {
        if (transaction.docChanged) documentChanges += 1
      })
      editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 1)))
      const baseline = documentChanges
      const attrsBefore = { ...editor.state.doc.nodeAt(1)!.attrs }

      const started = startInlineImageCropSession({
        src: IMAGE_SRC,
        presentation: {
          displayWidth: 400,
          naturalWidth: NATURAL_WIDTH,
          naturalHeight: NATURAL_HEIGHT,
          crop: { x: 1000, y: 2000, width: 5000, height: 4000 },
        },
        decodedDimensions: null,
        coordinator,
      })
      assert.equal(started.ok, true)
      if (!started.ok) return
      // A full interactive pan + zoom happens only in local draft state.
      endInlineImageCropSession({ session: started.session, coordinator })

      assert.equal(documentChanges, baseline, 'Cancel must not dispatch a transaction')
      assert.deepEqual({ ...editor.state.doc.nodeAt(1)!.attrs }, attrsBefore)
    } finally {
      editor.destroy()
    }
  })
})

function renderCropEditor(session: InlineImageCropNodeSession) {
  return renderToStaticMarkup(createElement(InlineImageCropEditor, {
    src: IMAGE_SRC,
    alt: 'diagram',
    session,
    onApply: () => undefined,
    onCancel: () => undefined,
  } as never))
}

function cropSession(overrides: Partial<InlineImagePresentation> = {}): InlineImageCropNodeSession {
  return {
    editId: `crop:${IMAGE_SRC}:00000000-0000-4000-8000-000000000000`,
    snapshot: presentation(overrides),
    naturalWidth: NATURAL_WIDTH,
    naturalHeight: NATURAL_HEIGHT,
    ended: false,
  }
}

describe('inline image crop chrome', () => {
  const frameProps = () => ({
    frameRef: { current: null },
    imageRef: { current: null },
    src: IMAGE_SRC,
    alt: 'diagram',
    align: 'center' as const,
    selected: true,
    renderedWidth: 400,
    editable: true,
    removePending: false,
    toolbarPlacement: 'above' as const,
    presentationAttributes: {},
    cropGeometry: null,
    crop: null as {
      session: InlineImageCropNodeSession
      onApply: (attributes: Record<string, unknown>) => void
      onCancel: () => void
    } | null,
    cropGuidance: null as string | null,
    onAltChange: () => undefined,
    onAlignChange: () => undefined,
    onCrop: () => undefined,
    onResetSize: () => undefined,
    onRemove: () => undefined,
    resizeHandlers: {
      disabled: false,
      onPointerDown: () => undefined,
      onPointerMove: () => undefined,
      onPointerUp: () => undefined,
      onPointerCancel: () => undefined,
      onKeyDown: () => undefined,
      onDoubleClick: () => undefined,
    },
  })

  it('hides the normal toolbar and resize handles while crop controls are shown', () => {
    const markup = renderToStaticMarkup(createElement(InlineImageNodeFrame, {
      ...frameProps(),
      crop: {
        session: cropSession(),
        onApply: () => undefined,
        onCancel: () => undefined,
      },
    } as never))

    assert.ok(markup.includes('data-crop-active="true"'))
    assert.ok(markup.includes('inline-image-crop-surface'))
    assert.ok(markup.includes('aria-label="Apply crop"'))
    assert.ok(markup.includes('aria-label="Cancel crop"'))
    assert.doesNotMatch(markup, /role="toolbar"/, 'the normal toolbar must hide during crop')
    assert.doesNotMatch(markup, /inline-image-resize-handle/, 'resize handles must hide during crop')
    assert.doesNotMatch(markup, /aria-label="Crop image"/, 'the toolbar crop button must hide during crop')
  })

  it('shows the normal toolbar and handles again after the crop session exits', () => {
    const markup = renderToStaticMarkup(createElement(InlineImageNodeFrame, frameProps() as never))

    assert.match(markup, /role="toolbar"/)
    assert.match(markup, /aria-label="Crop image"/)
    assert.ok((markup.match(/inline-image-resize-handle/g) ?? []).length >= 4)
    assert.doesNotMatch(markup, /inline-image-crop-surface/)
  })

  it('keeps a transient resize preview width on the live image data attribute', () => {
    const markup = renderToStaticMarkup(createElement(InlineImageNodeFrame, {
      ...frameProps(),
      presentationAttributes: { 'data-width': '480' },
      renderedWidth: 600,
    } as never))

    assert.match(markup, /data-width="600"/)
    assert.doesNotMatch(markup, /data-width="480"/)
  })

  it('surfaces the dimension refusal as an accessible status message', () => {
    const markup = renderToStaticMarkup(createElement(InlineImageNodeFrame, {
      ...frameProps(),
      renderedWidth: null,
      cropGuidance: INLINE_IMAGE_CROP_UNAVAILABLE_GUIDANCE,
    } as never))

    assert.ok(markup.includes('role="status"'))
    assert.ok(markup.includes(INLINE_IMAGE_CROP_UNAVAILABLE_GUIDANCE))
  })

  it('renders the cropped node through the trusted clipped frame with serialized data attributes', () => {
    const markup = renderToStaticMarkup(createElement(InlineImageNodeFrame, {
      ...frameProps(),
      renderedWidth: 480,
      presentationAttributes: {
        'data-width': '480',
        'data-natural-width': '1600',
        'data-natural-height': '900',
        'data-crop-x': '2500',
        'data-crop-y': '1000',
        'data-crop-width': '5000',
        'data-crop-height': '4000',
      },
      cropGeometry: computeInlineImageFrameGeometry({
        crop: { x: 2500, y: 1000, width: 5000, height: 4000 },
        naturalWidth: 1600,
        naturalHeight: 900,
        displayWidth: 480,
      }),
    } as never))
    assert.match(markup, /inline-image-crop-frame/)
    assert.match(markup, /inline-image-crop-frame-image/)
    assert.match(markup, /data-natural-width="1600"/)
    assert.match(markup, /data-natural-height="900"/)
    assert.match(markup, /data-crop-x="2500"/)
    assert.match(markup, /data-crop-width="5000"/)
    assert.match(markup, /width:200%/, 'the source scales to 10000/cropWidth percent')
    assert.match(markup, /left:-50%/, 'the source offsets by the crop origin')
    assert.match(markup, /aspect-ratio:/)
  })

  it('exposes eight focusable crop handles, the pan region, presets, zoom, and actions', () => {
    const markup = renderCropEditor(cropSession())
    for (const name of [
      'Move crop top edge',
      'Move crop right edge',
      'Move crop bottom edge',
      'Move crop left edge',
      'Move crop top-left corner',
      'Move crop top-right corner',
      'Move crop bottom-left corner',
      'Move crop bottom-right corner',
    ]) {
      assert.ok(markup.includes(`aria-label="${name}"`), `${name} must be an accessible handle name`)
    }
    assert.ok((markup.match(/inline-image-crop-handle/g) ?? []).length >= 8)
    assert.match(markup, /aria-label="Crop region"/)
    assert.match(markup, /tabindex="0"/)
    for (const preset of ['free', 'original', '1:1', '4:3', '16:9']) {
      assert.ok(markup.includes(`aria-label="Crop aspect ${preset}"`), `${preset} preset must be named`)
      assert.ok(markup.includes(`data-preset="${preset}"`))
    }
    assert.match(markup, /aria-pressed="true"/)
    assert.match(markup, /aria-label="Image zoom"/)
    assert.match(markup, /type="range"/)
    assert.match(markup, /aria-label="Cancel crop"/)
    assert.match(markup, /aria-label="Reset crop"/)
    assert.match(markup, /aria-label="Apply crop"/)
    assert.match(markup, /role="status"/)
  })

  it('renders the wrap-capable controls above the image and positions the crop rectangle in percentages', () => {
    const markup = renderCropEditor(cropSession({ crop: { x: 2500, y: 2500, width: 5000, height: 5000 } }))
    const controlsIndex = markup.indexOf('inline-image-crop-controls')
    const surfaceIndex = markup.indexOf('inline-image-crop-surface')
    assert.ok(controlsIndex >= 0 && surfaceIndex > controlsIndex, 'controls must sit above the image')
    assert.match(markup, /left:25%;top:25%;width:50%;height:50%/)
  })
})

describe('inline image crop escape', () => {
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

  it('Escape during an active crop session cancels without closing the parent dialog', () => {
    const target = createFakeWindow()
    const dialogDismissals: string[] = []
    target.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') dialogDismissals.push('dialog dismissed')
    })
    const cancels: string[] = []
    const detach = attachInlineImageResizeEscapeGuard(target, () => cancels.push('cancel'))

    const escape = fakeKeydown('Escape')
    const result = target.dispatchKeydown(escape)
    assert.equal(result.reachedDocument, false, 'Escape must stop before dialog dismissal')
    assert.equal(escape.defaultPrevented, true)
    assert.deepEqual(cancels, ['cancel'])
    assert.deepEqual(dialogDismissals, [])

    detach()
    target.dispatchKeydown(fakeKeydown('Escape'))
    assert.deepEqual(dialogDismissals, ['dialog dismissed'], 'after the session ends the dialog regains Escape')
  })
})

describe('inline image crop focus return', () => {
  it('focuses the toolbar crop button inside the frame scope', () => {
    let focused = 0
    const button = { focus: () => { focused += 1 } }
    const scope = {
      querySelector: (selector: string) => (
        selector === 'button[aria-label="Crop image"]' ? button : null
      ),
    }
    assert.equal(focusInlineImageCropButton(scope), true)
    assert.equal(focused, 1)

    const empty = { querySelector: () => null }
    assert.equal(focusInlineImageCropButton(empty), false)
  })
})

describe('inline image crop command disablement', () => {
  it('counts live crop sessions and notifies only on activity transitions', () => {
    const controller = createInlineImageCropCommandsController()
    const notifications: boolean[] = []
    const unsubscribe = controller.subscribe(() => notifications.push(controller.hasActiveCrop()))

    assert.equal(controller.hasActiveCrop(), false)
    controller.begin()
    assert.deepEqual(notifications, [true])
    controller.begin()
    assert.deepEqual(notifications, [true], 'a second concurrent session must not re-notify')
    assert.equal(controller.hasActiveCrop(), true)
    controller.end()
    assert.equal(controller.hasActiveCrop(), true)
    controller.end()
    assert.deepEqual(notifications, [true, false])
    controller.end()
    assert.equal(controller.hasActiveCrop(), false, 'extra ends must not underflow')

    unsubscribe()
    controller.begin()
    assert.deepEqual(notifications, [true, false], 'unsubscribed listeners must not be notified')
    controller.end()
  })
})
