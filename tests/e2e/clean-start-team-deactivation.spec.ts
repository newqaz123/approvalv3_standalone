import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const REQUIRED_BASE = "http://localhost:3100";
const LOCAL_PASSWORD = process.env.E2E_PASSWORD || "changeme";

/**
 * The team-deactivation spec mutates the shared dev database (creates and
 * deactivates its own units, assignments, and team), so it uses the same
 * guarded direct connection the approval-flow and unit-deactivation specs
 * use: app_cleanstart_dev only, never a protected or CI database. The live
 * dev database holds the owner's real organization; this spec touches ONLY
 * its own TeamDeact-prefixed fixture rows (never the owner's units, people,
 * teams, or assignments).
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
			`team-deactivation spec requires TEST_BASE_URL=${REQUIRED_BASE} (got ${String(process.env.TEST_BASE_URL)})`,
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

test.describe("clean-start team deactivation", () => {
	/**
	 * Per-run unique suffix: every persistent row this spec creates (the unit,
	 * the three assignments, the team) carries it or the shared TeamDeact
	 * fixture-user prefix, and cleanup is prefix-scoped so two consecutive runs
	 * both pass without reseeding (the C7/C10/unit-deactivation pattern:
	 * deactivate, never hard-delete). Uniqueness applies to ACTIVE rows only,
	 * so the deactivated history rows an earlier run left behind cannot collide.
	 */
	const RUN = `${process.pid.toString(36)}-${Date.now().toString(36)}`;
	const UNIT_NAME = `TeamDeact Unit #${RUN}`;
	const TEAM_NAME = `TeamDeact Removal #${RUN}`;
	const UNIT_PREFIX = "TeamDeact Unit";
	const TEAM_PREFIX = "TeamDeact Removal";

	/**
	 * Fixture accounts (prefix-scoped, never signed in: passwordHash stays
	 * null). Upserted idempotently before the UI runs so the spec never
	 * borrows the owner's real people: the team's reports-to and both members
	 * are this spec's own users, assigned into this spec's own unit.
	 */
	const FIXTURE_USERS = [
		{ email: "teamdeact-lead@example.com", name: "TeamDeact Lead" },
		{ email: "teamdeact-member-one@example.com", name: "TeamDeact Member One" },
		{ email: "teamdeact-member-two@example.com", name: "TeamDeact Member Two" },
	] as const;
	const FIXTURE_EMAILS = FIXTURE_USERS.map((row) => row.email);

	async function ensureFixtureUsers(): Promise<void> {
		const prisma = prismaClient();
		try {
			for (const row of FIXTURE_USERS) {
				await prisma.user.upsert({
					where: { email: row.email },
					update: { name: row.name, isActive: true },
					create: {
						email: row.email,
						name: row.name,
						passwordHash: null,
						role: "general_dept",
						isActive: true,
						forcePasswordChange: true,
					},
				});
			}
		} finally {
			await prisma.$disconnect();
		}
	}

	/**
	 * Rerun isolation (deactivate-only, prefix-scoped): clear any TeamDeact
	 * membership still pointing at this spec's teams, deactivate this spec's
	 * fixture assignments (one active assignment per user blocks a fresh
	 * assign otherwise), deactivate leftover TeamDeact teams, then units.
	 * Nothing is ever deleted and the owner's rows are never matched.
	 * Failures throw so a broken cleanup fails the run instead of poisoning
	 * the next one.
	 */
	async function deactivateLeftoverFixtures(): Promise<void> {
		const prisma = prismaClient();
		try {
			const prefixedTeams = await prisma.teams.findMany({
				where: { name: { startsWith: TEAM_PREFIX } },
				select: { id: true },
			});
			if (prefixedTeams.length > 0) {
				await prisma.organization_assignments.updateMany({
					where: { teamId: { in: prefixedTeams.map((row) => row.id) } },
					data: { teamId: null },
				});
				await prisma.teams.updateMany({
					where: { id: { in: prefixedTeams.map((row) => row.id) }, isActive: true },
					data: { isActive: false },
				});
			}
			await prisma.organization_assignments.updateMany({
				where: { user: { email: { in: FIXTURE_EMAILS } }, isActive: true },
				data: { isActive: false, deactivatedAt: new Date() },
			});
			await prisma.organization_units.updateMany({
				where: { name: { startsWith: UNIT_PREFIX }, isActive: true },
				data: { isActive: false },
			});
			expect(
				await prisma.teams.count({ where: { name: { startsWith: TEAM_PREFIX }, isActive: true } }),
			).toBe(0);
			expect(
				await prisma.organization_units.count({
					where: { name: { startsWith: UNIT_PREFIX }, isActive: true },
				}),
			).toBe(0);
			expect(
				await prisma.organization_assignments.count({
					where: { user: { email: { in: FIXTURE_EMAILS } }, isActive: true },
				}),
			).toBe(0);
		} finally {
			await prisma.$disconnect();
		}
	}

	test("create a team with two members, refuse with members assigned, move them to No team, deactivate from the panel, it disappears", async ({
		browser,
	}) => {
		test.setTimeout(240_000);
		await deactivateLeftoverFixtures();
		await ensureFixtureUsers();

		// Fixture identity for assertions (ids never assumed).
		const setup = prismaClient();
		let leadId = "";
		let memberOneId = "";
		let memberTwoId = "";
		let reportsToPositionName = "";
		let memberPositionName = "";
		try {
			const [lead, memberOne, memberTwo] = await Promise.all(
				FIXTURE_USERS.map((row) =>
					setup.user.findUniqueOrThrow({
						where: { email: row.email },
						select: { id: true },
					}),
				),
			);
			leadId = lead.id;
			memberOneId = memberOne.id;
			memberTwoId = memberTwo.id;
			// Reports-to must rank strictly above every member: pick the highest
			// active position for the lead and the lowest for the members.
			const positions = await setup.positions.findMany({
				where: { isActive: true },
				select: { name: true, rank: true },
				orderBy: { rank: "desc" },
			});
			expect(positions.length).toBeGreaterThanOrEqual(2);
			expect(positions[0].rank).toBeGreaterThan(positions[positions.length - 1].rank);
			reportsToPositionName = positions[0].name;
			memberPositionName = positions[positions.length - 1].name;
		} finally {
			await setup.$disconnect();
		}

		const session = await openSignedIn(browser, EMAIL.admin);
		const page = session.page;
		try {
			await page.setViewportSize({ width: 1280, height: 720 });
			await page.goto("/admin/organization");
			await expect(page.getByTestId("organization-tree")).toBeVisible({ timeout: 20_000 });

			// The live dev database holds the owner's real units, so the parent is
			// chosen dynamically: every active unit is a legal parent and creating
			// a child mutates nothing else (unit-deactivation spec pattern).
			await page.getByTestId("create-unit-open").click();
			const dialog = page.getByTestId("create-unit-dialog");
			await expect(dialog).toBeVisible();
			await page.getByTestId("create-unit-name-input").fill(UNIT_NAME);
			await page.getByTestId("create-unit-parent-select").click();
			const parentOption = page.getByRole("option").first();
			await parentOption.click();
			await page.getByTestId("create-unit-save").click();
			await expect(dialog).toHaveCount(0);

			const db = prismaClient();
			let unitId = "";
			try {
				const created = await db.organization_units.findFirstOrThrow({
					where: { name: UNIT_NAME, isActive: true },
					select: { id: true },
				});
				unitId = created.id;
			} finally {
				await db.$disconnect();
			}
			await expect(page.getByTestId(`unit-name-${unitId}`)).toBeVisible({ timeout: 15_000 });

			// Assign this spec's three fixture users into this spec's unit via the
			// UI: lead on the highest active position, both members on the lowest.
			// A fresh page load per assign sidesteps a PREEXISTING PersonAssignmentPanel
			// quirk (out of scope here, disclosed in the task report): after the
			// panel's user-switch reset, Radix keeps the previously selected item as
			// internal state, so picking the SAME unit for the next person fires no
			// onValueChange and the Assign button stays disabled. A remounted panel
			// (fresh navigation) has clean internal state.
			for (const [userId, positionName] of [
				[leadId, reportsToPositionName],
				[memberOneId, memberPositionName],
				[memberTwoId, memberPositionName],
			] as const) {
				await page.goto("/admin/organization");
				await expect(page.getByTestId("organization-tree")).toBeVisible({ timeout: 20_000 });
				await page.getByTestId(`unassigned-person-${userId}`).click();
				const panel = page.getByTestId("person-assignment-panel");
				await expect(panel).toBeVisible();
				await page.getByTestId("assignment-unit-select").click();
				await page.getByRole("option", { name: UNIT_NAME, exact: true }).click();
				await page.getByTestId("assignment-position-select").click();
				await page.getByRole("option", { name: positionName, exact: true }).click();
				await page.getByTestId("assignment-save").click();
				await expect(page.getByTestId(`unassigned-person-${userId}`)).toHaveCount(0, {
					timeout: 15_000,
				});
			}

			// Create the team via the unit panel: unique per-run name, this spec's
			// lead as reports-to, both fixture members checked.
			await page.getByTestId(`unit-header-${unitId}`).click();
			await expect(page.getByTestId("unit-side-panel")).toBeVisible();
			await page.getByTestId("unit-create-team").click();
			const teamPanel = page.getByTestId("team-panel");
			await expect(teamPanel.getByText("Create team")).toBeVisible();
			await page.getByTestId("team-name-input").fill(TEAM_NAME);
			await page.getByTestId("team-reports-to-select").click();
			await page
				.getByRole("option", { name: new RegExp(`TeamDeact Lead.*${reportsToPositionName}`) })
				.click();
			await page.getByRole("checkbox", { name: /TeamDeact Member One/ }).check();
			await page.getByRole("checkbox", { name: /TeamDeact Member Two/ }).check();
			await page.getByTestId("team-save").click();

			// Await successful persistence, then resolve the created team id.
			await expect(page.getByTestId(`person-chip-${leadId}`).getByText(TEAM_NAME)).toBeVisible({
				timeout: 15_000,
			});
			const created = prismaClient();
			let teamId = "";
			let reportsToAssignmentId = "";
			try {
				const team = await created.teams.findFirstOrThrow({
					where: { name: TEAM_NAME, isActive: true },
					select: { id: true, reportsToAssignmentId: true, unitId: true },
				});
				expect(team.unitId).toBe(unitId);
				teamId = team.id;
				reportsToAssignmentId = team.reportsToAssignmentId;
				const members = await created.organization_assignments.findMany({
					where: { userId: { in: [memberOneId, memberTwoId] }, isActive: true },
					select: { userId: true, teamId: true },
				});
				expect(members.map((row) => row.teamId).sort()).toEqual([teamId, teamId]);
			} finally {
				await created.$disconnect();
			}
			await expect(page.getByTestId(`team-group-${teamId}`)).toBeVisible();

			// Guard fires in the UI: deactivation with members still assigned is
			// refused with an adjacent error naming a member, and nothing changes.
			await page.getByTestId(`team-select-${teamId}`).click();
			await expect(teamPanel.getByText("Manage team")).toBeVisible();
			await page.getByTestId("team-deactivate").click();
			await expect(page.getByTestId("team-deactivate-confirmation")).toBeVisible();
			await expect(page.getByTestId("team-deactivate-confirmation")).toContainText(TEAM_NAME);
			await page.getByTestId("team-deactivate-confirm").click();
			const guardError = page.getByTestId("team-deactivate-error");
			await expect(guardError).toBeVisible({ timeout: 15_000 });
			await expect(guardError).toContainText("TeamDeact Member One");
			await expect(guardError).toContainText("assigned");
			// the confirmation step is retained on failure (panel error pattern)
			await expect(page.getByTestId("team-deactivate-cancel")).toBeVisible();
			await page.getByTestId("team-deactivate-cancel").click();
			const refused = prismaClient();
			try {
				expect(
					(await refused.teams.findUniqueOrThrow({
						where: { id: teamId },
						select: { isActive: true },
					})).isActive,
				).toBe(true);
			} finally {
				await refused.$disconnect();
			}

			// Move both members to No team via the UI before retiring the team.
			// The person-chip testid sits on a block-level wrapper whose box spans
			// the full row, so its center is empty space beside the left-aligned
			// button — click the interactive button itself (the unassigned list's
			// flex-wrapped li shrinks to its button, which is why the assign phase
			// can click its wrapper directly).
			for (const memberUserId of [memberOneId, memberTwoId]) {
				await page.getByTestId(`person-chip-${memberUserId}`).getByRole("button").click();
				const movePanel = page.getByTestId("person-assignment-panel");
				await expect(movePanel).toBeVisible();
				await page.getByTestId("assignment-team-select").click();
				await page.getByRole("option", { name: "No team" }).click();
				await page.getByTestId("assignment-save").click();
				await page.getByTestId("assignment-move-confirm").click();
				await expect(movePanel.getByText("Current")).toHaveCount(0, { timeout: 15_000 });
			}

			// Deactivate from the panel; the tree hides the team group immediately.
			await page.getByTestId(`team-select-${teamId}`).click();
			await expect(teamPanel.getByText("Manage team")).toBeVisible();
			await page.getByTestId("team-deactivate").click();
			await page.getByTestId("team-deactivate-confirm").click();
			await expect(page.getByTestId(`team-group-${teamId}`)).toHaveCount(0, { timeout: 15_000 });
			await expect(page.getByTestId("team-panel")).toHaveCount(0);

			// Persistence is real in the database: isActive=false only, history
			// preserved, reports-to assignment untouched, audit written by admin.
			const verify = prismaClient();
			try {
				const teamRow = await verify.teams.findUniqueOrThrow({
					where: { id: teamId },
					select: { isActive: true, name: true, unitId: true, reportsToAssignmentId: true },
				});
				expect(teamRow.isActive).toBe(false);
				expect(teamRow.name).toBe(TEAM_NAME);
				expect(teamRow.unitId).toBe(unitId);
				// never reassigned: the deactivated team keeps the old reference
				expect(teamRow.reportsToAssignmentId).toBe(reportsToAssignmentId);

				const leadRow = await verify.organization_assignments.findUniqueOrThrow({
					where: { id: reportsToAssignmentId },
					select: { isActive: true, teamId: true },
				});
				expect(leadRow.isActive).toBe(true);
				expect(leadRow.teamId).toBeNull();

				const memberRows = await verify.organization_assignments.findMany({
					where: { userId: { in: [memberOneId, memberTwoId] }, isActive: true },
					select: { userId: true, teamId: true },
				});
				expect(memberRows).toHaveLength(2);
				for (const row of memberRows) expect(row.teamId).toBeNull();

				const admin = await verify.user.findFirstOrThrow({
					where: { email: EMAIL.admin },
					select: { id: true },
				});
				const activity = await verify.request_activities.findFirstOrThrow({
					where: { action: "team_deactivated", comments: { contains: teamId } },
					select: { userId: true, comments: true },
				});
				expect(activity.userId).toBe(admin.id);
				expect(activity.comments).toContain(TEAM_NAME);
			} finally {
				await verify.$disconnect();
			}
		} finally {
			try {
				// Isolate for the next run; a failure here fails the test.
				await deactivateLeftoverFixtures();
			} finally {
				await session.context.close();
			}
		}
	});
});
