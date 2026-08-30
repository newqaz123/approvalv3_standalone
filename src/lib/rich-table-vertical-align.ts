/** Vertical align values a description table cell may carry. */
export const TABLE_VERTICAL_ALIGN_VALUES = ["top", "middle", "bottom"] as const;
export type TableVerticalAlign = (typeof TABLE_VERTICAL_ALIGN_VALUES)[number];

/** Curated allow-list normalization; anything else is invalid. */
export function normalizeTableVerticalAlign(
	value: unknown,
): TableVerticalAlign | null {
	return typeof value === "string" &&
		(TABLE_VERTICAL_ALIGN_VALUES as readonly string[]).includes(value)
		? (value as TableVerticalAlign)
		: null;
}
