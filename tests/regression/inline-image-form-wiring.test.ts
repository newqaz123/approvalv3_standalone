import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement, type ComponentType } from 'react'
import {
  clickButton,
  fillFormValues,
  findButton,
  installFormHarness,
  renderSurface,
  submitNativeForm,
  type RenderedSurface,
} from './inline-image-form-harness'

const read = (path: string) => readFileSync(path, 'utf8')

const UPLOAD_GUIDANCE = 'Wait for image uploads, or retry/remove failed images.'
const EDIT_GUIDANCE = 'Apply or cancel the image edit before saving.'
const STUB_SESSION_ID = 'stub-inline-session'

/**
 * Task 4 form-surface signal: observable blocking behavior. Each real form
 * component is rendered with the coordinator seam stubbed to report
 * `blockingReason` 'upload' then 'image-edit' (coordinator semantics themselves
 * are behavior-tested in inline-image-client.test.ts), the wired submit path is
 * driven, and the rendered guidance plus disabled controls are asserted.
 */
installFormHarness({
  actionStubs: {
    '@/server-actions/requests': {
      createRequest: undefined,
      resubmitRequest: undefined,
    },
    '@/server-actions/files': {
      uploadFileAction: undefined,
      deleteFileAttachment: undefined,
      uploadSolutionDraftAttachmentAction: undefined,
      cleanupSolutionDraftAttachments: undefined,
    },
    '@/server-actions/solutions': { submitSolution: undefined },
    '@/server-actions/templates': { createTemplate: undefined, updateTemplate: undefined },
  },
  actionResults: {
    '@/server-actions/requests': {
      createRequest: { success: true, requestId: 'probe-request' },
      resubmitRequest: { success: true },
    },
    '@/server-actions/solutions': { submitSolution: { success: true, solutionId: 'probe-solution' } },
    '@/server-actions/templates': { createTemplate: {} },
  },
  // The live resubmit dialog keeps its own open state starting closed; forcing
  // the dialog open stands in for the user having clicked the trigger.
  forceDialogsOpen: true,
})

type LooseComponent = ComponentType<Record<string, unknown>>

type FormModules = {
  RequestForm: LooseComponent
  SolutionForm: LooseComponent
  TemplateForm: LooseComponent
  ResubmitRequestDialog: LooseComponent
  RequestResubmitModal: LooseComponent
  SubmitterModal: LooseComponent
}

let loadedForms: Promise<FormModules> | null = null

function loadForms(): Promise<FormModules> {
  loadedForms ??= (async () => {
    const [requestForm, solutionForm, templateForm, resubmitDialog, resubmitModal, submitterModal] =
      await Promise.all([
        import('../../src/components/requests/request-form'),
        import('../../src/components/solutions/solution-form'),
        import('../../src/components/admin/template-form'),
        import('../../src/components/requests/resubmit-request-dialog'),
        import('../../src/components/requests/request-resubmit-modal'),
        import('../../src/components/requests/submitter-modal'),
      ])
    return {
      RequestForm: requestForm.RequestForm as unknown as LooseComponent,
      SolutionForm: solutionForm.SolutionForm as unknown as LooseComponent,
      TemplateForm: templateForm.TemplateForm as unknown as LooseComponent,
      ResubmitRequestDialog: resubmitDialog.ResubmitRequestDialog as unknown as LooseComponent,
      RequestResubmitModal: resubmitModal.RequestResubmitModal as unknown as LooseComponent,
      SubmitterModal: submitterModal.SubmitterModal as unknown as LooseComponent,
    }
  })()
  return loadedForms
}

/** Dialog content renders through portals that static rendering skips, so the
 * constructed element tree is the observable surface for modal-based forms. */
function dialogTexts(out: RenderedSurface): string[] {
  return out.dialogTrees.flatMap((tree) => tree.texts)
}

function assertExactGuidance(texts: string[], expected: string, other: string): void {
  assert.ok(
    texts.some((text) => text === expected),
    `expected the exact guidance "${expected}" to render`,
  )
  assert.ok(
    !texts.some((text) => text === other),
    `the "${other}" guidance must not render for this reason`,
  )
}

