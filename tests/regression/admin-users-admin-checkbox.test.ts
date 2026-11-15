import { it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const formPath = 'src/components/admin/user-form.tsx'
const form = readFileSync(formPath, 'utf8')
const table = readFileSync('src/components/admin/user-table.tsx', 'utf8')
const editDialog = readFileSync('src/components/admin/edit-user-dialog.tsx', 'utf8')

it('user-form.tsx replaces the role dropdown with the approved Administrator copy and boolean schema', () => {
  assert.match(form, /<FormLabel>Administrator<\/FormLabel>/)
  assert.match(form, /<FormDescription>Can open the Admin area\.<\/FormDescription>/)
  assert.match(form, /isAdmin: z\.boolean\(\)/)
  assert.doesNotMatch(form, /General Department User|Engineering User|SelectItem|role:|name="role"/)
})

it('user-form.tsx defaults new users to unchecked and binds the existing Checkbox to isAdmin', () => {
  assert.match(form, /defaultValues: initialData \|\| \{[^}]*isAdmin: false,/)
  assert.match(form, /import \{ Checkbox \} from '@\/components\/ui\/checkbox'/)
  assert.match(form, /name="isAdmin"[\s\S]*?<Checkbox[\s\S]*?checked=\{field\.value\}/)
  assert.match(form, /onCheckedChange=\{\(checked\) => field\.onChange\(checked === true\)\}/)
})

it('user-form.tsx subscribes to dirtyFields during render so untouched legacy roles stay unchanged', () => {
  assert.match(form, /const \{ dirtyFields \} = form\.formState/)
})

it('user-table.tsx shows Admin or empty for both desktop and mobile, using isAdminRole', () => {
  assert.doesNotMatch(table, /General Dept|Engineering/)
  assert.match(table, /import \{ isAdminRole \} from '@\/lib\/user-role'/)
  assert.match(table, /cell: \(\{ row \}\) => isAdminRole\(row\.original\.role\) \? 'Admin' : ''/)
  assert.match(table, /value: isAdminRole\(user\.role\) \? 'Admin' : ''/)
})

it('edit-user-dialog.tsx accepts isAdmin and user-table.tsx derives it from the stored role', () => {
  assert.doesNotMatch(editDialog, /'general_dept'|role:/)
  assert.match(editDialog, /isAdmin: boolean/)
  assert.match(editDialog, /isAdmin: user\.isAdmin/)
  assert.match(table, /isAdmin: isAdminRole\(data\.find\(u => u\.id === editingUserId\)!\.role\)/)
})

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? sourceFiles(path) : [path]
  })
}

it('the three-value UserRole union appears only in src/lib/user-role.ts under src/', () => {
  const union = /['"]admin['"]\s*\|\s*['"]general_dept['"]\s*\|\s*['"]engineering['"]/
  const definitions = sourceFiles('src').filter((path) => union.test(readFileSync(path, 'utf8')))
  assert.deepEqual(definitions, ['src/lib/user-role.ts'])
})

type FormData = { name: string; email: string; isAdmin: boolean; password?: string }

// Run the real submit handler with only its external boundaries stubbed.
function loadSubmit(initialData?: FormData & { id: string }, dirtyIsAdmin = false, failure?: Error) {
  const source = ts.createSourceFile(formPath, form, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let handler: ts.FunctionDeclaration | undefined
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'onSubmit') handler = node
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(handler, 'UserForm must have its submit handler')
  const compiled = ts.transpileModule(handler.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  const calls: Array<{ action: string; input: Record<string, unknown> }> = []
  const errors: Array<string | null> = []
  let successes = 0
  const action = (name: string) => async (input: Record<string, unknown>) => {
    calls.push({ action: name, input: { ...input } })
    if (failure) throw failure
  }
  const submit: (data: FormData) => Promise<void> = runInNewContext(`${compiled}\nonSubmit`, {
    initialData,
    dirtyFields: { isAdmin: dirtyIsAdmin },
    createUser: action('create'),
    updateUser: action('update'),
    setIsSubmitting: () => {},
    setError: (error: string | null) => errors.push(error),
    onSuccess: () => successes++,
    Error,
  })
  return { submit, calls, errors, successes: () => successes }
}

const user = { name: 'Test User', email: 'test@example.com', isAdmin: false }

for (const isAdmin of [false, true]) {
  it(`user-form.tsx creates users with isAdmin ${isAdmin}`, async () => {
    const state = loadSubmit()
    await state.submit({ ...user, isAdmin, password: 'password123' })
    assert.deepEqual(state.calls, [{
      action: 'create',
      input: { ...user, isAdmin, password: 'password123' },
    }])
    assert.equal(state.successes(), 1)
  })

  it(`user-form.tsx omits untouched isAdmin ${isAdmin} on edit (preserving legacy engineering)`, async () => {
    const state = loadSubmit({ ...user, id: 'target', isAdmin })
    await state.submit({ ...user, name: 'Updated Name', isAdmin })
    assert.deepEqual(state.calls, [{
      action: 'update',
      input: { id: 'target', name: 'Updated Name', email: user.email },
    }])
    assert.equal(state.successes(), 1)
  })

  it(`user-form.tsx sends explicitly changed isAdmin ${isAdmin} on edit`, async () => {
    const state = loadSubmit({ ...user, id: 'target', isAdmin: !isAdmin }, true)
    await state.submit({ ...user, isAdmin })
    assert.deepEqual(state.calls, [{
      action: 'update',
      input: { id: 'target', ...user, isAdmin },
    }])
  })
}

for (const message of [
  'You cannot remove your own administrator access',
  'At least one active administrator is required',
]) {
  it(`user-form.tsx displays the server guard message: ${message}`, async () => {
    const state = loadSubmit({ ...user, id: 'target', isAdmin: true }, true, new Error(message))
    await state.submit(user)
    assert.equal(state.errors.at(-1), message)
    assert.equal(state.successes(), 0)
    assert.match(form, /\{error && \([\s\S]*?\{error\}/)
  })
}
