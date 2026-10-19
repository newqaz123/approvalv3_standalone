/**
 * Pure (no I/O) helpers for replaying REAL Next.js Server Action protocol
 * against the isolated admin-security app runtime (test-only).
 *
 * Why this module exists: the Astra admin-guard review requires HTTP-level
 * proof that direct unauthorized Server Action POSTs are denied without
 * mutation. Replaying the real protocol needs two things from the app itself:
 *
 *  1. ACTION IDS. In Next 15 dev, `next dev` writes
 *     `<appDir>/.next/server/server-reference-manifest.json` to disk as routes
 *     compile. Every `worker.moduleId` for a `'use server'` module embeds a
 *     percent-encoded loader query of the exact shape:
 *
 *       (rsc)/./node_modules/next/dist/build/webpack/loaders/next-flight-action-entry-loader.js?actions=[["<abs src path>",[{"id":"<actionId>","exportedName":"<name>","filename":"<repo-relative file>"}...]]]&__client_imported__=!
 *
 *     Decoding that query yields the app-generated id for every exported
 *     action of the module — including read actions (getUsers, getUser,
 *     getTemplates, getTemplate) that the admin UI never invokes from client
 *     code, so their ids can never be captured from the wire alone. The ids
 *     are never invented here; they are read from the app's own build output
 *     of the run's isolated copy.
 *
 *  2. REQUEST BODIES. A client-invoked action POSTs to the current page URL
 *     with header `next-action: <actionId>` (lowercase, see
 *     next/dist/esm/client/components/app-router-headers.js) and a body
 *     produced by React's encodeReply: the args ARRAY is serialized as one
 *     root JSON value (field "0" in FormData mode; the plain JSON string
 *     itself when no binary parts are needed — see processReply in
 *     next/dist/compiled/react-server-dom-webpack/cjs/
 *     react-server-dom-webpack-client.browser.development.js:
 *     `json = serializeModel(root, 0); null === formData ? resolve(json) :
 *     formData.set(formFieldPrefix + "0", json)`). Plain string ids therefore
 *     wire as `["<id>"]` with a text/plain body, which is exactly what the
 *     admin UI's own fetch sends and what these helpers reproduce.
 *
 * The admin spec additionally CAPTURES the wire of the six UI-invocable
 * mutating actions from the real admin UI (request interception) and asserts
 * byte-equality with the bodies built here, so the constructed protocol can
 * never silently drift from the app's actual encoding.
 */

export type AdminActionFile = 'server-actions/users.ts' | 'server-actions/templates.ts'

/** Canonical registry key for one guarded server-action export. */
export function actionKey(file: AdminActionFile, exportName: string): string {
  return `${file}#${exportName}`
}

/** How the admin harness obtains this action's wire on the real app. */
export type AdminActionCapture = 'ui-wire' | 'constructed'

export interface GuardedActionSpec {
  file: AdminActionFile
  exportName: string
  /** Page path the admin UI posts this action to. */
  pagePath: '/admin/users' | '/admin/templates'
  capture: AdminActionCapture
  /**
   * The EXACT guard error message the module's requireAdminUser wrapper
   * throws (src/server-actions/users.ts: 'Admin authorization is required
   * for user actions'; src/server-actions/templates.ts: 'Unauthorized').
   * The denial replays assert this authorization-error signature in the dev
   * flight body instead of accepting any >= 400 response — a mutation
   * followed by an unrelated server failure can no longer satisfy the
   * check (Astra finding 5). Statically re-validated against the sources by
   * tests/regression/admin-action-wire.test.ts.
   */
  guardMessage: string
}

/** Guard messages thrown by each module's requireAdminUser wrapper. */
const GUARD_MESSAGES: Record<AdminActionFile, string> = {
  'server-actions/users.ts': 'Admin authorization is required for user actions',
  'server-actions/templates.ts': 'Unauthorized',
}

/**
 * The ten guarded exports named by the Astra admin-action-guard review
 * (src/server-actions/users.ts and src/server-actions/templates.ts). All ten
 * throw from a requireAdmin-derived guard before any read or write.
 */
