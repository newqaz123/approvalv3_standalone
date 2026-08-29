/**
 * Static-render harness for the inline-image form-wiring behavior tests.
 *
 * The six authoring surfaces create their coordinator through
 * `useInlineDescriptionImages()` internally, so observable blocking behavior is
 * produced by intercepting that module (plus the submit-boundary modules the
 * surfaces call into) at the CommonJS require level and rendering each real
 * form component with `renderToStaticMarkup`. tsx compiles this package's TS to
 * CommonJS, so `Module._load` interception is the one interception point every
 * form import flows through.
 *
 * The harness intentionally stubs only the coordinator *seam* (the hook that
 * manufactures it) and the network/submit boundary (server actions, toasts).
 * `inlineImageBlockingMessage` stays the real production copy, and every form
 * component, button, form, and dialog below is the real implementation.
 */
import { createElement, isValidElement, type ReactNode } from 'react'
import * as React from 'react'
import Module from 'node:module'
import { renderToStaticMarkup } from 'react-dom/server'

export type StubbedBlockingReason = 'upload' | 'image-edit' | null

export type ActionCall = { action: string; payload: unknown }

export type CapturedButton = {
  label: string
  disabled: boolean | undefined
  type: string | undefined
  onClick: (() => unknown) | undefined
}

export type CapturedNativeForm = {
  onSubmit: ((event?: { preventDefault?: () => void }) => unknown) | undefined
  formApi: Record<string, unknown> & {
    setValue?: (name: string, value: unknown) => void
  }
}

export type CapturedDialogTree = {
  open: boolean
  texts: string[]
  buttons: CapturedButton[]
  nativeForm: CapturedNativeForm | null
}

const { AppRouterContext } = createNextInternals()

function createNextInternals(): { AppRouterContext: React.Context<unknown> } {
  // Imported through require so tsc does not need types for Next's internal
  // shared runtime; the context object is only used as a provider carrier.
  const requireNext = createHarnessRequire()
  const shared = requireNext('next/dist/shared/lib/app-router-context.shared-runtime') as {
    AppRouterContext: React.Context<unknown>
  }
  return { AppRouterContext: shared.AppRouterContext }
}

function createHarnessRequire() {
  // In the tsx CommonJS compilation this file has a native require.
  return typeof require === 'function'
    ? require
    : (Module.createRequire as unknown as (id: string) => NodeRequire)(__filename)
}

type ModuleOverrides = Record<string, Record<string, unknown>>

type HarnessState = {
  coordinatorReason: StubbedBlockingReason
  buttons: CapturedButton[]
  nativeForms: CapturedNativeForm[]
  dialogTrees: CapturedDialogTree[]
  actionCalls: ActionCall[]
  toasts: Array<{ kind: string; message: string }>
}

const state: HarnessState = {
  coordinatorReason: null,
  buttons: [],
  nativeForms: [],
  dialogTrees: [],
  actionCalls: [],
  toasts: [],
}

const originalLoad = (Module as unknown as { _load: (...args: unknown[]) => unknown })._load
type LoadFn = (this: unknown, request: string, parent: unknown, isMain: boolean) => unknown

function loadReal<T = unknown>(request: string): T {
  return originalLoad.apply(Module, [request, undefined, false]) as T
}

/** Recursively collects readable text from a constructed React element tree. */
export function collectTexts(node: ReactNode, into: string[] = []): string[] {
  if (node == null || typeof node === 'boolean') return into
  if (typeof node === 'string' || typeof node === 'number') {
    into.push(String(node))
    return into
  }
  if (Array.isArray(node)) {
    for (const child of node) collectTexts(child, into)
    return into
  }
  if (isValidElement(node)) {
    collectTexts((node.props as { children?: ReactNode }).children, into)
  }
  return into
}

function firstNativeForm(node: ReactNode): CapturedNativeForm | null {
  if (!isValidElement(node)) return null
  if (node.type === 'form') {
    const props = node.props as {
      onSubmit?: CapturedNativeForm['onSubmit']
      children?: ReactNode
    }
    return { onSubmit: props.onSubmit, formApi: {} }
  }
  const children = (node.props as { children?: ReactNode }).children
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = firstNativeForm(child)
      if (found) return found
    }
  } else {
    return firstNativeForm(children)
  }
  return null
}

/**
 * Walks a constructed React element tree collecting the submit-relevant
 * controls. Radix dialogs render their content through portals, which static
 * rendering skips, so the dialog tree (fully constructed during render) is the
 * observable surface for modal-based forms.
 */
