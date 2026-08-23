import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

const header = "src/components/requests/request-modal-header.tsx";

// Modals that shipped the copy-pasted "title + badge + submitter + custom X"
// header that overlaps itself on phones.
const copyPasteModals = [
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
	it("exports a shared header that stacks on phones and clears the built-in close", () => {
		const source = read(header);

		assert.match(source, /export function RequestModalHeader\b/);

		// Phones stack: title block over submitter; md restores the row.
		assert.match(
			source,
			/flex flex-col gap-3 pr-10 md:flex-row md:items-start md:justify-between/,
		);
		assert.match(
			source,
			/flex-col gap-2 md:flex-row md:items-center md:gap-3/,
		);

		// The title wraps instead of truncating on phones and truncates on md.
		assert.match(source, /break-words[\s\S]*?md:truncate/);

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
