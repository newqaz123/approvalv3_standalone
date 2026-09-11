import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

const REQUIRED_BASE = "http://localhost:3100";
const LOCAL_PASSWORD = process.env.E2E_PASSWORD || "changeme";
const OPERATIONS_ID = "cs-unit-operations";
const SECTION_A_ID = "cs-unit-section-a";
const SECTION_A_CHILD_ID = "cs-unit-section-a-child";

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
