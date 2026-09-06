/**
 * Task 6 harness: executes the REAL admin route server-action module
 * (src/server-actions/approval-routes.ts) through TypeScript transpile +
 * `node:vm.runInNewContext`, exactly like the sanctioned Task 1 pattern in
 * tests/fixtures/organization-approval-harness.ts.
 *
 * A dedicated fixture (instead of extending the Task 1 workflow harness) is
 * required because route actions exercise the organization repository and
 * route tables, which call bare `findMany()` — a shape the Task 1 fake
 * rejects. Only external I/O and ambient boundaries are replaced: the Prisma
 * database (this in-memory fake, including the Task 2 partial unique index
 * `approval_routes_one_published_scope_phase` and the `(scopeUnitId, phase,
 * version)` unique constraint), the admin guard, and `next/cache`. Every
 * domain helper (route validation, nearest-scope selection, step scope,
 * candidate pools via the production engine adapter) is the REAL production
 * module. Unexpected imports, unknown where keys, unknown write fields, and
 * unsupported query shapes throw, so a fake gap can never silently permit a
 * write or a wrong read.
 */
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { join } from 'node:path'
import { dirname, join as posixJoin } from 'node:path/posix'
import ts from 'typescript'

/* eslint-disable @typescript-eslint/no-explicit-any */
// Test-fake row shapes use `any`-valued records so Prisma's generated
// interfaces (which lack index signatures) satisfy the structural params.
type Row = Record<string, any>
type Where = Record<string, any>
type Select = Record<string, any>
type OrderBy = Record<string, 'asc' | 'desc'>

/** Field allowlist per model: an unknown where/select/write key throws. */
const MODEL_FIELDS: Record<string, readonly string[]> = {
  user: ['id', 'name', 'email', 'isActive', 'role'],
  organization_units: ['id', 'name', 'unitType', 'parentId', 'isActive'],
  organization_position_assignments: ['id', 'userId', 'unitId', 'positionCode', 'reportingGroupId', 'isPrimary', 'isActive'],
  reporting_groups: ['id', 'name', 'unitId', 'parentGroupId', 'isActive'],
  reporting_group_members: ['reportingGroupId', 'userId'],
  approval_route_versions: ['id', 'scopeUnitId', 'phase', 'version', 'maximumPositionLevel', 'status', 'createdById', 'createdAt', 'publishedAt'],
  approval_route_steps: ['id', 'routeVersionId', 'stepOrder', 'positionCode', 'createdAt'],
}

/** Composite primary keys: row identity without an `id` column. */
const MODEL_KEYS: Record<string, (row: Row) => string> = {
  reporting_group_members: (row) => `${row.reportingGroupId}:${row.userId}`,
}

export class UnexpectedQueryError extends Error {}

/**
 * Thrown the moment a mutating prisma call is attempted through the
 * fail-on-write view used by preview tests: writes fail immediately, not
 * merely in a post-hoc assertion.
 */
export class UnexpectedWriteError extends Error {
  constructor(model: string, op: string) {
    super(`Unexpected write '${op}' on ${model}: this harness prisma view is read-only`)
    this.name = 'UnexpectedWriteError'
  }
}

/** Prisma-shaped unique-constraint violation (P2002). */
export class FakeUniqueViolationError extends Error {
  readonly code = 'P2002'
  constructor(message: string) {
    super(message)
    this.name = 'FakeUniqueViolationError'
  }
}

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
  op: 'create' | 'createMany' | 'updateMany'
  where?: unknown
  data?: unknown
  count?: number
}

/**
 * In-memory route/organization database. Enforces the Task 2 route
 * constraints the real schema imposes:
 * - `@@unique([scopeUnitId, phase, version])` on approval_route_versions
 * - partial unique index `approval_routes_one_published_scope_phase`
 *   (one PUBLISHED row per scope+phase)
 * - `@@unique([routeVersionId, stepOrder])` and
 *   `@@unique([routeVersionId, positionCode])` on approval_route_steps
 * A violating write throws a P2002-shaped error so callers can prove
 * concurrent publishers are rejected and rolled back.
 */
export class ApprovalRouteAdminDb {
  private readonly tables: Record<string, Map<string, Row>> = {}
  /** Every attempted mutating call (rolled-back writes stay recorded). */
  readonly writes: RecordedWrite[] = []
  private autoId = 0
  private txRouteWriteHookFired = false

