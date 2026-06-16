import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { createCommandPlan, runCommand } from '../../tools/lib/command.mjs'
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

test('runCommand resolves dry-run plan without spawning command', async () => {
  const result = await runCommand({
    command: 'definitely-not-a-real-command-for-dry-run',
    args: ['--flag'],
    cwd: '/project',
    dryRun: true,
  })

  assert.equal(result.code, 0)
  assert.deepEqual(result.plan, {
    command: 'definitely-not-a-real-command-for-dry-run',
    args: ['--flag'],
    cwd: '/project',
    dryRun: true,
  })
})

test('resolveManagerPaths points at expected script names', () => {
  const paths = resolveManagerPaths('/repo')

  assert.equal(paths.root, '/repo')
  assert.equal(paths.envExample, path.join('/repo', '.env.example'))
  assert.equal(paths.envProduction, path.join('/repo', '.env.production'))
  assert.equal(paths.backups, path.join('/repo', 'backups'))
  assert.equal(paths.backupsDir, path.join('/repo', 'backups'))
  assert.equal(paths.backups, paths.backupsDir)
  assert.equal(paths.scripts.backup, path.join('/repo', 'scripts', 'backup.sh'))
  assert.equal(paths.scripts.restore, path.join('/repo', 'scripts', 'restore.sh'))
  assert.equal(paths.scripts.deploy, path.join('/repo', 'scripts', 'deploy.sh'))
  assert.equal(paths.scripts.offlineDeploy, path.join('/repo', 'scripts', 'deploy-offline.sh'))
  assert.equal(paths.scripts.health, path.join('/repo', 'scripts', 'health-check.sh'))
  assert.equal(paths.scripts.rollback, path.join('/repo', 'scripts', 'rollback.sh'))
})
