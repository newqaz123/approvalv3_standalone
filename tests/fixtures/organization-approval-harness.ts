/**
 * Shared Task 1 fix-round harness: executes the REAL server-action source
 * modules (requests.ts, solutions.ts, approvals.ts, notifications.ts,
 * request-access.ts) through TypeScript transpile + `node:vm.runInNewContext`
 * with a strict dependency allowlist, exactly like the sanctioned pattern in
 * tests/regression/template-deletion.test.ts.
 *
 * Only external I/O and ambient boundaries are replaced: the Prisma database
 * (this in-memory fake), auth, React/user cache, next/cache revalidation,
 * SMTP (nodemailer), attachment file I/O, and inline-image session handling.
 * Every business helper (approval levels, guarded status transition,
 * cancellation policy, post-commit orchestration, zod schemas, Prisma enums,
 * rich-text/email-settings/email-crypto/storage path policy) is the REAL
 * production module. Unexpected imports throw. Unsupported predicate, include,
 * or write shapes throw, so a fake gap can never silently permit a write.
 */
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { join } from 'node:path'
import ts from 'typescript'
import type { Prisma, RequestStatus } from '@prisma/client'
import { z } from 'zod'

import * as prismaModule from '@prisma/client'
import * as approvalLevels from '@/lib/approval-levels'
import * as requestApprovalTransaction from '@/lib/request-approval-transaction'
import * as requestStatusTransition from '@/lib/request-status-transition'
import * as cancellationPolicy from '@/lib/cancellation-policy'
import * as postCommitNotifications from '@/lib/post-commit-notifications'
import * as solutionSchemas from '@/lib/schemas/solution-schemas'
import * as cancellationSchemas from '@/lib/schemas/cancellation-schemas'
import * as attachmentsPolicy from '@/lib/attachments/policy'
import * as storage from '@/lib/attachments/storage'
import * as emailCrypto from '@/lib/email-crypto'
import * as emailSettings from '@/lib/email-settings'
import * as formattedText from '@/lib/formatted-text'
import * as followUpDashboard from '@/lib/follow-up-dashboard'

// ---------------------------------------------------------------------------
// Strict in-memory Prisma fake
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
// Test-fake row shapes use `any`-valued records so Prisma's generated
// interfaces (which lack index signatures) satisfy the structural params.
type Row = Record<string, any>

/** Field allowlist per model: an unknown where/select/write key throws. */
const MODEL_FIELDS: Record<string, readonly string[]> = {
  user: ['id', 'departmentId', 'level', 'isActive', 'role', 'name', 'email', 'createdAt'],
  department_approvers: ['id', 'departmentId', 'approverId', 'approverLevel', 'createdAt'],
  departments: ['id', 'type', 'name', 'createdAt'],
  requests: ['id', 'status', 'requesterId', 'title', 'description', 'departmentId', 'organizationUnitId', 'projectEstimateCost', 'engineeringCostEstimate', 'updatedAt', 'createdAt', 'isDeleted', 'isArchived'],
  request_approvals: ['id', 'requestId', 'requiredLevel', 'requiredApproverId', 'order', 'status', 'approverId', 'comments', 'approvedAt', 'isCustomChain', 'isFinalApproval', 'routingMode', 'integrityVersion', 'instanceId', 'requiredPosition', 'requiredPositionId', 'candidateGroupId', 'createdAt'],
  request_activities: ['id', 'requestId', 'userId', 'action', 'comments', 'fromStatus', 'toStatus', 'createdAt'],
  notifications: ['id', 'userId', 'type', 'title', 'message', 'requestId', 'readAt', 'createdAt'],
  solutions: ['id', 'requestId', 'title', 'description', 'costEstimate', 'currency', 'timeline', 'conceptDesign', 'submittedById', 'submittedAt', 'createdAt', 'updatedAt'],
  solution_approvals: ['id', 'solutionId', 'requiredLevel', 'requiredApproverId', 'order', 'status', 'approverId', 'comments', 'approvedAt', 'isCustomChain', 'routingMode', 'integrityVersion', 'instanceId', 'requiredPosition', 'requiredPositionId', 'candidateGroupId', 'createdAt'],
  file_attachments: ['id', 'requestId', 'solutionId', 'uploadedById', 'filePath', 'fileName', 'createdAt'],
  email_settings: ['id', 'enabled', 'host', 'port', 'username', 'password', 'fromAddress', 'createdAt'],
  approval_instances: ['id', 'requestId', 'solutionId', 'phase', 'routeVersionId', 'originUserId', 'originUnitId', 'originContext', 'originAssignmentId', 'originPositionId', 'routingMode', 'state', 'attempt', 'completionReason', 'supersededAt', 'createdAt'],
  organization_units: ['id', 'name', 'unitType', 'parentId', 'legacyDepartmentId', 'isActive', 'operationalType', 'shareRequests', 'canWorkOnSolutions', 'managerUserId', 'createdAt', 'updatedAt'],
  organization_position_assignments: ['id', 'userId', 'unitId', 'positionCode', 'reportingGroupId', 'isPrimary', 'isActive', 'createdAt', 'updatedAt'],
  organization_assignments: ['id', 'userId', 'unitId', 'positionId', 'teamId', 'isActive', 'deactivatedAt', 'createdAt', 'updatedAt'],
  positions: ['id', 'name', 'rank', 'isActive', 'createdAt', 'updatedAt'],
  teams: ['id', 'unitId', 'name', 'reportsToAssignmentId', 'isActive', 'createdAt', 'updatedAt'],
  organization_import_runs: ['id', 'mappingDigest', 'appliedAt', 'appliedBy', 'targetIdentity', 'counts', 'createdAt'],
  reporting_groups: ['id', 'unitId', 'parentGroupId', 'name', 'isActive', 'createdAt'],
  reporting_group_members: ['id', 'reportingGroupId', 'userId', 'createdAt'],
  approval_route_versions: ['id', 'scopeUnitId', 'phase', 'version', 'maximumPositionLevel', 'approvalLimitPositionId', 'status', 'createdById', 'createdAt', 'publishedAt'],
  approval_route_steps: ['id', 'routeVersionId', 'stepOrder', 'positionCode', 'positionId', 'createdAt'],
  approval_candidate_groups: ['id', 'approvalInstanceId', 'requiredPosition', 'requiredPositionId', 'scopeUnitId', 'capturedAt'],
  approval_candidate_group_members: ['id', 'candidateGroupId', 'userId', 'capturedAt', 'capturedDisplayName'],
  request_engineer_assignments: ['id', 'requestId', 'engineerId', 'assignedAt', 'assignedById'],
}

/** JSON-valued columns the field write-shape guard must not reject. */
const JSON_FIELDS = new Set(['approval_instances.originContext', 'organization_import_runs.counts'])

/**
 * Task 2 column defaults the database applies but bare test seeds omit. The
 * current-instance row filter queries `instanceId: null`, which must match
 * legacy rows exactly as it does in Postgres.
 */
const MODEL_COLUMN_DEFAULTS: Record<string, Row> = {
  requests: { organizationUnitId: null, isDeleted: false, isArchived: false },
  request_approvals: { instanceId: null, requiredPosition: null, candidateGroupId: null, routingMode: 'LEGACY_LEVEL', integrityVersion: 0 },
  solution_approvals: { instanceId: null, requiredPosition: null, candidateGroupId: null, routingMode: 'LEGACY_LEVEL', integrityVersion: 0 },
  // Database column default the current-instance row filter relies on.
  approval_instances: { supersededAt: null },
  organization_units: { shareRequests: true, canWorkOnSolutions: false, managerUserId: null },
  organization_assignments: { teamId: null, isActive: true },
  positions: { isActive: true },
  teams: { isActive: true },
}

