import { test, expect, type Locator, type Page } from "@playwright/test";

/**
 * Desktop UX Refresh — browser acceptance contract.
 *
 * Authored in Task 1 (test-first) BEFORE any production changes and observed RED
 * against the baseline UI. Production tasks (shared 1720px canvas, `lg` navbar
 * handoff, compact navbar with collapsed secondary metadata, keyboard-activated
 * rows, and the environment-gated `/test-harness/hierarchy-pickers` fixtures)
 * make these scenarios green without rewriting the assertions.
 *
 * Non-mutating only: this spec never creates, approves, rejects, resubmits,
 * deletes, archives, seeds, or migrates records. It only signs in with an
 * existing non-mutating test account, reads rendered UI, opens read-only
 * request dialogs, and exercises the deterministic (server-action-free) picker
 * harness.
 */

const BASE_URL = process.env.TEST_BASE_URL || "http://127.0.0.1:3001";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "admin@example.com";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || "changeme";

/** Breakpoints referenced by the refresh plan. */
const VW = {
	WIDE: 1600, // shell alignment / no-overflow desktop
	DESKTOP: 1280, // compact navbar + collapsed secondary metadata
	HANDOFF: 900, // nav hands off at `lg`, table/cards still at `md`
	MOBILE_HI: 767, // just under `md`
	PHONE: 390, // single-column filters
} as const;

/**
 * Sign in via the credential form using the brief's exact selectors
 * (`/sign-in`, `#email`, `#password`, the `Sign in` button). Admins land on
 * `/admin`, so the helper only waits until the browser leaves `/sign-in`.
 */
async function signIn(
	page: Page,
	email = ADMIN_EMAIL,
	password = ADMIN_PASSWORD,
) {
	await page.goto(`${BASE_URL}/sign-in`);
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(password);
	await page.getByRole("button", { name: "Sign in" }).click();
	await page.waitForURL((url) => !url.pathname.includes("/sign-in"), {
		timeout: 20000,
	});
}

/** Sign in, then open the Requests list and wait for it to render. */
async function signInAndOpenRequests(page: Page, viewportWidth: number) {
	await page.setViewportSize({ width: viewportWidth, height: 1000 });
	await signIn(page);
	await page.goto(`${BASE_URL}/requests`);
	// The filters panel renders above the table/card list at every breakpoint, so
	// it is a viewport-agnostic "Requests page loaded" signal (the desktop table
	// is hidden below `md`, where mobile cards render instead).
	await expect(filtersPanel(page)).toBeVisible({ timeout: 20000 });
}

/** The visible desktop navbar — identified by its unique "Approval System" brand. */
const desktopNavbar = (page: Page) =>
	page.locator("nav").filter({ hasText: "Approval System" });

/** The fixed mobile top navigation (rendered by `<MobileNav />`). */
const mobileNav = (page: Page) => page.locator("nav.fixed");

/** The Requests filters panel (wrapper containing the "Filters" heading). */
const filtersPanel = (page: Page) =>
	page
		.locator("div.rounded-lg.border.bg-gray-50")
		.filter({ hasText: "Filters" });

/**
 * Stable contract markers the refresh must add where it applies the shared
 * authenticated shell (`AUTHENTICATED_SHELL_CLASS`, Tasks 2-3):
 *   - the desktop navbar inner content container carries `data-auth-shell`
 *   - the `<main>` element carries `data-auth-shell`
 * Asserting these (not the full-bleed outer `<nav>`) pins the shared-shell frame
 * the refresh introduces, so the alignment check goes GREEN once Tasks 2-3 land.
 */
const navbarShell = (page: Page) =>
	desktopNavbar(page).locator("[data-auth-shell]");
const mainShell = (page: Page) => page.locator("main[data-auth-shell]");

