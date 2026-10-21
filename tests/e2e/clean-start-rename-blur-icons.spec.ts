import { expect, test, type Browser, type BrowserContext, type Page, type Route } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const REQUIRED_BASE = "http://localhost:3100";
const LOCAL_PASSWORD = process.env.E2E_PASSWORD || "changeme";

/**
 * The rename-blur/icons spec mutates the shared dev database (creates and
 * renames its own units and position), so it uses the same guarded direct
 * connection the approval-flow, unit-deactivation, and team-deactivation
 * specs use: app_cleanstart_dev only, never a protected or CI database. The
 * live dev database holds the owner's real organization; this spec touches
 * ONLY its own RenameBlur-prefixed fixture rows (never the owner's units,
 * positions, people, teams, or assignments).
 */
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
			`rename-blur spec requires TEST_BASE_URL=${REQUIRED_BASE} (got ${String(process.env.TEST_BASE_URL)})`,
		);
	}
	guardedDatabaseUrl();
});

const EMAIL = {
	admin: "admin@example.com",
} as const;

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
): Promise<{ context: BrowserContext; page: Page }> {
	const context = await browser.newContext();
	const page = await context.newPage();
	await signIn(page, email);
	return { context, page };
}

/** Rename audit rows naming one entity (unit or position id). */
async function renameAuditCount(entityId: string, action: string): Promise<number> {
	const prisma = prismaClient();
	try {
		return await prisma.request_activities.count({
			where: { action, comments: { contains: entityId } },
		});
	} finally {
		await prisma.$disconnect();
	}
}

/**
 * Holds rename server actions (POST + Next-Action header to the organization
 * admin page) at the network layer until the test releases them, so an
 * in-flight save stays pending while the test types a newer draft and blurs
 * (the review-P1 sequence). Non-action requests pass straight through. At
 * most one action is in flight at a time: the follow-up save is issued by the
 * component only AFTER the previous response is delivered, so a second
 * arrival before releasing proves a defect.
 */
class RenameActionGate {
	private readonly pendingReleases: Array<() => void> = []
	private arrived = 0
	private waiter: (() => void) | null = null
	private readonly seen = new Set<string>()

	async install(page: Page): Promise<void> {
		await page.route("**/admin/organization**", async (route) => {
			const request = route.request()
			// Only rename actions are held: they serialize an object argument
			// carrying "name" (renameOrganizationUnit/renameTeam/renamePosition).
			// Other page actions (unit selection, panel data loads) pass through.
			const isRename = (request.postData() ?? "").includes('"name":')
			if (request.method() !== "POST" || request.headers()["next-action"] === undefined || !isRename) {
				await route.continue()
				return
			}
			// Diagnostic trail: which action (and which serialized name argument) is held.
			console.log(
				`[gate] arrive #${this.arrived + 1} action=${request.headers()["next-action"]} post=${(request.postData() ?? "").slice(0, 200)}`,
			)
			// The network stack can re-pause an already-intercepted request; count
			// and hold each distinct request exactly once.
			const key = `${request.url()}|${request.headers()["next-action"]}|${request.postData() ?? ""}`
			if (this.seen.has(key)) {
				console.log("[gate] duplicate pause ignored")
				return
			}
			this.seen.add(key)
			this.arrived += 1
			if (this.waiter) {
				const wake = this.waiter
				this.waiter = null
				wake()
			}
			await new Promise<void>((resolve) => {
				this.pendingReleases.push(resolve)
			})
			try {
				await route.continue()
			} catch (error) {
				console.log(`[gate] continue failed: ${String(error)}`)
			}
		})
	}

	
	async waitFor(count: number, timeoutMs = 20_000): Promise<void> {
		const deadline = Date.now() + timeoutMs
		while (this.arrived < count) {
			const remaining = deadline - Date.now()
			if (remaining <= 0) {
				throw new Error(`rename gate: expected ${count} action(s), saw ${this.arrived}`)
			}
			await new Promise<void>((resolve) => {
				this.waiter = resolve
				setTimeout(resolve, remaining)
			})
		}
	}