/** Relation config: FK resolution + list/to-one kind. Unknown keys throw. */
const MODEL_RELATIONS: Record<
  string,
  Record<string, { kind: 'one' | 'many'; model: string; foreignKey?: string; localKey?: string }>
> = {
  user: {
    department: { kind: 'one', model: 'departments', foreignKey: 'departmentId' },
  },
  requests: {
    approvals: { kind: 'many', model: 'request_approvals', foreignKey: 'requestId' },
    solutions: { kind: 'many', model: 'solutions', foreignKey: 'requestId' },
    requester: { kind: 'one', model: 'user', localKey: 'requesterId' },
    department: { kind: 'one', model: 'departments', foreignKey: 'departmentId' },
    fileAttachments: { kind: 'many', model: 'file_attachments', foreignKey: 'requestId' },
    activities: { kind: 'many', model: 'request_activities', foreignKey: 'requestId' },
    engineerAssignments: { kind: 'many', model: 'request_engineer_assignments', foreignKey: 'requestId' },
  },
  request_approvals: {
    request: { kind: 'one', model: 'requests', foreignKey: 'requestId' },
    approver: { kind: 'one', model: 'user', foreignKey: 'approverId' },
    requiredApprover: { kind: 'one', model: 'user', foreignKey: 'requiredApproverId' },
    instance: { kind: 'one', model: 'approval_instances', foreignKey: 'instanceId' },
    candidateGroup: { kind: 'one', model: 'approval_candidate_groups', foreignKey: 'candidateGroupId' },
  },
  solutions: {
    request: { kind: 'one', model: 'requests', foreignKey: 'requestId' },
    approvals: { kind: 'many', model: 'solution_approvals', foreignKey: 'solutionId' },
    fileAttachments: { kind: 'many', model: 'file_attachments', foreignKey: 'solutionId' },
    submittedBy: { kind: 'one', model: 'user', foreignKey: 'submittedById' },
  },
  solution_approvals: {
    solution: { kind: 'one', model: 'solutions', foreignKey: 'solutionId' },
    instance: { kind: 'one', model: 'approval_instances', foreignKey: 'instanceId' },
    candidateGroup: { kind: 'one', model: 'approval_candidate_groups', foreignKey: 'candidateGroupId' },
    approver: { kind: 'one', model: 'user', foreignKey: 'approverId' },
    requiredApprover: { kind: 'one', model: 'user', foreignKey: 'requiredApproverId' },
  },
  request_engineer_assignments: {
    engineer: { kind: 'one', model: 'user', foreignKey: 'engineerId' },
    request: { kind: 'one', model: 'requests', foreignKey: 'requestId' },
  },
  approval_candidate_groups: {
    members: { kind: 'many', model: 'approval_candidate_group_members', foreignKey: 'candidateGroupId' },
  },
  approval_instances: {
    request: { kind: 'one', model: 'requests', foreignKey: 'requestId' },
    solution: { kind: 'one', model: 'solutions', foreignKey: 'solutionId' },
  },
}

const SCALAR_OPERATORS = new Set(['equals', 'in', 'notIn', 'not', 'lt', 'lte', 'gt', 'gte', 'startsWith'])

function isDateLike(value: unknown): value is Date {
  return (
    value instanceof Date ||
    (typeof value === 'object' && value !== null && typeof (value as { getTime?: unknown }).getTime === 'function')
  )
}

function compareValues(a: unknown, b: unknown): number {
  const av = isDateLike(a) ? a.getTime() : (a as number)
  const bv = isDateLike(b) ? b.getTime() : (b as number)
  return av < bv ? -1 : av > bv ? 1 : 0
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (isDateLike(a) && isDateLike(b)) return a.getTime() === b.getTime()
  return a === b
}

export interface RecordedWrite {
  model: string
  op: 'create' | 'createMany' | 'update' | 'updateMany' | 'deleteMany'
  where?: unknown
  data?: unknown
  count?: number
}

export class UnexpectedQueryError extends Error {}

type Where = Record<string, any>
type Select = Record<string, any>
type Include = Record<string, any>
type OrderBy = Record<string, 'asc' | 'desc'>

interface ModelTable {
  rows: Map<string, Row>
  findUnique(args: { where: Where; select?: Select; include?: Include }): Promise<Row | null>
  findUniqueOrThrow(args: { where: Where; select?: Select; include?: Include }): Promise<Row>
  findFirst(args: { where?: Where; orderBy?: OrderBy | OrderBy[]; select?: Select; include?: Include }): Promise<Row | null>
  findMany(args: { where?: Where; orderBy?: OrderBy | OrderBy[]; select?: Select; include?: Include; take?: number }): Promise<Row[]>
  create(args: { data: Row }): Promise<Row>
  createMany(args: { data: Row[] }): Promise<{ count: number }>
  update(args: { where: Where; data: Row }): Promise<Row>
  updateMany(args: { where: Where; data: Row }): Promise<{ count: number }>
  deleteMany(args: { where: Where }): Promise<{ count: number }>
  count(args: { where?: Where }): Promise<number>
}

function assertExactKeys(args: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(args)) {
    if (!allowed.includes(key)) {
      throw new UnexpectedQueryError(`${label}: unsupported argument '${key}' (allowed: ${allowed.join(', ')})`)
    }
  }
}

function assertFields(model: string, data: Row, label: string): void {
  for (const key of Object.keys(data)) {
    if (!MODEL_FIELDS[model].includes(key)) {
      throw new UnexpectedQueryError(`${label}: unsupported field '${key}' for ${model}`)
    }
    const value = data[key]
    if (value !== null && typeof value === 'object' && !isDateLike(value) && !JSON_FIELDS.has(`${model}.${key}`)) {
      throw new UnexpectedQueryError(`${label}: unsupported write value for '${key}' on ${model} (nested write operators are not modeled)`)
    }
  }
}

function sortRows(rows: Row[], orderBy: OrderBy | OrderBy[] | undefined): void {
  if (!orderBy) return
  const orders = Array.isArray(orderBy) ? orderBy : [orderBy]
  rows.sort((a, b) => {
    for (const order of orders) {
      for (const [field, direction] of Object.entries(order)) {
        const comparison = compareValues(a[field], b[field])
        if (comparison !== 0) return direction === 'desc' ? -comparison : comparison
      }
    }
    return 0
  })
}

function matchWhere(db: ApprovalWorkflowDb, model: string, row: Row, where: Where): boolean {
  for (const [key, condition] of Object.entries(where)) {
    if (key === 'AND') {
      if (!Array.isArray(condition) || !condition.every((clause) => matchWhere(db, model, row, clause as Where))) return false
      continue
    }
    if (key === 'OR') {
      if (!Array.isArray(condition) || !condition.some((clause) => matchWhere(db, model, row, clause as Where))) return false
      continue
    }
    if (key === 'NOT') {
      if (matchWhere(db, model, row, condition as Where)) return false
      continue
    }
    const relation = MODEL_RELATIONS[model]?.[key]
    if (relation) {
      if (!matchRelationCondition(db, model, row, key, relation, condition as Where)) return false
      continue
    }
    if (!MODEL_FIELDS[model].includes(key)) {
      throw new UnexpectedQueryError(`Unsupported where key '${key}' for ${model}`)
    }
    if (!matchScalar(row[key], condition)) return false
  }
  return true
}

