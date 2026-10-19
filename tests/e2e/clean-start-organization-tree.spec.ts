import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const REQUIRED_BASE = "http://localhost:3100";
const LOCAL_PASSWORD = process.env.E2E_PASSWORD || "changeme";
const OPERATIONS_ID = "cs-unit-operations";
const SECTION_A_ID = "cs-unit-section-a";
const SECTION_A_CHILD_ID = "cs-unit-section-a-child";
const SECTION_B_ID = "cs-unit-section-b";
const LINE_A_TEAM_ID = "cs-team-section-a-line";
const LEAD_ID = "cs-pos-lead";
const STAFF_ID = "cs-pos-staff";
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
			await expect(panel.getByRole("heading", { name: "Operations", exact: true })).toBeVisible();

			const sectionAHeader = page.getByTestId(`unit-header-${SECTION_A_ID}`);
			await page.keyboard.press("Escape");
			await sectionAHeader.hover();
			await page.getByTestId(`unit-manage-${SECTION_A_ID}`).click();
			await expect(panel.getByRole("heading", { name: "Section A", exact: true })).toBeVisible();
			await expect(panel.getByTestId("unit-exception-chain-REQUEST")).toContainText("Inherited from Operations");
			await expect(panel.getByText("Request visibility", { exact: true })).toBeVisible();
			await expect(panel.getByTestId("unit-share-requests-info")).toBeVisible();

			const childHeader = page.getByTestId(`unit-header-${SECTION_A_CHILD_ID}`);
			await page.keyboard.press("Escape");
			await childHeader.hover();
			await page.getByTestId(`unit-manage-${SECTION_A_CHILD_ID}`).click();
			await expect(panel.getByRole("heading", { name: "Section A Child", exact: true })).toBeVisible();
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
			await page.getByTestId("position-create-open").click();
			await page.getByTestId("position-create-name").fill(NIGHT_SHIFT_NAME);
			// Rank stepper: six + clicks walk 1 → 7.
			const rankUp = page.getByTestId("position-create-rank-increase");
			for (let step = 0; step < 6; step += 1) {
				await rankUp.click();
			}
			await expect(page.getByTestId("position-create-rank")).toHaveText("7");
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

test.describe("clean-start approval chains panel", () => {
	test("Approval chains header opens the panel; root defaults are per phase; publication copy is not a global switch; lowering the limit disables Publish", async ({
		browser,
	}) => {
		test.setTimeout(120_000);
		const session = await openSignedIn(browser, EMAIL.admin);
		const page = session.page;
		try {
			await page.setViewportSize({ width: 1280, height: 720 });
			await page.goto("/admin/organization");
			await expect(page.getByTestId("organization-tree")).toBeVisible({ timeout: 20_000 });

			await page.getByTestId("header-approval-chains").click();
			const panel = page.getByTestId("chains-panel");
			await expect(panel).toBeVisible({ timeout: 20_000 });
			await expect(page.getByTestId("chains-root-REQUEST")).toBeVisible();
			await expect(page.getByTestId("chains-root-SOLUTION")).toBeVisible();
			await expect(page.getByTestId("chains-root-FINAL")).toBeVisible();
			await expect(panel).toContainText(/not a global on\/off switch/i);
			await expect(panel).toContainText(/affects future attempts only/i);
			await expect(page.getByTestId("chains-published-list-REQUEST")).toBeVisible();

			await page.getByTestId("chains-root-customize-REQUEST").click();
			await expect(page.getByTestId("route-editor-limit-select")).toBeVisible();
			await expect(page.getByTestId("route-editor-add-step")).toBeVisible();
			await expect(page.getByTestId("route-editor-publish")).toBeEnabled();

			await page.getByTestId("route-editor-limit-select").click();
			await page.getByRole("option", { name: /Manager \(rank 3\)/ }).click();
			await expect(page.getByTestId("route-editor-publish")).toBeDisabled();
			const conflicts = page.getByTestId("route-editor-conflicts");
			await expect(conflicts).toBeVisible();
			await expect(conflicts).toContainText("Director");
			await expect(conflicts).toContainText("EXCEEDS_LIMIT");

			// A nested Radix Select must consume its Escape without dismissing the
			// enclosing editor, so this unsaved limit change remains in the draft.
			const editor = page.getByTestId("route-editor-cs-unit-company-REQUEST");
			await page.getByTestId("route-editor-limit-select").click();
			await expect(page.getByRole("listbox")).toBeVisible();
			await page.keyboard.press("Escape");
			await expect(page.getByRole("listbox")).toHaveCount(0);
			await expect(editor).toBeVisible();
			await expect(page.getByTestId("route-editor-limit-select")).toContainText("Manager (rank 3)");

			// A later Escape, with no nested popup handling it, dismisses the editor.
			await page.keyboard.press("Escape");
			await expect(editor).toHaveCount(0);
		} finally {
			await session.context.close();
		}
	});
});

