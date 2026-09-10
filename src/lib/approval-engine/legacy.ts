import { normalizePersistedApprovalLevel } from '@/lib/approval-levels'
import type { OrganizationPositionCode } from '@/lib/organization/types'
import type { ApprovalRoutingMode } from './types'

/** Structural subset of a persisted approval row the classifier reads. */
export interface ApprovalRowModeInput {
  routingMode?: string | null
  integrityVersion?: number | null
  requiredLevel?: number | null
  requiredApproverId?: string | null
  requiredPosition?: string | null
  isCustomChain?: boolean
  instanceId?: string | null
  candidateGroupId?: string | null
}

/**
 * How one persisted approval row resolves. LEGACY_LEVEL delegates to the
 * unchanged legacy level engine; CUSTOM_PERSON uses exact-person semantics
 * with `instanceId` separating legacy custom rows (null) from NEW custom
 * attempts; SNAPSHOT_GROUP resolves only from the captured candidate group of
 * its current instance.
 */
export type ApprovalRowClassification =
  | { mode: 'LEGACY_LEVEL'; requiredLevel: number | null }
  | { mode: 'CUSTOM_PERSON'; requiredApproverId: string | null; instanceId: string | null }
  | { mode: 'SNAPSHOT_GROUP'; instanceId: string; candidateGroupId: string; requiredPosition?: OrganizationPositionCode }

/** Corrupted persisted metadata must fail closed, never downgrade modes. */
export class ApprovalRowCorruptedError extends Error {
  readonly code = 'APPROVAL_ROW_CORRUPTED'

  constructor(message: string) {
    super(message)
    this.name = 'ApprovalRowCorruptedError'
  }
}

const POSITION_CODES: readonly string[] = [
  'STAFF',
  'SUPERVISOR',
  'SECTION_MANAGER',
  'DEPARTMENT_MANAGER',
  'DIVISION_MANAGER',
  'FACTORY_MANAGER',
]

/**
 * Reads the persisted routingMode and returns the row's resolution contract.
 *
 * - LEGACY_LEVEL (including untagged version-0 rows, which default to
 *   legacy): delegates to the old engine with the persisted level verbatim;
 *   historical null levels keep their existing legacy handling. No behavior
 *   change.
 * - CUSTOM_PERSON: exact-person semantics; the designated approver may be
 *   null on legacy rows whose account was deleted (existing SetNull
 *   semantics); `instanceId` is null for legacy custom rows and set for NEW
 *   custom attempts.
 * - SNAPSHOT_GROUP: requires integrity version 1, a current instance id, and a
 *   captured candidate group. B14 leftover enum on requiredPosition is optional:
 *   persist writes requiredPositionId only. A present but invalid leftover
 *   value still fails closed. Malformed snapshot metadata throws
 *   `ApprovalRowCorruptedError` and is never silently downgraded to live-level
 *   routing. The group-less approved self-audit row of an AUTO_APPROVED
 *   instance is terminal audit data, not an actionable step: callers must
 *   short-circuit on instance state before classifying it as a candidate step.
 */
export function classifyApprovalRow(row: ApprovalRowModeInput): ApprovalRowClassification {
  const routingMode: ApprovalRoutingMode | string =
    row.routingMode === null || row.routingMode === undefined || row.routingMode === ''
      ? 'LEGACY_LEVEL'
      : row.routingMode

  switch (routingMode) {
    case 'LEGACY_LEVEL':
      return { mode: 'LEGACY_LEVEL', requiredLevel: normalizePersistedApprovalLevel(row.requiredLevel) }
    case 'CUSTOM_PERSON':
      return {
        mode: 'CUSTOM_PERSON',
        requiredApproverId: row.requiredApproverId ?? null,
        instanceId: row.instanceId ?? null,
      }
    case 'SNAPSHOT_GROUP': {
      if (row.integrityVersion !== 1) {
        throw new ApprovalRowCorruptedError('Snapshot approval row must carry integrity version 1')
      }
      if (!row.instanceId) {
        throw new ApprovalRowCorruptedError('Snapshot approval row is missing its approval instance')
      }
      if (!row.candidateGroupId) {
        throw new ApprovalRowCorruptedError('Snapshot approval row is missing its captured candidate group')
      }
      if (row.requiredPosition != null && row.requiredPosition !== '' && !POSITION_CODES.includes(row.requiredPosition)) {
        throw new ApprovalRowCorruptedError(`Snapshot approval row has an invalid required position: ${String(row.requiredPosition)}`)
      }
      const snapshot: Extract<ApprovalRowClassification, { mode: 'SNAPSHOT_GROUP' }> = {
        mode: 'SNAPSHOT_GROUP',
        instanceId: row.instanceId,
        candidateGroupId: row.candidateGroupId,
      }
      if (row.requiredPosition && POSITION_CODES.includes(row.requiredPosition)) {
        snapshot.requiredPosition = row.requiredPosition as OrganizationPositionCode
      }
      return snapshot
    }
    default:
      throw new ApprovalRowCorruptedError(`Unknown approval routing mode: ${String(routingMode)}`)
  }
}
