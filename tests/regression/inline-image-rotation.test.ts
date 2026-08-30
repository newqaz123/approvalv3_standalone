import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  canonicalCropToVisualCrop,
  normalizeInlineImageRotation,
  rotateInlineImage,
  rotatedInlineImageDimensions,
  visualCropToCanonicalCrop,
} from '@/lib/inline-images/rotation'

const crop = { x: 1000, y: 2000, width: 3000, height: 4000 }

describe('inline image quarter-turn rotation', () => {
  it('cycles left and right modulo 360 and rejects arbitrary angles', () => {
    assert.equal(rotateInlineImage(0, 'left'), 270)
    assert.equal(rotateInlineImage(270, 'right'), 0)
    assert.equal(rotateInlineImage(90, 'right'), 180)
    assert.equal(normalizeInlineImageRotation(45), 0)
    assert.equal(normalizeInlineImageRotation('90'), 90)
  })

  it('maps canonical crops into each visual orientation', () => {
    assert.deepEqual(canonicalCropToVisualCrop(crop, 0), crop)
    assert.deepEqual(canonicalCropToVisualCrop(crop, 90), { x: 4000, y: 1000, width: 4000, height: 3000 })
    assert.deepEqual(canonicalCropToVisualCrop(crop, 180), { x: 6000, y: 4000, width: 3000, height: 4000 })
    assert.deepEqual(canonicalCropToVisualCrop(crop, 270), { x: 2000, y: 6000, width: 4000, height: 3000 })
  })

  it('round-trips every visual crop and swaps quarter-turn dimensions', () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      assert.deepEqual(
        visualCropToCanonicalCrop(canonicalCropToVisualCrop(crop, rotation), rotation),
        crop,
      )
    }
    assert.deepEqual(rotatedInlineImageDimensions(640, 480, 90), { width: 480, height: 640 })
    assert.deepEqual(rotatedInlineImageDimensions(640, 480, 180), { width: 640, height: 480 })
  })
})
