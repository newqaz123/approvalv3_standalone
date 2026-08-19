export type FollowUpRow = {
	id: string;
	title: string;
	status: string;
	createdAt: Date | string;
	updatedAt: Date | string;
	requesterId: string;
	requesterName: string;
	waitingDays: number;
	nextLabel: string;
	isMine: boolean;
	hasRejection?: boolean;
	workRequisitionReceived?: boolean;
	estimateLabel?: string | null;
	leadTimeDays?: number;
};

export type FollowUpActivity = {
	id: string;
	createdAt: Date | string;
	action: string;
	title: string;
	actorName: string;
};

export type FollowUpVisibleRequest = {
	id: string;
	title: string;
	status: string;
	createdAt: Date | string;
	updatedAt: Date | string;
	requesterId: string;
	requesterName?: string;
	requester?: { name: string } | null;
	hasRejection?: boolean;
	workRequisitionReceived?: boolean;
	estimateLabel?: string | null;
	approvals?: Array<{
		status: string;
		requiredLevel: number;
		requiredApprover?: { name: string } | null;
		potentialApprovers?: Array<{ name: string }>;
	}>;
	engineerAssignments?: Array<{ engineer: { name: string } }>;
};

export type FollowUpStatusActivity = {
	requestId: string;
	fromStatus?: string | null;
	toStatus?: string | null;
	createdAt: Date | string;
};

export type FollowUpDeltaKey =
	| "active"
	| "withEngineering"
	| "needsAttention"
	| "completed30d"
	| "awaitingApproval"
	| "solutionReady"
	| "completedNoWr";

export type FollowUpDashboardData = {
	departmentName: string;
	currentUserId: string;
	kpis: {
		active: number;
		withEngineering: number;
		needsAttention: number;
		completed30d: number;
	};
	deltas: Record<FollowUpDeltaKey, number>;
	deltaLabels: Record<FollowUpDeltaKey, string>;
	flow: {
		requestApproval: number;
		engineering: number;
		solutionReady: number;
		completedWr: number;
		completedNoWr: number;
	};
	engineerSolutionReady: FollowUpRow[];
	awaitingRequestApproval: FollowUpRow[];
	awaitingOthers: FollowUpRow[];
	needsAttention: FollowUpRow[];
	completedRecently: FollowUpRow[];
	completedNoWr: FollowUpRow[];
	recentActivity: FollowUpActivity[];
};

const STALE_MS = 30 * 24 * 60 * 60 * 1000;
const RECENT_MS = 30 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const APPROVAL_STATUSES = new Set(["ImprovementRequest", "FinalApproval"]);
const ENGINEERING_STATUSES = new Set([
	"SentToEngineer",
	"DesignCostEstimationApproval",
]);
const ACTIVE_STATUSES = new Set([
	"ImprovementRequest",
	"SentToEngineer",
	"SendBackToRequester",
	"DesignCostEstimationApproval",
	"FinalApproval",
]);

function ms(value: Date | string) {
	return new Date(value).getTime();
}

const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
] as const;

function waitingDays(value: Date | string, now: number) {
	return Math.max(0, Math.floor((now - ms(value)) / DAY_MS));
}

