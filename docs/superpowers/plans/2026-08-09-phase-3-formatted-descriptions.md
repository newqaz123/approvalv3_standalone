# Safe Formatted Descriptions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store and safely render restricted description markup supporting only `**bold text**`, preserved newlines, and ordinary text across editors, React views, emails, PDFs, and exports.

**Architecture:** Keep the existing string columns and create a dependency-free tokenizer that emits text, bold, and line-break tokens. A safe React renderer maps those tokens to text, `<strong>`, and `<br>`; an escaped HTML renderer is used only for owned email/PDF markup; a plain-text helper removes valid formatting delimiters while preserving visible newlines. A reusable textarea wrapper provides a Bold control without replacing native textarea editing.

**Tech Stack:** TypeScript, React, Next.js, server actions, Node test runner with `tsx`, Playwright, Puppeteer HTML-to-PDF.

## Global Constraints

- Store the exact user-entered restricted Markdown source in existing string fields; no schema migration and no generated HTML storage.
- Supported syntax is only `**bold text**`, newline characters, and ordinary plain text.
- Unmatched or malformed markers remain literal text; empty `****` markers remain literal text.
- Raw HTML/script-looking input is always escaped/textual and never executable.
- No links, italics, images, arbitrary HTML, full Markdown, `dangerouslySetInnerHTML`, or contenteditable editor.
- Existing plain-text descriptions remain valid and visually unchanged.
- React rendering uses text, `<strong>`, and `<br>` only.
- Email/PDF/HTML output escapes all user content before adding renderer-owned formatting tags.
- Plain-text output preserves newline characters and removes only valid bold delimiters.
- Truncation must not create broken partial bold spans; truncate parsed visible content or use a documented visible-text rule.
- Existing request/solution validation limits remain in force: descriptions stay required and max 5000 characters.
- Preserve attachment, approval, request visibility, and private-storage behavior.
- No VPS operations, production data changes, or unrelated rich-text redesign.

---

### Task 1: Dependency-free tokenizer, visible-text helpers, and tests

**Files:**
- Create: `src/lib/formatted-text.ts`
- Create: `tests/regression/formatted-text.test.ts`

**Interfaces:**
- Produces:
  - `FormattedTextToken = { type: 'text' | 'bold'; value: string } | { type: 'lineBreak' }`
  - `tokenizeFormattedText(source: string): FormattedTextToken[]`
  - `visibleFormattedText(source: string): string`
  - `truncateFormattedText(source: string, maxVisibleCharacters: number): FormattedTextToken[]`
  - `renderFormattedTextHtml(source: string, maxVisibleCharacters?: number): string`
  - `renderFormattedTextPlainText(source: string, maxVisibleCharacters?: number): string`
  - `escapeFormattedTextHtml(value: string): string`
- Later React/email/PDF tasks consume only these helpers for user description content.

- [ ] **Step 1: Write failing parser tests**

Add pure tests covering every required parser case:

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  renderFormattedTextHtml,
  renderFormattedTextPlainText,
  tokenizeFormattedText,
  truncateFormattedText,
  visibleFormattedText,
} from '@/lib/formatted-text'

