'use strict'

/**
 * Test-only Node preload for the isolated business runtime app process.
 *
 * Loaded with `node --require <this file>` (via NODE_OPTIONS) so the Next.js
 * app under test physically cannot open an outbound connection except to the
 * owned numeric loopback ports of the current run (database, its own HTTP
 * port, the mail capture endpoint) and unix sockets under owned dirs. DNS is
 * restricted to the name `localhost`, so an accidental saved/env SMTP relay
 * or any external host fails closed before a packet leaves the process.
 *
 * This guards the application process only; it never patches production
 * transport code and is not shipped with the app.
 */

const fs = require('node:fs')
const net = require('node:net')
const tls = require('node:tls')
const dns = require('node:dns')

const raw = process.env.BUSINESS_NET_ALLOWLIST
if (!raw) {
  throw new Error('SAFETY: BUSINESS_NET_ALLOWLIST must be set for the business test runtime preload')
}
let spec
try {
  spec = JSON.parse(raw)
} catch (error) {
  throw new Error(`SAFETY: BUSINESS_NET_ALLOWLIST is not valid JSON: ${error.message}`)
}
if (!spec || spec.mode !== 'ENFORCE' || typeof spec.tcp !== 'object' || spec.tcp === null) {
  throw new Error('SAFETY: BUSINESS_NET_ALLOWLIST must be an ENFORCE spec with a tcp map')
}

const BLOCK_LOG = process.env.BUSINESS_NET_BLOCK_LOG || null

function recordBlock(kind, target, reason) {
  const line = JSON.stringify({
    at: new Date().toISOString(),
    kind,
    target: {
      host: target.host ?? null,
      port: typeof target.port === 'number' ? target.port : null,
      path: target.path ?? null,
    },
    reason,
    stack: (new Error().stack || '').split('\n').slice(2, 6).join(' | '),
  })
  try {
    // Always surface the reason on stderr: a blocked connection must never
    // fail silently, both for the regression suite and for developers
    // debugging the app runtime. Evidence logging stays best-effort.
    process.stderr.write(`[business-net-guard] ${kind} blocked: ${reason}\n`)
  } catch {
    // Never let stderr writes break the guard itself.
  }
  try {
    if (BLOCK_LOG) fs.appendFileSync(BLOCK_LOG, line + '\n')
  } catch {
    // Never let evidence logging break the guard itself.
  }
}

function decision(target) {
  const path = typeof target.path === 'string' && target.path.length > 0 ? target.path : null
  if (path) {
    const prefixes = Array.isArray(spec.unixSocketPrefixes) ? spec.unixSocketPrefixes : []
    const owned = prefixes.some((prefix) => path === prefix || path.startsWith(prefix + '/'))
    if (owned) return { allowed: true }
    const reason = `unix socket outside owned runtime dirs: ${path}`
    recordBlock('unix', target, reason)
    return { allowed: false, reason }
  }

  const host = String(target.host ?? '').toLowerCase()
  if (!host) {
    const reason = 'connection target has no host'
    recordBlock('tcp', target, reason)
    return { allowed: false, reason }
  }
  const literalLoopback = host === '127.0.0.1' || host === '::1' || host === '::ffff:127.0.0.1'
  const resolvable = Array.isArray(spec.resolvableHostnames) ? spec.resolvableHostnames : []
  if (!literalLoopback && !resolvable.includes(host)) {
    const reason = `non-loopback or unresolved host not allowed: ${host}`
    recordBlock('tcp', target, reason)
    return { allowed: false, reason }
  }
  const allowedHost = host.includes('::') ? '::1' : '127.0.0.1'
  const allowedPorts = Array.isArray(spec.tcp[allowedHost]) ? spec.tcp[allowedHost] : []
  const port = typeof target.port === 'number' ? target.port : Number(target.port)
  if (!Number.isInteger(port)) {
    const reason = `connection to ${allowedHost} without a numeric port`
    recordBlock('tcp', target, reason)
    return { allowed: false, reason }
  }
  if (!allowedPorts.includes(port)) {
    const reason = `port ${port} on ${allowedHost} is not an owned runtime port (allowed: ${allowedPorts.join(', ')})`
    recordBlock('tcp', target, reason)
    return { allowed: false, reason }
  }
  return { allowed: true }
}

function blockedError(kind, target, reason) {
  const error = new Error(`SAFETY: business test runtime blocked an outbound ${kind} connection (${reason})`)
  error.code = 'EBUSINESSNETGUARD'
  return error
}

