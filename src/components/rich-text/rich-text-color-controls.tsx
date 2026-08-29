"use client";

import {
	Check,
	ChevronDown,
	Highlighter,
	MoreHorizontal,
	Palette,
} from "lucide-react";
import { useEditorState, type Editor } from "@tiptap/react";
import * as React from "react";
import {
	useRef,
	useState,
	type KeyboardEvent,
	type ReactNode,
} from "react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	HIGHLIGHT_COLOR_VALUES,
	TEXT_COLOR_VALUES,
	isHighlightColorToken,
	isTextColorToken,
	type HighlightColorToken,
	type TextColorToken,
} from "@/lib/rich-text-palette";

export type RichTextColorControlsProps = {
	editor: Editor;
	disabled: boolean;
	compact: boolean;
};

export type ColorKind = "text" | "highlight";
export type ColorToken = TextColorToken | HighlightColorToken;
type ColorEntry<Token extends ColorToken = ColorToken> = readonly [Token, string];

type ColorSelection = { from: number; to: number };

export type ColorPaletteProps<Token extends ColorToken> = {
	editor: Editor;
	disabled: boolean;
	kind: ColorKind;
	label: string;
	entries: readonly ColorEntry<Token>[];
	activeToken: Token | null;
	resetLabel: string;
	onComplete?: () => void;
	restoreSelection?: () => void;
};

const CONTROL_BUTTON_CLASS =
	"inline-flex h-8 min-h-8 items-center justify-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-slate-600 hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500";
const SWATCH_BUTTON_CLASS =
	"rich-text-color-swatch flex min-h-8 items-center gap-2 rounded-md border border-transparent px-2 py-1 text-left text-xs text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:pointer-events-none disabled:opacity-40";

const textColorEntries = Object.entries(TEXT_COLOR_VALUES) as Array<
	ColorEntry<TextColorToken>
>;
const highlightColorEntries = Object.entries(HIGHLIGHT_COLOR_VALUES) as Array<
	ColorEntry<HighlightColorToken>
>;

export function getColorPaletteEntries(kind: ColorKind): readonly ColorEntry[] {
	return kind === "text" ? textColorEntries : highlightColorEntries;
}

export type ColorPaletteKeyAction = {
	focusIndex: number | null;
	close: boolean;
};

export function getColorPaletteKeyAction(
	index: number,
	key: string,
	entryCount: number,
): ColorPaletteKeyAction {
	if (key === "Escape") return { focusIndex: null, close: true };
	if (entryCount <= 0) return { focusIndex: null, close: false };

	let focusIndex: number | null = null;
	switch (key) {
		case "ArrowRight":
		case "ArrowDown":
			focusIndex = (index + 1) % entryCount;
			break;
		case "ArrowLeft":
		case "ArrowUp":
			focusIndex = (index - 1 + entryCount) % entryCount;
			break;
		case "Home":
			focusIndex = 0;
			break;
		case "End":
			focusIndex = entryCount - 1;
			break;
	}

	return { focusIndex, close: false };
}

function tokenLabel(token: ColorToken): string {
	return token.charAt(0).toUpperCase() + token.slice(1);
}

function preventSelectionTransfer(event: { preventDefault: () => void }): void {
	event.preventDefault();
}

function preserveEditorSelection(
	editor: Editor,
	selectionRef: { current: ColorSelection | null },
	event: { preventDefault: () => void },
): void {
	// The editor selection is still available while the trigger opens the
	// popover. Preventing the default focus transfer keeps it available for the
	// command chain when a swatch is chosen; the snapshot also covers browsers
	// that update the ProseMirror selection while moving focus to the popover.
	event.preventDefault();
	selectionRef.current = {
		from: editor.state.selection.from,
		to: editor.state.selection.to,
	};
}

function rememberEditorSelection(
	editor: Editor,
	selectionRef: { current: ColorSelection | null },
): void {
	selectionRef.current = {
		from: editor.state.selection.from,
		to: editor.state.selection.to,
	};
}

function restoreEditorSelection(
	editor: Editor,
	selectionRef: { current: ColorSelection | null },
): void {
	if (selectionRef.current) {
		editor.commands.setTextSelection(selectionRef.current);
	}
}

