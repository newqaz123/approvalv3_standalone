# Rich HTML Descriptions and PDF Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let submitters author request/solution descriptions with a TipTap rich-text editor (bold, italic, underline, strikethrough, lists, H2/H3, links), render that HTML safely everywhere alongside legacy `**bold**` rows, and reproduce the formatting in the completed-approval PDF export.

**Architecture:** A whitelist sanitizer (`sanitize-html`) guards every boundary — editor output, React render, email, PDF. `FormattedText` gains dual-format detection (HTML vs legacy `**bold**` tokenizer) so no data migration is needed. The editor is a lazy-loaded TipTap wrapper behind the existing controlled-component contract, swapped into the five authoring surfaces. The existing Puppeteer export reuses the same sanitized HTML with print CSS.

**Tech Stack:** TipTap v3 (`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-underline`, `@tiptap/extension-link`), `sanitize-html` v2, Next.js 15 dynamic imports, existing node:test regression suites.

**Spec:** `docs/superpowers/specs/2026-08-15-rich-html-descriptions-design.md`

## Global Constraints

- Sanitizer whitelist (exact): tags `p, br, strong, em, u, s, ul, ol, li, h2, h3, a`; only attribute `a[href]` restricted to `http:`, `https:`, `mailto:`; links forced to `target="_blank" rel="noopener noreferrer"`; all classes/styles/ids/event handlers stripped.
- Detection rule: `containsRichTextHtml(source)` returns true only when the first non-whitespace character of `source` is `<` AND the source contains at least one whitelisted tag. Everything else takes the legacy `**bold**` tokenizer path.
- Never render `dangerouslySetInnerHTML`, email HTML, or PDF HTML without passing through `sanitizeRichText` first — no exceptions anywhere in this codebase.
- Description Zod limits change from `max(5000)` to `max(20000)` at all four schema sites; `min` non-empty checks must validate visible text after tag-stripping (so `<p><br></p>` is rejected).
- No DB migrations, no server-action signature changes, no workflow/status changes, no changes to export-builder item selection or eligibility.
- Editor must be lazy-loaded (`next/dynamic`, `ssr: false`) and degrade to `FormattedTextarea` on chunk-load failure.
- Keep the existing single-quote/no-semicolon style in files you create; existing files now use the reformatted style — follow whatever style the file already has.
- Run `npm run check` after each task; commit per task with the exact messages given.
- Never stage `.pi/` or `.pi-subagents/`.

---

### Task 1: Rich-text sanitizer module

**Files:**

- Create: `src/lib/rich-text-sanitizer.ts`
- Create: `tests/regression/rich-text-sanitizer.test.ts`
- Modify: `package.json` (add `sanitize-html` + `@types/sanitize-html`)

**Interfaces:**

- Consumes: nothing (leaf module).
- Produces (used by Tasks 2, 3, 5, 6):
  - `sanitizeRichText(html: string): string` — returns whitelisted HTML; never throws.
  - `containsRichTextHtml(source: string): boolean` — first-non-whitespace-char-is-`<` AND contains a whitelisted tag.
  - `richTextToPlainText(html: string): string` — sanitize-html with `allowedTags: []`, decoded entities, whitespace-collapsed.

- [ ] **Step 1: Install dependencies**

```bash
npm install sanitize-html
npm install -D @types/sanitize-html
```

- [ ] **Step 2: Write the failing tests** (`tests/regression/rich-text-sanitizer.test.ts`)

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  sanitizeRichText,
  containsRichTextHtml,
  richTextToPlainText,
} from '@/lib/rich-text-sanitizer'

