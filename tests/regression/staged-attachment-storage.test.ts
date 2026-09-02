import assert from "node:assert/strict";
import { test } from "node:test";
import {
	createStagedAttachmentPath,
	isStagedAttachmentPath,
} from "../../src/lib/attachments/storage";

const UUID = "48929d61-691d-4a70-b677-7d8c985fd308";

test("createStagedAttachmentPath: places file under stage/ with sanitized name", () => {
	const p = createStagedAttachmentPath(UUID, "my drawing (v2).pdf");
	assert.ok(p.startsWith(`stage/${UUID}`), `starts with stage/<id>: ${p}`);
	assert.ok(p.endsWith(".pdf"), "keeps extension");
	// sanitizeAttachmentFileName (shared with final paths) strips control
	// chars and slashes but intentionally keeps spaces/parens — match that.
	const namePart = p.slice(`stage/${UUID}-`.length);
	assert.ok(!namePart.includes("/"), "name cannot inject path separators");
});

test("createStagedAttachmentPath: rejects traversal names", () => {
	const p = createStagedAttachmentPath(UUID, "../../etc/passwd.pdf");
	assert.ok(!p.includes(".."), "no traversal segments");
});

test("isStagedAttachmentPath: true only for stage/<uuid> paths", () => {
	assert.equal(isStagedAttachmentPath(`stage/${UUID}-a.pdf`), true);
	assert.equal(isStagedAttachmentPath(` stage/${UUID}-a.pdf `), true, "trims");
	assert.equal(isStagedAttachmentPath(`uploads/stage/${UUID}-a.pdf`), true, "tolerates uploads/ prefix like the rest of storage.ts");
});

test("isStagedAttachmentPath: false for final attachment paths and attacks", () => {
	assert.equal(isStagedAttachmentPath(`${UUID}/abc-photo.pdf`), false, "regular attachment dir");
	assert.equal(isStagedAttachmentPath("stage/../../etc/passwd"), false, "traversal after stage/");
	assert.equal(isStagedAttachmentPath("../stage/x.pdf"), false, "leading traversal");
	assert.equal(isStagedAttachmentPath("/absolute/stage/x.pdf"), false, "absolute path");
	assert.equal(isStagedAttachmentPath("stagey/x.pdf"), false, "prefix lookalike");
	assert.equal(isStagedAttachmentPath(""), false, "empty");
});
