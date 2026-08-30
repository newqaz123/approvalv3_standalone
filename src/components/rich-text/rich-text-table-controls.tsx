"use client";

import { Table as TableIcon, ChevronDown, Trash2, Check } from "lucide-react";
import { useEditorState, type Editor } from "@tiptap/react";
import { cellAround } from "@tiptap/pm/tables";
import { useRef, useState, type MouseEvent, type ReactNode } from "react";
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
	moveTableColumnTo,
	moveTableRowTo,
	normalizeTableVerticalAlign,
	selectionTableCell,
} from "@/components/rich-text/rich-table-extensions";

export type RichTextTableControlsProps = {
	editor: Editor;
	disabled: boolean;
};

const CONTROL_BUTTON_CLASS =
	"inline-flex h-8 min-h-8 items-center justify-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-slate-600 hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500";

const MENU_ITEM_CLASS =
	"flex min-h-8 w-full items-center gap-2 rounded-md border border-transparent px-2 py-1 text-left text-xs text-slate-700 hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500";

const MENU_DANGER_ITEM_CLASS =
	"flex min-h-8 w-full items-center gap-2 rounded-md border border-transparent px-2 py-1 text-left text-xs text-red-700 hover:bg-red-50 disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500";

const MENU_DIVIDER_CLASS = "my-1 h-px border-0 bg-slate-200";

const MENU_LABEL_CLASS =
	"px-2 pt-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-slate-400";

const INSERT_TABLE_ARGS = { rows: 3, cols: 3, withHeaderRow: true } as const;

type TableMenuItem = {
	label: string;
	enabled: boolean;
	run: (editor: Editor) => boolean;
	danger?: boolean;
};

/** Vertical align of the cell the selection currently sits in. */
function currentCellVerticalAlign(editor: Editor): string | null {
	const cell = cellAround(editor.state.selection.$from);
	const node = cell ? editor.state.doc.nodeAt(cell.pos) : null;
	return normalizeTableVerticalAlign(node?.attrs.verticalAlign);
}

function tableMenuItems(editor: Editor): TableMenuItem[] {
	const cell = selectionTableCell(editor);
	return [
		{
			label: "Add column before",
			enabled: editor.can().addColumnBefore(),
			run: (current) => current.chain().focus().addColumnBefore().run(),
		},
		{
			label: "Add column after",
			enabled: editor.can().addColumnAfter(),
			run: (current) => current.chain().focus().addColumnAfter().run(),
		},
		{
			label: "Delete column",
			enabled: editor.can().deleteColumn(),
			run: (current) => current.chain().focus().deleteColumn().run(),
		},
		{
			label: "Add row above",
			enabled: editor.can().addRowBefore(),
			run: (current) => current.chain().focus().addRowBefore().run(),
		},
		{
			label: "Add row below",
			enabled: editor.can().addRowAfter(),
			run: (current) => current.chain().focus().addRowAfter().run(),
		},
		{
			label: "Delete row",
			enabled: editor.can().deleteRow(),
			run: (current) => current.chain().focus().deleteRow().run(),
		},
		// Keyboard-operable reorder path mirroring the drag handles.
		{
			label: "Move row up",
			enabled:
				cell !== null && cell.row > 0,
			run: (current) => {
				const info = selectionTableCell(current);
				return info !== null
					? moveTableRowTo(current, info.tableStart, info.row, info.row - 1)
					: false;
			},
		},
		{
			label: "Move row down",
			enabled: cell !== null && cell.row < cell.height - 1,
			run: (current) => {
				const info = selectionTableCell(current);
				return info !== null
					? moveTableRowTo(current, info.tableStart, info.row, info.row + 1)
					: false;
			},
		},
		{
			label: "Move column left",
			enabled: cell !== null && cell.col > 0,
			run: (current) => {
				const info = selectionTableCell(current);
				return info !== null
					? moveTableColumnTo(current, info.tableStart, info.col, info.col - 1)
					: false;
			},
		},
		{
			label: "Move column right",
			enabled: cell !== null && cell.col < cell.width - 1,
			run: (current) => {
				const info = selectionTableCell(current);
				return info !== null
					? moveTableColumnTo(current, info.tableStart, info.col, info.col + 1)
					: false;
			},
		},
		{
			label: "Toggle header row",
			enabled: editor.can().toggleHeaderRow(),
			run: (current) => current.chain().focus().toggleHeaderRow().run(),
		},
		{
			label: "Merge cells",
			enabled: editor.can().mergeCells(),
			run: (current) => current.chain().focus().mergeCells().run(),
		},
		{
			label: "Split cell",
			enabled: editor.can().splitCell(),
			run: (current) => current.chain().focus().splitCell().run(),
		},
		{
			label: "Delete table",
			enabled: editor.can().deleteTable(),
			run: (current) => current.chain().focus().deleteTable().run(),
			danger: true,
		},
	];
}

const VERTICAL_ALIGN_OPTIONS = [
	{ value: "top", label: "Align top" },
	{ value: "middle", label: "Align middle" },
	{ value: "bottom", label: "Align bottom" },
] as const;

function preventFocusTransfer(event: MouseEvent): void {
	// Keeping focus off the menu buttons preserves the editor selection so a
	// structural command lands exactly where the user last placed the caret.
	event.preventDefault();
}

function restoreEditorFocus(editor: Editor): void {
	// TipTap's focus command schedules a frame for React; focus the mounted
	// view immediately as well so closing Radix content cannot leave focus on
	// a menu item.
	editor.commands.focus();
	editor.view.focus();
}