describe('sanitizeRichText', () => {
  it('keeps every whitelisted tag and its text', () => {
    const html = '<h2>Title</h2><p>Plain <strong>bold</strong> <em>italic</em> <u>under</u> <s>strike</s></p><ul><li>one</li><li>two</li></ul><ol><li>first</li></ol><h3>Sub</h3><p><a href="https://example.com">link</a></p>'
    const out = sanitizeRichText(html)
    for (const tag of ['<h2>', '<strong>', '<em>', '<u>', '<s>', '<ul>', '<ol>', '<li>', '<h3>']) {
      assert.ok(out.includes(tag), `missing ${tag}`)
    }
    assert.ok(out.includes('href="https://example.com"'))
    assert.ok(out.includes('target="_blank"'))
    assert.ok(out.includes('rel="noopener noreferrer"'))
  })

  it('strips scripts, event handlers, and hostile hrefs', () => {
    const hostile = '<p onclick="x()">a</p><script>alert(1)</script><a href="javascript:alert(1)">j</a><a href="data:text/html,x">d</a><img src=x onerror=alert(1)>'
    const out = sanitizeRichText(hostile)
    assert.ok(!out.includes('script'))
    assert.ok(!out.includes('onclick'))
    assert.ok(!out.includes('javascript:'))
    assert.ok(!out.includes('data:text/html'))
    assert.ok(!out.includes('<img'))
  })

  it('strips disallowed structural markup and styling attributes', () => {
    const out = sanitizeRichText('<table><tr><td>t</td></tr></table><p style="color:red" class="x" id="y">keep</p><span style="font-size:99px">s</span>')
    assert.ok(!out.includes('<table'))
    assert.ok(!out.includes('style='))
    assert.ok(!out.includes('class='))
    assert.ok(!out.includes('id='))
    assert.ok(out.includes('keep'))
  })

  it('never throws on garbage input', () => {
    assert.doesNotThrow(() => sanitizeRichText('<<<>>><p'))
    assert.doesNotThrow(() => sanitizeRichText(''))
  })
})

describe('containsRichTextHtml', () => {
  it('accepts TipTap-shaped sources starting with a whitelisted tag', () => {
    assert.ok(containsRichTextHtml('<p>hi</p>'))
    assert.ok(containsRichTextHtml('  <h2>t</h2>'))
    assert.ok(containsRichTextHtml('<ul><li>x</li></ul>'))
  })

  it('rejects prose that merely mentions a tag mid-sentence', () => {
    assert.ok(!containsRichTextHtml('Use <h2> for headings'))
    assert.ok(!containsRichTextHtml('5 < 6 and **bold**'))
    assert.ok(!containsRichTextHtml('plain **bold** text'))
    assert.ok(!containsRichTextHtml(''))
  })
})

describe('richTextToPlainText', () => {
  it('strips tags and decodes entities', () => {
    assert.equal(richTextToPlainText('<p>a &amp; b</p><strong>c</strong>').trim(), 'a & b c')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx tsx --test tests/regression/rich-text-sanitizer.test.ts`
Expected: FAIL — cannot resolve `@/lib/rich-text-sanitizer`.

- [ ] **Step 4: Implement** `src/lib/rich-text-sanitizer.ts`

```ts
import sanitizeHtml from 'sanitize-html'

export const RICH_TEXT_ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'u', 's', 'ul', 'ol', 'li', 'h2', 'h3', 'a',
] as const

/** Whitelist-sanitize authored description HTML. Never throws. */
export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [...RICH_TEXT_ALLOWED_TAGS],
    allowedAttributes: { a: ['href', 'target', 'rel'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer' },
      }),
    },
    disallowedTagsMode: 'discard',
  })
}

const WHITELIST_TAG_RE = new RegExp(
  `<(?:${RICH_TEXT_ALLOWED_TAGS.join('|')})(?:\\s|/|>)`,
  'i',
)

/** True only when the source starts with `<` (after whitespace) and contains a whitelisted tag. */
export function containsRichTextHtml(source: string): boolean {
  const trimmed = source.trimStart()
  if (!trimmed.startsWith('<')) return false
  return WHITELIST_TAG_RE.test(trimmed)
}

/** Visible text of authored HTML — tags stripped, entities decoded. */
export function richTextToPlainText(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [],
    allowedAttributes: {},
  })
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsx --test tests/regression/rich-text-sanitizer.test.ts`
Expected: PASS (all suites).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/rich-text-sanitizer.ts tests/regression/rich-text-sanitizer.test.ts
git commit -m 'feat: whitelist rich-text sanitizer module'
```

---

### Task 2: Dual-format rendering in FormattedText

**Files:**

- Modify: `src/components/ui/formatted-text.tsx` (whole render function, currently ~40 lines)
- Modify: `tests/regression/formatted-text.test.ts` (append suites)

