import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("follow-up dashboard redirects", () => {
	it("sends general users to My Actions after sign-in and from /", () => {
		const middleware = read("src/middleware.ts");
		const home = read("src/app/page.tsx");
		const signIn = read("src/app/(auth)/sign-in/[[...sign-in]]/page.tsx");

		assert.match(
			middleware,
			/case ["']engineering["']:[\s\S]*return ["']\/engineering["']/,
		);
		assert.match(
			middleware,
			/case ["']admin["']:[\s\S]*return ["']\/admin["']/,
		);
		assert.match(
			middleware,
			/default:[\s\S]*return ["']\/requests\/my-actions["']/,
		);
		assert.match(home, /redirect\(['"]\/requests\/my-actions['"]\)/);
		assert.match(signIn, /: ['"]\/requests\/my-actions['"]/);
	});
});

describe("follow-up dashboard data", () => {
	it("derives the approved board from getMyRequests visibility", () => {
		const source = read("src/server-actions/dashboard.ts");

		assert.match(source, /export async function getFollowUpDashboard/);
		assert.match(source, /getMyRequests\(/);
		assert.match(source, /buildFollowUpDashboard/);
		assert.match(source, /fromStatus/);
		assert.match(source, /toStatus/);
		assert.doesNotMatch(source, /Need my action/);
		assert.doesNotMatch(source, /Awaiting my approval/);
	});
});

describe("follow-up dashboard UI", () => {
	it("renders the approved board instead of pending-approval tabs", () => {
		const page = read("src/app/(dashboard)/dashboard/page.tsx");
		const board = read("src/components/dashboard/follow-up-dashboard.tsx");
		const logic = read("src/lib/follow-up-dashboard.ts");
		const source = read("src/server-actions/dashboard.ts");
		const router = read("src/components/requests/request-modal-router.tsx");

		assert.match(page, /FollowUpDashboard/);
		assert.doesNotMatch(page, /DashboardTabs/);
		assert.match(
			board,
			/motion-safe:hover:-translate-y-0\.5[\s\S]*motion-safe:hover:shadow-md/,
		);
		assert.match(board, /recentActivity\.slice\(0, 8\)/);
		assert.match(board, /Show more/);
		assert.match(board, /Show less/);
		assert.match(board, /from ["']vaul["']/);
		assert.match(board, /handleOnly/);
		assert.match(board, /Drawer\.Root/);
		assert.match(board, /Drawer\.Content/);
		assert.match(
			board,
			/min-h-0 flex-1[\s\S]*overflow-y-auto[\s\S]*overscroll-contain/,
		);
		assert.doesNotMatch(
			board,
			/absolute inset-x-0 bottom-0[\s\S]*md:inset-y-3 md:right-3/,
		);
		assert.match(source, /take: 20/);
		assert.match(board, /Awaiting approval/);
		assert.match(board, /Completed · no WR/);
		assert.match(board, /Engineer solution ready/);
		assert.match(board, /With Engineering/);
		assert.match(board, /30\+ days/);
		assert.match(board, /Needs attention/);
		assert.match(board, /deltaLabels/);
		assert.match(logic, /from yesterday/);
		assert.match(board, /data\.completedNoWr/);
		assert.match(board, /viewOnly/);
		assert.match(board, /formatAwaitingStatusLine/);
		assert.match(board, /hasRejection=\{row\.hasRejection\}/);
		assert.match(board, /StatusBadge/);
		assert.match(
			board,
			/inline-flex flex-wrap items-center gap-1\.5[\s\S]*StatusBadge/,
		);
		assert.match(
			board,
			/viewOnly=\{selected\.status !== "SendBackToRequester"\}/,
		);
		assert.doesNotMatch(board, /Department flow/);
		assert.doesNotMatch(board, /Completed recently/);
		assert.doesNotMatch(board, /Need my action/);
		assert.doesNotMatch(board, /Awaiting my approval/);
		assert.doesNotMatch(board, /Pending My Approval/);
		assert.doesNotMatch(board, /Personal approvals live on My Actions/);
		assert.doesNotMatch(board, /href=\"\/requests\/new\"/);
		assert.match(board, /SubmitterModal/);
		assert.match(board, /mode="request"/);
		assert.match(board, /createRequest/);
		assert.doesNotMatch(board, /toLocaleDateString/);
		assert.doesNotMatch(board, /toLocaleTimeString/);
		assert.match(
			board,
			/drawer\.rows\.map\([\s\S]*mine=\{row\.isMine\}[\s\S]*waitingDays/,
		);
		assert.match(router, /viewOnly\?: boolean/);
		const awaitingIdx = board.indexOf("Awaiting approval");
		const noWrIdx = board.indexOf("Completed · no WR");
		const readyIdx = board.indexOf("Engineer solution ready");
		assert.ok(awaitingIdx > 0 && noWrIdx > awaitingIdx && readyIdx > noWrIdx);
	});

	it("never mounts the Vaul sheet and the desktop aside at the same time", () => {
		const board = read("src/components/dashboard/follow-up-dashboard.tsx");

		// Pointer type decides which list surface mounts — CSS-only hiding left
		// the Vaul sheet open on desktop, and its open overlay ate every click so
		// rows in the visible list never opened the request detail.
		assert.match(board, /useMediaQuery\(["']\(pointer: fine\)["']\)/);
		assert.match(board, /\{!isFinePointer && \([\s\S]*?Drawer\.Root/);
		assert.match(board, /\{isFinePointer && drawer && \([\s\S]*?<aside/);
	});

	it("closes the list drawer before opening the selected request", () => {
		const board = read("src/components/dashboard/follow-up-dashboard.tsx");

		// Tapping a row inside either list surface must dismiss the list first,
		// then open the request modal, so the sheet can never sit on top of it.
		const matches = board.match(
			/onSelect=\{\(row\) => \{[\s\S]*?setDrawer\(null\);[\s\S]*?setSelected\(row\);[\s\S]*?\}\}/g,
		);
		assert.equal(
			matches?.length,
			2,
			"both drawer surfaces must close the list then open the request",
		);
	});
});