	/** Release the oldest held action so the server processes it. */
	release(): void {
		const release = this.pendingReleases.shift()
		if (release) release()
	}

	/** Release every held action (failure-path cleanup so contexts can close). */
	releaseAll(): void {
		this.pendingReleases.splice(0).forEach((release) => release())
	}

	get arrivedCount(): number {
		return this.arrived
	}
}

async function openOrganizationPage(page: Page): Promise<void> {
	await page.setViewportSize({ width: 1280, height: 720 })
	await page.goto("/admin/organization")
	await expect(page.getByTestId("organization-tree")).toBeVisible({ timeout: 20_000 })
}

test.describe.serial("clean-start rename blur and tree flag icons", () => {
	/**
	 * Per-run unique suffix: every row this spec creates carries it, so two
	 * consecutive runs never collide on ACTIVE names (the C7/C10/
	 * unit-deactivation/team-deactivation pattern).
	 */
	const RUN = `${process.pid.toString(36)}-${Date.now().toString(36)}`;
	const UNIT_PREFIX = "RenameBlur Unit";
	const POSITION_PREFIX = "RenameBlur Position";
	const UNIT_A_NAME = `RenameBlur Unit Alpha ${RUN}`;
	const UNIT_B_NAME = `RenameBlur Unit Beta ${RUN}`;
	const POSITION_NAME = `RenameBlur Position ${RUN}`;

	let unitAId = "";
	let unitBId = "";
	let positionId = "";

	/**
	 * Rerun isolation (deactivate-only, prefix-scoped): leftover prefixed
	 * units and positions from earlier runs are deactivated, never deleted,
	 * and the owner's rows are never matched. Failures throw so a broken
	 * cleanup fails the run instead of poisoning the next one.
	 */
	async function deactivateLeftoverFixtures(): Promise<void> {
		const prisma = prismaClient();
		try {
			await prisma.organization_units.updateMany({
				where: { name: { startsWith: UNIT_PREFIX }, isActive: true },
				data: { isActive: false },
			});
			await prisma.positions.updateMany({
				where: { name: { startsWith: POSITION_PREFIX }, isActive: true },
				data: { isActive: false },
			});
			expect(
				await prisma.organization_units.count({
					where: { name: { startsWith: UNIT_PREFIX }, isActive: true },
				}),
			).toBe(0);
			expect(
				await prisma.positions.count({
					where: { name: { startsWith: POSITION_PREFIX }, isActive: true },
				}),
			).toBe(0);
		} finally {
			await prisma.$disconnect();
		}
	}

	test.beforeAll(async () => {
		await deactivateLeftoverFixtures();
		const prisma = prismaClient();
		try {
			// Parent is chosen dynamically among the owner's ACTIVE root units
			// (read-only); both fixture units share it so sibling-uniqueness
			// applies between them.
			const parent =
				(await prisma.organization_units.findFirst({
					where: { parentId: null, isActive: true },
					orderBy: { createdAt: "asc" },
					select: { id: true },
				})) ??
				(await prisma.organization_units.findFirstOrThrow({
					where: { isActive: true },
					orderBy: { createdAt: "asc" },
					select: { id: true },
				}));
			const unitA = await prisma.organization_units.create({
				data: {
					name: UNIT_A_NAME,
					parentId: parent.id,
					shareRequests: true,
					canWorkOnSolutions: true,
				},
				select: { id: true },
			});
			const unitB = await prisma.organization_units.create({
				data: {
					name: UNIT_B_NAME,
					parentId: parent.id,
					shareRequests: false,
					canWorkOnSolutions: false,
				},
				select: { id: true },
			});
			const maxRank = await prisma.positions.aggregate({
				where: { isActive: true },
				_max: { rank: true },
			});
			const position = await prisma.positions.create({
				data: { name: POSITION_NAME, rank: (maxRank._max.rank ?? 0) + 1 },
				select: { id: true },
			});
			unitAId = unitA.id;
			unitBId = unitB.id;
			positionId = position.id;
		} finally {
			await prisma.$disconnect();
		}
	});

	test.afterAll(async () => {
		await deactivateLeftoverFixtures();
	});

	async function unitName(id: string): Promise<string> {
		const prisma = prismaClient();
		try {
			const row = await prisma.organization_units.findUniqueOrThrow({
				where: { id },
				select: { name: true },
			});
			return row.name;
		} finally {
			await prisma.$disconnect();
		}
	}

	async function positionName(id: string): Promise<string> {
		const prisma = prismaClient();
		try {
			const row = await prisma.positions.findUniqueOrThrow({
				where: { id },
				select: { name: true },
			});
			return row.name;
		} finally {
			await prisma.$disconnect();
		}
	}

	async function startUnitRename(page: Page, unitId: string): Promise<void> {
		const header = page.getByTestId(`unit-header-${unitId}`);
		await header.hover();
		await page.getByTestId(`unit-rename-${unitId}`).click();
		await expect(header.getByTestId("inline-name-edit-input")).toBeVisible();
	}

	test("unit rename saves on blur via outside click, exactly one write", async ({ browser }) => {
		test.setTimeout(180_000);
		const baseline = await renameAuditCount(unitAId, "organization_unit_renamed");
		const session = await openSignedIn(browser, EMAIL.admin);
		const page = session.page;
		try {
			await page.setViewportSize({ width: 1280, height: 720 });
			await page.goto("/admin/organization");
			await expect(page.getByTestId("organization-tree")).toBeVisible({ timeout: 20_000 });

			const header = page.getByTestId(`unit-header-${unitAId}`);
			await expect(header).toBeVisible();
			await startUnitRename(page, unitAId);
			const input = header.getByTestId("inline-name-edit-input");
			const next = `RenameBlur Unit Blurred ${RUN}`;
			await input.fill(next);
			// Outside click: the page heading is far outside the input.
			await page.getByRole("heading", { name: "Organization & Approvals" }).click();
			await expect(header.getByTestId("inline-name-edit-input")).toHaveCount(0);
			await expect(page.getByTestId(`unit-name-${unitAId}`)).toContainText(next);
			expect(await unitName(unitAId)).toBe(next);
			expect(await renameAuditCount(unitAId, "organization_unit_renamed")).toBe(baseline + 1);
		} finally {
			await session.context.close();
		}
	});

	test("Enter saves without a duplicate blur write", async ({ browser }) => {
		test.setTimeout(180_000);
		const baseline = await renameAuditCount(unitAId, "organization_unit_renamed");
		const session = await openSignedIn(browser, EMAIL.admin);
		const page = session.page;
		try {
			await page.setViewportSize({ width: 1280, height: 720 });
			await page.goto("/admin/organization");
			await expect(page.getByTestId("organization-tree")).toBeVisible({ timeout: 20_000 });

			const header = page.getByTestId(`unit-header-${unitAId}`);
			await startUnitRename(page, unitAId);
			const input = header.getByTestId("inline-name-edit-input");
			const next = `RenameBlur Unit Entered ${RUN}`;
			await input.fill(next);
			await input.press("Enter");
			// The input unmounts on success without firing a second blur save.
			await expect(header.getByTestId("inline-name-edit-input")).toHaveCount(0);
			await expect(page.getByTestId(`unit-name-${unitAId}`)).toContainText(next);
			expect(await unitName(unitAId)).toBe(next);
			expect(await renameAuditCount(unitAId, "organization_unit_renamed")).toBe(baseline + 1);
		} finally {
			await session.context.close();
		}
	});

	test("Escape cancels and no later click resaves the canceled draft", async ({ browser }) => {
		test.setTimeout(180_000);
		const baseline = await renameAuditCount(unitAId, "organization_unit_renamed");
		const current = await unitName(unitAId);
		const session = await openSignedIn(browser, EMAIL.admin);
		const page = session.page;
		try {
			await page.setViewportSize({ width: 1280, height: 720 });
			await page.goto("/admin/organization");
			await expect(page.getByTestId("organization-tree")).toBeVisible({ timeout: 20_000 });

			const header = page.getByTestId(`unit-header-${unitAId}`);
			await startUnitRename(page, unitAId);
			const input = header.getByTestId("inline-name-edit-input");
			await input.fill(`RenameBlur Unit Escaped ${RUN}`);
			await input.press("Escape");
			await expect(header.getByTestId("inline-name-edit-input")).toHaveCount(0);
			await expect(page.getByTestId(`unit-name-${unitAId}`)).toContainText(current);
			// A click after the cancel must not resurrect or resave the draft.
			await page.getByRole("heading", { name: "Organization & Approvals" }).click();
			await expect(page.getByTestId(`unit-name-${unitAId}`)).toContainText(current);
			expect(await unitName(unitAId)).toBe(current);
			expect(await renameAuditCount(unitAId, "organization_unit_renamed")).toBe(baseline);
		} finally {
			await session.context.close();
		}
	});

	test("Tab blur with an unchanged value closes the editor without writing", async ({ browser }) => {
		test.setTimeout(180_000);
		const baseline = await renameAuditCount(unitAId, "organization_unit_renamed");
		const current = await unitName(unitAId);
		const session = await openSignedIn(browser, EMAIL.admin);
		const page = session.page;
		try {
			await page.setViewportSize({ width: 1280, height: 720 });
			await page.goto("/admin/organization");
			await expect(page.getByTestId("organization-tree")).toBeVisible({ timeout: 20_000 });

			const header = page.getByTestId(`unit-header-${unitAId}`);
			await startUnitRename(page, unitAId);
			const input = header.getByTestId("inline-name-edit-input");
			await expect(input).toHaveValue(current);
			await input.press("Tab");
			await expect(header.getByTestId("inline-name-edit-input")).toHaveCount(0);
			await expect(page.getByTestId(`unit-name-${unitAId}`)).toContainText(current);
			expect(await unitName(unitAId)).toBe(current);
			expect(await renameAuditCount(unitAId, "organization_unit_renamed")).toBe(baseline);
		} finally {
			await session.context.close();
		}
	});

	test("failed blur save retains the edited text and the adjacent error", async ({ browser }) => {
		test.setTimeout(180_000);
		const baseline = await renameAuditCount(unitAId, "organization_unit_renamed");
		const current = await unitName(unitAId);
		const session = await openSignedIn(browser, EMAIL.admin);
		const page = session.page;
		try {
			await page.setViewportSize({ width: 1280, height: 720 });
			await page.goto("/admin/organization");
			await expect(page.getByTestId("organization-tree")).toBeVisible({ timeout: 20_000 });

			const header = page.getByTestId(`unit-header-${unitAId}`);
			await startUnitRename(page, unitAId);
			const input = header.getByTestId("inline-name-edit-input");
			// Rename to the live sibling fixture's exact name: must be refused.
			await input.fill(UNIT_B_NAME);
			await page.getByRole("heading", { name: "Organization & Approvals" }).click();
			const error = header.getByTestId("inline-name-edit-error");
			await expect(error).toBeVisible();
			await expect(error).toContainText(/unique/i);
			// The edited text is retained in the still-open editor.
			await expect(header.getByTestId("inline-name-edit-input")).toBeVisible();
			await expect(header.getByTestId("inline-name-edit-input")).toHaveValue(UNIT_B_NAME);
			expect(await unitName(unitAId)).toBe(current);
			expect(await renameAuditCount(unitAId, "organization_unit_renamed")).toBe(baseline);
			// Refocus then Escape cleans the editor up.
			await header.getByTestId("inline-name-edit-input").click();
			await header.getByTestId("inline-name-edit-input").press("Escape");
			await expect(header.getByTestId("inline-name-edit-input")).toHaveCount(0);
			await expect(page.getByTestId(`unit-name-${unitAId}`)).toContainText(current);
		} finally {
			await session.context.close();
		}
	});

	test("tree shows sharing and wrench icons for enabled flags only, with names and tooltips", async ({ browser }) => {
		test.setTimeout(180_000);
		const session = await openSignedIn(browser, EMAIL.admin);
		const page = session.page;
		try {
			await page.setViewportSize({ width: 1280, height: 720 });
			await page.goto("/admin/organization");
			await expect(page.getByTestId("organization-tree")).toBeVisible({ timeout: 20_000 });

			// Enabled flags: unit A carries both icons with accessible names.
			const headerA = page.getByTestId(`unit-header-${unitAId}`);
			const sharingIcon = page.getByTestId(`sharing-badge-${unitAId}`);
			await expect(sharingIcon).toBeVisible();
			await expect(sharingIcon).toHaveAttribute("role", "img");
			await expect(sharingIcon).toHaveAttribute("aria-label", "Request sharing");
			const wrenchIcon = page.getByTestId(`solutions-badge-${unitAId}`);
			await expect(wrenchIcon).toBeVisible();
			await expect(wrenchIcon).toHaveAttribute("role", "img");
			await expect(wrenchIcon).toHaveAttribute("aria-label", "Can work on solutions");

			// Icon-only: the former badge words are no longer visible text.
			await expect(headerA).not.toContainText("Request sharing");
			await expect(headerA).not.toContainText("Can work on solutions");

			// Hover tooltip on the sharing icon.
			await sharingIcon.hover();
			await expect(page.getByRole("tooltip", { name: "Request sharing" })).toBeVisible();

			// Keyboard-focus tooltip on the wrench icon.
			await wrenchIcon.focus();
			await expect(page.getByRole("tooltip", { name: "Can work on solutions" })).toBeVisible();

			// Disabled flags: unit B renders neither icon.
			const headerB = page.getByTestId(`unit-header-${unitBId}`);
			await expect(headerB).toBeVisible();
			await expect(page.getByTestId(`sharing-badge-${unitBId}`)).toHaveCount(0);
			await expect(page.getByTestId(`solutions-badge-${unitBId}`)).toHaveCount(0);
		} finally {
			await session.context.close();
		}
	});

	test("Tab blur with a changed value saves exactly once", async ({ browser }) => {
		test.setTimeout(180_000)
		const baseline = await renameAuditCount(unitAId, "organization_unit_renamed")
		const session = await openSignedIn(browser, EMAIL.admin)
		const page = session.page
		try {
			await openOrganizationPage(page)

			const header = page.getByTestId(`unit-header-${unitAId}`)
			await startUnitRename(page, unitAId)
			const input = header.getByTestId("inline-name-edit-input")
			const next = `RenameBlur Unit Tabbed ${RUN}`
			await input.fill(next)
			await input.press("Tab")
			await expect(header.getByTestId("inline-name-edit-input")).toHaveCount(0)
			await expect(page.getByTestId(`unit-name-${unitAId}`)).toContainText(next)
			expect(await unitName(unitAId)).toBe(next)
			expect(await renameAuditCount(unitAId, "organization_unit_renamed")).toBe(baseline + 1)
		} finally {
			await session.context.close()
		}
	})

	test("keyboard Tab traversal focuses the flag icons and opens their tooltips", async ({ browser }) => {
		test.setTimeout(180_000)
		const session = await openSignedIn(browser, EMAIL.admin)
		const page = session.page
		try {
			await openOrganizationPage(page)

			const header = page.getByTestId(`unit-header-${unitAId}`)
			await expect(header).toBeVisible()
			// Genuine keyboard traversal: start from the focusable row header and
			// press Tab until the sharing icon itself receives focus.
			await header.focus()
			const sharingId = await (async (): Promise<string | null> => {
				for (let i = 0; i < 15; i += 1) {
				await page.keyboard.press("Tab")
				const testId = await page.evaluate(() =>
					document.activeElement?.getAttribute("data-testid") ?? null,
				)
				if (testId === `sharing-badge-${unitAId}`) return testId
			}
			return null
			})()
			expect(sharingId).toBe(`sharing-badge-${unitAId}`)
			await expect(page.getByRole("tooltip", { name: "Request sharing" })).toBeVisible()

			// One more genuine Tab reaches the wrench icon and its tooltip.
			await page.keyboard.press("Tab")
			const focused = await page.evaluate(() =>
				document.activeElement?.getAttribute("data-testid") ?? null,
			)
			expect(focused).toBe(`solutions-badge-${unitAId}`)
			await expect(page.getByRole("tooltip", { name: "Can work on solutions" })).toBeVisible()
		} finally {
			await session.context.close()
		}
	})

	test("deferred save: blur of a newer draft is submitted after B settles", async ({ browser }) => {
		test.setTimeout(180_000)
		const baseline = await renameAuditCount(unitAId, "organization_unit_renamed")
		const session = await openSignedIn(browser, EMAIL.admin)
		const page = session.page
		const gate = new RenameActionGate()
		try {
			await openOrganizationPage(page)
			await gate.install(page)

			const header = page.getByTestId(`unit-header-${unitAId}`)
			await startUnitRename(page, unitAId)
			const input = header.getByTestId("inline-name-edit-input")
			const bName = `RenameBlur Unit PendB ${RUN}`
			const cName = `RenameBlur Unit PendC ${RUN}`
			await input.fill(bName)
			await input.press("Enter")
			await gate.waitFor(1) // B is held in flight
			await input.fill(cName) // newer draft while B is pending
			await page.getByRole("heading", { name: "Organization & Approvals" }).click() // blur
			// The blurred newer draft stays visible with no error and no loss.
			await expect(header.getByTestId("inline-name-edit-input")).toHaveValue(cName)
			await expect(header.getByTestId("inline-name-edit-error")).toHaveCount(0)
			gate.release() // settle B successfully
			await gate.waitFor(2) // the queued C must be submitted
			gate.release() // settle C
			await expect(header.getByTestId("inline-name-edit-input")).toHaveCount(0)
			await expect(page.getByTestId(`unit-name-${unitAId}`)).toContainText(cName)
			expect(await unitName(unitAId)).toBe(cName)
			expect(await renameAuditCount(unitAId, "organization_unit_renamed")).toBe(baseline + 2)
		} finally {
			gate.releaseAll()
			await page.unroute("**/admin/organization**").catch(() => undefined)
			await session.context.close()
		}
	})

	test("deferred save: rejected B then queued C still saves C", async ({ browser }) => {
		test.setTimeout(180_000)
		const baseline = await renameAuditCount(unitAId, "organization_unit_renamed")
		const session = await openSignedIn(browser, EMAIL.admin)
		const page = session.page
		const gate = new RenameActionGate()
		try {
			await openOrganizationPage(page)
			await gate.install(page)

			const header = page.getByTestId(`unit-header-${unitAId}`)
			await startUnitRename(page, unitAId)
			const input = header.getByTestId("inline-name-edit-input")
			const cName = `RenameBlur Unit PendRejC ${RUN}`
			// B duplicates the live sibling fixture: the server must refuse it.
			await input.fill(UNIT_B_NAME)
			await input.press("Enter")
			await gate.waitFor(1)
			await input.fill(cName)
			await page.getByRole("heading", { name: "Organization & Approvals" }).click()
			gate.release() // settle B with a rejection
			await gate.waitFor(2) // the queued C is still submitted after the failure
			gate.release()
			await expect(header.getByTestId("inline-name-edit-input")).toHaveCount(0)
			await expect(page.getByTestId(`unit-name-${unitAId}`)).toContainText(cName)
			expect(await unitName(unitAId)).toBe(cName)
			// Only C wrote: the refused B produced no audit.
			expect(await renameAuditCount(unitAId, "organization_unit_renamed")).toBe(baseline + 1)
		} finally {
			gate.releaseAll()
			await page.unroute("**/admin/organization**").catch(() => undefined)
			await session.context.close()
		}
	})

	test("deferred save: latest failure retains the newer draft and the adjacent error", async ({ browser }) => {
		test.setTimeout(180_000)
		const baseline = await renameAuditCount(unitAId, "organization_unit_renamed")
		const session = await openSignedIn(browser, EMAIL.admin)
		const page = session.page
		const gate = new RenameActionGate()
		try {
			await openOrganizationPage(page)
			await gate.install(page)

			const header = page.getByTestId(`unit-header-${unitAId}`)
			await startUnitRename(page, unitAId)
			const input = header.getByTestId("inline-name-edit-input")
			const bName = `RenameBlur Unit PendFailB ${RUN}`
			await input.fill(bName)
			await input.press("Enter")
			await gate.waitFor(1)
			// The queued follow-up duplicates the live sibling: it must fail.
			await input.fill(UNIT_B_NAME)
			await page.getByRole("heading", { name: "Organization & Approvals" }).click()
			gate.release() // settle B successfully
			await gate.waitFor(2)
			gate.release() // settle C with a rejection
			const error = header.getByTestId("inline-name-edit-error")
			await expect(error).toBeVisible()
			await expect(error).toContainText(/unique/i)
			// The failed latest draft is retained in the still-open editor.
			await expect(header.getByTestId("inline-name-edit-input")).toBeVisible()
			await expect(header.getByTestId("inline-name-edit-input")).toHaveValue(UNIT_B_NAME)
			expect(await unitName(unitAId)).toBe(bName)
			expect(await renameAuditCount(unitAId, "organization_unit_renamed")).toBe(baseline + 1)
		} finally {
			gate.releaseAll()
			await page.unroute("**/admin/organization**").catch(() => undefined)
			await session.context.close()
		}
	})

	test("deferred save: Escape cancels the queued follow-up", async ({ browser }) => {
		test.setTimeout(180_000)
		const baseline = await renameAuditCount(unitAId, "organization_unit_renamed")
		const session = await openSignedIn(browser, EMAIL.admin)
		const page = session.page
		const gate = new RenameActionGate()
		try {
			await openOrganizationPage(page)
			await gate.install(page)

			const header = page.getByTestId(`unit-header-${unitAId}`)
			await startUnitRename(page, unitAId)
			const input = header.getByTestId("inline-name-edit-input")
			const bName = `RenameBlur Unit PendEsc ${RUN}`
			const cName = `RenameBlur Unit PendEscC ${RUN}`
			await input.fill(bName)
			await input.press("Enter")
			await gate.waitFor(1)
			await input.fill(cName)
			await page.getByRole("heading", { name: "Organization & Approvals" }).click() // blur queues C
			await input.press("Escape") // Escape invalidates the queued work
			await expect(header.getByTestId("inline-name-edit-input")).toHaveCount(0)
			gate.release() // the already-issued B write settles server-side
			// The queued C never submits: exactly one action was issued.
			await page.waitForTimeout(1_500)
			expect(gate.arrivedCount).toBe(1)
			expect(await unitName(unitAId)).toBe(bName)
			expect(await renameAuditCount(unitAId, "organization_unit_renamed")).toBe(baseline + 1)
		} finally {
			gate.releaseAll()
			await page.unroute("**/admin/organization**").catch(() => undefined)
			await session.context.close()
		}
	})

	test("deferred save: teardown drops the queued follow-up", async ({ browser }) => {
		test.setTimeout(180_000)
		const baseline = await renameAuditCount(unitAId, "organization_unit_renamed")
		const session = await openSignedIn(browser, EMAIL.admin)
		const page = session.page
		const gate = new RenameActionGate()
		try {
			await openOrganizationPage(page)
			await gate.install(page)

			const header = page.getByTestId(`unit-header-${unitAId}`)
			await startUnitRename(page, unitAId)
			const input = header.getByTestId("inline-name-edit-input")
			const bName = `RenameBlur Unit PendTear ${RUN}`
			const cName = `RenameBlur Unit PendTearC ${RUN}`
			await input.fill(bName)
			await input.press("Enter")
			await gate.waitFor(1)
			await input.fill(cName)
			await page.getByRole("heading", { name: "Organization & Approvals" }).click() // blur queues C
			// Soft-navigate away: the row (and its editor) unmounts with C queued.
			await page.getByRole("link", { name: "Admin Panel" }).click()
			await expect(page.getByTestId("organization-tree")).toHaveCount(0)
			gate.release() // the already-issued B write settles server-side
			await page.waitForTimeout(1_500)
			// Teardown invalidated the queued follow-up: C was never submitted.
			expect(gate.arrivedCount).toBe(1)
			expect(await unitName(unitAId)).toBe(bName)
			expect(await renameAuditCount(unitAId, "organization_unit_renamed")).toBe(baseline + 1)
		} finally {
			gate.releaseAll()
			await page.unroute("**/admin/organization**").catch(() => undefined)
			await session.context.close()
		}
	})

	test("deferred save: A to B and back to A writes back to A", async ({ browser }) => {
		test.setTimeout(180_000)
		const baseline = await renameAuditCount(unitAId, "organization_unit_renamed")
		const current = await unitName(unitAId)
		const session = await openSignedIn(browser, EMAIL.admin)
		const page = session.page
		const gate = new RenameActionGate()
		try {
			await openOrganizationPage(page)
			await gate.install(page)

			const header = page.getByTestId(`unit-header-${unitAId}`)
			await startUnitRename(page, unitAId)
			const input = header.getByTestId("inline-name-edit-input")
			const bName = `RenameBlur Unit PendBack ${RUN}`
			await input.fill(bName)
			await input.press("Enter")
			await gate.waitFor(1)
			// Return the draft to the original name, then blur: the reconciled
			// baseline (server holds B) must still force the write back to A.
			await input.fill(current)
			await page.getByRole("heading", { name: "Organization & Approvals" }).click()
			gate.release() // settle B
			await gate.waitFor(2) // the write back to the original must happen
			gate.release()
			await expect(header.getByTestId("inline-name-edit-input")).toHaveCount(0)
			await expect(page.getByTestId(`unit-name-${unitAId}`)).toContainText(current)
			expect(await unitName(unitAId)).toBe(current)
			expect(await renameAuditCount(unitAId, "organization_unit_renamed")).toBe(baseline + 2)
		} finally {
			gate.releaseAll()
			await page.unroute("**/admin/organization**").catch(() => undefined)
			await session.context.close()
		}
	})

	test("position rename saves on blur in the positions panel", async ({ browser }) => {
		test.setTimeout(180_000);
		const baseline = await renameAuditCount(positionId, "position_renamed");
		const session = await openSignedIn(browser, EMAIL.admin);
		const page = session.page;
		try {
			await page.setViewportSize({ width: 1280, height: 720 });
			await page.goto("/admin/organization?panel=positions");
			const panel = page.getByTestId("position-admin-panel");
			await expect(panel).toBeVisible({ timeout: 20_000 });

			const row = page.getByTestId(`position-row-${positionId}`);
			await expect(row).toBeVisible();
			await row.getByRole("button", { name: "Rename" }).click();
			const input = row.getByTestId("inline-name-edit-input");
			await expect(input).toBeVisible();
			const next = `RenameBlur Position Blurred ${RUN}`;
			await input.fill(next);
			await page.getByRole("heading", { name: "Organization & Approvals" }).click();
			await expect(row.getByTestId("inline-name-edit-input")).toHaveCount(0);
			await expect(row).toContainText(next);
			expect(await positionName(positionId)).toBe(next);
			expect(await renameAuditCount(positionId, "position_renamed")).toBe(baseline + 1);
		} finally {
			await session.context.close();
		}
	});
});
