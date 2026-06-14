import test from 'node:test'
import assert from 'node:assert/strict'
import { createCommandPlan } from '../../tools/lib/command.mjs'
import { resolveManagerPaths } from '../../tools/lib/project.mjs'

test('createCommandPlan returns dry-run metadata without executing', () => {
  const plan = createCommandPlan({
    command: 'bash',
    args: ['scripts/backup.sh'],
    cwd: '/project',
    dryRun: true,
  })

  assert.equal(plan.command, 'bash')
  assert.deepEqual(plan.args, ['scripts/backup.sh'])
  assert.equal(plan.cwd, '/project')
  assert.equal(plan.dryRun, true)
})

test('resolveManagerPaths points at expected script names', () => {
  const paths = resolveManagerPaths('/repo')

  assert.equal(paths.root, '/repo')
  assert.equal(paths.envExample.endsWith('.env.example'), true)
  assert.equal(paths.envProduction.endsWith('.env.production'), true)
  assert.equal(paths.scripts.backup.endsWith('scripts/backup.sh'), true)
  assert.equal(paths.scripts.restore.endsWith('scripts/restore.sh'), true)
  assert.equal(paths.scripts.deploy.endsWith('scripts/deploy.sh'), true)
  assert.equal(paths.scripts.health.endsWith('scripts/health-check.sh'), true)
})