function matchRelationCondition(
  db: ApprovalWorkflowDb,
  model: string,
  row: Row,
  key: string,
  relation: { kind: 'one' | 'many'; model: string; foreignKey?: string; localKey?: string },
  condition: Where,
): boolean {
  const supported = relation.kind === 'many' ? ['some', 'none', 'every'] : ['is']
  const whereCombinators = new Set(['AND', 'OR', 'NOT'])
  for (const op of Object.keys(condition)) {
    if (relation.kind === 'many') {
      // List relation filters accept ONLY some/none/every. A direct
      // related-field shorthand (e.g. approvals: { status: 'pending' }) would
      // silently impose no restriction here, so it must throw instead.
      if (!supported.includes(op)) {
        throw new UnexpectedQueryError(
          `Unsupported list relation operator '${op}' for ${model}.${key} (supported: ${supported.join(', ')}; wrap field conditions in some/none/every)`,
        )
      }
      continue
    }
    if (
      !supported.includes(op) &&
      !whereCombinators.has(op) &&
      !MODEL_FIELDS[relation.model].includes(op) &&
      !MODEL_RELATIONS[relation.model]?.[op]
    ) {
      throw new UnexpectedQueryError(`Unsupported relation operator '${op}' for ${model}.${key} (supported: 'is', AND/OR/NOT, related-model fields, or nested to-one relations)`)
    }
  }
  const related = resolveRelation(db, model, row, key, relation)
  if (relation.kind === 'one') {
    const target = related[0]
    if (!target) return false
    // Prisma shorthand: a to-one relation filter may carry the related model's
    // field conditions directly (e.g. { solution: { requestId } }) instead of
    // wrapping them in `is`.
    const nestedWhere = (condition.is ?? condition) as Where
    return matchWhere(db, relation.model, target, nestedWhere)
  }
  if (condition.some !== undefined && !related.some((item) => matchWhere(db, relation.model, item, condition.some as Where))) return false
  if (condition.none !== undefined && related.some((item) => matchWhere(db, relation.model, item, condition.none as Where))) return false
  if (condition.every !== undefined && !related.every((item) => matchWhere(db, relation.model, item, condition.every as Where))) return false
  return true
}

function resolveRelation(
  db: ApprovalWorkflowDb,
  model: string,
  row: Row,
  _key: string,
  relation: { kind: 'one' | 'many'; model: string; foreignKey?: string; localKey?: string },
): Row[] {
  if (relation.kind === 'one') {
    if (relation.localKey) {
      // This row stores the related row's id under localKey (e.g. requesterId).
      const target = [...db.tableRows(relation.model).values()].find((item) => item.id === row[relation.localKey!])
      return target ? [target] : []
    }
    // This row stores the related table's id under foreignKey (e.g. departmentId).
    const target = [...db.tableRows(relation.model).values()].find((item) => item.id === row[relation.foreignKey!])
    return target ? [target] : []
  }
  return [...db.tableRows(relation.model).values()].filter((item) => item[relation.foreignKey!] === row.id)
}

function matchScalar(value: unknown, condition: unknown): boolean {
  if (condition !== null && typeof condition === 'object' && !isDateLike(condition)) {
    const operators = condition as Record<string, unknown>
    for (const [op, operand] of Object.entries(operators)) {
      if (!SCALAR_OPERATORS.has(op)) {
        throw new UnexpectedQueryError(`Unsupported scalar operator '${op}' (supported: ${[...SCALAR_OPERATORS].join(', ')})`)
      }
      switch (op) {
        case 'equals':
          if (!valuesEqual(value, operand)) return false
          break
        case 'in':
          if (!Array.isArray(operand) || !operand.some((item) => valuesEqual(value, item))) return false
          break
        case 'notIn':
          if (!Array.isArray(operand) || operand.some((item) => valuesEqual(value, item))) return false
          break
        case 'not':
          if (!matchScalar(value, operand)) return false
          break
        case 'lt':
        case 'lte':
        case 'gt':
        case 'gte': {
          const comparison = compareValues(value, operand)
          const matched =
            op === 'lt' ? comparison < 0 : op === 'lte' ? comparison <= 0 : op === 'gt' ? comparison > 0 : comparison >= 0
          if (!matched) return false
          break
        }
        case 'startsWith':
          if (typeof value !== 'string' || typeof operand !== 'string' || !value.startsWith(operand)) return false
          break
      }
    }
    return true
  }
  return valuesEqual(value, condition)
}

function projectRow(
  db: ApprovalWorkflowDb,
  model: string,
  row: Row,
  select: Select | undefined,
  include: Include | undefined,
): Row {
  if (select && include) {
    throw new UnexpectedQueryError(`${model}: 'select' and 'include' cannot be combined in this harness`)
  }
  if (select) {
    const projected: Row = {}
    for (const [key, spec] of Object.entries(select)) {
      const relation = MODEL_RELATIONS[model]?.[key]
      if (relation) {
        const options = (spec ?? {}) as { select?: Select; include?: Include; where?: Where; orderBy?: OrderBy | OrderBy[]; take?: number }
        assertExactKeys(
          options,
          relation.kind === 'many' ? ['select', 'include', 'where', 'orderBy', 'take'] : ['select', 'include'],
          `${model}.select.${key} options`,
        )
        let related = resolveRelation(db, model, row, key, relation)
        if (relation.kind === 'many') {
          if (options.where) related = related.filter((item) => matchWhere(db, relation.model, item, options.where!))
          sortRows(related, options.orderBy)
          if (options.take !== undefined) related = related.slice(0, options.take)
          projected[key] = related.map((item) => projectRow(db, relation.model, item, options.select, options.include))
        } else {
          const target = related[0]
          projected[key] = target ? projectRow(db, relation.model, target, options.select, options.include) : null
        }
        continue
      }
      if (!MODEL_FIELDS[model].includes(key)) {
        throw new UnexpectedQueryError(`Unsupported select key '${key}' for ${model}`)
      }
      projected[key] = structuredClone(row[key])
    }
    return projected
  }
  const result = structuredClone(row)
  if (include) {
    for (const [key, spec] of Object.entries(include)) {
      if (key === '_count') {
        // Minimal _count support: counts of listed to-many relations.
        const countSelect = ((spec ?? {}) as { select?: Select }).select ?? {}
        const counts: Row = {}
        for (const relName of Object.keys(countSelect)) {
          const relation = MODEL_RELATIONS[model]?.[relName]
          if (!relation || relation.kind !== 'many') {
            throw new UnexpectedQueryError(`Unsupported _count key '${relName}' for ${model}`)
          }
          counts[relName] = resolveRelation(db, model, row, relName, relation).length
        }
        result[key] = counts
        continue
      }
      const relation = MODEL_RELATIONS[model]?.[key]
      if (!relation) {
        throw new UnexpectedQueryError(`Unsupported include key '${key}' for ${model}`)
      }
      const options = (spec ?? {}) as { select?: Select; include?: Include; where?: Where; orderBy?: OrderBy | OrderBy[]; take?: number }
      assertExactKeys(
        options,
        relation.kind === 'many' ? ['select', 'include', 'where', 'orderBy', 'take'] : ['select', 'include'],
        `${model}.include.${key} options`,
      )
      let related = resolveRelation(db, model, row, key, relation)
      if (relation.kind === 'many') {
        if (options.where) related = related.filter((item) => matchWhere(db, relation.model, item, options.where!))
        sortRows(related, options.orderBy)
        if (options.take !== undefined) related = related.slice(0, options.take)
        result[key] = related.map((item) => projectRow(db, relation.model, item, options.select, options.include))
      } else {
        const target = related[0]
        result[key] = target ? projectRow(db, relation.model, target, options.select, options.include) : null
      }
    }
  }
  return result
}

/**
 * Stateful in-memory database with the operations and relation shapes the real
 * approval workflow actions use. Each model table exposes the prisma-shaped
 * operations plus its raw `rows` map for persistence assertions. Everything
 * unrecognized throws.
 */
