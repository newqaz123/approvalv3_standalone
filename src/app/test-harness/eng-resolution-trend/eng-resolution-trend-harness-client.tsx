"use client";

import { useState } from "react";
import { CancelRequestDialog } from "@/components/requests/cancel-request-dialog";
import { RequestFilters } from "@/components/requests/request-filters";
import type { RequestFilters as RequestFiltersState } from "@/components/requests/request-filters";
import { EngineeringResolutionTrendChart } from "@/components/analytics/engineering-resolution-trend-chart";
import type { EngineeringResolutionTrendPoint } from "@/types/analytics";

/**
 * Server-action-free UI harness (gated by E2E_UI_HARNESS=1) rendering the
 * real production components with injected callbacks. No database writes:
 * the cancel submission is captured in local state instead of calling the
 * server action.
 */

const FILTER_ROWS = [
	{ id: "wr-1", title: "Pump seal replacement", wrReceived: false },
	{ id: "wr-2", title: "Conveyor guard fabrication", wrReceived: false },
	{ id: "wr-3", title: "Control panel rewiring", wrReceived: true },
];

const TREND_FIXTURE: EngineeringResolutionTrendPoint[] = [
	{ period: "Week 1", engineeringUnresolved: 2, resolvedByEngineering: 1 },
	{ period: "Week 2", engineeringUnresolved: 4, resolvedByEngineering: 2 },
	{ period: "Week 3", engineeringUnresolved: 3, resolvedByEngineering: 3 },
];

export function EngResolutionTrendHarnessClient() {
	const [cancelCalls, setCancelCalls] = useState(0);
	const [lastCancelReason, setLastCancelReason] = useState<string | null>(null);
	const [filters, setFilters] = useState<RequestFiltersState>({
		wrStatus: "not-received",
	});

	const visibleRows = FILTER_ROWS.filter((row) =>
		filters.wrStatus === "not-received" ? !row.wrReceived : true,
	);

	return (
		<main className="mx-auto max-w-5xl space-y-8 p-8">
			<h1 className="text-2xl font-bold">
				Engineering Resolution Trend Test Harness
			</h1>
			<p className="text-sm text-muted-foreground">
				Production components with injected callbacks; no server actions or
				database access.
			</p>

			<section data-harness-section="cancel-dialog" className="space-y-3">
				<h2 className="text-lg font-semibold">Cancel Request dialog</h2>
				<p className="text-sm">
					Cancel calls:{" "}
					<strong data-cancel-call-count>{cancelCalls}</strong>
				</p>
				<p className="text-sm">
					Last reason:{" "}
					<strong data-cancel-last-reason>{lastCancelReason ?? "none"}</strong>
				</p>
				<CancelRequestDialog
					requestId="harness-request-1"
					requestTitle="Harness Pump Fix"
					onCancelled={() => undefined}
					onCancelRequest={async (input) => {
						setCancelCalls((count) => count + 1);
						setLastCancelReason(input.reason);
						return { success: true };
					}}
				/>
			</section>

			<section data-harness-section="request-filters" className="space-y-3">
				<h2 className="text-lg font-semibold">Request filters</h2>
				<RequestFilters
					departments={[]}
					requesters={[]}
					onFilterChange={setFilters}
				/>
				<p className="text-sm">
					Current WR status:{" "}
					<strong data-current-wr-status>{filters.wrStatus ?? "none"}</strong>
				</p>
				<ul data-filter-rows className="space-y-1">
					{visibleRows.map((row) => (
						<li
							key={row.id}
							data-request-row
							data-wr-received={row.wrReceived}
							className="rounded border bg-white px-3 py-1.5 text-sm"
						>
							{row.title}
						</li>
					))}
				</ul>
			</section>

			<section data-harness-section="trend-chart" className="space-y-3">
				<h2 className="text-lg font-semibold">Trend chart</h2>
				<div data-chart-frame className="w-full">
					<EngineeringResolutionTrendChart data={TREND_FIXTURE} />
				</div>
			</section>
		</main>
	);
}
