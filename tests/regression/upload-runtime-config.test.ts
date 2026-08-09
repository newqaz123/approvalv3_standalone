import { it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

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
    base: read('docker-compose.yml'),
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
