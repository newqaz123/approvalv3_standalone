import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page) {
	await page.goto("/sign-in");
	await page.locator("#email").fill(process.env.E2E_ADMIN_EMAIL || "admin@example.com");
	await page
		.locator("#password")
		.fill(process.env.E2E_ADMIN_PASSWORD || "changeme");
	await page.getByRole("button", { name: "Sign in" }).click();
	await page.waitForURL((url) => !url.pathname.includes("/sign-in"));
}

async function openHarness(page: Page) {
	await signIn(page);
	await page.goto("/test-harness/approval-pending-state");
	await expect(page.getByRole("heading", { name: "Approval Pending State Test Harness" })).toBeVisible();
}

test.describe("approval action pending state", () => {
	test("Reject Solution stays disabled until its deferred callback settles", async ({
		page,
	}) => {
		await openHarness(page);
		await page.locator('[data-open-action="reject-solution"]').click();
		await page.getByRole("button", { name: "Reject" }).click();
		await page
			.getByPlaceholder("Please explain the reason for rejection...")
			.fill("Deferred rejection verification");

		const confirm = page.locator('[role="dialog"] button[aria-busy]');
		await expect(confirm).toHaveText("Confirm Rejection");
		await confirm.click();

		await expect(confirm).toBeDisabled();
		await expect(confirm).toHaveText(/Rejecting\.\.\./);
		await expect(confirm).toHaveAttribute("aria-busy", "true");
		await expect(page.locator("[data-pending-call-count]")).toHaveText("1");

		await confirm.evaluate((button: HTMLButtonElement) => button.click());
		await expect(page.locator("[data-pending-call-count]")).toHaveText("1");

		await page
			.locator("[data-resolve-pending]")
			.evaluate((button: HTMLButtonElement) => button.click());
		await expect(confirm).toBeEnabled();
		await expect(confirm).toHaveText("Confirm Rejection");
	});

	test("Start Final Approval stays disabled until its deferred callback settles", async ({
		page,
	}) => {
		await openHarness(page);
		await page.locator('[data-open-action="start-final-approval"]').click();

		const start = page.locator('[role="dialog"] button[aria-busy]');
		await expect(start).toHaveText("Start Final Approval");
		await start.click();

		await expect(start).toBeDisabled();
		await expect(start).toHaveText(/Starting\.\.\./);
		await expect(start).toHaveAttribute("aria-busy", "true");
		await expect(page.locator("[data-pending-call-count]")).toHaveText("1");

		await start.evaluate((button: HTMLButtonElement) => button.click());
		await expect(page.locator("[data-pending-call-count]")).toHaveText("1");

		await page
			.locator("[data-resolve-pending]")
			.evaluate((button: HTMLButtonElement) => button.click());
		await expect(start).toBeEnabled();
		await expect(start).toHaveText("Start Final Approval");
	});
});
