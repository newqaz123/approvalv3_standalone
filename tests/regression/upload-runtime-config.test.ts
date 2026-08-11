import { it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const read = (path: string): string => readFileSync(path, 'utf8')

// Guards the Docker volume + operational backup contract from Task 7 of the
// private-attachment-storage plan: attachments must live in /app/uploads (the
// existing uploads_data volume, repointed), never under the public web root.

it('creates and chowns the private uploads directory in the runner image', () => {
  const dockerfile = read('Dockerfile')
  assert.match(
    dockerfile,
    /RUN mkdir -p \/app\/uploads && chown nextjs:nodejs \/app\/uploads/,
  )
})

it('mounts the existing uploads_data volume at the private path in every compose file', () => {
  const composes: Record<string, string> = {
    dev: read('docker-compose.dev.yml'),
    prod: read('docker-compose.prod.yml'),
  }
  for (const [name, compose] of Object.entries(composes)) {
    assert.match(
      compose,
      /uploads_data:\/app\/uploads/,
      `${name} compose must mount uploads_data at /app/uploads`,
    )
    assert.doesNotMatch(
      compose,
      /uploads_data:\/app\/public\/uploads/,
      `${name} compose must not mount uploads_data at the public web root`,
    )
  }
})

it('documents the private UPLOAD_DIR in the environment template', () => {
  const envExample = read('.env.example')
  assert.match(envExample, /UPLOAD_DIR="?\/app\/uploads"?/)
})

it('archives and restores the private uploads path', () => {
  const backup = read('scripts/backup.sh')
  const restore = read('scripts/restore.sh')
  assert.match(backup, /\/app\/uploads/)
  assert.match(restore, /\/app\/uploads/)
})

// Guards the Server Action transport limit (Task 8): the 15 MB proxy limit
// stays above the 10 MB application policy (Task 1) so legitimate uploads are
// never clipped by the transport before the app's own validation runs.

it('pins next to an exact 15.5.23 in package.json', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.equal(
    pkg.dependencies.next,
    '15.5.23',
    'package.json must pin next to exactly 15.5.23 (no caret) so @next/swc matches',
  )
})

it('uses the MJS runtime config with the 15mb Server Action body limit', () => {
  assert.ok(!existsSync('next.config.ts'), 'next.config.ts must be absent')
  assert.ok(existsSync('next.config.mjs'), 'next.config.mjs must exist')
  const config = read('next.config.mjs')
  assert.match(
    config,
    /serverActions:\s*\{\s*bodySizeLimit:\s*['"]15mb['"]\s*\}/,
    'next.config.mjs must set experimental.serverActions.bodySizeLimit to 15mb',
  )
  assert.match(
    config,
    /optimizePackageImports:\s*\[['"]lucide-react['"]\]/,
  )
})

it('copies next.config.mjs into the runner image', () => {
  const dockerfile = read('Dockerfile')
  assert.match(
    dockerfile,
    /COPY --from=builder \/app\/next\.config\.mjs \.\//,
    'runner stage must copy next.config.mjs so next start reads the 15mb limit',
  )
})

it('documents the 15m reverse-proxy body limit and the 10/15 MB split', () => {
  for (const doc of ['DEPLOY.md', 'docs/DEPLOY.md']) {
    const text = read(doc)
    assert.match(
      text,
      /client_max_body_size\s+15m;/,
      `${doc} must include the Nginx client_max_body_size 15m; directive`,
    )
    assert.match(
      text,
      /10\s*MB/i,
      `${doc} must explain the 10 MB application attachment limit`,
    )
    assert.match(
      text,
      /15\s*MB/i,
      `${doc} must explain the 15 MB Server Action transport limit`,
    )
  }
})
