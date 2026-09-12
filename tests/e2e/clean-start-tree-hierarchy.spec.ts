import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const REQUIRED_BASE = "http://localhost:3100";
const COMPANY_ROOT_ID = "cs-unit-company";
const LOCAL_PASSWORD = process.env.E2E_PASSWORD || "changeme";
const EMAIL = { admin: "admin@example.com" } as const;

/**
 * Owned fixture family for the tree-hierarchy visuals. Every row carries the
 * TreeHx prefix (users/emails treehx-*) and a per-run suffix; cleanup is
 * prefix-scoped and deactivate-only, so two consecutive runs pass without
 * reseeding (C10 journey pattern). The hierarchy is parented under the SEEDED
 * clean-start company root, never under owner data, and never creates a
 * second active root (assertSingleAcyclicRoot invariant).
 */
const PREFIX = "TreeHx";

function guardedDatabaseUrl(): string {
	const url = process.env.DATABASE_URL ?? "";
	if (/app_db|app_org_manual_7abcdf3|app_cleanstart_ci/.test(url)) {
		throw new Error("URL-GUARD: refused protected or CI database");
	}
	if (!/\/app_cleanstart_dev(\?|$)/.test(url)) {
		throw new Error("URL-GUARD: DATABASE_URL must target app_cleanstart_dev only");
	}
	return url;
}

function prismaClient(): PrismaClient {
	return new PrismaClient({ datasources: { db: { url: guardedDatabaseUrl() } } });
}

test.beforeAll(() => {
	if (process.env.TEST_BASE_URL !== REQUIRED_BASE) {
		throw new Error(
			`tree-hierarchy specs require TEST_BASE_URL=${REQUIRED_BASE} (got ${String(process.env.TEST_BASE_URL)})`,
		);
	}
	guardedDatabaseUrl();
});

interface TreeHxIds {
	run: string;
	rootId: string;
	alphaId: string;
	betaId: string;
	alphaOneId: string;
	deepId: string;
	peerId: string;
	morganUserId: string;
	rileyUserId: string;
	squadId: string;
}

async function deactivateTreeHxFixtures(): Promise<void> {
	const prisma = prismaClient();
	try {
		await prisma.organization_assignments.updateMany({
			where: { user: { email: { startsWith: "treehx-" } }, isActive: true },
			data: { isActive: false, deactivatedAt: new Date() },
		});
		await prisma.teams.updateMany({
			where: { name: { startsWith: PREFIX }, isActive: true },
			data: { isActive: false },
		});
		await prisma.organization_units.updateMany({
			where: { name: { startsWith: PREFIX }, isActive: true },
			data: { isActive: false },
		});
		await prisma.user.updateMany({
			where: { email: { startsWith: "treehx-" }, isActive: true },
			data: { isActive: false },
		});
		expect(await prisma.organization_units.count({ where: { name: { startsWith: PREFIX }, isActive: true } })).toBe(0);
		expect(await prisma.teams.count({ where: { name: { startsWith: PREFIX }, isActive: true } })).toBe(0);
		expect(
			await prisma.organization_assignments.count({
				where: { user: { email: { startsWith: "treehx-" } }, isActive: true },
			}),
		).toBe(0);
		expect(await prisma.user.count({ where: { email: { startsWith: "treehx-" }, isActive: true } })).toBe(0);
	} finally {
		await prisma.$disconnect();
	}
}

async function createTreeHxFixtures(): Promise<TreeHxIds> {
	const run = `${process.pid.toString(36)}-${Date.now().toString(36)}`;
	const prisma = prismaClient();
	try {
		const manager = await prisma.positions.findUniqueOrThrow({
			where: { id: "cs-pos-manager" },
			select: { id: true },
		});
		const staff = await prisma.positions.findUniqueOrThrow({
			where: { id: "cs-pos-staff" },
			select: { id: true },
		});
		const morgan = await prisma.user.create({
			data: { email: `treehx-morgan-${run}@example.com`, name: `TreeHx Morgan ${run}` },
		});
		const casey = await prisma.user.create({
			data: { email: `treehx-casey-${run}@example.com`, name: `TreeHx Casey ${run}` },
		});
		const riley = await prisma.user.create({
			data: { email: `treehx-riley-${run}@example.com`, name: `TreeHx Riley ${run}` },
		});
		const root = await prisma.organization_units.create({
			data: { name: `TreeHx Root ${run}`, parentId: COMPANY_ROOT_ID },
		});
		const alpha = await prisma.organization_units.create({
			data: { name: `TreeHx Alpha ${run}`, parentId: root.id, shareRequests: true },
		});
		const beta = await prisma.organization_units.create({
			data: { name: `TreeHx Beta ${run}`, parentId: root.id, shareRequests: false, canWorkOnSolutions: true },
		});
		const alphaOne = await prisma.organization_units.create({
			data: { name: `TreeHx Alpha One ${run}`, parentId: alpha.id },
		});
		const deep = await prisma.organization_units.create({
			data: { name: `TreeHx Alpha One Deep ${run}`, parentId: alphaOne.id },
		});
		const peer = await prisma.organization_units.create({
			data: { name: `TreeHx Alpha One Peer ${run}`, parentId: alphaOne.id },
		});
		const morganAsg = await prisma.organization_assignments.create({
			data: { userId: morgan.id, unitId: alpha.id, positionId: manager.id },
		});
		const squad = await prisma.teams.create({
			data: { unitId: alpha.id, name: `TreeHx Squad ${run}`, reportsToAssignmentId: morganAsg.id },
		});
		await prisma.organization_assignments.create({
			data: { userId: casey.id, unitId: alpha.id, positionId: staff.id, teamId: squad.id },
		});
		await prisma.organization_assignments.create({
			data: { userId: riley.id, unitId: beta.id, positionId: staff.id },
		});
		return {
			run,
			rootId: root.id,
			alphaId: alpha.id,
			betaId: beta.id,
			alphaOneId: alphaOne.id,
			deepId: deep.id,
			peerId: peer.id,
			morganUserId: morgan.id,
			rileyUserId: riley.id,
			squadId: squad.id,
		};
	} finally {
		await prisma.$disconnect();
	}
}

