import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Source-contract regression test (Task 1 brief): the New Request dialog must
// reset every request-mode field whenever request mode opens, so stale state
// from a previous open (title, description, template, custom hierarchy)
// can never leak into a fresh request. Solution/resubmit fields are deliberately
// NOT part of the reset callback — only request-mode state is touched.
// Staged drafts are not dropped here: cancel DELETEs via hook reset() and
// success drops them via clear() so reopen cannot unlink adopted files.
it("resets every New Request field whenever request mode opens", () => {
	const source = readFileSync(
		"src/components/requests/submitter-modal.tsx",
		"utf8",
	);
	assert.match(source, /const resetRequestDraft = useCallback/);
	assert.match(source, /if \(mode !== ['"]request['"] \|\| !open\) return/);
	for (const reset of [
		'setTitle("")',
		'setDescription("")',
		'setSelectedTemplate("")',
		"setFileUploadError(null)",
		"setUseCustomHierarchy(false)",
		"setCustomApprovers([])",
		"setDeletedFileIds([])",
	]) {
		assert.match(
			source,
			new RegExp(reset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
		);
	}
	assert.doesNotMatch(source, /setFiles\(\[\]\)/);
	assert.match(
		source,
		/useEffect\(\(\) => \{[\s\S]*resetRequestDraft\(\)[\s\S]*\}, \[mode, open, resetRequestDraft\]\)/,
	);
});
