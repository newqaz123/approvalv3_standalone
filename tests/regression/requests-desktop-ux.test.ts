import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const filters = read("src/components/requests/request-filters.tsx");

describe("Requests desktop filters", () => {
	it("retains the existing Radix Select component and never uses native select", () => {
		assert.match(filters, /from ['"]@\/components\/ui\/select['"]/);
		for (const symbol of [
			"Select",
			"SelectTrigger",
			"SelectValue",
			"SelectContent",
			"SelectItem",
		]) {
			assert.match(filters, new RegExp(`\\b${symbol}\\b`));
		}
		assert.doesNotMatch(filters, /<select(?:\s|>)/);
	});

	it("keeps filtering immediate with no Apply step", () => {
		assert.match(
			filters,
			/setFilters\(newFilters\)[\s\S]*onFilterChange\(newFilters\)/,
		);
		assert.match(filters, /onFilterChange\(defaultFilters\)/);
		assert.doesNotMatch(filters, />\s*Apply\s*</);
		assert.match(filters, /aria-pressed=\{showOnlyNoWr\}/);
	});

	it("renders distinct primary and status tiers with responsive controls", () => {
		assert.match(filters, /data-filter-tier="primary"/);
		assert.match(filters, /data-filter-tier="status"/);
		assert.match(filters, /className="flex h-10 cursor-pointer/);
		assert.doesNotMatch(filters, /className="flex h-8 cursor-pointer/);
		assert.match(filters, /lg:grid-cols-3/);
		assert.ok(
			filters.includes(
				"xl:grid-cols-[minmax(16rem,1.6fr)_repeat(4,minmax(8.5rem,1fr))_minmax(9rem,auto)_minmax(5.5rem,auto)]",
			),
		);
		assert.doesNotMatch(filters, /2xl:grid-cols-/);
	});

	it("collapses the filter block to exactly two rows without a heading", () => {
		assert.doesNotMatch(filters, />\s*Filters\s*</);
		assert.doesNotMatch(filters, /font-semibold text-gray-700/);
		assert.match(filters, /Clear All/);
		assert.match(filters, /disabled=\{!hasActiveFilters\}/);
		assert.doesNotMatch(filters, /\{hasActiveFilters && \(/);
		assert.match(
			filters,
			/data-filter-tier="status"[^>]*flex flex-wrap[^>]*xl:flex-nowrap/,
		);
		assert.match(filters, /whitespace-nowrap/);
	});
});

describe("Requests desktop data flow and header", () => {
	it("keeps request list query, cache, and refresh contracts unchanged", () => {
		const listWithFilters = read(
			"src/components/requests/requests-list-with-filters.tsx",
		);

		assert.match(listWithFilters, /URLSearchParams/);
		assert.match(listWithFilters, /params\.append/);
		assert.match(listWithFilters, /\/api\/requests\?/);
		assert.match(listWithFilters, /cache: 'no-store'/);
		assert.match(listWithFilters, /approvalapp:request-data-changed/);
	});

	it("retains the Requests heading, supporting copy, actions, and mobile stack", () => {
		const listClient = read("src/components/requests/requests-list-client.tsx");

		assert.match(listClient, />Requests</);
		assert.match(
			listClient,
			/View and track improvement requests from your department/,
		);
		assert.match(listClient, /BulkDeleteByDateRange/);
		assert.match(listClient, /New Request/);
		assert.match(listClient, /flex flex-col sm:flex-row/);
		assert.doesNotMatch(listClient, /Export View/);
		assert.doesNotMatch(listClient, />\s*Apply\s*</);
	});
});

describe("Requests desktop table proportions and keyboard rows", () => {
	const table = read("src/components/requests/request-table.tsx");
	const requestCard = read("src/components/mobile/request-card.tsx");

	it("uses fixed desktop proportions, taller scan rows, and keyboard activation", () => {
		assert.match(table, /<Table className="min-w-\[[^\]]+\] table-fixed"/);
		assert.match(table, /line-clamp-2/);
		assert.match(table, /whitespace-nowrap/);
		assert.match(table, /<TableCell[^>]*className="h-\[60px\] py-3"/);
		assert.doesNotMatch(table, /<TableRow[\s\S]{0,300}min-h-\[60px\]/);
		assert.match(table, /tabIndex=\{0\}/);
		assert.match(table, /aria-label=\{`Open request /);
		assert.doesNotMatch(table, /<TableRow[\s\S]{0,300}role="button"/);
		assert.match(
			table,
			/event\.key === ["']Enter["'] \|\| event\.key === ["'] ["']/,
		);
		assert.match(table, /focus-visible:/);
		assert.match(table, /bg-sky-50 hover:bg-sky-100\/60/);
		assert.match(table, /className="md:hidden space-y-3"/);
		assert.match(table, /className="hidden md:block/);
		assert.match(table, /<RequestCard/);
		assert.match(table, /<RequestModalRouter/);
	});

	it("keeps RequestCard tap and empty-state contracts unchanged", () => {
		assert.match(requestCard, /export function RequestCard/);
		assert.match(requestCard, /onTap: \(requestId: string\) => void/);
		assert.match(requestCard, /onClick=\{\(\) => onTap\(request\.id\)\}/);
		assert.match(requestCard, /export function RequestCardsEmptyState/);
		assert.match(requestCard, /message = 'No requests found'/);
		assert.match(
			requestCard,
			/submessage = 'Create your first request to get started'/,
		);
	});
});

describe("Requests modern status pills and hover motion", () => {
	const badge = read("src/components/requests/status-badge.tsx");
	const approvalBadge = read(
		"src/components/requests/approval-status-badge.tsx",
	);
	const table = read("src/components/requests/request-table.tsx");

	it("renders dot-style status pills with inset rings instead of flat pastel badges", () => {
		assert.match(badge, /dot: ["']bg-blue-500["']/);
		assert.match(badge, /dot: ["']bg-amber-500["']/);
		assert.match(badge, /dot: ["']bg-purple-500["']/);
		assert.match(badge, /dot: ["']bg-orange-500["']/);
		assert.match(badge, /dot: ["']bg-indigo-500["']/);
		assert.match(badge, /dot: ["']bg-emerald-500["']/);
		assert.match(badge, /ring-1 ring-inset ring-blue-600\/20/);
		assert.match(badge, /ring-1 ring-inset ring-amber-600\/25/);
		assert.match(badge, /ring-1 ring-inset ring-emerald-600\/20/);
		assert.match(badge, /bg-amber-50 text-amber-700/);
		assert.match(badge, /bg-emerald-50 text-emerald-700/);
		// cancelled gets a hollow dot; rejection turns the pill red
		assert.match(badge, /dot: ["']bg-transparent ring-1 ring-gray-400["']/);
		assert.match(
			badge,
			/bg-red-50 text-red-700 ring-1 ring-inset ring-red-600\/20/,
		);
		// dot markup + full-round quiet pill
		assert.match(badge, /aria-hidden[\s\S]*?rounded-full/);
		assert.match(badge, /gap-1\.5 rounded-full/);
		assert.match(badge, /font-medium/);
		assert.doesNotMatch(badge, /bg-blue-100 text-blue-800/);
		assert.doesNotMatch(badge, /bg-yellow-100 text-yellow-800/);
	});

	it("restyles the Approving pill into the same dot-pill family", () => {
		assert.match(
			approvalBadge,
			/bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600\/25/,
		);
		assert.doesNotMatch(approvalBadge, /bg-yellow-100 text-yellow-800/);
	});

	it("renders the Approving popup as a timeline stepper with progress header", () => {
		assert.match(approvalBadge, /Approval chain/);
		assert.match(
			approvalBadge,
			/hasPendingInFinal \? ["']Final["'] : ["']Initial["']/,
		);
		assert.match(approvalBadge, /of.*approved|approved/);
		assert.match(approvalBadge, /waiting for level/);
		// progress bar
		assert.match(approvalBadge, /h-1\.5 w-full rounded-full bg-gray-100/);
		assert.match(approvalBadge, /style=\{\{ width:/);
		// timeline connector + ring avatars (dots retired into UserAvatar)
		assert.match(approvalBadge, /absolute left-\[9px\]/);
		assert.match(approvalBadge, /bg-emerald-300/);
		assert.match(approvalBadge, /status=\{\{/);
		// current pending avatar pulses via the shared component, reduced-motion safe
		assert.match(approvalBadge, /current: isCurrent/);
		// later pending steps read as up next
		assert.match(approvalBadge, /up next/);
		// entrance motion on the popup
		assert.match(approvalBadge, /duration-200/);
	});

	it("adds subtle hover motion to desktop request rows", () => {
		assert.match(table, /group\/row/);
		assert.match(table, /motion-safe:group-hover\/row:translate-x-0\.5/);
		assert.match(table, /group-hover\/row:text-gray-950/);
		// no cell may combine x and y motion — that slides chips at 45°
		assert.doesNotMatch(
			table,
			/motion-safe:group-hover\/row:-translate-y-0\.5/,
		);
		assert.match(table, /motion-safe:group-hover\/row:shadow-sm/);
		assert.match(table, /motion-reduce:transform-none/);
		assert.match(table, /transition-all duration-200/);
	});

	it("smooths row hover by transitioning the row background with cell text", () => {
		// row background fades instead of snapping
		assert.match(
			table,
			/group\/row cursor-pointer transition-colors duration-200/,
		);
		// secondary text cells darken in the same beat
		assert.match(table, /group-hover\/row:text-gray-600/);
		// unassigned and dimmed text also transition
		assert.match(table, /group-hover\/row:text-gray-500/);
		assert.doesNotMatch(table, /className="text-gray-400">—<\/span>/);
	});

	it("animates the entire row: shared slide on every cell and a left accent bar", () => {
		// every cell content slides together (title, requester, status, approval, PIC, dept, files, created)
		const slideCount = (
			table.match(/motion-safe:group-hover\/row:translate-x-0\.5/g) || []
		).length;
		assert.ok(
			slideCount >= 7,
			`expected >= 7 sliding cells, got ${slideCount}`,
		);
		// left accent bar scales in on the row edge
		assert.match(table, /w-\[3px\]/);
		assert.match(table, /motion-safe:scale-y-0/);
		assert.match(table, /motion-safe:group-hover\/row:scale-y-100/);
		// files column joins the shared motion
		const dimCount = (table.match(/group-hover\/row:text-gray-500/g) || [])
			.length;
		assert.ok(dimCount >= 3, `expected >= 3 dimming cells, got ${dimCount}`);
		// snappy easing everywhere
		assert.match(table, /ease-out/);
		// sliding <span> cells must be inline-block — transforms are ignored on inline elements
		const inlineBlockSlides = (
			table.match(
				/inline-block[^"}]*motion-safe:group-hover\/row:translate-x-0\.5/g,
			) || []
		).length;
		assert.ok(
			inlineBlockSlides >= 2,
			`expected >= 2 inline-block sliding spans, got ${inlineBlockSlides}`,
		);
		// and no bare inline span carries a translate (inline-block/-flex and line-clamp-2 are transform-safe)
		assert.doesNotMatch(
			table,
			/<span className="(?![^"}]*(inline-block|inline-flex|line-clamp-2))[^"}]*motion-safe:group-hover\/row:translate-x-0\.5/,
		);
	});

	it("renders PIC as an avatar with name and overflow count", () => {
		assert.doesNotMatch(table, /UserCircle/);
		assert.doesNotMatch(table, /PIC_GRADIENTS/);
		assert.match(
			table,
			/import \{ UserAvatar \} from "@\/components\/ui\/user-avatar"/,
		);
		assert.match(table, /<UserAvatar\n[\s\S]*?name=\{first\.engineer\.name\}/);
		assert.match(table, /size="md"/);
		assert.match(table, /visibleAssignments\.slice\(0, 1\)/);
		assert.match(table, /\+\{remainingCount\}/);
		assert.match(
			table,
			/assignments\.map\(\(a\) => a\.engineer\.name\)\.join\(", "\)/,
		);
	});
});
