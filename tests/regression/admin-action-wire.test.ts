import { it, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// TDD coverage for the pure admin Server-Action wire helpers used by the
// isolated admin HTTP-security harness (tests/admin-e2e). These tests are
// side-effect free: they never start a server, never touch a database, and
// never read the developer's .next build — they run against a synthetic
// server-reference-manifest fixture with the SAME shape the real `next dev`
// emits (verified against this repo's dev-built .next output:
//   { node: { "<actionId>": { workers: { "<worker>": { moduleId:
//     "(rsc)/./node_modules/.../next-flight-action-entry-loader.js?actions=%5B%5B%22<abs%20src%20path%3E...%22%2C%5B%7B%22id%22...%7D%5D%5D&__client_imported__=!" } } } } }
// ). The harness replays REAL action protocol: action ids are resolved from
// the app's own generated manifest, and request bodies follow React's
// encodeReply root-field semantics (single JSON array of arguments).

import {
  ADMIN_GUARDED_ACTION_EXPORTS,
  actionKey,
  encodeActionArgsBody,
  findActionId,
  parseServerReferenceManifest,
} from '../support/admin-security/admin-action-wire'

/** Minimal manifest with the exact encoded moduleId shape dev emits. */
function syntheticManifest(): string {
  // encodeURIComponent of the loader query the same way webpack writes it:
  //   ?actions=[["/abs/src/server-actions/users.ts",[{"id":"<id>","exportedName":"getUsers","filename":"server-actions/users.ts"}]]]&__client_imported__=!
  const actions = [
    [
      '/isolated-app-copy/src/server-actions/users.ts',
      [
        { id: 'id-get-users', exportedName: 'getUsers', filename: 'server-actions/users.ts' },
        { id: 'id-get-user', exportedName: 'getUser', filename: 'server-actions/users.ts' },
      ],
    ],
    [
      '/isolated-app-copy/src/server-actions/templates.ts',
      [
        { id: 'id-get-templates', exportedName: 'getTemplates', filename: 'server-actions/templates.ts' },
      ],
    ],
  ]
  const loader =
    '(rsc)/./node_modules/next/dist/build/webpack/loaders/next-flight-action-entry-loader.js' +
    `?actions=${encodeURIComponent(JSON.stringify(actions))}&__client_imported__=!`
  return JSON.stringify({
    node: {
      'id-get-users': { workers: { 'app/admin/users/page': { moduleId: loader } }, layer: 'SSI' },
      'id-get-user': { workers: { 'app/admin/users/page': { moduleId: loader } }, layer: 'SSI' },
      'id-get-templates': {
        workers: {
          'app/admin/templates/page': { moduleId: loader },
          'app/admin/templates/[id]/page': { moduleId: loader },
        },
        layer: 'SSI',
      },
    },
    edge: {},
    encryptionKey: 'synthetic',
  })
}

describe('admin-action-wire manifest parsing', () => {
  it('resolves action ids for every guarded export the admin suite replays', () => {
    const ids = parseServerReferenceManifest(syntheticManifest())
    assert.equal(ids.get(actionKey('server-actions/users.ts', 'getUsers')), 'id-get-users')
    assert.equal(ids.get(actionKey('server-actions/users.ts', 'getUser')), 'id-get-user')
    assert.equal(ids.get(actionKey('server-actions/templates.ts', 'getTemplates')), 'id-get-templates')
  })

  it('ignores manifest entries that are not action-entry loaders', () => {
    const raw = JSON.stringify({
      node: {
        'unrelated-id': {
          workers: { 'app/some/page': { moduleId: '(rsc)/./src/app/some/page.js' } },
        },
      },
      edge: {},
      encryptionKey: 'synthetic',
    })
    assert.equal(parseServerReferenceManifest(raw).size, 0)
  })

  it('rejects malformed manifest JSON with an explicit error', () => {
    assert.throws(() => parseServerReferenceManifest('{not json'), /server-reference-manifest/)
  })

  it('findActionId returns the id for a registered export', () => {
    const ids = parseServerReferenceManifest(syntheticManifest())
    assert.equal(
      findActionId(ids, 'server-actions/users.ts', 'getUsers'),
      'id-get-users'
    )
  })

  it('findActionId fails loudly (listing what IS registered) for a missing export', () => {
    const ids = parseServerReferenceManifest(syntheticManifest())
    assert.throws(
      () => findActionId(ids, 'server-actions/users.ts', 'deactivateUser'),
      /deactivateUser[\s\S]*getUser, getUsers/
    )
  })
})

describe('admin-action-wire guarded export registry', () => {
  it('registers exactly the ten guarded exports from the Astra review', () => {
    assert.equal(ADMIN_GUARDED_ACTION_EXPORTS.length, 10)
    const byModule = new Map<string, number>()
    for (const spec of ADMIN_GUARDED_ACTION_EXPORTS) {
      byModule.set(spec.file, (byModule.get(spec.file) ?? 0) + 1)
    }
    assert.equal(byModule.get('server-actions/users.ts'), 5)
    assert.equal(byModule.get('server-actions/templates.ts'), 5)
  })

  it('keeps exports unique', () => {
    const keys = ADMIN_GUARDED_ACTION_EXPORTS.map((s) => actionKey(s.file, s.exportName))
    assert.equal(new Set(keys).size, keys.length)
  })

  it('marks the six UI-wire-invocable actions and the four manifest-only reads', () => {
    const wire = ADMIN_GUARDED_ACTION_EXPORTS.filter((s) => s.capture === 'ui-wire')
    const constructed = ADMIN_GUARDED_ACTION_EXPORTS.filter((s) => s.capture === 'constructed')
    assert.deepEqual(
      wire.map((s) => s.exportName).sort(),
      ['activateUser', 'deactivateUser', 'deleteTemplate', 'resetUserPassword', 'setTemplateDefault', 'toggleTemplateStatus']
    )
    assert.deepEqual(
      constructed.map((s) => s.exportName).sort(),
      ['getTemplate', 'getTemplates', 'getUser', 'getUsers']
    )
  })
})

describe('admin-action-wire request body encoding (React encodeReply semantics)', () => {
  it('encodes the args array as the single root JSON field body', () => {
    // React processReply: json = serializeModel(root, 0) where root is the
    // args ARRAY; a body with no binary parts resolves to that raw JSON
    // string (verified against
    // next/dist/compiled/react-server-dom-webpack client development build).
    assert.equal(encodeActionArgsBody([]), '[]')
    assert.equal(encodeActionArgsBody(['user-target']), '["user-target"]')
    assert.equal(encodeActionArgsBody(['template-1', 2]), '["template-1",2]')
  })

  it('refuses non-JSON-serializable action arguments', () => {
    assert.throws(() => encodeActionArgsBody([{ bad: () => {} }]), /JSON-serializable/)
  })
})

describe('admin-action-wire guard error signature (Astra finding 5)', () => {
  /** The exact requireAdminUser guard messages of the two source modules. */
  const GUARD_MESSAGES = {
    'server-actions/users.ts': 'Admin authorization is required for user actions',
    'server-actions/templates.ts': 'Unauthorized',
  } as const

  it('every guarded action carries its module guard message', () => {
    for (const spec of ADMIN_GUARDED_ACTION_EXPORTS) {
      assert.equal(
        spec.guardMessage,
        GUARD_MESSAGES[spec.file],
        `${spec.exportName} must carry the guard message of ${spec.file}`
      )
      assert.ok(spec.guardMessage.length > 0)
    }
  })

  it('guard messages match the ACTUAL production throw statements (static contract)', () => {
    // The denial replay asserts the dev flight body carries this exact
    // authorization-error signature. If production rewords the guard, this
    // test fails BEFORE the harness could silently weaken into accepting
    // arbitrary server failures.
    for (const [file, message] of Object.entries(GUARD_MESSAGES)) {
      const source = readFileSync(path.resolve(process.cwd(), 'src', file), 'utf8')
      const thrown = [...source.matchAll(/throw new Error\((['\"])([^'\"]+)\1\)/g)].map((m) => m[2])
      assert.ok(
        thrown.includes(message),
        `${file} no longer throws ${JSON.stringify(message)} (found: ${JSON.stringify(thrown)}) — update the wire registry guardMessage`
      )
    }
  })
})
