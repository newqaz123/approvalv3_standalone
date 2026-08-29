"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import FileHandler from "@tiptap/extension-file-handler";
import {
	Bold,
	Italic,
	Underline as UnderlineIcon,
	Strikethrough,
	List,
	ListOrdered,
	Heading2,
	Heading3,
	Link as LinkIcon,
	Image as ImageIcon,
	Undo2,
	Redo2,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
	createInlineImageCropCommandsController,
	createInlineImageMimeFilter,
	createInlineImageTransactionCleanupController,
	InlineImageExtension,
	inlineImageUploadSuccessAttributes,
	type InlineImageCropCommandsController,
} from "@/components/rich-text/inline-image-extension";
import type { InlineImageCoordinator } from "@/hooks/use-inline-description-images";
import { RichTextColorControls } from "@/components/rich-text/rich-text-color-controls";
import {
	HighlightColorTokenMark,
	TextColorTokenMark,
} from "@/components/rich-text/rich-text-color-extensions";
import { INLINE_IMAGE_MIMES, MAX_INLINE_ALT_LENGTH } from "@/lib/inline-images/policy";
import { sanitizeRichText } from "@/lib/rich-text-sanitizer";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export interface RichTextEditorProps {
	value: string;
	onChange: (next: string) => void;
	disabled?: boolean;
	id?: string;
	minHeight?: number;
	inlineImages?: InlineImageCoordinator;
}

const TOOLBAR_BUTTON =
	"inline-flex h-8 min-h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500";

/** Only these link schemes may be applied client-side; the sanitizer stays the authoritative gate. */
const ALLOWED_URL_RE = /^(?:https?|mailto):/i;

/** The semantic color marks used by every RichTextEditor instance. */
export const RICH_TEXT_COLOR_EXTENSIONS = [
	TextColorTokenMark,
	HighlightColorTokenMark,
] as const;

/** Produces the initial accessible alt text without retaining a filename path or extension. */
export function filenameAlt(name: string): string {
	const basename = name.split(/[\\/]/).pop() ?? name;
	return basename
		.replace(/\.[^.]+$/, "")
		.replace(/[\u0000-\u001f\u007f]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, MAX_INLINE_ALT_LENGTH);
}

function uploadError(error: unknown): string {
	return error instanceof Error && error.message ? error.message : "Image upload failed";
}

/** Emits only the sanitizer's canonical HTML and suppresses duplicate updates. */
export function emitSanitizedRichTextChange(
	html: string,
	lastEmitted: { current: string | null },
	onChange: (next: string) => void,
): void {
	const next = sanitizeRichText(html);
	if (next !== lastEmitted.current) {
		lastEmitted.current = next;
		onChange(next);
	}
}

function ToolbarButton({
	editor,
	label,
	active,
	enabled,
	disabled,
	onClick,
	children,
}: {
	editor: Editor | null;
	label: string;
	active: boolean;
	enabled: boolean;
	disabled: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			aria-pressed={active}
			disabled={disabled || !enabled || !editor}
			onClick={onClick}
			className={
				TOOLBAR_BUTTON + (active ? " bg-slate-200 text-slate-900" : "")
			}
		>
			{children}
		</button>
	);
}

/** Binds crop activity to the live editor and the toolbar command state. */
export function bindInlineImageCropCommands(input: {
	controller: InlineImageCropCommandsController;
	getEditor: () => Pick<Editor, "setEditable"> | null;
	isDisabled: () => boolean;
	setCommandsDisabled: (disabled: boolean) => void;
}): () => void {
	return input.controller.subscribe(() => {
		const activeCrop = input.controller.hasActiveCrop();
		input.setCommandsDisabled(activeCrop);
		input.getEditor()?.setEditable(!input.isDisabled() && !activeCrop);
	});
}

