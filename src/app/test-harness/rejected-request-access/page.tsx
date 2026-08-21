import { notFound } from "next/navigation";
import { RejectedRequestAccessHarnessClient } from "./rejected-request-access-harness-client";

export const dynamic = "force-dynamic";

export default function RejectedRequestAccessHarnessPage() {
	if (process.env.E2E_UI_HARNESS !== "1") notFound();
	return <RejectedRequestAccessHarnessClient />;
}
