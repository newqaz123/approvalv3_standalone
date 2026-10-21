import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const REQUIRED_BASE = "http://localhost:3100";
const LOCAL_PASSWORD = process.env.E2E_PASSWORD || "changeme";

/**
 * The unit-deactivation spec mutates the shared dev database (creates and
 * deactivates its own units), so it uses the same guarded direct connection
 * the approval-flow and C10 journey specs use: app_cleanstart_dev only, never
 * a protected or CI database.
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
			`unit-deactivation spec requires TEST_BASE_URL=${REQUIRED_BASE} (got ${String(process.env.TEST_BASE_URL)})`,
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

test.describe("clean-start unit deactivation", () => {
	/**
	 * Per-run unique suffix: every persistent row this spec creates (the unit)
	 * carries it, and cleanup is prefix-scoped so two consecutive runs both
	 * pass without reseeding (the C7/C8/C10 pattern: deactivate, never
	 * hard-delete). Sibling-name uniqueness applies to ACTIVE units only, so
	 * the deactivated history rows an earlier run left behind cannot collide.
	 */
	const RUN = `${process.pid.toString(36)}-${Date.now().toString(36)}`;
	const UNIT_NAME = `UnitDeact Removal #${RUN}`;
	const UNIT_PREFIX = "UnitDeact";

	/**
	 * Rerun isolation: deactivate any UnitDeact unit an earlier interrupted
	 * run left ACTIVE. Deactivation is the removal path; history is never
	 * deleted. Failures throw so a broken cleanup fails the run instead of
	 * poisoning the next one.
	 */
	async function deactivateLeftoverUnits(): Promise<void> {
		const prisma = prismaClient();
		try {
			await prisma.organization_units.updateMany({
				where: { name: { startsWith: UNIT_PREFIX }, isActive: true },
				data: { isActive: false },
			});
			expect(
				await prisma.organization_units.count({
					where: { name: { startsWith: UNIT_PREFIX }, isActive: true },
				}),
			).toBe(0);
		} finally {
			await prisma.$disconnect();
		}
	}

	test("create a unit under an active parent, deactivate it from the side panel, it disappears from the tree", async ({
		browser,
	}) => {
		test.setTimeout(180_000);
		await deactivateLeftoverUnits();
		const session = await openSignedIn(browser, EMAIL.admin);
		const page = session.page;
		try {
			await page.setViewportSize({ width: 1280, height: 720 });
			await page.goto("/admin/organization");
			await expect(page.getByTestId("organization-tree")).toBeVisible({ timeout: 20_000 });

			// The live dev database holds the owner's real units (the C10-era
			// cs-* seed is gone), so the parent is chosen dynamically: every active
			// unit is a legal parent and creating a child mutates nothing else.
			await page.getByTestId("create-unit-open").click();
			const dialog = page.getByTestId("create-unit-dialog");
			await expect(dialog).toBeVisible();
			await page.getByTestId("create-unit-name-input").fill(UNIT_NAME);
			await page.getByTestId("create-unit-parent-select").click();
			const parentOption = page.getByRole("option").first();
			const parentName = (await parentOption.textContent())?.trim() ?? "";
			expect(parentName.length).toBeGreaterThan(0);
			await parentOption.click();
			await page.getByTestId("create-unit-save").click();
			await expect(dialog).toHaveCount(0);

			const prisma = prismaClient();
			let unitId = "";
			let parentId = "";
			try {
				const created = await prisma.organization_units.findFirstOrThrow({
					where: { name: UNIT_NAME, isActive: true },
					select: { id: true, parentId: true },
				});
				expect(created.parentId).not.toBeNull();
				const parent = await prisma.organization_units.findUniqueOrThrow({
					where: { id: created.parentId as string },
					select: { name: true },
				});
				expect(parent.name).toBe(parentName);
				unitId = created.id;
				parentId = created.parentId as string;
			} finally {
				await prisma.$disconnect();
			}
			await expect(page.getByTestId(`unit-name-${unitId}`)).toBeVisible({ timeout: 15_000 });

			// Open the unit's side panel and start deactivation (confirmation step).
			const header = page.getByTestId(`unit-header-${unitId}`);
			await header.click();
			const panel = page.getByTestId("unit-side-panel");
			await expect(panel.getByRole("heading", { name: UNIT_NAME, exact: true })).toBeVisible();

			await page.getByTestId("unit-deactivate").click();
			const confirmation = page.getByTestId("unit-deactivate-confirmation");
			await expect(confirmation).toBeVisible();
			await expect(confirmation).toContainText(UNIT_NAME);
			await expect(page.getByTestId("unit-deactivate-cancel")).toBeVisible();

			await page.getByTestId("unit-deactivate-confirm").click();

			// Deactivate-not-delete in the UI: the unit row disappears from the tree.
			await expect(page.getByTestId(`unit-row-${unitId}`)).toHaveCount(0, { timeout: 15_000 });
			await expect(page.getByTestId("unit-side-panel")).toHaveCount(0);

			// Persistence is real in the database: isActive=false only, audit written.
			const verify = prismaClient();
			try {
				const row = await verify.organization_units.findUniqueOrThrow({
					where: { id: unitId },
					select: {
						isActive: true,
						name: true,
						parentId: true,
						managerUserId: true,
						shareRequests: true,
						canWorkOnSolutions: true,
					},
				});
				expect(row.isActive).toBe(false);
				expect(row.name).toBe(UNIT_NAME);
				expect(row.parentId).toBe(parentId);

				const admin = await verify.user.findFirstOrThrow({
					where: { email: EMAIL.admin },
					select: { id: true },
				});
				const activity = await verify.request_activities.findFirstOrThrow({
					where: {
						action: "organization_unit_deactivated",
						comments: { contains: unitId },
					},
					select: { userId: true, comments: true },
				});
				expect(activity.userId).toBe(admin.id);
				expect(activity.comments).toContain(UNIT_NAME);
			} finally {
				await verify.$disconnect();
			}
		} finally {
			try {
				// Isolate for the next run; a failure here fails the test.
				await deactivateLeftoverUnits();
			} finally {
				await session.context.close();
			}
		}
	});
});
