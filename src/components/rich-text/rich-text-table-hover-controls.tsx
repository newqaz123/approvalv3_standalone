"use client";

import { GripHorizontal, Merge, Plus, Split } from "lucide-react";
import { useEditorState, type Editor } from "@tiptap/react";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type RefObject,
} from "react";
import {
	appendTableRow,
	caretInMergedCell,
	dragTargetsSameTable,
	hasMultiCellSelection,
	hoveredTableCellAt,
	insertColumnRightAt,
	insertRowBelowAt,
	moveTableColumnTo,
	moveTableRowTo,
	pointerInTableGraceZone,
	type HoveredTableCell,
	type Rect,
} from "@/components/rich-text/rich-table-extensions";

export type RichTextTableHoverControlsProps = {
	editor: Editor;
	disabled: boolean;
	/** Relative-positioned wrapper around the editor surface. */
	containerRef: RefObject<HTMLDivElement | null>;
};

type HoverState = {
	cell: HoveredTableCell;
	tableRect: Rect;
	rowRect: Rect;
	cellRect: Rect;
};

type DragState = { kind: "row" | "col"; from: number; tableStart: number };

/** Grace margin (px) around the table where hover controls stay alive. */
const HOVER_GRACE_MARGIN = 64;

function relativeTo(rect: DOMRect, container: DOMRect): Rect {
	return {
		left: rect.left - container.left,
		top: rect.top - container.top,
		width: rect.width,
		height: rect.height,
	};
}

function cellIdentity(cell: HoveredTableCell): string {
	return `${cell.tableStart}:${cell.row}:${cell.col}`;
}

/**
 * Lexical-style hover affordances over description tables: row/column
 * quick-add buttons, drag handles with drop indicators, and a contextual
 * merge/split bar for multi-cell selections.
 *
 * The overlay itself never intercepts pointer input (pointer-events: none
 * via its class); only its buttons opt back in. Pointer and drag tracking
 * attaches to the editor surface container as native listeners.
 */
