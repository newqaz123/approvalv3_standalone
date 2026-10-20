import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'

/**
 * Passive health record for the app's process group. `next dev` can restart
 * (heap threshold) or stop without a trace in its own log, and the browser only
 * sees "connection refused". Sampling the process table every few seconds shows
 * whether the server child was replaced, vanished, or the whole group went.
 * Nothing here may throw or change the run.
 */

export interface AppProcessRow {
  pid: number
  ppid: number
  rssKb: number
  etime: string
  command: string
}

export interface AppHealthSample {
  at: string
  rows: AppProcessRow[]
}

export interface AppHealthSummary {
  samples: number
  serverPids: number[]
  restarts: Array<{ from: number; to: number; at: string }>
  peakServerRssMb: number
  peakAt: string | null
  /** The server child vanished while the `next dev` parent stayed alive. */
  serverGoneAt: string | null
  /** Every process of the group vanished. */
  groupGoneAt: string | null
}

const MAX_SAMPLES = 2000
const PS_ROW = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*\S)\s*$/

/** Parses `ps -axo pid=,ppid=,pgid=,rss=,etime=,command=` and keeps one process group. */
export function parseProcessGroupRows(psOutput: string, pgid: number): AppProcessRow[] {
  const rows: AppProcessRow[] = []
  for (const line of psOutput.split('\n')) {
    const match = PS_ROW.exec(line)
    if (!match || Number(match[3]) !== pgid) continue
    rows.push({ pid: Number(match[1]), ppid: Number(match[2]), rssKb: Number(match[4]), etime: match[5], command: match[6] })
  }
  return rows
}

/** The forked server: a non-leader member of the group, preferring next-server, else the largest. */
function pickServer(rows: AppProcessRow[], pgid: number): AppProcessRow | undefined {
  const others = rows.filter((r) => r.pid !== pgid).sort((a, b) => b.rssKb - a.rssKb)
  return others.find((r) => /next-server|start-server/.test(r.command)) ?? others[0]
}

const toMb = (kb: number): number => Math.round(kb / 1024)

export function summarizeAppHealth(pgid: number, samples: AppHealthSample[]): AppHealthSummary {
  const summary: AppHealthSummary = {
    samples: samples.length,
    serverPids: [],
    restarts: [],
    peakServerRssMb: 0,
    peakAt: null,
    serverGoneAt: null,
    groupGoneAt: null,
  }
  let lastServerPid: number | null = null
  let serverAbsentSince: string | null = null
  let groupAbsentSince: string | null = null
  let groupSeen = false
  for (const { at, rows } of samples) {
    if (rows.length === 0) {
      if (groupSeen && groupAbsentSince === null) groupAbsentSince = at
      continue
    }
    groupSeen = true
    groupAbsentSince = null
    const server = pickServer(rows, pgid)
    if (!server) {
      if (lastServerPid !== null && serverAbsentSince === null) serverAbsentSince = at
      continue
    }
    serverAbsentSince = null
    if (!summary.serverPids.includes(server.pid)) summary.serverPids.push(server.pid)
    if (lastServerPid !== null && lastServerPid !== server.pid) {
      summary.restarts.push({ from: lastServerPid, to: server.pid, at })
    }
    lastServerPid = server.pid
    const mb = toMb(server.rssKb)
    if (mb > summary.peakServerRssMb) {
      summary.peakServerRssMb = mb
      summary.peakAt = at
    }
  }
  summary.serverGoneAt = serverAbsentSince
  summary.groupGoneAt = groupAbsentSince
  return summary
}

export function formatAppHealthSummary(summary: AppHealthSummary): string {
  if (summary.samples === 0) return 'app health: no samples taken'
  const parts = [`app health: ${summary.samples} samples`]
  parts.push(`server pids ${summary.serverPids.length > 0 ? summary.serverPids.join(', ') : 'none seen'}`)
  if (summary.restarts.length > 0) {
    const times = summary.restarts.length === 1 ? 'time' : 'times'
    const detail = summary.restarts.map((r) => `${r.from}->${r.to} at ${r.at}`).join('; ')
    parts.push(`server restarted ${summary.restarts.length} ${times} (${detail})`)
  } else {
    parts.push('no server restart seen')
  }
  if (summary.peakAt) parts.push(`peak server RSS ${summary.peakServerRssMb} MB at ${summary.peakAt}`)
  if (summary.serverGoneAt) parts.push(`server process gone at ${summary.serverGoneAt} while the next dev parent stayed up`)
  if (summary.groupGoneAt) parts.push(`process group gone at ${summary.groupGoneAt}`)
  return parts.join('; ')
}

export interface AppHealthSampler {
  /** Takes one sample now; resolves when it has been recorded. Never rejects. */
  sampleOnce(): Promise<void>
  samples(): AppHealthSample[]
  stop(): Promise<void>
}

function defaultReadProcessTable(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      '/bin/ps',
      ['-axo', 'pid=,ppid=,pgid=,rss=,etime=,command='],
      { timeout: 10_000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    )
  })
}

function formatSampleLine(pgid: number, sample: AppHealthSample): string {
  const server = pickServer(sample.rows, pgid)
  const leader = sample.rows.find((r) => r.pid === pgid)
  return [
    sample.at,
    `pgid=${pgid}`,
    `procs=${sample.rows.length}`,
    `serverPid=${server?.pid ?? '-'}`,
    `serverRssMb=${server ? toMb(server.rssKb) : '-'}`,
    `leaderRssMb=${leader ? toMb(leader.rssKb) : '-'}`,
  ].join(' ')
}

export function startAppHealthSampler(options: {
  pgid: number
  logFile: string
  /** Sampling period; 0 disables the timer so callers can sample explicitly. */
  intervalMs?: number
  readProcessTable?: () => Promise<string>
  now?: () => Date
}): AppHealthSampler {
  const { pgid, logFile } = options
  const read = options.readProcessTable ?? defaultReadProcessTable
  const now = options.now ?? (() => new Date())
  const intervalMs = options.intervalMs ?? 10_000
  const all: AppHealthSample[] = []
  let chain: Promise<void> = Promise.resolve()
  let stopped = false

  const sampleOnce = (): Promise<void> => {
    chain = chain.then(async () => {
      try {
        const at = now().toISOString()
        const sample: AppHealthSample = { at, rows: parseProcessGroupRows(await read(), pgid) }
        if (all.length >= MAX_SAMPLES) all.shift()
        all.push(sample)
        await fs.appendFile(logFile, `${formatSampleLine(pgid, sample)}\n`)
      } catch {
        // Diagnostics must never affect the run.
      }
    })
    return chain
  }

  let timer: NodeJS.Timeout | undefined
  if (intervalMs > 0) {
    void sampleOnce()
    timer = setInterval(() => { if (!stopped) void sampleOnce() }, intervalMs)
    timer.unref()
  }

  return {
    sampleOnce,
    samples: () => [...all],
    stop: async () => {
      stopped = true
      if (timer) clearInterval(timer)
      await chain
    },
  }
}
