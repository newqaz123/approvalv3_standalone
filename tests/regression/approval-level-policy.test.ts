import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  APPROVAL_LEVELS,
  MAX_APPROVAL_LEVEL,
  getApprovalLevelLabel,
  getApprovalLevelsAboveSubmitter,
  getDisplayApprovalLevels,
  normalizePersistedApprovalLevel,
  validateApprovalLevel,
  validateLevelNames,
} from '@/lib/approval-levels'

describe('approval level policy', () => {
  it('exposes exactly levels 1 through 10', () => {
    assert.equal(MAX_APPROVAL_LEVEL, 10)
    assert.deepEqual(APPROVAL_LEVELS, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('accepts integer boundaries and rejects null, zero, eleven, decimals, and strings for required levels', () => {
    assert.equal(validateApprovalLevel(1), 1)
    assert.equal(validateApprovalLevel(10), 10)
    assert.throws(() => validateApprovalLevel(0), /1.*10/)
    assert.throws(() => validateApprovalLevel(11), /1.*10/)
    assert.throws(() => validateApprovalLevel(1.5), /integer/)
    assert.throws(() => validateApprovalLevel('10'), /integer/)
  })

  it('allows null only when validating an optional internal-user level', () => {
    assert.equal(validateApprovalLevel(null, { allowNull: true }), null)
    assert.throws(() => validateApprovalLevel(null), /1.*10/)
  })

  it('strictly validates sparse level-name maps and rejects malformed entries', () => {
    assert.deepEqual(validateLevelNames({ '1': 'Supervisor', '10': 'Director' }), {
      '1': 'Supervisor',
      '10': 'Director',
    })
    assert.equal(validateLevelNames(undefined), null)
    assert.equal(validateLevelNames({}), null)
    assert.throws(() => validateLevelNames({ '0': 'Invalid' }), /level/i)
    assert.throws(() => validateLevelNames({ '11': 'Invalid' }), /level/i)
    assert.throws(() => validateLevelNames({ one: 'Invalid' }), /level/i)
    assert.throws(() => validateLevelNames({ '1': '' }), /name/i)
    assert.throws(() => validateLevelNames({ '1': 10 } as unknown as Record<string, string>), /name/i)
  })

  it('normalizes invalid persisted levels by returning null', () => {
    assert.equal(normalizePersistedApprovalLevel(1), 1)
    assert.equal(normalizePersistedApprovalLevel(10), 10)
    assert.equal(normalizePersistedApprovalLevel(0), null)
    assert.equal(normalizePersistedApprovalLevel(11), null)
    assert.equal(normalizePersistedApprovalLevel(2.5), null)
  })

  it('builds the required levels above a submitter without changing level 1–5 behavior', () => {
    assert.deepEqual(getApprovalLevelsAboveSubmitter(1, 5), [2, 3, 4, 5])
    assert.deepEqual(getApprovalLevelsAboveSubmitter(2, 5), [3, 4, 5])
    assert.deepEqual(getApprovalLevelsAboveSubmitter(10, 10), [])
    assert.deepEqual(getApprovalLevelsAboveSubmitter(1, 10), [2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('includes empty display levels through configured or assigned depth and caps at 10', () => {
    assert.deepEqual(getDisplayApprovalLevels({}, []), [1, 2, 3])
    assert.deepEqual(getDisplayApprovalLevels({ '10': 'Director' }, []), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    assert.deepEqual(getDisplayApprovalLevels({}, [6, null, 10, 11]), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('uses configured labels and falls back to Level N', () => {
    assert.equal(getApprovalLevelLabel({ '10': 'Director' }, 10), 'Director')
    assert.equal(getApprovalLevelLabel({ '10': 'Director' }, 9), 'Level 9')
  })
})