  /**
   * Concurrency injection point: fired once per transaction, after the first
   * approval_route_versions write. Use `commitConcurrently` inside it to make
   * a competing publisher's changes behave like committed writes that
   * survive the enclosing transaction's rollback.
   */
  onRouteVersionWrite?: () => void
  private concurrentCommits: Array<(db: ApprovalRouteAdminDb) => void> = []

  readonly user: ModelTable
  readonly organization_units: ModelTable
  readonly organization_position_assignments: ModelTable
  readonly reporting_groups: ModelTable
  readonly reporting_group_members: ModelTable
  readonly approval_route_versions: ModelTable
  readonly approval_route_steps: ModelTable

  constructor() {
    for (const model of Object.keys(MODEL_FIELDS)) {
      this.tables[model] = new Map()
    }
    this.user = this.table('user')
    this.organization_units = this.table('organization_units')
    this.organization_position_assignments = this.table('organization_position_assignments')
    this.reporting_groups = this.table('reporting_groups')
    this.reporting_group_members = this.table('reporting_group_members')
    this.approval_route_versions = this.table('approval_route_versions')
    this.approval_route_steps = this.table('approval_route_steps')
  }

  tableRows(model: string): Map<string, Row> {
    return this.tables[model]
  }

  /** Read-only-by-convention view of all tables for test assertions. */
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
        const row = [...rows.values()].find((row) => matchWhere(model, row, args.where)) ?? null
        return row ? projectRow(row, args.select) : null
      },
      async findFirst(args) {
        assertExactKeys(args, ['where', 'orderBy', 'select'], `${model}.findFirst args`)
        let candidates = [...rows.values()]
        if (args.where) candidates = candidates.filter((row) => matchWhere(model, row, args.where!))
        sortRows(candidates, args.orderBy)
        const row = candidates[0] ?? null
        return row ? projectRow(row, args.select) : null
      },
      async findMany(args) {
        // Bare findMany() (no args) is a real repository call shape.
        assertExactKeys(args, ['where', 'orderBy', 'select'], `${model}.findMany args`)
        let candidates = [...rows.values()]
        if (args?.where) candidates = candidates.filter((row) => matchWhere(model, row, args.where!))
        sortRows(candidates, args?.orderBy)
        return candidates.map((row) => projectRow(row, args?.select))
      },
      async create(args) {
        assertExactKeys(args, ['data'], `${model}.create args`)
        const data = { ...args.data }
        if (!data.id && !MODEL_KEYS[model]) {
          db.autoId += 1
          data.id = `${model}-created-${db.autoId}`
        }
        if (data.createdAt === undefined) data.createdAt = new Date()
        assertFields(model, data, `${model}.create data`)
        if (model === 'approval_route_versions') {
          db.fireRouteVersionWriteHook()
          db.assertRouteVersionConstraints(data)
        }
        rows.set(keyOf(data), data)
        db.writes.push({ model, op: 'create', data: structuredClone(data) })
        return structuredClone(data)
      },
      async createMany(args) {
        assertExactKeys(args, ['data'], `${model}.createMany args`)
        for (const raw of args.data) {
          const data = { ...raw }
          if (!data.id && !MODEL_KEYS[model]) {
            db.autoId += 1
            data.id = `${model}-created-${db.autoId}`
          }
          if (data.createdAt === undefined) data.createdAt = new Date()
          assertFields(model, data, `${model}.createMany data`)
          if (model === 'approval_route_steps') db.assertRouteStepConstraints(data)
          rows.set(keyOf(data), data)
        }
        db.writes.push({ model, op: 'createMany', data: structuredClone(args.data), count: args.data.length })
        return { count: args.data.length }
      },
      async updateMany(args) {
        assertExactKeys(args, ['where', 'data'], `${model}.updateMany args`)
        assertFields(model, args.data, `${model}.updateMany data`)
        // Matches are resolved BEFORE applying so the concurrency hook (which
        // may commit new rows mid-statement) cannot be re-scoped by this
        // statement, mirroring one SQL UPDATE's snapshot.
        const matches = [...rows.values()].filter((row) => matchWhere(model, row, args.where))
        let count = 0
        for (const row of matches) {
          if (model === 'approval_route_versions') db.fireRouteVersionWriteHook()
          const updated = { ...row, ...args.data }
          if (model === 'approval_route_versions') db.assertRouteVersionConstraints(updated, row)
          Object.assign(row, updated)
          count += 1
        }
        db.writes.push({ model, op: 'updateMany', where: structuredClone(args.where), data: structuredClone(args.data), count })
        return { count }
      },
    }
    return table
  }

  private fireRouteVersionWriteHook(): void {
    if (this.txRouteWriteHookFired) return
    this.txRouteWriteHookFired = true
    this.onRouteVersionWrite?.()
  }

  private assertRouteVersionConstraints(row: Row, previous?: Row): void {
    for (const other of this.tables.approval_route_versions.values()) {
      if (previous && this.rowKey('approval_route_versions', other) === this.rowKey('approval_route_versions', previous)) continue
      if (
        other.scopeUnitId === row.scopeUnitId &&
        other.phase === row.phase &&
        other.version === row.version
      ) {
        throw new FakeUniqueViolationError(
          `approval_route_versions_scopeUnitId_phase_version_key: (${row.scopeUnitId}, ${row.phase}, ${row.version}) already exists`,
        )
      }
      if (
        row.status === 'PUBLISHED' &&
        other.status === 'PUBLISHED' &&
        other.scopeUnitId === row.scopeUnitId &&
        other.phase === row.phase
      ) {
        throw new FakeUniqueViolationError(
          `approval_routes_one_published_scope_phase: (${row.scopeUnitId}, ${row.phase}) already has a PUBLISHED route`,
        )
      }
    }
  }

  private assertRouteStepConstraints(row: Row): void {
    for (const other of this.tables.approval_route_steps.values()) {
      if (
        other.routeVersionId === row.routeVersionId &&
        (other.stepOrder === row.stepOrder || other.positionCode === row.positionCode)
      ) {
        throw new FakeUniqueViolationError(
          `approval_route_steps unique constraint violated for route ${row.routeVersionId} (stepOrder ${row.stepOrder}, positionCode ${row.positionCode})`,
        )
      }
    }
  }

  seed(model: string, rows: Row[]): void {
    if (!this.tables[model]) throw new Error(`Unknown seed model '${model}'`)
    for (const row of rows) {
      this.tables[model].set(this.rowKey(model, row), { ...row })
    }
  }

  /**
   * Commits a competing writer's changes immediately and re-applies them
   * after an enclosing transaction rolls back, mirroring how a concurrent
   * transaction's committed writes survive another transaction's abort.
   */
  commitConcurrently(write: (db: ApprovalRouteAdminDb) => void): void {
    write(this)
    this.concurrentCommits.push(write)
  }

  async $transaction<T>(fn: (tx: ApprovalRouteAdminDb) => Promise<T>): Promise<T> {
    const snapshot: Array<[string, Array<[string, Row]>]> = Object.entries(this.tables).map(
      ([model, map]) => [model, [...map.entries()].map(([key, row]) => [key, structuredClone(row)] as [string, Row])],
    )
    this.txRouteWriteHookFired = false
    this.concurrentCommits = []
    try {
      return await fn(this)
    } catch (error) {
      // Latch the write hook during rollback/replay so a replayed concurrent
      // write cannot recursively schedule itself again.
      this.txRouteWriteHookFired = true
      for (const [model, entries] of snapshot) {
        this.tables[model].clear()
        for (const [key, row] of entries) this.tables[model].set(key, row)
      }
      for (const replay of this.concurrentCommits) replay(this)
      throw error
    } finally {
      this.txRouteWriteHookFired = false
      this.concurrentCommits = []
    }
  }

  /** The `prisma` default-export surface the real modules see. */
  asPrisma(options: { readOnly?: boolean } = {}): Record<string, unknown> {
    const prismaLike: Record<string, unknown> = {
      $transaction: (fn: (tx: ApprovalRouteAdminDb) => Promise<unknown>) => this.$transaction(fn),
    }
    for (const model of Object.keys(MODEL_FIELDS)) {
      const table = this.table(model)
      prismaLike[model] = options.readOnly ? readOnlyModelView(model, table) : table
    }
    if (options.readOnly) {
      prismaLike.$executeRaw = () => {
        throw new UnexpectedWriteError('prisma', '$executeRaw')
      }
      prismaLike.$executeRawUnsafe = () => {
        throw new UnexpectedWriteError('prisma', '$executeRawUnsafe')
      }
    }
    return prismaLike
  }
}

