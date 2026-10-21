import { it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { z } from 'zod'

// Executes the real src/lib/auth.ts and the real admin server actions with
// only the true boundaries faked (session, role row, data prisma, bcrypt).
// Server Actions must deny on their own before any data read/write; layout
// redirects do not protect direct action POSTs.

function compile(relativePath: string): string {
  return ts.transpileModule(readFileSync(relativePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
}

type Persona = {
  name: string
  sessionUserId: string | null
  dbUser: { role: string; isActive: boolean } | null
}

const denialPersonas: Persona[] = [
  { name: 'anonymous', sessionUserId: null, dbUser: null },
  {
    name: 'authenticated non-admin (general_dept)',
    sessionUserId: 'session-user-1',
    dbUser: { role: 'general_dept', isActive: true },
  },
  {
    name: 'authenticated non-admin (engineering)',
    sessionUserId: 'session-user-1',
    dbUser: { role: 'engineering', isActive: true },
  },
  {
    name: 'inactive admin',
    sessionUserId: 'session-user-1',
    dbUser: { role: 'admin', isActive: false },
  },
]

const adminPersona: Persona = {
  name: 'active admin',
  sessionUserId: 'admin-session-1',
  dbUser: { role: 'admin', isActive: true },
}

// The real requireAdmin, executed against a faked session and role row so
// denial comes from the documented nullable contract, not a throwing stub.
function loadRealAuth(persona: Persona, roleLookups: number[]): Record<string, unknown> {
  const authExports: Record<string, unknown> = {}
  runInNewContext(compile('src/lib/auth.ts'), {
    exports: authExports,
    require: (name: string) => {
      if (name === '@/lib/auth-config') {
        return {
          auth: async () =>
            persona.sessionUserId ? { user: { id: persona.sessionUserId } } : null,
        }
      }
      if (name === '@/lib/prisma') {
        return {
          default: {
            user: {
              findUnique: async () => {
                roleLookups.push(1)
                return persona.dbUser
              },
            },
          },
        }
      }
      throw new Error(`Unexpected auth dependency: ${name}`)
    },
  })
  return authExports
}

type Tracked = { model: string; op: string }
type Actions = Record<string, (...args: unknown[]) => Promise<unknown>>

type UsersFixture = {
  actions: Actions
  actionCalls: Tracked[]
  hashed: Array<{ password: string; rounds: number }>
  revalidated: string[]
  roleLookups: number[]
  stored: Record<
    string,
    {
      id: string
      name: string
      email: string
      role: string
      isActive: boolean
      passwordHash: string | null
      forcePasswordChange: boolean
    }
  >
}

function loadUsersActions(persona: Persona): UsersFixture {
  const actionCalls: Tracked[] = []
  const hashed: Array<{ password: string; rounds: number }> = []
  const revalidated: string[] = []
  const roleLookups: number[] = []
  const stored: UsersFixture['stored'] = {
    'target-user': {
      id: 'target-user',
      name: 'Target User',
      email: 'target@example.com',
      role: 'general_dept',
      isActive: true,
      passwordHash: 'old-hash',
      forcePasswordChange: false,
    },
    'other-user': {
      id: 'other-user',
      name: 'Other User',
      email: 'other@example.com',
      role: 'engineering',
      isActive: true,
      passwordHash: 'old-hash',
      forcePasswordChange: false,
    },
  }
  const prisma = {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        actionCalls.push({ model: 'user', op: 'findUnique' })
        const row = stored[where.id]
        return row ? { ...row, organizationAssignments: [] } : null
      },
      findMany: async () => {
        actionCalls.push({ model: 'user', op: 'findMany' })
        return Object.values(stored).map((row) => ({ ...row, organizationAssignments: [] }))
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string }
        data: Record<string, unknown>
      }) => {
        actionCalls.push({ model: 'user', op: 'update' })
        const row = stored[where.id]
        assert.ok(row, `update on unknown user ${where.id}`)
        const next = { ...row, ...data } as UsersFixture['stored'][string]
        stored[where.id] = next
        return { ...next, organizationAssignments: [] }
      },
    },
  }
  const dependencies: Record<string, unknown> = {
    bcryptjs: {
      hash: async (password: string, rounds: number) => {
        hashed.push({ password, rounds })
        return `hashed(${password})`
      },
      compare: async () => true,
    },
    '@/lib/prisma': { default: prisma },
    '@/lib/auth': loadRealAuth(persona, roleLookups),
    '@/lib/auth-config': { auth: async () => null },
    'next/cache': { revalidatePath: (path: string) => revalidated.push(path) },
  }
  const actions: Actions = {}
  runInNewContext(compile('src/server-actions/users.ts'), {
    exports: actions,
    require: (name: string) => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
      return dependencies[name]
    },
  })
  return { actions, actionCalls, hashed, revalidated, roleLookups, stored }
}