**Interfaces:**

- Consumes: `containsRichTextHtml`, `sanitizeRichText`, `richTextToPlainText` from Task 1; existing `tokenizeFormattedText`, `truncateFormattedText` from `@/lib/formatted-text`.
- Produces: unchanged public API `FormattedText({ source, className, maxVisibleCharacters })`. Behavior: rich source + no truncation → sanitized HTML render; rich source + truncation → truncated plain text (tags stripped); legacy source → existing tokenizer path unchanged.

- [ ] **Step 1: Write the failing tests** (append to `tests/regression/formatted-text.test.ts`)

```ts
describe('FormattedText dual-format rendering', () => {
  it('renders sanitized HTML when the source starts with whitelisted markup', () => {
    const source = read('src/components/ui/formatted-text.tsx')
    assert.match(source, /import \{[^}]*containsRichTextHtml[^}]*\} from ['"]@\/lib\/rich-text-sanitizer['"]/)
    assert.match(source, /dangerouslySetInnerHTML/)
    assert.match(source, /sanitizeRichText\(/)
    // The HTML branch must run BEFORE tokenizer truncation is applied.
    assert.ok(
      source.indexOf('containsRichTextHtml') < source.indexOf('truncateFormattedText'),
    )
  })

  it('truncates rich sources to plain text when maxVisibleCharacters is set', () => {
    const source = read('src/components/ui/formatted-text.tsx')
    assert.match(source, /richTextToPlainText\(/)
  })

  it('keeps the legacy tokenizer path for non-HTML sources', () => {
    const source = read('src/components/ui/formatted-text.tsx')
    assert.match(source, /tokenizeFormattedText\(/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test tests/regression/formatted-text.test.ts`
Expected: FAIL — the three new assertions (no `containsRichTextHtml` import etc.).

- [ ] **Step 3: Implement** — rewrite the render function in `src/components/ui/formatted-text.tsx`:

```tsx
import * as React from 'react'

import { tokenizeFormattedText, truncateFormattedText } from '@/lib/formatted-text'
import {
  containsRichTextHtml,
  richTextToPlainText,
  sanitizeRichText,
} from '@/lib/rich-text-sanitizer'
import { cn } from '@/lib/utils'

export type FormattedTextProps = {
  source?: string | null
  className?: string
  maxVisibleCharacters?: number
}

export function FormattedText({
  source,
  className,
  maxVisibleCharacters,
}: FormattedTextProps) {
  const text = source ?? ''

  // Authored rich HTML: sanitized before it may touch dangerouslySetInnerHTML.
  if (containsRichTextHtml(text)) {
    if (maxVisibleCharacters === undefined) {
      const html = { __html: sanitizeRichText(text) }
      if (className) {
        return <span className={cn(className)} dangerouslySetInnerHTML={html} />
      }
      return <span dangerouslySetInnerHTML={html} />
    }
    // Truncated contexts (tables, previews) show plain text so slicing can't
    // break tags mid-stream.
    const plain = richTextToPlainText(text)
    const truncated = truncateFormattedText(plain, maxVisibleCharacters)
    const tokens = tokenizeFormattedText(
      typeof truncated === 'string' ? truncated : plain.slice(0, maxVisibleCharacters),
    )
    return <LegacyNodes tokens={tokens} className={className} />
  }

  const tokens =
    maxVisibleCharacters === undefined
      ? tokenizeFormattedText(text)
      : truncateFormattedText(text, maxVisibleCharacters)
  return <LegacyNodes tokens={tokens} className={className} />
}

function LegacyNodes({
  tokens,
  className,
}: {
  tokens: ReturnType<typeof tokenizeFormattedText>
  className?: string
}) {
  const nodes = tokens.map((token, index) => {
    if (token.type === 'lineBreak') {
      return <br key={`lb-${index}`} />
    }
    if (token.type === 'bold') {
      return <strong key={`b-${index}`}>{token.value}</strong>
    }
    return <React.Fragment key={`t-${index}`}>{token.value}</React.Fragment>
  })

  if (className) {
    return <span className={cn(className)}>{nodes}</span>
  }
  return <>{nodes}</>
}
```

