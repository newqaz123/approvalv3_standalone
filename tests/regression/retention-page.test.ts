import { it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

it('does not pass server event handlers into AdminCard on the retention page', () => {
  const page = readFileSync('src/app/admin/retention/page.tsx', 'utf8')
  const list = readFileSync('src/components/admin/retention-request-list.tsx', 'utf8')
  assert.doesNotMatch(page, /onClick\s*:/)
  assert.match(list, /AdminCard/)
  assert.match(list, /RetentionControls/)
})

it('renders RetentionControls on mobile retention cards, not a no-op Archive action', () => {
  const list = readFileSync('src/components/admin/retention-request-list.tsx', 'utf8')
  assert.match(list, /md:hidden/)
  assert.match(list, /RetentionControls/)
  assert.doesNotMatch(list, /onClick:\s*\(\)\s*=>\s*\{\s*\}/)
})

it('lets an admin unarchive a request and run archive now', () => {
  const actions = readFileSync('src/server-actions/requests.ts', 'utf8')
  const controls = readFileSync('src/components/admin/retention-controls.tsx', 'utf8')
  const retention = readFileSync('src/server-actions/retention.ts', 'utf8')
  const form = readFileSync('src/components/admin/retention-policy-form.tsx', 'utf8')
  assert.match(actions, /export async function unarchiveRequest/)
  assert.match(controls, /unarchiveRequest/)
  assert.match(controls, /Unarchive/)
  assert.match(retention, /export async function runArchiveNow/)
  assert.match(form, /runArchiveNow/)
  assert.match(form, /archiveClock/)
  assert.match(readFileSync('src/instrumentation.ts', 'utf8'), /startRetentionArchiveClock/)
})

it('treats archive as hide and hard-deletes only archived selections', () => {
  const form = readFileSync('src/components/admin/retention-policy-form.tsx', 'utf8')
  const list = readFileSync('src/components/admin/retention-request-list.tsx', 'utf8')
  const controls = readFileSync('src/components/admin/retention-controls.tsx', 'utf8')
  const retention = readFileSync('src/server-actions/retention.ts', 'utf8')
  assert.doesNotMatch(form, /cleanupAfterDays/)
  assert.doesNotMatch(list, /server-actions\/retention/)
  assert.doesNotMatch(controls, /server-actions\/retention/)
  assert.match(list, /\/api\/admin\/retention\/hard-delete/)
  assert.match(list, /Hard-delete selected/)
  assert.match(controls, /isArchived/)
  assert.match(retention, /export async function runArchiveNow/)
  const hardDelete = readFileSync('src/lib/retention-hard-delete.ts', 'utf8')
  assert.match(hardDelete, /isArchived: true/)
})