const READ_OPS = ['findUnique', 'findFirst', 'findMany'] as const
const WRITE_OPS = ['create', 'createMany', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert'] as const

/** Fails on write: read ops delegate; every mutating op throws immediately. */
function readOnlyModelView(model: string, table: ModelTable): ModelTable {
  const view: Record<string, unknown> = {}
  for (const op of READ_OPS) {
    view[op] = table[op].bind(table)
  }
  for (const op of WRITE_OPS) {
    view[op] = () => {
      throw new UnexpectedWriteError(model, op)
    }
  }
  return view as unknown as ModelTable
}

interface ModelTable {
  findUnique(args: { where: Where; select?: Select }): Promise<Row | null>
  findFirst(args: { where?: Where; orderBy?: OrderBy | OrderBy[]; select?: Select }): Promise<Row | null>
  findMany(args?: { where?: Where; orderBy?: OrderBy | OrderBy[]; select?: Select }): Promise<Row[]>
  create(args: { data: Row }): Promise<Row>
  createMany(args: { data: Row[] }): Promise<{ count: number }>
  updateMany(args: { where: Where; data: Row }): Promise<{ count: number }>
}

// ---------------------------------------------------------------------------
// Harness state + module loader
// ---------------------------------------------------------------------------

export interface ApprovalRouteHarnessState {
  /** Admin id returned by the requireAdmin boundary mock (null = denied). */
  adminId: string | null
  revalidatedPaths: string[]
}

/** Real lib modules the action chain may require (never mocked). */
const REAL_MODULES: Record<string, string> = {
  '@/lib/organization/types': 'lib/organization/types.ts',
  '@/lib/organization/tree': 'lib/organization/tree.ts',
  '@/lib/organization/repository': 'lib/organization/repository.ts',
  '@/lib/approval-routes/types': 'lib/approval-routes/types.ts',
  '@/lib/approval-routes/validation': 'lib/approval-routes/validation.ts',
  '@/lib/approval-routes/resolver': 'lib/approval-routes/resolver.ts',
  '@/lib/approval-engine/types': 'lib/approval-engine/types.ts',
  '@/lib/approval-engine/candidate-groups': 'lib/approval-engine/candidate-groups.ts',
  '@/lib/approval-engine/phase-origin': 'lib/approval-engine/phase-origin.ts',
  '@/lib/approval-engine/instances': 'lib/approval-engine/instances.ts',
}

const MODULE_UNDER_TEST = 'server-actions/approval-routes.ts'

export interface ApprovalRouteHarness {
  db: ApprovalRouteAdminDb
  state: ApprovalRouteHarnessState
  /** The exact prisma view injected into the module (read-only when failOnWrite). */
  prismaView: Record<string, unknown>
  actions: {
    saveApprovalRouteDraft: (input: unknown) => Promise<unknown>
    publishApprovalRoute: (input: unknown) => Promise<unknown>
    previewApprovalRoute: (input: unknown) => Promise<unknown>
  }
}

export interface ApprovalRouteHarnessOptions {
  publishedRoutes?: PublishedRouteSeed[]
  /** Any mutating prisma call throws UnexpectedWriteError immediately. */
  failOnWrite?: boolean
}

export function createApprovalRouteHarness(options: ApprovalRouteHarnessOptions = {}): ApprovalRouteHarness {
  const state: ApprovalRouteHarnessState = { adminId: 'admin-1', revalidatedPaths: [] }
  const db = new ApprovalRouteAdminDb()
  const prismaView = db.asPrisma({ readOnly: options.failOnWrite === true })

  const compiled = new Map<string, Record<string, unknown>>()

  function compileModule(srcPath: string, requireModule: (name: string) => unknown): Record<string, unknown> {
    const cached = compiled.get(srcPath)
    if (cached) return cached
    // Guard against circular requires by registering the export shell first.
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
        // Relative imports resolve inside src and must be real project files.
        const resolved = posixJoin(dirname(ownerPath), name) + '.ts'
        return compileModule(resolved, makeRequire(resolved))
      }
      if (name === '@/lib/prisma') {
        return { default: prismaView }
      }
      if (name === '@/lib/auth') {
        return {
          requireAdmin: async () => state.adminId,
        }
      }
      if (name === 'next/cache') {
        return { revalidatePath: (path: string) => void state.revalidatedPaths.push(path) }
      }
      if (name in REAL_MODULES) {
        return compileModule(REAL_MODULES[name], makeRequire(REAL_MODULES[name]))
      }
      throw new UnexpectedQueryError(`Unexpected dependency '${name}' imported by src/${ownerPath}`)
    }
  }

  const actions = compileModule(MODULE_UNDER_TEST, makeRequire(MODULE_UNDER_TEST)) as unknown as ApprovalRouteHarness['actions']

  return { db, state, prismaView, actions }
}