describe('formatted description tokenizer', () => {
  it('keeps plain text unchanged', () => {
    assert.deepEqual(tokenizeFormattedText('plain text'), [{ type: 'text', value: 'plain text' }])
    assert.equal(visibleFormattedText('plain text'), 'plain text')
    assert.equal(renderFormattedTextPlainText('plain text'), 'plain text')
  })

  it('creates bold tokens for multiple non-empty paired spans', () => {
    assert.deepEqual(tokenizeFormattedText('A **bold** and **strong**.'), [
      { type: 'text', value: 'A ' },
      { type: 'bold', value: 'bold' },
      { type: 'text', value: ' and ' },
      { type: 'bold', value: 'strong' },
      { type: 'text', value: '.' },
    ])
    assert.equal(visibleFormattedText('A **bold** and **strong**.'), 'A bold and strong.')
  })

  it('turns each newline into a line-break token and preserves it in plain text', () => {
    assert.deepEqual(tokenizeFormattedText('first\nsecond\r\nthird').filter(token => token.type === 'lineBreak'), [
      { type: 'lineBreak' },
      { type: 'lineBreak' },
    ])
    assert.equal(visibleFormattedText('first\nsecond\r\nthird'), 'first\nsecond\nthird')
  })

  it('leaves unmatched and malformed markers literal', () => {
    assert.deepEqual(tokenizeFormattedText('before **unmatched'), [{ type: 'text', value: 'before **unmatched' }])
    assert.deepEqual(tokenizeFormattedText('****'), [{ type: 'text', value: '****' }])
    assert.equal(visibleFormattedText('**open ** close'), '**open ** close')
  })

  it('treats HTML and script-looking input as text and escapes HTML output', () => {
    const source = '<script>alert(1)</script> **<img src=x onerror=alert(1)>**'
    assert.equal(visibleFormattedText(source), '<script>alert(1)</script> <img src=x onerror=alert(1)>')
    assert.equal(
      renderFormattedTextHtml(source),
      '&lt;script&gt;alert(1)&lt;/script&gt; <strong>&lt;img src=x onerror=alert(1)&gt;</strong>',
    )
  })

  it('supports bold spans at the beginning and end of the source', () => {
    assert.deepEqual(tokenizeFormattedText('**start** middle **end**'), [
      { type: 'bold', value: 'start' },
      { type: 'text', value: ' middle ' },
      { type: 'bold', value: 'end' },
    ])
  })

  it('truncates visible content without leaving raw markers or a partial source span', () => {
    const tokens = truncateFormattedText('before **bold words** after', 12)
    assert.equal(tokens.map(token => token.type === 'lineBreak' ? '\n' : token.value).join(''), 'before bold...')
    assert.equal(renderFormattedTextPlainText('before **bold words** after', 12), 'before bold...')
    assert.doesNotMatch(renderFormattedTextHtml('before **bold words** after', 12), /\*\*/) 
  })
})
```

- [ ] **Step 2: Run the focused test to verify the expected missing-module failure**

```bash
DATABASE_URL='postgresql://postgres:changeme@localhost:5432/app_db?schema=public' npx tsx --test tests/regression/formatted-text.test.ts
```

Expected: FAIL because `src/lib/formatted-text.ts` does not exist.

- [ ] **Step 3: Implement the tokenizer and render helpers**

Implement a single left-to-right scanner. Treat `\r\n` as one newline token, treat `\n` as one newline token, and merge adjacent same-type text/bold tokens. A `**` opener is valid only when a later `**` exists with at least one character between the delimiters; otherwise append the marker characters as literal text. `****` is explicitly literal. Bold content may contain newlines; split those newlines into `lineBreak` tokens while keeping the other content bold. Never parse nested Markdown or HTML.

Use a private `appendValue(tokens, type, value)` helper so all text/bold values are normalized consistently. `visibleFormattedText` joins token values and newline characters. `truncateFormattedText` counts visible characters (`lineBreak` counts as one), truncates token values rather than the raw source, and appends `...` only when source visible content exceeds the limit; it must never emit delimiter characters created by truncation. `renderFormattedTextHtml` escapes all token values, emits `<strong>escaped value</strong>` for bold, and `<br />` for line breaks. `renderFormattedTextPlainText` joins the truncated/complete tokens without bold delimiters. `escapeFormattedTextHtml` must escape `&`, `<`, `>`, `"`, and `'`.

- [ ] **Step 4: Run the focused tests and verify green**

```bash
DATABASE_URL='postgresql://postgres:changeme@localhost:5432/app_db?schema=public' npx tsx --test tests/regression/formatted-text.test.ts
```

