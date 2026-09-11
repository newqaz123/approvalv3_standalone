import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const REQUIRED_BASE = "http://localhost:3100";
const LOCAL_PASSWORD = process.env.E2E_PASSWORD || "changeme";
const OPERATIONS_ID = "cs-unit-operations";
const SECTION_A_ID = "cs-unit-section-a";
const SECTION_A_CHILD_ID = "cs-unit-section-a-child";
const LINE_A_TEAM_ID = "cs-team-section-a-line";
const ALICE_ASSIGNMENT_ID = "cs-asg-alice";
const CASEY_ASSIGNMENT_ID = "cs-asg-casey";

/**
 * The team-panel test mutates the shared dev database (creates the Night Line
 * team), so it needs the same guarded direct connection the approval-flow
 * specs use for fixture isolation: app_cleanstart_dev only, never a protected
 * or CI database.
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
			`C4 organization-tree specs require TEST_BASE_URL=${REQUIRED_BASE} (got ${String(process.env.TEST_BASE_URL)})`,
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

test.describe("clean-start organization tree hover/focus/overflow", () => {
	test("desktop Manage is hidden until row hover; keyboard focus shows controls", async ({
		browser,
	}) => {
		test.setTimeout(120_000);
		const session = await openSignedIn(browser, EMAIL.admin);
		try {
			await session.page.setViewportSize({ width: 1280, height: 720 });
			await session.page.goto("/admin/organization");
			const header = session.page.getByTestId(`unit-header-${OPERATIONS_ID}`);
			const manage = session.page.getByTestId(`unit-manage-${OPERATIONS_ID}`);
			const rename = session.page.getByTestId(`unit-rename-${OPERATIONS_ID}`);
			const overflow = session.page.getByTestId(`unit-overflow-${OPERATIONS_ID}`);
			await expect(session.page.getByTestId("organization-tree")).toBeVisible({ timeout: 20_000 });
			await expect(header).toBeVisible();
			await expect(manage).toBeAttached();
			await expect(rename).toBeAttached();
			await expect(overflow).toBeAttached();
			await expect(manage).toBeHidden();
			await expect(rename).toBeHidden();
			await expect(overflow).toBeHidden();

			await header.hover();
			await expect(manage).toBeVisible();
			await expect(rename).toBeVisible();

			await session.page.getByRole("heading", { name: "Organization & Approvals" }).hover();
			await expect(manage).toBeHidden();

			await header.focus();
			await expect(manage).toBeVisible();
			await expect(rename).toBeVisible();

			await rename.click();
			await expect(header.getByTestId("inline-name-edit-input")).toBeVisible();
		} finally {
			await session.context.close();
		}
	});

	test("keyboard activates Rename; real key events type a multiword unit name", async ({
		browser,
	}) => {
		test.setTimeout(120_000);
		const session = await openSignedIn(browser, EMAIL.admin);
		const page = session.page;
		try {
			await page.setViewportSize({ width: 1280, height: 720 });
			await page.goto("/admin/organization");
			await expect(page.getByTestId("organization-tree")).toBeVisible({ timeout: 20_000 });

			const header = page.getByTestId(`unit-header-${SECTION_A_CHILD_ID}`);
			const rename = page.getByTestId(`unit-rename-${SECTION_A_CHILD_ID}`);
			await header.hover();
			await expect(rename).toBeVisible();
			await rename.focus();
			await expect(rename).toBeFocused();
			await rename.press("Space");

			const input = header.getByTestId("inline-name-edit-input");
			await expect(input).toBeVisible();
			await input.click({ clickCount: 3 });
			await input.pressSequentially("West", { delay: 25 });
			await input.press("Space");
			await input.pressSequentially("Operations", { delay: 25 });
			await expect(input).toHaveValue("West Operations");

			await input.press("Escape");
			await expect(input).toHaveCount(0);
			await expect(page.getByTestId(`unit-name-${SECTION_A_CHILD_ID}`)).toContainText("Section A Child");
		} finally {
			try {
				const input = page.getByTestId("inline-name-edit-input");
				if (await input.count()) {
					await input.press("Escape");
				}
			} catch {
				// cancel best-effort; fixture reseed covers leftover state
			}
			await session.context.close();
		}
	});

	test("mobile 390x844 overflow is visible without hover", async ({ browser }) => {
		test.setTimeout(120_000);
		const session = await openSignedIn(browser, EMAIL.admin);
		try {
			await session.page.setViewportSize({ width: 390, height: 844 });
			await session.page.goto("/admin/organization");
			const header = session.page.getByTestId(`unit-header-${OPERATIONS_ID}`);
			const overflow = session.page.getByTestId(`unit-overflow-${OPERATIONS_ID}`);
			const manage = session.page.getByTestId(`unit-manage-${OPERATIONS_ID}`);
			await expect(session.page.getByTestId("organization-tree")).toBeVisible({ timeout: 20_000 });
			await expect(header).toBeVisible();
			await expect(overflow).toBeVisible();
			await expect(manage).toBeHidden();

			await overflow.click();
			await expect(session.page.getByRole("menuitem", { name: "Rename" })).toBeVisible();
			await expect(session.page.getByRole("menuitem", { name: "Manage" })).toBeVisible();
		} finally {
			await session.context.close();
		}
	});
});

test.describe("clean-start person assignment panel", () => {
	test("selecting a person opens assignment management; move confirmation lists old and new unit/position/team", async ({
		browser,
	}) => {
		test.setTimeout(120_000);
		const session = await openSignedIn(browser, EMAIL.admin);
		const page = session.page;
		try {
			await page.setViewportSize({ width: 1280, height: 720 });
			await page.goto("/admin/organization");
			await expect(page.getByTestId("organization-tree")).toBeVisible({ timeout: 20_000 });

			await page.getByRole("button", { name: "Alice — Staff" }).click();
			const panel = page.getByTestId("person-assignment-panel");
			await expect(panel).toBeVisible();
			await expect(panel.getByText("Alice")).toBeVisible();

			await page.getByTestId("assignment-unit-select").click();
			await page.getByRole("option", { name: "Section B" }).click();
			await page.getByTestId("assignment-team-select").click();
			await page.getByRole("option", { name: "No team" }).click();
			await page.getByTestId("assignment-save").click();

			const confirmation = page.getByTestId("assignment-move-confirmation");
			await expect(confirmation).toBeVisible();
			await expect(confirmation.getByTestId("assignment-change-before")).toContainText("Section A");
			await expect(confirmation.getByTestId("assignment-change-after")).toContainText("Section B");
			await expect(confirmation.getByTestId("assignment-change-before")).toContainText("Staff");
			await expect(confirmation.getByTestId("assignment-change-after")).toContainText("Staff");
			await expect(confirmation.getByTestId("assignment-change-before")).toContainText("Line A");
			await expect(confirmation.getByTestId("assignment-change-after")).toContainText("None");

			await page.getByTestId("assignment-move-cancel").click();
			await expect(confirmation).toHaveCount(0);
			await expect(page.getByRole("button", { name: "Alice — Staff" })).toBeVisible();
		} finally {
			await session.context.close();
		}
	});

	test("promoting Casey to Manager while remaining on Line A requires explicit reports-to correction", async ({
		browser,
	}) => {
		test.setTimeout(120_000);
		const session = await openSignedIn(browser, EMAIL.admin);
		const page = session.page;
		try {
			await page.setViewportSize({ width: 1280, height: 720 });
			await page.goto("/admin/organization");
			await expect(page.getByTestId("organization-tree")).toBeVisible({ timeout: 20_000 });

			await page.getByRole("button", { name: "Casey — Lead" }).click();
			const panel = page.getByTestId("person-assignment-panel");
			await expect(panel).toBeVisible();
			await expect(panel.getByText("Casey")).toBeVisible();

			await page.getByTestId("assignment-position-select").click();
			await page.getByRole("option", { name: "Manager" }).click();
			await page.getByTestId("assignment-save").click();

			const confirmation = page.getByTestId("assignment-move-confirmation");
			await expect(confirmation).toBeVisible();
			const correction = page.getByTestId("assignment-reports-to-correction");
			await expect(correction).toBeVisible();
			await expect(correction).toContainText(/explicit correction/i);
			await expect(page.getByTestId(`assignment-reports-to-${LINE_A_TEAM_ID}`)).toBeVisible();
			await expect(page.getByTestId("assignment-move-confirm")).toBeDisabled();

			await page.getByTestId("assignment-move-cancel").click();
			await expect(confirmation).toHaveCount(0);
			await expect(page.getByRole("button", { name: "Casey — Lead" })).toBeVisible();
		} finally {
			await session.context.close();
		}
	});
});

test.describe("clean-start team panel", () => {
	const NIGHT_LINE_NAME = "Night Line";

	async function activeNightLineTeamIds(prisma: PrismaClient): Promise<string[]> {
		const rows = await prisma.teams.findMany({
			where: { unitId: SECTION_A_ID, name: NIGHT_LINE_NAME, isActive: true },
			select: { id: true },
		});
		return rows.map((row) => row.id);
	}

	/**
	 * Isolate the created fixture: move every Night Line member back to Line A,
	 * deactivate the team itself, then await and verify the restored state. Runs
	 * before the test body (drops contamination from earlier runs) and after it
	 * (leaves nothing behind), so consecutive reruns need no manual reseeding.
	 * Failures throw instead of being swallowed: a broken cleanup must fail the
	 * run rather than silently poisoning the next one.
	 */
	async function deactivateNightLineTeams(): Promise<void> {
		const prisma = prismaClient();
		try {
			for (const teamId of await activeNightLineTeamIds(prisma)) {
				await prisma.$transaction([
					prisma.organization_assignments.updateMany({
						where: { teamId },
						data: { teamId: LINE_A_TEAM_ID },
					}),
					prisma.teams.update({
						where: { id: teamId },
						data: { isActive: false },
					}),
				]);
			}
			expect(await activeNightLineTeamIds(prisma)).toHaveLength(0);
			const strays = await prisma.organization_assignments.findMany({
				where: {
					id: { in: [ALICE_ASSIGNMENT_ID, CASEY_ASSIGNMENT_ID] },
					teamId: { not: LINE_A_TEAM_ID },
				},
				select: { id: true, teamId: true },
			});
			expect(strays).toHaveLength(0);
		} finally {
			await prisma.$disconnect();
		}
	}

	test("create a team in Section A with two members under one reports-to without duplicating the person", async ({
		browser,
	}) => {
		test.setTimeout(120_000);
		const session = await openSignedIn(browser, EMAIL.admin);
		const page = session.page;
		try {
			// Rerun isolation: drop any Night Line a previous run left active.
			await deactivateNightLineTeams();

			await page.setViewportSize({ width: 1280, height: 720 });
			await page.goto("/admin/organization");
			await expect(page.getByTestId("organization-tree")).toBeVisible({ timeout: 20_000 });

			const sectionAHeader = page.getByTestId(`unit-header-${SECTION_A_ID}`);
			await sectionAHeader.click();
			await expect(page.getByTestId("unit-side-panel")).toBeVisible();
			await page.getByTestId("unit-create-team").click();

			const panel = page.getByTestId("team-panel");
			await expect(panel).toBeVisible();
			await expect(panel.getByText("Create team")).toBeVisible();
			await page.getByTestId("team-name-input").fill(NIGHT_LINE_NAME);
			await page.getByTestId("team-reports-to-select").click();
			await page.getByRole("option", { name: /Riley/ }).click();
			await page.getByRole("checkbox", { name: /Alice/ }).check();
			await page.getByRole("checkbox", { name: /Casey/ }).check();
			await page.getByTestId("team-save").click();

			// Await successful persistence: the created team group renders beneath its reports-to.
			const rileyChip = page.locator('[data-testid^="person-chip-"]').filter({ hasText: "Riley — Manager" });
			await expect(rileyChip).toHaveCount(1);
			const nightLineGroup = rileyChip.locator('[data-testid^="team-group-"]').filter({ hasText: NIGHT_LINE_NAME });
			await expect(nightLineGroup).toHaveCount(1, { timeout: 15_000 });

			// Both members render INSIDE the newly created team group, not merely anywhere under Riley.
			await expect(nightLineGroup.getByText("Alice — Staff")).toBeVisible();
			await expect(nightLineGroup.getByText("Casey — Lead")).toBeVisible();
			await expect(rileyChip.getByText("Line A")).toBeVisible();

			// Persistence is real in the database: the new team owns exactly both memberships.
			const prisma = prismaClient();
			try {
				const created = await prisma.teams.findFirstOrThrow({
					where: { unitId: SECTION_A_ID, name: NIGHT_LINE_NAME, isActive: true },
					select: { id: true },
				});
				const members = await prisma.organization_assignments.findMany({
					where: { id: { in: [ALICE_ASSIGNMENT_ID, CASEY_ASSIGNMENT_ID] } },
					select: { id: true, teamId: true },
				});
				expect(members.map((row) => row.teamId).sort()).toEqual([created.id, created.id]);
				await expect(page.getByTestId(`team-group-${created.id}`)).toBeVisible();
			} finally {
				await prisma.$disconnect();
			}
		} finally {
			try {
				// Isolate the created fixture for the next run; a failure here fails the test.
				await deactivateNightLineTeams();
			} finally {
				await session.context.close();
			}
		}
	});
});