// ---------------------------------------------------------------------------
// Scenario seeds
// ---------------------------------------------------------------------------

export const ROUTE_SCENARIO = {
  adminId: 'admin-1',
  factoryId: 'unit-factory-f',
  divisionId: 'unit-division-d',
  departmentId: 'unit-department-p',
  sectionOneId: 'unit-section-s1',
  sectionTwoId: 'unit-section-s2',
  groupOneId: 'group-g1',
  groupTwoId: 'group-g2',
  staffOneId: 'staff-1',
  staffTwoId: 'staff-2',
  supervisorOneId: 'supervisor-1',
  sectionManagerOneId: 'section-manager-1',
  departmentManagerOneId: 'department-manager-1',
  factoryManagerOneId: 'factory-manager-1',
  publishedRouteSectionOneId: 'route-s1-request',
  publishedRouteDepartmentId: 'route-p-request',
} as const

export function routeOrganizationUnits(): Row[] {
  const s = ROUTE_SCENARIO
  return [
    { id: s.factoryId, name: 'Main Factory', unitType: 'FACTORY', parentId: null, isActive: true },
    { id: s.divisionId, name: 'Production Division', unitType: 'DIVISION', parentId: s.factoryId, isActive: true },
    { id: s.departmentId, name: 'Assembly Department', unitType: 'DEPARTMENT', parentId: s.divisionId, isActive: true },
    { id: s.sectionOneId, name: 'Fitting Section', unitType: 'SECTION', parentId: s.departmentId, isActive: true },
    { id: s.sectionTwoId, name: 'Welding Section', unitType: 'SECTION', parentId: s.departmentId, isActive: true },
  ]
}