export class ApprovalWorkflowDb {
  private readonly tables: Record<string, Map<string, Row>> = {}
  /** Every mutating call recorded for persistence assertions. */
  readonly writes: RecordedWrite[] = []
  /** Second argument of every prisma.$transaction call (options object). */
  readonly transactionOptions: unknown[] = []
  /**
   * When set, the next prisma.$transaction rejects with this error AFTER the
   * work callback completes — modeling a commit-time failure (e.g. PostgreSQL
   * 40001/P2034) that surfaces outside the transaction callback.
   */
  failNextTransaction?: { code?: string; message: string }
  /** Concurrency injection point: runs after every `requests.findUnique`. */
  onRequestsRead?: () => void
  private readonly concurrentCommits: Array<(db: ApprovalWorkflowDb) => void> = []
  private autoId = 0

  readonly user: ModelTable
  readonly departments: ModelTable
  readonly department_approvers: ModelTable
  readonly requests: Omit<ModelTable, 'findUnique' | 'updateMany'> & {
    findUnique(args: { where: Where; select?: Select; include?: Include }): Promise<Row | null>
    findUnique(args: { where: { id: string }; select: { status: true; requesterId: true; title: true } }): Promise<{ status: RequestStatus; requesterId: string; title: string } | null>
    updateMany(args: { where: Where; data: Row }): Promise<{ count: number }>
    updateMany(args: Prisma.requestsUpdateManyArgs): Promise<{ count: number }>
  }
  readonly request_approvals: ModelTable
  readonly request_activities: ModelTable
  readonly notifications: ModelTable
  readonly solutions: ModelTable
  readonly solution_approvals: ModelTable
  readonly file_attachments: ModelTable
  readonly email_settings: ModelTable
  readonly approval_instances: ModelTable
  readonly approval_candidate_groups: ModelTable
  readonly approval_candidate_group_members: ModelTable
  readonly request_engineer_assignments: ModelTable
  readonly organization_units: ModelTable
  readonly organization_position_assignments: ModelTable
  readonly organization_assignments: ModelTable
  readonly positions: ModelTable
  readonly teams: ModelTable
  readonly organization_import_runs: ModelTable
  readonly reporting_groups: ModelTable
  readonly reporting_group_members: ModelTable
  readonly approval_route_versions: ModelTable
  readonly approval_route_steps: ModelTable

  constructor() {
    for (const model of Object.keys(MODEL_FIELDS)) {
      this.tables[model] = new Map()
    }
    this.user = this.table('user') as ModelTable
    this.departments = this.table('departments') as ModelTable
    this.department_approvers = this.table('department_approvers') as ModelTable
    this.requests = this.table('requests') as ApprovalWorkflowDb['requests']
    this.request_approvals = this.table('request_approvals') as ModelTable
    this.request_activities = this.table('request_activities') as ModelTable
    this.notifications = this.table('notifications') as ModelTable
    this.solutions = this.table('solutions') as ModelTable
    this.solution_approvals = this.table('solution_approvals') as ModelTable
    this.file_attachments = this.table('file_attachments') as ModelTable
    this.email_settings = this.table('email_settings') as ModelTable
    this.approval_instances = this.table('approval_instances') as ModelTable
    this.approval_candidate_groups = this.table('approval_candidate_groups') as ModelTable
    this.approval_candidate_group_members = this.table('approval_candidate_group_members') as ModelTable
    this.request_engineer_assignments = this.table('request_engineer_assignments') as ModelTable
    this.organization_units = this.table('organization_units') as ModelTable
    this.organization_position_assignments = this.table('organization_position_assignments') as ModelTable
    this.organization_assignments = this.table('organization_assignments') as ModelTable
    this.positions = this.table('positions') as ModelTable
    this.teams = this.table('teams') as ModelTable
    this.organization_import_runs = this.table('organization_import_runs') as ModelTable
    this.reporting_groups = this.table('reporting_groups') as ModelTable
    this.reporting_group_members = this.table('reporting_group_members') as ModelTable
    this.approval_route_versions = this.table('approval_route_versions') as ModelTable
    this.approval_route_steps = this.table('approval_route_steps') as ModelTable
  }

  tableRows(model: string): Map<string, Row> {
    return this.tables[model]
  }

  /** Read-only-by-convention view of all tables for test assertions. */
  get rows(): Record<string, Map<string, Row>> {
    return this.tables
  }

  table(model: string): ModelTable {
    if (!MODEL_FIELDS[model]) throw new Error(`Unknown model '${model}'`)
    const db = this
    const rows = this.tables[model]
    const table: ModelTable = {
      rows,
      async findUnique(args) {
        assertExactKeys(args, ['where', 'select', 'include'], `${model}.findUnique args`)
        const row = [...rows.values()].find((row) => matchWhere(db, model, row, args.where)) ?? null
        if (model === 'requests') db.onRequestsRead?.()
        return row ? projectRow(db, model, row, args.select, args.include) : null
      },
      async findUniqueOrThrow(args) {
        const row = await table.findUnique(args)
        if (!row) throw new Error(`${model}: record not found for ${JSON.stringify(args.where)}`)
        return row
      },
      async findFirst(args) {
        assertExactKeys(args, ['where', 'orderBy', 'select', 'include'], `${model}.findFirst args`)
        let candidates = [...rows.values()]
        if (args.where) candidates = candidates.filter((row) => matchWhere(db, model, row, args.where!))
        sortRows(candidates, args.orderBy)
        const row = candidates[0] ?? null
        if (model === 'requests') db.onRequestsRead?.()
        return row ? projectRow(db, model, row, args.select, args.include) : null
      },
      async findMany(args = {}) {
        assertExactKeys(args, ['where', 'orderBy', 'select', 'include', 'take'], `${model}.findMany args`)
        let candidates = [...rows.values()]
        if (args.where) candidates = candidates.filter((row) => matchWhere(db, model, row, args.where!))
        sortRows(candidates, args.orderBy)
        if (args.take !== undefined) candidates = candidates.slice(0, args.take)
        return candidates.map((row) => projectRow(db, model, row, args.select, args.include))
      },
      async create(args) {
        assertExactKeys(args, ['data'], `${model}.create args`)
        const data = { ...(MODEL_COLUMN_DEFAULTS[model] ?? {}), ...args.data }
        if (!data.id) {
          db.autoId += 1
          // Deterministic UUID-shaped id: production schemas validate uuid
          // columns, so generated ids must satisfy the same format.
          data.id = scenarioUuid(db.autoId)
        }
        // Only stamp createdAt on models whose schema actually has the column
        // (snapshot tables carry capturedAt instead).
        if (!data.createdAt && model !== 'email_settings' && MODEL_FIELDS[model].includes('createdAt')) data.createdAt = new Date()
        assertFields(model, data, `${model}.create data`)
        rows.set(String(data.id), data)
        db.writes.push({ model, op: 'create', data: structuredClone(data) })
        return structuredClone(data)
      },
      async createMany(args) {
        assertExactKeys(args, ['data'], `${model}.createMany args`)
        for (const data of args.data) {
          const row = { ...(MODEL_COLUMN_DEFAULTS[model] ?? {}), ...data }
          if (!row.id) {
            db.autoId += 1
            row.id = scenarioUuid(db.autoId)
          }
          if (!row.createdAt && model !== 'email_settings' && MODEL_FIELDS[model].includes('createdAt')) row.createdAt = new Date()
          assertFields(model, row, `${model}.createMany data`)
          rows.set(String(row.id), row)
        }
        db.writes.push({ model, op: 'createMany', data: structuredClone(args.data), count: args.data.length })
        return { count: args.data.length }
      },
      async update(args) {
        assertExactKeys(args, ['where', 'data'], `${model}.update args`)
        const row = [...rows.values()].find((row) => matchWhere(db, model, row, args.where))
        if (!row) throw new Error(`${model}: record to update not found for ${JSON.stringify(args.where)}`)
        assertFields(model, args.data, `${model}.update data`)
        Object.assign(row, args.data)
        db.writes.push({ model, op: 'update', where: args.where, data: structuredClone(args.data) })
        return structuredClone(row)
      },
      async updateMany(args) {
        assertExactKeys(args, ['where', 'data'], `${model}.updateMany args`)
        const where = args.where as Where
        let count = 0
        for (const row of rows.values()) {
          if (!matchWhere(db, model, row, where)) continue
          assertFields(model, args.data as Row, `${model}.updateMany data`)
          Object.assign(row, args.data)
          count += 1
        }
        db.writes.push({ model, op: 'updateMany', where, data: structuredClone(args.data as Row), count })
        return { count }
      },
      async deleteMany(args) {
        assertExactKeys(args, ['where'], `${model}.deleteMany args`)
        let count = 0
        for (const [id, row] of [...rows.entries()]) {
          if (!matchWhere(db, model, row, args.where)) continue
          rows.delete(id)
          count += 1
        }
        db.writes.push({ model, op: 'deleteMany', where: args.where, count })
        return { count }
      },
      async count(args) {
        assertExactKeys(args, ['where'], `${model}.count args`)
        let candidates = [...rows.values()]
        if (args.where) candidates = candidates.filter((row) => matchWhere(db, model, row, args.where!))
        return candidates.length
      },
    }
    return table
  }

