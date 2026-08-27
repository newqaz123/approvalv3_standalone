import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { optimizeImageAttachment } from '../../src/lib/attachments/image-optimization'

async function createImage(
  width: number,
  height: number,
  channels: 3 | 4,
  format: 'jpeg' | 'png' | 'webp',
) {
  const input = sharp({
    create: {
      width,
      height,
      channels,
      background: channels === 4
        ? { r: 30, g: 90, b: 150, alpha: 0.5 }
        : { r: 30, g: 90, b: 150 },
    },
  })
  if (format === 'jpeg') return input.jpeg({ quality: 100 }).toBuffer()
  if (format === 'webp') return input.webp({ quality: 100 }).toBuffer()
  return input.png({ compressionLevel: 9 }).toBuffer()
}

describe('optimizeImageAttachment', () => {
  it('caps landscape and portrait images at a 2048px longest edge', async () => {
    for (const [fileName, mimeType, format] of [
      ['landscape.jpg', 'image/jpeg', 'jpeg'],
      ['portrait.webp', 'image/webp', 'webp'],
    ] as const) {
      const input = await createImage(4000, 3000, 3, format)
      const result = await optimizeImageAttachment({ bytes: input, fileName, mimeType })
      const metadata = await sharp(result.bytes).metadata()
      assert.ok(Math.max(metadata.width ?? 0, metadata.height ?? 0) <= 2048)
      assert.ok(result.storedSize <= result.originalSize)
      assert.equal(result.storedSize, result.bytes.length)
    }
  })

  it('does not enlarge an image already within the bound', async () => {
    const input = await createImage(800, 600, 3, 'jpeg')
    const result = await optimizeImageAttachment({
      bytes: input,
      fileName: 'small.jpg',
      mimeType: 'image/jpeg',
    })
    const metadata = await sharp(result.bytes).metadata()
    assert.equal(metadata.width, 800)
    assert.equal(metadata.height, 600)
  })

  it('keeps PNG format and transparency while palette-compressing', async () => {
    const input = await createImage(2400, 1600, 4, 'png')
    const result = await optimizeImageAttachment({
      bytes: input,
      fileName: 'transparent.png',
      mimeType: 'image/png',
    })
    const metadata = await sharp(result.bytes).metadata()
    assert.equal(metadata.format, 'png')
    assert.equal(metadata.hasAlpha, true)
    assert.equal(result.storedSize, result.bytes.length)
  })

  it('falls back to original bytes when optimization is larger', async () => {
    const input = await sharp({
      create: { width: 1, height: 1, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } },
    }).png({ compressionLevel: 9 }).toBuffer()
    const result = await optimizeImageAttachment({
      bytes: input,
      fileName: 'tiny.png',
      mimeType: 'image/png',
    })
    assert.equal(result.optimized, false)
    assert.deepEqual(result.bytes, input)
    assert.equal(result.storedSize, input.length)
  })

  it('passes GIF and non-image bytes through unchanged', async () => {
    const gif = Buffer.from('gif-bytes')
    const pdf = Buffer.from('pdf-bytes')
    const gifResult = await optimizeImageAttachment({ bytes: gif, fileName: 'a.gif', mimeType: 'image/gif' })
    const pdfResult = await optimizeImageAttachment({ bytes: pdf, fileName: 'a.pdf', mimeType: 'application/pdf' })
    assert.equal(gifResult.optimized, false)
    assert.equal(pdfResult.optimized, false)
    assert.deepEqual(gifResult.bytes, gif)
    assert.deepEqual(pdfResult.bytes, pdf)
  })

  it('rejects corrupt eligible image bytes', async () => {
    await assert.rejects(
      () => optimizeImageAttachment({ bytes: Buffer.from('not an image'), fileName: 'bad.jpg', mimeType: 'image/jpeg' }),
      Error,
    )
  })
})