function restoreEditorFocus(editor: Editor): void {
	// TipTap's focus command schedules a frame for React; focus the mounted
	// view immediately as well so closing Radix content cannot leave focus on a
	// palette item or the overflow trigger.
	editor.commands.focus();
	editor.view.focus();
}

function colorValueForToken(
	kind: ColorKind,
	entries: readonly ColorEntry[],
	activeToken: ColorToken | null,
): string | null {
	if (!activeToken) return null;
	const entry = entries.find(([token]) => token === activeToken);
	return entry?.[1] ?? null;
}

export function applyRichTextColorToken(
	editor: Editor,
	kind: ColorKind,
	token: ColorToken,
): boolean {
	if (kind === "text" && isTextColorToken(token)) {
		return editor.chain().setTextColorToken(token).run();
	}
	if (kind === "highlight" && isHighlightColorToken(token)) {
		return editor.chain().setHighlightColorToken(token).run();
	}
	return false;
}

export function resetRichTextColorToken(editor: Editor, kind: ColorKind): boolean {
	if (kind === "text") {
		return editor.chain().unsetTextColorToken().run();
	}
	return editor.chain().unsetHighlightColorToken().run();
}

export function PaletteSwatches<Token extends ColorToken>({
	editor,
	disabled,
	kind,
	label,
	entries,
	activeToken,
	resetLabel,
	onComplete,
	restoreSelection,
}: ColorPaletteProps<Token>) {
	const swatchRefs = useRef<Array<HTMLButtonElement | null>>([]);
	const selectedIndex = activeToken
		? entries.findIndex(([token]) => token === activeToken)
		: -1;
	const firstTabIndex = selectedIndex >= 0 ? selectedIndex : 0;

	function moveFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
		const action = getColorPaletteKeyAction(index, event.key, entries.length);
		if (action.close || action.focusIndex === null) return;

		event.preventDefault();
		event.stopPropagation();
		swatchRefs.current[action.focusIndex]?.focus();
	}

	function choose(token: Token) {
		if (disabled) return;
		restoreSelection?.();
		if (applyRichTextColorToken(editor, kind, token)) {
			restoreEditorFocus(editor);
			onComplete?.();
		}
	}

	function reset() {
		if (disabled) return;
		restoreSelection?.();
		resetRichTextColorToken(editor, kind);
		restoreEditorFocus(editor);
		onComplete?.();
	}

	return (
		<div className="rich-text-color-palette" role="group" aria-label={`${label} palette`}>
			<div
				className="rich-text-color-swatch-grid"
				role="radiogroup"
				aria-label={`${label} colors`}
			>
				{entries.map(([token, value], index) => {
					const selected = activeToken === token;
					const swatchLabel = tokenLabel(token);
					return (
						<Tooltip key={token}>
							<TooltipTrigger asChild>
								<button
									ref={(element) => {
										swatchRefs.current[index] = element;
									}}
									type="button"
									role="radio"
									aria-label={swatchLabel}
									aria-checked={selected}
									aria-pressed={selected}
									data-color-kind={kind}
									data-color-token={token}
									data-color-value={value}
									data-selected={selected ? "true" : "false"}
									tabIndex={index === firstTabIndex ? 0 : -1}
									disabled={disabled}
									onPointerDown={preventSelectionTransfer}
									onMouseDown={preventSelectionTransfer}
									onKeyDown={(event) => moveFocus(event, index)}
									onClick={() => choose(token)}
									className={SWATCH_BUTTON_CLASS}
								>
									<span
										aria-hidden="true"
										className="rich-text-color-swatch-chip h-4 w-4 shrink-0 rounded-full border border-slate-300"
										style={{ backgroundColor: value }}
									/>
									<span className="min-w-0 flex-1">{swatchLabel}</span>
									{selected && (
										<Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
									)}
								</button>
							</TooltipTrigger>
							<TooltipContent>{swatchLabel}</TooltipContent>
						</Tooltip>
					);
				})}
			</div>
			<button
				type="button"
				aria-label={resetLabel}
				aria-pressed={activeToken === null}
				data-reset="true"
				disabled={disabled}
				onPointerDown={preventSelectionTransfer}
				onMouseDown={preventSelectionTransfer}
				onClick={reset}
				className="rich-text-color-reset mt-2 w-full rounded-md border border-slate-200 px-2 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
			>
				{resetLabel}
			</button>
		</div>
	);
}

