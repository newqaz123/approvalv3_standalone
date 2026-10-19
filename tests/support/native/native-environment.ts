import { randomBytes, randomUUID } from 'node:crypto'

/**
 * Pure primitives for the test-only native business runtime (no I/O here).
 *
 * Everything a native runner needs to decide BEFORE touching the machine:
 * run identity, owned ports, run-generated credentials, the outbound
 * connection allowlist, the spawn environment sanitizer, and the evidence
 * index builder. Keeping this module free of I/O makes the safety rules
 * unit-testable without starting any process or socket.
 */

export const PG_BIN = '/opt/homebrew/opt/postgresql@16/bin'
export const REQUIRED_DATABASE_NAME = 'app_cleanstart_dev'
export const FORBIDDEN_SHARED_PORTS = new Set([3100, 5432])

/** Postfix-style run id: owned resources are always named after it. */
export function createRunId(now = new Date()): string {
  // Lowercase ISO-like stamp: the shared business-workflow-safety charset
  // ([a-z0-9-], business-workflow-safety.ts assertOwnedDisposableResource)
  // must accept EVERY id this runner mints — an uppercase `T` in the stamp
  // made every full-mode run fail that guard. Keep it lowercase-only.
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').toLowerCase()
  return `business-test-${stamp}-${randomBytes(4).toString('hex')}`
}

export function isOwnedRunId(runId: string): boolean {
  return /^business-test-[0-9]{8}t[0-9]{6}-[a-z0-9-]+$/.test(runId)
}

/** Run-generated SCRAM password: 192 bits of entropy, URL-safe, no shell metacharacters. */
export function generateDatabasePassword(): string {
  const password = randomBytes(24).toString('base64url')
  if (password.length < 24) throw new Error('SAFETY: generated password too short')
  return password
}

/** Fixture-only password for browser logins (never a real credential). */
export function generateE2ePassword(): string {
  return `business-e2e-${randomBytes(12).toString('base64url')}`
}

export interface OwnedPorts {
  databasePort: number
  serverPort: number
  mailPort: number
}

export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1024 && port <= 65535
}

/**
 * Probe must return true when the port is already listening.
 * Bounded: after MAX_PORT_ALLOCATION_ATTEMPTS candidates the allocation fails
 * closed instead of retrying forever (an exhausted host must surface as an
 * error, never as a hung runner).
 */
export const MAX_PORT_ALLOCATION_ATTEMPTS = 200

export async function allocateDistinctLoopbackPorts(
  probe: (port: number) => Promise<boolean>,
): Promise<OwnedPorts> {
  const ports: number[] = []
  for (let attempt = 0; attempt < MAX_PORT_ALLOCATION_ATTEMPTS; attempt++) {
    if (ports.length === 3) break
    const candidate = 20000 + (randomBytes(2).readUInt16BE(0) % 40000)
    if (!isValidPort(candidate)) continue
    if (FORBIDDEN_SHARED_PORTS.has(candidate)) continue
    if (ports.includes(candidate)) continue
    if (await probe(candidate)) continue
    ports.push(candidate)
  }
  if (ports.length < 3) {
    throw new Error(
      `SAFETY: could not allocate 3 distinct free loopback ports within ${MAX_PORT_ALLOCATION_ATTEMPTS} attempts (got ${ports.length})`,
    )
  }
  return {
    databasePort: ports[0],
    serverPort: ports[1],
    mailPort: ports[2],
  }
}

export interface OutboundAllowlistSpec {
  mode: 'ENFORCE'
  tcp: Readonly<Record<string, readonly number[]>>
  /** Owned unix socket directories allowed for local IPC. */
  unixSocketPrefixes: readonly string[]
  /** Only literal loopback IPs and this one resolvable name are allowed. */
  resolvableHostnames: readonly ['localhost', ...string[]]
}

export function buildOutboundAllowlistSpec(input: {
  ports: OwnedPorts
  unixSocketPrefixes: readonly string[]
}): OutboundAllowlistSpec {
  return {
    mode: 'ENFORCE',
    tcp: {
      '127.0.0.1': [
        input.ports.databasePort,
        input.ports.serverPort,
        input.ports.mailPort,
      ],
    },
    unixSocketPrefixes: input.unixSocketPrefixes,
    resolvableHostnames: ['localhost'],
  }
}

export function formatAllowlistEnv(spec: OutboundAllowlistSpec): string {
  return JSON.stringify(spec)
}

export function parseAllowlistEnv(value: string | undefined): OutboundAllowlistSpec | null {
  if (!value) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as { mode?: unknown }).mode !== 'ENFORCE' ||
    typeof (parsed as { tcp?: unknown }).tcp !== 'object' ||
    (parsed as { tcp?: unknown }).tcp === null
  ) {
    return null
  }
  return parsed as OutboundAllowlistSpec
}

export type ConnectionDecision =
  | { allowed: true }
  | { allowed: false; reason: string }

/**
 * Pure decision used by the preload. Only owned numeric loopback ports, the
 * name `localhost` (for resolution), and unix sockets under owned dirs pass.
 */
