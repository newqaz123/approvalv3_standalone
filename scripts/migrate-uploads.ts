import { copyFile, mkdir, readdir, stat, unlink } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { relative, resolve, sep } from 'node:path'
import { getUploadRoot } from '../src/lib/attachments/storage'

export interface MigrationOptions {
  sourceRoot: string
  destinationRoot: string
}

export interface MigrationReport {
  moved: string[]
  skipped: string[]
  conflicts: string[]
}

async function listRegularFiles(root: string, acc: string[] = []): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const full = resolve(root, entry.name)
    if (entry.isDirectory()) {
      await listRegularFiles(full, acc)
    } else if (entry.isFile()) {
      acc.push(full)
    }
  }
  return acc
}

function withinRoot(target: string, root: string): boolean {
  return target === root || target.startsWith(`${root}${sep}`)
}

/**
 * Idempotently migrate every regular file under `sourceRoot` into
 * `destinationRoot`, preserving the relative directory layout.
 *
 * - Each file is copied with exclusive creation, then its byte size is verified
 *   before the source is removed.
 * - A destination that already exists with the same byte size is reported and
 *   skipped (the source is left in place).
 * - A destination that exists with a different byte size, or a source whose
 *   relative path would resolve outside the destination root, is reported as a
 *   conflict. Conflicting sources are never deleted.
 */
export async function migrateUploads({
  sourceRoot,
  destinationRoot,
}: MigrationOptions): Promise<MigrationReport> {
  const resolvedSource = resolve(sourceRoot)
  const resolvedDestination = resolve(destinationRoot)
  const report: MigrationReport = { moved: [], skipped: [], conflicts: [] }

  let files: string[]
  try {
    files = await listRegularFiles(resolvedSource)
  } catch {
    // Missing or unreadable source root: nothing to migrate.
    return report
  }

  for (const source of files) {
    const rel = relative(resolvedSource, source)
    const destination = resolve(resolvedDestination, rel)

    if (!withinRoot(destination, resolvedDestination)) {
      report.conflicts.push(rel)
      continue
    }

    await mkdir(resolve(destination, '..'), { recursive: true })

    let sourceSize: number
    try {
      sourceSize = (await stat(source)).size
    } catch {
      // File vanished between listing and stat; nothing to migrate.
      continue
    }

    try {
      await copyFile(source, destination, fsConstants.COPYFILE_EXCL)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code
      if (code !== 'EEXIST') throw err
      const destSize = (await stat(destination)).size
      if (destSize === sourceSize) {
        report.skipped.push(rel)
      } else {
        report.conflicts.push(rel)
      }
      continue
    }

    const destSize = (await stat(destination)).size
    if (destSize !== sourceSize) {
      report.conflicts.push(rel)
      continue
    }

    await unlink(source)
    report.moved.push(rel)
  }

  return report
}

function parseArgs(argv: string[]): { source: string; destination: string } {
  const args = argv.slice(2)
  let source = 'public/uploads'
  let destination = process.env.UPLOAD_DIR || 'uploads'
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--source' && i + 1 < args.length) source = args[++i]
    else if (args[i] === '--destination' && i + 1 < args.length) destination = args[++i]
  }
  return { source, destination }
}

async function main(): Promise<void> {
  const { source, destination } = parseArgs(process.argv)
  const report = await migrateUploads({ sourceRoot: source, destinationRoot: destination })
  for (const moved of report.moved) console.log(`moved    ${moved}`)
  for (const skipped of report.skipped) console.log(`skipped  ${skipped}`)
  for (const conflict of report.conflicts) console.error(`conflict ${conflict}`)
  if (report.conflicts.length > 0) process.exitCode = 1
}

const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
}

// Re-export for callers that want the default private root alongside migration.
export { getUploadRoot }
