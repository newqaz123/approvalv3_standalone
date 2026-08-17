import type { RequestListRow } from "@/components/requests/request-table";

export type RequestExportRow = {
	Title: string;
	Status: string;
	Department: string;
	Requester: string;
	Created: string;
	PIC: string;
	Files: number;
	"WR Received": string;
	"Approval Progress": string;
	"Current Approver": string;
	Rejected: string;
};

/** Deterministic ISO date (YYYY-MM-DD), stable across server timezones. */
function isoDate(date: Date): string {
	return date.toISOString().slice(0, 10);
}

type ApprovalItem = NonNullable<RequestListRow["approvals"]>[number];

/**
 * Resolve the display name for one approval step, mirroring the UI
 * (ApprovalStatusBadge): acted steps use the acting approver; pending
 * steps use the assigned approver, else the potential approvers at that
 * level. A stale approver (e.g. after resubmission) is kept as a last
 * resort so real names still appear instead of "Unassigned".
 */
function approvalDisplayName(approval: ApprovalItem): string {
	if (approval.status !== "pending") {
		return approval.approver?.name ?? "";
	}
	if (approval.requiredApprover?.name) {
		return approval.requiredApprover.name;
	}
	if (approval.potentialApprovers && approval.potentialApprovers.length > 0) {
		return approval.potentialApprovers.map((p) => p.name).join(" or ");
	}
	return approval.approver?.name ?? "";
}

/**
 * Summarize who the request is waiting on (approvals pre-sorted by order):
 * - rejected → the rejector, e.g. "LV3 John Smith (rejected)"
 * - pending → the first pending step, e.g. "LV4 Jane Roe"
 * - fully approved or empty chain → "—"
 */
function currentApproverSummary(approvals: ApprovalItem[]): string {
	if (approvals.length === 0) {
		return "—";
	}

	const rejected = approvals.find((a) => a.status === "rejected");
	if (rejected) {
		const name = approvalDisplayName(rejected);
		return `LV${rejected.requiredLevel}${name ? ` ${name}` : ""} (rejected)`;
	}

	const pending = approvals.find((a) => a.status === "pending");
	if (!pending) {
		return "—";
	}

	const name = approvalDisplayName(pending);
	return `LV${pending.requiredLevel}${name ? ` ${name}` : ""}`;
}

export function buildRequestExportRows(
	requests: RequestListRow[],
): RequestExportRow[] {
	return requests.map((request) => {
		const approvals = [...(request.approvals ?? [])].sort(
			(a, b) => a.order - b.order,
		);

		const approvedCount = approvals.filter(
			(a) => a.status === "approved",
		).length;
		const hasRejectedApproval = approvals.some((a) => a.status === "rejected");

		const progress =
			approvals.length === 0
				? ""
				: `${approvedCount}/${approvals.length} approved${hasRejectedApproval ? " (rejected)" : ""}`;

		return {
			Title: request.title,
			Status: request.status,
			Department: request.department?.name ?? "",
			Requester: request.requester?.name ?? "",
			Created: isoDate(new Date(request.createdAt)),
			PIC: (request.engineerAssignments ?? [])
				.map((a) => a.engineer.name)
				.join(", "),
			Files: request._count.fileAttachments,
			"WR Received": request.workRequisitionReceived ? "Yes" : "No",
			"Approval Progress": progress,
			"Current Approver": currentApproverSummary(approvals),
			Rejected: hasRejectedApproval || request.hasRejection ? "Yes" : "No",
		};
	});
}