Note: check `truncateFormattedText`'s actual return type in `src/lib/formatted-text.ts` (it returns a string today; the defensive `typeof` branch above collapses to `plain.slice(...)` if that ever changes). Simplify to a direct call if it returns `string`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test tests/regression/formatted-text.test.ts tests/regression/formatted-text-ui.test.ts`
Expected: PASS (new suites + all pre-existing formatted-text suites).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/formatted-text.tsx tests/regression/formatted-text.test.ts
git commit -m 'feat: dual-format FormattedText rendering with sanitized HTML path'
```

---

### Task 3: RichTextEditor component

**Files:**

- Create: `src/components/rich-text/rich-text-editor.tsx` (the TipTap implementation)
- Create: `src/components/rich-text/rich-text-editor-lazy.tsx` (next/dynamic wrapper + fallback)
- Create: `tests/regression/rich-text-editor.test.ts`
- Modify: `package.json` (tiptap deps)

**Interfaces:**

- Consumes: `sanitizeRichText` from Task 1.
- Produces (used by Task 4):
  - Named export of `rich-text-editor-lazy.tsx`: `RichTextEditor({ value: string, onChange: (next: string) => void, disabled?: boolean, id?: string, minHeight?: number })` — NOTE: `onChange` receives the string directly, NOT a ChangeEvent. There is no `placeholder` prop: every call site already renders a `<Label>` above the field.
  - Default export of `rich-text-editor.tsx` is the TipTap implementation itself.
  - Renders `FormattedTextarea` (existing component) as its loading fallback and on chunk-load error.

- [ ] **Step 1: Install dependencies**

```bash
npm install @tiptap/react @tiptap/starter-kit @tiptap/extension-underline @tiptap/extension-link @tiptap/pm
```

- [ ] **Step 2: Write the failing tests** (`tests/regression/rich-text-editor.test.ts`)

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

describe('RichTextEditor implementation', () => {
  const source = read('src/components/rich-text/rich-text-editor.tsx')

  it('configures only the approved extension set', () => {
    for (const ext of ['StarterKit', 'Underline', 'Link']) {
      assert.match(source, new RegExp(`\\b${ext}\\b`))
    }
    assert.match(source, /heading:\s*\{\s*levels:\s*\[2,\s*3\]/)
    assert.match(source, /link:\s*\{[^}]*autolink/)
  })

  it('sanitizes editor output before it reaches the parent', () => {
    assert.match(source, /sanitizeRichText\((?:editor|current)\.getHTML\(\)\)/)
  })

  it('exposes an accessible toolbar with toggling state', () => {
    assert.match(source, /aria-label=/)
    assert.match(source, /aria-pressed=/)
    assert.match(source, /focus-visible/)
  })
})

describe('RichTextEditor lazy wrapper', () => {
  const lazy = read('src/components/rich-text/rich-text-editor-lazy.tsx')

  it('loads the editor dynamically with ssr disabled', () => {
    assert.match(lazy, /next\/dynamic/)
    assert.match(lazy, /ssr:\s*false/)
  })

  it('falls back to FormattedTextarea while loading', () => {
    assert.match(lazy, /FormattedTextarea/)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx tsx --test tests/regression/rich-text-editor.test.ts`
Expected: FAIL — files do not exist.

- [ ] **Step 4: Implement** `src/components/rich-text/rich-text-editor.tsx`:

