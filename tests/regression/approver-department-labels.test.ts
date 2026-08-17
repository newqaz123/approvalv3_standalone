import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

const pickerPaths = [
	"src/components/solutions/custom-approval-picker.tsx",
	"src/components/requests/submitter-modal.tsx",
	"src/components/requests/submit-final-approval-modal.tsx",
	"src/components/requests/final-approval-resubmit-modal.tsx",
	"src/components/requests/solution-modal.tsx",
];

describe("approval hierarchy picker department labels", () => {
	it("renders department name with email in every picker", () => {
		for (const path of pickerPaths) {
			const source = read(path);
			assert.match(
				source,
				/departmentName[?:]*\s*:\s*string/,
				`${path} accepts departmentName`,
			);
			assert.match(
				source,
				/\{user\.departmentName \?\? ['"]No department['"]\}\s*•\s*\{user\.email\}/,
				`${path} renders department name with email`,
			);
		}
	});

	it("does not render internal role values in modal picker metadata", () => {
		for (const path of pickerPaths.slice(1)) {
			const source = read(path);
			assert.doesNotMatch(source, /\{user\.role\}\s*•\s*\{user\.email\}/, path);
		}
	});
});

describe("approver data sources", () => {
	it("returns department names from active-user APIs", () => {
		for (const path of [
			"src/app/api/users/route.ts",
			"src/app/api/departments/[departmentId]/users/route.ts",
		]) {
			const source = read(path);
			assert.match(
				source,
				/department:\s*{[\s\S]*?select:\s*{[\s\S]*?name:\s*true/,
				path,
			);
			assert.match(source, /departmentName:/, path);
		}
	});

	it("provides department names to the server-rendered solution picker", () => {
		const pageSource = read(
			"src/app/(dashboard)/engineering/solutions/[requestId]/page.tsx",
		);
		const formSource = read("src/components/solutions/solution-form.tsx");

		assert.match(
			pageSource,
			/department:\s*{[\s\S]*?select:\s*{[\s\S]*?name:\s*true/,
		);
		assert.match(pageSource, /departmentName:/);
		assert.match(formSource, /departmentName:\s*string/);
	});

	it("provides department names to standalone modal preview fixtures", () => {
		const source = read("src/app/sequential-stages-preview/page.tsx");
		const fixture =
			source.match(/const sampleAvailableUsers = \[([\s\S]*?)\n\]/)?.[1] ?? "";

		assert.equal((fixture.match(/departmentName:/g) || []).length, 5);
	});
});
