/**
 * Task 14 harness: executes the REAL organization admin server-action
 * module (src/server-actions/organization.ts) and, for Factory Manager
 * create, the REAL users module (src/server-actions/users.ts) through
 * TypeScript transpile + `node:vm.runInNewContext`.
 *
 * Only external I/O and ambient boundaries are replaced: the Prisma
 * database (this in-memory fake), `requireAdmin`, `next/cache`, bcrypt,
 * and auth-config. Domain helpers (organization types/tree, approval
 * level validation) are the REAL production modules. Unexpected imports,
 * unknown where keys, unknown write fields, and unsupported query shapes
 * throw, so a fake gap can never silently permit a write or a wrong read.
 */
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { join } from 'node:path'
import { dirname, join as posixJoin } from 'node:path/posix'
import ts from 'typescript'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>
type Where = Record<string, any>
type Select = Record<string, any>
type OrderBy = Record<string, 'asc' | 'desc'>

/** Field allowlist per model: an unknown where/select/write key throws. */
const MODEL_FIELDS: Record<string, readonly string[]> = {
  user: [
    'id', 'name', 'email', 'passwordHash', 'departmentId', 'role', 'level',
    'isActive', 'forcePasswordChange', 'createdAt', 'updatedAt',
  ],
  departments: ['id', 'name', 'type'],
  organization_units: [
    'id', 'name', 'unitType', 'parentId', 'legacyDepartmentId', 'isActive',
    'operationalType', 'createdAt', 'updatedAt',
  ],
  organization_position_assignments: [
    'id', 'userId', 'unitId', 'positionCode', 'reportingGroupId', 'isPrimary',
    'isActive', 'createdAt', 'updatedAt',
  ],
  reporting_groups: ['id', 'name', 'unitId', 'parentGroupId', 'isActive', 'createdAt', 'updatedAt'],
  reporting_group_members: ['reportingGroupId', 'userId', 'createdAt'],
  request_activities: ['id', 'requestId', 'action', 'comments', 'userId', 'createdAt'],
  approval_instances: ['id', 'originUnitId', 'state', 'requestId', 'phase', 'routingMode'],
  approval_candidate_groups: ['id', 'approvalInstanceId', 'requiredPosition', 'scopeUnitId'],
  request_approvals: ['id', 'requestId', 'requiredApproverId', 'status', 'routingMode'],
  solution_approvals: ['id', 'solutionId', 'requiredApproverId', 'status', 'routingMode'],
  department_approvers: ['id', 'departmentId', 'approverId', 'approverLevel'],
}

const MODEL_KEYS: Record<string, (row: Row) => string> = {
  reporting_group_members: (row) => `${row.reportingGroupId}:${row.userId}`,
}

export class UnexpectedQueryError extends Error {}

function assertExactKeys(args: Record<string, unknown> | undefined, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(args ?? {})) {
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
  }
}

function matchWhere(model: string, row: Row, where: Where): boolean {
  for (const [key, condition] of Object.entries(where)) {
    if (key === 'OR' && Array.isArray(condition)) {
      if (!condition.some((clause) => matchWhere(model, row, clause as Where))) return false
      continue
    }
    if (!MODEL_FIELDS[model].includes(key)) {
      throw new UnexpectedQueryError(`Unsupported where key '${key}' for ${model}`)
    }
    if (!matchScalar(row[key], condition)) return false
  }
  return true
}

function matchScalar(value: unknown, condition: unknown): boolean {
  if (condition !== null && typeof condition === 'object' && !Array.isArray(condition)) {
    const operators = condition as Record<string, unknown>
    for (const [op, operand] of Object.entries(operators)) {
      if (op === 'in') {
        if (!Array.isArray(operand) || !operand.includes(value)) return false
        continue
      }
      if (op === 'equals') {
        if (value !== operand) return false
        continue
      }
      throw new UnexpectedQueryError(`Unsupported scalar operator '${op}' (supported: in, equals)`)
    }
    return true
  }
  return value === condition
}

