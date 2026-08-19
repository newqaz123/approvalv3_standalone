import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	buildFollowUpDashboard,
	formatAwaitingStatusLine,
	formatCompletedNoWrLabel,
	formatDeltaFromYesterday,
	type FollowUpVisibleRequest,
	type FollowUpStatusActivity,
} from "@/lib/follow-up-dashboard";

const NOW = new Date("2026-08-16T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function request(
	overrides: Partial<FollowUpVisibleRequest> &
		Pick<FollowUpVisibleRequest, "id" | "status">,
): FollowUpVisibleRequest {
	return {
		title: overrides.title ?? overrides.id,
		createdAt: overrides.createdAt ?? "2026-07-01T00:00:00.000Z",
		updatedAt:
			overrides.updatedAt ?? overrides.createdAt ?? "2026-07-01T00:00:00.000Z",
		requesterId: overrides.requesterId ?? "u1",
		requesterName: overrides.requesterName ?? "Ada",
		workRequisitionReceived: overrides.workRequisitionReceived ?? false,
		...overrides,
	};
}

function build(
	visible: FollowUpVisibleRequest[],
	activities: FollowUpStatusActivity[] = [],
) {
	return buildFollowUpDashboard({
		visible,
		activities,
		currentUserId: "u1",
		departmentName: "Production",
		now: NOW,
	});
}

describe("follow-up dashboard classification", () => {
	it("puts Design & cost with Engineering, not Awaiting approval", () => {
		const data = build([
			request({ id: "cost", status: "DesignCostEstimationApproval" }),
			request({ id: "sent", status: "SentToEngineer" }),
			request({ id: "req", status: "ImprovementRequest" }),
			request({ id: "final", status: "FinalApproval" }),
		]);

		assert.deepEqual(data.awaitingOthers.map((row) => row.id).sort(), [
			"cost",
			"sent",
		]);
		assert.deepEqual(data.awaitingRequestApproval.map((row) => row.id).sort(), [
			"final",
			"req",
		]);
		assert.equal(data.kpis.withEngineering, 2);
	});

	it("marks an awaiting-approval request rejected when an approval was rejected", () => {
		const data = build([
			request({
				id: "rejected",
				status: "ImprovementRequest",
				hasRejection: true,
			}),
			request({
				id: "pending",
				status: "FinalApproval",
				hasRejection: false,
			}),
		]);

		assert.equal(
			data.awaitingRequestApproval.find((row) => row.id === "rejected")
				?.hasRejection,
			true,
		);
		assert.equal(
			data.awaitingRequestApproval.find((row) => row.id === "pending")
				?.hasRejection,
			false,
		);
	});

	it("lists every completed request without WR, including those older than 30 days", () => {
		const data = build([
			request({
				id: "old-no-wr",
				status: "Completed",
				updatedAt: "2025-08-11T00:00:00.000Z",
				workRequisitionReceived: false,
			}),
			request({
				id: "recent-wr",
				status: "Completed",
				updatedAt: "2026-08-10T00:00:00.000Z",
				workRequisitionReceived: true,
			}),
		]);

		assert.deepEqual(
			data.completedNoWr.map((row) => row.id),
			["old-no-wr"],
		);
		assert.equal(data.kpis.completed30d, 1);
		assert.deepEqual(
			data.completedRecently.map((row) => row.id),
			["recent-wr"],
		);
	});
});

describe("follow-up dashboard awaiting line", () => {
	it("keeps only the next-step text beside the status pill", () => {
		assert.equal(
			formatAwaitingStatusLine({
				status: "ImprovementRequest",
				nextLabel: "Level 2 · pd1 supervisor",
			}),
			"Level 2 · pd1 supervisor",
		);
		assert.equal(
			formatAwaitingStatusLine({
				status: "FinalApproval",
				nextLabel: "Final approval · Factory Mgr",
			}),
			"Factory Mgr",
		);
	});
});

describe("follow-up dashboard date labels", () => {
	it("formats completed · no WR dates in a locale-stable order", () => {
		assert.equal(
			formatCompletedNoWrLabel("2026-06-14T00:00:00.000Z"),
			"14 Jun 2026 · no WR",
		);
	});
});

describe("follow-up dashboard yesterday deltas", () => {
	it("formats signed count changes against yesterday", () => {
		assert.equal(formatDeltaFromYesterday(2), "+2 from yesterday");
		assert.equal(formatDeltaFromYesterday(-1), "-1 from yesterday");
		assert.equal(formatDeltaFromYesterday(0), "No change from yesterday");
	});

	it("counts a request created today as +1 vs yesterday", () => {
		const data = build([
			request({
				id: "old",
				status: "ImprovementRequest",
				createdAt: "2026-08-01T00:00:00.000Z",
				updatedAt: "2026-08-01T00:00:00.000Z",
			}),
			request({
				id: "new",
				status: "ImprovementRequest",
				createdAt: "2026-08-16T08:00:00.000Z",
				updatedAt: "2026-08-16T08:00:00.000Z",
			}),
		]);

		assert.equal(data.kpis.active, 2);
		assert.equal(data.deltas.active, 1);
		assert.equal(data.deltas.awaitingApproval, 1);
		assert.equal(data.deltaLabels.active, "+1 from yesterday");
	});

	it("treats a same-day move into Design & cost as +1 With Engineering", () => {
		const data = build(
			[
				request({
					id: "moved",
					status: "DesignCostEstimationApproval",
					createdAt: "2026-07-01T00:00:00.000Z",
					updatedAt: "2026-08-16T09:00:00.000Z",
				}),
			],
			[
				{
					requestId: "moved",
					fromStatus: "SentToEngineer",
					toStatus: "DesignCostEstimationApproval",
					createdAt: "2026-08-16T09:00:00.000Z",
				},
			],
		);

		assert.equal(data.kpis.withEngineering, 1);
		assert.equal(data.deltas.withEngineering, 0);
		assert.equal(data.deltaLabels.withEngineering, "No change from yesterday");
	});

	it("counts a same-day solution handoff as +1 Engineer solution ready", () => {
		const data = build(
			[
				request({
					id: "ready",
					status: "SendBackToRequester",
					createdAt: "2026-07-01T00:00:00.000Z",
					updatedAt: "2026-08-16T10:00:00.000Z",
					estimateLabel: "Estimate ฿185,000",
				}),
			],
			[
				{
					requestId: "ready",
					fromStatus: "SentToEngineer",
					toStatus: "SendBackToRequester",
					createdAt: "2026-08-16T10:00:00.000Z",
				},
			],
		);

		assert.equal(data.engineerSolutionReady.length, 1);
		assert.equal(data.deltas.solutionReady, 1);
		assert.equal(data.deltaLabels.solutionReady, "+1 from yesterday");
	});

	it("marks a request stale today but not yesterday when the 30-day clock just crossed", () => {
		const data = build([
			request({
				id: "aging",
				status: "SentToEngineer",
				createdAt: "2026-07-01T00:00:00.000Z",
				updatedAt: new Date(NOW.getTime() - 30 * DAY).toISOString(),
			}),
		]);

		assert.equal(data.kpis.needsAttention, 1);
		assert.equal(data.deltas.needsAttention, 1);
		assert.equal(data.deltaLabels.needsAttention, "+1 from yesterday");
	});
});