function assertDisabledButton(html: string, label: string): void {
  const escaped = label.replace(/&/g, '&amp;')
  assert.match(
    html,
    new RegExp(`<button[^>]*\\sdisabled(?:=""|)[^>]*>[^<]*${escaped}[^<]*</button>`),
    `the rendered submit control must carry the disabled attribute (${label})`,
  )
}

describe('inline image form blocking behavior', () => {
  describe('request form', () => {
    const surface = async () => {
      const { RequestForm } = await loadForms()
      return (reason: 'upload' | 'image-edit' | null) =>
        renderSurface(createElement(RequestForm, {}), reason)
    }

    it('disables submit and renders the upload guidance while uploads block', async () => {
      const render = await surface()
      const out = await render('upload')
      assert.ok(out.html.includes(UPLOAD_GUIDANCE))
      assert.ok(!out.html.includes(EDIT_GUIDANCE))
      assert.equal(findButton(out.buttons, 'Create Request').disabled, true)
      assertDisabledButton(out.html, 'Create Request')
    })

    it('disables submit and renders the image-edit guidance during an active edit', async () => {
      const render = await surface()
      const out = await render('image-edit')
      assert.ok(out.html.includes(EDIT_GUIDANCE))
      assert.ok(!out.html.includes(UPLOAD_GUIDANCE))
      assert.equal(findButton(out.buttons, 'Create Request').disabled, true)
    })

    it('keeps submit enabled with no guidance when nothing blocks', async () => {
      const render = await surface()
      const out = await render(null)
      assert.ok(!out.html.includes(UPLOAD_GUIDANCE))
      assert.ok(!out.html.includes(EDIT_GUIDANCE))
      assert.equal(findButton(out.buttons, 'Create Request').disabled, false)
    })

    it('blocks the wired submit handler for each blocking reason', async () => {
      const render = await surface()
      for (const reason of ['upload', 'image-edit'] as const) {
        const out = await render(reason)
        fillFormValues(out.nativeForm, { title: 'Probe title', description: 'Probe description' })
        await submitNativeForm(out.nativeForm)
        assert.deepEqual(out.actionCalls, [], `createRequest must not run while ${reason} blocks`)
      }
    })

    it('runs createRequest through the same wired handler once unblocked', async () => {
      const render = await surface()
      const out = await render(null)
      fillFormValues(out.nativeForm, { title: 'Probe title', description: 'Probe description' })
      await submitNativeForm(out.nativeForm)
      assert.equal(out.actionCalls.length, 1)
      assert.equal(out.actionCalls[0].action, '@/server-actions/requests#createRequest')
      assert.equal(
        (out.actionCalls[0].payload as { inlineImageSessionId?: string }).inlineImageSessionId,
        STUB_SESSION_ID,
      )
    })
  })

  describe('solution form', () => {
    const surface = async () => {
      const { SolutionForm } = await loadForms()
      return (reason: 'upload' | 'image-edit' | null) =>
        renderSurface(createElement(SolutionForm, {
          requestId: 'probe-request',
          requestTitle: 'Probe request',
          currentUserId: 'probe-user',
          allUsers: [],
        }), reason)
    }

    it('disables submit and renders the upload guidance while uploads block', async () => {
      const render = await surface()
      const out = await render('upload')
      assert.ok(out.html.includes(UPLOAD_GUIDANCE))
      assert.ok(!out.html.includes(EDIT_GUIDANCE))
      assert.equal(findButton(out.buttons, 'Review & Submit').disabled, true)
      assertDisabledButton(out.html, 'Review & Submit')
    })

    it('disables submit and renders the image-edit guidance during an active edit', async () => {
      const render = await surface()
      const out = await render('image-edit')
      assert.ok(out.html.includes(EDIT_GUIDANCE))
      assert.ok(!out.html.includes(UPLOAD_GUIDANCE))
      assert.equal(findButton(out.buttons, 'Review & Submit').disabled, true)
    })

    it('keeps submit enabled with no guidance when nothing blocks', async () => {
      const render = await surface()
      const out = await render(null)
      assert.ok(!out.html.includes(UPLOAD_GUIDANCE))
      assert.ok(!out.html.includes(EDIT_GUIDANCE))
      assert.equal(findButton(out.buttons, 'Review & Submit').disabled, false)
    })

    it('blocks the wired submit handler with the exact reason guidance for each reason', async () => {
      const render = await surface()
      for (const reason of ['upload', 'image-edit'] as const) {
        const out = await render(reason)
        fillFormValues(out.nativeForm, { title: 'Probe title', description: 'Probe description' })
        await submitNativeForm(out.nativeForm)
        assert.deepEqual(out.actionCalls, [], `submitSolution must not run while ${reason} blocks`)
        const expected = reason === 'upload' ? UPLOAD_GUIDANCE : EDIT_GUIDANCE
        assert.deepEqual(
          out.toasts.filter((toast) => toast.kind === 'error'),
          [{ kind: 'error', message: expected }],
        )
      }
    })

    it('raises no blocking toast through the same wired handler once unblocked', async () => {
      const render = await surface()
      const out = await render(null)
      fillFormValues(out.nativeForm, { title: 'Probe title', description: 'Probe description' })
      await submitNativeForm(out.nativeForm)
      assert.deepEqual(out.toasts.filter((toast) => toast.kind === 'error'), [])
      // The unblocked submit stops at the preview stage; solution submission
      // itself happens on the preview confirm, which single-pass static
      // rendering cannot reach.
      assert.deepEqual(out.actionCalls, [])
    })
  })

  describe('template form', () => {
    const surface = async () => {
      const { TemplateForm } = await loadForms()
      return (reason: 'upload' | 'image-edit' | null) =>
        renderSurface(createElement(TemplateForm, {}), reason)
    }

    it('disables submit and renders the upload guidance while uploads block', async () => {
      const render = await surface()
      const out = await render('upload')
      assert.ok(out.html.includes(UPLOAD_GUIDANCE))
      assert.ok(!out.html.includes(EDIT_GUIDANCE))
      assert.equal(findButton(out.buttons, 'Create Template').disabled, true)
      assertDisabledButton(out.html, 'Create Template')
    })

    it('disables submit and renders the image-edit guidance during an active edit', async () => {
      const render = await surface()
      const out = await render('image-edit')
      assert.ok(out.html.includes(EDIT_GUIDANCE))
      assert.ok(!out.html.includes(UPLOAD_GUIDANCE))
      assert.equal(findButton(out.buttons, 'Create Template').disabled, true)
    })

    it('keeps submit enabled with no guidance when nothing blocks', async () => {
      const render = await surface()
      const out = await render(null)
      assert.ok(!out.html.includes(UPLOAD_GUIDANCE))
      assert.ok(!out.html.includes(EDIT_GUIDANCE))
      assert.equal(findButton(out.buttons, 'Create Template').disabled, false)
    })

    it('blocks the wired submit handler for each blocking reason', async () => {
      const render = await surface()
      for (const reason of ['upload', 'image-edit'] as const) {
        const out = await render(reason)
        fillFormValues(out.nativeForm, {
          name: 'Probe template',
          title: 'Probe title',
          description: 'Probe description',
        })
        await submitNativeForm(out.nativeForm)
        assert.deepEqual(out.actionCalls, [], `createTemplate must not run while ${reason} blocks`)
      }
    })

    it('runs createTemplate through the same wired handler once unblocked', async () => {
      const render = await surface()
      const out = await render(null)
      fillFormValues(out.nativeForm, {
        name: 'Probe template',
        title: 'Probe title',
        description: 'Probe description',
      })
      await submitNativeForm(out.nativeForm)
      assert.equal(out.actionCalls.length, 1)
      assert.equal(out.actionCalls[0].action, '@/server-actions/templates#createTemplate')
      assert.equal(
        (out.actionCalls[0].payload as { inlineImageSessionId?: string }).inlineImageSessionId,
        STUB_SESSION_ID,
      )
    })
  })

  describe('resubmit request dialog', () => {
    const surface = async () => {
      const { ResubmitRequestDialog } = await loadForms()
      return (reason: 'upload' | 'image-edit' | null) =>
        renderSurface(createElement(ResubmitRequestDialog, {
          requestId: 'probe-request',
          currentTitle: 'Probe title',
          currentDescription: 'Probe description',
        }), reason)
    }

    it('renders the upload guidance in the open dialog and disables resubmit', async () => {
      const render = await surface()
      const out = await render('upload')
      assertExactGuidance(dialogTexts(out), UPLOAD_GUIDANCE, EDIT_GUIDANCE)
      assert.equal(findButton(out.buttons, 'Resubmit Request').disabled, true)
    })

    it('renders the image-edit guidance in the open dialog and disables resubmit', async () => {
      const render = await surface()
      const out = await render('image-edit')
      assertExactGuidance(dialogTexts(out), EDIT_GUIDANCE, UPLOAD_GUIDANCE)
      assert.equal(findButton(out.buttons, 'Resubmit Request').disabled, true)
    })

    it('keeps resubmit enabled with no guidance when nothing blocks', async () => {
      const render = await surface()
      const out = await render(null)
      assert.ok(!dialogTexts(out).includes(UPLOAD_GUIDANCE))
      assert.ok(!dialogTexts(out).includes(EDIT_GUIDANCE))
      assert.equal(findButton(out.buttons, 'Resubmit Request').disabled, false)
    })

    it('blocks the wired submit handler for each blocking reason', async () => {
      const render = await surface()
      for (const reason of ['upload', 'image-edit'] as const) {
        const out = await render(reason)
        await submitNativeForm(out.nativeForm)
        assert.deepEqual(out.actionCalls, [], `resubmitRequest must not run while ${reason} blocks`)
      }
    })

    it('runs resubmitRequest through the same wired handler once unblocked', async () => {
      const render = await surface()
      const out = await render(null)
      await submitNativeForm(out.nativeForm)
      assert.equal(out.actionCalls.length, 1)
      assert.equal(out.actionCalls[0].action, '@/server-actions/requests#resubmitRequest')
      assert.equal(
        (out.actionCalls[0].payload as { inlineImageSessionId?: string }).inlineImageSessionId,
        STUB_SESSION_ID,
      )
    })
  })

  describe('request resubmit modal', () => {
    let onResubmitCalls: Array<{ inlineImageSessionId?: string }>

    const surface = async () => {
      const { RequestResubmitModal } = await loadForms()
      const element = () => {
        onResubmitCalls = []
        return createElement(RequestResubmitModal, {
          open: true,
          onOpenChange: () => undefined,
          initialData: {
            title: 'Probe title',
            description: 'Probe description',
            rejectionReason: 'Rejected for probe',
            rejectedBy: 'Probe Approver',
            rejectedAt: '2026-08-01T09:00:00.000Z',
            files: [],
          },
          onResubmit: async (data: { inlineImageSessionId?: string }) => {
            onResubmitCalls.push(data)
            return { success: true }
          },
        })
      }
      return (reason: 'upload' | 'image-edit' | null) => renderSurface(element(), reason)
    }

    it('renders the upload guidance and disables resubmit while uploads block', async () => {
      const render = await surface()
      const out = await render('upload')
      assertExactGuidance(dialogTexts(out), UPLOAD_GUIDANCE, EDIT_GUIDANCE)
      assert.equal(findButton(out.buttons, 'Resubmit Request').disabled, true)
    })

    it('renders the image-edit guidance and disables resubmit during an active edit', async () => {
      const render = await surface()
      const out = await render('image-edit')
      assertExactGuidance(dialogTexts(out), EDIT_GUIDANCE, UPLOAD_GUIDANCE)
      assert.equal(findButton(out.buttons, 'Resubmit Request').disabled, true)
    })

    it('keeps resubmit enabled with no guidance when nothing blocks', async () => {
      const render = await surface()
      const out = await render(null)
      assert.ok(!dialogTexts(out).includes(UPLOAD_GUIDANCE))
      assert.ok(!dialogTexts(out).includes(EDIT_GUIDANCE))
      assert.equal(findButton(out.buttons, 'Resubmit Request').disabled, false)
    })

    it('blocks the confirm click for each blocking reason', async () => {
      const render = await surface()
      for (const reason of ['upload', 'image-edit'] as const) {
        const out = await render(reason)
        await clickButton(out.buttons, 'Resubmit Request')
        assert.deepEqual(onResubmitCalls, [], `onResubmit must not run while ${reason} blocks`)
      }
    })

    it('runs onResubmit through the same confirm click once unblocked', async () => {
      const render = await surface()
      const out = await render(null)
      await clickButton(out.buttons, 'Resubmit Request')
      assert.equal(onResubmitCalls.length, 1)
      assert.equal(onResubmitCalls[0].inlineImageSessionId, STUB_SESSION_ID)
    })
  })

  describe('submitter modal', () => {
    let onSubmitRequestCalls: Array<{ inlineImageSessionId?: string }>

    const surface = async () => {
      const { SubmitterModal } = await loadForms()
      const element = () => {
        onSubmitRequestCalls = []
        return createElement(SubmitterModal, {
          mode: 'request',
          open: true,
          onOpenChange: () => undefined,
          initialData: { title: 'Probe title', description: 'Probe description' },
          onSubmitRequest: async (data: { inlineImageSessionId?: string }) => {
            onSubmitRequestCalls.push(data)
            return { success: true }
          },
        })
      }
      return (reason: 'upload' | 'image-edit' | null) => renderSurface(element(), reason)
    }

    it('renders the upload guidance and disables submit while uploads block', async () => {
      const render = await surface()
      const out = await render('upload')
      assertExactGuidance(dialogTexts(out), UPLOAD_GUIDANCE, EDIT_GUIDANCE)
      assert.equal(findButton(out.buttons, 'Submit Request').disabled, true)
    })

    it('renders the image-edit guidance and disables submit during an active edit', async () => {
      const render = await surface()
      const out = await render('image-edit')
      assertExactGuidance(dialogTexts(out), EDIT_GUIDANCE, UPLOAD_GUIDANCE)
      assert.equal(findButton(out.buttons, 'Submit Request').disabled, true)
    })

    it('keeps submit enabled with no guidance when nothing blocks', async () => {
      const render = await surface()
      const out = await render(null)
      assert.ok(!dialogTexts(out).includes(UPLOAD_GUIDANCE))
      assert.ok(!dialogTexts(out).includes(EDIT_GUIDANCE))
      assert.equal(findButton(out.buttons, 'Submit Request').disabled, false)
    })

    it('blocks the submit click for each blocking reason', async () => {
      const render = await surface()
      for (const reason of ['upload', 'image-edit'] as const) {
        const out = await render(reason)
        await clickButton(out.buttons, 'Submit Request')
        assert.deepEqual(onSubmitRequestCalls, [], `onSubmitRequest must not run while ${reason} blocks`)
      }
    })

    it('runs onSubmitRequest through the same submit click once unblocked', async () => {
      const render = await surface()
      const out = await render(null)
      await clickButton(out.buttons, 'Submit Request')
      assert.equal(onSubmitRequestCalls.length, 1)
      assert.equal(onSubmitRequestCalls[0].inlineImageSessionId, STUB_SESSION_ID)
    })
  })
})