function projectRow(row: Row, select: Select | undefined): Row {
  if (!select) return structuredClone(row)
  const projected: Row = {}
  for (const key of Object.keys(select)) {
    if (!ALL_MODEL_FIELDS.has(key)) throw new UnexpectedQueryError(`Unsupported select key '${key}'`)
    projected[key] = structuredClone(row[key])
  }
  return projected
}

const ALL_MODEL_FIELDS = new Set(Object.values(MODEL_FIELDS).flat())

function sortRows(rows: Row[], orderBy: OrderBy | OrderBy[] | undefined): void {
  if (!orderBy) return
  const orders = Array.isArray(orderBy) ? orderBy : [orderBy]
  rows.sort((a, b) => {
    for (const order of orders) {
      for (const [field, direction] of Object.entries(order)) {
        if (a[field] === b[field]) continue
        const compared = a[field] < b[field] ? -1 : 1
        return direction === 'desc' ? -compared : compared
      }
    }
    return 0
  })
}

export interface RecordedWrite {
  model: string
  op: 'create' | 'createMany' | 'update' | 'updateMany' | 'deleteMany'
  where?: unknown
  data?: unknown
  count?: number
}

export class OrganizationAdminDb {
  private readonly tables: Record<string, Map<string, Row>> = {}
  readonly writes: RecordedWrite[] = []
  private autoId = 0

  readonly user: ModelTable
  readonly departments: ModelTable
  readonly organization_units: ModelTable
  readonly organization_position_assignments: ModelTable
  readonly reporting_groups: ModelTable
  readonly reporting_group_members: ModelTable
  readonly request_activities: ModelTable
  readonly approval_instances: ModelTable
  readonly approval_candidate_groups: ModelTable
  readonly request_approvals: ModelTable
  readonly solution_approvals: ModelTable
  readonly department_approvers: ModelTable

  constructor() {
    for (const model of Object.keys(MODEL_FIELDS)) {
      this.tables[model] = new Map()
    }
    this.user = this.table('user')
    this.departments = this.table('departments')
    this.organization_units = this.table('organization_units')
    this.organization_position_assignments = this.table('organization_position_assignments')
    this.reporting_groups = this.table('reporting_groups')
    this.reporting_group_members = this.table('reporting_group_members')
    this.request_activities = this.table('request_activities')
    this.approval_instances = this.table('approval_instances')
    this.approval_candidate_groups = this.table('approval_candidate_groups')
    this.request_approvals = this.table('request_approvals')
    this.solution_approvals = this.table('solution_approvals')
    this.department_approvers = this.table('department_approvers')
  }

  tableRows(model: string): Map<string, Row> {
    return this.tables[model]
  }

  get rows(): Record<string, Map<string, Row>> {
    return this.tables
  }

  private rowKey(model: string, row: Row): string {
    const composer = MODEL_KEYS[model]
    return composer ? composer(row) : String(row.id)
  }

