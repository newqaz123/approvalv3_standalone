import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const LOGO_V2_SHA256 =
  'ebe1e83ee7b42cb1593447c0fc4aa9e63703843ab4eb710a768e74036066739d'

describe('browser favicon', () => {
  it('uses the supplied logo_v2 asset for Next app icon', () => {
    const icon = readFileSync('src/app/icon.png')
    const hash = createHash('sha256').update(icon).digest('hex')

    assert.equal(hash, LOGO_V2_SHA256)
    assert.deepEqual(icon.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  })
})