test.describe("Desktop UX Refresh — baseline acceptance (observed RED before production)", () => {
	// Each test signs in independently into a fresh isolated context, so the
	// suite must NOT abort after the first failure — every scenario runs so the
	// full baseline (RED and preserved-GREEN) is captured.
	test.setTimeout(60000);

	test("1. 1600px shell: shared-shell alignment, table visible, Created one line, no overflow", async ({
		page,
	}) => {
		await signInAndOpenRequests(page, VW.WIDE);

		// (a) The desktop navbar and main share ONE authenticated shell frame
		// (within 1px). Baseline RED: the `data-auth-shell` contract does not
		// exist yet — `<main>` is capped at `max-w-7xl` (1280px) while the navbar
		// is full-bleed, so there is no shared shell to align. Post-refresh both
		// carry the shared `max-w-[1720px]` shell and their edges align.
		await expect(
			navbarShell(page),
			"desktop navbar renders the shared authenticated shell",
		).toBeVisible();
		await expect(
			mainShell(page),
			"main renders the shared authenticated shell",
		).toBeVisible();
		const navBox = await navbarShell(page).boundingBox();
		const mainBox = await mainShell(page).boundingBox();
		expect(
			Math.abs(navBox!.x - mainBox!.x),
			`navbar/main shell LEFT edges align within 1px (got nav=${navBox!.x}, main=${mainBox!.x})`,
		).toBeLessThanOrEqual(1);
		expect(
			Math.abs(navBox!.x + navBox!.width - (mainBox!.x + mainBox!.width)),
			`navbar/main shell RIGHT edges align within 1px`,
		).toBeLessThanOrEqual(1);

		// (b) Requests desktop table is visible.
		await expect(page.locator("table").first()).toBeVisible();

		// (c) Created values render on a single line (no wrapping).
		const createdCells = page.locator("table tbody tr td:last-child");
		const cellCount = await createdCells.count();
		expect(cellCount, "at least one Created cell is present").toBeGreaterThan(
			0,
		);
		for (let i = 0; i < Math.min(cellCount, 5); i++) {
			const innerHeight = await createdCells
				.nth(i)
				.locator("*")
				.first()
				.evaluate((el) => (el as HTMLElement).offsetHeight);
			expect(
				innerHeight,
				`Created cell ${i} stays on one line`,
			).toBeLessThanOrEqual(28);
		}

		// (d) No horizontal page overflow.
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - window.innerWidth,
		);
		expect(overflow, "body has no horizontal overflow").toBeLessThanOrEqual(1);
	});

	test("2. 1280px: desktop navbar visible, links on one row, secondary metadata hidden, filters unclipped", async ({
		page,
	}) => {
		await signInAndOpenRequests(page, VW.DESKTOP);

		// Desktop navbar is visible.
		await expect(desktopNavbar(page)).toBeVisible();

		// Primary links are visible AND each renders its label on a single line
		// (no wrapping). Visibility, top-edge spread, and overall nav height do
		// not prove "do not wrap": the nav is a fixed `h-16` row that clips
		// overflow. Instead, measure each link's TEXT line count directly (range
		// height / computed line-height). At baseline the multi-word labels ("My
		// Actions", "Budget Monitor", "Admin Panel") wrap to two lines (ratio
		// ~2.0) while single-word links stay one line (ratio ~1.0); the refresh
		// makes every link single-line, so the per-link threshold (<= 1.5) is a
		// stable geometry contract for both the baseline and the approved navbar.
		const linkLabels = [
			"Requests",
			"My Actions",
			"Analytics",
			"Budget Monitor",
			"Admin Panel",
		];
		for (const label of linkLabels) {
			const link = desktopNavbar(page).getByRole("link", { name: label });
			await expect(link, `navbar link "${label}" is visible`).toBeVisible();
			const ratio = await navLinkTextLineRatio(link);
			expect(
				ratio,
				`navbar link "${label}" label is one line (ratio ${ratio.toFixed(2)})`,
			).toBeLessThanOrEqual(1.5);
		}

		// Secondary role/email metadata collapses below `2xl`. Baseline RED: the
		// navbar always renders `Admin • admin@example.com` with no responsive hide.
		await expect(
			desktopNavbar(page).getByText(ADMIN_EMAIL),
			"secondary role/email metadata is hidden at 1280px",
		).not.toBeVisible();

		// Filters are not clipped (no horizontal overflow within the filter panel).
		const panelOverflow = await filtersPanel(page).evaluate(
			(el) => el.scrollWidth - el.clientWidth,
		);
		expect(
			panelOverflow,
			"filter controls are unclipped at 1280px",
		).toBeLessThanOrEqual(0);
	});

	test("3. 900px: mobile navigation visible while the desktop Requests table stays visible", async ({
		page,
	}) => {
		await signInAndOpenRequests(page, VW.HANDOFF);

		// Navigation hands off at `lg` (1024px). At 900px mobile nav is visible and
		// the desktop navbar is hidden. Baseline RED: handoff is still at `md`, so
		// the mobile nav is hidden and the desktop navbar is visible at 900px.
		await expect(
			mobileNav(page),
			"mobile navigation is visible at 900px",
		).toBeVisible();
		await expect(
			desktopNavbar(page),
			"desktop navbar is hidden at 900px",
		).not.toBeVisible();

		// Table/cards hand off at `md` (768px). At 900px the desktop table is still
		// visible and the mobile cards are hidden.
		await expect(
			page.locator("table").first(),
			"desktop Requests table is visible at 900px",
		).toBeVisible();
		await expect(
			page.locator('div[class~="md:hidden"]').locator("button").first(),
			"mobile request cards are hidden at 900px",
		).not.toBeVisible();
	});

	test("4a. 767px: mobile navigation and mobile request cards visible; desktop navbar/table absent", async ({
		page,
	}) => {
		await signInAndOpenRequests(page, VW.MOBILE_HI);

		await expect(
			mobileNav(page),
			"mobile navigation is visible at 767px",
		).toBeVisible();
		await expect(
			page.locator('div[class~="md:hidden"]').locator("button").first(),
			"mobile request cards are visible at 767px",
		).toBeVisible();
		await expect(
			desktopNavbar(page),
			"desktop navbar is absent at 767px",
		).not.toBeVisible();
		await expect(
			page.locator("table"),
			"desktop table is absent at 767px",
		).not.toBeVisible();
	});

	test("4b. 390px: mobile navigation + cards visible, desktop table absent, filter controls form one column", async ({
		page,
	}) => {
		await signInAndOpenRequests(page, VW.PHONE);

		// Mobile navigation is visible below `md`/`lg`.
		await expect(
			mobileNav(page),
			"mobile navigation is visible at 390px",
		).toBeVisible();
		await expect(
			page.locator('div[class~="md:hidden"]').locator("button").first(),
			"mobile request cards are visible at 390px",
		).toBeVisible();
		await expect(
			page.locator("table"),
			"desktop table is absent at 390px",
		).not.toBeVisible();

		// Filter controls stack into a single column at 390px. Assert the Department
		// and Requester controls share a left edge but sit on different rows.
		const departmentTrigger = filtersPanel(page).getByText("All Departments");
		const requesterTrigger = filtersPanel(page).getByText("All Requesters");
		const deptBox = await departmentTrigger.boundingBox();
		const reqBox = await requesterTrigger.boundingBox();
		expect(deptBox, "Department filter trigger is rendered").not.toBeNull();
		expect(reqBox, "Requester filter trigger is rendered").not.toBeNull();
		expect(
			Math.abs(deptBox!.x - reqBox!.x),
			"Department/Requester controls align left (one column) at 390px",
		).toBeLessThanOrEqual(1);
		expect(
			reqBox!.y,
			"Requester control is stacked below Department at 390px",
		).toBeGreaterThan(deptBox!.y);
	});

	test("5. Department/Requester controls are Radix comboboxes with listbox behavior and no Apply button", async ({
		page,
	}) => {
		await signInAndOpenRequests(page, VW.DESKTOP);

		// Each trigger is a Radix combobox BEFORE we assert the listbox it opens.
		const departmentCombobox = filtersPanel(page)
			.getByRole("combobox")
			.filter({ hasText: "All Departments" });
		const requesterCombobox = filtersPanel(page)
			.getByRole("combobox")
			.filter({ hasText: "All Requesters" });
		await expect(
			departmentCombobox,
			"Department trigger is a combobox",
		).toBeVisible();
		await expect(
			requesterCombobox,
			"Requester trigger is a combobox",
		).toBeVisible();

		// Opening the Department combobox portals a Radix listbox with options.
		await departmentCombobox.click();
		await expect(
			page.getByRole("listbox"),
			"Radix listbox opens for Department",
		).toBeVisible();
		expect(
			await page.getByRole("option").count(),
			"Department listbox exposes selectable options",
		).toBeGreaterThan(0);
		await page.keyboard.press("Escape");

		// Same Radix listbox/option behavior for the Requester combobox.
		await requesterCombobox.click();
		await expect(
			page.getByRole("listbox"),
			"Radix listbox opens for Requester",
		).toBeVisible();
		await page.keyboard.press("Escape");

		// No "Apply" button is rendered (filters apply immediately).
		await expect(
			page.getByRole("button", { name: /^Apply$/i }),
			"no Apply button is present",
		).toHaveCount(0);
	});

	test("6. Enter and Space on a focused desktop request row open the request dialog", async ({
		page,
	}) => {
		await signInAndOpenRequests(page, VW.DESKTOP);

		const firstRow = page.locator("table tbody tr").first();
		await expect(firstRow).toBeVisible();
		const dialog = page.locator('[role="dialog"]');

		// Baseline RED: desktop rows only have onClick — they are not keyboard
		// focusable and have no key handler, so neither key opens the dialog.
		await firstRow.focus();
		await page.keyboard.press("Enter");
		await expect(
			dialog,
			"Enter on a focused row opens the request dialog",
		).toBeVisible({
			timeout: 3000,
		});
		await page.keyboard.press("Escape");
		await expect(dialog).not.toBeVisible();

		await firstRow.focus();
		await page.keyboard.press("Space");
		await expect(
			dialog,
			"Space on a focused row opens the request dialog",
		).toBeVisible({
			timeout: 3000,
		});
		await page.keyboard.press("Escape");
	});

	/**
	 * Scenario 7 defines the future `/test-harness/hierarchy-pickers` contract
	 * (implemented by Tasks 8-11) and exercises every real picker. Baseline RED:
	 * the route does not exist, so the "five fixtures" gate fails immediately.
	 *
	 * Harness contract (test-first):
	 *  - Route `/test-harness/hierarchy-pickers` is gated by `E2E_UI_HARNESS=1`.
	 *  - Five fixtures, each `<section data-picker-fixture="<label>">` with a
	 *    stable label from HARNESS_FIXTURES, sharing the deterministic
	 *    server-action-free user pool in HARNESS_USERS.
	 *  - Each fixture exposes stable controls:
	 *      [data-picker-open]    — opens its real workflow-specific picker
	 *      [data-picker-exhaust] — harness control that preselects every user
	 *      [data-picker-reset]   — harness control that clears all selections
	 *  - The open picker exposes behavior-level selectors shared by the existing
	 *    heterogeneous implementations: `[data-picker-root]` (root), its input
	 *    (search), `[data-picker-item]` (each available approver, showing
	 *    name/email/role/level), `[data-picker-count]` (live result count),
	 *    `No approvers found` (zero query matches), and `No more users available`
	 *    (all selected).
	 *  - Selecting an approver clears the query (select-reset; the picker need not
	 *    auto-close). Closing and reopening the picker clears the query (close-reset).
	 */
	test("7. /test-harness/hierarchy-pickers exposes five real picker fixtures with full search behavior", async ({
		page,
	}) => {
		await page.setViewportSize({ width: VW.WIDE, height: 1000 });
		await signIn(page);
		await page.goto(`${BASE_URL}/test-harness/hierarchy-pickers`);

		// Baseline RED gate: the harness route is absent, so there are no fixtures.
		const fixtures = page.locator("[data-picker-fixture]");
		await expect(
			fixtures,
			"harness exposes five labeled real picker fixtures",
		).toHaveCount(5);

		for (const label of HARNESS_FIXTURES) {
			await exercisePickerFixture(page, label);
		}
	});
});