Expected: all parser tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/formatted-text.ts tests/regression/formatted-text.test.ts
git commit -m "feat: add safe formatted text tokenizer"
```

---

### Task 2: Safe React renderer and reusable Bold textarea control

**Files:**
- Create: `src/components/ui/formatted-text.tsx`
- Create: `src/components/ui/formatted-textarea.tsx`
- Create: `tests/regression/formatted-text-ui.test.ts`

**Interfaces:**
- Consumes tokenizer helpers from Task 1.
- Produces `FormattedText({ source, className? })` and `FormattedTextarea` with native textarea props, `aria-label="Bold"`, `data-testid="formatted-text-bold"`, and controlled `value/onChange` behavior.

- [ ] **Step 1: Write failing renderer/toolbar contract tests**

Add tests that assert the component source imports the parser, maps `bold` to `<strong>`, maps `lineBreak` to `<br>`, never uses `dangerouslySetInnerHTML`, exposes the Bold button, and exports a pure selection helper with exact behavior:

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { wrapSelectionWithBold } from '@/components/ui/formatted-textarea'

const read = (path: string) => readFileSync(path, 'utf8')

describe('formatted text UI contracts', () => {
  it('wraps a selection in bold markers', () => {
    assert.deepEqual(wrapSelectionWithBold('hello world', 6, 11), {
      value: 'hello **world**',
      selectionStart: 8,
      selectionEnd: 13,
    })
  })

  it('inserts an empty bold pair and places the caret between markers', () => {
    assert.deepEqual(wrapSelectionWithBold('hello', 5, 5), {
      value: 'hello****',
      selectionStart: 7,
      selectionEnd: 7,
    })
  })

  it('renders only safe React elements', () => {
    const source = read('src/components/ui/formatted-text.tsx')
    assert.match(source, /tokenizeFormattedText/)
    assert.match(source, /<strong/)
    assert.match(source, /<br/)
    assert.doesNotMatch(source, /dangerouslySetInnerHTML/)
  })

  it('exposes an accessible Bold control', () => {
    const source = read('src/components/ui/formatted-textarea.tsx')
    assert.match(source, /aria-label=["']Bold["']/)
    assert.match(source, /data-testid=["']formatted-text-bold["']/)
    assert.match(source, /wrapSelectionWithBold/)
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails for missing exports/files**

```bash
DATABASE_URL='postgresql://postgres:changeme@localhost:5432/app_db?schema=public' npx tsx --test tests/regression/formatted-text-ui.test.ts
```

Expected: FAIL because the renderer and textarea modules do not exist.

- [ ] **Step 3: Implement the safe React renderer**

`FormattedText` must call `tokenizeFormattedText(source ?? '')` and map tokens with stable keys. Render text values as ordinary React strings, bold values as `<strong key=...>...</strong>`, and line breaks as `<br key=... />`. Do not concatenate HTML and do not use `dangerouslySetInnerHTML`. Return a fragment or a `<span>` with the optional class name; callers will supply semantic block wrappers.

- [ ] **Step 4: Implement the native textarea toolbar**

`FormattedTextarea` must render a small toolbar button and the existing `Textarea`. Keep the underlying input a real `<textarea>`. Export:

```ts
export function wrapSelectionWithBold(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): { value: string; selectionStart: number; selectionEnd: number }
```

For a non-empty selection, insert `**` before and after the selected text and select the original text inside the new markers. For an empty selection, insert `****` and place the caret between the marker pairs. The button must be `type="button"`, disabled when the textarea is disabled/read-only, and focus/selection updates must happen after the controlled value update so the caret remains usable. Forward `id`, `name`, `placeholder`, `rows`, `maxLength`, `value`, `onChange`, and other standard textarea props.

- [ ] **Step 5: Run focused tests and typecheck**

```bash
DATABASE_URL='postgresql://postgres:changeme@localhost:5432/app_db?schema=public' npx tsx --test tests/regression/formatted-text.test.ts tests/regression/formatted-text-ui.test.ts
DATABASE_URL='postgresql://postgres:changeme@localhost:5432/app_db?schema=public' npx tsc --noEmit
```

Expected: focused tests pass and typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/formatted-text.tsx src/components/ui/formatted-textarea.tsx tests/regression/formatted-text-ui.test.ts
git commit -m "feat: add safe formatted text UI controls"
```

---

### Task 3: Integrate the Bold control into all request and solution editors

**Files:**
- Modify: `src/components/requests/request-form.tsx`
- Modify: `src/components/requests/submitter-modal.tsx`
- Modify: `src/components/requests/request-resubmit-modal.tsx`
- Modify: `src/components/solutions/solution-form.tsx`
- Create: `tests/regression/formatted-description-editors.test.ts`

**Interfaces:**
- Consumes `FormattedTextarea` from Task 2.
- Produces editor wiring for new requests, request resubmission, solution submission, and solution resubmission while preserving current validation and state flows.

