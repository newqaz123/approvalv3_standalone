"use client";

import { CheckCircle2, Clock, XCircle, Check } from "lucide-react";
import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface Approval {
	id: string;
	status: "pending" | "approved" | "rejected";
	approver?: { name: string } | null;
	requiredApprover?: { name: string } | null;
	requiredLevel: number;
	order: number;
	approvedAt?: Date | null;
	isFinalApproval?: boolean;
	// For pending approvals, show potential approvers
	potentialApprovers?: { name: string }[] | null;
}

interface ApprovalStatusBadgeProps {
	approvals: Approval[];
	requestStatus: string;
	size?: "default" | "sm";
}

export function ApprovalStatusBadge({
	approvals,
	requestStatus,
	size = "default",
}: ApprovalStatusBadgeProps) {
	// Calculate overall approval state
	const approvedCount = approvals.filter((a) => a.status === "approved").length;
	const rejectedCount = approvals.filter((a) => a.status === "rejected").length;
	const pendingCount = approvals.filter((a) => a.status === "pending").length;

	// Determine badge display - simplified: only show "Approving" for in-progress, "-" for others
	const inProgress =
		approvals.length > 0 && pendingCount > 0 && rejectedCount === 0;

	// If not in progress, just show "-"
	if (!inProgress) {
		return (
			<div
				className={cn("text-center text-gray-400", size === "sm" && "text-xs")}
			>
				—
			</div>
		);
	}

	// Separate approvals by stage to show only current stage
	const initialStageApprovals = approvals.filter((a) => !a.isFinalApproval);
	const finalStageApprovals = approvals.filter((a) => a.isFinalApproval);

	// Determine which stage to display based on which has pending approvals
	const hasPendingInFinal = finalStageApprovals.some(
		(a) => a.status === "pending",
	);
	const currentStageApprovals = hasPendingInFinal
		? finalStageApprovals
		: initialStageApprovals;

	// Sorted chain for the timeline
	const chain = currentStageApprovals.slice().sort((a, b) => a.order - b.order);
	const currentPendingIndex = chain.findIndex((a) => a.status === "pending");

	// Stage progress for the header
	const stageApprovedCount = chain.filter(
		(a) => a.status === "approved",
	).length;
	const stageProgressPct =
		chain.length > 0
			? Math.round((stageApprovedCount / chain.length) * 100)
			: 0;
	const currentLevel =
		currentPendingIndex >= 0 ? chain[currentPendingIndex].requiredLevel : null;

	// Format date for display
	const formatDate = (date: Date | null | undefined) => {
		if (!date) return null;
		const d = new Date(date);
		return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
	};

	return (
		<HoverCard openDelay={200}>
			<HoverCardTrigger asChild>
				<Badge
					variant="default"
					className={cn(
						"font-medium cursor-help whitespace-nowrap gap-1.5 rounded-full bg-amber-50 text-amber-700 hover:bg-amber-50 ring-1 ring-inset ring-amber-600/25",
						size === "sm" && "text-[10px] px-2 py-0",
					)}
				>
					<Clock className="h-3 w-3" />
					Approving
				</Badge>
			</HoverCardTrigger>
			<HoverCardContent
				className="w-72 p-0 duration-200"
				side="bottom"
				align="center"
			>
				{/* Header: stage chip + progress */}
				<div className="border-b border-gray-100 px-4 pt-3.5 pb-3">
					<div className="flex items-center justify-between gap-2">
						<p className="text-sm font-semibold text-gray-900">
							Approval chain
						</p>
						<span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700 ring-1 ring-inset ring-indigo-600/20">
							{hasPendingInFinal ? "Final" : "Initial"}
						</span>
					</div>
					<div
						className="h-1.5 w-full rounded-full bg-gray-100 mt-2.5 overflow-hidden"
						role="progressbar"
						aria-valuenow={stageApprovedCount}
						aria-valuemin={0}
						aria-valuemax={chain.length}
					>
						<div
							className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all duration-300"
							style={{ width: `${stageProgressPct}%` }}
						/>
					</div>
					<p className="mt-1.5 text-xs text-gray-500">
						{stageApprovedCount} of {chain.length} approved
						{currentLevel !== null && ` · waiting for level ${currentLevel}`}
					</p>
				</div>

				{/* Timeline stepper */}
				<ol className="px-4 py-3.5">
					{chain.map((approval, index) => {
						const isApproved = approval.status === "approved";
						const isRejected = approval.status === "rejected";
						const isPending = approval.status === "pending";
						const isCurrent = isPending && index === currentPendingIndex;
						const isUpNext = isPending && index > currentPendingIndex;
						const stoppedByRejection =
							rejectedCount > 0 &&
							index > chain.findIndex((a) => a.status === "rejected");

						const displayName =
							isApproved || isRejected
								? approval.approver?.name || `Level ${approval.requiredLevel}`
								: approval.requiredApprover?.name
									? approval.requiredApprover.name
									: approval.potentialApprovers &&
											approval.potentialApprovers.length > 0
										? approval.potentialApprovers
												.map((p) => p.name)
												.join(" or ")
										: `Level ${approval.requiredLevel}`;

						const subLine = isApproved
							? `Level ${approval.requiredLevel}${approval.approvedAt ? ` · approved ${formatDate(approval.approvedAt)}` : ""}`
							: isRejected
								? `Level ${approval.requiredLevel} · rejected${approval.approvedAt ? ` ${formatDate(approval.approvedAt)}` : ""}`
								: isCurrent
									? `Level ${approval.requiredLevel} · awaiting approval`
									: stoppedByRejection
										? `Level ${approval.requiredLevel} · stopped`
										: `Level ${approval.requiredLevel} · up next`;

						return (
							<li
								key={approval.id}
								className={cn(
									"relative flex items-start gap-3 pb-4 last:pb-0",
									isUpNext && "opacity-70",
									stoppedByRejection && "opacity-50",
								)}
							>
								{/* Connector line */}
								{index < chain.length - 1 && (
									<span
										aria-hidden
										className={cn(
											"absolute left-[9px] top-5 bottom-0 w-0.5 rounded-full",
											isApproved ? "bg-emerald-300" : "bg-gray-200",
										)}
									/>
								)}
								{/* Step dot */}
								<span className="relative z-10 flex h-5 w-5 shrink-0 items-center justify-center">
									{isApproved && (
										<span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500">
											<Check className="h-3 w-3 text-white" strokeWidth={3} />
										</span>
									)}
									{isRejected && (
										<span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500">
											<XCircle className="h-3.5 w-3.5 text-white" />
										</span>
									)}
									{isPending && (
										<span
											className={cn(
												"h-2.5 w-2.5 rounded-full bg-white ring-2 ring-amber-400",
												isCurrent && "animate-pulse motion-reduce:animate-none",
											)}
										/>
									)}
								</span>
								{/* Name + level */}
								<div className="min-w-0 flex-1 pt-0.5">
									<p className="truncate text-sm font-medium text-gray-700 leading-tight">
										{displayName}
									</p>
									<p className="mt-0.5 text-xs text-gray-400">{subLine}</p>
								</div>
								{/* Status tag */}
								<span
									className={cn(
										"shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold h-fit mt-0.5",
										isApproved &&
											"bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20",
										isPending &&
											"bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/25",
										isRejected &&
											"bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20",
									)}
								>
									{isApproved
										? "Approved"
										: isRejected
											? "Rejected"
											: "Pending"}
								</span>
							</li>
						);
					})}
				</ol>
			</HoverCardContent>
		</HoverCard>
	);
}
