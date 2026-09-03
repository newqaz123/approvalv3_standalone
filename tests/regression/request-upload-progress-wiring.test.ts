import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { join, dirname } from "node:path";

/**
 * Task 4 contract: request-mode SubmitterModal stages via
 * useStagedRequestAttachments, then callers createRequest once with ready IDs.
 * Solution/resubmit upload progress (describeUploadProgress) is unchanged.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const modal = read("src/components/requests/submitter-modal.tsx");
const listCaller = read("src/components/requests/requests-list-client.tsx");
const followUpCaller = read(
	"src/components/dashboard/follow-up-dashboard.tsx",
);
const uploadProgress = read("src/lib/attachments/upload-progress.ts");

const requestProps = modal.split("interface SubmitterModalProps")[1]?.split(
	"onSubmitSolution?:",
)[0] ?? "";
const requestBranch =
	modal
		.split('if (mode === "request" && onSubmitRequest)')[1]
		?.split("if (isSolutionMode)")[0] ?? "";
const requestList =
	modal.split("{!isSolutionMode && stagedRequestItems.length > 0 && (")[1]?.split(
		"</section>",
	)[0] ?? "";
const closeHandler =
	modal.split("const handleCloseWithCleanup = async")[1]?.split(
		"const requestCloseControlsLocked",
	)[0] ?? "";
const requestCloseFn =
	modal.split("const requestClose = () => {")[1]?.split(
		"const handleCloseWithCleanup = async",
	)[0] ?? "";
const fileChange =
	modal.split("const handleFileChange =")[1]?.split(
		"const handleRemoveAttachment",
	)[0] ?? "";
const resetDraft =
	modal.split("const resetRequestDraft = useCallback(")[1]?.split(
		"}, []);",
	)[0] ?? "";

test("request mode uses the staged attachments hook, not post-create uploads", () => {
	assert.match(modal, /useStagedRequestAttachments/);
	assert.match(
		modal,
		/const \{\s*items: stagedRequestItems,\s*addFiles: addStagedRequestFiles,\s*retryItem: retryStagedRequestItem,\s*removeItem: removeStagedRequestItem,\s*reset: resetStagedRequestAttachments,\s*clear: clearStagedRequestAttachments,\s*hasBlockingOperations: stagedRequestBlocking,\s*readyAttachmentIds,/,
	);
	assert.match(modal, /addStagedRequestFiles\(selectedFiles\)/);
	assert.doesNotMatch(modal, /uploadFileAction/);
	assert.doesNotMatch(modal, /rollbackCreatedRequest/);
	assert.doesNotMatch(modal, /RequestUploadProgress/);
	assert.doesNotMatch(modal, /requestPhaseLabel/);
	assert.doesNotMatch(modal, /setRequestProgress/);
});

test("onSubmitRequest carries stagedAttachmentIds and no files or progress callback", () => {
	assert.match(
		requestProps,
		/onSubmitRequest\?: \(\s*data: \{\s*title: string;\s*description: string;\s*templateId\?: string;\s*stagedAttachmentIds: string\[\];\s*inlineImageSessionId: string;\s*\},\s*\) => Promise<\{ success: boolean; error\?: string \}>/,
	);
	assert.doesNotMatch(requestProps, /files: File\[\]/);
	assert.doesNotMatch(requestProps, /onUploadProgress/);
});

test("submit blocks while reservation, upload, cleanup, or errors are active", () => {
	assert.match(
		modal,
		/const requestAttachmentsBlocking =\s*stagedRequestBlocking \|\|\s*stagedRequestItems\.length !== readyAttachmentIds\.length/,
	);
	const submitDisabled =
		modal.split("const isSubmitDisabled = () =>")[1]?.split(
			"return (",
		)[1] ?? "";
	assert.match(submitDisabled, /requestAttachmentsBlocking/);
	assert.match(requestBranch, /if \(requestAttachmentsBlocking\) \{\s*return;/);
});

test("create payload is readyAttachmentIds exactly once; failure keeps drafts", () => {
	assert.equal(
		(requestBranch.match(/await onSubmitRequest\(/g) ?? []).length,
		1,
	);
	assert.match(
		requestBranch,
		/stagedAttachmentIds: readyAttachmentIds,/,
	);
	assert.match(
		requestBranch,
		/if \(!result\.success\) \{\s*requestCommitInFlightRef\.current = false;\s*setSubmitError\(result\.error \|\| "Failed to submit"\);\s*return;/,
	);
	assert.doesNotMatch(
		requestBranch.split("if (!result.success)")[1]?.split("clearStagedRequestAttachments")[0] ?? "",
		/clearStagedRequestAttachments/,
	);
	assert.doesNotMatch(requestBranch, /onOpenChange\(false\)[\s\S]*clearStagedRequestAttachments/);
});

test("success calls hook clear() before close/unmount", () => {
	const clearIdx = requestBranch.indexOf("clearStagedRequestAttachments()");
	const inlineClearIdx = requestBranch.indexOf("inlineImages.clear()");
	const closeIdx = requestBranch.indexOf("onOpenChange(false)");
	assert.ok(clearIdx !== -1, "request success clears staged drafts");
	assert.ok(inlineClearIdx !== -1, "request success clears inline images");
	assert.ok(closeIdx !== -1, "request success closes the modal");
	assert.ok(
		clearIdx < closeIdx,
		"clear() must run before close so unmount DELETE cannot race adoption",
	);
	assert.ok(clearIdx < inlineClearIdx || inlineClearIdx === -1 || clearIdx < closeIdx);
});

test("request list renders counts, real percent, pending/uploading/success/error, retry/remove, cleanup errors", () => {
	assert.ok(requestList.length > 0, "request attachment list found");
	assert.match(
		requestList,
		/\{readyAttachmentIds\.length\}\/\{stagedRequestItems\.length\} files ready/,
	);
	assert.match(requestList, />Pending</);
	assert.match(requestList, /item\.status === "uploading"/);
	assert.match(requestList, /value=\{item\.progress\}/);
	assert.match(requestList, /\{item\.progress\}%/);
	assert.match(requestList, />Uploaded</);
	assert.match(requestList, /item\.cleanupRequested/);
	assert.match(requestList, />Removing\.\.\.</);
	assert.match(requestList, /\{item\.error\}/);
	assert.match(requestList, /Retry/);
	assert.match(requestList, /retryStagedRequestItem\(item\.id\)/);
	assert.match(requestList, /removeStagedRequestItem\(item\.id\)/);
	assert.match(requestList, /canRetryStagedUpload\(item\)/);
	assert.doesNotMatch(requestList, /value=\{100\}/);
	assert.doesNotMatch(requestList, /progress:\s*100/);
	assert.doesNotMatch(requestList, /Add a description for this file/);
	assert.doesNotMatch(requestList, /requestPhaseLabel/);
	assert.doesNotMatch(requestList, /failedIndices/);
});

test("cancel/close awaits owner-scoped staged DELETE reset; in-flight commit does not DELETE", () => {
	assert.match(closeHandler, /requestCommitInFlightRef\.current/);
	assert.match(closeHandler, /await resetStagedRequestAttachments\(\)/);
	assert.match(closeHandler, /await reset\(\)/);
	assert.match(closeHandler, /Failed to clean up draft files/);
	assert.match(resetDraft, /requestCommitInFlightRef\.current = false/);
	assert.match(resetDraft, /closeInFlightRef\.current = false/);
});

test("request close is re-entry guarded so concurrent paths start one reset/DELETE", () => {
	assert.match(modal, /const closeInFlightRef = useRef\(false\)/);
	assert.match(
		requestCloseFn,
		/if \(\s*mode === "request" &&\s*\(closeInFlightRef\.current \|\| requestCommitInFlightRef\.current\)\s*\) \{\s*return;/
	);
	assert.match(
		requestCloseFn,
		/void handleCloseWithCleanup\(\);/
	);
	assert.match(
		closeHandler,
		/if \(mode === "request"\) \{\s*if \(closeInFlightRef\.current\) \{\s*return;\s*\}\s*closeInFlightRef\.current = true;/
	);
	const setIdx = closeHandler.indexOf("closeInFlightRef.current = true");
	const awaitIdx = closeHandler.indexOf("await resetStagedRequestAttachments()");
	assert.ok(setIdx !== -1, "closeInFlight is set");
	assert.ok(awaitIdx !== -1, "reset is awaited");
	assert.ok(
		setIdx < awaitIdx,
		"closeInFlight must be set synchronously before await reset",
	);
	assert.equal(
		(closeHandler.match(/await resetStagedRequestAttachments\(\)/g) ?? []).length,
		1,
		"exactly one staged DELETE reset per close",
	);
	assert.match(
		closeHandler,
		/finally \{[\s\S]*if \(mode === "request"\) \{\s*closeInFlightRef\.current = false;/
	);
	assert.match(closeHandler, /Failed to clean up draft files/);
	const closeCallIdx = closeHandler.indexOf("onOpenChange(false)");
	const catchIdx = closeHandler.indexOf("} catch (error)");
	assert.ok(closeCallIdx !== -1 && catchIdx !== -1);
	assert.ok(
		closeCallIdx < catchIdx,
		"cleanup failure must not close the modal",
	);
});

test("all request close pathways funnel through the guarded close", () => {
	assert.match(
		modal,
		/onOpenChange=\{\(nextOpen\) => \{\s*if \(!nextOpen\) requestClose\(\);/
	);
	assert.match(
		modal,
		/type="button"[\s\S]*?onClick=\{requestClose\}[\s\S]*?disabled=\{requestCloseControlsLocked\}/
	);
	assert.match(
		modal,
		/variant="outline"[\s\S]*?onClick=\{requestClose\}[\s\S]*?disabled=\{isBusy \|\| requestCloseControlsLocked\}/
	);
	assert.match(
		modal,
		/const requestCloseControlsLocked =\s*mode === "request" &&\s*\(isBusy \|\|\s*requestCommitInFlightRef\.current \|\|\s*closeInFlightRef\.current\)/,
	);
	assert.doesNotMatch(
		modal,
		/onClick=\{\(\) => onOpenChange\(false\)\}/,
	);
});

test("request file picker ignores add during submit/commit or close cleanup", () => {
	assert.ok(fileChange.length > 0, "handleFileChange found");
	const guardIdx = fileChange.search(
		/mode === "request" &&\s*\(isBusy \|\|\s*requestCommitInFlightRef\.current \|\|\s*closeInFlightRef\.current\)/,
	);
	const addIdx = fileChange.indexOf("addStagedRequestFiles(selectedFiles)");
	assert.ok(guardIdx !== -1, "synchronous request add guard present");
	assert.ok(addIdx !== -1, "request addFiles still used when unlocked");
	assert.ok(
		guardIdx < addIdx,
		"stale file-input events must return before addFiles",
	);
	assert.match(fileChange, /e\.target\.value = "";\s*return;/);
	assert.match(
		modal,
		/onChange=\{handleFileChange\}[\s\S]*?disabled=\{requestCloseControlsLocked\}/,
	);
	assert.match(fileChange, /if \(isSolutionMode\) \{\s*addFiles\(selectedFiles\);/);
});

test("callers createRequest with stagedAttachmentIds only — no upload loop, rollback, or progress callback", () => {
	for (const [name, src] of [
		["requests-list-client", listCaller],
		["follow-up-dashboard", followUpCaller],
	] as const) {
		assert.match(src, /stagedAttachmentIds:/, `${name}: passes staged IDs`);
		assert.match(
			src,
			/createRequest\(\{[\s\S]*?stagedAttachmentIds: (?:data|form)\.stagedAttachmentIds,[\s\S]*?\}\)/,
			`${name}: createRequest includes stagedAttachmentIds`,
		);
		assert.equal(
			(src.match(/createRequest\(/g) ?? []).length,
			1,
			`${name}: createRequest exactly once`,
		);
		assert.doesNotMatch(src, /uploadFileAction/, `${name}: no post-create upload`);
		assert.doesNotMatch(src, /onUploadProgress/, `${name}: no progress callback`);
		assert.doesNotMatch(src, /RequestUploadProgress/, `${name}: no request progress type`);
		assert.doesNotMatch(src, /failedIndices/, `${name}: no failed-index collector`);
		assert.doesNotMatch(src, /rollbackCreatedRequest/, `${name}: no rollback`);
		assert.doesNotMatch(
			src,
			/formData\.append\('file'/,
			`${name}: no file FormData upload loop`,
		);
	}
});

test("request-dead upload-progress helpers are gone; solution describeUploadProgress remains", () => {
	assert.doesNotMatch(uploadProgress, /RequestUploadProgress/);
	assert.doesNotMatch(uploadProgress, /requestPhaseLabel/);
	assert.doesNotMatch(uploadProgress, /Creating request\.\.\./);
	assert.match(uploadProgress, /export function describeUploadProgress/);
});