/**
 * Retained wiring contracts from earlier tasks. These cover coordinator
 * ownership, upload-session payloads, success-only clears, and reset paths;
 * blocking behavior itself is covered behaviorally above.
 */
describe('inline image form wiring contracts', () => {
  describe('request form', () => {
    const source = read('src/components/requests/request-form.tsx')

    it('creates one coordinator and passes it to the description editor', () => {
      assert.equal((source.match(/useInlineDescriptionImages\(\)/g) ?? []).length, 1)
      assert.match(source, /inlineImages=\{inlineImages\}/)
    })

    it('sends the upload session with the save payload', () => {
      assert.match(source, /inlineImageSessionId: inlineImages\.uploadSessionId/)
    })

    it('clears draft state only after the save succeeds', () => {
      assert.match(source, /if \(!result\.success\) \{[\s\S]*?return/)
      const successBranch = source.split('const requestId = result.requestId!')[1] ?? ''
      assert.match(successBranch, /inlineImages\.clear\(\)/)
    })

    it('awaits coordinator reset on cancel and stays open on cleanup failure', () => {
      assert.match(source, /await inlineImages\.reset\(\)/)
      const cancel = source.split('const handleCancel')[1]?.split('const formatFileSize')[0] ?? ''
      assert.match(cancel, /return/)
      assert.match(cancel, /router\.back\(\)/)
    })

    it('still copies template description HTML when a template is selected', () => {
      assert.match(source, /form\.setValue\('description', template\.description/)
      assert.match(source, /form\.setValue\('title', template\.title/)
    })
  })

  describe('solution form', () => {
    const source = read('src/components/solutions/solution-form.tsx')

    it('creates one coordinator shared across edit and preview', () => {
      assert.equal((source.match(/useInlineDescriptionImages\(\)/g) ?? []).length, 1)
      assert.match(source, /inlineImages=\{inlineImages\}/)
      const previewBranch = source.split('if (showPreview)')[1]?.split('return (')[0] ?? ''
      assert.doesNotMatch(previewBranch, /useInlineDescriptionImages/)
    })

    it('sends the same upload session with the final confirm payload', () => {
      assert.match(source, /inlineImageSessionId: inlineImages\.uploadSessionId/)
    })

    it('clears inline drafts only after the solution save succeeds', () => {
      assert.match(source, /if \(!submitResult\.success\) \{[\s\S]*?return/)
      const successBranch = source.split("toast.success('Solution submitted successfully')")[1]?.split('router.push')[0] ?? ''
      assert.match(successBranch, /inlineImages\.clear\(\)/)
    })

    it('awaits coordinator reset on cancel and stays open on cleanup failure', () => {
      const cancel = source.split('const handleCancel = async')[1]?.split('const handleSubmit')[0] ?? ''
      assert.match(cancel, /await inlineImages\.reset\(\)/)
      assert.match(cancel, /return/)
      assert.match(cancel, /router\.back\(\)/)
    })

    it('keeps solution attachments independent from inline images', () => {
      assert.match(source, /useSolutionAttachments\(\{/)
      assert.doesNotMatch(source, /inlineImages\.[a-z]+\(\).*ensureUploaded/)
    })
  })

  describe('template form', () => {
    const source = read('src/components/admin/template-form.tsx')

    it('creates one coordinator and passes it to the description editor', () => {
      assert.equal((source.match(/useInlineDescriptionImages\(\)/g) ?? []).length, 1)
      assert.match(source, /inlineImages=\{inlineImages\}/)
    })

    it('sends the upload session with create and update payloads', () => {
      assert.match(source, /inlineImageSessionId: inlineImages\.uploadSessionId/)
    })

    it('clears inline drafts only after the template save succeeds', () => {
      assert.match(source, /if \(initialData\?\.id\) \{[\s\S]*?await updateTemplate[\s\S]*?\} else \{[\s\S]*?await createTemplate[\s\S]*?\}/)
      const success = source.split('inlineImages.clear()')[0]
      assert.match(success, /await (updateTemplate|createTemplate)/)
      assert.doesNotMatch(source, /catch[\s\S]{0,200}inlineImages\.clear\(\)/)
    })

    it('awaits coordinator reset on cancel and stays open on cleanup failure', () => {
      const cancel = source.split('const handleCancel')[1]?.split('return \(')[0] ?? ''
      assert.match(cancel, /await inlineImages\.reset\(\)/)
      assert.match(cancel, /return/)
      assert.match(cancel, /onCancel\?\.\(\)/)
    })
  })

  describe('resubmit request dialog', () => {
    const source = read('src/components/requests/resubmit-request-dialog.tsx')

    it('creates one coordinator and passes it to the description editor', () => {
      assert.equal((source.match(/useInlineDescriptionImages\(\)/g) ?? []).length, 1)
      assert.match(source, /inlineImages=\{inlineImages\}/)
    })

    it('sends the upload session with the resubmit payload', () => {
      assert.match(source, /inlineImageSessionId: inlineImages\.uploadSessionId/)
    })

    it('clears inline drafts only after the resubmit succeeds', () => {
      assert.match(source, /if \(result\.success\) \{[\s\S]*?inlineImages\.clear\(\)/)
      assert.doesNotMatch(source, /\} else[\s\S]{0,300}inlineImages\.clear\(\)/)
    })

    it('routes every close path through one awaited cleanup function', () => {
      assert.match(source, /const handleDialogClose = async/)
      assert.match(source, /await inlineImages\.reset\(\)/)
      assert.match(source, /onOpenChange=\{handleDialogOpenChange\}/)
      assert.match(source, /onClick=\{handleDialogClose\}/)
      assert.doesNotMatch(source, /onClick=\{\(\) => setOpen\(false\)\}/)
    })
  })

  describe('submitter modal', () => {
    const source = read('src/components/requests/submitter-modal.tsx')

    it('creates one coordinator shared by request and solution description editors', () => {
      assert.equal((source.match(/useInlineDescriptionImages\(\)/g) ?? []).length, 1)
      assert.equal((source.match(/inlineImages=\{inlineImages\}/g) ?? []).length, 2)
    })

    it('types the request callback as an async success result with the upload session', () => {
      assert.match(
        source,
        /onSubmitRequest\?: \(\s*data: \{[\s\S]*?inlineImageSessionId: string;[\s\S]*?\},\s*onUploadProgress\?: \(progress: RequestUploadProgress\) => void,[\s\S]*?\) => Promise<\{ success: boolean; error\?: string \}>/,
      )
      assert.match(source, /inlineImageSessionId: string;/)
    })

    it('awaits the request callback and only clears after confirmed success', () => {
      assert.match(source, /const result = await onSubmitRequest\([\s\S]*?inlineImageSessionId: inlineImages\.uploadSessionId,[\s\S]*?\},[\s\S]*?setRequestProgress,[\s\S]*?\);/)
      assert.match(source, /if \(!result\.success\) \{[\s\S]*?setSubmitError\(result\.error \|\| "Failed to submit"\)[\s\S]*?return;[\s\S]*?\}/)
      const requestBranch = source.split('if (mode === "request" && onSubmitRequest)')[1]?.split('if (isSolutionMode)')[0] ?? ''
      assert.match(requestBranch, /inlineImages\.clear\(\)/)
    })

    it('passes the upload session through solution and resubmit callback data', () => {
      const solutionCalls = source.match(/onSubmitSolution\(\{[\s\S]*?\}\)/g) ?? []
      assert.ok(solutionCalls.length > 0)
      for (const call of solutionCalls) assert.match(call, /inlineImageSessionId: inlineImages\.uploadSessionId/)
      const resubmitCalls = source.match(/onResubmit\(\{[\s\S]*?\}\)/g) ?? []
      assert.ok(resubmitCalls.length > 0)
      for (const call of resubmitCalls) assert.match(call, /inlineImageSessionId: inlineImages\.uploadSessionId/)
    })

    it('clears both coordinators only in the solution success branches', () => {
      const solutionBranch = source.split('if (mode === "solution" && onSubmitSolution)')[1]?.split('} else if (mode === "resubmit"')[0] ?? ''
      assert.match(solutionBranch, /inlineImages\.clear\(\)/)
      const resubmitBranch = source.split('} else if (mode === "resubmit"')[1]?.split('} catch')[0] ?? ''
      assert.match(resubmitBranch, /inlineImages\.clear\(\)/)
    })

    it('routes close through one cleanup that awaits the inline coordinator reset', () => {
      assert.match(source, /const handleCloseWithCleanup = async/)
      assert.match(source, /await inlineImages\.reset\(\)/)
    })

    it('still copies template description HTML and forwards templateId through callback data', () => {
      assert.match(source, /setDescription\(template\.description\)/)
      assert.match(source, /templateId: selectedTemplate \|\| undefined,/)
    })
  })

  describe('request resubmit modal', () => {
    const source = read('src/components/requests/request-resubmit-modal.tsx')

    it('creates one coordinator and passes it to the description editor', () => {
      assert.equal((source.match(/useInlineDescriptionImages\(\)/g) ?? []).length, 1)
      assert.match(source, /inlineImages=\{inlineImages\}/)
    })

    it('standardizes the resubmit callback as an async success result with the session', () => {
      assert.match(
        source,
        /onResubmit\?: \(data: \{[\s\S]*?inlineImageSessionId: string;[\s\S]*?\}\) => Promise<\{ success: boolean; error\?: string \}>/,
      )
    })

    it('awaits the callback result and only clears after confirmed success', () => {
      assert.match(source, /const result = await onResubmit\(\{[\s\S]*?inlineImageSessionId: inlineImages\.uploadSessionId,[\s\S]*?\}\)/)
      assert.match(source, /if \(!result\.success\) \{[\s\S]*?return;[\s\S]*?\}/)
      assert.match(source, /inlineImages\.clear\(\)/)
    })

    it('routes every close path through one awaited cleanup function', () => {
      assert.match(source, /const requestClose = \(\) => \{[\s\S]*?void handleCloseWithCleanup/)
      assert.match(source, /await inlineImages\.reset\(\)/)
      assert.match(source, /onClick=\{requestClose\}/)
      assert.doesNotMatch(source, /onClick=\{\(\) => onOpenChange\(false\)\}/)
    })
  })

  describe('modal router callers', () => {
    const source = read('src/components/requests/request-modal-router.tsx')

    it('forwards the upload session to request resubmission and returns a success result', () => {
      const handler = source.split('const handleResubmitRequest = async')[1]?.split('const handleRestartFinalApproval')[0] ?? ''
      assert.match(handler, /inlineImageSessionId: data\.inlineImageSessionId/)
      assert.match(handler, /return \{ success: true \}/)
      assert.match(handler, /return \{ success: false, error: "Failed to resubmit request" \}/)
      assert.match(handler, /success: false,/)
    })

    it('forwards the upload session to solution submit and resubmit actions', () => {
      const submitCalls = source.match(/submitSolution\(\{[\s\S]*?\}\)/g) ?? []
      assert.ok(submitCalls.length > 0)
      for (const call of submitCalls) assert.match(call, /inlineImageSessionId: data\.inlineImageSessionId/)
      const resubmitCalls = source.match(/resubmitSolution\(\{[\s\S]*?\}\)/g) ?? []
      assert.ok(resubmitCalls.length > 0)
      for (const call of resubmitCalls) assert.match(call, /inlineImageSessionId: data\.inlineImageSessionId/)
    })
  })

  describe('new request callers', () => {
    it('returns success only after the request action succeeds', () => {
      const source = read('src/components/requests/requests-list-client.tsx')
      const handler = source.split('const handleSubmitRequest = async')[1]?.split('const handleExportXlsx')[0] ?? ''
      assert.match(handler, /inlineImageSessionId: data\.inlineImageSessionId/)
      assert.match(handler, /return \{ success: true \}/)
      assert.match(handler, /return \{ success: false, error: result\.error \|\| 'Failed to create request' \}/)
      assert.match(handler, /return \{ success: false, error: 'An error occurred while creating the request' \}/)
    })

    it('follows the same contract from the follow-up dashboard', () => {
      const source = read('src/components/dashboard/follow-up-dashboard.tsx')
      const handler = source.split('const handleSubmitRequest = async')[1]?.split('const lists = useMemo')[0] ?? ''
      assert.match(handler, /inlineImageSessionId: form\.inlineImageSessionId/)
      assert.match(handler, /return \{ success: true \};/)
      assert.match(handler, /success: false,\s*\n\s*error: result\.error \|\| "Failed to create request",/)
      assert.match(handler, /error: "An error occurred while creating the request",/)
    })
  })

  describe('sequential preview', () => {
    const source = read('src/app/sequential-stages-preview/page.tsx')

    it('keeps prototype callbacks compatible with async success results', () => {
      assert.match(source, /onSubmitRequest=\{async \(data\) => \{[\s\S]*?return \{ success: true \}/)
      const resubmit = source.split('<RequestResubmitModal')[1]?.split('/>')[0] ?? ''
      assert.match(resubmit, /onResubmit=\{async \(data\) => \{[\s\S]*?return \{ success: true \}/)
    })
  })
})