  seed(model: string, rows: Row[]): void {
    if (!this.tables[model]) throw new Error(`Unknown seed model '${model}'`)
    for (const row of rows) {
      this.tables[model].set(String(row.id), { ...(MODEL_COLUMN_DEFAULTS[model] ?? {}), ...row })
    }
  }

  /** Writes committed by a competing transaction survive this rollback. */
  commitConcurrently(write: (db: ApprovalWorkflowDb) => void): void {
    write(this)
    this.concurrentCommits.push(write)
  }

  requestApprovalsForRequest(requestId: string): Row[] {
    return [...this.tables.request_approvals.values()].filter((row) => row.requestId === requestId)
  }

  solutionApprovalsForSolution(solutionId: string): Row[] {
    return [...this.tables.solution_approvals.values()].filter((row) => row.solutionId === solutionId)
  }

  notificationsFor(userId: string): Row[] {
    return [...this.tables.notifications.values()].filter((row) => row.userId === userId)
  }

  async $transaction<T>(fn: (tx: ApprovalWorkflowDb) => Promise<T>): Promise<T> {
    const snapshot: Array<[string, Array<[string, Row]>]> = Object.entries(this.tables).map(
      ([model, map]) => [model, [...map.entries()].map(([id, row]) => [id, structuredClone(row)] as [string, Row])],
    )
    try {
      return await fn(this)
    } catch (error) {
      for (const [model, entries] of snapshot) {
        this.tables[model].clear()
        for (const [id, row] of entries) this.tables[model].set(id, row)
      }
      for (const write of this.concurrentCommits) write(this)
      throw error
    }
  }

  /** The `prisma` default-export surface the real modules see. */
  asPrisma(): Record<string, unknown> {
    const prismaLike: Record<string, unknown> = {
      $transaction: async (fn: (tx: ApprovalWorkflowDb) => Promise<unknown>, options?: unknown) => {
        this.transactionOptions.push(options)
        const result = await this.$transaction(fn)
        const injected = this.failNextTransaction
        if (injected) {
          this.failNextTransaction = undefined
          // Shape the rejection like Prisma's known-request errors (code field).
          const error = new Error(injected.message) as Error & { code?: string }
          error.code = injected.code
          throw error
        }
        return result
      },
    }
    for (const model of Object.keys(MODEL_FIELDS)) {
      prismaLike[model] = this.table(model)
    }
    return prismaLike
  }
}

// ---------------------------------------------------------------------------
// Harness state + module loader
// ---------------------------------------------------------------------------

export interface HarnessState {
  authUserId: string | null
  /** Row (with department) returned by the getCurrentUser cache-boundary mock. */
  currentUser: Row | null
  env: Record<string, string | undefined>
  smtpMessages: Array<Record<string, unknown>>
  transporterOptions: Array<Record<string, unknown>>
  revalidatedPaths: string[]
  revalidatedRequestViews: number
  deletedFiles: string[]
  consoleErrors: unknown[][]
  consoleWarnings: unknown[][]
}

export interface HarnessSeed {
  users?: Row[]
  departments?: Row[]
  department_approvers?: Row[]
  requests?: Row[]
  request_approvals?: Row[]
  request_activities?: Row[]
  solutions?: Row[]
  solution_approvals?: Row[]
  file_attachments?: Row[]
  approval_instances?: Row[]
  organization_units?: Row[]
  organization_position_assignments?: Row[]
  organization_assignments?: Row[]
  positions?: Row[]
  teams?: Row[]
  reporting_groups?: Row[]
  reporting_group_members?: Row[]
  organization_import_runs?: Row[]
  approval_route_versions?: Row[]
  approval_route_steps?: Row[]
  approval_candidate_groups?: Row[]
  approval_candidate_group_members?: Row[]
  request_engineer_assignments?: Row[]
}

export interface Harness {
  db: ApprovalWorkflowDb
  state: HarnessState
  requests: Record<string, (...args: unknown[]) => Promise<unknown>>
  solutions: Record<string, (...args: unknown[]) => Promise<unknown>>
  approvals: Record<string, (...args: unknown[]) => Promise<unknown>>
  dashboard: Record<string, (...args: unknown[]) => Promise<unknown>>
  notifications: Record<string, (...args: unknown[]) => Promise<unknown>>
  requestAccess: Record<string, (...args: unknown[]) => Promise<unknown>>
  actionPermissions: Record<string, (...args: unknown[]) => Promise<unknown>>
}