function ColorPopover<Token extends ColorToken>({
	editor,
	disabled,
	kind,
	label,
	entries,
	activeToken,
	resetLabel,
	icon,
}: ColorPaletteProps<Token> & { icon: ReactNode }) {
	const [open, setOpen] = useState(false);
	const returnFocusToEditor = useRef(false);
	const selectionRef = useRef<ColorSelection | null>(null);
	const activeValue = colorValueForToken(kind, entries, activeToken);
	const activeLabel = activeToken ? tokenLabel(activeToken) : "Default";

	function complete() {
		returnFocusToEditor.current = true;
		setOpen(false);
		restoreEditorFocus(editor);
	}

	function preserveTriggerSelection(event: { preventDefault: () => void }) {
		preserveEditorSelection(editor, selectionRef, event);
	}

	function captureTriggerSelection() {
		rememberEditorSelection(editor, selectionRef);
	}

	function restoreTriggerSelection() {
		restoreEditorSelection(editor, selectionRef);
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<Tooltip>
				<TooltipTrigger asChild>
					<span className="inline-flex">
						<PopoverTrigger asChild>
							<button
								type="button"
								aria-label={label}
								aria-haspopup="dialog"
								aria-expanded={open}
								aria-pressed={activeToken !== null}
								data-active-token={activeToken ?? "default"}
								data-active-value={activeValue ?? "default"}
								disabled={disabled}
								onPointerDown={preserveTriggerSelection}
								onMouseDown={preserveTriggerSelection}
								onClick={captureTriggerSelection}
								className={CONTROL_BUTTON_CLASS}
							>
								{icon}
								<span className="sr-only">{label}</span>
								<ChevronDown className="h-3 w-3" aria-hidden="true" />
							</button>
						</PopoverTrigger>
					</span>
				</TooltipTrigger>
				<TooltipContent>{`${label}: ${activeLabel}`}</TooltipContent>
			</Tooltip>
			<PopoverContent
				align="start"
				className="rich-text-color-popover"
				aria-label={`${label} palette`}
				onEscapeKeyDown={() => setOpen(false)}
				onCloseAutoFocus={(event) => {
					if (returnFocusToEditor.current) {
						event.preventDefault();
						returnFocusToEditor.current = false;
						restoreEditorFocus(editor);
					}
				}}
			>
				<p className="rich-text-color-palette-title">{label}</p>
				<PaletteSwatches
					editor={editor}
					disabled={disabled}
					kind={kind}
					label={label}
					entries={entries}
					activeToken={activeToken}
					resetLabel={resetLabel}
					onComplete={complete}
					restoreSelection={restoreTriggerSelection}
				/>
			</PopoverContent>
		</Popover>
	);
}

function CompactColorSection<Token extends ColorToken>({
	editor,
	disabled,
	kind,
	label,
	entries,
	activeToken,
	resetLabel,
	onComplete,
	restoreSelection,
}: ColorPaletteProps<Token>) {
	return (
		<section className="rich-text-color-compact-section" aria-labelledby={`rich-text-${kind}-palette-label`}>
			<h3 id={`rich-text-${kind}-palette-label`} className="rich-text-color-palette-title">
				{label}
			</h3>
			<PaletteSwatches
				editor={editor}
				disabled={disabled}
				kind={kind}
				label={label}
				entries={entries}
				activeToken={activeToken}
				resetLabel={resetLabel}
				onComplete={onComplete}
				restoreSelection={restoreSelection}
			/>
		</section>
	);
}

