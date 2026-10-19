import { URL } from 'node:url'

const REQUIRED_DATABASE_NAME = 'app_cleanstart_dev'
const PROTECTED_DATABASE_NAMES = new Set(['app_db', 'app_org_manual_7abcdf3', 'app_cleanstart_ci'])
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost'])

export interface OwnedDisposableResource {
  runId: string
  containerName: string
  databaseName: typeof REQUIRED_DATABASE_NAME
  databasePort: number
  serverPort: number
}

export interface SafeRunInput {
  databaseUrl: string
  resource: OwnedDisposableResource
  ambientDatabaseUrl?: string
  mail: FailClosedMailCapturePlan
}

export interface SafeRunPlan {
  databaseUrl: string
  testBaseUrl: string
  resource: OwnedDisposableResource
  mail: FailClosedMailCapturePlan
}

export interface FailClosedMailCapturePlan {
  mode: 'LOOPBACK_CAPTURE'
  host: string
  port: number
  fallbackTransport: 'DISABLED'
}

export interface OwnedCleanupOperations {
  inspectServerPid(): Promise<number | null>
  stopServer(pid: number): Promise<void>
  inspectContainerName(): Promise<string | null>
  removeContainer(name: string): Promise<void>
}

function assertPort(port: number, label: string): void {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`SAFETY: ${label} must be an explicit TCP port`)
  }
}

export function assertOwnedDisposableResource(resource: OwnedDisposableResource): void {
  if (!/^business-test-[a-z0-9-]+$/.test(resource.runId)) {
    throw new Error('SAFETY: runId must identify a business-test owned resource')
  }
  if (resource.containerName !== `${resource.runId}-postgres`) {
    throw new Error('SAFETY: database container identity does not match runId')
  }
  if (resource.databaseName !== REQUIRED_DATABASE_NAME) {
    throw new Error('SAFETY: database name must satisfy the clean-start guard')
  }
  assertPort(resource.databasePort, 'databasePort')
  assertPort(resource.serverPort, 'serverPort')
  if (resource.databasePort === resource.serverPort) {
    throw new Error('SAFETY: database and server ports must be distinct')
  }
}

export function assertOwnedLoopbackDatabaseTarget(
  databaseUrl: string,
  resource: OwnedDisposableResource,
): void {
  assertOwnedDisposableResource(resource)
  if (!databaseUrl || databaseUrl.includes('\n') || databaseUrl.includes('\r')) {
    throw new Error('SAFETY: DATABASE_URL must be supplied explicitly as one value')
  }
  let parsed: URL
  try {
    parsed = new URL(databaseUrl)
  } catch {
    throw new Error('SAFETY: DATABASE_URL is not a valid PostgreSQL URL')
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error('SAFETY: DATABASE_URL must use PostgreSQL')
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error('SAFETY: database host must be loopback')
  }
  if (Number(parsed.port || '5432') !== resource.databasePort) {
    throw new Error('SAFETY: database URL port is not the owned database port')
  }
  if (decodeURIComponent(parsed.pathname.slice(1)) !== resource.databaseName) {
    throw new Error('SAFETY: database URL must target the owned disposable database')
  }
  if (PROTECTED_DATABASE_NAMES.has(decodeURIComponent(parsed.pathname.slice(1)))) {
    throw new Error('SAFETY: protected/shared database is never an allowed target')
  }
  if (parsed.username.length === 0 || parsed.password.length === 0) {
    throw new Error('SAFETY: disposable database credentials must be explicit')
  }
}

export function createFailClosedMailCapturePlan(input: {
  host: string
  port: number
  fallbackTransport?: 'DISABLED'
}): FailClosedMailCapturePlan {
  if (!LOOPBACK_HOSTS.has(input.host)) {
    throw new Error('SAFETY: mail capture must bind to loopback')
  }
  assertPort(input.port, 'mail capture port')
  if (input.fallbackTransport !== 'DISABLED') {
    throw new Error('SAFETY: mail fallback transport must be explicitly disabled')
  }
  return {
    mode: 'LOOPBACK_CAPTURE',
    host: input.host,
    port: input.port,
    fallbackTransport: 'DISABLED',
  }
}

