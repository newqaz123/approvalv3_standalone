import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  INLINE_IMAGE_CROP_SCALE,
  INLINE_IMAGE_MAX_DISPLAY_WIDTH,
  INLINE_IMAGE_MIN_DISPLAY_WIDTH,
  clampInlineImageDisplayWidth,
  computeInlineImageFrameGeometry,
  cropAspectRatio,
  parseInlineImagePresentation,
  pixelRectToNormalizedInlineImageCrop,
  sanitizeInlineImagePresentationAttributes,
  serializeInlineImagePresentation,
} from '@/lib/inline-images/presentation'

const VALID_CROP_ATTRIBUTES = {
  'data-natural-width': '1600',
  'data-natural-height': '900',
  'data-crop-x': '1000',
  'data-crop-y': '2000',
  'data-crop-width': '5000',
  'data-crop-height': '4000',
}

describe('inline image presentation metadata', () => {
  it('uses the approved display and crop bounds', () => {
    assert.equal(INLINE_IMAGE_MIN_DISPLAY_WIDTH, 80)
    assert.equal(INLINE_IMAGE_MAX_DISPLAY_WIDTH, 2048)
    assert.equal(INLINE_IMAGE_CROP_SCALE, 10_000)
  })

  it('strictly accepts only bounded decimal integer display widths', () => {
    for (const value of ['80', '480', '2048']) {
      assert.equal(parseInlineImagePresentation({ 'data-width': value }).displayWidth, Number(value))
    }

    for (const value of [
      '79', '2049', '480px', '+480', '4e2', '480.0', '-480', '0480', '',
      '9007199254740992', '999999999999999999999999999999999999',
    ]) {
      assert.equal(parseInlineImagePresentation({ 'data-width': value }).displayWidth, null, value)
    }
  })

  it('retains natural dimensions only as a valid bounded pair', () => {
    assert.deepEqual(parseInlineImagePresentation({
      'data-natural-width': '1',
      'data-natural-height': '65535',
    }), {
      displayWidth: null,
      naturalWidth: 1,
      naturalHeight: 65535,
      crop: null,
    })

    for (const attributes of [
      { 'data-natural-width': '1600' },
      { 'data-natural-height': '900' },
      { 'data-natural-width': '0', 'data-natural-height': '900' },
      { 'data-natural-width': '65536', 'data-natural-height': '900' },
      { 'data-natural-width': '1600.5', 'data-natural-height': '900' },
    ]) {
      const parsed = parseInlineImagePresentation(attributes)
      assert.equal(parsed.naturalWidth, null)
      assert.equal(parsed.naturalHeight, null)
      assert.equal(parsed.crop, null)
    }
  })

  it('accepts a complete fully-contained crop with valid natural dimensions', () => {
    assert.deepEqual(parseInlineImagePresentation({
      'data-width': '480',
      ...VALID_CROP_ATTRIBUTES,
    }), {
      displayWidth: 480,
      naturalWidth: 1600,
      naturalHeight: 900,
      crop: { x: 1000, y: 2000, width: 5000, height: 4000 },
    })

    assert.deepEqual(parseInlineImagePresentation({
      'data-natural-width': '1',
      'data-natural-height': '1',
      'data-crop-x': '0',
      'data-crop-y': '0',
      'data-crop-width': '10000',
      'data-crop-height': '10000',
    }).crop, { x: 0, y: 0, width: 10000, height: 10000 })
  })

  it('rejects partial and out-of-bounds crop metadata while preserving safe width', () => {
    assert.deepEqual(parseInlineImagePresentation({
      'data-width': '480',
      'data-natural-width': '1600',
      'data-natural-height': '900',
      'data-crop-x': '4000',
      'data-crop-y': '0',
      'data-crop-width': '7000',
      'data-crop-height': '10000',
    }), {
      displayWidth: 480,
      naturalWidth: 1600,
      naturalHeight: 900,
      crop: null,
    })

    for (const overrides of [
      { 'data-crop-height': undefined },
      { 'data-crop-x': '10000' },
      { 'data-crop-y': '10000' },
      { 'data-crop-width': '0' },
      { 'data-crop-height': '10001' },
      { 'data-crop-x': '-1' },
      { 'data-crop-y': '1.5' },
      { 'data-crop-width': '4e2' },
    ]) {
      assert.equal(parseInlineImagePresentation({
        ...VALID_CROP_ATTRIBUTES,
        ...overrides,
      }).crop, null, JSON.stringify(overrides))
    }
  })

  it('rejects crop metadata without valid natural dimensions', () => {
    const { ['data-natural-width']: _width, ['data-natural-height']: _height, ...cropOnly } = VALID_CROP_ATTRIBUTES
    assert.equal(parseInlineImagePresentation(cropOnly).crop, null)
  })

  it('serializes only valid metadata in deterministic attribute order', () => {
    const serialized = serializeInlineImagePresentation({
      displayWidth: 480,
      naturalWidth: 1600,
      naturalHeight: 900,
      crop: { x: 1000, y: 2000, width: 5000, height: 4000 },
    })

    assert.deepEqual(Object.entries(serialized), [
      ['data-width', '480'],
      ['data-natural-width', '1600'],
      ['data-natural-height', '900'],
      ['data-crop-x', '1000'],
      ['data-crop-y', '2000'],
      ['data-crop-width', '5000'],
      ['data-crop-height', '4000'],
    ])

    assert.deepEqual(serializeInlineImagePresentation({
      displayWidth: Number.NaN,
      naturalWidth: 1600,
      naturalHeight: null,
      crop: { x: 0, y: 0, width: 10000, height: 10000 },
    }), {})
  })

  it('sanitizes arbitrary attribute maps through the parser and serializer', () => {
    assert.deepEqual(sanitizeInlineImagePresentationAttributes({
      style: 'width:999999px',
      class: 'evil',
      'data-width': '480',
      ...VALID_CROP_ATTRIBUTES,
    }), {
      'data-width': '480',
      ...VALID_CROP_ATTRIBUTES,
    })
  })
})