export function createHarness(seed: HarnessSeed = {}): Harness {
  const state: HarnessState = {
    authUserId: null,
    currentUser: null,
    env: {},
    smtpMessages: [],
    transporterOptions: [],
    revalidatedPaths: [],
    revalidatedRequestViews: 0,
    deletedFiles: [],
    consoleErrors: [],
    consoleWarnings: [],
  }
  const db = new ApprovalWorkflowDb()
  db.seed('user', seed.users ?? [])
  db.seed('departments', seed.departments ?? [])
  db.seed('department_approvers', seed.department_approvers ?? [])
  db.seed('requests', seed.requests ?? [])
  db.seed('request_approvals', seed.request_approvals ?? [])
  db.seed('request_activities', seed.request_activities ?? [])
  db.seed('solutions', seed.solutions ?? [])
  db.seed('solution_approvals', seed.solution_approvals ?? [])
  db.seed('file_attachments', seed.file_attachments ?? [])
  db.seed('approval_instances', seed.approval_instances ?? [])
  db.seed('organization_units', seed.organization_units ?? [])
  db.seed('organization_position_assignments', seed.organization_position_assignments ?? [])
  db.seed('organization_assignments', seed.organization_assignments ?? [])
  db.seed('positions', seed.positions ?? [])
  db.seed('teams', seed.teams ?? [])
  db.seed('reporting_groups', seed.reporting_groups ?? [])
  db.seed('reporting_group_members', seed.reporting_group_members ?? [])
  db.seed('organization_import_runs', seed.organization_import_runs ?? [])
  db.seed('approval_route_versions', seed.approval_route_versions ?? [])
  db.seed('approval_route_steps', seed.approval_route_steps ?? [])
  db.seed('approval_candidate_groups', seed.approval_candidate_groups ?? [])
  db.seed('approval_candidate_group_members', seed.approval_candidate_group_members ?? [])
  db.seed('request_engineer_assignments', seed.request_engineer_assignments ?? [])

  const dependencies: Record<string, unknown> = {
    '@/lib/prisma': { default: db.asPrisma() },
    '@/lib/auth-config': {
      auth: async () => (state.authUserId ? { user: { id: state.authUserId } } : null),
    },
    'next/cache': { revalidatePath: (path: string) => void state.revalidatedPaths.push(path) },
    './request-view-invalidation': { revalidateRequestViews: () => void (state.revalidatedRequestViews += 1) },
    zod: { z },
    '@prisma/client': prismaModule,
    '@/lib/approval-levels': approvalLevels,
    '@/lib/request-approval-transaction': requestApprovalTransaction,
    '@/lib/request-status-transition': requestStatusTransition,
    '@/lib/cancellation-policy': cancellationPolicy,
    '@/lib/post-commit-notifications': postCommitNotifications,
    '@/lib/schemas/solution-schemas': solutionSchemas,
    '@/lib/schemas/cancellation-schemas': cancellationSchemas,
    '@/lib/attachments/policy': attachmentsPolicy,
    // Real path-policy functions; only the disk-I/O boundaries are mocked.
    '@/lib/attachments/storage': {
      isRequestDraftReadyPath: storage.isRequestDraftReadyPath,
      isSolutionDraftReadyPath: storage.isSolutionDraftReadyPath,
      attachmentFileExists: async () => true,
      deleteAttachmentFile: async (storedPath: string) => void state.deletedFiles.push(storedPath),
    },
    // Inline-image sessions are attachment/session I/O, not workflow logic.
    '@/lib/inline-images/references': {
      prepareInlineDescription: async ({ description }: { description: string }) => ({ html: description, imageIds: [] }),
      reconcileInlineDescriptionImages: async () => {},
    },
    '@/lib/cache/user-cache': {
      getCurrentUser: async () => state.currentUser,
      getUserById: async (id: string) => db.user.findUnique({ where: { id }, include: { department: {} } }),
    },
    '@/lib/auth': {
      requireAdmin: async () => {
        throw new Error('requireAdmin is outside the Task 1 workflow harness scope')
      },
    },
    '@/lib/request-export': {
      buildRequestExportRows: () => {
        throw new Error('request export is outside the Task 1 workflow harness scope')
      },
    },
    xlsx: {},
    nodemailer: {
      default: {
        createTransport: (options: Record<string, unknown>) => {
          state.transporterOptions.push(options)
          return {
            sendMail: async (mail: Record<string, unknown>) => {
              state.smtpMessages.push(mail)
              return { accepted: [mail.to].flat(), messageId: 'harness-1' }
            },
          }
        },
      },
    },
    '@/lib/email-crypto': emailCrypto,
    '@/lib/email-settings': emailSettings,
    '@/lib/formatted-text': formattedText,
    '@/lib/follow-up-dashboard': followUpDashboard,
  }

  const load = (modulePath: string): Record<string, (...args: unknown[]) => Promise<unknown>> => {
    const source = readFileSync(join('src', modulePath), 'utf8')
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    const moduleExports: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
    runInNewContext(compiled, {
      exports: moduleExports,
      require: (name: string) => {
        if (name in dependencies) return dependencies[name]
        throw new UnexpectedQueryError(`Unexpected dependency '${name}' imported by src/${modulePath}`)
      },
      process: { env: state.env },
      console: {
        error: (...args: unknown[]) => void state.consoleErrors.push(args),
        warn: (...args: unknown[]) => void state.consoleWarnings.push(args),
        log: () => {},
      },
    })
    return moduleExports
  }

  // Load in dependency order; later modules see earlier real modules.
  // The NEW approval-engine modules are loaded as REAL production modules so
  // the workflow actions can consult the rollout gate and (in shadow mode) the
  // read-only NEW resolver through the same strict dependency allowlist.
  dependencies['@/lib/organization/types'] = load('lib/organization/types.ts')
  dependencies['./types'] = dependencies['@/lib/organization/types']
  dependencies['@/lib/organization/tree'] = load('lib/organization/tree.ts')
  dependencies['./tree'] = dependencies['@/lib/organization/tree']
  dependencies['@/lib/organization/repository'] = load('lib/organization/repository.ts')
  dependencies['@/lib/approval-routes/validation'] = load('lib/approval-routes/validation.ts')
  dependencies['./validation'] = dependencies['@/lib/approval-routes/validation']
  dependencies['@/lib/approval-routes/resolver'] = load('lib/approval-routes/resolver.ts')
  dependencies['@/lib/approval-engine/candidate-groups'] = load('lib/approval-engine/candidate-groups.ts')
  dependencies['./candidate-groups'] = dependencies['@/lib/approval-engine/candidate-groups']
  dependencies['@/lib/approval-engine/phase-origin'] = load('lib/approval-engine/phase-origin.ts')
  dependencies['./phase-origin'] = dependencies['@/lib/approval-engine/phase-origin']
  dependencies['@/lib/approval-engine/instances'] = load('lib/approval-engine/instances.ts')
  dependencies['./instances'] = dependencies['@/lib/approval-engine/instances']
  dependencies['@/lib/approval-engine/current-instance'] = load('lib/approval-engine/current-instance.ts')
  dependencies['./current-instance'] = dependencies['@/lib/approval-engine/current-instance']
  dependencies['@/lib/approval-engine/legacy'] = load('lib/approval-engine/legacy.ts')
  dependencies['./legacy'] = dependencies['@/lib/approval-engine/legacy']
  dependencies['@/lib/approval-engine/transactions'] = load('lib/approval-engine/transactions.ts')
  dependencies['@/lib/approval-rollout'] = load('lib/approval-rollout.ts')
  dependencies['@/lib/approval-engine/phase-adapters'] = load('lib/approval-engine/phase-adapters.ts')
  dependencies['@/lib/organization/model'] = load('lib/organization/model.ts')
  dependencies['./model'] = dependencies['@/lib/organization/model']
  dependencies['@/lib/organization/hierarchy'] = load('lib/organization/hierarchy.ts')
  dependencies['./hierarchy'] = dependencies['@/lib/organization/hierarchy']
  dependencies['@/lib/organization/assignments'] = load('lib/organization/assignments.ts')
  dependencies['./assignments'] = dependencies['@/lib/organization/assignments']
  dependencies['@/lib/organization/reporting-path'] = load('lib/organization/reporting-path.ts')
  dependencies['@/lib/approval-routes/definition'] = load('lib/approval-routes/definition.ts')
  dependencies['./definition'] = dependencies['@/lib/approval-routes/definition']
  dependencies['@/lib/approval-routes/selection'] = load('lib/approval-routes/selection.ts')
  dependencies['./selection'] = dependencies['@/lib/approval-routes/selection']
  dependencies['@/lib/approval-engine/candidates'] = load('lib/approval-engine/candidates.ts')
  dependencies['./candidates'] = dependencies['@/lib/approval-engine/candidates']
  dependencies['@/lib/approval-engine/plan'] = load('lib/approval-engine/plan.ts')
  dependencies['./plan'] = dependencies['@/lib/approval-engine/plan']
  dependencies['@/lib/approval-engine/attempts'] = load('lib/approval-engine/attempts.ts')
  dependencies['./attempts'] = dependencies['@/lib/approval-engine/attempts']
  dependencies['@/lib/solution-eligibility'] = load('lib/solution-eligibility.ts')
  dependencies['@/lib/notification-recipients'] = load('lib/notification-recipients.ts')
  dependencies['@/lib/request-visibility/types'] = load('lib/request-visibility/types.ts')
  dependencies['@/lib/request-visibility/predicate'] = load('lib/request-visibility/predicate.ts')
  const requestAccess = load('lib/request-access.ts')
  dependencies['@/lib/request-access'] = requestAccess
  dependencies['@/lib/permission-checks'] = load('lib/permission-checks.ts')
  dependencies['@/lib/engineering-sub-tasks'] = load('lib/engineering-sub-tasks.ts')
  dependencies['@/lib/action-permissions'] = load('lib/action-permissions.ts')
  const requestActionCapabilities = load('server-actions/request-action-capabilities.ts')
  dependencies['./request-action-capabilities'] = requestActionCapabilities
  dependencies['./notifications'] = load('server-actions/notifications.ts')
  const approvals = load('server-actions/approvals.ts')
  dependencies['./approvals'] = approvals
  const requests = load('server-actions/requests.ts')
  dependencies['@/server-actions/requests'] = requests
  const solutions = load('server-actions/solutions.ts')
  const dashboard = load('server-actions/dashboard.ts')

  return {
    db,
    state,
    requests,
    solutions,
    approvals,
    dashboard,
    notifications: dependencies['./notifications'] as Harness['notifications'],
    actionPermissions: {
      ...(dependencies['@/lib/action-permissions'] ?? {}),
      ...requestActionCapabilities,
    } as Harness['actionPermissions'],
    requestAccess,
  }
}