/** Fixture labels — one per real picker implementation (Tasks 8-10 aliases). */
const HARNESS_FIXTURES = [
	"custom",
	"submitter",
	"submit-final",
	"final-resubmit",
	"solution",
] as const;

/**
 * Deterministic, server-action-free approver pool shared by every harness
 * fixture. Each entry carries name + email + role + level so search parity can
 * be asserted across all four metadata axes.
 */
const HARNESS_USERS = [
	{
		name: "Ada Lovelace",
		email: "ada@example.com",
		role: "Engineering",
		level: "Level 1",
	},
	{
		name: "Grace Hopper",
		email: "grace@example.com",
		role: "Production",
		level: "Level 2",
	},
	{
		name: "Linus Torvalds",
		email: "linus@example.com",
		role: "Quality",
		level: "Level 3",
	},
] as const;

/** The open real picker (only one fixture is exercised at a time). */
const openPicker = (page: Page) => page.locator("[data-picker-root]:visible");
const pickerSearch = (page: Page) => openPicker(page).locator("input").first();
const fixtureOpen = (page: Page, label: string) =>
	page.locator(`[data-picker-fixture="${label}"] [data-picker-open]`);

/**
 * Numeric value of the open picker's live result count (`[data-picker-count]`,
 * e.g. "3 approvers found"). Returns NaN if unreadable so callers can poll.
 */
