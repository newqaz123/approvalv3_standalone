import { it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(
  'src/components/requests/request-modal-router.tsx',
  'utf8'
)

it('creates a fresh stateful router for every selected request', () => {
  assert.match(
    source,
    /export function RequestModalRouter\(props: RequestModalRouterProps\) \{[\s\S]*?<RequestModalRouterContent[\s\S]*?key=\{props\.requestId\}[\s\S]*?\{\.\.\.props\}[\s\S]*?\/>[\s\S]*?\}/
  )
  assert.match(source, /function RequestModalRouterContent\(/)
  assert.doesNotMatch(source, /key=\{(?:open|Date\.now\(\)|Math\.random\(\))/)
})

it('shows an accessible skeleton while the selected request loads', () => {
  assert.match(
    source,
    /import \{ RequestDetailSkeleton \} from '@\/components\/loading\/request-detail-skeleton'/
  )
  assert.match(source, /DialogDescription/)

  const loadingBlock = source.match(
    /if \(loading && !requestData\) \{[\s\S]*?\n  \}\n  if \(!requestData\)/
  )?.[0] ?? ''

  assert.match(loadingBlock, /<Dialog open=\{open\} onOpenChange=\{onOpenChange\}>/)
  assert.match(loadingBlock, /<DialogContent/)
  assert.match(loadingBlock, /<DialogTitle>Loading request<\/DialogTitle>/)
  assert.match(loadingBlock, /<DialogDescription className="sr-only">/)
  assert.match(loadingBlock, /Request details are loading\./)
  assert.match(loadingBlock, /<RequestDetailSkeleton \/>/)
  assert.doesNotMatch(loadingBlock, /return null/)
})
