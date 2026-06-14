import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

test('envDoctor creates a production env file from the template when missing', async () => {
  const { envDoctor } = await import('../../tools/manage.mjs')
  const root = await mkdtemp(path.join(os.tmpdir(), 'approval-manager-'))
  const paths = {
    root,
    envExample: path.join(root, '.env.example'),
    envProduction: path.join(root, '.env.production'),
  }

  await writeFile(paths.envExample, [
    'DATABASE_URL="postgresql://postgres:changeme@db:5432/app_db?schema=public"',
    'NEXTAUTH_URL="http://localhost:3000"',
  ].join('\n'))

  await envDoctor({
    paths,
    ask: async () => {
      throw new Error('prompt should not be called when creating the file')
    },
    log: () => {},
  })

  const created = await readFile(paths.envProduction, 'utf8')
  assert.match(created, /DATABASE_URL=/)
  assert.match(created, /NEXTAUTH_URL=/)
})

test('envDoctor backs up and appends missing keys when confirmed', async () => {
  const { envDoctor } = await import('../../tools/manage.mjs')
  const root = await mkdtemp(path.join(os.tmpdir(), 'approval-manager-'))
  const paths = {
    root,
    envExample: path.join(root, '.env.example'),
    envProduction: path.join(root, '.env.production'),
  }

  await writeFile(paths.envExample, [
    'DATABASE_URL="postgresql://postgres:changeme@db:5432/app_db?schema=public"',
    'NEXTAUTH_URL="http://localhost:3000"',
    'NEXTAUTH_SECRET="secret"',
  ].join('\n'))
  await writeFile(paths.envProduction, 'DATABASE_URL="postgresql://postgres:changeme@db:5432/app_db?schema=public"\n')

  await envDoctor({
    paths,
    ask: async () => 'y',
    log: () => {},
  })

  const updated = await readFile(paths.envProduction, 'utf8')
  assert.match(updated, /NEXTAUTH_URL=/)
  assert.match(updated, /NEXTAUTH_SECRET=/)

  const files = await readdir(root)
  assert.equal(files.some((name) => name.startsWith('.env.production.backup.')), true)
})

test('envDoctor does not overwrite an existing backup path collision', async () => {
  const { envDoctor } = await import('../../tools/manage.mjs')
  const root = await mkdtemp(path.join(os.tmpdir(), 'approval-manager-'))
  const paths = {
    root,
    envExample: path.join(root, '.env.example'),
    envProduction: path.join(root, '.env.production'),
  }
  const fixedStamp = '20260614-120000.123'
  const collidingBackup = `${paths.envProduction}.backup.${fixedStamp}`
  const originalProduction = 'DATABASE_URL="postgresql://postgres:changeme@db:5432/app_db?schema=public"\n'

  await writeFile(paths.envExample, [
    'DATABASE_URL="postgresql://postgres:changeme@db:5432/app_db?schema=public"',
    'NEXTAUTH_URL="http://localhost:3000"',
  ].join('\n'))
  await writeFile(paths.envProduction, originalProduction)
  await writeFile(collidingBackup, 'existing-backup\n')

  await envDoctor({
    paths,
    ask: async () => 'y',
    log: () => {},
    timestampFn: () => fixedStamp,
  })

  const existingBackup = await readFile(collidingBackup, 'utf8')
  const nextBackup = await readFile(`${collidingBackup}.1`, 'utf8')

  assert.equal(existingBackup, 'existing-backup\n')
  assert.equal(nextBackup, originalProduction)
})

test('manage cli renders menu and exits on option 8', async () => {
  const stdout = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['tools/manage.mjs'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let output = ''

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      output += chunk
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      output += chunk
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve(output)
      } else {
        reject(new Error(`cli exited with code ${code}\n${output}`))
      }
    })

    child.stdin.end('8\n')
  })

  assert.match(stdout, /Approval App Manager/)
})