```tsx
'use client'

import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  List, ListOrdered, Heading2, Heading3, Link as LinkIcon,
  Undo2, Redo2,
} from 'lucide-react'
import { useEffect, useRef } from 'react'
import { sanitizeRichText } from '@/lib/rich-text-sanitizer'

export interface RichTextEditorProps {
  value: string
  onChange: (next: string) => void
  disabled?: boolean
  id?: string
  minHeight?: number
}

const TOOLBAR_BUTTON =
  'inline-flex h-8 min-h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500'

function ToolbarButton({
  editor, label, active, enabled, onClick, children,
}: {
  editor: Editor | null
  label: string
  active: boolean
  enabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={!enabled || !editor}
      onClick={onClick}
      className={TOOLBAR_BUTTON + (active ? ' bg-slate-200 text-slate-900' : '')}
    >
      {children}
    </button>
  )
}

export default function RichTextEditor({
  value, onChange, disabled, id, minHeight = 160,
}: RichTextEditorProps) {
  const lastEmitted = useRef<string>(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        // StarterKit v3 bundles link/underline; explicit extensions below
        // override their config so only http/https/mailto survive autolink.
        link: false,
        underline: false,
      }),
      Underline,
      Link.configure({ autolink: true, openOnClick: false }),
    ],
    content: value || '',
    editable: !disabled,
    editorProps: {
      attributes: {
        id: id ?? '',
        'aria-multiline': 'true',
        role: 'textbox',
        class:
          'prose-rich-text min-h-[var(--rich-min-h)] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
        style: `--rich-min-h: ${minHeight}px`,
      },
    },
    onUpdate: ({ editor: current }) => {
      const next = sanitizeRichText(current.getHTML())
      if (next !== lastEmitted.current) {
        lastEmitted.current = next
        onChange(next)
      }
    },
  })

  // External value changes (e.g. modal reset) sync into the editor once.
  useEffect(() => {
    if (!editor) return
    if (value === lastEmitted.current) return
    lastEmitted.current = null
    editor.commands.setContent(value || '')
  }, [value, editor])

  useEffect(() => {
    if (editor) editor.setEditable(!disabled)
  }, [disabled, editor])

  if (!editor) return null

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Formatting">
        <ToolbarButton editor={editor} label="Bold" active={editor.isActive('bold')} enabled={editor.can().chain().focus().toggleBold().run()} onClick={() => editor.chain().focus().toggleBold().run()}><Bold className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton editor={editor} label="Italic" active={editor.isActive('italic')} enabled={editor.can().chain().focus().toggleItalic().run()} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton editor={editor} label="Underline" active={editor.isActive('underline')} enabled={editor.can().chain().focus().toggleUnderline().run()} onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton editor={editor} label="Strikethrough" active={editor.isActive('strike')} enabled={editor.can().chain().focus().toggleStrike().run()} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton editor={editor} label="Bullet list" active={editor.isActive('bulletList')} enabled={editor.can().chain().focus().toggleBulletList().run()} onClick={() => editor.chain().focus().toggleBulletList().run()}><List className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton editor={editor} label="Numbered list" active={editor.isActive('orderedList')} enabled={editor.can().chain().focus().toggleOrderedList().run()} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton editor={editor} label="Heading 2" active={editor.isActive('heading', { level: 2 })} enabled={editor.can().chain().focus().toggleHeading({ level: 2 }).run()} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton editor={editor} label="Heading 3" active={editor.isActive('heading', { level: 3 })} enabled={editor.can().chain().focus().toggleHeading({ level: 3 }).run()} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton editor={editor} label="Add link" active={editor.isActive('link')} enabled={editor.can().chain().focus().setLink({ href: 'https://example.com' }).run()} onClick={() => {
          const previous = editor.getAttributes('link').href as string | undefined
          const url = window.prompt('Link URL (https:// or mailto:)', previous ?? 'https://')
          if (url === null) return
          if (url === '') { editor.chain().focus().unsetLink().run(); return }
          editor.chain().focus().setLink({ href: url }).run()
        }}><LinkIcon className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton editor={editor} label="Undo" active={false} enabled={editor.can().chain().focus().undo().run()} onClick={() => editor.chain().focus().undo().run()}><Undo2 className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton editor={editor} label="Redo" active={false} enabled={editor.can().chain().focus().redo().run()} onClick={() => editor.chain().focus().redo().run()}><Redo2 className="h-4 w-4" /></ToolbarButton>
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}
```

