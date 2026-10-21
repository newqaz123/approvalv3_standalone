import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const REQUIRED_BASE = "http://localhost:3100";
const LOCAL_PASSWORD = process.env.E2E_PASSWORD || "changeme";

const EMAIL = {
	alice: "alice@example.com",
	bob: "bob@example.com",
	pat: "pat@example.com",
} as const;

test.beforeAll(() => {
	if (process.env.TEST_BASE_URL !== REQUIRED_BASE) {
		throw new Error(
			`B14 sharing-visibility specs require TEST_BASE_URL=${REQUIRED_BASE} (got ${String(process.env.TEST_BASE_URL)})`,
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

async function submitRequest(page: Page, title: string, description: string): Promise<void> {
	await page.goto("/requests");
	await page.getByRole("button", { name: "New Request" }).click();
	const dialog = page.getByRole("dialog");
	await expect(dialog.getByRole("heading", { name: "Submit New Request" })).toBeVisible();
	await dialog.locator("#title").fill(title);
	const editor = dialog.locator('[contenteditable="true"]').first();
	await expect(editor).toBeVisible({ timeout: 20_000 });
	await editor.click();
	await editor.fill(description);
	await dialog.getByRole("button", { name: "Submit Request" }).click();
	await expect(page.getByText("Request created successfully")).toBeVisible({ timeout: 30_000 });
}

function uniqueTitle(label: string): string {
	return `B14 ${label} ${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

test.describe("clean-start sharing visibility and participants-only notifications", () => {
	test("Pat sees A and B; Alice only A; Bob only B; Pat is not notified for a request he merely views", async ({
		browser,
	}) => {
		test.setTimeout(180_000);
		const titleA = uniqueTitle("share-A");
		const titleB = uniqueTitle("share-B");

		const alice = await openSignedIn(browser, EMAIL.alice);
		try {
			await submitRequest(alice.page, titleA, "Section A sharing request");
		} finally {
			await alice.context.close();
		}

		const bob = await openSignedIn(browser, EMAIL.bob);
		try {
			await submitRequest(bob.page, titleB, "Section B sharing request");
		} finally {
			await bob.context.close();
		}

		const pat = await openSignedIn(browser, EMAIL.pat);
		try {
			await pat.page.goto("/requests");
			const rowA = pat.page.getByRole("row", {
				name: new RegExp(`Open request ${escapeRegExp(titleA)}`),
			});
			const rowB = pat.page.getByRole("row", {
				name: new RegExp(`Open request ${escapeRegExp(titleB)}`),
			});
			await expect(rowA).toBeVisible({ timeout: 20_000 });
			await expect(rowB).toBeVisible({ timeout: 20_000 });
			await rowA.click();
			const dialog = pat.page.getByRole("dialog");
			await expect(dialog).toBeVisible();
			await expect(dialog.getByRole("heading", { name: "Loading request" })).toHaveCount(0, {
				timeout: 20_000,
			});
			await expect(dialog.getByRole("button", { name: "Approve" })).toHaveCount(0);
			await pat.page.keyboard.press("Escape");

			const bell = pat.page.getByRole("button").filter({
				has: pat.page.locator("svg.lucide-bell"),
			});
			await bell.click();
			const notificationList = pat.page.getByRole("heading", { name: "Notifications" });
			await expect(notificationList).toBeVisible();
			await expect(
				pat.page.locator("[data-radix-popper-content-wrapper]").getByText(titleA),
			).toHaveCount(0);
		} finally {
			await pat.context.close();
		}

		const aliceAgain = await openSignedIn(browser, EMAIL.alice);
		try {
			await aliceAgain.page.goto("/requests");
			await expect(
				aliceAgain.page.getByRole("row", {
					name: new RegExp(`Open request ${escapeRegExp(titleA)}`),
				}),
			).toBeVisible({ timeout: 20_000 });
			await expect(
				aliceAgain.page.getByRole("row", {
					name: new RegExp(`Open request ${escapeRegExp(titleB)}`),
				}),
			).toHaveCount(0);
		} finally {
			await aliceAgain.context.close();
		}

		const bobAgain = await openSignedIn(browser, EMAIL.bob);
		try {
			await bobAgain.page.goto("/requests");
			await expect(
				bobAgain.page.getByRole("row", {
					name: new RegExp(`Open request ${escapeRegExp(titleB)}`),
				}),
			).toBeVisible({ timeout: 20_000 });
			await expect(
				bobAgain.page.getByRole("row", {
					name: new RegExp(`Open request ${escapeRegExp(titleA)}`),
				}),
			).toHaveCount(0);
		} finally {
			await bobAgain.context.close();
		}

		const prisma = prismaClient();
		try {
			const patUser = await prisma.user.findUniqueOrThrow({
				where: { email: EMAIL.pat },
				select: { id: true },
			});
			const requestA = await prisma.requests.findFirstOrThrow({
				where: { title: titleA },
				select: { id: true },
			});
			const notes = await prisma.notifications.findMany({
				where: { userId: patUser.id, requestId: requestA.id },
			});
			expect(notes, "Pat must receive no notifications for a request he only viewed").toEqual([]);
		} finally {
			await prisma.$disconnect();
		}
	});
});

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