export const ADMIN_GUARDED_ACTION_EXPORTS: readonly GuardedActionSpec[] = [
  { file: 'server-actions/users.ts', exportName: 'getUsers', pagePath: '/admin/users', capture: 'constructed', guardMessage: GUARD_MESSAGES['server-actions/users.ts'] },
  { file: 'server-actions/users.ts', exportName: 'getUser', pagePath: '/admin/users', capture: 'constructed', guardMessage: GUARD_MESSAGES['server-actions/users.ts'] },
  { file: 'server-actions/users.ts', exportName: 'deactivateUser', pagePath: '/admin/users', capture: 'ui-wire', guardMessage: GUARD_MESSAGES['server-actions/users.ts'] },
  { file: 'server-actions/users.ts', exportName: 'activateUser', pagePath: '/admin/users', capture: 'ui-wire', guardMessage: GUARD_MESSAGES['server-actions/users.ts'] },
  { file: 'server-actions/users.ts', exportName: 'resetUserPassword', pagePath: '/admin/users', capture: 'ui-wire', guardMessage: GUARD_MESSAGES['server-actions/users.ts'] },
  { file: 'server-actions/templates.ts', exportName: 'getTemplates', pagePath: '/admin/templates', capture: 'constructed', guardMessage: GUARD_MESSAGES['server-actions/templates.ts'] },
  { file: 'server-actions/templates.ts', exportName: 'getTemplate', pagePath: '/admin/templates', capture: 'constructed', guardMessage: GUARD_MESSAGES['server-actions/templates.ts'] },
  { file: 'server-actions/templates.ts', exportName: 'toggleTemplateStatus', pagePath: '/admin/templates', capture: 'ui-wire', guardMessage: GUARD_MESSAGES['server-actions/templates.ts'] },
  { file: 'server-actions/templates.ts', exportName: 'setTemplateDefault', pagePath: '/admin/templates', capture: 'ui-wire', guardMessage: GUARD_MESSAGES['server-actions/templates.ts'] },
  { file: 'server-actions/templates.ts', exportName: 'deleteTemplate', pagePath: '/admin/templates', capture: 'ui-wire', guardMessage: GUARD_MESSAGES['server-actions/templates.ts'] },
]

interface ManifestActionEntry {
  id?: unknown
  exportedName?: unknown
  filename?: unknown
}

interface ManifestWorker {
  moduleId?: unknown
}

interface ManifestNodeEntry {
  workers?: unknown
}

const ACTION_ENTRY_LOADER_MARKER = 'next-flight-action-entry-loader.js?actions='

/**
 * Decode the app-generated server-reference manifest into
 * `"<filename>#<exportName>" -> actionId`. Non-action loader moduleIds and
 * malformed JSON are handled explicitly; unknown manifest shapes yield no
 * entries (the caller decides whether a missing action is a failure).
 */
export function parseServerReferenceManifest(raw: string): Map<string, string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(
      `admin-action-wire: server-reference-manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  const ids = new Map<string, string>()
  const node = (parsed as { node?: unknown } | null)?.node
  if (!node || typeof node !== 'object') return ids
  for (const [, entry] of Object.entries(node as Record<string, ManifestNodeEntry>)) {
    const workers = entry?.workers
    if (!workers || typeof workers !== 'object') continue
    for (const worker of Object.values(workers as Record<string, ManifestWorker>)) {
      const moduleId = worker?.moduleId
      if (typeof moduleId !== 'string' || !moduleId.includes(ACTION_ENTRY_LOADER_MARKER)) continue
      for (const registered of decodeActionEntryModuleId(moduleId)) {
        // The authoritative id for each export is the one embedded in the
        // loader's action list — the outer manifest key identifies only one
        // of the module's actions, while the moduleId (shared across a
        // module's entries) carries every export's own id.
        const key = actionKey(registered.filename, registered.exportName)
        if (!ids.has(key)) ids.set(key, registered.id)
      }
    }
  }
  return ids
}

/** Extract `[{id, filename, exportName}]` from one percent-encoded loader moduleId. */
function decodeActionEntryModuleId(moduleId: string): Array<{ id: string; filename: AdminActionFile; exportName: string }> {
  let decoded: string
  try {
    decoded = decodeURIComponent(moduleId)
  } catch {
    return []
  }
  const marker = decoded.indexOf(ACTION_ENTRY_LOADER_MARKER)
  if (marker === -1) return []
  const query = decoded
    .slice(marker + ACTION_ENTRY_LOADER_MARKER.length)
    // The loader query is followed by further loader options (`&__client_imported__=!`).
    .split('&')[0]
  let actions: unknown
  try {
    actions = JSON.parse(query)
  } catch {
    return []
  }
  if (!Array.isArray(actions)) return []
  const out: Array<{ id: string; filename: AdminActionFile; exportName: string }> = []
  for (const group of actions) {
    if (!Array.isArray(group) || group.length < 2) continue
    const [, exports] = group
    if (!Array.isArray(exports)) continue
    for (const entry of exports as ManifestActionEntry[]) {
      const { id, exportedName, filename } = entry ?? {}
      if (typeof id !== 'string' || typeof exportedName !== 'string' || typeof filename !== 'string') continue
      if (filename !== 'server-actions/users.ts' && filename !== 'server-actions/templates.ts') continue
      out.push({ id, filename, exportName: exportedName })
    }
  }
  return out
}

/**
 * Look up the app-generated action id for a guarded export. Fails loudly,
 * listing the registered exports of that file, so a stale manifest surfaces
 * as an actionable harness error instead of a silently wrong wire replay.
 */
export function findActionId(ids: ReadonlyMap<string, string>, file: AdminActionFile, exportName: string): string {
  const id = ids.get(actionKey(file, exportName))
  if (id !== undefined) return id
  const registered = [...ids.keys()]
    .filter((key) => key.startsWith(`${file}#`))
    .map((key) => key.split('#')[1])
    .sort()
  throw new Error(
    `admin-action-wire: no action id registered for ${actionKey(file, exportName)} ` +
      `(registered for ${file}: ${registered.length > 0 ? registered.join(', ') : 'nothing'}). ` +
      'The manifest is written by next dev as routes compile — the authorized-admin phase must load the admin pages first.'
  )
}

