"use client";

import { useRef, useState } from "react";
import { ApproverModal } from "@/components/requests/approver-modal";
import { SubmitFinalApprovalModal } from "@/components/requests/submit-final-approval-modal";

type HarnessAction = "reject-solution" | "start-final-approval" | null;

const FIXTURE_DATE = "2026-01-01T00:00:00.000Z";

const APPROVER_DATA = {
	id: "pending-state-request",
	referenceId: "REQ-PENDING-001",
	title: "Pending State Solution Review",
	status: "solution" as const,
	submitter: {
		name: "Harness Requester",
		role: "Requester",
		email: "requester@example.com",
		initials: "HR",
	},
	requestDescription: "A deterministic request used only for browser testing.",
	solution: {
		title: "Harness Solution",
		description: "A deterministic solution used only for browser testing.",
		cost: 100,
		currency: "USD",
		timeline: "1 week",
		submittedBy: "Harness Engineer",
		submittedAt: FIXTURE_DATE,
		files: [],
	},
	requestFiles: [],
	stages: [],
	activities: [],
	lastModified: FIXTURE_DATE,
};

const FINAL_APPROVAL_DATA = {
	id: "pending-state-request",
	referenceId: "REQ-PENDING-001",
	title: "Pending State Final Approval",
	submitter: {
		name: "Harness Requester",
		role: "Requester",
		email: "requester@example.com",
		initials: "HR",
	},
	requestDescription: "A deterministic request used only for browser testing.",
	solution: {
		title: "Harness Solution",
		description: "A deterministic solution used only for browser testing.",
		cost: 100,
		currency: "USD",
		timeline: "1 week",
		submittedBy: "Harness Engineer",
		submittedAt: FIXTURE_DATE,
		files: [],
	},
	requestFiles: [],
	stages: [],
	activities: [],
	lastModified: FIXTURE_DATE,
};

export function ApprovalPendingStateHarnessClient() {
	const [activeAction, setActiveAction] = useState<HarnessAction>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [callCount, setCallCount] = useState(0);
	const pendingPromiseRef = useRef<Promise<void> | null>(null);
	const resolvePendingRef = useRef<(() => void) | null>(null);

	const openAction = (action: Exclude<HarnessAction, null>) => {
		pendingPromiseRef.current = null;
		resolvePendingRef.current = null;
		setIsSubmitting(false);
		setCallCount(0);
		setActiveAction(action);
	};

	const runDeferredAction = () => {
		setCallCount((count) => count + 1);
		if (pendingPromiseRef.current) return pendingPromiseRef.current;

		setIsSubmitting(true);
		const pendingPromise = new Promise<void>((resolve) => {
			resolvePendingRef.current = () => {
				pendingPromiseRef.current = null;
				resolvePendingRef.current = null;
				setIsSubmitting(false);
				resolve();
			};
		});
		pendingPromiseRef.current = pendingPromise;
		return pendingPromise;
	};

	const resolvePendingAction = () => {
		resolvePendingRef.current?.();
	};

	return (
		<main className="mx-auto max-w-2xl space-y-6 p-8">
			<h1 className="text-2xl font-bold">
				Approval Pending State Test Harness
			</h1>
			<p className="text-sm text-muted-foreground">
				Server-action-free deferred callbacks for duplicate-click verification.
			</p>

			<div className="flex flex-wrap gap-3">
				<button
					type="button"
					data-open-action="reject-solution"
					onClick={() => openAction("reject-solution")}
					className="rounded border px-3 py-2"
				>
					Open Reject Solution
				</button>
				<button
					type="button"
					data-open-action="start-final-approval"
					onClick={() => openAction("start-final-approval")}
					className="rounded border px-3 py-2"
				>
					Open Start Final Approval
				</button>
			</div>

			<div className="flex items-center gap-4 rounded border p-3 text-sm">
				<span>
					Deferred callback calls: <strong data-pending-call-count>{callCount}</strong>
				</span>
				<button
					type="button"
					data-resolve-pending
					onClick={resolvePendingAction}
					disabled={!isSubmitting}
					className="rounded border px-3 py-1 disabled:opacity-50"
				>
					Resolve Pending Action
				</button>
			</div>

			<ApproverModal
				mode="solution"
				open={activeAction === "reject-solution"}
				onOpenChange={(open) => {
					if (!open) setActiveAction(null);
				}}
				data={APPROVER_DATA}
				canApprove
				isSubmitting={isSubmitting}
				onApprove={runDeferredAction}
				onReject={runDeferredAction}
			/>

			<SubmitFinalApprovalModal
				open={activeAction === "start-final-approval"}
				onOpenChange={(open) => {
					if (!open) setActiveAction(null);
				}}
				data={FINAL_APPROVAL_DATA}
				availableUsers={[]}
				isSubmitting={isSubmitting}
				onSubmit={runDeferredAction}
			/>
		</main>
	);
}
