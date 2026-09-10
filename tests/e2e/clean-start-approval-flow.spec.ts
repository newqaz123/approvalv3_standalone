import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { PrismaClient, type Prisma } from "@prisma/client";
import {
	createCleanStartPhaseAttemptTx,
	restartStrandedAttempt as restartStrandedAttemptOnPorts,
	type CleanStartAttemptStore,
	type RestartAttemptRecord,
	type RestartStrandedPorts,
} from "@/lib/approval-engine/attempts";

const REQUIRED_BASE = "http://localhost:3100";
const LOCAL_PASSWORD = process.env.E2E_PASSWORD || "changeme";

const EMAIL = {
	admin: "admin@example.com",
	alice: "alice@example.com",
	casey: "casey@example.com",
	quinn: "quinn@example.com",
	riley: "riley@example.com",
	pat: "pat@example.com",
} as const;

test.beforeAll(() => {
	if (process.env.TEST_BASE_URL !== REQUIRED_BASE) {
		throw new Error(
			`B14 approval-flow specs require TEST_BASE_URL=${REQUIRED_BASE} (got ${String(process.env.TEST_BASE_URL)})`,
		);
	}
	guardedDatabaseUrl();
});

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

async function fillRequestDescription(dialog: Locator, text: string): Promise<void> {
	const editor = dialog.locator('[contenteditable="true"]').first();
	await expect(editor).toBeVisible({ timeout: 20_000 });
	await editor.click();
	await editor.fill(text);
}

async function submitRequest(page: Page, title: string, description: string): Promise<void> {
	await page.goto("/requests");
	await page.getByRole("button", { name: "New Request" }).click();
	const dialog = page.getByRole("dialog");
	await expect(dialog.getByRole("heading", { name: "Submit New Request" })).toBeVisible();
	await dialog.locator("#title").fill(title);
	await fillRequestDescription(dialog, description);
	await dialog.getByRole("button", { name: "Submit Request" }).click();
	await expect(page.getByText("Request created successfully")).toBeVisible({ timeout: 30_000 });
}

