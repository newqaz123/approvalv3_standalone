import { notFound } from "next/navigation";
import RichTableHarnessClient from "./rich-table-harness-client";

export const dynamic = "force-dynamic";

export default function RichTableHarnessPage() {
	if (process.env.E2E_UI_HARNESS !== "1") notFound();
	return <RichTableHarnessClient />;
}
