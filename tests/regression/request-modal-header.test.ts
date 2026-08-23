import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

const header = "src/components/requests/request-modal-header.tsx";

// Modals that shipped the copy-pasted "title + badge + submitter + custom X"
// header that overlaps itself on phones.
const copyPasteModals = [
	"src/components/requests/completed-final-modal.tsx",
	"src/components/requests/completed-request-modal.tsx",
	"src/components/requests/completed-solution-modal.tsx",
	"src/components/requests/approver-modal.tsx",
	"src/components/requests/final-approval-modal.tsx",
	"src/components/requests/final-approval-resubmit-modal.tsx",
	"src/components/requests/status-modal.tsx",
	"src/components/requests/solution-modal.tsx",
	"src/components/requests/submit-final-approval-modal.tsx",
];

describe("request modal header", () => {
	it("exports a shared header that is a 2-line strip on phones and unchanged on md", () => {
		const source = read(header);

		assert.match(source, /export function RequestModalHeader\b/);

		// Phones: compact column; md restores the side-by-side row.
		assert.match(
			source,
			/flex flex-col gap-1\.5 pr-10 md:flex-row md:items-start md:justify-between/,
		);

		// Title + badge share one row on phones (title truncates; chip stays).
		assert.match(source, /flex min-w-0 items-center gap-2 md:gap-3/);
		assert.match(source, /min-w-0 flex-1 truncate/);
		assert.doesNotMatch(source, /flex-col gap-2 md:flex-row/);
		assert.doesNotMatch(source, /DialogTitle className="[^"]*break-words/);

		// Mobile submitter is one truncated name · email line; desktop stays stacked.
		assert.match(source, /md:hidden/);
		assert.match(source, /hidden[\s\S]*?md:flex/);
		assert.match(source, /\{submitter\.name\} · \{submitter\.email\}/);

		// No custom X button: DialogContent already renders a close button, and
		// the old duplicate stacked on top of it on phones.
		assert.doesNotMatch(source, /<X\b/);
	});

	for (const path of copyPasteModals) {
		it(`uses the shared header and drops the duplicate close button in ${path}`, () => {
			const source = read(path);

			assert.match(source, /<RequestModalHeader\b/);
			assert.doesNotMatch(source, /<X className="w-5 h-5"/);
		});
	}
});
