import {
	containsRichTextHtml,
	richTextToPlainText,
	sanitizeRichText,
} from "@/lib/rich-text-sanitizer";
import { inlineImageAltPlaceholder } from "@/lib/inline-images/policy";
import { materializeRichTextForEmail } from "@/lib/rich-text-presentation";

export type FormattedTextToken =
	| { type: "text" | "bold"; value: string }
	| { type: "lineBreak" };

function isWhitespace(char: string): boolean {
	return (
		char === " " ||
		char === "\t" ||
		char === "\n" ||
		char === "\r" ||
		char === "\f" ||
		char === "\v"
	);
}

function appendValue(
	tokens: FormattedTextToken[],
	type: "text" | "bold",
	value: string,
): void {
	if (value.length === 0) {
		return;
	}

	const last = tokens[tokens.length - 1];
	if (last && last.type === type) {
		last.value += value;
		return;
	}

	tokens.push({ type, value });
}

function appendLineBreak(tokens: FormattedTextToken[]): void {
	tokens.push({ type: "lineBreak" });
}

function appendStyledContent(
	tokens: FormattedTextToken[],
	type: "text" | "bold",
	content: string,
): void {
	let index = 0;
	while (index < content.length) {
		if (content.startsWith("\r\n", index)) {
			appendLineBreak(tokens);
			index += 2;
			continue;
		}

		if (content[index] === "\n") {
			appendLineBreak(tokens);
			index += 1;
			continue;
		}

		let end = index;
		while (end < content.length) {
			if (content.startsWith("\r\n", end) || content[end] === "\n") {
				break;
			}
			end += 1;
		}

		appendValue(tokens, type, content.slice(index, end));
		index = end;
	}
}

function findBoldCloseIndex(source: string, contentStart: number): number {
	for (let index = contentStart; index < source.length - 1; index += 1) {
		if (source[index] !== "*" || source[index + 1] !== "*") {
			continue;
		}

		// Empty content between delimiters (e.g. ****) is never bold.
		if (index === contentStart) {
			return -1;
		}

		// Allow trailing whitespace inside a non-empty bold span so already-stored
		// values like "**Topic : ** test" still render as bold rather than raw markers.
		return index;
	}

	return -1;
}

export function tokenizeFormattedText(source: string): FormattedTextToken[] {
	const tokens: FormattedTextToken[] = [];
	let index = 0;

	while (index < source.length) {
		if (source.startsWith("\r\n", index)) {
			appendLineBreak(tokens);
			index += 2;
			continue;
		}

		if (source[index] === "\n") {
			appendLineBreak(tokens);
			index += 1;
			continue;
		}

		if (source.startsWith("**", index)) {
			const contentStart = index + 2;
			const openerFollowedByContent =
				contentStart < source.length && !isWhitespace(source[contentStart]!);

			if (openerFollowedByContent) {
				const closeIndex = findBoldCloseIndex(source, contentStart);
				if (closeIndex !== -1) {
					appendStyledContent(
						tokens,
						"bold",
						source.slice(contentStart, closeIndex),
					);
					index = closeIndex + 2;
					continue;
				}
			}

			appendValue(tokens, "text", "**");
			index += 2;
			continue;
		}

		// Consume a run of plain text up to the next special sequence.
		let end = index + 1;
		while (end < source.length) {
			if (
				source.startsWith("\r\n", end) ||
				source[end] === "\n" ||
				source.startsWith("**", end)
			) {
				break;
			}
			end += 1;
		}

		appendValue(tokens, "text", source.slice(index, end));
		index = end;
	}

	return tokens;
}

function codePointLength(value: string): number {
	return Array.from(value).length;
}

function sliceByCodePoints(value: string, maxCodePoints: number): string {
	if (maxCodePoints <= 0) {
		return "";
	}

	return Array.from(value).slice(0, maxCodePoints).join("");
}

function tokenVisibleLength(token: FormattedTextToken): number {
	return token.type === "lineBreak" ? 1 : codePointLength(token.value);
}

function tokensToVisibleString(tokens: FormattedTextToken[]): string {
	let result = "";
	for (const token of tokens) {
		if (token.type === "lineBreak") {
			result += "\n";
		} else {
			result += token.value;
		}
	}
	return result;
}

