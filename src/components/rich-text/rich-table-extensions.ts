import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import {
	TableCell,
	TableHeader,
	TableRow,
	Table,
} from "@tiptap/extension-table";
import {
	CellSelection,
	cellAround,
	findTable,
	moveTableColumn,
	moveTableRow,
	TableMap,
} from "@tiptap/pm/tables";

/** Vertical align values a description table cell may carry. */
import { normalizeTableVerticalAlign } from '@/lib/rich-table-vertical-align'

export { normalizeTableVerticalAlign, TABLE_VERTICAL_ALIGN_VALUES } from '@/lib/rich-table-vertical-align'
export type { TableVerticalAlign } from '@/lib/rich-table-vertical-align'

// biome-ignore lint/suspicious/noExplicitAny: TipTap extension base typing
function withVerticalAlignAttributes(Node: any) {
	return Node.extend({
		addAttributes() {
			return {
				...this.parent?.(),
				verticalAlign: {
					default: null,
					parseHTML: (element: HTMLElement) =>
						normalizeTableVerticalAlign(
							element.getAttribute("data-vertical-align"),
						),
					renderHTML: (attributes: { verticalAlign?: string | null }) =>
						normalizeTableVerticalAlign(attributes.verticalAlign)
							? { "data-vertical-align": attributes.verticalAlign }
							: {},
				},
			};
		},
	});
}

/** Description table cells carrying the curated vertical-align attribute. */
export const RichTableCell = withVerticalAlignAttributes(TableCell);
export const RichTableHeader = withVerticalAlignAttributes(TableHeader);

/** Bundles the approved description table schema into one extension. */
export const RichTableKit = Extension.create({
	name: "richTableKit",
	addExtensions() {
		return [
			Table.configure({ resizable: true }),
			TableRow,
			RichTableCell,
			RichTableHeader,
		];
	},
});

export type HoveredTableCell = {
	/** Absolute document position of the table node. */
	tableStart: number;
	/** Absolute document position of the hovered cell node. */
	cellStart: number;
	/** Zero-based hovered row index. */
	row: number;
	/** Zero-based hovered column index. */
	col: number;
	/** Column count of the table. */
	width: number;
	/** Row count of the table. */
	height: number;
};

/** Resolves the hovered table cell metadata from a document position. */
export function hoveredTableCellAt(
	editor: Pick<Editor, "state">,
	position: number,
): HoveredTableCell | null {
	const $pos = editor.state.doc.resolve(position);
	const cell = cellAround($pos);
	if (!cell) return null;
	const table = findTable($pos);
	if (!table) return null;
	const map = TableMap.get(table.node);
	const rect = map.findCell(cell.pos - table.start);
	return {
		tableStart: table.start,
		cellStart: cell.pos,
		row: rect.top,
		col: rect.left,
		width: map.width,
		height: map.height,
	};
}

/**
 * Absolute document position of a cell in the given table at (row, col),
 * clamped to the table bounds. Returns null when the table is gone.
 */
export function cellPositionInTable(
	editor: Pick<Editor, "state">,
	tableStart: number,
	row: number,
	col: number,
): number | null {
	const table = findTable(editor.state.doc.resolve(tableStart + 1));
	if (!table) return null;
	const map = TableMap.get(table.node);
	const clampedRow = Math.max(0, Math.min(row, map.height - 1));
	const clampedCol = Math.max(0, Math.min(col, map.width - 1));
	// map.positionAt is relative to the table start (table.pos + 1).
	return table.start + map.positionAt(clampedRow, clampedCol, table.node);
}

/**
 * Selects exactly one cell. Cell selections work for empty cells where a
 * text selection cannot land (a paragraph boundary is not inline content).
 */
function selectSingleCell(editor: Editor, cellStart: number): boolean {
	return editor.commands.setCellSelection({
		anchorCell: cellStart,
		headCell: cellStart,
	});
}

/** Inserts a row directly below the given row index. */
export function insertRowBelowAt(
	editor: Editor,
	cell: HoveredTableCell,
): boolean {
	return editor
		.chain()
		.setCellSelection({
			anchorCell: cell.cellStart,
			headCell: cell.cellStart,
		})
		.addRowAfter()
		.run();
}

