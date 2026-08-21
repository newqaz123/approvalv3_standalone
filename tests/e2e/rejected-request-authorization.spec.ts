import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const requesterEmail = process.env.E2E_REQUESTER_EMAIL || "01@pd1.com";
const engineerEmail = process.env.E2E_ENGINEER_EMAIL || "01@eng.com";
const testPassword = process.env.E2E_USER_PASSWORD || "changeme";

let requestId = "";
let requestTitle = "";

async function signIn(page: Page, email: string) {
	await page.goto("/sign-in");
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(testPassword);
	await page.getByRole("button", { name: "Sign in" }).click();
	await page.waitForURL((url) => !url.pathname.includes("/sign-in"));
}

async function openRejectedRequest(page: Page, expectedHeading: string) {
	await page.goto("/requests");
	const row = page.locator("tbody tr").filter({ hasText: requestTitle });
	await expect(row).toHaveCount(1);
	await row.click();
	await expect(
		page
			.getByRole("dialog")
			.getByRole("heading", { name: expectedHeading, exact: true }),
	).toBeVisible({ timeout: 20_000 });
}

test.describe.serial("rejected request authorization", () => {
	test.beforeAll(async () => {
		const [requester, engineer] = await Promise.all([
			prisma.user.findUnique({
				where: { email: requesterEmail },
				select: { id: true, departmentId: true },
			}),
			prisma.user.findUnique({
				where: { email: engineerEmail },
				select: { id: true },
			}),
		]);
		if (!requester?.departmentId || !engineer) {
			throw new Error(
				`Rejected-request authorization E2E requires ${requesterEmail} and ${engineerEmail}`,
			);
		}

		requestTitle = `E2E rejected requester access ${randomUUID()}`;
		const request = await prisma.requests.create({
			data: {
				title: requestTitle,
				description: "Rejected request authorization fixture",
				status: "ImprovementRequest",
				requesterId: requester.id,
				departmentId: requester.departmentId,
			},
			select: { id: true },
		});
		requestId = request.id;
		await prisma.request_approvals.create({
			data: {
				requestId,
				requiredLevel: 2,
				order: 1,
				status: "rejected",
				isFinalApproval: false,
				comments: "Please revise and resubmit",
			},
		});
	});

	test.afterAll(async () => {
		if (requestId) {
			await prisma.requests.delete({ where: { id: requestId } }).catch(() => undefined);
		}
		await prisma.$disconnect();
	});

	test("an actual engineer cannot edit, resubmit, or cancel another requester's rejection", async ({
		page,
	}) => {
		await signIn(page, engineerEmail);
		await openRejectedRequest(page, "Rejected Request");

		const dialog = page.getByRole("dialog");
		await expect(
			dialog.getByRole("heading", { name: "Rejected Request", exact: true }),
		).toBeVisible();
		await expect(
			dialog.getByRole("button", { name: "Resubmit Request", exact: true }),
		).toHaveCount(0);
		await expect(
			dialog.getByRole("button", { name: "Cancel Request", exact: true }),
		).toHaveCount(0);
		await expect(dialog.getByRole("textbox", { name: /Request Title/ })).toBeDisabled();
	});

	test("the actual requester can resubmit or cancel the rejected request", async ({ page }) => {
		await signIn(page, requesterEmail);
		await openRejectedRequest(page, "Resubmit Request");

		const dialog = page.getByRole("dialog");
		await expect(
			dialog.getByRole("heading", { name: "Resubmit Request", exact: true }),
		).toBeVisible();
		await expect(
			dialog.getByRole("button", { name: "Resubmit Request", exact: true }),
		).toBeVisible();
		await expect(
			dialog.getByRole("button", { name: "Cancel Request", exact: true }),
		).toBeVisible();
		await expect(dialog.getByRole("textbox", { name: /Request Title/ })).toBeEnabled();
	});
});
