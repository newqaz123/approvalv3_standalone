#!/usr/bin/env node
import { access, copyFile, open, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output, argv } from 'node:process'
import { pathToFileURL } from 'node:url'
import { parseEnvText, createEnvReport, mergeMissingEnvKeys } from './lib/env.mjs'
import { runCommand } from './lib/command.mjs'
import { isWindows, resolveManagerPaths } from './lib/project.mjs'

export const defaultPaths = resolveManagerPaths()

export async function fileExists(filePath) {
  try {
    await access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

export function timestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace('T', '-').replace('Z', '')
}

export function buildEnvBackupPath(envProductionPath, stamp, suffix = 0) {
  return suffix === 0
    ? `${envProductionPath}.backup.${stamp}`
    : `${envProductionPath}.backup.${stamp}.${suffix}`
}

export async function writeEnvBackupAtomically({
  sourcePath,
  envProductionPath,
  stamp = timestamp(),
} = {}) {
  const sourceBytes = await readFile(sourcePath)
  let suffix = 0

  while (true) {
    const backupPath = buildEnvBackupPath(envProductionPath, stamp, suffix)

    try {
      const handle = await open(backupPath, 'wx')
      try {
        await handle.writeFile(sourceBytes)
      } finally {
        await handle.close()
      }
      return backupPath
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error
      }
      suffix += 1
    }
  }
}

export function createPrompt() {
  const rl = createInterface({ input, output })
  const lines = rl[Symbol.asyncIterator]()
  let closed = false

  return {
    async ask(question) {
      if (closed) {
        throw new Error('Input stream closed before a response was provided')
      }

      output.write(question)
      const nextLine = await lines.next()
      if (nextLine.done) {
        closed = true
        throw new Error('Input stream closed before a response was provided')
      }

      return String(nextLine.value).trim()
    },
    close() {
      closed = true
      rl.close()
    },
  }
}

export function logEnvironmentReport(report, log = console.log) {
  log('\nEnvironment report')
  log(`Required present: ${report.presentRequired.length}`)
  log(`Required missing: ${report.missingRequired.length}`)

  if (report.missingRequired.length > 0) {
    for (const key of report.missingRequired) {
      log(`  - ${key}`)
    }
  }

  if (report.missingOptional.length > 0) {
    log(`Optional missing: ${report.missingOptional.join(', ')}`)
  }

  if (report.unknownKeys.length > 0) {
    log(`Unknown keys: ${report.unknownKeys.join(', ')}`)
  }
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return 'unknown size'
  }

  if (bytes < 1024) {
    return `${bytes} B`
  }

  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = units[0]

  for (let index = 1; value >= 1024 && index < units.length; index += 1) {
    value /= 1024
    unit = units[index]
  }

  return `${Math.round(value)} ${unit}`
}

export function formatBackupChoice({ path, sizeBytes, userRows }) {
  const users = Number.isFinite(userRows) ? userRows : 'unknown'
  return `${path} (${formatBytes(sizeBytes)}, users: ${users})`
}

export async function envDoctor({
  paths = defaultPaths,
  ask = async () => '',
  log = console.log,
  timestampFn = timestamp,
} = {}) {
  if (!(await fileExists(paths.envExample))) {
    throw new Error('.env.example not found')
  }

  if (!(await fileExists(paths.envProduction))) {
    log('.env.production not found. Creating it from .env.example.')
    await copyFile(paths.envExample, paths.envProduction)
    log('Created .env.production. Edit it with production values before deploying.')
    return
  }

  const [templateText, currentText] = await Promise.all([
    readFile(paths.envExample, 'utf8'),
    readFile(paths.envProduction, 'utf8'),
  ])
  const report = createEnvReport({
    current: parseEnvText(currentText),
    template: parseEnvText(templateText),
  })

  logEnvironmentReport(report, log)

  if (report.missingRequired.length === 0 && report.missingOptional.length === 0) {
    log('Environment file has all template keys.')
    return
  }

  const answer = await ask('Append missing keys from .env.example after creating a backup? (y/N) ')
  if (!/^y$/i.test(answer)) {
    log('No changes made to .env.production.')
    return
  }

  const backupPath = await writeEnvBackupAtomically({
    sourcePath: paths.envProduction,
    envProductionPath: paths.envProduction,
    stamp: timestampFn(),
  })
  await writeFile(paths.envProduction, mergeMissingEnvKeys({ currentText, templateText }))
  log(`Backup written: ${backupPath}`)
  log('Missing keys appended to .env.production.')
}

