"use client";

import { useState } from "react";
import { RequestResubmitModal } from "@/components/requests/request-resubmit-modal";
import { Button } from "@/components/ui/button";

type AccessView = "requester" | "engineer" | null;

const rejectedRequest = {
	title: "Rejected access test request",
	description: "The original request description",
	rejectionReason: "Please revise the request scope.",
	rejectedBy: "Production Approver",
	rejectedAt: "2026-08-10T09:30:00.000Z",
	files: [
		{
			id: "11111111-1111-4111-8111-111111111111",
			fileName: "original-request.pdf",
			fileType: "pdf",
			description: "Original attachment",
		},
	],
};

export function RejectedRequestAccessHarnessClient() {
	const [view, setView] = useState<AccessView>(null);
	const [resubmitCalls, setResubmitCalls] = useState(0);

	const commonProps = {
		open: view !== null,
		onOpenChange: (open: boolean) => {
			if (!open) setView(null);
		},
		initialData: rejectedRequest,
		showCancel: false,
		requestId: "22222222-2222-4222-8222-222222222222",
		requestTitle: rejectedRequest.title,
	};
	const modalProps =
		view === "requester"
			? {
					...commonProps,
					onResubmit: () => setResubmitCalls((count) => count + 1),
				}
			: commonProps;

	return (
		<main className="mx-auto max-w-2xl space-y-6 p-8">
			<h1 className="text-2xl font-bold">Rejected Request Access Test Harness</h1>
			<div className="flex gap-3">
				<Button data-open-view="requester" onClick={() => setView("requester")}>
					Open requester view
				</Button>
				<Button data-open-view="engineer" onClick={() => setView("engineer")}>
					Open engineer view
				</Button>
			</div>
			<p data-resubmit-call-count>{resubmitCalls}</p>

			{view ? <RequestResubmitModal {...modalProps} /> : null}
		</main>
	);
}