export function decideOutboundConnection(
  spec: OutboundAllowlistSpec,
  target: { host?: string | null; port?: number | null; path?: string | null },
): ConnectionDecision {
  const socketPath = target.path ?? null
  if (socketPath) {
    const owned = spec.unixSocketPrefixes.some((prefix) => socketPath === prefix || socketPath.startsWith(`${prefix}/`))
    return owned
      ? { allowed: true }
      : { allowed: false, reason: `unix socket outside owned runtime dirs: ${socketPath}` }
  }
  const host = (target.host ?? '').toLowerCase()
  if (!host) {
    return { allowed: false, reason: 'connection target has no host' }
  }
  const isLiteralLoopbackIp = host === '127.0.0.1' || host === '::1' || host === '::ffff:127.0.0.1'
  if (!isLiteralLoopbackIp && !spec.resolvableHostnames.includes(host)) {
    return { allowed: false, reason: `non-loopback or unresolved host not allowed: ${host}` }
  }
  if (isLiteralLoopbackIp && host !== '127.0.0.1' && host !== '::1') {
    return { allowed: false, reason: `non-canonical loopback form not allowed: ${host}` }
  }
  const allowedHost = host === '127.0.0.1' ? '127.0.0.1' : host === '::1' ? '::1' : '127.0.0.1'
  const allowedPorts = spec.tcp[allowedHost] ?? []
  const port = target.port
  if (typeof port !== 'number' || !Number.isInteger(port)) {
    return { allowed: false, reason: `connection to ${allowedHost} without a numeric port` }
  }
  if (!allowedPorts.includes(port)) {
    return {
      allowed: false,
      reason: `port ${port} on ${allowedHost} is not an owned runtime port (allowed: ${allowedPorts.join(', ')})`,
    }
  }
  return { allowed: true }
}

/**
 * DNS guard: only owned hostname names may resolve, and they must resolve to
 * loopback. This is what makes `smtp.example.com` fail before a packet is
 * ever sent.
 */
export function decideDnsLookup(
  spec: OutboundAllowlistSpec,
  hostname: string,
  resolvedAddresses: readonly string[],
): ConnectionDecision {
  const name = hostname.toLowerCase()
  // Literal loopback IPs mirror the TCP guard's carve-out above: Node calls
  // dns.lookup() for NUMERIC hostnames too (answered directly, without ever
  // touching a resolver). next dev resolves its literal loopback bind/connect
  // addresses at startup, and blocking that aborted app boot (full-run
  // evidence). No egress surface is added: actual connections stay guarded by
  // the net/tls hooks with owned-port checks, and the resolved-address rule
  // below still applies.
  const isLiteralLoopbackIp = name === '127.0.0.1' || name === '::1'
  if (!isLiteralLoopbackIp && !spec.resolvableHostnames.includes(name)) {
    return { allowed: false, reason: `DNS resolution is not allowed for ${hostname} in the test runtime` }
  }
  if (!resolvedAddresses.every((address) => address === '127.0.0.1' || address === '::1')) {
    return { allowed: false, reason: `${hostname} resolved to a non-loopback address` }
  }
  return { allowed: true }
}

const SPAWN_ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'TERM',
  'SHELL',
  'USER',
  'LOGNAME',
  'PWD',
  'SHLVL',
  '_',
] as const

/**
 * Build a minimal explicit environment for spawned processes. Ambient
 * DATABASE_URL / SMTP_* / protected credentials are never inherited: the
 * runner supplies its own values and the sanitizer drops everything else.
 */
export function buildSpawnEnvironment(
  ambient: Record<string, string | undefined>,
  explicit: Record<string, string>,
): Record<string, string> {
  const inherited: Record<string, string> = {}
  for (const key of SPAWN_ENV_ALLOWLIST) {
    const value = ambient[key]
    if (typeof value === 'string') inherited[key] = value
  }
  return { ...inherited, ...explicit }
}

export function assertNoProtectedEnvironmentKeys(env: Record<string, string>): void {
  const forbidden = Object.keys(env).filter(
    (key) =>
      key.startsWith('SMTP_') ||
      key === 'DATABASE_URL' ||
      key === 'CLEAN_START_CI_DATABASE_URL',
  )
  if (forbidden.length > 0) {
    throw new Error(`SAFETY: spawn env carries protected ambient keys: ${forbidden.sort().join(', ')}`)
  }
}

export type ScenarioStatus = 'Pass' | 'Fail' | 'Blocked'

export interface EvidenceEntry {
  scenario: string
  title: string
  actor: string
  status: ScenarioStatus
  video?: string
  trace?: string
  screenshots: string[]
  notes?: string
}

export interface EvidenceHeader {
  runId: string
  generatedAt: string
  databasePort: number
  serverPort: number
  mailPort: number
  routesConfiguration: string
  mode: string
}

export function buildEvidenceIndex(
  header: EvidenceHeader,
  entries: readonly EvidenceEntry[],
): string {
  const lines: string[] = [
    '# Business workflow native test run — evidence index',
    '',
    `- Run id: \`${header.runId}\``,
    `- Generated: ${header.generatedAt}`,
    `- Owned ports: database=${header.databasePort} app=${header.serverPort} mail=${header.mailPort}`,
    `- Route configuration: ${header.routesConfiguration}`,
    `- Runner mode: ${header.mode}`,
    '',
    '| Scenario | Actor | Result | Video | Trace | Screenshots | Notes |',
    '|---|---|---|---|---|---|---|',
  ]
  for (const entry of entries) {
    lines.push(
      `| ${entry.scenario} — ${entry.title} | ${entry.actor} | ${entry.status} | ${entry.video ?? '—'} | ${entry.trace ?? '—'} | ${entry.screenshots.join('<br>') || '—'} | ${entry.notes ?? ''} |`,
    )
  }
  if (entries.length === 0) {
    lines.push('| (no browser scenarios executed in this mode) | — | — | — | — | — | — |')
  }
  lines.push('')
  return lines.join('\n')
}

export function newAttemptToken(): string {
  return randomUUID()
}