function walkControlTree(
  node: ReactNode,
  realButton: unknown,
  into: { texts: string[]; buttons: CapturedButton[]; nativeForm: CapturedNativeForm | null },
): void {
  if (node == null || typeof node === 'boolean') return
  if (Array.isArray(node)) {
    for (const child of node) walkControlTree(child, realButton, into)
    return
  }
  if (typeof node === 'string' || typeof node === 'number') {
    into.texts.push(String(node))
    return
  }
  if (!isValidElement(node)) return
  const props = node.props as {
    children?: ReactNode
    disabled?: boolean
    type?: string
    onClick?: () => unknown
    onSubmit?: CapturedNativeForm['onSubmit']
  }
  if (node.type === 'form') {
    if (!into.nativeForm) into.nativeForm = { onSubmit: props.onSubmit, formApi: {} }
  } else if (node.type === realButton) {
    into.buttons.push({
      label: collectTexts(props.children).join(' ').trim(),
      disabled: props.disabled,
      type: props.type,
      onClick: props.onClick,
    })
  }
  walkControlTree(props.children, realButton, into)
}

function makeStubCoordinator(reason: StubbedBlockingReason): Record<string, unknown> {
  return {
    uploadSessionId: 'stub-inline-session',
    upload: async () => {
      throw new Error('stub coordinator transport must not be used by forms')
    },
    remove: async () => undefined,
    beginImageEdit: () => undefined,
    endImageEdit: () => undefined,
    hasBlockingUploads: reason === 'upload',
    hasActiveImageEdits: reason === 'image-edit',
    hasBlockingOperations: reason !== null,
    blockingReason: reason,
    reset: async () => undefined,
    clear: () => undefined,
  }
}

type ActionStubConfig = Record<string, Record<string, unknown>>

/**
 * Installs the interception seam. `actionResults` maps action-module specifier
 * -> action name -> resolved value for every stubbed server action.
 */
export function installFormHarness(options: {
  actionStubs: ActionStubConfig
  actionResults?: Record<string, Record<string, unknown>>
  forceDialogsOpen?: boolean
}): void {
  const { actionStubs, actionResults = {}, forceDialogsOpen = false } = options

  // Classic JSX runtime: the client components compile to React.createElement
  // and rely on the Next bundler to provide React. Provide it globally.
  ;(globalThis as unknown as Record<string, unknown>).React = React

  const realHookModule = loadReal<Record<string, unknown>>('@/hooks/use-inline-description-images')
  const hookStub: Record<string, unknown> = {
    __esModule: true,
    ...realHookModule,
    useInlineDescriptionImages: () => makeStubCoordinator(state.coordinatorReason),
  }

  const overrides: ModuleOverrides = {
    '@/hooks/use-inline-description-images': hookStub,
  }

  for (const [specifier, actions] of Object.entries(actionStubs)) {
    const namespace: Record<string, unknown> = { __esModule: true }
    for (const [name, implementation] of Object.entries(actions)) {
      const result = actionResults[specifier]?.[name]
      namespace[name] = implementation ?? (async (payload: unknown) => {
        state.actionCalls.push({ action: `${specifier}#${name}`, payload })
        return result
      })
    }
    overrides[specifier] = namespace
  }

  const realButtonModule = loadReal<Record<string, unknown>>('@/components/ui/button')
  const SpyButton = function SpyButton(props: {
    children?: ReactNode
    disabled?: boolean
    type?: string
    onClick?: () => unknown
  }) {
    state.buttons.push({
      label: collectTexts(props.children).join(' ').trim(),
      disabled: props.disabled,
      type: props.type,
      onClick: props.onClick,
    })
    const RealButton = realButtonModule.Button as React.ComponentType<Record<string, unknown>>
    return createElement(RealButton, props)
  }
  overrides['@/components/ui/button'] = {
    __esModule: true,
    ...realButtonModule,
    Button: SpyButton,
  }

  const realFormModule = loadReal<Record<string, unknown>>('@/components/ui/form')
  overrides['@/components/ui/form'] = {
    __esModule: true,
    ...realFormModule,
    Form: function SpyForm(props: Record<string, unknown> & { children?: ReactNode }) {
      const native = firstNativeForm(props.children)
      if (native) {
        state.nativeForms.push({ onSubmit: native.onSubmit, formApi: props })
      }
      const RealForm = realFormModule.Form as React.ComponentType<Record<string, unknown>>
      return createElement(RealForm, props)
    },
  }

  const realDialogModule = loadReal<Record<string, unknown>>('@/components/ui/dialog')
  overrides['@/components/ui/dialog'] = {
    __esModule: true,
    ...realDialogModule,
    Dialog: function SpyDialog(props: { open?: boolean; children?: ReactNode }) {
      const walked = { texts: [] as string[], buttons: [] as CapturedButton[], nativeForm: null as CapturedNativeForm | null }
      // Form modules resolve the overridden Button, so tree elements carry the
      // spy component as their type.
      walkControlTree(props.children, SpyButton, walked)
      state.dialogTrees.push({ open: Boolean(props.open), ...walked })
      const RealDialog = realDialogModule.Dialog as React.ComponentType<Record<string, unknown>>
      return createElement(RealDialog, forceDialogsOpen ? { ...props, open: true } : props)
    },
  }

  overrides['sonner'] = {
    __esModule: true,
    toast: makeToastRecorder(),
  }

  const patchedLoad: LoadFn = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(overrides, request)) {
      return overrides[request]
    }
    return originalLoad.apply(this, [request, parent, isMain])
  }
  ;(Module as unknown as { _load: LoadFn })._load = patchedLoad
}

