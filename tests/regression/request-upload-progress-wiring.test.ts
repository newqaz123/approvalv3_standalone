import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { join, dirname } from "node:path";

/**
 * Contract tests for the request-mode upload progress wiring introduced with
 * the upload-feedback feature. These lock the caller→modal contract:
 *   1. Callers collect failed upload indices and forward them so the modal
 *      never renders a failed file as a green success check.
 *   2. The submitter modal resets stale submit progress when request mode
 *      reopens, so freshly selected files do not inherit green checks.
 * Source-regex style matches the existing inline-image-form-wiring suite —
 * there is no component-test infrastructure in this repo.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const modal = read("src/components/requests/submitter-modal.tsx");
const listCaller = read("src/components/requests/requests-list-client.tsx");
const followUpCaller = read(
	"src/components/dashboard/follow-up-dashboard.tsx",
);

test("callers collect failed upload indices and forward them", () => {
	for (const [name, src] of [
		["requests-list-client", listCaller],
		["follow-up-dashboard", followUpCaller],
	] as const) {
		assert.match(src, /const failedIndices: number\[\] = \[\]/, `${name}: declares collector`);
		assert.match(src, /failedIndices\.push\(i\)/, `${name}: records failures`);
		assert.match(
			src,
			/phase: .finalizing.[\s\S]*?failedIndices: \[\.\.\.failedIndices\]/,
			`${name}: finalizing emit carries failures`,
		);
	}
});

test("modal renders failures as errors, never as green checks", () => {
	assert.match(modal, /requestProgress\?\.failedIndices\?\.includes\(/, "derives isFailed from failedIndices");
	assert.match(modal, /<AlertTriangle[^/]*text-red-600/, "failed rows render a red error icon");
	assert.match(modal, /const isUploaded =\s*\n\s*!isFailed &&/, "failed rows are excluded from the success state");
});

test("modal resets stale submit progress when request mode reopens", () => {
	const reset = modal.split("const resetRequestDraft = useCallback(")[1]?.split("}, \[\]);")[0] ?? "";
	assert.ok(reset.length > 0, "resetRequestDraft found");
	assert.match(reset, /setRequestProgress\(null\)/, "reset clears requestProgress");
});
