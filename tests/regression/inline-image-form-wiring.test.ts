import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

function assertCombinedBlockingWiring(source: string) {
  assert.match(source, /inlineImageBlockingMessage\(\s*inlineImages\.blockingReason,?\s*\)/)
  assert.ok(
    (source.match(/inlineImages\.hasBlockingOperations/g) ?? []).length >= 2,
    'expected both submit-handler and disabled-button blocking guards',
  )
}

describe('inline image form wiring', () => {
  describe('request form', () => {
    const source = read('src/components/requests/request-form.tsx')

    it('creates one coordinator and passes it to the description editor', () => {
      assert.equal((source.match(/useInlineDescriptionImages\(\)/g) ?? []).length, 1)
      assert.match(source, /inlineImages=\{inlineImages\}/)
    })

    it('sends the upload session with the save payload', () => {
      assert.match(source, /inlineImageSessionId: inlineImages\.uploadSessionId/)
    })

    it('blocks submit during uploads or image edits and shows reason-specific guidance', () => {
      assertCombinedBlockingWiring(source)
      assert.match(source, /disabled=\{isSubmitting \|\| inlineImages\.hasBlockingOperations\}/)
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

    it('blocks submission during uploads or image edits and shows reason-specific guidance', () => {
      assertCombinedBlockingWiring(source)
      assert.match(source, /isSubmitting=\{isSubmitting \|\| inlineImages\.hasBlockingOperations\}/)
      assert.match(source, /disabled=\{isSubmitting \|\| inlineImages\.hasBlockingOperations\}/)
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

    it('blocks submit during uploads or image edits and shows reason-specific guidance', () => {
      assertCombinedBlockingWiring(source)
      assert.match(source, /disabled=\{isSubmitting \|\| inlineImages\.hasBlockingOperations\}/)
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

    it('blocks submit during uploads or image edits and shows reason-specific guidance', () => {
      assertCombinedBlockingWiring(source)
      assert.match(source, /disabled=\{isSubmitting \|\| inlineImages\.hasBlockingOperations\}/)
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
        /onSubmitRequest\?: \(data: \{[\s\S]*?inlineImageSessionId: string;[\s\S]*?\}\) => Promise<\{ success: boolean; error\?: string \}>/,
      )
      assert.match(source, /inlineImageSessionId: string;/)
    })

    it('awaits the request callback and only clears after confirmed success', () => {
      assert.match(source, /const result = await onSubmitRequest\(\{[\s\S]*?inlineImageSessionId: inlineImages\.uploadSessionId,[\s\S]*?\}\)/)
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

    it('blocks submit during uploads or image edits and shows reason-specific guidance', () => {
      assertCombinedBlockingWiring(source)
      assert.match(source, /if \(inlineImages\.hasBlockingOperations\)/)
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

    it('blocks resubmit during uploads or image edits and shows reason-specific guidance', () => {
      assertCombinedBlockingWiring(source)
      assert.match(source, /inlineImages\.hasBlockingOperations/)
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