(No placeholder element: the modal's existing `<Label>` names the field on every call site.)

Then `src/components/rich-text/rich-text-editor-lazy.tsx`:

```tsx
'use client'

import { Component, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { FormattedTextarea } from '@/components/ui/formatted-textarea'
import type { RichTextEditorProps } from '@/components/rich-text/rich-text-editor'

const RichTextEditorInner = dynamic<RichTextEditorProps>(
  () => import('@/components/rich-text/rich-text-editor'),
  {
    ssr: false,
    loading: () => <FormattedTextarea rows={5} disabled />,
  },
)

class ChunkErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/**
 * Controlled rich-text field. Degrades to FormattedTextarea while the
 * TipTap chunk loads and permanently if chunk loading hard-fails.
 */
export function RichTextEditor(props: RichTextEditorProps) {
  return (
    <ChunkErrorBoundary
      fallback={
        <FormattedTextarea
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          disabled={props.disabled}
          rows={5}
        />
      }
    >
      <RichTextEditorInner {...props} />
    </ChunkErrorBoundary>
  )
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsx --test tests/regression/rich-text-editor.test.ts && npx tsc --noEmit`
Expected: PASS + tsc clean.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/components/rich-text/ tests/regression/rich-text-editor.test.ts
git commit -m 'feat: lazy TipTap RichTextEditor with sanitized output'
```

---

### Task 4: Deploy the editor to all five authoring surfaces

**Files:**

- Modify: `src/components/requests/submitter-modal.tsx` (two fields: `description` at ~line 706, `solutionDescription` at ~line 756)
- Modify: `src/components/solutions/solution-form.tsx` (~line 313)
- Modify: `src/components/requests/resubmit-request-dialog.tsx` (~line 171)
- Modify: `src/components/requests/request-resubmit-modal.tsx` (~line 193)
- Modify: `tests/regression/formatted-description-editors.test.ts` (existing suite)

**Interfaces:**

- Consumes: `RichTextEditor` from `@/components/rich-text/rich-text-editor-lazy` (Task 3).
- Produces: no interface changes — state variables stay `string`, server actions unchanged.

- [ ] **Step 1: Update the failing tests first** — in `tests/regression/formatted-description-editors.test.ts`, replace each `FormattedTextarea` expectation for the five surfaces with:

```ts
assert.match(source, /RichTextEditor/)
assert.doesNotMatch(source, /<FormattedTextarea/)
```

(the submitter-modal file must drop its `FormattedTextarea` import entirely once both fields migrate).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test tests/regression/formatted-description-editors.test.ts`
Expected: FAIL — no `RichTextEditor` usage yet.

- [ ] **Step 3: Implement the swaps.** Each site's pattern:

Controlled-state sites (`description`, `solutionDescription`, request-resubmit-modal) change from

```tsx
<FormattedTextarea
  id="description"
  value={description}
  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
  placeholder="Describe the improvement request in detail..."
  rows={5}
  className="mt-1.5"
/>
```

to

```tsx
<RichTextEditor
  id="description"
  value={description}
  onChange={setDescription}
  minHeight={140}
/>
```

react-hook-form sites (solution-form, resubmit-request-dialog spread `{...field}`) change from

```tsx
<FormattedTextarea
  placeholder="Provide detailed information about your solution..."
  rows={6}
  {...field}
/>
```

to

```tsx
<RichTextEditor
  value={field.value ?? ''}
  onChange={field.onChange}
  minHeight={160}
/>
```

Apply to: submitter-modal `description` field, submitter-modal `solutionDescription` field, solution-form description field, resubmit-request-dialog description field, request-resubmit-modal description field. Remove the now-unused `FormattedTextarea` import from each modified file (verify no other usage remains in that file first).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test tests/regression/formatted-description-editors.test.ts && npx tsc --noEmit`
Expected: PASS + tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/requests/submitter-modal.tsx src/components/solutions/solution-form.tsx src/components/requests/resubmit-request-dialog.tsx src/components/requests/request-resubmit-modal.tsx tests/regression/formatted-description-editors.test.ts
git commit -m 'feat: rich text editors on all description authoring surfaces'
```

---

### Task 5: Email and PDF render paths

**Files:**

- Modify: `src/server-actions/notifications.ts` (~lines 223, 252)
- Modify: `src/lib/pdf.ts` (~lines 373, 389)
- Modify: `tests/regression/formatted-description-output-contexts.test.ts`, `tests/regression/pdf-package-helpers.test.ts` or a new `tests/regression/rich-pdf-render.test.ts`

**Interfaces:**

- Consumes: Task 1 helpers.
- Produces: `renderDescriptionHtml(source: string, maxChars?: number): string` and `renderDescriptionPlainText(source: string, maxChars?: number): string` exported from `src/lib/formatted-text.ts` — shared by email and PDF so both embed identical output.

- [ ] **Step 1: Write the failing tests** (new `tests/regression/rich-pdf-render.test.ts`)

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  renderDescriptionHtml,
  renderDescriptionPlainText,
} from '@/lib/formatted-text'