  private table(model: string): ModelTable {
    if (!MODEL_FIELDS[model]) throw new Error(`Unknown model '${model}'`)
    const db = this
    const rows = this.tables[model]
    const keyOf = (row: Row) => db.rowKey(model, row)
    const table: ModelTable = {
      async findUnique(args) {
        assertExactKeys(args, ['where', 'select'], `${model}.findUnique args`)
        const row = [...rows.values()].find((candidate) => matchWhere(model, candidate, args.where)) ?? null
        return row ? projectRow(row, args.select) : null
      },
      async findFirst(args) {
        assertExactKeys(args, ['where', 'orderBy', 'select'], `${model}.findFirst args`)
        let candidates = [...rows.values()]
        if (args.where) candidates = candidates.filter((candidate) => matchWhere(model, candidate, args.where!))
        sortRows(candidates, args.orderBy)
        const row = candidates[0] ?? null
        return row ? projectRow(row, args.select) : null
      },
      async findMany(args) {
        assertExactKeys(args, ['where', 'orderBy', 'select'], `${model}.findMany args`)
        let candidates = [...rows.values()]
        if (args?.where) candidates = candidates.filter((candidate) => matchWhere(model, candidate, args.where!))
        sortRows(candidates, args?.orderBy)
        return candidates.map((candidate) => projectRow(candidate, args?.select))
      },
      async create(args) {
        assertExactKeys(args, ['data'], `${model}.create args`)
        const data = { ...args.data }
        if (!data.id && !MODEL_KEYS[model]) {
          db.autoId += 1
          data.id = `${model}-created-${db.autoId}`
        }
        if (data.createdAt === undefined) data.createdAt = new Date()
        if (data.updatedAt === undefined && MODEL_FIELDS[model].includes('updatedAt')) data.updatedAt = new Date()
        assertFields(model, data, `${model}.create data`)
        rows.set(keyOf(data), data)
        db.writes.push({ model, op: 'create', data: structuredClone(data) })
        return structuredClone(data)
      },
      async update(args) {
        assertExactKeys(args, ['where', 'data'], `${model}.update args`)
        assertFields(model, args.data, `${model}.update data`)
        const row = [...rows.values()].find((candidate) => matchWhere(model, candidate, args.where))
        if (!row) throw new Error(`${model} record not found`)
        const previousKey = keyOf(row)
        Object.assign(row, args.data)
        if (MODEL_FIELDS[model].includes('updatedAt') && args.data.updatedAt === undefined) {
          row.updatedAt = new Date()
        }
        const nextKey = keyOf(row)
        if (nextKey !== previousKey) {
          rows.delete(previousKey)
          rows.set(nextKey, row)
        }
        db.writes.push({ model, op: 'update', where: structuredClone(args.where), data: structuredClone(args.data) })
        return structuredClone(row)
      },
      async updateMany(args) {
        assertExactKeys(args, ['where', 'data'], `${model}.updateMany args`)
        assertFields(model, args.data, `${model}.updateMany data`)
        const matches = [...rows.values()].filter((candidate) => matchWhere(model, candidate, args.where))
        let count = 0
        for (const row of matches) {
          Object.assign(row, args.data)
          count += 1
        }
        db.writes.push({
          model,
          op: 'updateMany',
          where: structuredClone(args.where),
          data: structuredClone(args.data),
          count,
        })
        return { count }
      },
      async deleteMany(args) {
        assertExactKeys(args, ['where'], `${model}.deleteMany args`)
        let count = 0
        for (const [key, row] of [...rows.entries()]) {
          if (matchWhere(model, row, args.where)) {
            rows.delete(key)
            count += 1
          }
        }
        db.writes.push({ model, op: 'deleteMany', where: structuredClone(args.where), count })
        return { count }
      },
    }
    return table
  }

  seed(model: string, rows: Row[]): void {
    if (!this.tables[model]) throw new Error(`Unknown seed model '${model}'`)
    for (const row of rows) {
      this.tables[model].set(this.rowKey(model, row), { ...row })
    }
  }

  snapshot(model: string): Row[] {
    return [...this.tables[model].values()].map((row) => structuredClone(row))
  }

  async $transaction<T>(fn: (tx: OrganizationAdminDb) => Promise<T>): Promise<T> {
    const snapshot: Array<[string, Array<[string, Row]>]> = Object.entries(this.tables).map(
      ([model, map]) => [model, [...map.entries()].map(([key, row]) => [key, structuredClone(row)] as [string, Row])],
    )
    try {
      return await fn(this)
    } catch (error) {
      for (const [model, entries] of snapshot) {
        this.tables[model].clear()
        for (const [key, row] of entries) this.tables[model].set(key, row)
      }
      throw error
    }
  }

  asPrisma(): Record<string, unknown> {
    const prismaLike: Record<string, unknown> = {
      $transaction: (fn: (tx: OrganizationAdminDb) => Promise<unknown>) => this.$transaction(fn),
    }
    for (const model of Object.keys(MODEL_FIELDS)) {
      prismaLike[model] = this.table(model)
    }
    return prismaLike
  }
}

interface ModelTable {
  findUnique(args: { where: Where; select?: Select }): Promise<Row | null>
  findFirst(args: { where?: Where; orderBy?: OrderBy | OrderBy[]; select?: Select }): Promise<Row | null>
  findMany(args?: { where?: Where; orderBy?: OrderBy | OrderBy[]; select?: Select }): Promise<Row[]>
  create(args: { data: Row }): Promise<Row>
  update(args: { where: Where; data: Row }): Promise<Row>
  updateMany(args: { where: Where; data: Row }): Promise<{ count: number }>
  deleteMany(args: { where: Where }): Promise<{ count: number }>
}