type UsersInvoker = [
  string,
  (actions: Actions) => Promise<unknown>,
]

const usersInvokers: UsersInvoker[] = [
  ['getUsers', (a) => a.getUsers()],
  ['getUser', (a) => a.getUser('target-user')],
  ['deactivateUser', (a) => a.deactivateUser('target-user')],
  ['activateUser', (a) => a.activateUser('target-user')],
  ['resetUserPassword', (a) => a.resetUserPassword('target-user', 'NewPass123!')],
]

for (const persona of denialPersonas) {
  for (const [actionName, invoke] of usersInvokers) {
    it(`users.ts ${actionName} denies ${persona.name} before any read, write, or hashing`, async () => {
      const state = loadUsersActions(persona)
      await assert.rejects(invoke(state.actions), /Admin authorization is required/)
      assert.deepEqual(
        state.actionCalls,
        [],
        `${actionName} must not touch the database after denial`
      )
      assert.deepEqual(state.hashed, [], `${actionName} must not hash a password after denial`)
      assert.deepEqual(state.revalidated, [], `${actionName} must not revalidate after denial`)
      assert.equal(
        state.stored['target-user'].passwordHash,
        'old-hash',
        'target password must be unchanged after denial'
      )
      assert.equal(state.stored['target-user'].isActive, true)
      assert.equal(
        state.roleLookups.length,
        persona.sessionUserId ? 1 : 0,
        'the real requireAdmin role check executed its documented path'
      )
    })
  }
}

it('users.ts getUsers returns users for an active admin', async () => {
  const state = loadUsersActions(adminPersona)
  const users = (await state.actions.getUsers()) as Array<{ id: string }>
  assert.deepEqual(
    users.map((u) => u.id).sort(),
    ['other-user', 'target-user']
  )
})

it('users.ts getUser returns the requested user for an active admin', async () => {
  const state = loadUsersActions(adminPersona)
  const user = (await state.actions.getUser('target-user')) as { id: string; department: unknown }
  assert.equal(user.id, 'target-user')
  assert.equal(user.department, null)
})

it('users.ts resetUserPassword hashes and updates only when authorized', async () => {
  const state = loadUsersActions(adminPersona)
  const result = (await state.actions.resetUserPassword('target-user', 'NewPass123!')) as {
    success: boolean
  }
  assert.equal(result.success, true)
  assert.deepEqual(state.hashed, [{ password: 'NewPass123!', rounds: 12 }])
  assert.equal(state.stored['target-user'].passwordHash, 'hashed(NewPass123!)')
  assert.equal(state.stored['target-user'].forcePasswordChange, true)
  assert.deepEqual(state.revalidated, ['/admin/users'])
})

it('users.ts deactivateUser and activateUser mutate only when authorized', async () => {
  const state = loadUsersActions(adminPersona)
  await state.actions.deactivateUser('target-user')
  assert.equal(state.stored['target-user'].isActive, false)
  await state.actions.activateUser('target-user')
  assert.equal(state.stored['target-user'].isActive, true)
})

type TemplatesFixture = {
  actions: Actions
  actionCalls: Tracked[]
  revalidated: string[]
  roleLookups: number[]
  defaultsUnset: number[]
  template: () => Record<string, unknown> | null
}

