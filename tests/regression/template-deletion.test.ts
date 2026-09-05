import { it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { z } from 'zod'

// Execute the real server actions with database/auth/cache boundaries replaced.
const compiled = ts.transpileModule(readFileSync('src/server-actions/templates.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function fixture(options: { isDefault?: boolean; isActive?: boolean; authorized?: boolean; missing?: boolean } = {}) {
  let row = options.missing ? null : {
    id: 'template-1', name: 'Test', title: 'Test template', description: '<p>Example</p>',
    isDefault: options.isDefault ?? false, isActive: options.isActive ?? true,
    createdAt: new Date(), updatedAt: new Date(),
  }
  const revalidated: string[] = []
  const prisma = { templates: {
    findUnique: async ({ where }: { where: { id: string } }) => row?.id === where.id ? row : null,
    update: async ({ where, data }: { where: { id: string }; data: { isActive: boolean } }) => {
      assert.equal(where.id, row?.id)
      row = { ...row!, ...data }
      return row
    },
    delete: async ({ where }: { where: { id: string } }) => {
      assert.equal(where.id, row?.id)
      const deleted = row
      row = null
      return deleted
    },
  } }
  const dependencies: Record<string, unknown> = {
    '@/lib/prisma': { default: prisma },
    '@/lib/auth': { requireAdmin: async () => {
      if (options.authorized === false) throw new Error('Unauthorized')
      return 'admin-1'
    } },
    'next/cache': { revalidatePath: (path: string) => revalidated.push(path) },
    zod: { z },
    '@/lib/schemas/solution-schemas': { descriptionSchema: z.string() },
    '@/lib/inline-images/references': {},
  }
  const exports: Record<string, (id: string) => Promise<unknown>> = {}
  runInNewContext(compiled, { exports, require: (name: string) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
    return dependencies[name]
  } })
  return { actions: exports, row: () => row, revalidated }
}

for (const isActive of [true, false]) {
  it(`deletes an ${isActive ? 'active' : 'inactive'} non-default template completely`, async () => {
    const state = fixture({ isActive })
    await state.actions.deleteTemplate('template-1')
    assert.equal(state.row(), null)
    assert.deepEqual(state.revalidated, ['/admin/templates'])
  })
}

it('deactivation keeps the template and allows reactivation', async () => {
  const state = fixture()
  await state.actions.toggleTemplateStatus('template-1')
  assert.equal(state.row()?.isActive, false)
  await state.actions.toggleTemplateStatus('template-1')
  assert.equal(state.row()?.isActive, true)
})

it('rejects deleting the default template', async () => {
  const state = fixture({ isDefault: true })
  await assert.rejects(state.actions.deleteTemplate('template-1'), /Cannot delete the default template/)
  assert.equal(state.row()?.isDefault, true)
  assert.deepEqual(state.revalidated, [])
})

it('rejects unauthorized deletion without changing the template', async () => {
  const state = fixture({ authorized: false })
  await assert.rejects(state.actions.deleteTemplate('template-1'), /Unauthorized/)
  assert.equal(state.row()?.isActive, true)
})

it('reports a missing template', async () => {
  const state = fixture({ missing: true })
  await assert.rejects(state.actions.deleteTemplate('template-1'), /Template not found/)
  assert.deepEqual(state.revalidated, [])
})
