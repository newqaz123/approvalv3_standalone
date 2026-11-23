import { createTranslator } from '../../src/lib/i18n/messages'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import ts from 'typescript'

// Execute the real picker and its handlers, replacing only hooks, UI primitives,
// and server/toast boundaries. Re-render after events to observe state changes.
function pickerHarness() {
  const states: unknown[] = []
  let cursor = 0
  let pending: Promise<unknown> = Promise.resolve()
  let tree: ReactNode
  const submissions: Array<{ requestId: string; ids: string[] }> = []
  const errors: string[] = []
  const dependencies: Record<string, unknown> = {
    react: {
      useState<T>(initial: T) {
        const index = cursor++
        if (!(index in states)) states[index] = initial
        return [states[index], (next: T | ((previous: T) => T)) => {
          states[index] = typeof next === 'function' ? (next as (previous: T) => T)(states[index] as T) : next
        }]
      },
      useTransition: () => [false, (callback: () => Promise<unknown>) => { pending = callback() }],
    },
    'react/jsx-runtime': jsxRuntime,
    'lucide-react': { Check: 'check-icon', Users: 'users-icon', Loader2: 'loader-icon', X: 'remove-icon' },
    '@/components/ui/button': { Button: 'button' },
    '@/components/ui/badge': { Badge: 'badge' },
    '@/components/ui/popover': { Popover: 'popover', PopoverContent: 'popover-content', PopoverTrigger: 'popover-trigger' },
    '@/components/ui/command': {
      Command: 'command', CommandEmpty: 'command-empty', CommandGroup: 'command-group',
      CommandInput: 'command-input', CommandItem: 'command-item',
    },
    '@/lib/i18n/client': { useTranslations: () => createTranslator('en') },
    '@/lib/utils': { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') },
    '@/server-actions/requests': {
      async assignEngineers(requestId: string, ids: string[]) {
        submissions.push({ requestId, ids: Array.from(ids) })
        return { success: true }
      },
    },
    sonner: { toast: { success: () => {}, error: (message: string) => errors.push(message) } },
  }
  const compiled = ts.transpileModule(readFileSync('src/components/engineering/engineer-pic-picker.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const component = {} as { EngineerPicPicker(props: Record<string, unknown>): ReactNode }
  runInNewContext(compiled, {
    exports: component,
    require: (name: string) => {
      assert.ok(name in dependencies, `Unexpected picker dependency: ${name}`)
      return dependencies[name]
    },
  })
  function render() {
    cursor = 0
    tree = component.EngineerPicPicker({
      requestId: 'request', currentUserId: 'worker',
      engineeringUsers: [{ id: 'direct', name: 'Eligible Worker', email: 'eligible@example.com' }],
      initialAssignedUsers: [{ id: 'legacy', name: 'Legacy Engineer' }],
    })
  }
  function elements(node: ReactNode): Array<ReactElement<Record<string, unknown>>> {
    if (Array.isArray(node)) return node.flatMap((child) => elements(child))
    if (!isValidElement<Record<string, unknown>>(node)) return []
    return [node, ...elements(node.props.children as ReactNode)]
  }
  function text(node: ReactNode): string {
    if (node == null || typeof node === 'boolean') return ''
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(text).join(' ')
    return isValidElement<{ children?: ReactNode }>(node) ? text(node.props.children) : ''
  }
  function button(label: string) {
    const found = elements(tree).find((node) => node.type === 'button' && (node.props['aria-label'] === label || text(node).trim() === label))
    assert.ok(found, `Missing button ${label}`)
    return found
  }
  render()
  return {
    submissions,
    triggerText: () => text(elements(tree).find((node) => node.type === 'popover-trigger')),
    candidates: () => elements(tree).filter((node) => node.type === 'command-item').map((node) => node.props.value),
    removeLegacy() { (button('Remove Legacy Engineer').props.onClick as () => void)(); render() },
    addEligible() {
      const option = elements(tree).find((node) => node.type === 'command-item' && node.props.value === 'direct')
      assert.ok(option)
      ;(option.props.onSelect as () => void)()
      render()
    },
    async save() {
      ;(button('Save').props.onClick as () => void)()
      await pending
      assert.deepEqual(errors, [])
    },
  }
}

describe('EngineerPicPicker preserves visible, removable stored PICs separately from new candidates', () => {
  it('shows a legacy PIC by name and submits it alongside a new eligible PIC when retained', async () => {
    const picker = pickerHarness()
    assert.match(picker.triggerText(), /Legacy/)
    assert.doesNotMatch(picker.triggerText(), /Assign PIC/)
    assert.deepEqual(picker.candidates(), ['direct'])
    picker.addEligible()
    await picker.save()
    assert.deepEqual(picker.submissions, [{ requestId: 'request', ids: ['legacy', 'direct'] }])
  })

  it('removes a legacy PIC without offering it as a new candidate', async () => {
    const picker = pickerHarness()
    picker.removeLegacy()
    assert.match(picker.triggerText(), /Assign PIC/)
    assert.deepEqual(picker.candidates(), ['direct'])
    await picker.save()
    assert.deepEqual(picker.submissions, [{ requestId: 'request', ids: [] }])
  })

  it('replaces a legacy PIC with an eligible PIC without submitting a hidden id', async () => {
    const picker = pickerHarness()
    picker.removeLegacy()
    picker.addEligible()
    assert.deepEqual(picker.candidates(), ['direct'])
    await picker.save()
    assert.deepEqual(picker.submissions, [{ requestId: 'request', ids: ['direct'] }])
  })

  it('receives stored assignee names already loaded by its dashboard caller', () => {
    const source = readFileSync('src/components/engineering/engineering-dashboard-tabs.tsx', 'utf8')
    assert.match(source, /initialAssignedUsers=\{request\.assignedEngineers\}/)
  })
})