describe('inline image pure geometry', () => {
  it('clamps and rounds resize widths to the editor and stored bounds', () => {
    assert.equal(clampInlineImageDisplayWidth(20, 600), 80)
    assert.equal(clampInlineImageDisplayWidth(479.6, 600), 480)
    assert.equal(clampInlineImageDisplayWidth(900, 600), 600)
    assert.equal(clampInlineImageDisplayWidth(3000, 4000), 2048)
  })

  it('computes crop aspect from normalized source coordinates', () => {
    assert.equal(cropAspectRatio({
      crop: { x: 1000, y: 1000, width: 5000, height: 5000 },
      naturalWidth: 1600,
      naturalHeight: 900,
    }), 1600 / 900)
  })

  it('converts a clamped pixel rectangle by rounding normalized edges independently', () => {
    assert.deepEqual(pixelRectToNormalizedInlineImageCrop({
      x: -100,
      y: 100,
      width: 600,
      height: 500,
      naturalWidth: 1000,
      naturalHeight: 1000,
    }), { x: 0, y: 1000, width: 5000, height: 5000 })

    assert.deepEqual(pixelRectToNormalizedInlineImageCrop({
      x: 1,
      y: 1,
      width: 1,
      height: 1,
      naturalWidth: 3,
      naturalHeight: 3,
    }), { x: 3333, y: 3333, width: 3334, height: 3334 })

    assert.equal(pixelRectToNormalizedInlineImageCrop({
      x: 9999.6,
      y: 9999.6,
      width: 0.4,
      height: 0.4,
      naturalWidth: 10000,
      naturalHeight: 10000,
    }), null)
  })

  it('returns null for invalid or empty pixel rectangles', () => {
    for (const input of [
      { x: 0, y: 0, width: 0, height: 10, naturalWidth: 100, naturalHeight: 100 },
      { x: 100, y: 0, width: 10, height: 10, naturalWidth: 100, naturalHeight: 100 },
      { x: 0, y: 0, width: 10, height: 10, naturalWidth: 0, naturalHeight: 100 },
      { x: Number.NaN, y: 0, width: 10, height: 10, naturalWidth: 100, naturalHeight: 100 },
      { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 10, naturalWidth: 100, naturalHeight: 100 },
    ]) {
      assert.equal(pixelRectToNormalizedInlineImageCrop(input), null)
    }
  })

  it('computes trusted responsive frame geometry from validated values', () => {
    assert.deepEqual(computeInlineImageFrameGeometry({
      crop: { x: 1000, y: 2000, width: 5000, height: 4000 },
      naturalWidth: 1600,
      naturalHeight: 900,
      displayWidth: 480,
    }), {
      frameWidth: 480,
      frameHeight: 216,
      aspectRatio: 20 / 9,
      imageWidthPercent: 200,
      imageHeightPercent: 250,
      imageOffsetXPercent: -20,
      imageOffsetYPercent: -50,
    })

    assert.deepEqual(computeInlineImageFrameGeometry({
      crop: { x: 1000, y: 2000, width: 5000, height: 4000 },
      naturalWidth: 1600,
      naturalHeight: 900,
      displayWidth: null,
    }), {
      frameWidth: 800,
      frameHeight: 360,
      aspectRatio: 20 / 9,
      imageWidthPercent: 200,
      imageHeightPercent: 250,
      imageOffsetXPercent: -20,
      imageOffsetYPercent: -50,
    })
  })

  it('returns null rather than trusting invalid frame inputs', () => {
    for (const input of [
      { crop: { x: 6000, y: 0, width: 5000, height: 10000 }, naturalWidth: 1600, naturalHeight: 900, displayWidth: 480 },
      { crop: { x: 0, y: 0, width: 10000, height: 10000 }, naturalWidth: 0, naturalHeight: 900, displayWidth: 480 },
      { crop: { x: 0, y: 0, width: 10000, height: 10000 }, naturalWidth: 1600, naturalHeight: 900, displayWidth: 79 },
      { crop: { x: 0, y: 0, width: 10000, height: 10000 }, naturalWidth: 1600, naturalHeight: Number.NaN, displayWidth: null },
    ]) {
      assert.equal(computeInlineImageFrameGeometry(input), null)
    }
  })
})