function CompactColorMenu({
	editor,
	disabled,
	textToken,
	highlightToken,
}: {
	editor: Editor;
	disabled: boolean;
	textToken: TextColorToken | null;
	highlightToken: HighlightColorToken | null;
}) {
	const [open, setOpen] = useState(false);
	const returnFocusToEditor = useRef(false);
	const selectionRef = useRef<ColorSelection | null>(null);
	const complete = () => {
		returnFocusToEditor.current = true;
		setOpen(false);
		restoreEditorFocus(editor);
	};
	const preserveTriggerSelection = (event: { preventDefault: () => void }) => {
		preserveEditorSelection(editor, selectionRef, event);
	};
	const captureTriggerSelection = () => {
		rememberEditorSelection(editor, selectionRef);
	};
	const restoreTriggerSelection = () => {
		restoreEditorSelection(editor, selectionRef);
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<Tooltip>
				<TooltipTrigger asChild>
					<span className="inline-flex">
						<PopoverTrigger asChild>
							<button
								type="button"
								aria-label="More formatting"
								aria-haspopup="dialog"
								aria-expanded={open}
								disabled={disabled}
								onPointerDown={preserveTriggerSelection}
								onMouseDown={preserveTriggerSelection}
								onClick={captureTriggerSelection}
								className={CONTROL_BUTTON_CLASS}
							>
								<MoreHorizontal className="h-4 w-4" aria-hidden="true" />
								<span className="sr-only">More formatting</span>
							</button>
						</PopoverTrigger>
					</span>
				</TooltipTrigger>
				<TooltipContent>More formatting</TooltipContent>
			</Tooltip>
			<PopoverContent
				align="end"
				className="rich-text-color-overflow-menu"
				aria-label="More formatting"
				onEscapeKeyDown={() => setOpen(false)}
				onCloseAutoFocus={(event) => {
					if (returnFocusToEditor.current) {
						event.preventDefault();
						returnFocusToEditor.current = false;
						restoreEditorFocus(editor);
					}
				}}
			>
				<CompactColorSection
					editor={editor}
					disabled={disabled}
					kind="text"
					label="Text color"
					entries={textColorEntries}
					activeToken={textToken}
					resetLabel="Default text"
					onComplete={complete}
					restoreSelection={restoreTriggerSelection}
				/>
				<div className="rich-text-color-overflow-divider" aria-hidden="true" />
				<CompactColorSection
					editor={editor}
					disabled={disabled}
					kind="highlight"
					label="Highlight"
					entries={highlightColorEntries}
					activeToken={highlightToken}
					resetLabel="No highlight"
					onComplete={complete}
					restoreSelection={restoreTriggerSelection}
				/>
			</PopoverContent>
		</Popover>
	);
}

/** Curated semantic text-color and highlight controls for the rich-text toolbar. */
export function RichTextColorControls({
	editor,
	disabled,
	compact,
}: RichTextColorControlsProps) {
	// The transaction number is the subscription trigger. Read the current
	// editor directly so static rendering can still expose the initial
	// selection; TipTap's useEditorState server snapshot intentionally uses a
	// null editor and is only meant to suppress editor work during SSR.
	useEditorState({
		editor,
		selector: ({ transactionNumber }) => transactionNumber,
	});
	const currentTextToken = editor.getAttributes("textColorToken").token;
	const currentHighlightToken = editor.getAttributes("highlightColorToken").token;
	const textToken =
		isTextColorToken(currentTextToken) &&
		editor.isActive("textColorToken", { token: currentTextToken })
			? currentTextToken
			: null;
	const highlightToken =
		isHighlightColorToken(currentHighlightToken) &&
		editor.isActive("highlightColorToken", { token: currentHighlightToken })
			? currentHighlightToken
			: null;
	const controlsDisabled = disabled || !editor.isEditable;

	return (
		<div
			className="rich-text-color-controls"
			data-compact={compact ? "true" : "false"}
			aria-label="Text color and highlight controls"
		>
			<TooltipProvider delayDuration={200}>
				<div className="rich-text-color-controls-wide">
					<ColorPopover
						editor={editor}
						disabled={controlsDisabled}
						kind="text"
						label="Text color"
						entries={textColorEntries}
						activeToken={textToken}
						resetLabel="Default text"
						icon={<Palette className="h-4 w-4" aria-hidden="true" />}
					/>
					<ColorPopover
						editor={editor}
						disabled={controlsDisabled}
						kind="highlight"
						label="Highlight"
						entries={highlightColorEntries}
						activeToken={highlightToken}
						resetLabel="No highlight"
						icon={<Highlighter className="h-4 w-4" aria-hidden="true" />}
					/>
				</div>
				<div className="rich-text-color-controls-compact">
					<CompactColorMenu
						editor={editor}
						disabled={controlsDisabled}
						textToken={textToken}
						highlightToken={highlightToken}
					/>
				</div>
			</TooltipProvider>
		</div>
	);
}

export default RichTextColorControls;