// ---------------------------------------------------------------------------
// Scenario seeds
// ---------------------------------------------------------------------------

/** Deterministic RFC-4122 v4-shaped UUID for schema-validated scenario IDs. */
export function scenarioUuid(n: number): string {
  const suffix = String(n).padStart(12, '0')
  return `00000000-0000-4000-8000-${suffix}`
}

export const SCENARIO = {
  requestId: scenarioUuid(1),
  solutionId: scenarioUuid(3),
  customApproverA: scenarioUuid(11),
  customApproverB: scenarioUuid(12),
  engineeringSupervisorId: 'eng-supervisor-1',
  engineeringManagerId: 'eng-manager-1',
} as const

export function departmentRows(): Row[] {
  return [
    { id: 'department-pd', type: 'PRODUCTION', name: 'Production PD' },
    { id: 'department-engineering', type: 'ENGINEERING', name: 'Engineering' },
  ]
}

export function workflowUsers(): Row[] {
  return [
    { id: 'staff-1', departmentId: 'department-pd', level: 1, isActive: true, role: 'general', name: 'Baseline Staff', email: 'staff-1@example.test' },
    { id: 'supervisor-1', departmentId: 'department-pd', level: 2, isActive: true, role: 'general', name: 'Baseline Supervisor', email: 'supervisor-1@example.test' },
    { id: 'department-manager-1', departmentId: 'department-pd', level: 4, isActive: true, role: 'general', name: 'Baseline Department Manager', email: 'department-manager-1@example.test' },
    { id: 'inactive-1', departmentId: 'department-pd', level: 3, isActive: false, role: 'general', name: 'Inactive Candidate', email: null },
    { id: 'engineer-1', departmentId: 'department-engineering', level: 1, isActive: true, role: 'engineering', name: 'Baseline Engineer', email: 'engineer-1@example.test' },
    { id: SCENARIO.engineeringSupervisorId, departmentId: 'department-engineering', level: 2, isActive: true, role: 'engineering', name: 'Engineering Supervisor', email: 'eng-supervisor-1@example.test' },
    { id: SCENARIO.engineeringManagerId, departmentId: 'department-engineering', level: 4, isActive: true, role: 'engineering', name: 'Engineering Manager', email: 'eng-manager-1@example.test' },
    { id: 'null-org-1', departmentId: null, level: 1, isActive: true, role: 'general', name: 'Null Org User', email: 'null-org-1@example.test' },
    { id: SCENARIO.customApproverA, departmentId: null, level: 1, isActive: true, role: 'general', name: 'Custom Approver A', email: 'custom-a@example.test' },
    { id: SCENARIO.customApproverB, departmentId: null, level: 1, isActive: true, role: 'general', name: 'Custom Approver B', email: 'custom-b@example.test' },
  ]
}

export function baselineRequest(overrides: Row = {}): Row {
  return {
    id: SCENARIO.requestId,
    status: 'ImprovementRequest',
    requesterId: 'staff-1',
    title: 'Baseline pump upgrade',
    description: '<p>Baseline pump upgrade description</p>',
    departmentId: 'department-pd',
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    isDeleted: false,
    ...overrides,
  }
}