export function routeUsers(): Row[] {
  const s = ROUTE_SCENARIO
  return [
    { id: s.adminId, name: 'Route Admin', email: 'admin@example.test', isActive: true, role: 'admin' },
    { id: s.staffOneId, name: 'Fitting Staff One', email: 'staff-1@example.test', isActive: true, role: 'general' },
    { id: s.staffTwoId, name: 'Welding Staff Two', email: 'staff-2@example.test', isActive: true, role: 'general' },
    { id: s.supervisorOneId, name: 'Fitting Supervisor', email: 'supervisor-1@example.test', isActive: true, role: 'general' },
    { id: s.sectionManagerOneId, name: 'Fitting Section Manager', email: 'section-manager-1@example.test', isActive: true, role: 'general' },
    { id: s.departmentManagerOneId, name: 'Assembly Department Manager', email: 'department-manager-1@example.test', isActive: true, role: 'general' },
    { id: s.factoryManagerOneId, name: 'Main Factory Manager', email: 'factory-manager-1@example.test', isActive: true, role: 'general' },
  ]
}

export function routeAssignments(): Row[] {
  const s = ROUTE_SCENARIO
  return [
    { id: 'assign-staff-1', userId: s.staffOneId, unitId: s.sectionOneId, positionCode: 'STAFF', reportingGroupId: s.groupOneId, isPrimary: true, isActive: true },
    { id: 'assign-staff-2', userId: s.staffTwoId, unitId: s.sectionTwoId, positionCode: 'STAFF', reportingGroupId: s.groupTwoId, isPrimary: true, isActive: true },
    { id: 'assign-supervisor-1', userId: s.supervisorOneId, unitId: s.sectionOneId, positionCode: 'SUPERVISOR', reportingGroupId: s.groupOneId, isPrimary: true, isActive: true },
    { id: 'assign-section-manager-1', userId: s.sectionManagerOneId, unitId: s.sectionOneId, positionCode: 'SECTION_MANAGER', reportingGroupId: null, isPrimary: true, isActive: true },
    { id: 'assign-department-manager-1', userId: s.departmentManagerOneId, unitId: s.departmentId, positionCode: 'DEPARTMENT_MANAGER', reportingGroupId: null, isPrimary: true, isActive: true },
    { id: 'assign-factory-manager-1', userId: s.factoryManagerOneId, unitId: s.factoryId, positionCode: 'FACTORY_MANAGER', reportingGroupId: null, isPrimary: true, isActive: true },
  ]
}

