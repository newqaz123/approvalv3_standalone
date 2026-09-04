import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const absolute = (path: string) => join(root, path)
const exists = (path: string) => existsSync(absolute(path))
const read = (path: string) => readFileSync(absolute(path), 'utf8')

function sourceText(path: string): string {
  const fullPath = absolute(path)
  return readdirSync(fullPath).sort().map((entry) => {
    const child = join(fullPath, entry)
    if (statSync(child).isDirectory()) return sourceText(join(path, entry))
    return /\.(?:ts|tsx)$/.test(entry) ? read(join(path, entry)) : ''
  }).join('\n')
}

describe('canonical request detail flow', () => {
  it('has no standalone request detail page', () => {
    assert.equal(exists('src/app/(dashboard)/requests/[requestId]/page.tsx'), false)
  })

  it('opens View Original Request through the modal deep link in a new tab', () => {
    const modal = read('src/components/requests/submitter-modal.tsx')
    assert.match(
      modal,
      /href=\{`\/requests\?requestId=\$\{encodeURIComponent\(initialData\.requestId\)\}`\}/,
    )
    assert.match(modal, /target="_blank"/)
    assert.match(modal, /rel="noopener noreferrer"/)
    assert.doesNotMatch(modal, /href=\{`\/requests\/\$\{initialData\.requestId\}`\}/)
  })

  it('does not invalidate deleted request-detail pages', () => {
    const runtime = sourceText('src')
    const invalidation = read('src/server-actions/request-view-invalidation.ts')
    assert.match(invalidation, /export function revalidateRequestViews\(\)/)
    assert.doesNotMatch(runtime, /revalidatePath\(`\/requests\/\$\{/)
    assert.doesNotMatch(runtime, /revalidateRequestViews\([^)]/)
  })
})

describe('canonical New Request flow', () => {
  const retiredFiles = [
    'src/app/(dashboard)/requests/new/page.tsx',
    'src/components/requests/request-form.tsx',
    'src/components/mobile/mobile-file-upload.tsx',
  ]

  it('removes the standalone route and its private component tree', () => {
    for (const path of retiredFiles) assert.equal(exists(path), false, path)
    const runtime = sourceText('src')
    assert.doesNotMatch(runtime, /components\/requests\/request-form/)
    assert.doesNotMatch(runtime, /components\/mobile\/mobile-file-upload/)
  })

  it('keeps both visible New Request callers on SubmitterModal request mode', () => {
    for (const path of [
      'src/components/requests/requests-list-client.tsx',
      'src/components/dashboard/follow-up-dashboard.tsx',
    ]) {
      const source = read(path)
      assert.match(source, /<SubmitterModal/)
      assert.match(source, /mode=["']request["']/)
      assert.match(source, /onSubmitRequest=/)
    }
  })

  it('does not invalidate the retired New Request page', () => {
    assert.doesNotMatch(sourceText('src'), /revalidatePath\(['"]\/requests\/new['"]\)/)
  })
})