test.describe("clean-start unit side panel", () => {
	test("selecting a unit opens the panel; sharing badge updates after save; Section A REQUEST is Inherited from Operations", async ({
		browser,
	}) => {
		test.setTimeout(120_000);
		const session = await openSignedIn(browser, EMAIL.admin);
		const page = session.page;
		const childBadge = page.getByTestId(`sharing-badge-${SECTION_A_CHILD_ID}`);
		let restored = false;
		try {
			await page.setViewportSize({ width: 1280, height: 720 });
			await page.goto("/admin/organization");
			await expect(page.getByTestId("organization-tree")).toBeVisible({ timeout: 20_000 });

			const operationsHeader = page.getByTestId(`unit-header-${OPERATIONS_ID}`);
			await operationsHeader.hover();
			await page.getByTestId(`unit-manage-${OPERATIONS_ID}`).click();
			const panel = page.getByTestId("unit-side-panel");
			await expect(panel).toBeVisible();
			await expect(panel.getByRole("heading", { name: "Manage Operations" })).toBeVisible();

			const sectionAHeader = page.getByTestId(`unit-header-${SECTION_A_ID}`);
			await sectionAHeader.hover();
			await page.getByTestId(`unit-manage-${SECTION_A_ID}`).click();
			await expect(panel.getByRole("heading", { name: "Manage Section A" })).toBeVisible();
			await expect(page.getByTestId("route-source-REQUEST")).toHaveText("Inherited from Operations");
			await expect(panel.getByText("Share requests within this unit and all its descendants")).toBeVisible();

			const childHeader = page.getByTestId(`unit-header-${SECTION_A_CHILD_ID}`);
			await childHeader.hover();
			await page.getByTestId(`unit-manage-${SECTION_A_CHILD_ID}`).click();
			await expect(panel.getByRole("heading", { name: "Manage Section A Child" })).toBeVisible();
			await expect(childBadge).toBeVisible();

			const sharingSwitch = page.getByTestId("unit-share-requests");
			await expect(sharingSwitch).toBeChecked();
			await sharingSwitch.click();
			await page.getByTestId("unit-settings-save").click();
			await expect(childBadge).toHaveCount(0);

			await expect(sharingSwitch).not.toBeChecked();
			await sharingSwitch.click();
			await page.getByTestId("unit-settings-save").click();
			await expect(childBadge).toBeVisible();
			restored = true;
		} finally {
			if (!restored) {
				try {
					await page.goto("/admin/organization");
					const childHeader = page.getByTestId(`unit-header-${SECTION_A_CHILD_ID}`);
					await childHeader.hover();
					await page.getByTestId(`unit-manage-${SECTION_A_CHILD_ID}`).click();
					const sharingSwitch = page.getByTestId("unit-share-requests");
					if (!(await sharingSwitch.isChecked())) {
						await sharingSwitch.click();
						await page.getByTestId("unit-settings-save").click();
						await expect(childBadge).toBeVisible({ timeout: 10_000 });
					}
				} catch {
					// restore best-effort; fixture reseed covers leftover state
				}
			}
			await session.context.close();
		}
	});
});

