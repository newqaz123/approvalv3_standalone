import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
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