export interface OrganizationAdminHarnessState {
  adminId: string | null
  revalidatedPaths: string[]
}

const REAL_MODULES: Record<string, string> = {
  '@/lib/organization/types': 'lib/organization/types.ts',
  '@/lib/organization/tree': 'lib/organization/tree.ts',
  '@/lib/approval-levels': 'lib/approval-levels.ts',
}

const NODE_MODULES = new Set(['zod'])

export interface OrganizationAdminActions {
  getOrganizationAdminData: () => Promise<unknown>
  createOrganizationUnit: (input: unknown) => Promise<unknown>
  updateOrganizationUnit: (input: unknown) => Promise<unknown>
  savePositionAssignment: (input: unknown) => Promise<unknown>
  saveReportingGroup: (input: unknown) => Promise<unknown>
}

export interface UserAdminActions {
  createUser: (input: unknown) => Promise<unknown>
  updateUser: (input: unknown) => Promise<unknown>
}

export interface OrganizationAdminHarness {
  db: OrganizationAdminDb
  state: OrganizationAdminHarnessState
  actions: OrganizationAdminActions
  userActions: UserAdminActions
}

export const ADMIN_SCENARIO = {
  adminId: 'admin-1',
  factoryId: 'unit-factory-f',
  divisionId: 'unit-division-d',
  departmentId: 'unit-department-p',
  sectionOneId: 'unit-section-s1',
  sectionTwoId: 'unit-section-s2',
  groupOneId: 'group-g1',
  staffOneId: 'staff-1',
  departmentManagerOneId: 'department-manager-1',
  pendingInstanceId: 'instance-pending-1',
  pendingRequestApprovalId: 'request-approval-pending-1',
  pendingSolutionApprovalId: 'solution-approval-pending-1',
  pendingCandidateGroupId: 'candidate-group-pending-1',
} as const

function organizationUnits(): Row[] {
  const s = ADMIN_SCENARIO
  return [
    { id: s.factoryId, name: 'Main Factory', unitType: 'FACTORY', parentId: null, isActive: true },
    { id: s.divisionId, name: 'Production Division', unitType: 'DIVISION', parentId: s.factoryId, isActive: true },
    { id: s.departmentId, name: 'Assembly Department', unitType: 'DEPARTMENT', parentId: s.divisionId, isActive: true },
    { id: s.sectionOneId, name: 'Fitting Section', unitType: 'SECTION', parentId: s.departmentId, isActive: true },
    { id: s.sectionTwoId, name: 'Welding Section', unitType: 'SECTION', parentId: s.departmentId, isActive: true },
  ]
}

function organizationUsers(): Row[] {
  const s = ADMIN_SCENARIO
  return [
    { id: s.adminId, name: 'Org Admin', email: 'admin@example.test', isActive: true, role: 'admin', departmentId: null, level: null },
    { id: s.staffOneId, name: 'Fitting Staff One', email: 'staff-1@example.test', isActive: true, role: 'general_dept', departmentId: null, level: null },
    { id: s.departmentManagerOneId, name: 'Assembly Department Manager', email: 'department-manager-1@example.test', isActive: true, role: 'general_dept', departmentId: null, level: null },
  ]
}

function organizationAssignments(): Row[] {
  const s = ADMIN_SCENARIO
  return [
    { id: 'assign-staff-1', userId: s.staffOneId, unitId: s.sectionOneId, positionCode: 'STAFF', reportingGroupId: s.groupOneId, isPrimary: true, isActive: true },
    { id: 'assign-department-manager-1', userId: s.departmentManagerOneId, unitId: s.departmentId, positionCode: 'DEPARTMENT_MANAGER', reportingGroupId: null, isPrimary: true, isActive: true },
  ]
}