async function signIn(page: Page, email: string): Promise<void> {
	await page.goto("/sign-in");
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(LOCAL_PASSWORD);
	await page.getByRole("button", { name: "Sign in" }).click();
	await page.waitForURL((url) => !url.pathname.includes("/sign-in"), { timeout: 20_000 });
}

async function openSignedIn(
	browser: Browser,
	email: string,
	viewport: { width: number; height: number },
): Promise<{ context: BrowserContext; page: Page }> {
	const context = await browser.newContext({ viewport });
	const page = await context.newPage();
	await signIn(page, email);
	await page.goto("/admin/organization");
	await expect(page.getByTestId("organization-tree")).toBeVisible({ timeout: 20_000 });
	return { context, page };
}

async function box(page: Page, testId: string) {
	const box = await page.getByTestId(testId).boundingBox();
	expect(box, `missing bounding box for ${testId}`).not.toBeNull();
	return box!;
}

async function unitNameInDb(unitId: string): Promise<string> {
	const prisma = prismaClient();
	try {
		const row = await prisma.organization_units.findUniqueOrThrow({
			where: { id: unitId },
			select: { name: true },
		});
		return row.name;
	} finally {
		await prisma.$disconnect();
	}
}

/**
 * Holds rename server actions (POST + Next-Action header whose serialized
 * arguments carry "name") at the network layer so an in-flight save stays
 * pending while the test queues a newer draft and collapses the containing
 * unit (review P1: collapse must not discard the queued follow-up save).
 * Non-action requests pass straight through. This gate is a TIMING tool
 * only: pass/fail claims about what was written come from the database
 * (unitNameInDb), never from this gate's arrival counts — the prior rename
 * spec's payload-dedupe conflates identical payloads and must not back a
 * duplicate-save claim (known P2).
 */
class TreeRenameGate {
	private readonly pendingReleases: Array<() => void> = [];
	private arrived = 0;
	private waiter: (() => void) | null = null;
	private readonly paused = new Set<string>();

	async install(page: Page): Promise<void> {
		await page.route("**/admin/organization**", async (route) => {
			const request = route.request();
			const isRename = (request.postData() ?? "").includes('"name":');
			if (request.method() !== "POST" || request.headers()["next-action"] === undefined || !isRename) {
				await route.continue();
				return;
			}
			// Guard only against the network stack re-pausing the same request;
			// every distinct request is held exactly once.
			const key = `${request.url()}|${request.headers()["next-action"] ?? ""}|${request.postData() ?? ""}`;
			if (this.paused.has(key)) return;
			this.paused.add(key);
			this.arrived += 1;
			if (this.waiter) {
				const wake = this.waiter;
				this.waiter = null;
				wake();
			}
			await new Promise<void>((resolve) => {
				this.pendingReleases.push(resolve);
			});
			try {
				await route.continue();
			} catch {
				// The context may already be closing during cleanup.
			}
		});
	}

	async waitFor(count: number, timeoutMs = 20_000): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		while (this.arrived < count) {
			const remaining = deadline - Date.now();
			if (remaining <= 0) {
				throw new Error(`tree rename gate: expected ${count} action(s), saw ${this.arrived}`);
			}
			await new Promise<void>((resolve) => {
				this.waiter = resolve;
				setTimeout(resolve, remaining);
			});
		}
	}

	/** Release the oldest held action so the server processes it. */
	release(): void {
		this.pendingReleases.shift()?.();
	}

	/** Release every held action (failure-path cleanup so contexts can close). */
	releaseAll(): void {
		this.pendingReleases.splice(0).forEach((release) => release());
	}
}