export function visibleFormattedText(source: string): string {
	// Rich HTML must be measured by its visible text: counting the legacy
	// tokenization of raw markup would inflate the length with tags and
	// attributes (a sparse table alone can exceed any preview budget).
	// Images become alt placeholders (mirroring renderDescriptionPlainText)
	// so image-only descriptions still measure as visible content.
	if (containsRichTextHtml(source)) {
		return richTextToPlainText(
			inlineImageAltPlaceholder(sanitizeRichText(source)),
		);
	}
	return tokensToVisibleString(tokenizeFormattedText(source));
}

function trimTrailingHorizontalWhitespaceTokens(
	tokens: FormattedTextToken[],
): void {
	// Preserve counted lineBreak tokens. Only strip trailing horizontal whitespace before ellipsis,
	// including horizontal whitespace that sits immediately before a preserved trailing newline.
	let index = tokens.length - 1;
	while (index >= 0) {
		const token = tokens[index]!;
		if (token.type === "lineBreak") {
			index -= 1;
			continue;
		}

		const trimmed = token.value.replace(/[ \t\f\v]+$/u, "");
		if (trimmed.length === 0) {
			tokens.splice(index, 1);
			index -= 1;
			continue;
		}

		if (trimmed !== token.value) {
			token.value = trimmed;
		}
		break;
	}
}

export function truncateFormattedText(
	source: string,
	maxVisibleCharacters: number,
): FormattedTextToken[] {
	const tokens = tokenizeFormattedText(source);
	if (maxVisibleCharacters < 0) {
		maxVisibleCharacters = 0;
	}

	const fullVisibleLength = tokens.reduce(
		(sum, token) => sum + tokenVisibleLength(token),
		0,
	);
	if (fullVisibleLength <= maxVisibleCharacters) {
		return tokens;
	}

	const truncated: FormattedTextToken[] = [];
	let used = 0;

	for (const token of tokens) {
		if (used >= maxVisibleCharacters) {
			break;
		}

		if (token.type === "lineBreak") {
			appendLineBreak(truncated);
			used += 1;
			continue;
		}

		const remaining = maxVisibleCharacters - used;
		const valueLength = codePointLength(token.value);
		if (valueLength <= remaining) {
			appendValue(truncated, token.type, token.value);
			used += valueLength;
			continue;
		}

		appendValue(
			truncated,
			token.type,
			sliceByCodePoints(token.value, remaining),
		);
		used = maxVisibleCharacters;
		break;
	}

	trimTrailingHorizontalWhitespaceTokens(truncated);
	appendValue(truncated, "text", "...");
	return truncated;
}

export function escapeFormattedTextHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function selectTokens(
	source: string,
	maxVisibleCharacters?: number,
): FormattedTextToken[] {
	if (maxVisibleCharacters === undefined) {
		return tokenizeFormattedText(source);
	}
	return truncateFormattedText(source, maxVisibleCharacters);
}

export function renderFormattedTextHtml(
	source: string,
	maxVisibleCharacters?: number,
): string {
	const tokens = selectTokens(source, maxVisibleCharacters);
	let html = "";

	for (const token of tokens) {
		if (token.type === "lineBreak") {
			html += "<br />";
			continue;
		}

		const escaped = escapeFormattedTextHtml(token.value);
		if (token.type === "bold") {
			html += `<strong>${escaped}</strong>`;
		} else {
			html += escaped;
		}
	}

	return html;
}

export function renderFormattedTextPlainText(
	source: string,
	maxVisibleCharacters?: number,
): string {
	return tokensToVisibleString(selectTokens(source, maxVisibleCharacters));
}

/**
 * Notification-email description renderer: trusted HTML presentation for rich
 * rows and escaped legacy markup otherwise. Rich truncation is parser-balanced.
 * Approved images become escaped alt placeholders before truncation, so email
 * output never carries private image URLs or image bytes.
 */
export function renderDescriptionHtml(
	source: string,
	maxVisibleCharacters?: number,
): string {
	if (containsRichTextHtml(source)) {
		return materializeRichTextForEmail(source, maxVisibleCharacters);
	}
	return materializeRichTextForEmail(
		renderFormattedTextHtml(source, maxVisibleCharacters),
	);
}

export function renderDescriptionPlainText(
	source: string,
	maxVisibleCharacters?: number,
): string {
	if (containsRichTextHtml(source)) {
		const plain = richTextToPlainText(
			inlineImageAltPlaceholder(sanitizeRichText(source)),
		);
		return maxVisibleCharacters === undefined
			? plain
			: plain.slice(0, maxVisibleCharacters);
	}
	return renderFormattedTextPlainText(source, maxVisibleCharacters);
}
