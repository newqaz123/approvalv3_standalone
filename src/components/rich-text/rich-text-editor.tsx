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
import { useEffect, useRef, type ReactNode } from 'react'
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

/** Only these link schemes may be applied client-side; the sanitizer stays the authoritative gate. */
const ALLOWED_URL_RE = /^(?:https?|mailto):/i

function ToolbarButton({
  editor, label, active, enabled, disabled, onClick, children,
}: {
  editor: Editor | null
  label: string
  active: boolean
  enabled: boolean
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled || !enabled || !editor}
      onClick={onClick}
      className={TOOLBAR_BUTTON + (active ? ' bg-slate-200 text-slate-900' : '')}
    >
      {children}
    </button>
  )
}

export default function RichTextEditor({
  value, onChange, disabled = false, id, minHeight = 160,
}: RichTextEditorProps) {
  const lastEmitted = useRef<string | null>(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        // StarterKit v3 bundles link/underline; explicit extensions below
        // override their config so only http/https/mailto survive autolink.
        link: false,
        underline: false,
        // Disable every bundled member outside the approved schema so
        // pastes and shortcuts cannot produce markup the sanitizer would
        // strip (users would silently lose content). dropcursor/gapcursor
        // are editor-behavior extensions, not schema marks — they stay on.
        blockquote: false,
        code: false,
        codeBlock: false,
        hardBreak: false,
        horizontalRule: false,
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
    // Loop guard: record the incoming value BEFORE setContent so the onUpdate
    // it triggers compares equal against lastEmitted.current and skips
    // re-emitting the same value back to the parent (no onChange feedback loop).
    lastEmitted.current = value
    editor.commands.setContent(value || '')
  }, [value, editor])

  useEffect(() => {
    if (editor) editor.setEditable(!disabled)
  }, [disabled, editor])

  if (!editor) return null

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Formatting">
        <ToolbarButton editor={editor} label="Bold" active={editor.isActive('bold')} enabled={editor.can().chain().focus().toggleBold().run()} disabled={disabled} onClick={() => editor.chain().focus().toggleBold().run()}><Bold className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton editor={editor} label="Italic" active={editor.isActive('italic')} enabled={editor.can().chain().focus().toggleItalic().run()} disabled={disabled} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton editor={editor} label="Underline" active={editor.isActive('underline')} enabled={editor.can().chain().focus().toggleUnderline().run()} disabled={disabled} onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton editor={editor} label="Strikethrough" active={editor.isActive('strike')} enabled={editor.can().chain().focus().toggleStrike().run()} disabled={disabled} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton editor={editor} label="Bullet list" active={editor.isActive('bulletList')} enabled={editor.can().chain().focus().toggleBulletList().run()} disabled={disabled} onClick={() => editor.chain().focus().toggleBulletList().run()}><List className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton editor={editor} label="Numbered list" active={editor.isActive('orderedList')} enabled={editor.can().chain().focus().toggleOrderedList().run()} disabled={disabled} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton editor={editor} label="Heading 2" active={editor.isActive('heading', { level: 2 })} enabled={editor.can().chain().focus().toggleHeading({ level: 2 }).run()} disabled={disabled} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton editor={editor} label="Heading 3" active={editor.isActive('heading', { level: 3 })} enabled={editor.can().chain().focus().toggleHeading({ level: 3 }).run()} disabled={disabled} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton editor={editor} label="Add link" active={editor.isActive('link')} enabled={editor.can().chain().focus().setLink({ href: 'https://example.com' }).run()} disabled={disabled} onClick={() => {
          const previous = editor.getAttributes('link').href as string | undefined
          const url = window.prompt('Link URL (https:// or mailto:)', previous ?? 'https://')
          if (url === null) return
          if (url === '') { editor.chain().focus().unsetLink().run(); return }
          // Client-side gate: only http/https/mailto URLs are applied; an
          // invalid entry is silently ignored (selection is left untouched)
          // because the sanitizer remains the authoritative boundary anyway.
          const trimmed = url.trim()
          if (!ALLOWED_URL_RE.test(trimmed)) return
          editor.chain().focus().setLink({ href: trimmed }).run()
        }}><LinkIcon className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton editor={editor} label="Undo" active={false} enabled={editor.can().chain().focus().undo().run()} disabled={disabled} onClick={() => editor.chain().focus().undo().run()}><Undo2 className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton editor={editor} label="Redo" active={false} enabled={editor.can().chain().focus().redo().run()} disabled={disabled} onClick={() => editor.chain().focus().redo().run()}><Redo2 className="h-4 w-4" /></ToolbarButton>
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}