export function RichTextTableHoverControls({
	editor,
	disabled,
	containerRef,
}: RichTextTableHoverControlsProps) {
	// Re-render on transactions so merge/split visibility tracks selection.
	useEditorState({
		editor,
		selector: ({ transactionNumber }) => transactionNumber,
	});

	const controlsRef = useRef<HTMLDivElement | null>(null);
	const [hover, setHover] = useState<HoverState | null>(null);
	const [drag, setDrag] = useState<DragState | null>(null);
	const [dropTarget, setDropTarget] = useState<number | null>(null);
	const hoverRef = useRef<HoverState | null>(null);
	const dragRef = useRef<DragState | null>(null);
	const dropTargetRef = useRef<number | null>(null);

	const clearHover = useCallback(() => {
		hoverRef.current = null;
		setHover(null);
	}, []);

	const clearDrag = useCallback(() => {
		dragRef.current = null;
		setDrag(null);
		dropTargetRef.current = null;
		setDropTarget(null);
	}, []);

	// Doc changes invalidate cached positions.
	useEffect(() => {
		const onTransaction = ({
			transaction,
		}: {
			transaction: { docChanged: boolean };
		}) => {
			if (!transaction.docChanged) return;
			clearHover();
			clearDrag();
		};
		editor.on("transaction", onTransaction);
		return () => {
			editor.off("transaction", onTransaction);
		};
	}, [editor, clearHover, clearDrag]);

	const measureFromCell = useCallback(
		(cell: HoveredTableCell): HoverState | null => {
			const container = containerRef.current;
			const cellEl = editor.view.nodeDOM(cell.cellStart) as HTMLElement | null;
			const rowEl = cellEl?.closest("tr");
			const tableEl = cellEl?.closest("table");
			if (!container || !cellEl || !rowEl || !tableEl) return null;

			const containerRect = container.getBoundingClientRect();
			return {
				cell,
				tableRect: relativeTo(tableEl.getBoundingClientRect(), containerRect),
				rowRect: relativeTo(rowEl.getBoundingClientRect(), containerRect),
				cellRect: relativeTo(cellEl.getBoundingClientRect(), containerRect),
			};
		},
		[containerRef, editor],
	);

	const updateHover = useCallback(
		(clientX: number, clientY: number): HoverState | null => {
			const coords = editor.view.posAtCoords({ left: clientX, top: clientY });
			const cell = coords ? hoveredTableCellAt(editor, coords.pos) : null;
			if (!cell) {
				// Grace zone: moving toward the gutter buttons leaves the table,
				// but the controls must survive so they can actually be clicked.
				const current = hoverRef.current;
				const container = containerRef.current;
				if (current && container) {
					const containerRect = container.getBoundingClientRect();
					if (
						pointerInTableGraceZone(
							{
								x: clientX - containerRect.left,
								y: clientY - containerRect.top,
							},
							current.tableRect,
							HOVER_GRACE_MARGIN,
						)
					) {
						return current;
					}
				}
				if (hoverRef.current) clearHover();
				return null;
			}
			if (
				hoverRef.current &&
				cellIdentity(hoverRef.current.cell) === cellIdentity(cell)
			) {
				return hoverRef.current;
			}
			const measured = measureFromCell(cell);
			if (!measured) {
				if (hoverRef.current) clearHover();
				return null;
			}
			hoverRef.current = measured;
			setHover(measured);
			return measured;
		},
		[clearHover, containerRef, editor, measureFromCell],
	);

	useEffect(() => {
		// Gutter buttons sit outside the container's visual box, so pointer
		// tracking lives on the window: the grace zone keeps hover alive across
		// the dead gap between the table edge and the controls.
		const onPointerMove = (event: PointerEvent) => {
			if (disabled || dragRef.current) return;
			const container = containerRef.current;
			if (!container) return;
			// Moving onto (or across) the overlay's own controls must never clear
			// the hover they depend on; they only exist while hover is active.
			if (
				controlsRef.current &&
				event.target instanceof Node &&
				controlsRef.current.contains(event.target)
			) {
				return;
			}
			const current = hoverRef.current;
			if (current) {
				const containerRect = container.getBoundingClientRect();
				const pointer = {
					x: event.clientX - containerRect.left,
					y: event.clientY - containerRect.top,
				};
				if (pointerInTableGraceZone(pointer, current.tableRect, HOVER_GRACE_MARGIN)) {
					// Project gutter movement back onto the table so the row and
					// column controls track the pointer while it slides along them.
					const table = current.tableRect;
					const insideX =
						pointer.x >= table.left && pointer.x <= table.left + table.width;
					const insideY =
						pointer.y >= table.top && pointer.y <= table.top + table.height;
					if (!insideX || !insideY) {
						updateHover(
							containerRect.left + (insideX ? pointer.x : table.left + table.width / 2),
							containerRect.top + (insideY ? pointer.y : table.top + table.height / 2),
						);
					}
					return;
				}
			}
			const target = event.target;
			if (!(target instanceof Node) || !container.contains(target)) {
				if (current) clearHover();
				return;
			}
			updateHover(event.clientX, event.clientY);
		};

		// Drag listeners register in the CAPTURE phase: ProseMirror's own
		// drop handler would otherwise intercept the gesture first, treat the
		// payload as pasted text, and cancel the reorder transaction.
		const onDragOverCapture = (event: DragEvent) => {
			const currentDrag = dragRef.current;
			if (!currentDrag) return;
			event.preventDefault();
			event.stopPropagation();
			updateHover(event.clientX, event.clientY);
			const hoveredCell = hoverRef.current?.cell;
			const sameTable = dragTargetsSameTable(
				currentDrag.tableStart,
				hoveredCell?.tableStart,
			);
			if (event.dataTransfer) {
				event.dataTransfer.dropEffect = sameTable ? "move" : "none";
			}
			if (!hoveredCell || !sameTable) {
				// No stale indicator over an invalid target.
				dropTargetRef.current = null;
				setDropTarget(null);
				return;
			}
			const target = currentDrag.kind === "row" ? hoveredCell.row : hoveredCell.col;
			dropTargetRef.current = target;
			setDropTarget(target);
		};
		const onDropCapture = (event: DragEvent) => {
			const currentDrag = dragRef.current;
			if (!currentDrag) return;
			event.preventDefault();
			event.stopPropagation();
			const target = dropTargetRef.current;
			const hoveredTableStart = hoverRef.current?.cell.tableStart;
			clearDrag();
			if (
				target === null ||
				!dragTargetsSameTable(currentDrag.tableStart, hoveredTableStart)
			) {
				return;
			}
			if (target === currentDrag.from) return;
			if (currentDrag.kind === "row") {
				moveTableRowTo(editor, currentDrag.tableStart, currentDrag.from, target);
			} else {
				moveTableColumnTo(
					editor,
					currentDrag.tableStart,
					currentDrag.from,
					target,
				);
			}
		};
		const onDragEnd = () => clearDrag();
		const onBlur = () => clearDrag();

		window.addEventListener("pointermove", onPointerMove);
		window.addEventListener("dragover", onDragOverCapture, true);
		window.addEventListener("drop", onDropCapture, true);
		window.addEventListener("dragend", onDragEnd);
		window.addEventListener("blur", onBlur);
		return () => {
			window.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("dragover", onDragOverCapture, true);
			window.removeEventListener("drop", onDropCapture, true);
			window.removeEventListener("dragend", onDragEnd);
			window.removeEventListener("blur", onBlur);
		};
	}, [clearDrag, clearHover, containerRef, disabled, editor, updateHover]);

	const startDrag = useCallback(
		(kind: "row" | "col", from: number, tableStart: number) => {
			const state = { kind, from, tableStart };
			dragRef.current = state;
			setDrag(state);
		},
		[],
	);

	const mergeVisible = hasMultiCellSelection(editor) && editor.can().mergeCells();
	const splitVisible = caretInMergedCell(editor) && editor.can().splitCell();
	const showMergeBar = !disabled && (mergeVisible || splitVisible);

	if (disabled) return null;

	const showHoverControls = hover !== null && drag === null;
	const activeHover = hover;

	return (
		<div ref={controlsRef} className="rich-text-table-hover-controls absolute inset-0 z-10">
			{showHoverControls && activeHover && (
				<>
					{/* Column controls above the hovered column */}
					<button
						type="button"
						aria-label="Insert column after this column"
						className="rich-text-table-hover-button absolute z-20 -translate-x-1/2"
						style={{
							left: activeHover.cellRect.left + activeHover.cellRect.width / 2,
							top: activeHover.tableRect.top - 30,
						}}
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => insertColumnRightAt(editor, activeHover.cell)}
					>
						<Plus className="h-4 w-4" />
					</button>
					<div
						aria-hidden="true"
						className="rich-text-table-hover-button rich-text-table-hover-grip absolute z-20 -translate-x-1/2"
						style={{
							left: activeHover.cellRect.left + activeHover.cellRect.width / 2 + 26,
							top: activeHover.tableRect.top - 30,
						}}
					>
						<div
							draggable
							onDragStart={(event) => {
								event.dataTransfer.effectAllowed = "move";
								event.dataTransfer.setData("text/plain", "table-column");
								startDrag("col", activeHover.cell.col, activeHover.cell.tableStart);
							}}
							onDragEnd={clearDrag}
							className="flex h-full w-full cursor-grab items-center justify-center"
						>
							<GripHorizontal className="h-3.5 w-3.5 rotate-90" />
						</div>
					</div>

					{/* Row controls left of the hovered row */}
					<button
						type="button"
						aria-label="Insert row below this row"
						className="rich-text-table-hover-button absolute z-20"
						style={{
							left: activeHover.tableRect.left - 62,
							top:
								activeHover.rowRect.top + activeHover.rowRect.height / 2 - 12,
						}}
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => insertRowBelowAt(editor, activeHover.cell)}
					>
						<Plus className="h-4 w-4" />
					</button>
					<div
						aria-hidden="true"
						className="rich-text-table-hover-button rich-text-table-hover-grip absolute z-20"
						style={{
							left: activeHover.tableRect.left - 32,
							top:
								activeHover.rowRect.top + activeHover.rowRect.height / 2 - 12,
						}}
					>
						<div
							draggable
							onDragStart={(event) => {
								event.dataTransfer.effectAllowed = "move";
								event.dataTransfer.setData("text/plain", "table-row");
								startDrag("row", activeHover.cell.row, activeHover.cell.tableStart);
							}}
							onDragEnd={clearDrag}
							className="flex h-full w-full cursor-grab items-center justify-center"
						>
							<GripHorizontal className="h-3.5 w-3.5" />
						</div>
					</div>

					{/* Append a row at the end of the table */}
					<button
						type="button"
						aria-label="Add row at end of table"
						className="rich-text-table-hover-button absolute z-20"
						style={{
							left: activeHover.tableRect.left - 28,
							top: activeHover.tableRect.top + activeHover.tableRect.height + 6,
						}}
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => appendTableRow(editor, activeHover.cell)}
					>
						<Plus className="h-4 w-4" />
					</button>
				</>
			)}

			{/* Drop indicator while dragging a row or column */}
			{drag && hover && dropTarget !== null && dropTarget !== drag.from && (
				(drag.kind === "row" ? (
					<div
						className="rich-text-table-drop-indicator absolute z-20 h-1 rounded bg-blue-500"
						style={{
							left: hover.tableRect.left,
							width: hover.tableRect.width,
							top:
								dropTarget < drag.from
									? hover.rowRect.top - 2
									: hover.rowRect.top + hover.rowRect.height - 2,
						}}
					/>
				) : (
					<div
						className="rich-text-table-drop-indicator absolute z-20 w-1 rounded bg-blue-500"
						style={{
							top: hover.tableRect.top,
							height: hover.tableRect.height,
							left:
								dropTarget < drag.from
									? hover.cellRect.left - 2
									: hover.cellRect.left + hover.cellRect.width - 2,
						}}
					/>
				))
			)}

			{/* Contextual merge/split bar above the table */}
			{showMergeBar && hover && (
				<div
					className="rich-text-table-hover-bar absolute z-20 flex items-center gap-1 rounded-md border border-slate-200 bg-white p-1 shadow-md"
					style={{
						left: hover.tableRect.left,
						top: Math.max(0, hover.tableRect.top - 40),
					}}
				>
					{mergeVisible && (
						<button
							type="button"
							aria-label="Merge selected cells"
							className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => editor.chain().focus().mergeCells().run()}
						>
							<Merge className="h-3.5 w-3.5" />
							Merge cells
						</button>
					)}
					{splitVisible && (
						<button
							type="button"
							aria-label="Split merged cell"
							className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => editor.chain().focus().splitCell().run()}
						>
							<Split className="h-3.5 w-3.5" />
							Split cell
						</button>
					)}
				</div>
			)}
		</div>
	);
}

export default RichTextTableHoverControls;