export async function runScript(scriptPath, args = [], { paths = defaultPaths, log = console.log } = {}) {
  if (isWindows()) {
    log('Windows detected. Use Docker Desktop and run Bash scripts through Git Bash, WSL, or an equivalent shell.')
  }

  await runCommand({ command: 'bash', args: [scriptPath, ...args], cwd: paths.root })
}

export async function backupData(options = {}) {
  const paths = options.paths ?? defaultPaths
  await runScript(paths.scripts.backup, [], { paths, log: options.log })
}

export async function healthCheck(options = {}) {
  const paths = options.paths ?? defaultPaths
  await runScript(paths.scripts.health, [], { paths, log: options.log })
}

export async function rollback(options = {}) {
  const paths = options.paths ?? defaultPaths
  await runScript(paths.scripts.rollback, [], { paths, log: options.log })
}

export async function updateExistingInstall({
  paths = defaultPaths,
  ask = async () => '',
  log = console.log,
} = {}) {
  log('\nUpdate source')
  log('1. Git update from current branch')
  log('2. Offline package / flash drive folder')
  const choice = await ask('Choose update source: ')

  if (choice !== '1' && choice !== '2') {
    log('Update cancelled.')
    return
  }

  log('\nCreating backup before update.')
  await backupData({ paths, log })

  if (choice === '1') {
    await runScript(paths.scripts.deploy, [], { paths, log })
  } else {
    const packageDir = await ask('Path to extracted package folder: ')
    if (!packageDir) {
      log('Update cancelled.')
      return
    }
    await runScript(paths.scripts.offlineDeploy, [packageDir], { paths, log })
  }

  log('\nRunning health check after update.')
  await healthCheck({ paths, log })
}

export async function restoreBackup({
  paths = defaultPaths,
  ask = async () => '',
  log = console.log,
  run = runScript,
} = {}) {
  const dbBackup = await ask('Database backup path: ')
  if (!dbBackup) {
    log('Restore cancelled.')
    return
  }

  const uploadsBackup = await ask('Uploads backup path, or press Enter to skip: ')
  const confirm = await ask('Type RESTORE to replace current data: ')

  if (confirm !== 'RESTORE') {
    log('Restore cancelled.')
    return
  }

  const args = uploadsBackup ? [dbBackup, uploadsBackup] : [dbBackup]
  await run(paths.scripts.restore, args, { paths, log })
}

export async function showMenu(log = console.log, ask = async () => '') {
  log('\nApproval App Manager')
  log('1. First-time install')
  log('2. Update existing installation')
  log('3. Backup data')
  log('4. Restore from backup')
  log('5. Check system health')
  log('6. Edit/view environment config')
  log('7. Roll back last update')
  log('8. Exit')
  return ask('Choose an option: ')
}

export async function main({
  paths = defaultPaths,
  ask,
  log = console.log,
} = {}) {
  const prompt = ask ?? createPrompt()
  const askQuestion = typeof prompt === 'function' ? prompt : prompt.ask.bind(prompt)

  try {
    while (true) {
      const choice = await showMenu(log, askQuestion)

      if (choice === '1') {
        await envDoctor({ paths, ask: askQuestion, log })
      } else if (choice === '2') {
        await updateExistingInstall({ paths, ask: askQuestion, log })
      } else if (choice === '3') {
        await backupData({ paths, log })
      } else if (choice === '4') {
        await restoreBackup({ paths, ask: askQuestion, log })
      } else if (choice === '5') {
        await healthCheck({ paths, log })
      } else if (choice === '6') {
        await envDoctor({ paths, ask: askQuestion, log })
      } else if (choice === '7') {
        await rollback({ paths, log })
      } else if (choice === '8') {
        break
      } else {
        log('Choose a number from 1 to 8.')
      }
    }
  } finally {
    if (!ask && prompt.close) {
      prompt.close()
    }
  }
}

const isEntryPoint = (() => {
  if (!argv[1]) return false
  return import.meta.url === pathToFileURL(argv[1]).href
})()

if (isEntryPoint) {
  main().catch((error) => {
    console.error(`Manager failed: ${error?.message ?? String(error)}`)
    process.exitCode = 1
  })
}