export function createOrganizationAdminHarness(): OrganizationAdminHarness {
  const state: OrganizationAdminHarnessState = { adminId: ADMIN_SCENARIO.adminId, revalidatedPaths: [] }
  const db = new OrganizationAdminDb()
  const prismaView = db.asPrisma()
  const compiled = new Map<string, Record<string, unknown>>()

  function compileModule(srcPath: string, requireModule: (name: string) => unknown): Record<string, unknown> {
    const cached = compiled.get(srcPath)
    if (cached) return cached
    const moduleExports: Record<string, unknown> = {}
    compiled.set(srcPath, moduleExports)
    const source = readFileSync(join('src', srcPath), 'utf8')
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    runInNewContext(output, {
      exports: moduleExports,
      require: requireModule,
      process: { env: {} },
      console: { error: () => {}, warn: () => {}, log: () => {} },
    })
    return moduleExports
  }

  function makeRequire(ownerPath: string) {
    return (name: string): unknown => {
      if (name.startsWith('.')) {
        const resolved = posixJoin(dirname(ownerPath), name) + '.ts'
        return compileModule(resolved, makeRequire(resolved))
      }
      if (name === '@/lib/prisma') return { default: prismaView }
      if (name === '@/lib/auth') {
        return { requireAdmin: async () => state.adminId }
      }
      if (name === 'next/cache') {
        return { revalidatePath: (path: string) => void state.revalidatedPaths.push(path) }
      }
      if (name === 'bcryptjs') {
        return { hash: async () => 'hashed-password', compare: async () => true }
      }
      if (name === '@/lib/auth-config') {
        return { auth: async () => (state.adminId ? { user: { id: state.adminId } } : null) }
      }
      if (NODE_MODULES.has(name)) {
        return require(name)
      }
      if (name in REAL_MODULES) {
        return compileModule(REAL_MODULES[name], makeRequire(REAL_MODULES[name]))
      }
      throw new UnexpectedQueryError(`Unexpected dependency '${name}' imported by src/${ownerPath}`)
    }
  }

  db.seed('user', organizationUsers())
  db.seed('organization_units', organizationUnits())
  db.seed('organization_position_assignments', organizationAssignments())
  db.seed('reporting_groups', [
    { id: ADMIN_SCENARIO.groupOneId, name: 'Fitting crews', unitId: ADMIN_SCENARIO.sectionOneId, parentGroupId: null, isActive: true },
  ])
  db.seed('reporting_group_members', [
    { reportingGroupId: ADMIN_SCENARIO.groupOneId, userId: ADMIN_SCENARIO.staffOneId },
  ])
  db.seed('approval_instances', [
    {
      id: ADMIN_SCENARIO.pendingInstanceId,
      originUnitId: ADMIN_SCENARIO.sectionOneId,
      state: 'PENDING',
      requestId: 'request-1',
      phase: 'REQUEST',
      routingMode: 'NEW_ORGANIZATION',
    },
  ])
  db.seed('request_approvals', [
    {
      id: ADMIN_SCENARIO.pendingRequestApprovalId,
      requestId: 'request-1',
      requiredApproverId: ADMIN_SCENARIO.staffOneId,
      status: 'pending',
      routingMode: 'NEW_ORGANIZATION',
    },
  ])
  db.seed('solution_approvals', [
    {
      id: ADMIN_SCENARIO.pendingSolutionApprovalId,
      solutionId: 'solution-1',
      requiredApproverId: ADMIN_SCENARIO.staffOneId,
      status: 'pending',
      routingMode: 'NEW_ORGANIZATION',
    },
  ])
  db.seed('approval_candidate_groups', [
    {
      id: ADMIN_SCENARIO.pendingCandidateGroupId,
      approvalInstanceId: ADMIN_SCENARIO.pendingInstanceId,
      requiredPosition: 'SUPERVISOR',
      scopeUnitId: ADMIN_SCENARIO.sectionOneId,
    },
  ])

  const actions = compileModule('server-actions/organization.ts', makeRequire('server-actions/organization.ts')) as unknown as OrganizationAdminActions
  const userActions = compileModule('server-actions/users.ts', makeRequire('server-actions/users.ts')) as unknown as UserAdminActions

  return { db, state, actions, userActions }
}
