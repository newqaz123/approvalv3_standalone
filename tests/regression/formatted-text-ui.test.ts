import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FormattedText } from "@/components/ui/formatted-text";
import { wrapSelectionWithBold } from "@/components/ui/formatted-textarea";

const read = (path: string) => readFileSync(path, "utf8");

describe("formatted text UI contracts", () => {
	it("wraps a selection in bold markers", () => {
		assert.deepEqual(wrapSelectionWithBold("hello world", 6, 11), {
			value: "hello **world**",
			selectionStart: 8,
			selectionEnd: 13,
		});
	});

	it("keeps trailing whitespace outside bold markers when wrapping Topic : ", () => {
		// Selecting "Topic : " (including the trailing space) before "test".
		assert.deepEqual(wrapSelectionWithBold("Topic : test", 0, 8), {
			value: "**Topic :** test",
			selectionStart: 2,
			selectionEnd: 9,
		});
	});

	it("keeps leading and trailing selection whitespace outside bold delimiters", () => {
		assert.deepEqual(wrapSelectionWithBold("xx  core  yy", 2, 10), {
			value: "xx  **core**  yy",
			selectionStart: 6,
			selectionEnd: 10,
		});
	});

	it("leaves whitespace-only selections unchanged", () => {
		assert.deepEqual(wrapSelectionWithBold("a   b", 1, 4), {
			value: "a   b",
			selectionStart: 1,
			selectionEnd: 4,
		});
	});

	it("inserts an empty bold pair and places the caret between markers", () => {
		assert.deepEqual(wrapSelectionWithBold("hello", 5, 5), {
			value: "hello****",
			selectionStart: 7,
			selectionEnd: 7,
		});
	});

	it("renders only trusted application HTML", () => {
		const html = renderToStaticMarkup(createElement(FormattedText, {
			source: '<p onclick="alert(1)"><span data-text-color="teal" style="position:fixed">Safe</span><script>bad()</script></p>',
		}));

		assert.equal(
			html,
			'<span class="rich-text"><p><span style="color:#0F766E">Safe</span></p></span>',
		);
		assert.doesNotMatch(html, /onclick|position|fixed|<script/);
	});

	it("exposes an accessible Bold control", () => {
		const source = read("src/components/ui/formatted-textarea.tsx");
		assert.match(source, /aria-label=["']Bold["']/);
		assert.match(source, /data-testid=["']formatted-text-bold["']/);
		assert.match(source, /wrapSelectionWithBold/);
	});
});