export function routeReportingGroups(): Row[] {
  const s = ROUTE_SCENARIO
  return [
    { id: s.groupOneId, name: 'Fitting crews', unitId: s.sectionOneId, parentGroupId: null, isActive: true },
    { id: s.groupTwoId, name: 'Welding crews', unitId: s.sectionTwoId, parentGroupId: null, isActive: true },
  ]
}

export function routeGroupMembers(): Row[] {
  const s = ROUTE_SCENARIO
  return [
    { reportingGroupId: s.groupOneId, userId: s.staffOneId },
    { reportingGroupId: s.groupOneId, userId: s.supervisorOneId },
    { reportingGroupId: s.groupTwoId, userId: s.staffTwoId },
  ]
}

export interface PublishedRouteSeed {
  id: string
  scopeUnitId: string
  phase: 'REQUEST' | 'SOLUTION' | 'FINAL'
  version: number
  maximumPositionLevel: number
  steps: Array<{ stepOrder: number; positionCode: string }>
}

function publishedVersionRow(seed: PublishedRouteSeed): Row {
  return {
    id: seed.id,
    scopeUnitId: seed.scopeUnitId,
    phase: seed.phase,
    version: seed.version,
    maximumPositionLevel: seed.maximumPositionLevel,
    status: 'PUBLISHED',
    createdById: ROUTE_SCENARIO.adminId,
    createdAt: new Date('2026-09-06T00:00:00Z'),
    publishedAt: new Date('2026-09-06T00:00:00Z'),
  }
}

/** Seeds the given published routes (versions + steps) into the fake db. */
export function seedPublishedRoutes(db: ApprovalRouteAdminDb, seeds: PublishedRouteSeed[]): void {
  db.seed('approval_route_versions', seeds.map(publishedVersionRow))
  db.seed(
    'approval_route_steps',
    seeds.flatMap((seed) =>
      seed.steps.map((step) => ({
        id: `${seed.id}-step-${step.stepOrder}`,
        routeVersionId: seed.id,
        stepOrder: step.stepOrder,
        positionCode: step.positionCode,
        createdAt: new Date('2026-09-06T00:00:00Z'),
      })),
    ),
  )
}

/** Full organization scenario without any route rows. */
export function seedRouteOrganization(db: ApprovalRouteAdminDb): void {
  db.seed('user', routeUsers())
  db.seed('organization_units', routeOrganizationUnits())
  db.seed('organization_position_assignments', routeAssignments())
  db.seed('reporting_groups', routeReportingGroups())
  db.seed('reporting_group_members', routeGroupMembers())
}

export interface RouteScenarioHarnessOptions extends ApprovalRouteHarnessOptions {}

export function createRouteScenarioHarness(options: RouteScenarioHarnessOptions = {}): ApprovalRouteHarness {
  const harness = createApprovalRouteHarness(options)
  seedRouteOrganization(harness.db)
  if (options.publishedRoutes) seedPublishedRoutes(harness.db, options.publishedRoutes)
  return harness
}

/** Standard published routes for the section-one and department scopes. */
export function standardPublishedRoutes(): PublishedRouteSeed[] {
  const s = ROUTE_SCENARIO
  return [
    {
      id: s.publishedRouteSectionOneId,
      scopeUnitId: s.sectionOneId,
      phase: 'REQUEST',
      version: 1,
      maximumPositionLevel: 4,
      steps: [
        { stepOrder: 1, positionCode: 'SUPERVISOR' },
        { stepOrder: 2, positionCode: 'SECTION_MANAGER' },
        { stepOrder: 3, positionCode: 'DEPARTMENT_MANAGER' },
      ],
    },
    {
      id: s.publishedRouteDepartmentId,
      scopeUnitId: s.departmentId,
      phase: 'REQUEST',
      version: 1,
      maximumPositionLevel: 4,
      steps: [
        { stepOrder: 1, positionCode: 'SECTION_MANAGER' },
        { stepOrder: 2, positionCode: 'DEPARTMENT_MANAGER' },
      ],
    },
  ]
}

export function routeDefinitionInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const s = ROUTE_SCENARIO
  return {
    scopeUnitId: s.sectionOneId,
    phase: 'REQUEST',
    maximumPositionLevel: 4,
    steps: [
      { order: 1, position: 'SUPERVISOR' },
      { order: 2, position: 'SECTION_MANAGER' },
    ],
    ...overrides,
  }
}