test.describe("clean-start position administration", () => {
	const LEAD_ID = "cs-pos-lead";
	const NIGHT_SHIFT_BASE_NAME = "Night Shift";
	/**
	 * positions.name is globally unique at the schema level INCLUDING inactive
	 * rows, while createPosition only rejects duplicates among ACTIVE
	 * positions, and this spec deactivates its fixture instead of deleting it
	 * so captured history is preserved. Reusing the base name would collide
	 * with the deactivated row an earlier run left behind, so every run gets
	 * its own uniquely named fixture; cleanup and assertions stay scoped to
	 * the Night Shift family.
	 */
	const NIGHT_SHIFT_NAME = `${NIGHT_SHIFT_BASE_NAME} #${process.pid.toString(36)}-${Date.now().toString(36)}`;

	/**
	 * Isolate the created fixture family: deactivate every active Night Shift
	 * position (this run's unique name, an interrupted earlier run's, or the
	 * legacy exact name), then verify the restored state. Deactivated history
	 * is never deleted. Runs before and after the create test; failures throw
	 * so a broken cleanup fails the run instead of poisoning the next one.
	 */
	async function deactivateNightShiftPositions(): Promise<void> {
		const prisma = prismaClient();
		try {
			await prisma.positions.updateMany({
				where: { name: { startsWith: NIGHT_SHIFT_BASE_NAME }, isActive: true },
				data: { isActive: false },
			});
			expect(
				await prisma.positions.count({
					where: { name: { startsWith: NIGHT_SHIFT_BASE_NAME }, isActive: true },
				}),
			).toBe(0);
		} finally {
			await prisma.$disconnect();
		}
	}

	test("Positions header opens the panel; a blocked Lead rank change lists Line A and route problems with save disabled and persists nothing", async ({ browser }) => {
		test.setTimeout(120_000);
		const session = await openSignedIn(browser, EMAIL.admin);
		const page = session.page;
		try {
			await page.setViewportSize({ width: 1280, height: 720 });
			await page.goto("/admin/organization");
			await expect(page.getByTestId("organization-tree")).toBeVisible({ timeout: 20_000 });

			await page.getByTestId("header-positions").click();
			const panel = page.getByTestId("position-admin-panel");
			await expect(panel).toBeVisible({ timeout: 20_000 });
			await expect(panel.getByText("Staff")).toBeVisible();
			await expect(panel.getByText("Lead")).toBeVisible();
			await expect(panel.getByText("Manager")).toBeVisible();
			await expect(panel.getByText("Director")).toBeVisible();

			await page.getByTestId(`position-rank-edit-${LEAD_ID}`).click();
			const rankInput = page.getByTestId(`position-rank-input-${LEAD_ID}`);
			await expect(rankInput).toBeVisible();
			await rankInput.fill("5");
			await page.getByTestId(`position-rank-save-${LEAD_ID}`).click();

			const impact = page.getByTestId("position-rank-impact");
			await expect(impact).toBeVisible({ timeout: 20_000 });
			await expect(impact.getByTestId("position-rank-impact-teams")).toContainText("Line A");
			await expect(impact.getByTestId("position-rank-impact-routes")).toContainText(/REQUEST/);
			await expect(impact).toContainText("STEP_NOT_ASCENDING");
			await expect(impact).toContainText("STEP_EXCEEDS_LIMIT");
			await expect(page.getByTestId(`position-rank-save-${LEAD_ID}`)).toBeDisabled();

			const prisma = prismaClient();
			try {
				const lead = await prisma.positions.findUniqueOrThrow({
					where: { id: LEAD_ID },
					select: { rank: true },
				});
				expect(lead.rank).toBe(2);
			} finally {
				await prisma.$disconnect();
			}

			await page.getByTestId(`position-rank-cancel-${LEAD_ID}`).click();
			await expect(page.getByTestId(`position-rank-editor-${LEAD_ID}`)).toHaveCount(0);
		} finally {
			await session.context.close();
		}
	});

	test("create Night Shift position, deactivate it from the panel, leave nothing active behind", async ({ browser }) => {
		test.setTimeout(120_000);
		const session = await openSignedIn(browser, EMAIL.admin);
		const page = session.page;
		try {
			// Rerun isolation: drop any Night Shift a previous run left active.
			await deactivateNightShiftPositions();

			await page.setViewportSize({ width: 1280, height: 720 });
			await page.goto("/admin/organization");
			await expect(page.getByTestId("organization-tree")).toBeVisible({ timeout: 20_000 });

			await page.getByTestId("header-positions").click();
			const panel = page.getByTestId("position-admin-panel");
			await expect(panel).toBeVisible({ timeout: 20_000 });
			await page.getByTestId("position-create-name").fill(NIGHT_SHIFT_NAME);
			await page.getByTestId("position-create-rank").fill("7");
			await page.getByTestId("position-create-save").click();
			await expect(panel.getByTestId("position-list")).toContainText(NIGHT_SHIFT_NAME, {
				timeout: 15_000,
			});

			const prisma = prismaClient();
			let createdId = "";
			try {
				const created = await prisma.positions.findFirstOrThrow({
					where: { name: NIGHT_SHIFT_NAME, isActive: true },
					select: { id: true, rank: true },
				});
				expect(created.rank).toBe(7);
				createdId = created.id;
			} finally {
				await prisma.$disconnect();
			}

			await page.getByTestId(`position-deactivate-${createdId}`).click();
			await expect(panel.getByTestId("position-list")).not.toContainText(NIGHT_SHIFT_NAME, {
				timeout: 15_000,
			});

			const verify = prismaClient();
			try {
				expect(
					await verify.positions.count({ where: { name: NIGHT_SHIFT_NAME, isActive: true } }),
				).toBe(0);
			} finally {
				await verify.$disconnect();
			}
		} finally {
			try {
				// Isolate for the next run; a failure here fails the test.
				await deactivateNightShiftPositions();
			} finally {
				await session.context.close();
			}
		}
	});
});