function loadTemplatesActions(persona: Persona): TemplatesFixture {
  const actionCalls: Tracked[] = []
  const revalidated: string[] = []
  const roleLookups: number[] = []
  const defaultsUnset: number[] = []
  let template: Record<string, unknown> | null = {
    id: 'template-1',
    name: 'Test',
    title: 'Test template',
    description: '<p>Example</p>',
    isDefault: false,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  const prisma = {
    templates: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        actionCalls.push({ model: 'templates', op: 'findUnique' })
        return template && template.id === where.id ? { ...template } : null
      },
      findMany: async () => {
        actionCalls.push({ model: 'templates', op: 'findMany' })
        return template ? [{ ...template }] : []
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string }
        data: Record<string, unknown>
      }) => {
        actionCalls.push({ model: 'templates', op: 'update' })
        assert.ok(template, 'update on missing template')
        assert.equal(where.id, template.id)
        template = { ...template, ...data }
        return { ...template }
      },
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        actionCalls.push({ model: 'templates', op: 'updateMany' })
        if (data.isDefault === false) defaultsUnset.push(1)
        return { count: 1 }
      },
      delete: async ({ where }: { where: { id: string } }) => {
        actionCalls.push({ model: 'templates', op: 'delete' })
        assert.ok(template, 'delete on missing template')
        assert.equal(where.id, template.id)
        const removed = template
        template = null
        return removed
      },
    },
    $transaction: async (operations: unknown) => {
      actionCalls.push({ model: '$transaction', op: 'batch' })
      assert.ok(Array.isArray(operations), 'expected array-form $transaction')
      return Promise.all(operations as Promise<unknown>[])
    },
  }
  const dependencies: Record<string, unknown> = {
    '@/lib/prisma': { default: prisma },
    '@/lib/auth': loadRealAuth(persona, roleLookups),
    'next/cache': { revalidatePath: (path: string) => revalidated.push(path) },
    zod: { z },
    '@/lib/schemas/solution-schemas': { descriptionSchema: z.string() },
    '@/lib/inline-images/references': {},
  }
  const actions: Actions = {}
  runInNewContext(compile('src/server-actions/templates.ts'), {
    exports: actions,
    require: (name: string) => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
      return dependencies[name]
    },
  })
  return { actions, actionCalls, revalidated, roleLookups, defaultsUnset, template: () => template }
}

type TemplatesInvoker = [string, (actions: Actions) => Promise<unknown>]

const templatesInvokers: TemplatesInvoker[] = [
  ['getTemplates', (a) => a.getTemplates()],
  ['getTemplate', (a) => a.getTemplate('template-1')],
  ['toggleTemplateStatus', (a) => a.toggleTemplateStatus('template-1')],
  ['setTemplateDefault', (a) => a.setTemplateDefault('template-1')],
  ['deleteTemplate', (a) => a.deleteTemplate('template-1')],
]

for (const persona of denialPersonas) {
  for (const [actionName, invoke] of templatesInvokers) {
    it(`templates.ts ${actionName} denies ${persona.name} before any read or write`, async () => {
      const state = loadTemplatesActions(persona)
      await assert.rejects(invoke(state.actions), /Unauthorized/)
      assert.deepEqual(
        state.actionCalls,
        [],
        `${actionName} must not touch the database after denial`
      )
      assert.deepEqual(state.revalidated, [], `${actionName} must not revalidate after denial`)
      assert.ok(state.template(), 'template must be untouched after denial')
      assert.equal(state.template()?.isActive, true)
      assert.equal(
        state.roleLookups.length,
        persona.sessionUserId ? 1 : 0,
        'the real requireAdmin role check executed its documented path'
      )
    })
  }
}

it('templates.ts getTemplates returns templates for an active admin', async () => {
  const state = loadTemplatesActions(adminPersona)
  const templates = (await state.actions.getTemplates()) as Array<{ id: string }>
  assert.deepEqual(templates.map((t) => t.id), ['template-1'])
})

it('templates.ts getTemplate returns the template for an active admin', async () => {
  const state = loadTemplatesActions(adminPersona)
  const template = (await state.actions.getTemplate('template-1')) as { id: string }
  assert.equal(template.id, 'template-1')
})

it('templates.ts toggleTemplateStatus flips status only when authorized', async () => {
  const state = loadTemplatesActions(adminPersona)
  await state.actions.toggleTemplateStatus('template-1')
  assert.equal(state.template()?.isActive, false)
  await state.actions.toggleTemplateStatus('template-1')
  assert.equal(state.template()?.isActive, true)
  assert.deepEqual(state.revalidated, ['/admin/templates', '/admin/templates'])
})

it('templates.ts setTemplateDefault unsets other defaults only when authorized', async () => {
  const state = loadTemplatesActions(adminPersona)
  await state.actions.setTemplateDefault('template-1')
  assert.equal(state.template()?.isDefault, true)
  assert.equal(state.defaultsUnset.length, 1)
  assert.deepEqual(state.revalidated, ['/admin/templates'])
})

it('templates.ts deleteTemplate removes the template only when authorized', async () => {
  const state = loadTemplatesActions(adminPersona)
  await state.actions.deleteTemplate('template-1')
  assert.equal(state.template(), null)
  assert.deepEqual(state.revalidated, ['/admin/templates'])
})
