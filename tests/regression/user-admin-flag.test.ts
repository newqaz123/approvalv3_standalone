import { it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { adminChangeBlockedReason, isAdminRole, roleForAdminFlag } from '../../src/lib/user-role'

it('roleForAdminFlag stores only admin or general_dept', () => {
  assert.equal(roleForAdminFlag(true), 'admin')
  assert.equal(roleForAdminFlag(false), 'general_dept')
})

it('isAdminRole recognizes only admin, including legacy and missing roles', () => {
  assert.equal(isAdminRole('admin'), true)
  for (const role of ['engineering', 'general_dept', null, undefined]) {
    assert.equal(isAdminRole(role), false)
  }
})

const activeAdminChange = {
  actorId: 'actor',
  targetId: 'target',
  targetIsActiveAdmin: true,
  nextIsActiveAdmin: false,
  otherActiveAdminCount: 0,
}

it('adminChangeBlockedReason gives self-demotion precedence over the last-admin guard', () => {
  for (const otherActiveAdminCount of [0, 1]) {
    assert.equal(
      adminChangeBlockedReason({
        ...activeAdminChange,
        targetId: 'actor',
        otherActiveAdminCount,
      }),
      'You cannot remove your own administrator access'
    )
  }
})

it('adminChangeBlockedReason blocks removal of the last active admin', () => {
  assert.equal(
    adminChangeBlockedReason(activeAdminChange),
    'At least one active administrator is required'
  )
  assert.equal(
    adminChangeBlockedReason({ ...activeAdminChange, otherActiveAdminCount: 1 }),
    null
  )
})

it('adminChangeBlockedReason permits name-only edits and non-admin changes', () => {
  assert.equal(
    adminChangeBlockedReason({ ...activeAdminChange, nextIsActiveAdmin: true }),
    null
  )
  assert.equal(
    adminChangeBlockedReason({ ...activeAdminChange, targetIsActiveAdmin: false }),
    null
  )
})

function compile(relativePath: string): string {
  return ts.transpileModule(readFileSync(relativePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
}

type StoredUser = {
  id: string
  name: string
  email: string
  role: string
  isActive: boolean
}
type ActionResult = StoredUser & { _warning?: string }
type Actions = {
  createUser(input: { name: string; email: string; isAdmin: boolean }): Promise<ActionResult>
  updateUser(input: {
    id: string
    name: string
    email: string
    isAdmin?: boolean
  }): Promise<ActionResult>
  deactivateUser(id: string): Promise<{ success: boolean }>
}
type Call = { client: 'root' | 'transaction'; operation: string }
type CountWhere = { role: string; isActive: boolean; id: { not: string } }

// Execute the real actions and role helpers, faking only external boundaries.
// Distinct root/transaction clients catch writes or guard reads outside the transaction.
function loadUsersActions(actorId = 'actor') {
  const calls: Call[] = []
  const countQueries: CountWhere[] = []
  const transactionOptions: Array<{ isolationLevel: string }> = []
  const audits: Array<{ action: string; comments: string; userId: string }> = []
  const revalidated: string[] = []
  const stored: Record<string, StoredUser> = {
    target: {
      id: 'target',
      name: 'Target User',
      email: 'target@example.com',
      role: 'admin',
      isActive: true,
    },
  }
  function client(source: Call['client']) {
    return {
      user: {
        findUnique: async ({ where }: { where: { id?: string; email?: string } }) => {
          calls.push({ client: source, operation: 'findUnique' })
          const row = where.id
            ? stored[where.id]
            : Object.values(stored).find((user) => user.email === where.email)
          return row ? { ...row } : null
        },
        count: async ({ where }: { where: CountWhere }) => {
          calls.push({ client: source, operation: 'count' })
          countQueries.push(where)
          return Object.values(stored).filter(
            (user) =>
              user.role === where.role &&
              user.isActive === where.isActive &&
              user.id !== where.id.not
          ).length
        },
        create: async ({ data }: { data: Omit<StoredUser, 'id'> }) => {
          calls.push({ client: source, operation: 'create' })
          const row = { id: 'created', ...data }
          stored[row.id] = row
          return row
        },
        update: async ({ where, data }: { where: { id: string }; data: Partial<StoredUser> }) => {
          calls.push({ client: source, operation: 'update' })
          assert.ok(stored[where.id], `update on unknown user ${where.id}`)
          stored[where.id] = { ...stored[where.id], ...data }
          return { ...stored[where.id] }
        },
      },
      request_activities: {
        create: async ({ data }: { data: (typeof audits)[number] }) => {
          calls.push({ client: source, operation: 'audit' })
          audits.push(data)
          return data
        },
      },
    }
  }
  const tx = client('transaction')
  const prisma = {
    ...client('root'),
    $transaction: async (
      callback: (transaction: typeof tx) => Promise<unknown>,
      options: { isolationLevel: string }
    ) => {
      transactionOptions.push(options)
      return callback(tx)
    },
  }
  const roleExports: Record<string, unknown> = {}
  runInNewContext(compile('src/lib/user-role.ts'), { exports: roleExports })
  const dependencies: Record<string, unknown> = {
    bcryptjs: { hash: async () => 'hashed-password' },
    '@/lib/prisma': { default: prisma },
    '@/lib/auth': { requireAdmin: async () => actorId },
    '@/lib/auth-config': { auth: async () => null },
    '@/lib/user-role': roleExports,
    'next/cache': { revalidatePath: (path: string) => revalidated.push(path) },
  }
  const actions = {} as Actions
  runInNewContext(compile('src/server-actions/users.ts'), {
    exports: actions,
    console: { log: () => {} },
    require: (name: string) => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
      return dependencies[name]
    },
  })
  return { actions, calls, countQueries, transactionOptions, audits, revalidated, stored }
}

type Fixture = ReturnType<typeof loadUsersActions>
const updateInput = { id: 'target', name: 'Target User', email: 'target@example.com' }

function assertProtectedTransaction(state: Fixture, expectedWrites: number) {
  assert.equal(state.transactionOptions.length, 1, 'one transaction per action')
  assert.equal(state.transactionOptions[0].isolationLevel, 'Serializable')
  assert.equal(state.countQueries.length, 1)
  const where = state.countQueries[0]
  assert.equal(where.role, 'admin')
  assert.equal(where.isActive, true)
  assert.equal(where.id.not, 'target')
  assert.equal(state.calls.filter((call) => call.operation === 'update').length, expectedWrites)
  assert.ok(state.calls.every((call) => call.client === 'transaction'))
  const countIndex = state.calls.findIndex((call) => call.operation === 'count')
  const writeIndex = state.calls.findIndex((call) => call.operation === 'update')
  if (expectedWrites) assert.ok(countIndex < writeIndex, 'guard count must precede the write')
}

for (const action of ['updateUser', 'deactivateUser'] as const) {
  it(`users.ts ${action} rejects removal of the only active admin without writing`, async () => {
    const state = loadUsersActions()
    const operation = action === 'updateUser'
      ? state.actions.updateUser({ ...updateInput, isAdmin: false })
      : state.actions.deactivateUser('target')
    await assert.rejects(operation, { message: 'At least one active administrator is required' })
    assert.equal(state.stored.target.role, 'admin')
    assert.equal(state.stored.target.isActive, true)
    assert.deepEqual(state.audits, [])
    assert.deepEqual(state.revalidated, [])
    assertProtectedTransaction(state, 0)
  })

  it(`users.ts ${action} rejects self-removal even when another active admin exists`, async () => {
    const state = loadUsersActions('target')
    state.stored.other = { ...state.stored.target, id: 'other', email: 'other@example.com' }
    const operation = action === 'updateUser'
      ? state.actions.updateUser({ ...updateInput, isAdmin: false })
      : state.actions.deactivateUser('target')
    await assert.rejects(operation, { message: 'You cannot remove your own administrator access' })
    assert.deepEqual(state.audits, [])
    assert.deepEqual(state.revalidated, [])
    assertProtectedTransaction(state, 0)
  })

  it(`users.ts ${action} does not count inactive admins or legacy engineering users as other admins`, async () => {
    const state = loadUsersActions()
    state.stored.inactive = { ...state.stored.target, id: 'inactive', isActive: false }
    state.stored.legacy = { ...state.stored.target, id: 'legacy', role: 'engineering' }
    const operation = action === 'updateUser'
      ? state.actions.updateUser({ ...updateInput, isAdmin: false })
      : state.actions.deactivateUser('target')
    await assert.rejects(operation, { message: 'At least one active administrator is required' })
    assertProtectedTransaction(state, 0)
  })

  it(`users.ts ${action} permits removing another admin when one active admin remains`, async () => {
    const state = loadUsersActions()
    state.stored.actor = { ...state.stored.target, id: 'actor', email: 'actor@example.com' }
    if (action === 'updateUser') {
      const result = await state.actions.updateUser({ ...updateInput, isAdmin: false })
      assert.equal(result.role, 'general_dept')
      assert.equal(result._warning, 'User must re-login for role change to take effect.')
      assert.equal(state.audits.length, 1)
      assert.equal(state.audits[0].action, 'user_admin_changed')
      assert.equal(state.audits[0].userId, 'actor')
      assert.equal(state.audits[0].comments, 'Updated user target: role: "admin" → "general_dept"')
    } else {
      assert.equal((await state.actions.deactivateUser('target')).success, true)
      assert.equal(state.stored.target.isActive, false)
    }
    assert.equal(state.stored.actor.role, 'admin')
    assert.equal(state.stored.actor.isActive, true)
    assert.deepEqual(state.revalidated, ['/admin/users'])
    assertProtectedTransaction(state, 1)
  })
}

for (const isAdmin of [true, false]) {
  it(`users.ts createUser with isAdmin ${isAdmin} writes the canonical role`, async () => {
    const state = loadUsersActions()
    const result = await state.actions.createUser({
      name: 'New User', email: 'new@example.com', isAdmin,
    })
    assert.equal(result.role, isAdmin ? 'admin' : 'general_dept')
    assert.equal(state.stored.created.role, isAdmin ? 'admin' : 'general_dept')
    assert.equal(state.calls.filter((call) => call.operation === 'create').length, 1)
    assert.deepEqual(state.revalidated, ['/admin/users'])
  })
}

for (const isAdmin of [undefined, true]) {
  it(`users.ts updateUser permits a sole admin's name-only edit with isAdmin ${isAdmin}`, async () => {
    const state = loadUsersActions('target')
    const result = await state.actions.updateUser({ ...updateInput, name: 'Updated Name', isAdmin })
    assert.equal(result.name, 'Updated Name')
    assert.equal(result.role, 'admin')
    assert.equal(result._warning, undefined)
    assert.equal(state.audits.length, 1)
    assert.equal(state.audits[0].comments, 'Updated user target: name: "Target User" → "Updated Name"')
    assertProtectedTransaction(state, 1)
  })
}

it('users.ts updateUser without isAdmin preserves a legacy engineering role', async () => {
  const state = loadUsersActions()
  state.stored.target.role = 'engineering'
  const result = await state.actions.updateUser({ ...updateInput, name: 'Updated Name' })
  assert.equal(result.role, 'engineering')
  assert.equal(state.stored.target.role, 'engineering')
  assert.equal(result._warning, undefined)
  assert.equal(state.audits.length, 1)
  assertProtectedTransaction(state, 1)
})

it('users.ts updateUser with isAdmin false stores general_dept for a legacy engineering user', async () => {
  const state = loadUsersActions()
  state.stored.target.role = 'engineering'
  const result = await state.actions.updateUser({ ...updateInput, isAdmin: false })
  assert.equal(result.role, 'general_dept')
  assert.equal(result._warning, 'User must re-login for role change to take effect.')
  assertProtectedTransaction(state, 1)
})

it('users.ts deactivateUser permits deactivating a non-admin without another active admin', async () => {
  const state = loadUsersActions()
  state.stored.target.role = 'general_dept'
  await state.actions.deactivateUser('target')
  assert.equal(state.stored.target.isActive, false)
  assertProtectedTransaction(state, 1)
})