export function createSafeRunPlan(input: SafeRunInput): SafeRunPlan {
  if (!input.databaseUrl) throw new Error('SAFETY: ambient DATABASE_URL is not accepted')
  if (input.ambientDatabaseUrl !== undefined) {
    throw new Error('SAFETY: runner must not accept ambient DATABASE_URL')
  }
  assertOwnedLoopbackDatabaseTarget(input.databaseUrl, input.resource)
  if (input.mail.fallbackTransport !== 'DISABLED' || input.mail.mode !== 'LOOPBACK_CAPTURE') {
    throw new Error('SAFETY: mail capture is not fail-closed')
  }
  if (!LOOPBACK_HOSTS.has(input.mail.host)) {
    throw new Error('SAFETY: mail capture host must be loopback')
  }
  return {
    databaseUrl: input.databaseUrl,
    testBaseUrl: `http://127.0.0.1:${input.resource.serverPort}`,
    resource: input.resource,
    mail: input.mail,
  }
}

export async function assertPortIsFree(
  port: number,
  probe: (port: number) => Promise<boolean>,
): Promise<void> {
  assertPort(port, 'serverPort')
  if (await probe(port)) throw new Error('SAFETY: refusing an already-listening/shared server port')
}

export async function cleanupOwnedRuntime(
  resource: OwnedDisposableResource & { serverPid: number },
  operations: OwnedCleanupOperations,
): Promise<void> {
  assertOwnedDisposableResource(resource)
  if (!Number.isInteger(resource.serverPid) || resource.serverPid <= 0) {
    throw new Error('SAFETY: cleanup requires the recorded server PID')
  }
  const serverPid = await operations.inspectServerPid()
  if (serverPid !== resource.serverPid) {
    throw new Error('SAFETY: refusing to stop an unowned or changed server process')
  }
  await operations.stopServer(resource.serverPid)
  const containerName = await operations.inspectContainerName()
  if (containerName !== resource.containerName) {
    throw new Error('SAFETY: refusing to remove an unowned or changed database container')
  }
  await operations.removeContainer(resource.containerName)
}

export async function runWithOwnedCleanup<T>(
  resource: OwnedDisposableResource & { serverPid: number },
  operations: OwnedCleanupOperations,
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action()
  } finally {
    await cleanupOwnedRuntime(resource, operations)
  }
}

export interface FailClosedMailTransportOptions {
  host: string
  port: number
  secure: false
  fallbackTransport: 'DISABLED'
}

export function createFailClosedMailTransportOptions(
  plan: FailClosedMailCapturePlan,
): FailClosedMailTransportOptions {
  if (plan.mode !== 'LOOPBACK_CAPTURE' || plan.fallbackTransport !== 'DISABLED' || !LOOPBACK_HOSTS.has(plan.host)) {
    throw new Error('SAFETY: refusing to configure mail delivery outside the owned loopback capture')
  }
  return { host: plan.host, port: plan.port, secure: false, fallbackTransport: 'DISABLED' }
}

export interface CapturedMail {
  to: string
  subject: string
  requestReference: string
}

export function createFailClosedMailCapture(plan: FailClosedMailCapturePlan): {
  readonly messages: readonly CapturedMail[]
  capture(message: CapturedMail): void
} {
  if (plan.mode !== 'LOOPBACK_CAPTURE' || plan.fallbackTransport !== 'DISABLED' || !LOOPBACK_HOSTS.has(plan.host)) {
    throw new Error('SAFETY: refusing to initialize non-loopback or fallback mail transport')
  }
  const messages: CapturedMail[] = []
  return {
    messages,
    capture(message) {
      messages.push({ ...message })
    },
  }
}
