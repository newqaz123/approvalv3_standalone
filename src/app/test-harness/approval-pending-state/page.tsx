import { notFound } from "next/navigation";
import { ApprovalPendingStateHarnessClient } from "./approval-pending-state-harness-client";

export const dynamic = "force-dynamic";

export default function ApprovalPendingStateHarnessPage() {
	if (process.env.E2E_UI_HARNESS !== "1") notFound();
	return <ApprovalPendingStateHarnessClient />;
}
