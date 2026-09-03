import assert from "node:assert/strict";
import { test } from "node:test";
import type { AttachmentUploadItem } from "../../src/lib/attachments/upload-batch";
import { describeUploadProgress } from "../../src/lib/attachments/upload-progress";

function item(
	id: string,
	name: string,
	status: AttachmentUploadItem["status"],
): AttachmentUploadItem {
	return {
		id,
		status,
		file: new File(["x"], name, { type: "application/octet-stream" }),
	};
}

test("describeUploadProgress: empty list is idle", () => {
	const s = describeUploadProgress([]);
	assert.equal(s.active, false);
	assert.equal(s.label, null);
	assert.equal(s.doneCount, 0);
	assert.equal(s.totalCount, 0);
	assert.equal(s.currentName, undefined);
});

test("describeUploadProgress: single uploading item", () => {
	const s = describeUploadProgress([item("1", "invoice.pdf", "uploading")]);
	assert.equal(s.active, true);
	assert.equal(s.label, "Uploading 1/1 — invoice.pdf");
	assert.equal(s.currentName, "invoice.pdf");
});

test("describeUploadProgress: mixed statuses count done as success+error", () => {
	const s = describeUploadProgress([
		item("1", "a.pdf", "success"),
		item("2", "b.pdf", "error"),
		item("3", "c.pdf", "uploading"),
	]);
	assert.equal(s.active, true);
	assert.equal(s.doneCount, 2);
	assert.equal(s.totalCount, 3);
	assert.equal(s.label, "Uploading 3/3 — c.pdf");
	assert.equal(s.currentName, "c.pdf");
});

test("describeUploadProgress: all terminal is idle", () => {
	const s = describeUploadProgress([
		item("1", "a.pdf", "success"),
		item("2", "b.pdf", "success"),
	]);
	assert.equal(s.active, false);
	assert.equal(s.label, null);
});