/** Inserts a column directly to the right of the given column index. */
export function insertColumnRightAt(
	editor: Editor,
	cell: HoveredTableCell,
): boolean {
	return editor
		.chain()
		.setCellSelection({
			anchorCell: cell.cellStart,
			headCell: cell.cellStart,
		})
		.addColumnAfter()
		.run();
}

/** Appends a row after the last table row, regardless of the hovered cell. */
export function appendTableRow(
	editor: Editor,
	cell: HoveredTableCell,
): boolean {
	const lastRowCellStart = cellPositionInTable(
		editor,
		cell.tableStart,
		cell.height - 1,
		cell.col,
	);
	if (lastRowCellStart === null) return false;
	return insertRowBelowAt(editor, { ...cell, cellStart: lastRowCellStart });
}

/** Appends a column after the last table column, regardless of the hovered cell. */
export function appendTableColumn(
	editor: Editor,
	cell: HoveredTableCell,
): boolean {
	const lastColCellStart = cellPositionInTable(
		editor,
		cell.tableStart,
		cell.row,
		cell.width - 1,
	);
	if (lastColCellStart === null) return false;
	return insertColumnRightAt(editor, { ...cell, cellStart: lastColCellStart });
}

/**
 * Park the caret inside the source table. prosemirror-tables' move helpers
 * derive their ranges from tr.selection, so a caret anywhere outside the
 * table would break or mis-target the move.
 */
function parkSelectionInTable(
	editor: Editor,
	tableStart: number,
	row: number,
	col: number,
): boolean {
	const anchor = cellPositionInTable(editor, tableStart, row, col);
	if (anchor === null) return false;
	return selectSingleCell(editor, anchor);
}

/** Moves a table row to a new zero-based index. */
export function moveTableRowTo(
	editor: Editor,
	tableStart: number,
	from: number,
	to: number,
): boolean {
	// Resolve inside the table (depth >= 1); resolve(tableStart) itself is
	// depth 0 (the doc) and findTable would never see the table.
	if (!parkSelectionInTable(editor, tableStart, from, 0)) return false;
	return moveTableRow({ from, to, pos: tableStart + 1, select: false })(
		editor.state,
		editor.view.dispatch,
	);
}

/** Moves a table column to a new zero-based index. */
export function moveTableColumnTo(
	editor: Editor,
	tableStart: number,
	from: number,
	to: number,
): boolean {
	if (!parkSelectionInTable(editor, tableStart, 0, from)) return false;
	return moveTableColumn({ from, to, pos: tableStart + 1, select: false })(
		editor.state,
		editor.view.dispatch,
	);
}

/** True when the current selection spans more than one table cell. */
export function hasMultiCellSelection(editor: Editor): boolean {
	return editor.state.selection instanceof CellSelection;
}

/** Table metadata for the cell the selection currently sits in. */
export function selectionTableCell(editor: Editor): HoveredTableCell | null {
	const cell = cellAround(editor.state.selection.$from);
	return cell ? hoveredTableCellAt(editor, cell.pos) : null;
}

/** True when the caret sits inside a cell that spans others (merged). */
export function caretInMergedCell(editor: Editor): boolean {
	const cell = cellAround(editor.state.selection.$from);
	if (!cell) return false;
	const node = editor.state.doc.nodeAt(cell.pos);
	if (!node) return false;
	return (
		Number(node.attrs.colspan ?? 1) > 1 || Number(node.attrs.rowspan ?? 1) > 1
	);
}

export type Rect = { left: number; top: number; width: number; height: number };

/** True when the pointer (container-relative) stays near the hovered table. */
export function pointerInTableGraceZone(
	pointer: { x: number; y: number },
	tableRect: Rect,
	margin: number,
): boolean {
	return (
		pointer.x >= tableRect.left - margin &&
		pointer.x <= tableRect.left + tableRect.width + margin &&
		pointer.y >= tableRect.top - margin &&
		pointer.y <= tableRect.top + tableRect.height + margin
	);
}

/** True only when a drag hovers the same table it started in. */
export function dragTargetsSameTable(
	dragTableStart: number,
	hoveredTableStart: number | null | undefined,
): boolean {
	return (
		hoveredTableStart !== null &&
		hoveredTableStart !== undefined &&
		hoveredTableStart === dragTableStart
	);
}
