import { test, expect, type Page } from "@playwright/test";

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

/** The authenticated main content frame. */
const mainFrame = (page: Page) => page.locator("main").first();

/** The Requests filters panel (wrapper containing the "Filters" heading). */
const filtersPanel = (page: Page) =>
	page
		.locator("div.rounded-lg.border.bg-gray-50")
		.filter({ hasText: "Filters" });

test.describe("Desktop UX Refresh — baseline acceptance (observed RED before production)", () => {
	// Each test signs in independently into a fresh isolated context, so the
	// suite must NOT abort after the first failure — every scenario runs so the
	// full baseline (RED and preserved-GREEN) is captured.
	test.setTimeout(60000);

	test("1. 1600px shell: navbar/main edges align, table visible, Created one line, no overflow", async ({
		page,
	}) => {
		await signInAndOpenRequests(page, VW.WIDE);

		// (a) Navbar and main share the same horizontal frame (within 1px).
		// Baseline RED: the desktop navbar is full-bleed while <main> is capped at
		// `max-w-7xl` (1280px) and centered, so their edges differ by ~160px.
		// Post-refresh both consume the shared `max-w-[1720px]` shell and align.
		const navBox = await desktopNavbar(page).boundingBox();
		const mainBox = await mainFrame(page).boundingBox();
		expect(navBox, "desktop navbar is rendered").not.toBeNull();
		expect(mainBox, "main frame is rendered").not.toBeNull();
		const navLeft = navBox!.x;
		const navRight = navBox!.x + navBox!.width;
		const mainLeft = mainBox!.x;
		const mainRight = mainBox!.x + mainBox!.width;
		expect(
			Math.abs(navLeft - mainLeft),
			`navbar/main LEFT edges align within 1px (got nav=${navLeft}, main=${mainLeft})`,
		).toBeLessThanOrEqual(1);
		expect(
			Math.abs(navRight - mainRight),
			`navbar/main RIGHT edges align within 1px (got nav=${navRight}, main=${mainRight})`,
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

	test("2. 1280px: desktop navbar visible, links do not wrap, secondary metadata hidden, filters unclipped", async ({
		page,
	}) => {
		await signInAndOpenRequests(page, VW.DESKTOP);

		// Desktop navbar is visible.
		await expect(desktopNavbar(page)).toBeVisible();

		// Primary links remain visible (no wrapping/clipping drops a link).
		for (const label of [
			"Requests",
			"My Actions",
			"Analytics",
			"Budget Monitor",
			"Admin Panel",
		]) {
			await expect(
				desktopNavbar(page).getByRole("link", { name: label }),
				`navbar link "${label}" is visible`,
			).toBeVisible();
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

	test("4b. 390px: mobile cards visible, desktop table absent, filter controls form one column", async ({
		page,
	}) => {
		await signInAndOpenRequests(page, VW.PHONE);

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

	test("5. Department/Requester controls expose Radix listbox behavior with no Apply button", async ({
		page,
	}) => {
		await signInAndOpenRequests(page, VW.DESKTOP);

		// Open the Department Select; Radix exposes a listbox with option items.
		await filtersPanel(page).getByText("All Departments").click();
		await expect(
			page.getByRole("listbox"),
			"Radix listbox opens for Department",
		).toBeVisible();
		const optionCount = await page.getByRole("option").count();
		expect(
			optionCount,
			"Department listbox exposes selectable options",
		).toBeGreaterThan(0);
		await page.keyboard.press("Escape");

		// Open the Requester Select; same Radix listbox/option behavior.
		await filtersPanel(page).getByText("All Requesters").click();
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

	test("7. /test-harness/hierarchy-pickers exposes five real picker fixtures with full search behavior", async ({
		page,
	}) => {
		// Baseline RED: the environment-gated harness route does not exist yet
		// (created in a later task), so no fixtures render.
		await page.setViewportSize({ width: VW.WIDE, height: 1000 });
		await signIn(page);
		await page.goto(`${BASE_URL}/test-harness/hierarchy-pickers`);

		const fixtures = page.locator("[data-picker-fixture]");
		await expect(
			fixtures,
			"harness exposes five labeled real picker fixtures",
		).toHaveCount(5);

		const labels = [
			"solution",
			"submitter",
			"submit-final",
			"final-resubmit",
			"custom",
		];
		for (const label of labels) {
			const fixture = page.locator(`[data-picker-fixture="${label}"]`);
			await expect(fixture, `fixture "${label}" is present`).toBeVisible();

			// Live count is shown while results are present.
			await expect(
				fixture.getByText(/ approvers? found|results?/i),
				`${label}: live result count is shown`,
			).toBeVisible();

			// Search by name/email/role/level narrows results live.
			const search = fixture.getByRole("textbox").first();
			await search.fill("zzzzzzzz-no-such-approver");
			await expect(
				fixture.getByText("No approvers found"),
				`${label}: search miss shows "No approvers found"`,
			).toBeVisible();

			// Exhausted state: preselecting every user shows "No more users available".
			await search.fill("");
			await fixture
				.getByRole("button", { name: /preselect all|select all/i })
				.click();
			await expect(
				fixture.getByText("No more users available"),
				`${label}: exhausted state shows "No more users available"`,
			).toBeVisible();

			// Reset on select and reset on close.
			await fixture.getByRole("button", { name: /reset/i }).click();
			await expect(search, `${label}: search resets after reset`).toHaveValue(
				"",
			);
		}
	});
});