async function pickerCount(page: Page): Promise<number> {
	try {
		const text = await openPicker(page)
			.locator("[data-picker-count]")
			.innerText();
		const match = text.match(/\d+/);
		return match ? Number(match[0]) : Number.NaN;
	} catch {
		return Number.NaN;
	}
}

async function closePicker(page: Page, label: string) {
	const closeControl = page.locator(
		`[data-picker-fixture="${label}"] [data-picker-close]`,
	);
	if (await closeControl.count()) {
		await closeControl.click({ position: { x: 2, y: 2 } });
	} else {
		const trigger = fixtureOpen(page, label);
		if (await trigger.isEnabled()) await trigger.click();
	}
	if (await openPicker(page).count()) await page.keyboard.press("Escape");
	await expect(openPicker(page), `${label}: picker closes cleanly`).toHaveCount(0);
}

/**
 * Approximate number of visual text lines inside a navbar link, measured as
 * (range height of the link's text node) / (computed line-height). ~1.0 means
 * the label is on one line; ~2.0 means it wrapped. Padding/min-height/flex do
 * not affect it, so the same threshold works for the baseline and approved
 * navbar. Used to prove each link's label does not wrap.
 */
async function navLinkTextLineRatio(link: Locator): Promise<number> {
	return link.evaluate((el: HTMLElement) => {
		const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight) || 20;
		const range = document.createRange();
		let textNode: Node | null = null;
		for (const node of Array.from(el.childNodes)) {
			if (node.nodeType === 3 && (node.textContent || "").trim()) {
				textNode = node;
				break;
			}
		}
		if (!textNode) return 1;
		range.selectNodeContents(textNode);
		return range.getBoundingClientRect().height / lineHeight;
	});
}