- [ ] **Step 1: Write failing editor source-contract tests**

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

describe('formatted description editors', () => {
  it('uses the formatted textarea for new request descriptions', () => {
    const source = read('src/components/requests/request-form.tsx')
    assert.match(source, /FormattedTextarea/)
    assert.match(source, /name="description"/)
  })

  it('uses the formatted textarea in request resubmission', () => {
    const source = read('src/components/requests/request-resubmit-modal.tsx')
    assert.match(source, /FormattedTextarea/)
    assert.match(source, /id="description"/)
  })

  it('uses the formatted textarea for solution submission and resubmission', () => {
    const source = read('src/components/solutions/solution-form.tsx')
    const modal = read('src/components/requests/submitter-modal.tsx')
    assert.match(source, /FormattedTextarea/)
    assert.match(source, /name="description"/)
    assert.match(modal, /FormattedTextarea/)
    assert.match(modal, /solutionDescription/)
    assert.match(modal, /description/)
  })

  it('keeps the existing 5000-character validation limit', () => {
    assert.match(read('src/components/requests/request-form.tsx'), /max\(5000/)
    assert.match(read('src/components/solutions/solution-form.tsx'), /max\(5000/)
  })
})
```

- [ ] **Step 2: Run the focused test and confirm missing editor wiring**

```bash
DATABASE_URL='postgresql://postgres:changeme@localhost:5432/app_db?schema=public' npx tsx --test tests/regression/formatted-description-editors.test.ts
```

Expected: failure because the existing editors still render plain `Textarea` components.

- [ ] **Step 3: Replace only description editor controls**

Import `FormattedTextarea` and replace the request description `Textarea` in `request-form.tsx`, the request description `Textarea` in both request-mode and request-resubmit flows, and the solution description `Textarea` in `solution-form.tsx` and `submitter-modal.tsx`. Keep `conceptDesign`, attachment-description inputs, rejection reasons, and sub-task descriptions as plain text unless they are existing request/solution description fields. Pass the existing field/state props through unchanged; do not transform or sanitize the stored value on submit.

The toolbar must appear next to each description textarea, have the same disabled/submitting state, preserve React Hook Form registration, and not change the current `min(1)`/`max(5000)` schemas or server action payload names.

- [ ] **Step 4: Run focused tests, typecheck, and source diff checks**

```bash
DATABASE_URL='postgresql://postgres:changeme@localhost:5432/app_db?schema=public' npx tsx --test tests/regression/formatted-description-editors.test.ts
DATABASE_URL='postgresql://postgres:changeme@localhost:5432/app_db?schema=public' npx tsc --noEmit
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/components/requests/request-form.tsx src/components/requests/submitter-modal.tsx src/components/requests/request-resubmit-modal.tsx src/components/solutions/solution-form.tsx tests/regression/formatted-description-editors.test.ts
git commit -m "feat: add bold formatting to description editors"
```

---

### Task 4: Integrate safe React rendering across detail and approval views

**Files:**
- Modify: `src/app/(dashboard)/requests/[requestId]/page.tsx`
- Modify: `src/components/requests/request-detail-modal.tsx`
- Modify: `src/components/requests/approver-modal.tsx`
- Modify: `src/components/requests/solution-modal.tsx`
- Modify: `src/components/requests/status-modal.tsx`
- Modify: `src/components/requests/final-approval-modal.tsx`
- Modify: `src/components/requests/final-approval-resubmit-modal.tsx`
- Modify: `src/components/requests/submit-final-approval-modal.tsx`
- Modify: `src/components/requests/completed-solution-modal.tsx`
- Modify: `src/components/requests/completed-final-modal.tsx`
- Modify: `src/components/solutions/solution-detail.tsx`
- Create: `tests/regression/formatted-description-rendering.test.ts`

**Interfaces:**
- Consumes `FormattedText` from Task 2 and keeps all existing modal data adapters/types unchanged.
- Produces safe rendering of request and solution descriptions in desktop, mobile/modal, approval, and detail contexts.

- [ ] **Step 1: Write failing display source-contract tests**

The test must enumerate every file above and assert that description display sites import/use `FormattedText` where a request or solution description is shown, and that no changed display file uses `dangerouslySetInnerHTML`. Include the request detail page and solution detail component explicitly.

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')
const displayFiles = [
  'src/app/(dashboard)/requests/[requestId]/page.tsx',
  'src/components/requests/request-detail-modal.tsx',
  'src/components/requests/approver-modal.tsx',
  'src/components/requests/solution-modal.tsx',
  'src/components/requests/status-modal.tsx',
  'src/components/requests/final-approval-modal.tsx',
  'src/components/requests/final-approval-resubmit-modal.tsx',
  'src/components/requests/submit-final-approval-modal.tsx',
  'src/components/requests/completed-solution-modal.tsx',
  'src/components/requests/completed-final-modal.tsx',
  'src/components/solutions/solution-detail.tsx',
]

describe('formatted description rendering', () => {
  it('uses the safe React renderer at every request/solution description boundary', () => {
    for (const path of displayFiles) {
      const source = read(path)
      assert.match(source, /FormattedText/, path)
      assert.doesNotMatch(source, /dangerouslySetInnerHTML/, path)
    }
  })
})
```

- [ ] **Step 2: Run the focused test and confirm the missing renderer wiring**

```bash
DATABASE_URL='postgresql://postgres:changeme@localhost:5432/app_db?schema=public' npx tsx --test tests/regression/formatted-description-rendering.test.ts
```

Expected: failure because the views still interpolate raw description strings.

- [ ] **Step 3: Replace raw interpolations with `FormattedText`**

Import `FormattedText` into each display file and replace only request/solution description interpolations. Keep semantic labels and wrapper classes, for example:

```tsx
<p className="text-gray-700 whitespace-pre-wrap">
  <FormattedText source={request.description} />
</p>
```

For the existing solution/request `<p>` or `<div>` wrappers, preserve the current typography classes and remove `whitespace-pre-wrap` only where the renderer’s `<br />` makes it redundant. Do not replace attachment descriptions, rejection reasons, activity comments, or unrelated sub-task descriptions in this task. Ensure repeated request-detail modal branches use the same renderer.

- [ ] **Step 4: Run focused tests, typecheck, and build-facing checks**

```bash
DATABASE_URL='postgresql://postgres:changeme@localhost:5432/app_db?schema=public' npx tsx --test tests/regression/formatted-text.test.ts tests/regression/formatted-text-ui.test.ts tests/regression/formatted-description-rendering.test.ts
DATABASE_URL='postgresql://postgres:changeme@localhost:5432/app_db?schema=public' npx tsc --noEmit
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/(dashboard)/requests/[requestId]/page.tsx' src/components/requests/request-detail-modal.tsx src/components/requests/approver-modal.tsx src/components/requests/solution-modal.tsx src/components/requests/status-modal.tsx src/components/requests/final-approval-modal.tsx src/components/requests/final-approval-resubmit-modal.tsx src/components/requests/submit-final-approval-modal.tsx src/components/requests/completed-solution-modal.tsx src/components/requests/completed-final-modal.tsx src/components/solutions/solution-detail.tsx tests/regression/formatted-description-rendering.test.ts
git commit -m "feat: render formatted descriptions safely in views"
```

---

### Task 5: Escape formatted descriptions in email, PDF, and export outputs

**Files:**
- Modify: `src/server-actions/notifications.ts`
- Modify: `src/lib/pdf.ts`
- Modify: `src/lib/export.ts` only if request/solution descriptions are included in exported rows
- Modify: `src/server-actions/reports.ts` only if its output shape needs a plain-text/parsed field
- Create: `tests/regression/formatted-description-output.test.ts`

**Interfaces:**
- Consumes `renderFormattedTextHtml`, `renderFormattedTextPlainText`, and `truncateFormattedText` from Task 1.
- Produces safe email HTML, readable email text, safe PDF HTML, and delimiter-free plain export values without changing authorization or export package selection.

- [ ] **Step 1: Write failing output-contract tests**

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderFormattedTextHtml, renderFormattedTextPlainText } from '@/lib/formatted-text'

const read = (path: string) => readFileSync(path, 'utf8')

describe('formatted description output contexts', () => {
  it('renders safe HTML and plain text from the shared output helpers', () => {
    assert.equal(renderFormattedTextHtml('A **bold**\n<script>alert(1)</script>'), 'A <strong>bold</strong><br />&lt;script&gt;alert(1)&lt;/script&gt;')
    assert.equal(renderFormattedTextPlainText('A **bold**\nB'), 'A bold\nB')
  })

  it('uses shared formatted output in notification email generation', () => {
    const source = read('src/server-actions/notifications.ts')
    assert.match(source, /renderFormattedTextHtml/)
    assert.match(source, /renderFormattedTextPlainText|visibleFormattedText/)
    assert.doesNotMatch(source, /buildDetailRow\('Description',[^\n]*escapeHtml\(value\)/)
  })

  it('uses the escaped formatted renderer in PDF generation', () => {
    const source = read('src/lib/pdf.ts')
    assert.match(source, /renderFormattedTextHtml/)
    assert.doesNotMatch(source, /escapeHtml\(data\.description\)/)
    assert.doesNotMatch(source, /escapeHtml\(data\.solution\.description\)/)
  })

  it('does not emit dangerous HTML from output helpers', () => {
    const html = renderFormattedTextHtml('**<img src=x onerror=alert(1)>**')
    assert.equal(html, '<strong>&lt;img src=x onerror=alert(1)&gt;</strong>')
    assert.doesNotMatch(html, /<img|onerror=/)
  })
})
```

- [ ] **Step 2: Run focused tests and verify output-wiring failures**

```bash
DATABASE_URL='postgresql://postgres:changeme@localhost:5432/app_db?schema=public' npx tsx --test tests/regression/formatted-description-output.test.ts
```

Expected: helper assertions pass from Task 1; email/PDF source-contract assertions fail until the output contexts are wired.

- [ ] **Step 3: Integrate safe HTML and plain-text email output**

In `notifications.ts`, keep `buildDetailRow` escaped for ordinary values and add a dedicated description row that receives the already-safe result of `renderFormattedTextHtml(truncateSource, 280)`. Do not pass raw user content into a template string without the shared renderer. In `buildRequestDetailsText`, use `renderFormattedTextPlainText(details.description, 280)` so visible text is truncated without raw `**` delimiters and newlines remain newlines. Keep notification headings/messages/link escaping, cost formatting, and request authorization unchanged.

- [ ] **Step 4: Integrate safe formatted output into the PDF renderer**

In `src/lib/pdf.ts`, import `renderFormattedTextHtml` and replace only user request/solution description interpolations with it. The helper owns escaping and emits only `<strong>` and `<br />`; keep `escapeHtml` for titles, names, comments, attachment metadata, and all other fields. Preserve the `.description { white-space: pre-wrap; }` styling for plain values and add only the minimal CSS needed for line breaks if required by the generated HTML. Do not render unsanitized HTML.

- [ ] **Step 5: Normalize plain export values where applicable**

Audit `src/lib/export.ts` and all export row builders. If request or solution descriptions are exported as spreadsheet/plain strings, map them through `renderFormattedTextPlainText` so the export shows visible text and preserved newlines instead of Markdown delimiters. Do not change attachment descriptions unless they are explicitly part of request/solution description output. Leave `reports.ts`’s PDF data shape as source strings so `pdf.ts` remains the single renderer.

- [ ] **Step 6: Run focused tests and typecheck**

```bash
DATABASE_URL='postgresql://postgres:changeme@localhost:5432/app_db?schema=public' npx tsx --test tests/regression/formatted-text.test.ts tests/regression/formatted-description-output.test.ts tests/regression/pdf-package.test.ts
DATABASE_URL='postgresql://postgres:changeme@localhost:5432/app_db?schema=public' npx tsc --noEmit
git diff --check
```

Expected: all focused tests pass and typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/server-actions/notifications.ts src/lib/pdf.ts src/lib/export.ts src/server-actions/reports.ts tests/regression/formatted-description-output.test.ts
git commit -m "feat: preserve formatted descriptions in outputs"
```

---

### Task 6: Browser coverage for editing, submitting, reopening, and safe display

**Files:**
- Create: `tests/e2e/formatted-descriptions.spec.ts`
- Modify: `package.json` only if a focused script is useful
- Modify: `tests/regression/formatted-description-editors.test.ts` only for stable test IDs

**Interfaces:**
- Consumes the completed editor and renderer behavior from Tasks 2–5.
- Produces an opt-in Playwright gate requiring a disposable authenticated requester environment; it must not mutate production data.

- [ ] **Step 1: Write the failing browser test and explicit environment contract**

The test must require these variables before running: `TEST_BASE_URL`, `E2E_REQUESTER_EMAIL`, `E2E_REQUESTER_PASSWORD`, and `E2E_FORMATTED_REQUEST_ID` for a disposable request the user may edit/resubmit. Missing variables must fail with a clear message, not silently skip. The test should:

1. Log in at `/sign-in`.
2. Open the request’s rejection/resubmission flow using the request ID.
3. Fill the description with `Before **bold**\nAfter <script>alert(1)</script>`.
4. Select `bold`, click the `formatted-text-bold` control, and assert the textarea value contains `**bold**` exactly once.
5. Enter a newline and submit/resubmit.
6. Reopen the request detail modal/page.
7. Assert the visible rendered result contains `bold`, has a `<strong>` descendant, has a `<br>` descendant, and displays `<script>alert(1)</script>` as text rather than a script element.

Use stable labels/roles and `expect.poll`/URL waits instead of arbitrary sleeps. The test must not delete unrelated attachments or make production changes.

- [ ] **Step 2: Run the browser test in the expected red/missing-environment state**

```bash
npm run test:e2e -- tests/e2e/formatted-descriptions.spec.ts
```

Expected: the test reports the missing disposable environment variables if they are not supplied; with the variables supplied against a disposable local target, it fails until the editor/display wiring is complete.

- [ ] **Step 3: Add stable selectors only where needed and implement the browser flow**

Use the existing `data-testid="formatted-text-bold"` for the toolbar. Add a narrow test ID to the request/solution description display wrapper only if role/text locators cannot distinguish the field. Do not add test-only branches or bypass server actions. Ensure reopening uses the real request flow and verifies the parsed output rather than inspecting source text.

- [ ] **Step 4: Run the browser gate against a disposable local environment**

```bash
TEST_BASE_URL=http://localhost:3000 \
E2E_REQUESTER_EMAIL='disposable-requester@example.test' \
E2E_REQUESTER_PASSWORD='disposable-password' \
E2E_FORMATTED_REQUEST_ID='disposable-request-uuid' \
npm run test:e2e -- tests/e2e/formatted-descriptions.spec.ts
```

Expected: the browser test passes against a locally seeded request. If no disposable seeded values are available, record the gate as pending; do not substitute production credentials or mutate the production database.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/formatted-descriptions.spec.ts tests/regression/formatted-description-editors.test.ts package.json
 git commit -m "test: cover formatted description browser flow"
```

---

### Task 7: Phase 3 integration verification and review gate

**Files:**
- No additional production files unless a review-driven fix is required.

- [ ] **Step 1: Run the complete static suite**

```bash
cd .worktrees/approval-levels-and-formatted-descriptions
DATABASE_URL='postgresql://postgres:changeme@localhost:5432/app_db?schema=public' npm run check
git diff --check
```

Expected: all baseline tests plus the new parser/UI/editor/render/output tests pass with zero failures.

- [ ] **Step 2: Run the production build**

```bash
DATABASE_URL='postgresql://postgres:changeme@localhost:5432/app_db?schema=public' npm run build
```

Expected: exit 0. Existing warnings are acceptable only if they were present before the Phase 3 changes; no new TypeScript, compilation, or unsafe-rendering errors may appear.

- [ ] **Step 3: Run a source safety audit**

```bash
grep -R "dangerouslySetInnerHTML" -n src tests || true
grep -R "renderFormattedTextHtml" -n src/server-actions/notifications.ts src/lib/pdf.ts
git diff --name-only -- prisma/schema.prisma prisma/migrations
```

Expected: no Phase 3 code adds `dangerouslySetInnerHTML`; email/PDF use the shared escaped renderer; no schema or migration changes exist.

- [ ] **Step 4: Commit only review corrections**

If a review finds a real missing output boundary, add a focused regression test first, watch it fail, implement the narrow correction, rerun the focused and full checks, and commit that correction. Do not commit `.next`, formatter, Prisma, or `.pi-subagents` artifacts.
