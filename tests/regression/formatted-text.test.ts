import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FormattedText } from "@/components/ui/formatted-text";
import {
	renderFormattedTextHtml,
	renderFormattedTextPlainText,
	tokenizeFormattedText,
	truncateFormattedText,
	visibleFormattedText,
} from "@/lib/formatted-text";

describe("formatted description tokenizer", () => {
	it("keeps plain text unchanged", () => {
		assert.deepEqual(tokenizeFormattedText("plain text"), [
			{ type: "text", value: "plain text" },
		]);
		assert.equal(visibleFormattedText("plain text"), "plain text");
		assert.equal(renderFormattedTextPlainText("plain text"), "plain text");
	});

	it("creates bold tokens for multiple non-empty paired spans", () => {
		assert.deepEqual(tokenizeFormattedText("A **bold** and **strong**."), [
			{ type: "text", value: "A " },
			{ type: "bold", value: "bold" },
			{ type: "text", value: " and " },
			{ type: "bold", value: "strong" },
			{ type: "text", value: "." },
		]);
		assert.equal(
			visibleFormattedText("A **bold** and **strong**."),
			"A bold and strong.",
		);
	});

	it("measures rich HTML by visible text, not raw markup", () => {
		// A sparse table's markup alone exceeds 300 characters; only the cell
		// text may count toward preview budgets.
		const row = '<tr><td>a</td><td>b</td><td>c</td></tr>';
		const rich =
			`<table><tbody><tr><th>Column one</th><th>Column two</th><th>Column three</th></tr>${row}${row}${row}${row}${row}${row}</tbody></table>`;
		assert.ok(rich.length > 300);
		assert.equal(
			visibleFormattedText(rich),
			"Column one Column two Column three " + Array(6).fill("a b c").join(" "),
		);
	});

	it("counts sanitized images as alt placeholders so image-rich previews can expand", () => {
		const image =
			'<p><img src="/api/inline-images/123e4567-e89b-42d3-a456-426614174000" alt="Diagram" data-align="center"></p>';
		const source = image.repeat(4);
		assert.ok(source.length > 300);
		assert.equal(visibleFormattedText(source), "[Image: Diagram] [Image: Diagram] [Image: Diagram] [Image: Diagram]");
	});

	it("turns each newline into a line-break token and preserves it in plain text", () => {
		assert.deepEqual(
			tokenizeFormattedText("first\nsecond\r\nthird").filter(
				(token) => token.type === "lineBreak",
			),
			[{ type: "lineBreak" }, { type: "lineBreak" }],
		);
		assert.equal(
			visibleFormattedText("first\nsecond\r\nthird"),
			"first\nsecond\nthird",
		);
	});

	it("leaves unmatched and malformed markers literal", () => {
		assert.deepEqual(tokenizeFormattedText("before **unmatched"), [
			{ type: "text", value: "before **unmatched" },
		]);
		assert.deepEqual(tokenizeFormattedText("****"), [
			{ type: "text", value: "****" },
		]);
		assert.deepEqual(tokenizeFormattedText("**  **"), [
			{ type: "text", value: "**  **" },
		]);
		assert.deepEqual(tokenizeFormattedText("****text"), [
			{ type: "text", value: "****text" },
		]);
	});

	it("renders non-empty bold spans that include trailing whitespace before the closer", () => {
		// Stored values from the selection-wrap bug: "**Topic : ** test"
		assert.deepEqual(tokenizeFormattedText("**Topic : ** test"), [
			{ type: "bold", value: "Topic : " },
			{ type: "text", value: " test" },
		]);
		assert.equal(
			renderFormattedTextHtml("**Topic : ** test"),
			"<strong>Topic : </strong> test",
		);
		assert.deepEqual(tokenizeFormattedText("**open ** close"), [
			{ type: "bold", value: "open " },
			{ type: "text", value: " close" },
		]);
		assert.equal(visibleFormattedText("**open ** close"), "open  close");
	});

	it("treats script-looking input through the rich boundary when it carries a whitelisted tag", () => {
		const source = "<script>alert(1)</script> **<img src=x onerror=alert(1)>**";
		// containsRichTextHtml is the storage-level boundary: this source is
		// rendered as rich HTML everywhere (FormattedText, email, PDF), so the
		// visible-text measurement must agree with the rich renderer, not the
		// legacy tokenizer.
		assert.equal(visibleFormattedText(source), "****");
		assert.equal(
			renderFormattedTextHtml(source),
			"&lt;script&gt;alert(1)&lt;/script&gt; <strong>&lt;img src=x onerror=alert(1)&gt;</strong>",
		);
	});

	it("supports bold spans at the beginning and end of the source", () => {
		assert.deepEqual(tokenizeFormattedText("**start** middle **end**"), [
			{ type: "bold", value: "start" },
			{ type: "text", value: " middle " },
			{ type: "bold", value: "end" },
		]);
	});

	it("truncates visible content without leaving raw markers or a partial source span", () => {
		const tokens = truncateFormattedText("before **bold words** after", 12);
		assert.equal(
			tokens
				.map((token) => (token.type === "lineBreak" ? "\n" : token.value))
				.join(""),
			"before bold...",
		);
		assert.equal(
			renderFormattedTextPlainText("before **bold words** after", 12),
			"before bold...",
		);
		assert.doesNotMatch(
			renderFormattedTextHtml("before **bold words** after", 12),
			/\*\*/,
		);
	});

	it("truncates by Unicode code points so non-BMP characters are not split", () => {
		const tokens = truncateFormattedText("👍extra", 1);
		const visible = tokens
			.map((token) => (token.type === "lineBreak" ? "\n" : token.value))
			.join("");
		assert.equal(visible, "👍...");
		for (const token of tokens) {
			if (token.type === "lineBreak") continue;
			// Reject lone UTF-16 surrogates from code-unit slicing.
			assert.doesNotMatch(token.value, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
			assert.doesNotMatch(token.value, /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u);
		}
		assert.equal(renderFormattedTextPlainText("👍extra", 1), "👍...");
		assert.equal(renderFormattedTextHtml("👍extra", 1), "👍...");
	});

	it("preserves a counted trailing newline when truncating and only trims horizontal whitespace", () => {
		const tokens = truncateFormattedText("ab\ncd", 3);
		assert.deepEqual(tokens, [
			{ type: "text", value: "ab" },
			{ type: "lineBreak" },
			{ type: "text", value: "..." },
		]);
		assert.equal(renderFormattedTextPlainText("ab\ncd", 3), "ab\n...");
		assert.equal(renderFormattedTextHtml("ab\ncd", 3), "ab<br />...");

		const spaced = truncateFormattedText("ab \ncd", 4);
		assert.deepEqual(spaced, [
			{ type: "text", value: "ab" },
			{ type: "lineBreak" },
			{ type: "text", value: "..." },
		]);
		assert.equal(renderFormattedTextPlainText("ab \ncd", 4), "ab\n...");
	});
});

describe("FormattedText dual-format rendering", () => {
	it("renders trusted palette output for rich HTML", () => {
		const html = renderToStaticMarkup(createElement(FormattedText, {
			source: '<p><span data-text-color="blue" style="position:fixed">Safe</span></p>',
		}));

		assert.equal(html, '<span class="rich-text"><p><span style="color:#1D4ED8">Safe</span></p></span>');
		assert.doesNotMatch(html, /position|fixed/);
	});

	it("keeps balanced palette marks and URL-free image placeholders in truncated rich previews", () => {
		const html = renderToStaticMarkup(createElement(FormattedText, {
			source: '<p><span data-text-color="blue">Hi<img src="/api/inline-images/123e4567-e89b-42d3-a456-426614174000" alt="chart"><mark data-highlight="yellow">there</mark></span></p>',
			maxVisibleCharacters: 4,
		}));

		assert.match(html, /<span style="color:#1D4ED8">Hi\[Image: chart\]<mark style="background-color:#FEF3C7">th<\/mark><\/span>/);
		assert.doesNotMatch(html, /\/api\/inline-images|<img/i);
	});

	it("fix 2: omits image placeholders and nested sibling marks after the cutoff", () => {
		const html = renderToStaticMarkup(createElement(FormattedText, {
			source: '<p><span data-text-color="blue">Keep</span><img src="/api/inline-images/123e4567-e89b-42d3-a456-426614174000" alt="secret"><strong>later <em>nested</em></strong></p>',
			maxVisibleCharacters: 4,
		}));

		assert.equal(
			html,
			'<span class="rich-text"><p><span style="color:#1D4ED8">Keep</span></p></span>',
		);
	});

	it("keeps the legacy tokenizer behavior for non-HTML sources", () => {
		assert.equal(
			renderToStaticMarkup(createElement(FormattedText, { source: 'A **bold** line' })),
			'A <strong>bold</strong> line',
		);
	});
});

describe("FormattedText rich output styling", () => {
	it("applies the rich-text class alongside a caller class", () => {
		assert.equal(
			renderToStaticMarkup(createElement(FormattedText, {
				source: '<p>Safe</p>',
				className: 'description',
			})),
			'<span class="description rich-text"><p>Safe</p></span>',
		);
	});

	it("retains sanitized image alignment for uncropped application images", () => {
		const html = renderToStaticMarkup(createElement(FormattedText, {
			source: '<img src="/api/inline-images/123e4567-e89b-42d3-a456-426614174000" alt="chart" data-align="left">',
		}));

		assert.match(html, /<img [^>]*data-align="left"/);
		assert.doesNotMatch(html, /rich-text__image-frame/);
	});

	it("does not expose hostile authored attributes through the HTML boundary", () => {
		const html = renderToStaticMarkup(createElement(FormattedText, {
			source: '<p onclick="alert(1)"><a href="javascript:alert(1)">Safe</a></p>',
		}));

		assert.match(html, />Safe<\/a>/);
		assert.doesNotMatch(html, /onclick|javascript|alert/);
	});
});