// net.Socket.prototype.connect is the single funnel for every TCP connect in
// Node (net.connect / net.createConnection / tls.connect all end here).
// Argument forms: connect(options[, cb]) | connect(port[, host][, cb]) |
// connect(path[, cb]).
const originalConnect = net.Socket.prototype.connect
// eslint-disable-next-line no-inner-declarations
function guardedConnect(...args) {
  let host = null
  let port = null
  let pathOption = null
  let first = args[0]
  // Node's net.connect(port, host) funnels through here as a single
  // pre-normalized argument: socket.connect([{ port, host, ... }, cb|null]).
  // An array we fail to unwrap would parse as host-less and block owned
  // ports, so unwrap it here; anything not shaped like that stays fail-closed.
  if (Array.isArray(first) && args.length === 1 && first.length >= 1 &&
      first[0] !== null && typeof first[0] === 'object') {
    first = first[0]
  }
  if (typeof first === 'number') {
    port = first
    if (typeof args[1] === 'string') host = args[1]
  } else if (typeof first === 'string') {
    pathOption = first
  } else if (first && typeof first === 'object') {
    const options = first
    if (typeof options.host === 'string') host = options.host
    if (typeof options.port === 'number') port = options.port
    if (typeof options.path === 'string') pathOption = options.path
  }
  const verdict = decision({ host, port, path: pathOption })
  if (!verdict.allowed) {
    const error = blockedError('tcp', { host, port, path: pathOption }, verdict.reason)
    // Fail asynchronously like a real connect error would, so callers'
    // error handlers see it instead of a synchronous throw during setup.
    process.nextTick(() => {
      this.emit('error', error)
      this.destroy(error)
    })
    return this
  }
  return originalConnect.apply(this, args)
}
net.Socket.prototype.connect = guardedConnect

const originalTlsConnect = tls.connect
tls.connect = function guardedTlsConnect(...args) {
  const options = typeof args[0] === 'object' && args[0] !== null ? args[0] : {}
  const host = typeof options.host === 'string' ? options.host : null
  const port = typeof options.port === 'number' ? options.port : null
  const verdict = decision({ host, port, path: null })
  if (!verdict.allowed) {
    throw blockedError('tls', { host, port }, verdict.reason)
  }
  return originalTlsConnect.apply(this, args)
}

// DNS: only allowlisted names may resolve, and only to loopback answers.
const originalLookup = dns.lookup.bind(dns)
dns.lookup = function guardedLookup(hostname, ...rest) {
  const callback = rest[rest.length - 1]
  const name = String(hostname ?? '').toLowerCase()
  const resolvable = Array.isArray(spec.resolvableHostnames) ? spec.resolvableHostnames : []
  // Literal loopback IPs are always allowed: dns.lookup() is invoked for
  // numeric hostnames too and answers them without touching a resolver
  // (next dev does this at startup). Mirrors decideDnsLookup's carve-out;
  // real names stay blocked and connections stay port-guarded.
  const isLiteralLoopbackIp = name === '127.0.0.1' || name === '::1'
  if (!isLiteralLoopbackIp && !resolvable.includes(name)) {
    const reason = `DNS resolution is not allowed for ${hostname} in the test runtime`
    recordBlock('dns', { host: String(hostname) }, reason)
    process.nextTick(() => callback(blockedError('dns', { host: String(hostname) }, reason)))
    return
  }
  originalLookup(hostname, ...rest.slice(0, -1), (error, address, family) => {
    if (error) return callback(error)
    // dns.lookup answers come in two shapes: a single address string, or —
    // when the caller passes { all: true }, which next/undici do — an array
    // of { address, family } entries. BOTH must be loopback-only.
    const answers = Array.isArray(address) ? address.map((entry) => entry && entry.address) : [address]
    if (!answers.every((entry) => entry === '127.0.0.1' || entry === '::1')) {
      const reason = `${hostname} resolved to a non-loopback address`
      recordBlock('dns', { host: String(hostname) }, reason)
      return callback(blockedError('dns', { host: String(hostname) }, reason))
    }
    callback(null, address, family)
  })
}

// A browser navigation that aborts an in-flight request must not kill the
// isolated Next dev process. Next treats that uncaught abort as fatal and
// restarts, which makes the next test see ERR_CONNECTION_REFUSED.
process.on('uncaughtException', (error) => {
  const code = error && error.code
  const message = String((error && error.message) || '')
  if (code === 'ECONNRESET' || code === 'ECONNABORTED' || code === 'EPIPE' || message === 'aborted') {
    return
  }
})

// Heap telemetry, for the `next dev` server child only (Next marks it with
// NEXT_PRIVATE_WORKER). `next dev` restarts itself once the heap passes 80% of
// its limit and says so only in its own log, so record the heap over time and
// at exit to tell that restart from any other shutdown.
if (process.env.NEXT_PRIVATE_WORKER === '1' && BLOCK_LOG) {
  const v8 = require('node:v8')
  const path = require('node:path')
  const heapLog = path.join(path.dirname(BLOCK_LOG), 'app-heap.log')
  const mb = (bytes) => Math.round(bytes / 1048576)
  const writeHeap = (tag) => {
    try {
      const heap = v8.getHeapStatistics()
      const usage = process.memoryUsage()
      fs.appendFileSync(
        heapLog,
        `${new Date().toISOString()} ${tag} pid=${process.pid} heapUsedMb=${mb(heap.used_heap_size)} ` +
          `heapLimitMb=${mb(heap.heap_size_limit)} externalMb=${mb(usage.external)} ` +
          `arrayBuffersMb=${mb(usage.arrayBuffers)} rssMb=${mb(usage.rss)}\n`,
      )
    } catch {
      // Evidence only; never let it break the app.
    }
  }
  writeHeap('start')
  setInterval(() => writeHeap('sample'), 5000).unref()
  process.on('exit', (code) => writeHeap(`exit code=${code}`))
}

module.exports = { __businessNetGuard: { decision, spec } }