/**
 * Build the action POST body for simple JSON-serializable arguments, matching
 * React encodeReply's root-field semantics (one JSON array of args). Binary/
 * function/mutable-object arguments are rejected: the guarded admin actions
 * take only ids and plain strings.
 */
export function encodeActionArgsBody(args: readonly unknown[]): string {
  // JSON.stringify silently DROPS functions/undefined values (they do not
  // round-trip), which would forge a different call than intended. Reject
  // them explicitly: guarded admin actions only ever take ids and strings.
  const rejectNonSerializable = (key: string, value: unknown): unknown => {
    if (typeof value === 'function' || typeof value === 'undefined') {
      throw new TypeError(`non-JSON-serializable ${typeof value} at ${key === '' ? 'root' : `.${key}`}`)
    }
    return value
  }
  try {
    return JSON.stringify(args, rejectNonSerializable)
  } catch (error) {
    throw new Error(
      `admin-action-wire: action arguments must be JSON-serializable (${error instanceof Error ? error.message : String(error)})`
    )
  }
}

// ---------------------------------------------------------------------------
// Runtime-derived REQUIRED ui-wire mapping (Astra run-6 review)
// ---------------------------------------------------------------------------

/** One resolved required ui-wire export → action-ID pair from THIS run's manifest. */
export interface RequiredActionMappingEntry {
  file: AdminActionFile
  exportName: string
  actionId: string
}

/**
 * Resolve the six REQUIRED ui-wire mutation exports' action IDs from the
 * SAME isolated run's app manifest (never hardcoded — a stuck ID's export
 * identity is only knowable per-run). Fails closed: a missing export throws
 * via findActionId; a duplicate ID across exports throws rather than
 * installing an ambiguous capture allowlist.
 */
export function resolveRequiredUiWireActionIds(
  manifestIds: ReadonlyMap<string, string>,
): RequiredActionMappingEntry[] {
  const required = ADMIN_GUARDED_ACTION_EXPORTS.filter((spec) => spec.capture === 'ui-wire')
  const entries = required.map((spec) => ({
    file: spec.file,
    exportName: spec.exportName,
    actionId: findActionId(manifestIds, spec.file, spec.exportName),
  }))
  const ids = entries.map((entry) => entry.actionId)
  if (new Set(ids).size !== ids.length) {
    throw new Error(
      `admin-action-wire: required ui-wire action ids are not unique (${ids.length} exports, ${new Set(ids).size} distinct ids) — refusing an ambiguous capture allowlist`,
    )
  }
  return entries
}

/**
 * Bounded, safe serialization of the export→ID mapping for evidence:
 * export names, files, and action IDs only — no bodies, credentials, or
 * absolute loader paths.
 */
export function serializeRequiredActionMapping(entries: readonly RequiredActionMappingEntry[]): string {
  return JSON.stringify({
    version: 1,
    count: entries.length,
    entries: entries.map((entry) => ({
      file: entry.file,
      exportName: entry.exportName,
      actionId: entry.actionId.slice(0, 128),
    })),
  })
}