/**
 * Open one fixture's real picker and assert the full search contract: live
 * count, match-by-name/email/role/level, no-result copy, select-reset,
 * close/reopen-reset, and the exhausted state.
 */
async function exercisePickerFixture(page: Page, label: string) {
	const [ada, grace, linus] = HARNESS_USERS;

	// 1. Open the picker; the full pool is listed and the live count matches it.
	await fixtureOpen(page, label).click();
	await expect(pickerSearch(page), `${label}: search field opens`).toBeVisible({
		timeout: 3000,
	});
	await expect(
		openPicker(page).locator("[data-picker-count]"),
		`${label}: live result count is shown`,
	).toBeVisible();
	await expect
		.poll(
			async () => await openPicker(page).locator("[data-picker-item]").count(),
			`${label}: full approver pool is listed`,
		)
		.toBe(HARNESS_USERS.length);
	await expect
		.poll(
			async () => await pickerCount(page),
			`${label}: count reflects the full pool before filtering`,
		)
		.toBe(HARNESS_USERS.length);

	// 2. Match by name / email / role / level. For each query the matching
	//    approver is present, a known non-matching approver is absent, the list
	//    narrows to exactly one, and the live count updates to 1 — so a static /
	//    unfiltered list or a stale count cannot pass. Metadata is per fixture.
	const items = () => openPicker(page).locator("[data-picker-item]");
	const matches: Array<[string, string, string, string]> = [
		["name", ada.name, ada.name, linus.name],
		["email", grace.email, grace.name, ada.name],
		["role", linus.role, linus.name, grace.name],
		["level", grace.level, grace.name, linus.name],
	];
	for (const [field, query, matchName, nonMatchName] of matches) {
		await pickerSearch(page).fill(query);
		await expect(
			items().filter({ hasText: matchName }),
			`${label}: match by ${field} ("${query}") shows ${matchName}`,
		).toBeVisible();
		await expect(
			items().filter({ hasText: nonMatchName }),
			`${label}: match by ${field} ("${query}") hides non-matching ${nonMatchName}`,
		).toHaveCount(0);
		await expect
			.poll(
				async () => await items().count(),
				`${label}: exactly one match by ${field}`,
			)
			.toBe(1);
		await expect
			.poll(
				async () => await pickerCount(page),
				`${label}: count updates to 1 after ${field} query`,
			)
			.toBe(1);
	}

	// 3. No-result state (exact copy) and the list empties.
	await pickerSearch(page).fill("zzzzzz-no-such-approver");
	await expect(
		openPicker(page).getByText("No approvers found"),
		`${label}: search miss shows "No approvers found"`,
	).toBeVisible();
	await expect
		.poll(
			async () => await items().count(),
			`${label}: no items on a search miss`,
		)
		.toBe(0);

	// 4. Select-reset: selecting a real approver clears the query. The picker may
	//    auto-close on select OR stay open — only reopen the trigger if it
	//    actually closed; assert the query is cleared either way (do not require
	//    auto-close).
	await pickerSearch(page).fill(ada.name);
	await items().first().click();
	if (
		!(await pickerSearch(page)
			.isVisible()
			.catch(() => false))
	) {
		await fixtureOpen(page, label).click();
	}
	await expect(
		pickerSearch(page),
		`${label}: selecting an approver cleared the query`,
	).toHaveValue("");
	await closePicker(page, label);

	// 5. Close/reopen-reset: typing then closing and reopening clears the query.
	await fixtureOpen(page, label).click();
	await pickerSearch(page).fill(grace.name);
	await closePicker(page, label);
	await fixtureOpen(page, label).click();
	await expect(
		pickerSearch(page),
		`${label}: closing/reopening cleared the query`,
	).toHaveValue("");
	await closePicker(page, label);

	// 6. Exhausted state (every user preselected) + harness reset to clean state.
	await page
		.locator(`[data-picker-fixture="${label}"] [data-picker-exhaust]`)
		.click();
	const trigger = fixtureOpen(page, label);
	if (await trigger.isEnabled()) await trigger.click();
	await expect(
		page.locator(`[data-picker-fixture="${label}"]`).getByText("No more users available"),
		`${label}: exhausted state shows "No more users available"`,
	).toBeVisible();
	await page
		.locator(`[data-picker-fixture="${label}"] [data-picker-reset]`)
		.click();
	await closePicker(page, label);
}