function makeToastRecorder() {
  const record = (kind: string) => (message: unknown) => {
    state.toasts.push({ kind, message: String(message) })
  }
  const toast = record('default') as unknown as Record<string, (message: unknown) => void>
  for (const kind of ['success', 'error', 'info', 'warning', 'loading', 'message', 'promise', 'custom', 'dismiss']) {
    toast[kind] = record(kind)
  }
  return toast
}

const stubRouter = {
  push: () => undefined,
  replace: () => undefined,
  refresh: () => undefined,
  back: () => undefined,
  forward: () => undefined,
  prefetch: () => undefined,
}

const flushAsync = async () => {
  for (let index = 0; index < 6; index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

export type RenderedSurface = {
  html: string
  buttons: CapturedButton[]
  nativeForm: CapturedNativeForm | null
  dialogTrees: CapturedDialogTree[]
  actionCalls: ActionCall[]
  toasts: Array<{ kind: string; message: string }>
}

/** Renders one real form surface with the stubbed coordinator reporting `reason`. */
export async function renderSurface(
  element: React.ReactElement,
  reason: StubbedBlockingReason,
): Promise<RenderedSurface> {
  state.coordinatorReason = reason
  state.buttons = []
  state.nativeForms = []
  state.dialogTrees = []
  state.actionCalls = []
  state.toasts = []

  const html = renderToStaticMarkup(createElement(
    AppRouterContext.Provider,
    { value: stubRouter },
    element,
  ))
  await flushAsync()

  const dialogButtons = state.dialogTrees.flatMap((tree) => tree.buttons)
  const dialogForm = state.dialogTrees.find((tree) => tree.nativeForm)?.nativeForm ?? null

  return {
    html,
    buttons: [...state.buttons, ...dialogButtons],
    nativeForm: state.nativeForms[0] ?? dialogForm,
    dialogTrees: state.dialogTrees,
    // Live arrays: handlers driven after render record into these.
    actionCalls: state.actionCalls,
    toasts: state.toasts,
  }
}

/** Fills a captured react-hook-form surface with schema-valid values. */
export function fillFormValues(
  nativeForm: CapturedNativeForm | null,
  values: Record<string, unknown>,
): void {
  if (!nativeForm?.formApi.setValue) {
    throw new Error('harness could not capture the native form element to fill values')
  }
  for (const [name, value] of Object.entries(values)) {
    nativeForm.formApi.setValue(name, value)
  }
}

/** Drives the captured native form submit handler (the wired handleSubmit). */
export async function submitNativeForm(nativeForm: CapturedNativeForm | null): Promise<void> {
  if (!nativeForm?.onSubmit) {
    throw new Error('harness could not capture the native form submit handler')
  }
  await nativeForm.onSubmit({ preventDefault: () => undefined })
  await flushAsync()
}

/** Drives a captured button's click handler (e.g. modal confirm buttons). */
export async function clickButton(
  buttons: CapturedButton[],
  label: string,
): Promise<void> {
  const button = buttons.find((entry) => entry.label === label)
  if (!button?.onClick) {
    throw new Error(`harness could not capture the "${label}" button click handler`)
  }
  await button.onClick()
  await flushAsync()
}

export function findButton(buttons: CapturedButton[], label: string): CapturedButton {
  const button = buttons.find((entry) => entry.label === label)
  if (!button) {
    throw new Error(`expected a captured "${label}" button`)
  }
  return button
}
