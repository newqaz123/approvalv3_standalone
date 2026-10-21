import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { promises as fsp } from 'node:fs'
import {
  isDisposableRuntimeRoot,
  matrixRuntimeParentDir,
  removeDisposableRuntimeRoot,
} from '../support/native/rejection-recovery-runtime'

// Each matrix run creates a throwaway PG cluster + app build (~9 GB). Keeping
// them filled the disk, so a clean stop removes the run's own root.
describe('matrix runtime root cleanup', () => {
  const parent = matrixRuntimeParentDir()

  it('only treats direct children of the matrix tmp parent as disposable', () => {
    assert.equal(isDisposableRuntimeRoot(path.join(parent, 'business-test-x-AbC')), true)
    assert.equal(isDisposableRuntimeRoot(parent), false)
    assert.equal(isDisposableRuntimeRoot('/tmp/retained-root'), false)
    assert.equal(isDisposableRuntimeRoot(path.join(parent, 'a', 'b')), false)
    assert.equal(isDisposableRuntimeRoot(path.join(parent, '..', 'elsewhere')), false)
    assert.equal(isDisposableRuntimeRoot(os.homedir()), false)
  })

  it('removes a disposable root and refuses anything else', async () => {
    await fsp.mkdir(parent, { recursive: true })
    const root = await fsp.mkdtemp(path.join(parent, 'cleanup-test-'))
    await fsp.writeFile(path.join(root, 'pgdata'), 'x')
    assert.equal(await removeDisposableRuntimeRoot(root, {}), 'removed')
    await assert.rejects(fsp.stat(root))
    assert.equal(await removeDisposableRuntimeRoot('/tmp/retained-root', {}), 'refused')
  })

  it('keeps the root when RRM_KEEP_RUNTIME=1', async () => {
    const root = await fsp.mkdtemp(path.join(parent, 'cleanup-keep-'))
    assert.equal(await removeDisposableRuntimeRoot(root, { RRM_KEEP_RUNTIME: '1' }), 'kept')
    await fsp.stat(root)
    await fsp.rm(root, { recursive: true, force: true })
  })
})