export function baselineSolution(overrides: Row = {}): Row {
  return {
    id: SCENARIO.solutionId,
    requestId: SCENARIO.requestId,
    title: 'Baseline solution',
    description: '<p>Baseline solution description</p>',
    costEstimate: 1000,
    currency: 'THB',
    timeline: '4 weeks',
    conceptDesign: null,
    submittedById: 'engineer-1',
    createdAt: new Date('2026-01-02T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  }
}

/** Enables real SMTP delivery through the production email path. */
export function enableTestSmtp(state: HarnessState): void {
  state.env.SMTP_HOST = 'smtp.test'
  state.env.SMTP_FROM = 'approvals@test.local'
}

// ---------------------------------------------------------------------------
// NEW-mode organization scenario (final-review fix wave)
// ---------------------------------------------------------------------------

/** Import digest the NEW-mode gate requires. */
export const NEW_MODE_DIGEST = 'new-mode-fix-wave-digest'

/**
 * Typed organization tree shared by the NEW-mode action tests:
 *
 * factory-1 (FACTORY, factory-mgr)
 * └─ division-1 (DIVISION, division-mgr)
 *    ├─ department-pd-unit (DEPARTMENT, parent-mgr)
 *    │  ├─ section-pd1 (SECTION: new-staff-1, new-supervisor-1, new-eng-1, new-eng-2)
 *    │  └─ section-pd2 (SECTION: new-staff-2 — sibling isolation)
 *    └─ engineering-unit (DEPARTMENT, ENGINEERING, eng-dept-mgr)
 *       └─ section-eng (SECTION: eng-section-mgr)
 *
 * Published routes (one per scope+phase):
 * - REQUEST  @ section-pd1: SUPERVISOR, DEPARTMENT_MANAGER
 * - SOLUTION @ section-pd1: SUPERVISOR, DEPARTMENT_MANAGER (two-step snapshot)
 * - SOLUTION @ section-eng: SUPERVISOR (single step)
 * - FINAL    @ department-pd-unit: DIVISION_MANAGER, FACTORY_MANAGER (two-step)
 */
export function newModeOrgUsers(): Row[] {
  return [
    { id: 'parent-mgr', departmentId: null, level: 4, isActive: true, role: 'general', name: 'Parent Unit Manager', email: 'parent-mgr@example.test' },
    { id: 'division-mgr', departmentId: null, level: 5, isActive: true, role: 'general', name: 'Division Manager', email: 'division-mgr@example.test' },
    { id: 'factory-mgr', departmentId: null, level: 6, isActive: true, role: 'general', name: 'Factory Manager', email: 'factory-mgr@example.test' },
    { id: 'new-staff-1', departmentId: 'department-pd', level: 1, isActive: true, role: 'general', name: 'PD1 New Staff', email: 'new-staff-1@example.test' },
    { id: 'new-staff-2', departmentId: 'department-pd', level: 1, isActive: true, role: 'general', name: 'PD2 New Staff', email: 'new-staff-2@example.test' },
    { id: 'new-supervisor-1', departmentId: 'department-pd', level: 2, isActive: true, role: 'general', name: 'PD1 New Supervisor', email: 'new-supervisor-1@example.test' },
    { id: 'new-eng-1', departmentId: 'department-engineering', level: 1, isActive: true, role: 'engineering', name: 'New Engineer One', email: 'new-eng-1@example.test' },
    { id: 'new-eng-2', departmentId: 'department-engineering', level: 1, isActive: true, role: 'engineering', name: 'New Engineer Two', email: 'new-eng-2@example.test' },
    { id: 'eng-dept-mgr', departmentId: 'department-engineering', level: 4, isActive: true, role: 'general', name: 'Engineering Dept Manager', email: 'eng-dept-mgr@example.test' },
  ]
}

export function newModeOrgUnits(): Row[] {
  return [
    { id: 'factory-1', name: 'Factory', unitType: 'FACTORY', parentId: null, legacyDepartmentId: null, isActive: true, operationalType: 'GENERAL' },
    { id: 'division-1', name: 'Division', unitType: 'DIVISION', parentId: 'factory-1', legacyDepartmentId: null, isActive: true, operationalType: 'GENERAL' },
    { id: 'department-pd-unit', name: 'PD Department', unitType: 'DEPARTMENT', parentId: 'division-1', legacyDepartmentId: 'department-pd', isActive: true, operationalType: 'GENERAL' },
    { id: 'section-pd1', name: 'PD1', unitType: 'SECTION', parentId: 'department-pd-unit', legacyDepartmentId: null, isActive: true, operationalType: 'GENERAL' },
    { id: 'section-pd2', name: 'PD2', unitType: 'SECTION', parentId: 'department-pd-unit', legacyDepartmentId: null, isActive: true, operationalType: 'GENERAL' },
    { id: 'engineering-unit', name: 'Engineering Department', unitType: 'DEPARTMENT', parentId: 'division-1', legacyDepartmentId: 'department-engineering', isActive: true, operationalType: 'ENGINEERING' },
    { id: 'section-eng', name: 'Engineering Section', unitType: 'SECTION', parentId: 'engineering-unit', legacyDepartmentId: null, isActive: true, operationalType: 'GENERAL' },
  ]
}

export function newModeOrgAssignments(): Row[] {
  return [
    { id: 'asg-parent-mgr', userId: 'parent-mgr', unitId: 'department-pd-unit', positionCode: 'DEPARTMENT_MANAGER', reportingGroupId: null, isPrimary: true, isActive: true },
    { id: 'asg-division-mgr', userId: 'division-mgr', unitId: 'division-1', positionCode: 'DIVISION_MANAGER', reportingGroupId: null, isPrimary: true, isActive: true },
    { id: 'asg-factory-mgr', userId: 'factory-mgr', unitId: 'factory-1', positionCode: 'FACTORY_MANAGER', reportingGroupId: null, isPrimary: true, isActive: true },
    { id: 'asg-new-staff-1', userId: 'new-staff-1', unitId: 'section-pd1', positionCode: 'STAFF', reportingGroupId: 'group-pd1', isPrimary: true, isActive: true },
    { id: 'asg-new-staff-2', userId: 'new-staff-2', unitId: 'section-pd2', positionCode: 'STAFF', reportingGroupId: 'group-pd2', isPrimary: true, isActive: true },
    { id: 'asg-new-supervisor-1', userId: 'new-supervisor-1', unitId: 'section-pd1', positionCode: 'SUPERVISOR', reportingGroupId: 'group-pd1', isPrimary: true, isActive: true },
    { id: 'asg-new-eng-1', userId: 'new-eng-1', unitId: 'section-pd1', positionCode: 'STAFF', reportingGroupId: 'group-pd1', isPrimary: true, isActive: true },
    { id: 'asg-new-eng-2', userId: 'new-eng-2', unitId: 'section-pd1', positionCode: 'STAFF', reportingGroupId: 'group-pd1', isPrimary: true, isActive: true },
    { id: 'asg-eng-dept-mgr', userId: 'eng-dept-mgr', unitId: 'engineering-unit', positionCode: 'DEPARTMENT_MANAGER', reportingGroupId: null, isPrimary: true, isActive: true },
  ]
}

export function newModeReportingGroups(): Row[] {
  return [
    { id: 'group-pd1', unitId: 'section-pd1', parentGroupId: null, name: 'PD1 Group', isActive: true },
    { id: 'group-pd2', unitId: 'section-pd2', parentGroupId: null, name: 'PD2 Group', isActive: true },
  ]
}

export function newModeReportingGroupMembers(): Row[] {
  return [
    { id: 'gm-1', reportingGroupId: 'group-pd1', userId: 'new-staff-1' },
    { id: 'gm-2', reportingGroupId: 'group-pd1', userId: 'new-supervisor-1' },
    { id: 'gm-3', reportingGroupId: 'group-pd1', userId: 'new-eng-1' },
    { id: 'gm-4', reportingGroupId: 'group-pd1', userId: 'new-eng-2' },
    { id: 'gm-5', reportingGroupId: 'group-pd2', userId: 'new-staff-2' },
  ]
}

export function newModeRouteVersions(): Row[] {
  return [
    { id: 'route-req-pd', scopeUnitId: 'department-pd-unit', phase: 'REQUEST', version: 1, maximumPositionLevel: 6, status: 'PUBLISHED', createdById: 'admin-1' },
    { id: 'route-sol-pd1', scopeUnitId: 'section-pd1', phase: 'SOLUTION', version: 1, maximumPositionLevel: 4, status: 'PUBLISHED', createdById: 'admin-1' },
    { id: 'route-sol-eng', scopeUnitId: 'section-eng', phase: 'SOLUTION', version: 1, maximumPositionLevel: 4, status: 'PUBLISHED', createdById: 'admin-1' },
    { id: 'route-final-pd', scopeUnitId: 'department-pd-unit', phase: 'FINAL', version: 1, maximumPositionLevel: 6, status: 'PUBLISHED', createdById: 'admin-1' },
  ]
}

export function newModeRouteSteps(): Row[] {
  return [
    { id: 'rs-req-1', routeVersionId: 'route-req-pd', stepOrder: 1, positionCode: 'DIVISION_MANAGER' },
    { id: 'rs-req-2', routeVersionId: 'route-req-pd', stepOrder: 2, positionCode: 'FACTORY_MANAGER' },
    { id: 'rs-sol-pd1-1', routeVersionId: 'route-sol-pd1', stepOrder: 1, positionCode: 'SUPERVISOR' },
    { id: 'rs-sol-pd1-2', routeVersionId: 'route-sol-pd1', stepOrder: 2, positionCode: 'DEPARTMENT_MANAGER' },
    { id: 'rs-sol-eng-1', routeVersionId: 'route-sol-eng', stepOrder: 1, positionCode: 'SUPERVISOR' },
    { id: 'rs-final-1', routeVersionId: 'route-final-pd', stepOrder: 1, positionCode: 'DIVISION_MANAGER' },
    { id: 'rs-final-2', routeVersionId: 'route-final-pd', stepOrder: 2, positionCode: 'FACTORY_MANAGER' },
  ]
}

export function newModeImportRuns(): Row[] {
  return [
    { id: 'run-new-1', mappingDigest: NEW_MODE_DIGEST, appliedAt: new Date('2026-02-01T00:00:00Z'), appliedBy: 'admin-1', targetIdentity: 'fix-wave', counts: {} },
  ]
}

/** All organization/route/reporting seeds the NEW-mode scenarios share. */
export function newModeOrgSeed(): HarnessSeed {
  return {
    users: newModeOrgUsers(),
    organization_units: newModeOrgUnits(),
    organization_position_assignments: newModeOrgAssignments(),
    reporting_groups: newModeReportingGroups(),
    reporting_group_members: newModeReportingGroupMembers(),
    approval_route_versions: newModeRouteVersions(),
    approval_route_steps: newModeRouteSteps(),
    organization_import_runs: newModeImportRuns(),
  }
}

/** Switches the harness into NEW rollout mode with the matching digest. */
export function enableNewMode(state: HarnessState): void {
  state.env.APPROVAL_ORG_ROUTING_MODE = 'new'
  state.env.APPROVAL_ORG_MAPPING_DIGEST = NEW_MODE_DIGEST
}