function TableMenuIcon({ danger }: { danger?: boolean }): ReactNode {
	return danger ? (
		<Trash2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
	) : (
		<TableIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
	);
}

/** Insert-table and structural table controls for the rich-text toolbar. */
export function RichTextTableControls({
	editor,
	disabled,
}: RichTextTableControlsProps) {
	// Subscribe to editor transactions so can()/isActive states re-render,
	// mirroring the color controls' subscription pattern.
	useEditorState({
		editor,
		selector: ({ transactionNumber }) => transactionNumber,
	});
	const [open, setOpen] = useState(false);
	const returnFocusToEditor = useRef(false);

	const controlsDisabled = disabled || !editor.isEditable;
	const insideTable = editor.isActive("table");
	const canInsertTable = editor.can().insertTable(INSERT_TABLE_ARGS);
	const items = tableMenuItems(editor);
	const activeVerticalAlign = currentCellVerticalAlign(editor);

	function runItem(item: TableMenuItem) {
		if (controlsDisabled || !item.enabled) return;
		if (item.run(editor)) {
			returnFocusToEditor.current = true;
			setOpen(false);
			restoreEditorFocus(editor);
		}
	}

	function insertTable() {
		if (controlsDisabled || !canInsertTable) return;
		if (editor.chain().focus().insertTable(INSERT_TABLE_ARGS).run()) {
			returnFocusToEditor.current = true;
			setOpen(false);
			restoreEditorFocus(editor);
		}
	}

	function setVerticalAlign(value: string | null) {
		if (controlsDisabled || !insideTable) return;
		if (
			editor
				.chain()
				.focus()
				.setCellAttribute("verticalAlign", value)
				.run()
		) {
			returnFocusToEditor.current = true;
			setOpen(false);
			restoreEditorFocus(editor);
		}
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<TooltipProvider delayDuration={200}>
				<Tooltip>
					<TooltipTrigger asChild>
						<span className="inline-flex">
							<PopoverTrigger asChild>
								<button
									type="button"
									aria-label="Table"
									aria-haspopup="dialog"
									aria-expanded={open}
									aria-pressed={insideTable}
									disabled={controlsDisabled}
									className={CONTROL_BUTTON_CLASS}
								>
									<TableIcon className="h-4 w-4" aria-hidden="true" />
									<span className="sr-only">Table</span>
									<ChevronDown className="h-3 w-3" aria-hidden="true" />
								</button>
							</PopoverTrigger>
						</span>
					</TooltipTrigger>
					<TooltipContent>Table</TooltipContent>
				</Tooltip>
			</TooltipProvider>
			<PopoverContent
				align="start"
				className="rich-text-table-menu"
				aria-label="Table controls"
				onEscapeKeyDown={() => setOpen(false)}
				onCloseAutoFocus={(event) => {
					if (returnFocusToEditor.current) {
						event.preventDefault();
						returnFocusToEditor.current = false;
						restoreEditorFocus(editor);
					}
				}}
			>
				<button
					type="button"
					aria-label="Insert table"
					disabled={controlsDisabled || !canInsertTable}
					onPointerDown={preventFocusTransfer}
					onMouseDown={preventFocusTransfer}
					onClick={insertTable}
					className={MENU_ITEM_CLASS}
				>
					<TableIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
					Insert table
				</button>
				<hr className={MENU_DIVIDER_CLASS} aria-hidden="true" />
				<p className={MENU_LABEL_CLASS}>Vertical align</p>
				<div>
					{VERTICAL_ALIGN_OPTIONS.map((option) => {
						const selected = activeVerticalAlign === option.value;
						return (
							<button
								key={option.value}
								type="button"
								aria-label={option.label}
								aria-pressed={selected}
								disabled={controlsDisabled || !insideTable}
								onPointerDown={preventFocusTransfer}
								onMouseDown={preventFocusTransfer}
								onClick={() => setVerticalAlign(option.value)}
								className={MENU_ITEM_CLASS}
							>
								<Check
									className={`h-3.5 w-3.5 shrink-0 ${selected ? "" : "invisible"}`}
									aria-hidden="true"
								/>
								{option.label}
							</button>
						);
					})}
					<button
						type="button"
						aria-label="Default vertical align"
						aria-pressed={activeVerticalAlign === null}
						disabled={controlsDisabled || !insideTable}
						onPointerDown={preventFocusTransfer}
						onMouseDown={preventFocusTransfer}
						onClick={() => setVerticalAlign(null)}
						className={MENU_ITEM_CLASS}
					>
						<Check
							className={`h-3.5 w-3.5 shrink-0 ${
								activeVerticalAlign === null ? "" : "invisible"
							}`}
							aria-hidden="true"
						/>
						Default (top)
					</button>
				</div>
				<hr className={MENU_DIVIDER_CLASS} aria-hidden="true" />
				<div>
					{items.map((item) => (
						<button
							key={item.label}
							type="button"
							aria-label={item.label}
							disabled={controlsDisabled || !item.enabled}
							onPointerDown={preventFocusTransfer}
							onMouseDown={preventFocusTransfer}
							onClick={() => runItem(item)}
							className={item.danger ? MENU_DANGER_ITEM_CLASS : MENU_ITEM_CLASS}
						>
							<TableMenuIcon danger={item.danger} />
							{item.label}
						</button>
					))}
				</div>
			</PopoverContent>
		</Popover>
	);
}

export default RichTextTableControls;