const read = (path: string) => readFileSync(path, 'utf8')

describe('renderDescriptionHtml', () => {
  it('returns sanitized HTML for rich sources and legacy markup otherwise', () => {
    assert.ok(renderDescriptionHtml('<p onclick="x()">hi</p>').includes('<p>hi</p>'))
    assert.ok(!renderDescriptionHtml('<p onclick="x()">hi</p>').includes('onclick'))
    assert.equal(renderDescriptionHtml('plain **b**'), renderDescriptionHtml('plain **b**'))
    assert.ok(renderDescriptionHtml('plain **b**').includes('<strong>b</strong>'))
  })

  it('plain-text helper strips tags and keeps bold markers for legacy', () => {
    assert.ok(!renderDescriptionPlainText('<p>a<b>b</b></p>').includes('<'))
    assert.ok(renderDescriptionPlainText('x **y**').includes('y'))
  })
})

describe('PDF and email render wiring', () => {
  it('PDF routes descriptions through the shared helper', () => {
    const pdf = read('src/lib/pdf.ts')
    assert.match(pdf, /renderDescriptionHtml\(/)
    assert.doesNotMatch(pdf, /renderFormattedTextHtml\(data\.(solution\.)?description\)/)
  })

  it('email routes descriptions through the shared helpers', () => {
    const mail = read('src/server-actions/notifications.ts')
    assert.match(mail, /renderDescriptionHtml\(/)
    assert.match(mail, /renderDescriptionPlainText\(/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test tests/regression/rich-pdf-render.test.ts`
Expected: FAIL — helpers and wiring absent.

- [ ] **Step 3: Implement helpers** in `src/lib/formatted-text.ts`:

```ts
import {
  containsRichTextHtml,
  richTextToPlainText,
  sanitizeRichText,
} from '@/lib/rich-text-sanitizer'

/** One description renderer for email + PDF: sanitized HTML for rich rows, legacy markup otherwise. */
export function renderDescriptionHtml(source: string, maxChars?: number): string {
  if (containsRichTextHtml(source)) {
    if (maxChars === undefined) return sanitizeRichText(source)
    // Truncate on the visible text only — never slice tags.
    return escapeFormattedTextHtml(richTextToPlainText(source).slice(0, maxChars))
  }
  return renderFormattedTextHtml(source, maxChars)
}

export function renderDescriptionPlainText(source: string, maxChars?: number): string {
  if (containsRichTextHtml(source)) {
    const plain = richTextToPlainText(source)
    return maxChars === undefined ? plain : plain.slice(0, maxChars)
  }
  return renderFormattedTextPlainText(source, maxChars)
}
```

Then in `src/lib/pdf.ts`, replace both description call sites:

```ts
// line ~373
<div class="description">${renderDescriptionHtml(data.solution.description)}</div>
// line ~389
<div class="description">${renderDescriptionHtml(data.description)}</div>
```

and add print CSS inside the existing `<style>` block (~line 304 region):

```css
.description h2 { font-size: 16px; font-weight: 700; margin: 12px 0 4px; }
.description h3 { font-size: 14px; font-weight: 700; margin: 10px 0 4px; }
.description ul, .description ol { margin: 6px 0 6px 20px; padding: 0; }
.description li { margin: 2px 0; }
.description a { color: #1d4ed8; text-decoration: underline; }
```

In `src/server-actions/notifications.ts`, replace line ~223 `renderFormattedTextHtml(details.description, 280)` with `renderDescriptionHtml(details.description, 280)` and line ~252 `renderFormattedTextPlainText(details.description, 280)` with `renderDescriptionPlainText(details.description, 280)` (update the import line accordingly).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test tests/regression/rich-pdf-render.test.ts tests/regression/formatted-description-output-contexts.test.ts tests/regression/pdf-package-helpers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/formatted-text.ts src/lib/pdf.ts src/server-actions/notifications.ts tests/regression/rich-pdf-render.test.ts
git commit -m 'feat: sanitized rich descriptions in email and PDF exports'
```

---

### Task 6: Validation limits

**Files:**

- Modify: `src/server-actions/requests.ts` (lines ~16 and ~2089)
- Modify: `src/lib/schemas/solution-schemas.ts` (lines ~10 and ~45)
- Modify: `tests/regression/gap-improvements.test.ts` (the 5000-character limit assertion)

**Interfaces:**

- Consumes: `richTextToPlainText` from Task 1 (via a small shared predicate).
- Produces: `descriptionSchema` exported from `src/lib/schemas/solution-schemas.ts` — `z.string().max(20000, 'Description too long').refine(visibleNonEmpty)` — reused by all four sites.

- [ ] **Step 1: Write the failing test** — update the existing assertion in `tests/regression/gap-improvements.test.ts` from keeping the 5000 limit to:

```ts
assert.match(editedFiles, /max\(20000, ['"]Description too long['"]\)/)
assert.match(schemas, /richTextToPlainText/)
```

plus a behavioral suite in `tests/regression/rich-description-validation.test.ts`:

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { descriptionSchema } from '@/lib/schemas/solution-schemas'

describe('descriptionSchema', () => {
  it('accepts rich HTML up to 20000 stored characters', () => {
    const html = '<p>' + 'a'.repeat(19990) + '</p>'
    assert.doesNotThrow(() => descriptionSchema.parse(html))
  })

  it('rejects visually-empty rich text', () => {
    assert.throws(() => descriptionSchema.parse('<p><br></p>'))
    assert.throws(() => descriptionSchema.parse('<p>   </p>'))
  })

  it('still rejects plain empties and over-length', () => {
    assert.throws(() => descriptionSchema.parse(''))
    assert.throws(() => descriptionSchema.parse('x'.repeat(20001)))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test tests/regression/rich-description-validation.test.ts`
Expected: FAIL — `descriptionSchema` not exported.

- [ ] **Step 3: Implement** — in `src/lib/schemas/solution-schemas.ts` add and use:

```ts
import { richTextToPlainText } from '@/lib/rich-text-sanitizer'

const visibleNonEmpty = (value: string) => {
  const visible = containsRichTextHtml(value)
    ? richTextToPlainText(value)
    : value
  return visible.trim().length > 0
}

export const descriptionSchema = z
  .string()
  .max(20000, 'Description too long')
  .refine(visibleNonEmpty, 'Description is required')
```

(import `containsRichTextHtml` too). Replace the four inline `description: z.string().min(1, 'Description is required').max(5000, ...)` fields with `description: descriptionSchema` in both files.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test tests/regression/rich-description-validation.test.ts tests/regression/gap-improvements.test.ts tests/regression/solution-upload-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/schemas/solution-schemas.ts src/server-actions/requests.ts tests/regression/rich-description-validation.test.ts tests/regression/gap-improvements.test.ts
git commit -m 'feat: 20000-char rich description validation with visible-text floor'
```

---

### Task 7: Full verification and browser acceptance

**Files:** none created — verification only.

- [ ] **Step 1: Full check**

Run: `npm run check`
Expected: tsc clean + tools 68/68 + regressions all PASS.

- [ ] **Step 2: Build the Docker preview and run browser acceptance**

Rebuild the app image on current HEAD, run it against the healthy `approval-db` (no migrations, no seeds), then at `http://localhost:3101`:

1. Sign in (`admin@example.com` / `changeme`).
2. New Request → type description → apply bold, italic, underline, strikethrough, bullet list, numbered list, H2, link → submit.
3. Open the request from `/requests` — formatting renders in the detail modal.
4. Legacy request with `**bold**` description — renders exactly as before.
5. Submit a solution with a rich description (engineering account).
6. Complete a full approval chain on that request → open the completed export → the PDF shows headings, lists, and link styling.
7. Check an approval email (or the notification HTML) shows formatted description.

- [ ] **Step 3: Stop the preview container when inspection is done**

```bash
docker stop <preview-container> && docker image rm <preview-image>
```

- [ ] **Step 4: Report**

Report results; do not merge or push without explicit instruction.