async function openRequestByTitle(page: Page, title: string, path = "/requests"): Promise<Locator> {
	await page.goto(path);
	const row = page.getByRole("row", { name: new RegExp(`Open request ${escapeRegExp(title)}`) });
	await expect(row).toBeVisible({ timeout: 20_000 });
	await row.click();
	const dialog = page.getByRole("dialog");
	await expect(dialog).toBeVisible({ timeout: 20_000 });
	await expect(dialog.getByRole("heading", { name: "Loading request" })).toHaveCount(0, {
		timeout: 20_000,
	});
	return dialog;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function pendingCount(page: Page): Promise<number> {
	const response = await page.request.get("/api/actions/pending-count");
	expect(response.ok()).toBeTruthy();
	const body = (await response.json()) as { count?: number };
	return Number(body.count ?? 0);
}

function uniqueTitle(label: string): string {
	return `B14 ${label} ${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

test.describe("clean-start approval flow (option A)", () => {
	test("Alice submits; own-team Leads see the action, reports-to and ancestors do not", async ({
		browser,
	}) => {
		test.setTimeout(180_000);
		const title = uniqueTitle("option-A");
		const alice = await openSignedIn(browser, EMAIL.alice);
		try {
			await submitRequest(alice.page, title, "Option A path request");
		} finally {
			await alice.context.close();
		}

		const casey = await openSignedIn(browser, EMAIL.casey);
		try {
			await expect.poll(() => pendingCount(casey.page)).toBeGreaterThan(0);
			const caseyDialog = await openRequestByTitle(casey.page, title, "/requests/my-actions");
			await expect(caseyDialog.getByRole("button", { name: "Approve" })).toBeVisible({
				timeout: 20_000,
			});
		} finally {
			await casey.context.close();
		}

		const quinn = await openSignedIn(browser, EMAIL.quinn);
		try {
			const quinnDialog = await openRequestByTitle(quinn.page, title, "/requests/my-actions");
			await expect(quinnDialog.getByRole("button", { name: "Approve" })).toBeVisible({
				timeout: 20_000,
			});
		} finally {
			await quinn.context.close();
		}

		for (const email of [EMAIL.riley, EMAIL.pat]) {
			const session = await openSignedIn(browser, email);
			try {
				await session.page.goto("/requests/my-actions");
				await expect(session.page.getByText(title)).toHaveCount(0);
				const viewerDialog = await openRequestByTitle(session.page, title, "/requests");
				await expect(viewerDialog.getByRole("button", { name: "Approve" })).toHaveCount(0);
			} finally {
				await session.context.close();
			}
		}
	});

	test("two candidates both see the action; second click conflicts with no double transition", async ({
		browser,
	}) => {
		test.setTimeout(180_000);
		const title = uniqueTitle("first-wins");
		const alice = await openSignedIn(browser, EMAIL.alice);
		try {
			await submitRequest(alice.page, title, "First-decision-wins request");
		} finally {
			await alice.context.close();
		}

		const casey = await openSignedIn(browser, EMAIL.casey);
		const quinn = await openSignedIn(browser, EMAIL.quinn);
		const prisma = prismaClient();
		try {
			await openRequestByTitle(casey.page, title, "/requests/my-actions");
			await openRequestByTitle(quinn.page, title, "/requests/my-actions");
			await expect(casey.page.getByRole("button", { name: "Approve" })).toBeVisible();
			await expect(quinn.page.getByRole("button", { name: "Approve" })).toBeVisible();

			await casey.page.getByRole("button", { name: "Approve" }).click();
			await casey.page.getByRole("button", { name: "Confirm Approval" }).click();
			await expect(casey.page.getByText("Approved successfully")).toBeVisible({ timeout: 30_000 });

			await quinn.page.getByRole("button", { name: "Approve" }).click();
			await quinn.page.getByRole("button", { name: "Confirm Approval" }).click();
			await expect(
				quinn.page.getByText(
					/no longer pending|changed concurrently|An error occurred while approving/i,
				),
			).toBeVisible({ timeout: 30_000 });

			const request = await prisma.requests.findFirst({
				where: { title },
				include: {
					approvals: { orderBy: { order: "asc" } },
				},
			});
			expect(request).toBeTruthy();
			expect(request?.status).toBe("ImprovementRequest");
			const approved = (request?.approvals ?? []).filter((row) => row.status === "approved");
			expect(approved).toHaveLength(1);
			expect(approved[0]?.order).toBe(1);
		} finally {
			await prisma.$disconnect();
			await casey.context.close();
			await quinn.context.close();
		}
	});

	test("rejection returns the request for revision", async ({ browser }) => {
		test.setTimeout(180_000);
		const title = uniqueTitle("reject-revision");
		const alice = await openSignedIn(browser, EMAIL.alice);
		try {
			await submitRequest(alice.page, title, "Rejection returns for revision");
		} finally {
			await alice.context.close();
		}

		const casey = await openSignedIn(browser, EMAIL.casey);
		try {
			await openRequestByTitle(casey.page, title, "/requests/my-actions");
			await casey.page.getByRole("button", { name: "Reject" }).click();
			await casey.page
				.getByPlaceholder("Please explain the reason for rejection...")
				.fill("B14 revision return");
			await casey.page.getByRole("button", { name: "Confirm Rejection" }).click();
			await expect(casey.page.getByText("Rejected successfully")).toBeVisible({
				timeout: 30_000,
			});
		} finally {
			await casey.context.close();
		}

		const aliceAgain = await openSignedIn(browser, EMAIL.alice);
		try {
			await openRequestByTitle(aliceAgain.page, title, "/requests");
			await expect(
				aliceAgain.page.getByRole("heading", { name: /Resubmit Request|Rejected Request/ }),
			).toBeVisible();
		} finally {
			await aliceAgain.context.close();
		}
	});

	test("admin restarts a stranded attempt with reason; old decisions are preserved", async ({
		browser,
	}) => {
		test.setTimeout(180_000);
		const title = uniqueTitle("stranded-restart");
		const alice = await openSignedIn(browser, EMAIL.alice);
		try {
			await submitRequest(alice.page, title, "Stranded restart request");
		} finally {
			await alice.context.close();
		}

		const casey = await openSignedIn(browser, EMAIL.casey);
		try {
			await openRequestByTitle(casey.page, title, "/requests/my-actions");
			await casey.page.getByRole("button", { name: "Approve" }).click();
			await casey.page.getByRole("button", { name: "Confirm Approval" }).click();
			await expect(casey.page.getByText("Approved successfully")).toBeVisible({
				timeout: 30_000,
			});
		} finally {
			await casey.context.close();
		}

		const prisma = prismaClient();
		try {
			const request = await prisma.requests.findFirst({
				where: { title },
				include: {
					approvals: true,
					approvalInstances: { orderBy: { attempt: "asc" } },
				},
			});
			expect(request).toBeTruthy();
			const oldInstance = request?.approvalInstances.find((row) => row.supersededAt == null);
			expect(oldInstance).toBeTruthy();
			const approvedBefore = (request?.approvals ?? []).filter((row) => row.status === "approved");
			expect(approvedBefore.length).toBeGreaterThan(0);

			const memberUserIds = [
				...new Set(
					(
						await prisma.approval_candidate_group_members.findMany({
							where: {
								candidateGroup: { approvalInstanceId: oldInstance!.id },
							},
							select: { userId: true },
						})
					).map((row) => row.userId),
				),
			];
			expect(memberUserIds.length).toBeGreaterThan(0);
			await prisma.user.updateMany({
				where: { id: { in: memberUserIds } },
				data: { isActive: false },
			});

			const admin = await prisma.user.findUniqueOrThrow({
				where: { email: EMAIL.admin },
				select: { id: true },
			});
			const result = await prisma.$transaction((tx) =>
				restartStrandedAttemptOnPorts(createSpecRestartPorts(tx, admin.id), {
					instanceId: oldInstance!.id,
					reason: "B14 stranded restart",
				}),
			);

			const oldAfter = await prisma.approval_instances.findUniqueOrThrow({
				where: { id: result.oldInstanceId },
				include: { requestApprovals: true },
			});
			const next = await prisma.approval_instances.findUniqueOrThrow({
				where: { id: result.newInstanceId },
			});
			expect(oldAfter.supersededAt).not.toBeNull();
			expect(oldAfter.requestApprovals.filter((row) => row.status === "approved").length).toBe(
				approvedBefore.length,
			);
			expect(next.restartOfInstanceId).toBe(oldAfter.id);
			expect(next.restartReason).toBe("B14 stranded restart");
			expect(next.restartedById).toBe(admin.id);

			await prisma.user.updateMany({
				where: { id: { in: memberUserIds } },
				data: { isActive: true },
			});
		} finally {
			await prisma.$disconnect();
		}

		const aliceAgain = await openSignedIn(browser, EMAIL.alice);
		try {
			await openRequestByTitle(aliceAgain.page, title, "/requests");
			await expect(aliceAgain.page.getByRole("dialog")).toBeVisible();
		} finally {
			await aliceAgain.context.close();
		}
	});
});

function createSpecRestartPorts(db: Prisma.TransactionClient, adminId: string): RestartStrandedPorts {
	return {
		requireAdmin: async () => adminId,
		async loadAttemptForRestart(instanceId: string): Promise<RestartAttemptRecord | null> {
			const instance = await db.approval_instances.findUnique({
				where: { id: instanceId },
				include: { candidateGroups: { include: { members: true } } },
			});
			if (!instance) return null;
			const userIds = [
				...new Set(
					instance.candidateGroups.flatMap((group) => group.members.map((member) => member.userId)),
				),
			];
			const users =
				userIds.length === 0
					? []
					: await db.user.findMany({
							where: { id: { in: userIds } },
							select: { id: true, isActive: true },
						});
			const active = new Map(users.map((user) => [user.id, user.isActive]));
			return {
				id: instance.id,
				phase: instance.phase,
				requestId: instance.requestId,
				solutionId: instance.solutionId,
				originUserId: instance.originUserId,
				attempt: instance.attempt,
				state: instance.state,
				supersededAt: instance.supersededAt,
				candidateGroups: instance.candidateGroups.map((group) => ({
					members: group.members.map((member) => ({
						userId: member.userId,
						user: { isActive: active.get(member.userId) === true },
					})),
				})),
			};
		},
		attemptTx: createCleanStartPhaseAttemptTx(db as unknown as CleanStartAttemptStore),
		request_activities: {
			create: (args) =>
				db.request_activities.create({
					data: {
						userId: args.data.userId,
						action: args.data.action,
						comments: args.data.comments ?? undefined,
						...(args.data.requestId ? { requestId: args.data.requestId } : {}),
					},
				}),
		},
	};
}
