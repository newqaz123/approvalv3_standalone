import { notFound } from "next/navigation";
import { EngResolutionTrendHarnessClient } from "./eng-resolution-trend-harness-client";

export const dynamic = "force-dynamic";

export default function EngResolutionTrendHarnessPage() {
	if (process.env.E2E_UI_HARNESS !== "1") notFound();
	return <EngResolutionTrendHarnessClient />;
}
