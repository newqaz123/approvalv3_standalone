import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRequestExportRows } from "../../src/lib/request-export";
import type { RequestListRow } from "../../src/components/requests/request-table";

function makeRow(overrides: Partial<RequestListRow> = {}): RequestListRow {
	return {
		id: "REQ-001",
		title: "Replace chilled water pump",
		status: "Completed",
		createdAt: new Date("2026-08-01T09:30:00Z"),
		workRequisitionReceived: true,
		requesterId: "u1",
		department: { name: "Production 1" },
		requester: { id: "u1", name: "Alice Wong" },
		_count: { fileAttachments: 2 },
		hasRejection: false,
		engineerAssignments: [
			{ engineer: { id: "e1", name: "Bob Tan" } },
			{ engineer: { id: "e2", name: "Cara Lim" } },
		],
		approvals: [],
		...overrides,
	};
}

describe("buildRequestExportRows", () => {
	it("maps core worklist fields to spreadsheet columns", () => {
		const [row] = buildRequestExportRows([makeRow()]);

		assert.equal(row["Title"], "Replace chilled water pump");
		assert.equal(row["Status"], "Completed");
		assert.equal(row["Department"], "Production 1");
		assert.equal(row["Requester"], "Alice Wong");
		assert.equal(row["Created"], "2026-08-01");
		assert.equal(row["Files"], 2);
		assert.equal(row["WR Received"], "Yes");
	});

	it("joins multiple PIC engineers by comma", () => {
		const [row] = buildRequestExportRows([makeRow()]);
		assert.equal(row["PIC"], "Bob Tan, Cara Lim");
	});

	it("falls back to placeholders for missing PIC and department", () => {
		const [row] = buildRequestExportRows([
			makeRow({ engineerAssignments: [], department: null }),
		]);
		assert.equal(row["PIC"], "");
		assert.equal(row["Department"], "");
	});

	it("shows the current approver as the first pending step in order", () => {
		const [row] = buildRequestExportRows([
			makeRow({
				approvals: [
					{
						id: "a2",
						status: "pending",
						approver: { name: "Jane Roe" },
						requiredLevel: 4,
						order: 2,
						approvedAt: null,
					},
					{
						id: "a1",
						status: "approved",
						approver: { name: "John Smith" },
						requiredLevel: 3,
						order: 1,
						approvedAt: new Date("2026-08-02T03:00:00Z"),
					},
				],
			}),
		]);

		// The first pending step by order, not input order
		assert.equal(row["Current Approver"], "LV4 Jane Roe");
		assert.equal(row["Approval Progress"], "1/2 approved");
		assert.equal(row["Rejected"], "No");
	});

	it("marks rejected requests and shows the rejector as current approver", () => {
		const [row] = buildRequestExportRows([
			makeRow({
				approvals: [
					{
						id: "a1",
						status: "rejected",
						approver: { name: "John Smith" },
						requiredLevel: 3,
						order: 1,
						approvedAt: new Date("2026-08-02T03:00:00Z"),
					},
				],
			}),
		]);

		assert.equal(row["Rejected"], "Yes");
		assert.equal(row["Approval Progress"], "0/1 approved (rejected)");
		assert.equal(row["Current Approver"], "LV3 John Smith (rejected)");
	});

	it("uses requiredApprover name when approver has not acted yet", () => {
		const [row] = buildRequestExportRows([
			makeRow({
				approvals: [
					{
						id: "a1",
						status: "pending",
						approver: null,
						requiredApprover: { name: "Dana Quek" },
						requiredLevel: 5,
						order: 1,
						approvedAt: null,
					},
				],
			}),
		]);

		assert.equal(row["Current Approver"], "LV5 Dana Quek");
	});

	it("resolves level-based pending approvals to potential approver names", () => {
		const [row] = buildRequestExportRows([
			makeRow({
				approvals: [
					{
						id: "a1",
						status: "pending",
						approver: null,
						requiredApprover: null,
						potentialApprovers: [{ name: "Dana Quek" }, { name: "Eunice Lau" }],
						requiredLevel: 2,
						order: 1,
						approvedAt: null,
					},
				],
			}),
		]);

		assert.equal(row["Current Approver"], "LV2 Dana Quek or Eunice Lau");
	});

	it("falls back to the level label when no approver can be resolved", () => {
		const [row] = buildRequestExportRows([
			makeRow({
				approvals: [
					{
						id: "a1",
						status: "pending",
						approver: null,
						requiredApprover: null,
						potentialApprovers: [],
						requiredLevel: 2,
						order: 1,
						approvedAt: null,
					},
				],
			}),
		]);

		assert.equal(row["Current Approver"], "LV2");
	});

	it("shows a dash when every step is already approved", () => {
		const [row] = buildRequestExportRows([
			makeRow({
				approvals: [
					{
						id: "a1",
						status: "approved",
						approver: { name: "John Smith" },
						requiredLevel: 3,
						order: 1,
						approvedAt: new Date("2026-08-02T03:00:00Z"),
					},
				],
			}),
		]);

		assert.equal(row["Current Approver"], "—");
		assert.equal(row["Approval Progress"], "1/1 approved");
	});

	it("leaves approval columns blank when the request has no approvals", () => {
		const [row] = buildRequestExportRows([makeRow({ approvals: [] })]);
		assert.equal(row["Approval Progress"], "");
		assert.equal(row["Current Approver"], "—");
		assert.equal(row["Rejected"], "No");
	});

	it("exports multiple rows preserving input order", () => {
		const rows = buildRequestExportRows([
			makeRow({ id: "r1", title: "First" }),
			makeRow({ id: "r2", title: "Second" }),
		]);
		assert.deepEqual(
			rows.map((r) => r["Title"]),
			["First", "Second"],
		);
	});
});
