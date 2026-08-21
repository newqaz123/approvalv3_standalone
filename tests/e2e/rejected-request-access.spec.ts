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
	await page.goto("/test-harness/rejected-request-access");
	await expect(
		page.getByRole("heading", { name: "Rejected Request Access Test Harness" }),
	).toBeVisible();
}

test.describe("rejected request access", () => {
	test("engineers receive a read-only rejected-request view", async ({ page }) => {
		await openHarness(page);
		await page.locator('[data-open-view="engineer"]').click();

		const dialog = page.getByRole("dialog");
		await expect(
			dialog.getByRole("heading", { name: "Rejected Request", exact: true }),
		).toBeVisible();
		await expect(
			dialog.getByRole("button", { name: "Resubmit Request", exact: true }),
		).toHaveCount(0);
		await expect(dialog.getByRole("textbox", { name: /Request Title/ })).toBeDisabled();
		await expect(dialog.locator('[contenteditable]').first()).toHaveAttribute(
			"contenteditable",
			"false",
		);
		await expect(dialog.getByRole("button", { name: "Bold" })).toBeDisabled();
		await expect(dialog.getByRole("button", { name: "Add link" })).toBeDisabled();
		await expect(dialog.getByText("Add New Attachments", { exact: true })).toHaveCount(0);
		await expect(dialog.getByTitle("Remove file")).toHaveCount(0);
	});

	test("the original requester retains the editable resubmit action", async ({ page }) => {
		await openHarness(page);
		await page.locator('[data-open-view="requester"]').click();

		const dialog = page.getByRole("dialog");
		await expect(
			dialog.getByRole("heading", { name: "Resubmit Request", exact: true }),
		).toBeVisible();
		await expect(dialog.getByRole("textbox", { name: /Request Title/ })).toBeEnabled();
		await expect(dialog.locator('[contenteditable]').first()).toHaveAttribute(
			"contenteditable",
			"true",
		);
		await dialog.getByRole("button", { name: "Resubmit Request", exact: true }).click();
		await expect(page.locator("[data-resubmit-call-count]")).toHaveText("1");
	});
});
