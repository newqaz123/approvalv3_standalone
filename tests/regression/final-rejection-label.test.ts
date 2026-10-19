import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// A FINAL rejection returns the request to Engineering, but the correction
// modal must say the Final approval rejected it, not "Solution Rejected".
describe("final rejection label in the solution modal", () => {
	const modal = () =>
		readFileSync("src/components/requests/solution-modal.tsx", "utf8");
	const router = () =>
		readFileSync("src/components/requests/request-modal-router.tsx", "utf8");

	it("defines a final_rejected status with its own label", () => {
		const source = modal();
		assert.match(source, /status: "solution" \| "solution_rejected" \| "final_rejected"/);
		assert.match(source, /final_rejected: \{\s*label: "Final Approval Rejected"/);
	});

	it("titles the rejection banner from the status, not a fixed string", () => {
		const source = modal();
		assert.match(source, /data\.status === "final_rejected"\s*\?\s*"Final Approval Rejected — solution needs revision"\s*:\s*"Solution Rejected"/);
	});

	it("router picks final_rejected only when the current rejection is FINAL", () => {
		const source = router();
		assert.match(
			source,
			/hasSolutionRejection\s*\?\s*"solution_rejected"\s*:\s*"final_rejected"/,
		);
	});
});
