import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

const REQUIRED_BASE = "http://localhost:3100";
const LOCAL_PASSWORD = process.env.E2E_PASSWORD || "changeme";
const OPERATIONS_ID = "cs-unit-operations";

test.beforeAll(() => {
	if (process.env.TEST_BASE_URL !== REQUIRED_BASE) {
		throw new Error(
			`C4 organization-tree specs require TEST_BASE_URL=${REQUIRED_BASE} (got ${String(process.env.TEST_BASE_URL)})`,
		);
	}
	const url = process.env.DATABASE_URL ?? "";
	if (url) {
		if (/app_db|app_org_manual_7abcdf3|app_cleanstart_ci/.test(url)) {
			throw new Error("URL-GUARD: refused protected or CI database");
		}
		if (!/\/app_cleanstart_dev(\?|$)/.test(url)) {
			throw new Error("URL-GUARD: DATABASE_URL must target app_cleanstart_dev only");
		}
	}
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