test.describe("clean-start tree hierarchy visuals", () => {
	let ids: TreeHxIds;

	test.beforeAll(async () => {
		await deactivateTreeHxFixtures();
		ids = await createTreeHxFixtures();
	});

	test.afterAll(async () => {
		await deactivateTreeHxFixtures();
	});

	test("desktop: connectors/indentation mark unit ancestry; people and teams stay distinct; sibling branches get space", async ({
		browser,
	}) => {
		test.setTimeout(120_000);
		const session = await openSignedIn(browser, EMAIL.admin, { width: 1280, height: 720 });
		const page = session.page;
		try {
			await expect(page.getByTestId(`unit-row-${ids.rootId}`)).toBeVisible({ timeout: 20_000 });

			// Stronger indentation at every arbitrary level: each child header
			// starts clearly right of its parent header.
			const rootHeader = await box(page, `unit-header-${ids.rootId}`);
			const alphaHeader = await box(page, `unit-header-${ids.alphaId}`);
			const alphaOneHeader = await box(page, `unit-header-${ids.alphaOneId}`);
			const deepHeader = await box(page, `unit-header-${ids.deepId}`);
			expect(alphaHeader.x - rootHeader.x).toBeGreaterThanOrEqual(20);
			expect(alphaOneHeader.x - alphaHeader.x).toBeGreaterThanOrEqual(20);
			expect(deepHeader.x - alphaOneHeader.x).toBeGreaterThanOrEqual(20);
			expect(deepHeader.x - rootHeader.x).toBeGreaterThanOrEqual(60);

			// Connector rail + per-child ticks exist for unit ancestry.
			const childrenClass = await page.getByTestId(`unit-children-${ids.alphaId}`).getAttribute("class");
			expect(childrenClass ?? "").toMatch(/border-l/);
			await expect(page.getByTestId(`unit-connector-${ids.alphaOneId}`)).toBeAttached();

			// Sibling branches (Alpha subtree end -> Beta header) are separated
			// by real vertical space without taller rows.
			const peerRow = await box(page, `unit-row-${ids.peerId}`);
			const betaHeader = await box(page, `unit-header-${ids.betaId}`);
			expect(betaHeader.y - (peerRow.y + peerRow.height)).toBeGreaterThanOrEqual(20);

			// Units vs people/teams: the unit band differs from person chips;
			// people live in unit-people, child units in unit-children; the team
			// nests under its reports-to person (person-once), never in the
			// ancestry rail.
			const alphaPeople = page.getByTestId(`unit-people-${ids.alphaId}`);
			const alphaChildren = page.getByTestId(`unit-children-${ids.alphaId}`);
			await expect(alphaPeople.getByTestId(`person-chip-${ids.morganUserId}`)).toBeVisible();
			await expect(alphaPeople).toContainText(`TreeHx Morgan ${ids.run} — Manager`);
			await expect(alphaPeople.getByTestId(`unit-row-${ids.alphaOneId}`)).toHaveCount(0);
			await expect(alphaChildren.getByTestId(`unit-row-${ids.alphaOneId}`)).toBeVisible();
			await expect(alphaChildren.getByTestId(`person-chip-${ids.morganUserId}`)).toHaveCount(0);
			const morganChip = page.getByTestId(`person-chip-${ids.morganUserId}`);
			await expect(morganChip).toHaveCount(1);
			await expect(morganChip.getByTestId(`team-group-${ids.squadId}`)).toBeVisible();
			await expect(morganChip.getByTestId(`team-group-${ids.squadId}`)).toContainText(`TreeHx Casey ${ids.run} — Staff`);
			await expect(alphaChildren.getByTestId(`team-group-${ids.squadId}`)).toHaveCount(0);

			// Flag badges distinguish units too: sharing on Alpha, solutions on Beta.
			await expect(page.getByTestId(`sharing-badge-${ids.alphaId}`)).toBeVisible();
			await expect(page.getByTestId(`solutions-badge-${ids.betaId}`)).toBeVisible();
			await expect(page.getByTestId(`sharing-badge-${ids.betaId}`)).toHaveCount(0);
		} finally {
			await session.context.close();
		}
	});

	test("expand/collapse chevrons: aria-expanded toggle hides and restores subtree content, mouse and keyboard", async ({
		browser,
	}) => {
		test.setTimeout(120_000);
		const session = await openSignedIn(browser, EMAIL.admin, { width: 1280, height: 720 });
		const page = session.page;
		try {
			await expect(page.getByTestId(`unit-row-${ids.rootId}`)).toBeVisible({ timeout: 20_000 });
			const alphaToggle = page.getByTestId(`unit-toggle-${ids.alphaId}`);
			await expect(alphaToggle).toBeVisible();
			await expect(alphaToggle).toHaveAttribute("aria-expanded", "true");
			await expect(alphaToggle).toHaveAccessibleName(new RegExp(`^Collapse TreeHx Alpha ${ids.run}$`));

			// Click collapse: people, team, and child units all disappear; the
			// unit header stays.
			await alphaToggle.click();
			await expect(alphaToggle).toHaveAttribute("aria-expanded", "false");
			await expect(alphaToggle).toHaveAccessibleName(new RegExp(`^Expand TreeHx Alpha ${ids.run}$`));
			await expect(page.getByTestId(`unit-people-${ids.alphaId}`)).toBeHidden();
			await expect(page.getByTestId(`unit-children-${ids.alphaId}`)).toBeHidden();
			await expect(page.getByTestId(`person-chip-${ids.morganUserId}`)).toBeHidden();
			await expect(page.getByTestId(`unit-row-${ids.alphaOneId}`)).toBeHidden();
			await expect(page.getByTestId(`unit-header-${ids.alphaId}`)).toBeVisible();

			// Keyboard expand (Enter), then keyboard collapse (Space).
			await alphaToggle.focus();
			await alphaToggle.press("Enter");
			await expect(page.getByTestId(`unit-children-${ids.alphaId}`)).toBeVisible();
			await expect(alphaToggle).toHaveAttribute("aria-expanded", "true");
			await alphaToggle.press("Space");
			await expect(page.getByTestId(`unit-children-${ids.alphaId}`)).toBeHidden();

			// Collapsing an ancestor hides the whole deep branch too.
			const rootToggle = page.getByTestId(`unit-toggle-${ids.rootId}`);
			await rootToggle.click();
			await expect(page.getByTestId(`unit-row-${ids.alphaId}`)).toBeHidden();
			await expect(page.getByTestId(`unit-row-${ids.deepId}`)).toBeHidden();
			await rootToggle.click();
			// Stable entity identity: alpha's own collapsed state SURVIVES the
			// ancestor round-trip (hidden, never unmounted, so no remount reset).
			await expect(page.getByTestId(`unit-row-${ids.alphaId}`)).toBeVisible();
			await expect(alphaToggle).toHaveAttribute("aria-expanded", "false");
			await expect(page.getByTestId(`unit-row-${ids.deepId}`)).toBeHidden();
			await alphaToggle.click();
			await expect(page.getByTestId(`unit-row-${ids.deepId}`)).toBeVisible();

			// Leaf units without people render no chevron at all.
			await expect(page.getByTestId(`unit-toggle-${ids.deepId}`)).toHaveCount(0);

			// A people-only unit still collapses (Beta hides Riley).
			const betaToggle = page.getByTestId(`unit-toggle-${ids.betaId}`);
			await betaToggle.click();
			await expect(page.getByTestId(`person-chip-${ids.rileyUserId}`)).toBeHidden();
			await betaToggle.click();
			await expect(page.getByTestId(`person-chip-${ids.rileyUserId}`)).toBeVisible();
		} finally {
			await session.context.close();
		}
	});

	test("rename, manage, and tooltip focus never activate the toggle; blur-save still works beside it", async ({
		browser,
	}) => {
		test.setTimeout(120_000);
		const session = await openSignedIn(browser, EMAIL.admin, { width: 1280, height: 720 });
		const page = session.page;
		try {
			await expect(page.getByTestId(`unit-row-${ids.rootId}`)).toBeVisible({ timeout: 20_000 });
			const header = page.getByTestId(`unit-header-${ids.alphaId}`);
			const toggle = page.getByTestId(`unit-toggle-${ids.alphaId}`);
			const renamed = `TreeHx Alpha Renamed ${ids.run}`;

			// Escape rename keeps the branch expanded (rename keys never toggle).
			await header.hover();
			await page.getByTestId(`unit-rename-${ids.alphaId}`).click();
			const input = header.getByTestId("inline-name-edit-input");
			await expect(input).toBeVisible();
			await input.click({ clickCount: 3 });
			await input.pressSequentially("Discard This", { delay: 15 });
			await input.press("Escape");
			await expect(header.getByTestId("inline-name-edit-input")).toHaveCount(0);
			await expect(toggle).toHaveAttribute("aria-expanded", "true");
			await expect(page.getByTestId(`unit-children-${ids.alphaId}`)).toBeVisible();

			// Enter-save renames through the real server action (prefix kept so
			// cleanup stays scoped) and the branch stays expanded.
			await header.hover();
			await page.getByTestId(`unit-rename-${ids.alphaId}`).click();
			const saveInput = header.getByTestId("inline-name-edit-input");
			await saveInput.click({ clickCount: 3 });
			await saveInput.pressSequentially(renamed, { delay: 15 });
			await saveInput.press("Enter");
			await expect(page.getByTestId(`unit-name-${ids.alphaId}`)).toContainText(renamed, { timeout: 15_000 });
			await expect(header.getByTestId("inline-name-edit-input")).toHaveCount(0);
			await expect(toggle).toHaveAttribute("aria-expanded", "true");

			// Focus the flag icon tooltip: the tooltip opens and the branch does
			// not collapse (keyboard focus never activates the toggle).
			await page.getByTestId(`sharing-badge-${ids.alphaId}`).focus();
			await expect(page.getByRole("tooltip", { name: "Request sharing" })).toBeVisible();
			await expect(toggle).toHaveAttribute("aria-expanded", "true");
			await expect(page.getByTestId(`unit-children-${ids.alphaId}`)).toBeVisible();

			// Manage opens the side panel; the toggle still works and the panel
			// stays open (selection is independent of collapse state).
			await header.click();
			await expect(page.getByTestId("unit-side-panel")).toBeVisible();
			await expect(page.getByTestId("unit-side-panel").getByRole("heading", { name: `Manage ${renamed}` })).toBeVisible();
			await toggle.click();
			await expect(page.getByTestId(`unit-children-${ids.alphaId}`)).toBeHidden();
			await expect(page.getByTestId("unit-side-panel")).toBeVisible();
			await toggle.click();
			await expect(page.getByTestId(`unit-children-${ids.alphaId}`)).toBeVisible();
			await expect(page.getByTestId("unit-side-panel")).toBeVisible();
		} finally {
			await session.context.close();
		}
	});

	test("hover and keyboard-focus controls never shift row geometry (no dropped lines)", async ({
		browser,
	}) => {
		test.setTimeout(120_000);
		const session = await openSignedIn(browser, EMAIL.admin, { width: 1280, height: 720 });
		const page = session.page;
		try {
			await expect(page.getByTestId(`unit-row-${ids.rootId}`)).toBeVisible({ timeout: 20_000 });
			const header = page.getByTestId(`unit-header-${ids.alphaId}`);
			const manage = page.getByTestId(`unit-manage-${ids.alphaId}`);
			const rename = page.getByTestId(`unit-rename-${ids.alphaId}`);

			// Rest geometry: the header band, its own people block, the ancestry
			// rail, and the NEXT sibling branch header must all be pixel-stable
			// while hover/focus controls appear. Scroll first so hover() itself
			// cannot change the captured viewport-relative boxes.
			await page.getByTestId(`unit-header-${ids.alphaId}`).scrollIntoViewIfNeeded();
			await page.waitForTimeout(150);
			const rest = {
				header: await box(page, `unit-header-${ids.alphaId}`),
				people: await box(page, `unit-people-${ids.alphaId}`),
				children: await box(page, `unit-children-${ids.alphaId}`),
				nextBranch: await box(page, `unit-header-${ids.betaId}`),
			};

			await header.hover();
			await expect(manage).toBeVisible();
			await expect(rename).toBeVisible();
			expect(await box(page, `unit-header-${ids.alphaId}`)).toEqual(rest.header);
			expect(await box(page, `unit-people-${ids.alphaId}`)).toEqual(rest.people);
			expect(await box(page, `unit-children-${ids.alphaId}`)).toEqual(rest.children);
			expect(await box(page, `unit-header-${ids.betaId}`)).toEqual(rest.nextBranch);

			// Move the pointer to an adjacent in-view element (no page scroll),
			// then keyboard-focus the header: same guarantee.
			await page.getByTestId(`unit-people-${ids.alphaId}`).hover();
			await expect(manage).toBeHidden();
			expect(await box(page, `unit-header-${ids.alphaId}`)).toEqual(rest.header);
			await header.focus();
			await expect(manage).toBeVisible();
			await expect(rename).toBeVisible();
			expect(await box(page, `unit-header-${ids.alphaId}`)).toEqual(rest.header);
			expect(await box(page, `unit-people-${ids.alphaId}`)).toEqual(rest.people);
			expect(await box(page, `unit-children-${ids.alphaId}`)).toEqual(rest.children);
			expect(await box(page, `unit-header-${ids.betaId}`)).toEqual(rest.nextBranch);
		} finally {
			await session.context.close();
		}
	});

	test("narrow viewport: deep rows wrap instead of overflowing horizontally; touch taps still collapse", async ({
		browser,
	}) => {
		test.setTimeout(120_000);
		const session = await openSignedIn(browser, EMAIL.admin, { width: 390, height: 844 });
		const page = session.page;
		try {
			await expect(page.getByTestId(`unit-row-${ids.deepId}`)).toBeVisible({ timeout: 20_000 });
			const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
			expect(scrollWidth).toBeLessThanOrEqual(391);

			const toggle = page.getByTestId(`unit-toggle-${ids.alphaId}`);
			await expect(toggle).toBeVisible();
			await toggle.click();
			await expect(page.getByTestId(`unit-children-${ids.alphaId}`)).toBeHidden();
			await expect(page.getByTestId(`unit-row-${ids.deepId}`)).toBeHidden();
			await toggle.click();
			await expect(page.getByTestId(`unit-row-${ids.deepId}`)).toBeVisible();
			const scrollWidthAfter = await page.evaluate(() => document.documentElement.scrollWidth);
			expect(scrollWidthAfter).toBeLessThanOrEqual(391);
		} finally {
			await session.context.close();
		}
	});

	test("reserved action area: hover/focus actions never cover long names, flags, or the rename input", async ({
		browser,
	}) => {
		test.setTimeout(180_000);
		// A genuinely long unit name, created through the real rename flow and
		// kept under the owned TreeHx prefix, exercises the reserved action space.
		const longName = `TreeHx Deep Long-Name ${
			"Quadrant Northwest Production Planning and Solutions Engineering ".repeat(3)
		}${ids.run}`;
		for (const width of [1280, 1024]) {
			const session = await openSignedIn(browser, EMAIL.admin, { width, height: 720 });
			const page = session.page;
			try {
				await expect(page.getByTestId(`unit-row-${ids.rootId}`)).toBeVisible({ timeout: 20_000 });
				if (width === 1280) {
					const setupHeader = page.getByTestId(`unit-header-${ids.deepId}`);
					await setupHeader.hover();
					await page.getByTestId(`unit-rename-${ids.deepId}`).click();
					const setupInput = setupHeader.getByTestId("inline-name-edit-input");
					await setupInput.fill(longName);
					await setupInput.press("Enter");
					await expect(page.getByTestId(`unit-name-${ids.deepId}`)).toContainText(longName, { timeout: 15_000 });
					await expect(setupHeader.getByTestId("inline-name-edit-input")).toHaveCount(0);
				}

				const header = page.getByTestId(`unit-header-${ids.deepId}`);
				await header.scrollIntoViewIfNeeded();
				await page.waitForTimeout(150);
				const headerBox = await box(page, `unit-header-${ids.deepId}`);
				// The action area is permanently reserved in flow: at rest (no hover)
				// it already owns its space and must not overlap the long name.
				const nameRest = await box(page, `unit-name-${ids.deepId}`);
				const actionsRest = await box(page, `unit-hover-actions-${ids.deepId}`);
				expect(nameRest.x + nameRest.width).toBeLessThanOrEqual(actionsRest.x + 0.5);
				// Reserved space lives inside the header band: never clipped.
				expect(actionsRest.x).toBeGreaterThanOrEqual(headerBox.x);
				expect(actionsRest.x + actionsRest.width).toBeLessThanOrEqual(headerBox.x + headerBox.width + 0.5);

				// Hover reveals the controls in place: no geometry change and still
				// no overlap with the long name.
				await header.hover();
				await expect(page.getByTestId(`unit-rename-${ids.deepId}`)).toBeVisible();
				await expect(page.getByTestId(`unit-manage-${ids.deepId}`)).toBeVisible();
				expect(await box(page, `unit-name-${ids.deepId}`)).toEqual(nameRest);
				expect(await box(page, `unit-hover-actions-${ids.deepId}`)).toEqual(actionsRest);
				const manageBox = await page.getByTestId(`unit-manage-${ids.deepId}`).boundingBox();
				expect(manageBox, "Manage button must have a box").not.toBeNull();
				expect(manageBox!.x).toBeGreaterThanOrEqual(headerBox.x);
				expect(manageBox!.x + manageBox!.width).toBeLessThanOrEqual(headerBox.x + headerBox.width + 0.5);

					// Flag icons never sit under the actions either (Alpha carries one).
					await page.getByTestId(`unit-header-${ids.alphaId}`).hover();
				await expect(page.getByTestId(`unit-hover-actions-${ids.alphaId}`)).toBeVisible();
				const flagBox = await box(page, `sharing-badge-${ids.alphaId}`);
				const alphaActions = await box(page, `unit-hover-actions-${ids.alphaId}`);
				expect(flagBox.x + flagBox.width).toBeLessThanOrEqual(alphaActions.x + 0.5);

				// Editing stays usable beside the reserved area: the input never
				// extends under the actions strip (focus-within reveals it).
				await header.hover();
				await page.getByTestId(`unit-rename-${ids.deepId}`).click();
				const input = header.getByTestId("inline-name-edit-input");
				await expect(input).toBeVisible();
				const inputBox = await input.boundingBox();
				expect(inputBox, "rename input must have a box").not.toBeNull();
				const actionsDuringEdit = await box(page, `unit-hover-actions-${ids.deepId}`);
				expect(inputBox!.x + inputBox!.width).toBeLessThanOrEqual(actionsDuringEdit.x + 0.5);
				// Real keystrokes land in the input while focus-within keeps the
				// actions strip revealed (fill leaves the caret at the end, so
				// typing appends deterministically).
				await input.fill(`TreeHx Deep Edit ${ids.run}`);
				await input.pressSequentially(" Ok", { delay: 10 });
				await expect(input).toHaveValue(`TreeHx Deep Edit ${ids.run} Ok`);
				await input.press("Escape");
				await expect(header.getByTestId("inline-name-edit-input")).toHaveCount(0);
				await expect(page.getByTestId(`unit-name-${ids.deepId}`)).toContainText(longName);
			} finally {
				await session.context.close();
			}
		}
	});

	test("genuine coarse-pointer touch: overflow menu is the action area, real taps operate it", async ({ browser }) => {
		test.setTimeout(120_000);
		// Genuine touch context (hasTouch + mobile emulation), not a
		// viewport-only click claim: the page itself reports pointer: coarse.
		const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
		const page = await context.newPage();
		try {
			await signIn(page, EMAIL.admin);
			await page.goto("/admin/organization");
			await expect(page.getByTestId("organization-tree")).toBeVisible({ timeout: 20_000 });
			expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);

			// Coarse pointer: the hover strip is display:none; the overflow menu
			// owns the action area instead.
			await expect(page.getByTestId(`unit-hover-actions-${ids.alphaId}`)).toBeHidden();
			const overflow = page.getByTestId(`unit-overflow-${ids.alphaId}`);
			await expect(overflow).toBeVisible();

			// Real taps drive rename through the overflow menu.
			await overflow.tap();
			await expect(page.getByRole("menuitem", { name: "Rename" })).toBeVisible();
			await page.getByRole("menuitem", { name: "Rename" }).tap();
			const header = page.getByTestId(`unit-header-${ids.alphaId}`);
			const input = header.getByTestId("inline-name-edit-input");
			await expect(input).toBeVisible();
			await input.tap();
			await input.press("Escape");
			await expect(header.getByTestId("inline-name-edit-input")).toHaveCount(0);

			// The long-named deep row wraps inside the narrow viewport.
			const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
			expect(scrollWidth).toBeLessThanOrEqual(391);

			// Real tap on the chevron collapses and re-expands the branch.
			const toggle = page.getByTestId(`unit-toggle-${ids.alphaId}`);
			await toggle.tap();
			await expect(page.getByTestId(`unit-children-${ids.alphaId}`)).toBeHidden();
			await toggle.tap();
			await expect(page.getByTestId(`unit-row-${ids.deepId}`)).toBeVisible();
		} finally {
			await context.close();
		}
	});

	test("deferred save: collapsing the containing unit keeps the queued rename; C persists", async ({ browser }) => {
		test.setTimeout(180_000);
		const session = await openSignedIn(browser, EMAIL.admin, { width: 1280, height: 720 });
		const page = session.page;
		const gate = new TreeRenameGate();
		try {
			const header = page.getByTestId(`unit-header-${ids.deepId}`);
			await expect(header).toBeVisible({ timeout: 20_000 });
			await gate.install(page);

			await header.hover();
			await page.getByTestId(`unit-rename-${ids.deepId}`).click();
			const input = header.getByTestId("inline-name-edit-input");
			const bName = `TreeHx Deep PendB ${ids.run}`;
			const cName = `TreeHx Deep PendC ${ids.run}`;
			await input.fill(bName);
			await input.press("Enter");
			await gate.waitFor(1); // B is held in flight
			await input.fill(cName); // newer draft while B is pending
			await page.getByRole("heading", { name: "Organization & Approvals" }).click(); // blur queues C
			// Collapse the containing unit BEFORE B settles: the hidden editor
			// must keep the queued follow-up alive instead of tearing it down.
			await page.getByTestId(`unit-toggle-${ids.alphaId}`).click();
			await expect(page.getByTestId(`unit-toggle-${ids.alphaId}`)).toHaveAttribute("aria-expanded", "false");
			gate.release(); // settle B successfully
			await gate.waitFor(2); // the queued C must still be submitted
			gate.release(); // settle C
			// Server truth: the queued C was persisted, not just painted.
			expect(await unitNameInDb(ids.deepId)).toBe(cName);
			// Re-expanding shows the settled name with the editor closed.
			await page.getByTestId(`unit-toggle-${ids.alphaId}`).click();
			await expect(page.getByTestId(`unit-name-${ids.deepId}`)).toContainText(cName);
			await expect(header.getByTestId("inline-name-edit-input")).toHaveCount(0);
		} finally {
			gate.releaseAll();
			await page.unroute("**/admin/organization**").catch(() => undefined);
			await session.context.close();
		}
	});

	test("deferred save: rejection under collapse retains the draft and error after re-expand", async ({ browser }) => {
		test.setTimeout(180_000);
		const session = await openSignedIn(browser, EMAIL.admin, { width: 1280, height: 720 });
		const page = session.page;
		const gate = new TreeRenameGate();
		try {
			const header = page.getByTestId(`unit-header-${ids.deepId}`);
			await expect(header).toBeVisible({ timeout: 20_000 });
			await gate.install(page);

			await header.hover();
			await page.getByTestId(`unit-rename-${ids.deepId}`).click();
			const input = header.getByTestId("inline-name-edit-input");
			const bName = `TreeHx Deep PendRejB ${ids.run}`;
			// The queued follow-up duplicates deep's live sibling: the server
			// must refuse it, and the refusal must surface after re-expand.
			const refusedName = `TreeHx Alpha One Peer ${ids.run}`;
			await input.fill(bName);
			await input.press("Enter");
			await gate.waitFor(1);
			await input.fill(refusedName);
			await page.getByRole("heading", { name: "Organization & Approvals" }).click();
			await page.getByTestId(`unit-toggle-${ids.alphaId}`).click();
			await expect(page.getByTestId(`unit-toggle-${ids.alphaId}`)).toHaveAttribute("aria-expanded", "false");
			gate.release(); // settle B successfully
			await gate.waitFor(2); // queued C submitted even under collapse
			gate.release(); // C settles with a rejection
			expect(await unitNameInDb(ids.deepId)).toBe(bName);
			await page.getByTestId(`unit-toggle-${ids.alphaId}`).click();
			const error = header.getByTestId("inline-name-edit-error");
			await expect(error).toBeVisible();
			await expect(error).toContainText(/unique/i);
			await expect(header.getByTestId("inline-name-edit-input")).toHaveValue(refusedName);
			// Cleanup: close the retained editor so later state is clean.
			await header.getByTestId("inline-name-edit-input").click();
			await header.getByTestId("inline-name-edit-input").press("Escape");
			await expect(header.getByTestId("inline-name-edit-input")).toHaveCount(0);
		} finally {
			gate.releaseAll();
			await page.unroute("**/admin/organization**").catch(() => undefined);
			await session.context.close();
		}
	});

	test("collapsed branch content is hidden and unreachable by keyboard focus", async ({ browser }) => {
		test.setTimeout(120_000);
		const session = await openSignedIn(browser, EMAIL.admin, { width: 1280, height: 720 });
		const page = session.page;
		try {
			await expect(page.getByTestId(`unit-row-${ids.rootId}`)).toBeVisible({ timeout: 20_000 });
			const toggle = page.getByTestId(`unit-toggle-${ids.alphaId}`);
			await toggle.click();
			await expect(toggle).toHaveAttribute("aria-expanded", "false");
			// Collapsed content is hidden (not merely transparent) and the unit
			// header stays put.
			await expect(page.getByTestId(`unit-people-${ids.alphaId}`)).toBeHidden();
			await expect(page.getByTestId(`unit-children-${ids.alphaId}`)).toBeHidden();
			await expect(page.getByTestId(`unit-toggle-${ids.alphaOneId}`)).toBeHidden();
			await expect(page.getByTestId(`unit-header-${ids.alphaId}`)).toBeVisible();

			// Programmatic focus cannot land inside the hidden subtree.
			await page.evaluate((teamId) => {
				const el = document.querySelector(`[data-testid="team-select-${teamId}"]`);
				(el as HTMLElement | null)?.focus();
			}, ids.squadId);
			const afterProgrammatic = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
			expect(afterProgrammatic).not.toBe(`team-select-${ids.squadId}`);

			// Genuine Tab traversal skips the hidden subtree entirely.
			await page.getByTestId(`unit-header-${ids.alphaId}`).focus();
			for (let step = 0; step < 25; step += 1) {
				await page.keyboard.press("Tab");
				const inside = await page.evaluate(([peopleId, childrenId]) => {
					const el = document.activeElement;
					if (!el) return false;
					const people = document.querySelector(`[data-testid="${peopleId}"]`);
					const children = document.querySelector(`[data-testid="${childrenId}"]`);
					return !!((people && people.contains(el)) || (children && children.contains(el)));
				}, [`unit-people-${ids.alphaId}`, `unit-children-${ids.alphaId}`]);
				expect(inside, `Tab step ${step} focused inside the collapsed subtree`).toBe(false);
			}

			// Re-expand restores visibility and focusability.
			await toggle.click();
			await expect(page.getByTestId(`unit-toggle-${ids.alphaOneId}`)).toBeVisible();
		} finally {
			await session.context.close();
		}
	});
});