test.describe("clean-start C10 full journey", () => {
	/**
	 * Per-run unique suffix: every persistent row this journey creates (unit,
	 * draft/published route versions, stranded-restart fixture family) carries
	 * it, and cleanup is prefix-scoped so two consecutive full-spec runs both
	 * pass without reseeding (the C7/C8 Night Line / Night Shift pattern:
	 * deactivate or supersede, never hard-delete).
	 */
	const RUN = `${process.pid.toString(36)}-${Date.now().toString(36)}`;
	const JOURNEY_UNIT_NAME = `C10 Journey Unit #${RUN}`;
	const JOURNEY_UNIT_RENAMED = `C10 Journey Renamed #${RUN}`;
	const JOURNEY_UNIT_PREFIX = "C10 Journey";
	const STRANDED_EMAIL = `c10-stranded-${RUN}@example.com`;
	const STRANDED_NAME = `C10 Stranded ${RUN}`;
	const STRANDED_REQUEST_ID = `c10-req-${RUN}`;
	const STRANDED_INSTANCE_ID = `c10-inst-${RUN}`;
	const STRANDED_GROUP_ID = `c10-grp-${RUN}`;
	const STRANDED_REQUEST_TITLE = `C10 Stranded Request ${RUN}`;
	const RESTART_REASON = `C10 journey restart ${RUN}`;

	async function userIdByEmail(prisma: PrismaClient, email: string): Promise<string> {
		const row = await prisma.user.findUniqueOrThrow({
			where: { email },
			select: { id: true },
		});
		return row.id;
	}

	/** Rerun isolation: deactivate any journey unit an earlier run left active. */
	async function deactivateJourneyUnits(): Promise<void> {
		const prisma = prismaClient();
		try {
			await prisma.organization_units.updateMany({
				where: { name: { startsWith: JOURNEY_UNIT_PREFIX }, isActive: true },
				data: { isActive: false },
			});
			expect(
				await prisma.organization_units.count({
					where: { name: { startsWith: JOURNEY_UNIT_PREFIX }, isActive: true },
				}),
			).toBe(0);
		} finally {
			await prisma.$disconnect();
		}
	}

	/**
	 * Rerun isolation for the assign/move/remove leg: the journey assigns the
	 * admin account (the only seeded unassigned user) and ends by removing it.
	 * A failed earlier run may have left the assignment active; deactivate it
	 * (deactivation is the removal path; history is preserved).
	 */
	async function deactivateAdminAssignments(): Promise<void> {
		const prisma = prismaClient();
		try {
			const adminId = await userIdByEmail(prisma, EMAIL.admin);
			await prisma.organization_assignments.updateMany({
				where: { userId: adminId, isActive: true },
				data: { isActive: false },
			});
			expect(
				await prisma.organization_assignments.count({
					where: { userId: adminId, isActive: true },
				}),
			).toBe(0);
		} finally {
			await prisma.$disconnect();
		}
	}

	/**
	 * Rerun isolation for the stranded-restart fixture: supersede any
	 * non-superseded journey instance, deactivate journey fixture users, and
	 * soft-delete journey fixture requests. Rows are history-preserving
	 * (supersede/deactivate/soft-delete); nothing is hard-deleted.
	 */
	async function retireJourneyStrandedFixtures(): Promise<void> {
		const prisma = prismaClient();
		try {
			await prisma.approval_instances.updateMany({
				where: { id: { startsWith: "c10-inst-" }, supersededAt: null },
				data: { supersededAt: new Date() },
			});
			expect(
				await prisma.approval_instances.count({
					where: { id: { startsWith: "c10-inst-" }, supersededAt: null },
				}),
			).toBe(0);
			await prisma.user.updateMany({
				where: { email: { startsWith: "c10-stranded-" }, isActive: true },
				data: { isActive: false },
			});
			await prisma.requests.updateMany({
				where: { title: { startsWith: "C10 Stranded" }, isDeleted: false },
				data: { isDeleted: true, deletedAt: new Date() },
			});
		} finally {
			await prisma.$disconnect();
		}
	}

	/**
	 * Creates a stranded REQUEST attempt directly in the guarded dev database:
	 * there is no admin UI that can strand an attempt (stranding happens when
	 * every saved approver later goes inactive). The candidate group's single
	 * member is a per-run fixture user created inactive, so the B5 stranded
	 * predicate holds. The restart itself runs through the REAL dialog and the
	 * REAL server action (live persist).
	 */
	async function createStrandedAttemptFixture(): Promise<void> {
		const prisma = prismaClient();
		try {
			const aliceId = await userIdByEmail(prisma, "alice@example.com");
			await prisma.user.create({
				data: {
					email: STRANDED_EMAIL,
					name: STRANDED_NAME,
					passwordHash: null,
					isActive: false,
				},
			});
			const strandedUserId = await userIdByEmail(prisma, STRANDED_EMAIL);
			await prisma.requests.create({
				data: {
					id: STRANDED_REQUEST_ID,
					title: STRANDED_REQUEST_TITLE,
					description: "C10 journey stranded-restart fixture request",
					requesterId: aliceId,
				},
			});
			await prisma.approval_instances.create({
				data: {
					id: STRANDED_INSTANCE_ID,
					requestId: STRANDED_REQUEST_ID,
					phase: "REQUEST",
					originUserId: aliceId,
					originUnitId: SECTION_A_ID,
					originAssignmentId: ALICE_ASSIGNMENT_ID,
					originPositionId: STAFF_ID,
					routingMode: "SNAPSHOT_GROUP",
					state: "PENDING",
					attempt: 1,
				},
			});
			await prisma.approval_candidate_groups.create({
				data: {
					id: STRANDED_GROUP_ID,
					approvalInstanceId: STRANDED_INSTANCE_ID,
					scopeUnitId: SECTION_A_ID,
					requiredPositionId: LEAD_ID,
					members: {
						create: [
							{
								userId: strandedUserId,
								capturedDisplayName: STRANDED_NAME,
							},
						],
					},
				},
			});
		} finally {
			await prisma.$disconnect();
		}
	}

	test("create unit under Operations, inline rename, sharing toggle and badge", async ({
		browser,
	}) => {
		test.setTimeout(240_000);
		await deactivateJourneyUnits();
		const session = await openSignedIn(browser, EMAIL.admin);
		const page = session.page;
		try {
			await page.setViewportSize({ width: 1280, height: 720 });
			await page.goto("/admin/organization");
			await expect(page.getByTestId("organization-tree")).toBeVisible({ timeout: 20_000 });

			// Create unit under Operations through the real header dialog.
			await page.getByTestId("create-unit-open").click();
			const dialog = page.getByTestId("create-unit-dialog");
			await expect(dialog).toBeVisible();
			await page.getByTestId("create-unit-name-input").fill(JOURNEY_UNIT_NAME);
			await page.getByTestId("create-unit-parent-select").click();
			await page.getByRole("option", { name: "Operations" }).click();
			await page.getByTestId("create-unit-save").click();
			await expect(dialog).toHaveCount(0);

			const prisma = prismaClient();
			let unitId = "";
			try {
				const created = await prisma.organization_units.findFirstOrThrow({
					where: { name: JOURNEY_UNIT_NAME, isActive: true },
					select: { id: true, parentId: true },
				});
				expect(created.parentId).toBe(OPERATIONS_ID);
				unitId = created.id;
			} finally {
				await prisma.$disconnect();
			}
			await expect(page.getByTestId(`unit-name-${unitId}`)).toBeVisible({ timeout: 15_000 });

			// Inline rename: Enter saves.
			const header = page.getByTestId(`unit-header-${unitId}`);
			await header.hover();
			await page.getByTestId(`unit-rename-${unitId}`).click();
			const input = header.getByTestId("inline-name-edit-input");
			await expect(input).toBeVisible();
			await input.click({ clickCount: 3 });
			await input.pressSequentially(JOURNEY_UNIT_RENAMED, { delay: 15 });
			await input.press("Enter");
			await expect(page.getByTestId(`unit-name-${unitId}`)).toContainText(JOURNEY_UNIT_RENAMED);
			await expect(header.getByTestId("inline-name-edit-input")).toHaveCount(0);

			// Inline rename: Escape cancels without persisting.
			await header.hover();
			await page.getByTestId(`unit-rename-${unitId}`).click();
			const escapeInput = header.getByTestId("inline-name-edit-input");
			await escapeInput.click({ clickCount: 3 });
			await escapeInput.pressSequentially("Discard This", { delay: 15 });
			await escapeInput.press("Escape");
			await expect(header.getByTestId("inline-name-edit-input")).toHaveCount(0);
			await expect(page.getByTestId(`unit-name-${unitId}`)).toContainText(JOURNEY_UNIT_RENAMED);

			// Inline rename: duplicate sibling name shows the adjacent error and
			// retains the typed input; Escape leaves the original name.
			await header.hover();
			await page.getByTestId(`unit-rename-${unitId}`).click();
			const duplicateInput = header.getByTestId("inline-name-edit-input");
			await duplicateInput.click({ clickCount: 3 });
			await duplicateInput.pressSequentially("Section A", { delay: 15 });
			await duplicateInput.press("Enter");
			const error = header.getByTestId("inline-name-edit-error");
			await expect(error).toBeVisible({ timeout: 15_000 });
			await expect(error).toContainText(/unique/i);
			await expect(duplicateInput).toHaveValue("Section A");
			await duplicateInput.press("Escape");
			await expect(page.getByTestId(`unit-name-${unitId}`)).toContainText(JOURNEY_UNIT_RENAMED);

			// Toggle sharing on the new unit and observe the badge. New units are
			// created sharing-on (C5 writer default): the badge is present first,
			// then disappears when sharing is toggled off and saved.
			await expect(page.getByTestId(`sharing-badge-${unitId}`)).toBeVisible();
			await header.click();
			const panel = page.getByTestId("unit-side-panel");
			await expect(panel.getByRole("heading", { name: JOURNEY_UNIT_RENAMED, exact: true })).toBeVisible();
			const sharingSwitch = page.getByTestId("unit-share-requests");
			await expect(sharingSwitch).toBeChecked();
			await sharingSwitch.click();
			await page.getByTestId("unit-settings-save").click();
			await expect(page.getByTestId(`sharing-badge-${unitId}`)).toHaveCount(0, { timeout: 15_000 });

			const verify = prismaClient();
			try {
				const saved = await verify.organization_units.findUniqueOrThrow({
					where: { id: unitId },
					select: { shareRequests: true, isActive: true },
				});
				expect(saved.shareRequests).toBe(false);
				expect(saved.isActive).toBe(true);
			} finally {
				await verify.$disconnect();
			}
		} finally {
			try {
				await deactivateJourneyUnits();
			} finally {
				await session.context.close();
			}
		}
	});

	test("assign person with a team, move with confirmation, remove to Unassigned", async ({
		browser,
	}) => {
		test.setTimeout(240_000);
		await deactivateAdminAssignments();
		const session = await openSignedIn(browser, EMAIL.admin);
		const page = session.page;
		let adminId = "";
		{
			const prisma = prismaClient();
			try {
				adminId = await userIdByEmail(prisma, EMAIL.admin);
			} finally {
				await prisma.$disconnect();
			}
		}
		try {
			await page.setViewportSize({ width: 1280, height: 720 });
			await page.goto("/admin/organization");
			await expect(page.getByTestId("organization-tree")).toBeVisible({ timeout: 20_000 });

			// Assign the unassigned admin to Section A with Line A and Staff.
			// The bottom dock is gone: open the unassigned panel from the
			// sticky toolbar's Unassigned chip first.
			await page.getByTestId("unassigned-dock-toggle").click();
			await expect(page.getByTestId("unassigned-people-list")).toBeVisible();
			await page.getByTestId(`unassigned-person-${adminId}`).click();
			const assignPanel = page.getByTestId("person-assignment-panel");
			await expect(assignPanel).toBeVisible();
			await expect(assignPanel.getByRole("heading", { name: "Assign person" })).toBeVisible();
			await expect(assignPanel.getByText("System Admin")).toBeVisible();

			await page.getByTestId("assignment-unit-select").click();
			await page.getByRole("option", { name: "Section A", exact: true }).click();
			await page.getByTestId("assignment-position-select").click();
			await page.getByRole("option", { name: "Staff" }).click();
			await page.getByTestId("assignment-team-select").click();
			await page.getByRole("option", { name: "Line A" }).click();
			await page.getByTestId("assignment-save").click();
			// Owner-approved modal UX: a completed assign closes the dialog.
			await expect(page.getByTestId("person-assignment-panel")).toHaveCount(0, {
				timeout: 15_000,
			});

			const personChip = page.getByTestId(`person-chip-${adminId}`);
			await expect(personChip).toBeVisible({ timeout: 15_000 });
			await expect(personChip).toContainText("System Admin — Staff");

			{
				const prisma = prismaClient();
				try {
					const row = await prisma.organization_assignments.findFirstOrThrow({
						where: { userId: adminId, isActive: true },
						select: { unitId: true, positionId: true, teamId: true },
					});
					expect(row.unitId).toBe(SECTION_A_ID);
					expect(row.teamId).toBe(LINE_A_TEAM_ID);
				} finally {
					await prisma.$disconnect();
				}
			}

			// Move to Section B with the before/after confirmation; changing unit
			// cleared the incompatible team explicitly.
			await personChip.click();
			await page.getByTestId("assignment-unit-select").click();
			await page.getByRole("option", { name: "Section B" }).click();
			await page.getByTestId("assignment-team-select").click();
			await page.getByRole("option", { name: "No team" }).click();
			await page.getByTestId("assignment-save").click();
			const confirmation = page.getByTestId("assignment-move-confirmation");
			await expect(confirmation).toBeVisible();
			await expect(confirmation.getByTestId("assignment-change-before")).toContainText("Section A");
			await expect(confirmation.getByTestId("assignment-change-before")).toContainText("Line A");
			await expect(confirmation.getByTestId("assignment-change-after")).toContainText("Section B");
			await expect(confirmation.getByTestId("assignment-change-after")).toContainText("None");
			await page.getByTestId("assignment-move-confirm").click();
			// Owner-approved modal UX: a confirmed move closes the dialog.
			await expect(page.getByTestId("person-assignment-panel")).toHaveCount(0, {
				timeout: 15_000,
			});
			await expect(
				page.getByTestId(`unit-people-${SECTION_B_ID}`).getByTestId(`person-chip-${adminId}`),
			).toBeVisible({ timeout: 15_000 });

			{
				const prisma = prismaClient();
				try {
					const row = await prisma.organization_assignments.findFirstOrThrow({
						where: { userId: adminId, isActive: true },
						select: { unitId: true, teamId: true },
					});
					expect(row.unitId).toBe(SECTION_B_ID);
					expect(row.teamId).toBeNull();
				} finally {
					await prisma.$disconnect();
				}
			}

			// Remove the assignment; the account reappears under Unassigned people.
			await page.getByTestId(`person-chip-${adminId}`).click();
			await page.getByTestId("assignment-remove").click();
			await expect(page.getByTestId(`person-chip-${adminId}`)).toHaveCount(0, { timeout: 15_000 });
			// The unassigned list lives in the toolbar-chip panel now.
			await page.getByTestId("unassigned-dock-toggle").click();
			await expect(page.getByTestId(`unassigned-person-${adminId}`)).toBeVisible({ timeout: 15_000 });

			{
				const prisma = prismaClient();
				try {
					expect(
						await prisma.organization_assignments.count({
							where: { userId: adminId, isActive: true },
						}),
					).toBe(0);
				} finally {
					await prisma.$disconnect();
				}
			}
		} finally {
			try {
				await deactivateAdminAssignments();
			} finally {
				await session.context.close();
			}
		}
	});

	test("Positions blocked rank change lists affected teams and routes and persists nothing", async ({
		browser,
	}) => {
		test.setTimeout(180_000);
		const session = await openSignedIn(browser, EMAIL.admin);
		const page = session.page;
		try {
			await page.setViewportSize({ width: 1280, height: 720 });
			await page.goto("/admin/organization");
			await expect(page.getByTestId("organization-tree")).toBeVisible({ timeout: 20_000 });

			await page.getByTestId("header-positions").click();
			const panel = page.getByTestId("position-admin-panel");
			await expect(panel).toBeVisible({ timeout: 20_000 });

			await page.getByTestId(`position-rank-edit-${LEAD_ID}`).click();
			const rankInput = page.getByTestId(`position-rank-input-${LEAD_ID}`);
			await rankInput.fill("5");
			await page.getByTestId(`position-rank-save-${LEAD_ID}`).click();

			const impact = page.getByTestId("position-rank-impact");
			await expect(impact).toBeVisible({ timeout: 20_000 });
			await expect(impact.getByTestId("position-rank-impact-teams")).toContainText("Line A");
			await expect(impact.getByTestId("position-rank-impact-routes")).toContainText(/REQUEST/);
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

	test("Approval chains: publish-direct root default edit, limit conflict blocks publish, submitter tests, publish", async ({
		browser,
	}) => {
		test.setTimeout(240_000);
		const session = await openSignedIn(browser, EMAIL.admin);
		const page = session.page;
		try {
			await page.setViewportSize({ width: 1280, height: 720 });
			await page.goto("/admin/organization");
			await expect(page.getByTestId("organization-tree")).toBeVisible({ timeout: 20_000 });

			await page.getByTestId("header-approval-chains").click();
			const panel = page.getByTestId("chains-panel");
			await expect(panel).toBeVisible({ timeout: 20_000 });

			// Owner-revised publish-direct flow: no drafts — the editor writes a
			// new published version directly.
			await page.getByTestId("chains-root-customize-REQUEST").click();
			const editor = page.getByTestId("route-editor-cs-unit-company-REQUEST");
			await expect(editor).toBeVisible({ timeout: 15_000 });
			await expect(editor).toContainText("Lead");
			await expect(editor).toContainText("Director");

			// Lower the approval limit below a step: Publish disabled with the
			// conflict list.
			await page.getByTestId("route-editor-limit-select").click();
			await page.getByRole("option", { name: /Manager \(rank 3\)/ }).click();
			await expect(page.getByTestId("route-editor-publish")).toBeDisabled();
			const conflicts = page.getByTestId("route-editor-conflicts");
			await expect(conflicts).toBeVisible();
			await expect(conflicts).toContainText("Director");
			await expect(conflicts).toContainText("EXCEEDS_LIMIT");
			await expect(conflicts.getByTestId("route-editor-conflict-3")).toContainText("Director");

			// Restore the limit before the side-effect-free submitter test: the
			// editor state must be publishable before running the tests.
			await page.getByTestId("route-editor-limit-select").click();
			await page.getByRole("option", { name: /Director \(rank 4\)/ }).click();
			await expect(page.getByTestId("route-editor-conflicts")).toHaveCount(0);

			// Test with a submitter: ungrouped Bob (path only, vacant Lead step).
			await page.getByTestId("route-editor-test-submitter").click();
			const testDialog = page.getByTestId("submitter-test-dialog");
			await expect(testDialog).toBeVisible();
			await page.getByTestId("submitter-test-user-select").click();
			await page.getByRole("option", { name: "Bob" }).click();
			await page.getByTestId("submitter-test-run").click();
			const bobResult = page.getByTestId("submitter-test-result");
			await expect(bobResult).toBeVisible({ timeout: 15_000 });
			// The dialog tests the CURRENT editor state (in-memory preview; no
			// persisted draft anymore): it substitutes at the nearest published
			// scope on the submitter's branch (Operations).
			await expect(page.getByTestId("submitter-test-source")).toContainText(
				"Draft (would substitute at Operations)",
			);
			await expect(page.getByTestId("submitter-test-skip-1")).toContainText("VACANT_POSITION");
			await expect(page.getByTestId("submitter-test-step-2")).toContainText("Pat");
			await expect(page.getByTestId("submitter-test-step-3")).toContainText("Dana");
			await expect(page.getByTestId("submitter-test-auto-approved")).toHaveCount(0);
			await page.getByTestId("submitter-test-close").click();

			// Test with a team submitter: option-A candidates for Casey (Lead on
			// Line A) — own-team + reports-to + own-unit + ancestor managers.
			await page.getByTestId("route-editor-test-submitter").click();
			await page.getByTestId("submitter-test-user-select").click();
			await page.getByRole("option", { name: "Casey" }).click();
			await page.getByTestId("submitter-test-run").click();
			const caseyResult = page.getByTestId("submitter-test-result");
			await expect(caseyResult).toBeVisible({ timeout: 15_000 });
			await expect(page.getByTestId("submitter-test-step-2")).toContainText("Riley");
			await expect(page.getByTestId("submitter-test-step-2")).toContainText("Morgan");
			await expect(page.getByTestId("submitter-test-step-2")).toContainText("Pat");
			await expect(page.getByTestId("submitter-test-step-2")).not.toContainText("Casey");
			await expect(page.getByTestId("submitter-test-step-3")).toContainText("Dana");
			await expect(page.getByTestId("submitter-test-step-1")).toHaveCount(0);
			await page.getByTestId("submitter-test-close").click();

			// Publish the corrected root default.
			await expect(page.getByTestId("route-editor-publish")).toBeEnabled();
			await page.getByTestId("route-editor-publish").click();
			await expect(editor.getByText(/Published \(version/)).toBeVisible({ timeout: 15_000 });

			const publishedList = page.getByTestId("chains-published-list-REQUEST");
			await expect(publishedList.locator('[data-testid^="chains-published-route-"]')).toHaveCount(
				1,
				{ timeout: 15_000 },
			);

			const prisma = prismaClient();
			try {
				const published = await prisma.approval_route_versions.findMany({
					where: {
						scopeUnitId: "cs-unit-company",
						phase: "REQUEST",
						status: "PUBLISHED",
					},
					select: { id: true, version: true },
				});
				expect(published).toHaveLength(1);
				const retired = await prisma.approval_route_versions.count({
					where: {
						scopeUnitId: "cs-unit-company",
						phase: "REQUEST",
						status: "RETIRED",
					},
				});
				expect(retired).toBeGreaterThanOrEqual(1);
			} finally {
				await prisma.$disconnect();
			}
		} finally {
			await session.context.close();
		}
	});

	test("restart a stranded attempt with a reason through the real dialog", async ({ browser }) => {
		test.setTimeout(240_000);
		await retireJourneyStrandedFixtures();
		await createStrandedAttemptFixture();
		const session = await openSignedIn(browser, EMAIL.admin);
		const page = session.page;
		try {
			await page.setViewportSize({ width: 1280, height: 720 });
			await page.goto("/admin/organization?panel=chains");
			const panel = page.getByTestId("chains-panel");
			await expect(panel).toBeVisible({ timeout: 20_000 });

			const strandedRow = page.getByTestId(`chains-stranded-${STRANDED_INSTANCE_ID}`);
			await expect(strandedRow).toBeVisible({ timeout: 20_000 });
			await expect(strandedRow).toContainText("REQUEST");
			await page.getByTestId(`chains-stranded-restart-${STRANDED_INSTANCE_ID}`).click();

			const dialog = page.getByTestId("restart-attempt-dialog");
			await expect(dialog).toBeVisible();
			const preview = page.getByTestId("restart-preview");
			await expect(preview).toBeVisible({ timeout: 30_000 });
			await expect(preview).toContainText(/Riley/);
			await expect(preview).toContainText(/Dana/);
			await expect(page.getByTestId("restart-confirm")).toBeDisabled();

			await page.getByTestId("restart-reason-input").fill(RESTART_REASON);
			await expect(page.getByTestId("restart-confirm")).toBeEnabled();
			await page.getByTestId("restart-confirm").click();
			await expect(dialog.getByText(/Restarted\. The old attempt is preserved as history\./)).toBeVisible({
				timeout: 30_000,
			});

			const prisma = prismaClient();
			try {
				const adminId = await userIdByEmail(prisma, EMAIL.admin);
				const oldInstance = await prisma.approval_instances.findUniqueOrThrow({
					where: { id: STRANDED_INSTANCE_ID },
					select: { supersededAt: true },
				});
				expect(oldInstance.supersededAt).not.toBeNull();
				const next = await prisma.approval_instances.findFirstOrThrow({
					where: { restartOfInstanceId: STRANDED_INSTANCE_ID },
					select: {
						id: true,
						restartReason: true,
						restartedById: true,
						state: true,
						supersededAt: true,
					},
				});
				expect(next.restartReason).toBe(RESTART_REASON);
				expect(next.restartedById).toBe(adminId);
				expect(next.supersededAt).toBeNull();
				const activity = await prisma.request_activities.findFirstOrThrow({
					where: {
						action: "restarted_stranded_attempt",
						requestId: STRANDED_REQUEST_ID,
						comments: RESTART_REASON,
					},
					select: { userId: true },
				});
				expect(activity.userId).toBe(adminId);
			} finally {
				await prisma.$disconnect();
			}
		} finally {
			try {
				await retireJourneyStrandedFixtures();
			} finally {
				await session.context.close();
			}
		}
	});
});
