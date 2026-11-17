"use server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/cache/user-cache";
import { getMyRequests } from "@/server-actions/requests";
import { buildFollowUpDashboard } from "@/lib/follow-up-dashboard";
export type {
	FollowUpActivity,
	FollowUpDashboardData,
	FollowUpRow,
} from "@/lib/follow-up-dashboard";

export async function getFollowUpDashboard() {
	const user = await getCurrentUser();
	if (!user) {
		throw new Error("User not found");
	}

	const visible = await getMyRequests({ wrStatus: "all" });
	const sendBackIds = visible
		.filter((request) => request.status === "SendBackToRequester")
		.map((request) => request.id);

	const solutions = sendBackIds.length
		? await prisma.solutions.findMany({
				where: { requestId: { in: sendBackIds } },
				orderBy: { createdAt: "desc" },
				select: {
					requestId: true,
					costEstimate: true,
					currency: true,
				},
			})
		: [];
	const estimateByRequest = new Map<string, string>();
	for (const solution of solutions) {
		if (estimateByRequest.has(solution.requestId)) continue;
		estimateByRequest.set(
			solution.requestId,
			`Estimate ${solution.currency === "THB" ? "฿" : `${solution.currency} `}${Number(solution.costEstimate).toLocaleString()}`,
		);
	}

	const visibleIds = visible.map((request) => request.id);
	const [recentActivities, statusActivities] = visibleIds.length
		? await Promise.all([
				prisma.request_activities.findMany({
					where: { requestId: { in: visibleIds } },
					orderBy: { createdAt: "desc" },
					take: 20,
					select: {
						id: true,
						createdAt: true,
						action: true,
						request: { select: { title: true } },
						user: { select: { name: true } },
					},
				}),
				prisma.request_activities.findMany({
					where: {
						requestId: { in: visibleIds },
						OR: [{ fromStatus: { not: null } }, { toStatus: { not: null } }],
					},
					orderBy: { createdAt: "asc" },
					select: {
						requestId: true,
						fromStatus: true,
						toStatus: true,
						createdAt: true,
					},
				}),
			])
		: [[], []];

	return buildFollowUpDashboard({
		visible: visible.map((request) => ({
			id: request.id,
			title: request.title,
			status: request.status,
			createdAt: request.createdAt,
			updatedAt: request.updatedAt ?? request.createdAt,
			requesterId: request.requesterId,
			requesterName: request.requester?.name || "Unknown",
			hasRejection: request.hasRejection,
			workRequisitionReceived: request.workRequisitionReceived,
			estimateLabel: estimateByRequest.get(request.id) ?? null,
			approvals: request.approvals,
			engineerAssignments: request.engineerAssignments,
		})),
		activities: statusActivities.flatMap((activity) =>
			activity.requestId
				? [
						{
							requestId: activity.requestId,
							fromStatus: activity.fromStatus,
							toStatus: activity.toStatus,
							createdAt: activity.createdAt,
						},
					]
				: [],
		),
		recentActivity: recentActivities.map((activity) => ({
			id: activity.id,
			createdAt: activity.createdAt,
			action: activity.action.replaceAll("_", " "),
			title: activity.request?.title || "Request",
			actorName: activity.user?.name || "Someone",
		})),
		currentUserId: user.id,
		departmentName: "Your department",
	});
}
