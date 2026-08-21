import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function read(path: string): string {
	return readFileSync(path, "utf8");
}

function selfClosingTags(source: string, component: string): string[] {
	return [
		...source.matchAll(
			new RegExp(`<${component}\\b[\\s\\S]*?\\n\\s*/>`, "g"),
		),
	].map((match) => match[0]);
}

describe("approval action pending state", () => {
	it("wires the router pending state into every active approval action modal", () => {
		const router = read("src/components/requests/request-modal-router.tsx");
		const expectedInstances = new Map([
			["ApproverModal", 1],
			["SolutionModal", 1],
			["SubmitFinalApprovalModal", 2],
			["FinalApprovalResubmitModal", 1],
		]);

		for (const [component, count] of expectedInstances) {
			const tags = selfClosingTags(router, component);
			assert.equal(
				tags.length,
				count,
				`expected ${count} ${component} instance(s) in the request modal router`,
			);
			for (const tag of tags) {
				assert.match(
					tag,
					/\bisSubmitting=\{isSubmitting\}/,
					`${component} must receive the authoritative router pending state`,
				);
			}
		}
	});

	it("keeps request, solution, and final decision controls locked until their callbacks settle", () => {
		const approverModal = read("src/components/requests/approver-modal.tsx");
		const solutionModal = read("src/components/requests/solution-modal.tsx");

		for (const [name, source] of [
			["ApproverModal", approverModal],
			["SolutionModal", solutionModal],
		] as const) {
			assert.match(source, /isSubmitting\?: boolean;/, `${name} needs a pending prop`);
			assert.match(
				source,
				/await onApprove\?\./,
				`${name} must await approval completion`,
			);
			assert.match(
				source,
				/await onReject\?\./,
				`${name} must await rejection completion`,
			);
			assert.match(
				source,
				/disabled=\{isSubmitting\}/,
				`${name} must disable action controls while pending`,
			);
			assert.match(
				source,
				/isSubmitting\s*\?\s*"Approving\.\.\."\s*:\s*"(?:Confirm Approval|Approve Solution)"/,
				`${name} must expose approval progress`,
			);
			assert.match(
				source,
				/isSubmitting\s*\?\s*"Rejecting\.\.\."\s*:\s*"Confirm Rejection"/,
				`${name} must expose rejection progress`,
			);
		}
	});

	it("keeps final approval start and restart controls locked until their callbacks settle", () => {
		const startModal = read(
			"src/components/requests/submit-final-approval-modal.tsx",
		);
		const restartModal = read(
			"src/components/requests/final-approval-resubmit-modal.tsx",
		);

		assert.match(startModal, /isSubmitting\?: boolean;/);
		assert.match(startModal, /await onSubmit\(/);
		assert.match(startModal, /disabled=\{isSubmitting\}/);
		assert.match(
			startModal,
			/isSubmitting\s*\?\s*"Starting\.\.\."\s*:\s*"Start Final Approval"/,
		);

		assert.match(restartModal, /isSubmitting\?: boolean;/);
		assert.match(restartModal, /await onRestart\(/);
		assert.match(restartModal, /disabled=\{isSubmitting\}/);
		assert.match(
			restartModal,
			/isSubmitting\s*\?\s*"Restarting\.\.\."\s*:\s*"Restart Final Approval"/,
		);
	});

	it("announces pending actions and locks an already-open approver search", () => {
		const actionSources = [
			read("src/components/requests/approver-modal.tsx"),
			read("src/components/requests/solution-modal.tsx"),
			read("src/components/requests/submit-final-approval-modal.tsx"),
			read("src/components/requests/final-approval-resubmit-modal.tsx"),
		];
		for (const source of actionSources) {
			assert.match(source, /aria-busy=\{isSubmitting\}/);
		}

		const searchField = read(
			"src/components/approvals/approver-search-field.tsx",
		);
		assert.match(searchField, /disabled\?: boolean/);
		assert.match(searchField, /disabled=\{disabled\}/);

		for (const source of actionSources.slice(2)) {
			assert.match(
				source,
				/<ApproverSearchField[\s\S]*?disabled=\{disabled\}[\s\S]*?\/>/,
			);
		}
	});
});