export default function RichTextEditor({
	value,
	onChange,
	disabled = false,
	id,
	minHeight = 160,
	inlineImages,
}: RichTextEditorProps) {
	const lastEmitted = useRef<string | null>(null);
	const editorRef = useRef<Editor | null>(null);
	const fileByUploadId = useRef<Map<string, File>>(new Map());
	const insertionPositionByUploadId = useRef<Map<string, number>>(new Map());
	const localUploadIds = useRef<Set<string>>(new Set());
	const removedUploadIds = useRef<Set<string>>(new Set());
	const inlineImagesRef = useRef<InlineImageCoordinator | undefined>(inlineImages);
	const disabledRef = useRef(disabled);
	const canInsertImagesRef = useRef(Boolean(inlineImages) && !disabled);
	const imageInputRef = useRef<HTMLInputElement | null>(null);
	const transactionCleanup = useRef<ReturnType<
		typeof createInlineImageTransactionCleanupController
	> | null>(null);
	const cropCommands = useRef<ReturnType<
		typeof createInlineImageCropCommandsController
	> | null>(null);
	const [cropCommandsDisabled, setCropCommandsDisabled] = useState(false);

	inlineImagesRef.current = inlineImages;
	disabledRef.current = disabled;
	canInsertImagesRef.current = Boolean(inlineImages) && !disabled;
	if (!transactionCleanup.current) {
		transactionCleanup.current = createInlineImageTransactionCleanupController({
			getCoordinator: () => inlineImagesRef.current,
			fileByUploadId: fileByUploadId.current,
			insertionPositionByUploadId: insertionPositionByUploadId.current,
			localUploadIds: localUploadIds.current,
			removedUploadIds: removedUploadIds.current,
		});
	}
	if (!cropCommands.current) {
		cropCommands.current = createInlineImageCropCommandsController();
	}

	function updateUploadNode(uploadId: string, attrs: Record<string, unknown>) {
		const currentEditor = editorRef.current;
		if (!currentEditor) return;

		let target: { pos: number; node: ProseMirrorNode } | null = null;
		currentEditor.state.doc.descendants((candidate, pos) => {
			if (candidate.type.name === "inlineImage" && candidate.attrs.uploadId === uploadId) {
				target = { pos, node: candidate };
				return false;
			}
			return true;
		});

		if (target === null) return;
		const resolvedTarget = target as { pos: number; node: ProseMirrorNode };
		currentEditor.view.dispatch(
			currentEditor.state.tr.setNodeMarkup(resolvedTarget.pos, resolvedTarget.node.type, {
				...resolvedTarget.node.attrs,
				...attrs,
			}),
		);
	}

	function runUpload(uploadId: string, file: File) {
		const coordinator = inlineImagesRef.current;
		if (!coordinator) return;

		void coordinator
			.upload(uploadId, file, (progress) => {
				updateUploadNode(uploadId, { status: "uploading", progress });
			})
			.then((upload) => {
				updateUploadNode(uploadId, {
					uploadId,
					...inlineImageUploadSuccessAttributes(
						upload,
						upload.alt || filenameAlt(file.name),
						"center",
					),
				});
			})
			.catch((error: unknown) => {
				updateUploadNode(uploadId, {
					status: "error",
					progress: 0,
					error: uploadError(error),
				});
			});
	}

	/** Shared insertion path for the toolbar picker, paste, and drop handlers. */
	function insertFiles(files: File[], position?: number) {
		const currentEditor = editorRef.current;
		const coordinator = inlineImagesRef.current;
		if (!currentEditor || !coordinator || disabledRef.current) return;

		for (const file of files.filter((item) => INLINE_IMAGE_MIMES.has(item.type))) {
			const uploadId = crypto.randomUUID();
			const insertionPosition = position ?? currentEditor.state.selection.from;
			fileByUploadId.current.set(uploadId, file);
			insertionPositionByUploadId.current.set(uploadId, insertionPosition);
			localUploadIds.current.add(uploadId);
			const inserted = currentEditor
				.chain()
				.focus()
				.insertContentAt(insertionPosition, {
					type: "inlineImage",
					attrs: {
						uploadId,
						status: "uploading",
						progress: 0,
						alt: filenameAlt(file.name),
						align: "center",
					},
				})
				.run();
			if (!inserted) {
				fileByUploadId.current.delete(uploadId);
				insertionPositionByUploadId.current.delete(uploadId);
				localUploadIds.current.delete(uploadId);
				continue;
			}
			void runUpload(uploadId, file);
		}
	}

	const editor = useEditor({
		// TipTap must not construct a browser editor during Next's server render.
		immediatelyRender: false,
		extensions: [
			InlineImageExtension.configure({
				inlineImages,
				fileByUploadId: fileByUploadId.current,
				insertionPositionByUploadId: insertionPositionByUploadId.current,
				localUploadIds: localUploadIds.current,
				removedUploadIds: removedUploadIds.current,
				cropCommands: cropCommands.current ?? undefined,
			}),
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
			...RICH_TEXT_COLOR_EXTENSIONS,
			Link.configure({ autolink: true, openOnClick: false }),
			FileHandler.configure({
				allowedMimeTypes: createInlineImageMimeFilter(() => canInsertImagesRef.current),
				consumePasteEvent: true,
				onPaste: (_editor, files) => insertFiles(files),
				onDrop: (_editor, files, position) => insertFiles(files, position),
			}),
		],
		content: value || "",
		editable: !disabled,
		editorProps: {
			attributes: {
				id: id ?? "",
				"aria-multiline": "true",
				role: "textbox",
				class:
					"rich-text prose-rich-text min-h-[var(--rich-min-h)] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-base leading-relaxed text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 md:text-sm",
				style: `--rich-min-h: ${minHeight}px`,
			},
		},
		onCreate: ({ editor: current }) => {
			editorRef.current = current;
			transactionCleanup.current?.attach(current);
		},
		onDestroy: () => {
			const current = editorRef.current;
			if (current) transactionCleanup.current?.detach(current);
			editorRef.current = null;
		},
		onTransaction: ({ editor: current }) => {
			transactionCleanup.current?.handleTransaction(current);
		},
		onUpdate: ({ editor: current }) => {
			emitSanitizedRichTextChange(current.getHTML(), lastEmitted, onChange);
		},
	});

	// The hook returns the editor after its first render; keep the insertion
	// pipeline able to run before the first effect (for example on a paste).
	editorRef.current = editor;

	// External value changes (e.g. modal reset) sync into the editor once.
	useEffect(() => {
		if (!editor) return;
		if (value === lastEmitted.current) return;
		// Loop guard: record the incoming value BEFORE setContent so the onUpdate
		// it triggers compares equal against lastEmitted.current and skips onChange.
		lastEmitted.current = value;
		editor.commands.setContent(value || "");
	}, [value, editor]);

	// Formatting and every other editor command stay disabled while any crop
	// session is active; the crop controls themselves are never disabled by it.
	const commandsDisabled = disabled || cropCommandsDisabled;
	canInsertImagesRef.current = Boolean(inlineImages) && !commandsDisabled;

	useEffect(() => {
		const controller = cropCommands.current;
		if (!controller) return undefined;
		return bindInlineImageCropCommands({
			controller,
			getEditor: () => editorRef.current,
			isDisabled: () => disabledRef.current,
			setCommandsDisabled: setCropCommandsDisabled,
		});
	}, []);

	useEffect(() => {
		if (editor) editor.setEditable(!disabled && !cropCommandsDisabled);
	}, [disabled, cropCommandsDisabled, editor]);

	if (!editor) return null;

	const canInsertImages = Boolean(inlineImages) && !commandsDisabled;

	return (
		<div className="space-y-2">
			<div
				className="rich-text-toolbar-wrapper flex flex-wrap items-center gap-1"
				role="toolbar"
				aria-label="Formatting"
			>
				<ToolbarButton
					editor={editor}
					label="Bold"
					active={editor.isActive("bold")}
					enabled={editor.can().chain().focus().toggleBold().run()}
					disabled={commandsDisabled}
					onClick={() => editor.chain().focus().toggleBold().run()}
				>
					<Bold className="h-4 w-4" />
				</ToolbarButton>
				<ToolbarButton
					editor={editor}
					label="Italic"
					active={editor.isActive("italic")}
					enabled={editor.can().chain().focus().toggleItalic().run()}
					disabled={commandsDisabled}
					onClick={() => editor.chain().focus().toggleItalic().run()}
				>
					<Italic className="h-4 w-4" />
				</ToolbarButton>
				<ToolbarButton
					editor={editor}
					label="Underline"
					active={editor.isActive("underline")}
					enabled={editor.can().chain().focus().toggleUnderline().run()}
					disabled={commandsDisabled}
					onClick={() => editor.chain().focus().toggleUnderline().run()}
				>
					<UnderlineIcon className="h-4 w-4" />
				</ToolbarButton>
				<ToolbarButton
					editor={editor}
					label="Strikethrough"
					active={editor.isActive("strike")}
					enabled={editor.can().chain().focus().toggleStrike().run()}
					disabled={commandsDisabled}
					onClick={() => editor.chain().focus().toggleStrike().run()}
				>
					<Strikethrough className="h-4 w-4" />
				</ToolbarButton>
				<ToolbarButton
					editor={editor}
					label="Bullet list"
					active={editor.isActive("bulletList")}
					enabled={editor.can().chain().focus().toggleBulletList().run()}
					disabled={commandsDisabled}
					onClick={() => editor.chain().focus().toggleBulletList().run()}
				>
					<List className="h-4 w-4" />
				</ToolbarButton>
				<ToolbarButton
					editor={editor}
					label="Numbered list"
					active={editor.isActive("orderedList")}
					enabled={editor.can().chain().focus().toggleOrderedList().run()}
					disabled={commandsDisabled}
					onClick={() => editor.chain().focus().toggleOrderedList().run()}
				>
					<ListOrdered className="h-4 w-4" />
				</ToolbarButton>
				<ToolbarButton
					editor={editor}
					label="Heading 2"
					active={editor.isActive("heading", { level: 2 })}
					enabled={editor
						.can()
						.chain()
						.focus()
						.toggleHeading({ level: 2 })
						.run()}
					disabled={commandsDisabled}
					onClick={() =>
						editor.chain().focus().toggleHeading({ level: 2 }).run()
					}
				>
					<Heading2 className="h-4 w-4" />
				</ToolbarButton>
				<ToolbarButton
					editor={editor}
					label="Heading 3"
					active={editor.isActive("heading", { level: 3 })}
					enabled={editor
						.can()
						.chain()
						.focus()
						.toggleHeading({ level: 3 })
						.run()}
					disabled={commandsDisabled}
					onClick={() =>
						editor.chain().focus().toggleHeading({ level: 3 }).run()
					}
				>
					<Heading3 className="h-4 w-4" />
				</ToolbarButton>
				<ToolbarButton
					editor={editor}
					label="Add link"
					active={editor.isActive("link")}
					enabled={editor
						.can()
						.chain()
						.focus()
						.setLink({ href: "https://example.com" })
						.run()}
					disabled={commandsDisabled}
					onClick={() => {
						const previous = editor.getAttributes("link").href as
							| string
							| undefined;
						const url = window.prompt(
							"Link URL (https:// or mailto:)",
							previous ?? "https://",
						);
						if (url === null) return;
						if (url === "") {
							editor.chain().focus().unsetLink().run();
							return;
						}
						// Client-side gate: only http/https/mailto URLs are applied; an
						// invalid entry is silently ignored (selection is left untouched)
						// because the sanitizer remains the authoritative boundary anyway.
						const trimmed = url.trim();
						if (!ALLOWED_URL_RE.test(trimmed)) return;
						editor.chain().focus().setLink({ href: trimmed }).run();
					}}
				>
					<LinkIcon className="h-4 w-4" />
				</ToolbarButton>
				<button
					type="button"
					aria-label="Image"
					disabled={!canInsertImages || !editor}
					onClick={() => imageInputRef.current?.click()}
					className={TOOLBAR_BUTTON}
				>
					<ImageIcon className="h-4 w-4" />
				</button>
				<input
					ref={imageInputRef}
					type="file"
					accept="image/jpeg,image/png,image/webp,image/gif"
					multiple
					aria-label="Choose images"
					disabled={!canInsertImages}
					className="sr-only"
					onChange={(event) => {
						insertFiles(Array.from(event.currentTarget.files ?? []));
						event.currentTarget.value = "";
					}}
				/>
				<RichTextColorControls
					editor={editor}
					disabled={commandsDisabled}
					compact={false}
				/>
				<ToolbarButton
					editor={editor}
					label="Undo"
					active={false}
					enabled={editor.can().chain().focus().undo().run()}
					disabled={commandsDisabled}
					onClick={() => editor.chain().focus().undo().run()}
				>
					<Undo2 className="h-4 w-4" />
				</ToolbarButton>
				<ToolbarButton
					editor={editor}
					label="Redo"
					active={false}
					enabled={editor.can().chain().focus().redo().run()}
					disabled={commandsDisabled}
					onClick={() => editor.chain().focus().redo().run()}
				>
					<Redo2 className="h-4 w-4" />
				</ToolbarButton>
			</div>
			<EditorContent editor={editor} />
		</div>
	);
}