export function formatCompletedNoWrLabel(value: Date | string) {
	const date = new Date(value);
	return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} · no WR`;
}

export function formatActivityTime(value: Date | string) {
	const date = new Date(value);
	return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

const STATUS_LINE_LABELS: Record<string, string> = {
	ImprovementRequest: "Improvement request",
	SentToEngineer: "Sent to Engineer",
	DesignCostEstimationApproval: "Design & cost",
	SendBackToRequester: "Solution ready",
	FinalApproval: "Final approval",
	Completed: "Completed",
	Cancelled: "Cancelled",
};

export function formatAwaitingStatusLine({
	status,
	nextLabel,
}: {
	status: string;
	nextLabel: string;
}) {
	const label = STATUS_LINE_LABELS[status] ?? status;
	const next = nextLabel.trim();
	if (!next || next === status || next.toLowerCase() === label.toLowerCase()) {
		return "";
	}
	if (next.toLowerCase().startsWith(`${label.toLowerCase()} · `)) {
		return next.slice(label.length + 3).trim();
	}
	if (next.toLowerCase().startsWith(label.toLowerCase())) {
		return next
			.slice(label.length)
			.replace(/^\s*·\s*/, "")
			.trim();
	}
	return next;
}

function requesterNameOf(request: FollowUpVisibleRequest) {
	return request.requesterName || request.requester?.name || "Unknown";
}

function nextLabel(request: FollowUpVisibleRequest) {
	if (request.status === "SentToEngineer") {
		const pic = request.engineerAssignments?.[0]?.engineer.name;
		return pic ? `PIC: ${pic.split(" ")[0]}` : "Engineering review";
	}
	const pending = request.approvals?.find(
		(approval) => approval.status === "pending",
	);
	if (!pending) {
		if (request.status === "Completed") {
			return request.workRequisitionReceived
				? "Completed · WR received"
				: "Completed · no WR";
		}
		return request.status;
	}
	const who =
		pending.requiredApprover?.name ||
		pending.potentialApprovers?.map((person) => person.name).join(" or ") ||
		`Level ${pending.requiredLevel}`;
	if (request.status === "DesignCostEstimationApproval")
		return `Design & cost · ${who}`;
	if (request.status === "FinalApproval") return `Final approval · ${who}`;
	return `Level ${pending.requiredLevel} · ${who}`;
}

function toRow(
	request: FollowUpVisibleRequest,
	currentUserId: string,
	now: number,
	extras: Partial<FollowUpRow> = {},
): FollowUpRow {
	const updatedAt = request.updatedAt ?? request.createdAt;
	return {
		id: request.id,
		title: request.title,
		status: request.status,
		createdAt: request.createdAt,
		updatedAt,
		requesterId: request.requesterId,
		requesterName: requesterNameOf(request),
		waitingDays: waitingDays(updatedAt, now),
		nextLabel: nextLabel(request),
		isMine: request.requesterId === currentUserId,
		hasRejection: Boolean(
			request.hasRejection ||
				request.approvals?.some((approval) => approval.status === "rejected"),
		),
		workRequisitionReceived: request.workRequisitionReceived,
		estimateLabel: request.estimateLabel ?? null,
		...extras,
	};
}

function statusAt(
	request: FollowUpVisibleRequest,
	activities: FollowUpStatusActivity[],
	at: number,
) {
	if (ms(request.createdAt) > at) return null;
	const later = activities
		.filter(
			(activity) =>
				activity.requestId === request.id && ms(activity.createdAt) > at,
		)
		.sort((left, right) => ms(left.createdAt) - ms(right.createdAt));
	return later[0]?.fromStatus ?? request.status;
}

function classify(
	requests: FollowUpVisibleRequest[],
	now: number,
	currentUserId: string,
) {
	const rows = requests.map((request) => {
		const extras: Partial<FollowUpRow> = {};
		if (request.status === "Completed") {
			extras.leadTimeDays = Math.max(
				0,
				Math.floor((ms(request.updatedAt) - ms(request.createdAt)) / DAY_MS),
			);
		}
		return toRow(request, currentUserId, now, extras);
	});
	const byStatus = (predicate: (row: FollowUpRow) => boolean) =>
		rows.filter(predicate);

	const awaitingRequestApproval = byStatus((row) =>
		APPROVAL_STATUSES.has(row.status),
	);
	const awaitingOthers = byStatus((row) =>
		ENGINEERING_STATUSES.has(row.status),
	);
	const engineerSolutionReady = byStatus(
		(row) => row.status === "SendBackToRequester",
	);
	const needsAttention = byStatus(
		(row) =>
			ACTIVE_STATUSES.has(row.status) && now - ms(row.updatedAt) >= STALE_MS,
	);
	const completedRecently = byStatus(
		(row) => row.status === "Completed" && now - ms(row.updatedAt) <= RECENT_MS,
	);
	const completedNoWr = byStatus(
		(row) => row.status === "Completed" && !row.workRequisitionReceived,
	);
	const completedWr = byStatus(
		(row) => row.status === "Completed" && Boolean(row.workRequisitionReceived),
	);
	const active = byStatus((row) => ACTIVE_STATUSES.has(row.status));

	return {
		active,
		awaitingRequestApproval,
		awaitingOthers,
		engineerSolutionReady,
		needsAttention,
		completedRecently,
		completedNoWr,
		completedWr,
		requestApproval: byStatus((row) => row.status === "ImprovementRequest"),
	};
}

export function formatDeltaFromYesterday(delta: number) {
	if (delta === 0) return "No change from yesterday";
	if (delta > 0) return `+${delta} from yesterday`;
	return `${delta} from yesterday`;
}

export function buildFollowUpDashboard({
	visible,
	activities = [],
	recentActivity = [],
	currentUserId,
	departmentName,
	now = new Date(),
}: {
	visible: FollowUpVisibleRequest[];
	activities?: FollowUpStatusActivity[];
	recentActivity?: FollowUpActivity[];
	currentUserId: string;
	departmentName: string;
	now?: Date | number;
}): FollowUpDashboardData {
	const nowMs = typeof now === "number" ? now : now.getTime();
	const yesterdayMs = nowMs - DAY_MS;
	const today = classify(visible, nowMs, currentUserId);
	const yesterdayVisible = visible.flatMap((request) => {
		const status = statusAt(request, activities, yesterdayMs);
		return status ? [{ ...request, status }] : [];
	});
	const yesterday = classify(yesterdayVisible, yesterdayMs, currentUserId);

	const deltas: Record<FollowUpDeltaKey, number> = {
		active: today.active.length - yesterday.active.length,
		withEngineering:
			today.awaitingOthers.length - yesterday.awaitingOthers.length,
		needsAttention:
			today.needsAttention.length - yesterday.needsAttention.length,
		completed30d:
			today.completedRecently.length - yesterday.completedRecently.length,
		awaitingApproval:
			today.awaitingRequestApproval.length -
			yesterday.awaitingRequestApproval.length,
		solutionReady:
			today.engineerSolutionReady.length -
			yesterday.engineerSolutionReady.length,
		completedNoWr: today.completedNoWr.length - yesterday.completedNoWr.length,
	};

	return {
		departmentName,
		currentUserId,
		kpis: {
			active: today.active.length,
			withEngineering: today.awaitingOthers.length,
			needsAttention: today.needsAttention.length,
			completed30d: today.completedRecently.length,
		},
		deltas,
		deltaLabels: {
			active: formatDeltaFromYesterday(deltas.active),
			withEngineering: formatDeltaFromYesterday(deltas.withEngineering),
			needsAttention: formatDeltaFromYesterday(deltas.needsAttention),
			completed30d: formatDeltaFromYesterday(deltas.completed30d),
			awaitingApproval: formatDeltaFromYesterday(deltas.awaitingApproval),
			solutionReady: formatDeltaFromYesterday(deltas.solutionReady),
			completedNoWr: formatDeltaFromYesterday(deltas.completedNoWr),
		},
		flow: {
			requestApproval: today.requestApproval.length,
			engineering: today.awaitingOthers.length,
			solutionReady: today.engineerSolutionReady.length,
			completedWr: today.completedWr.length,
			completedNoWr: today.completedNoWr.length,
		},
		engineerSolutionReady: today.engineerSolutionReady,
		awaitingRequestApproval: today.awaitingRequestApproval,
		awaitingOthers: today.awaitingOthers,
		needsAttention: today.needsAttention,
		completedRecently: today.completedRecently,
		completedNoWr: today.completedNoWr,
		recentActivity,
	};
}
