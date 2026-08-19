import { Badge } from "@/components/ui/badge";
import { RequestStatus } from "@prisma/client";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
	status: RequestStatus;
	hasRejection?: boolean;
}

const statusConfig = {
	[RequestStatus.ImprovementRequest]: {
		label: "Improvement Request",
		dot: "bg-blue-500",
		className:
			"bg-blue-50 text-blue-700 hover:bg-blue-50 ring-1 ring-inset ring-blue-600/20",
	},
	[RequestStatus.SentToEngineer]: {
		label: "Sent to Engineer",
		dot: "bg-amber-500",
		className:
			"bg-amber-50 text-amber-700 hover:bg-amber-50 ring-1 ring-inset ring-amber-600/25",
	},
	[RequestStatus.DesignCostEstimationApproval]: {
		label: "Design & Cost Approval",
		dot: "bg-purple-500",
		className:
			"bg-purple-50 text-purple-700 hover:bg-purple-50 ring-1 ring-inset ring-purple-600/20",
	},
	[RequestStatus.SendBackToRequester]: {
		label: "Sent Back to Requester",
		dot: "bg-orange-500",
		className:
			"bg-orange-50 text-orange-700 hover:bg-orange-50 ring-1 ring-inset ring-orange-600/20",
	},
	[RequestStatus.FinalApproval]: {
		label: "Final Approval",
		dot: "bg-indigo-500",
		className:
			"bg-indigo-50 text-indigo-700 hover:bg-indigo-50 ring-1 ring-inset ring-indigo-600/20",
	},
	[RequestStatus.Completed]: {
		label: "Completed",
		dot: "bg-emerald-500",
		className:
			"bg-emerald-50 text-emerald-700 hover:bg-emerald-50 ring-1 ring-inset ring-emerald-600/20",
	},
	[RequestStatus.Cancelled]: {
		label: "Cancelled",
		// Hollow dot: done-vs-not-running at a glance
		dot: "bg-transparent ring-1 ring-gray-400",
		className:
			"bg-gray-50 text-gray-600 hover:bg-gray-50 ring-1 ring-inset ring-gray-500/20",
	},
};

const rejectionConfig = {
	dot: "bg-red-500",
	className:
		"bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20 hover:bg-red-50",
};

export function StatusBadge({ status, hasRejection }: StatusBadgeProps) {
	const config = statusConfig[status] ?? {
		label: status,
		dot: "bg-gray-400",
		className:
			"bg-gray-50 text-gray-600 hover:bg-gray-50 ring-1 ring-inset ring-gray-500/20",
	};

	const isRejected =
		hasRejection &&
		(status === RequestStatus.SentToEngineer ||
			status === RequestStatus.ImprovementRequest ||
			status === RequestStatus.FinalApproval);

	return (
		<Badge
			variant="default"
			className={cn(
				"gap-1.5 rounded-full px-2.5 py-0.5 font-medium whitespace-nowrap",
				isRejected ? rejectionConfig.className : config.className,
			)}
		>
			<span
				aria-hidden
				className={cn(
					"h-1.5 w-1.5 shrink-0 rounded-full",
					isRejected ? rejectionConfig.dot : config.dot,
				)}
			/>
			{config.label}
		</Badge>
	);
}
