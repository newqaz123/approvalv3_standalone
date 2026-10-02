// Task116C P1 — malformed/getter exception containment at the prefix input
// boundary. Assertion-RED against CURRENT source: (1) exact key shape must be
// rejected BEFORE any value read (extra `sql` key + throwing secret getter =>
// reject without invoking the getter); (2) one-time captures on valid-shape
// input are contained — throwing getters map to fixed T15E_MAINT_MALFORMED
// with the raw throw discarded (no raw error/secret retained or surfaced);
// (3) a proxy whose ownKeys trap throws during shape validation is contained
// too. Pure/static only — no actual PostgreSQL execution is implied.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildT15EMaintenancePrefix } from '../support/native/t15e-private-maintenance-protocol'

const SECRET = 'Synthetic-secret-0123456789abcdef'
const CLUSTER = Object.freeze({ dataDirectory: '/owned-tmp/x/data', databasePort: 20111, databaseName: 'app_cleanstart_dev' })
const CATALOG = Object.freeze({
  tables: [{ schema: 'public', name: 'requests' }],
  sequences: [{ schema: 'public', name: 'requests_id_seq' }],
})

describe('input boundary: shape rejected before any getter runs', () => {
  it('extra sql key + throwing secret getter rejects MALFORMED with the getter NEVER invoked', () => {
    let secretReads = 0
    const input = {
      roleName: 't15e_app_run1',
      get secret() { secretReads += 1; throw new Error('secret getter threw') },
      cluster: { ...CLUSTER },
      catalog: { tables: [...CATALOG.tables], sequences: [...CATALOG.sequences] },
      sql: 'DROP TABLE requests;',
    }
    const built = buildT15EMaintenancePrefix(input)
    assert.equal(built.ok, false)
    if (!built.ok) {
      assert.equal(built.category, 'T15E_MAINT_MALFORMED')
      assert.equal(built.stdin, null)
      assert.equal(built.message, 'T15E maintenance prefix failure')
    }
    assert.equal(secretReads, 0, 'no getter may run on extra-key malformed input')
  })
})

describe('input boundary: contained one-time captures on valid shape', () => {
  const base = () => ({
    roleName: 't15e_app_run1',
    cluster: { ...CLUSTER } as { dataDirectory: string; databasePort: number; databaseName: string },
    catalog: { tables: [...CATALOG.tables], sequences: [...CATALOG.sequences] },
  })

  for (const key of ['roleName', 'secret', 'cluster', 'catalog'] as const) {
    it(`throwing ${key} getter returns fixed MALFORMED with no raw error or secret surfaced`, () => {
      const input: Record<string, unknown> = { ...base(), secret: SECRET }
      Object.defineProperty(input, key, {
        enumerable: true,
        get() { throw new Error(`boom-${key}-getter-threw`) },
      })
      const built = buildT15EMaintenancePrefix(input)
      assert.equal(built.ok, false)
      if (!built.ok) {
        assert.equal(built.category, 'T15E_MAINT_MALFORMED')
        assert.equal(built.stdin, null)
      }
      const serialized = JSON.stringify(built)
      assert.equal(serialized.includes('boom'), false, 'raw throw text must be discarded')
      assert.equal(serialized.includes(SECRET), false, 'no secret in any diagnostic')
    })
  }

  it('valid non-throwing getters still read each property exactly once (regression)', () => {
    const reads: Record<string, number> = { roleName: 0, secret: 0, cluster: 0, catalog: 0 }
    const input = {
      get roleName() { reads.roleName += 1; return 't15e_app_run1' },
      get secret() { reads.secret += 1; return SECRET },
      get cluster() { reads.cluster += 1; return { ...CLUSTER } },
      get catalog() { reads.catalog += 1; return { tables: [...CATALOG.tables], sequences: [...CATALOG.sequences] } },
    }
    const built = buildT15EMaintenancePrefix(input)
    assert.equal(built.ok, true)
    for (const [key, count] of Object.entries(reads)) {
      assert.equal(count, 1, `${key} read ${count} times`)
    }
  })
})

describe('input boundary: shape validation itself is contained', () => {
  it('a proxy whose ownKeys trap throws maps to fixed MALFORMED, not a raw exception', () => {
    const hostile = new Proxy({ roleName: 't15e_app_run1', secret: SECRET, cluster: { ...CLUSTER }, catalog: { tables: [...CATALOG.tables], sequences: [...CATALOG.sequences] } }, {
      ownKeys() { throw new Error('ownKeys trap threw') },
    })
    const built = buildT15EMaintenancePrefix(hostile)
    assert.equal(built.ok, false)
    if (!built.ok) assert.equal(built.category, 'T15E_MAINT_MALFORMED')
    assert.equal(JSON.stringify(built).includes('ownKeys'), false)
  })
})
