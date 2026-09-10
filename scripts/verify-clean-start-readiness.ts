// Clean-start readiness CLI (Plan A Task 7) — read-only verification entry
// point replacing the legacy rollout/mapping verification machinery. Prints
// a JSON ReadinessReport and exits 1 when blocked, 0 when ready. It never
// writes files, never connects a database, and has no rollout env modes or
// mapping digests.
//
// Parent A7 ruling R-A7-1 (recorded in the SDD ledger before this code):
// no clean-start readiness adapter exists in Plan A — the current schema has
// no clean-start models and inventing a real storage adapter now would mean
// mapping the legacy schema, which is forbidden. So the DEFAULT wiring is
// deliberately fail-closed: without an injected `createDb` this CLI prints a
// READINESS_ADAPTER_UNAVAILABLE report and exits 1 rather than fabricating
// database state. R-A7-2: Plan B Task 6 MUST wire the actual ROOT-scope
// adapter AND this normal entrypoint — injecting only in tests does not
// finish the production CLI.
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { verifyCleanStartReadiness } from '../src/lib/clean-start-readiness'
import type { CleanStartReadinessDb, ReadinessReport } from '../src/lib/clean-start-readiness'

export interface VerifyCleanStartReadinessOptions {
  argv: readonly string[]
  /** Injectable read-only db seam (tests today; the real adapter lands in Plan B Task 6). */
  createDb?: () => CleanStartReadinessDb | Promise<CleanStartReadinessDb>
  print?: (line: string) => void
}

const USAGE = 'Usage: verify-clean-start-readiness [--help]'

function parseArguments(argv: readonly string[]): { help: boolean } {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true }
  for (const flag of argv) {
    throw new Error(`Unknown argument: ${flag}`)
  }
  return { help: false }
}

/**
 * Fail-closed default report while no adapter is wired (R-A7-1): honest
 * unavailability, never fabricated readiness or fabricated blockers derived
 * from data that was never read.
 */
function adapterUnavailableReport(): ReadinessReport {
  return {
    ready: false,
    blockers: [{
      code: 'READINESS_ADAPTER_UNAVAILABLE',
      detail: 'no clean-start readiness adapter exists until Plan B Task 6 wires the production ROOT-scope adapter and this normal CLI entrypoint; refusing to fabricate database state',
    }],
  }
}

export async function runVerifyCleanStartReadiness(options: VerifyCleanStartReadinessOptions): Promise<number> {
  const print = options.print ?? ((line: string) => console.log(line))
  let parsed: { help: boolean }
  try {
    parsed = parseArguments(options.argv)
  } catch (error) {
    // Unknown arguments fail closed: usage is shown and the exit code is
    // nonzero — an unrecognized flag is never silently ignored.
    print(error instanceof Error ? error.message : String(error))
    print(USAGE)
    return 1
  }
  if (parsed.help) {
    print(USAGE)
    print('Read-only: prints a JSON readiness report; never writes, never connects a database.')
    print('Exits 0 when ready, 1 when blocked (including while no adapter is wired, provider failures, or readiness blockers).')
    return 0
  }
  if (options.createDb === undefined) {
    print(`${JSON.stringify(adapterUnavailableReport(), null, 2)}`)
    return 1
  }
  const db = await options.createDb()
  const report = await verifyCleanStartReadiness(db)
  print(`${JSON.stringify(report, null, 2)}`)
  return report.ready ? 0 : 1
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  return runVerifyCleanStartReadiness({ argv })
}

const invokedAsScript = typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invokedAsScript) {
  void main().then((code) => { process.exitCode = code }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
