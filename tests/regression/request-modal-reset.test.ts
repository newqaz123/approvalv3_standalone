import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Source-contract regression test (Task 1 brief): the New Request dialog must
// reset every request-mode field when request mode closes, so the next open
// never paints stale title/description/template from a previous draft.
// Reset-on-open in useEffect flashed those values for a frame. Solution/
// resubmit fields are deliberately NOT part of the reset callback — only
// request-mode state is touched. Staged drafts are not dropped here: cancel
// DELETEs via hook reset() and success drops them via clear() so reopen
// cannot unlink adopted files.
it("resets every New Request field when request mode closes", () => {
	const source = readFileSync(
		"src/components/requests/submitter-modal.tsx",
		"utf8",
	);
	assert.match(source, /const resetRequestDraft = useCallback/);
	assert.match(source, /requestModeWasOpenRef/);
	assert.match(
		source,
		/else if \(requestModeWasOpenRef\.current\)/,
	);
	assert.match(source, /resetRequestDraft\(\)/);
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
	assert.doesNotMatch(
		source,
		/useEffect\(\(\) => \{[\s\S]*resetRequestDraft\(\)[\s\S]*\}, \[mode, open, resetRequestDraft\]\)/,
	);
});
