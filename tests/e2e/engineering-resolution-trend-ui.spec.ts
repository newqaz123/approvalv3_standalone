import { expect, test } from "@playwright/test";

/**
 * Focused behavioral coverage for the Engineering Resolution Trend work,
 * rendered through the E2E_UI_HARNESS=1-gated, server-action-free harness at
 * /test-harness/eng-resolution-trend. Run with the dev server started with
 * E2E_UI_HARNESS=1, e.g.:
 *
 *   TEST_BASE_URL=http://localhost:3100 npx playwright test tests/e2e/engineering-resolution-trend-ui.spec.ts
 */

const HARNESS_URL = "/test-harness/eng-resolution-trend";

test.describe("engineering resolution trend UI (harness)", () => {
	// The harness routes are 404/auth-gated unless the whole stack opts in:
	// skip cleanly when the Playwright process (and with it the managed
	// server) does not carry E2E_UI_HARNESS=1.
	const harnessEnabled = process.env.E2E_UI_HARNESS === "1";
	test.skip(
		!harnessEnabled,
		"E2E_UI_HARNESS=1 is required on the Playwright process/server; harness routes are gated otherwise",
	);

	// First navigation compiles the route in dev mode; allow generous time.
	test.setTimeout(120_000);

	test("cancel dialog shows persistent helper text and enables at exactly 5 characters", async ({
		page,
	}) => {
		await page.goto(HARNESS_URL);
		await page.getByRole("button", { name: "Cancel Request" }).first().click();

		const dialog = page.getByRole("alertdialog");
		await expect(dialog).toBeVisible();

		// Persistent helper text beneath the cancellation field.
		await expect(dialog.getByText("Minimum 5 characters.")).toBeVisible();

		const reason = dialog.getByPlaceholder(
			"Please explain why you're cancelling this request...",
		);
		const submit = dialog.getByRole("button", { name: "Cancel Request" });

		// 4 meaningful characters stay invalid.
		await reason.fill("abcd");
		await expect(submit).toBeDisabled();

		// The 5th character enables submission.
		await reason.fill("abcde");
		await expect(submit).toBeEnabled();

		// Successful injected callback (no server action, no DB write).
		await submit.click();
		await expect(page.locator("[data-cancel-call-count]")).toHaveText("1");
		await expect(page.locator("[data-cancel-last-reason]")).toHaveText("abcde");
		await expect(dialog).toBeHidden();
	});

	test("requests default to no WR; toggle off shows all; Clear All restores no WR", async ({
		page,
	}) => {
		await page.goto(HARNESS_URL);
		const section = page.locator("[data-harness-section='request-filters']");
		const toggle = section.getByRole("button", { name: "Show only no WR" });
		const rows = section.locator("[data-request-row]");
		const clearAll = section.getByRole("button", { name: "Clear All" });

		// Initial state: Show only no WR enabled, only no-WR rows visible.
		await expect(toggle).toHaveAttribute("aria-pressed", "true");
		await expect(rows).toHaveCount(2);
		await expect(page.locator("[data-current-wr-status]")).toHaveText(
			"not-received",
		);
		await expect(clearAll).toBeDisabled();

		// Toggling off shows all WR states.
		await toggle.click();
		await expect(toggle).toHaveAttribute("aria-pressed", "false");
		await expect(rows).toHaveCount(3);
		await expect(page.locator("[data-current-wr-status]")).toHaveText("all");
		await expect(clearAll).toBeEnabled();

		// Clear All restores the default no-WR state.
		await clearAll.click();
		await expect(toggle).toHaveAttribute("aria-pressed", "true");
		await expect(rows).toHaveCount(2);
		await expect(page.locator("[data-current-wr-status]")).toHaveText(
			"not-received",
		);
		await expect(clearAll).toBeDisabled();
	});

	test("trend chart exposes accessible title, legends, and tabular data without mobile overflow", async ({
		page,
	}) => {
		await page.goto(HARNESS_URL);

		// Accessible title and description (visually hidden equivalents).
		await expect(
			page.getByRole("heading", { name: "Engineering Resolution Trend", level: 3 }),
		).toBeAttached();
		await expect(
			page.getByText(
				"Open engineering backlog at period end versus requests resolved by Engineering during each period.",
			),
		).toBeAttached();

		// Legend labels for both series.
		await expect(page.getByText("Engineering unresolved").first()).toBeVisible();
		await expect(page.getByText("Resolved by Engineering").first()).toBeVisible();

		// Visually hidden tabular data equivalent.
		const table = page.getByRole("table");
		await expect(table).toBeAttached();
		await expect(table.getByRole("row")).toHaveCount(4);
		await expect(table.getByRole("row", { name: "Week 2 4 2" })).toBeAttached();

		// Sighted low-vision support: the resolved series must be
		// distinguishable from the unresolved series without relying on color
		// alone — darker green (>=3:1 non-text contrast, ratios asserted in
		// tests/regression/engineering-trend-chart-a11y.test.ts), a dashed
		// resolved line versus the solid unresolved line, and distinct legend
		// marker shapes.
		const resolvedCurve = page.locator(
			'path.recharts-line-curve[stroke="#15803d"]',
		);
		await expect(resolvedCurve.first()).toBeVisible();
		await expect(resolvedCurve.first()).toHaveAttribute(
			"stroke-dasharray",
			// Recharts emits unit-suffixed segments ("8px, 4px, ...") on the
			// curve path; the legend icon uses the raw prop ("8 4").
			/\d[\d.]*\s*(?:px)?[\s,]+\d/,
		);

		const unresolvedCurve = page.locator(
			'path.recharts-line-curve[stroke="#3b82f6"]',
		);
		await expect(unresolvedCurve.first()).toBeVisible();
		// Once the draw-in animation settles, only the resolved line keeps a
		// repeating dash pattern; the unresolved line must render solid.
		// Recharts leaves a degenerate full-length dash ("<total>px 0px") on
		// solid lines after the animation, so solidity = no non-zero gap.
		const solidAtRest = async () => {
			const dash = await unresolvedCurve
				.first()
				.getAttribute("stroke-dasharray");
			if (dash === null) return true;
			const nums = dash.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
			const gaps = nums.filter((_, i) => i % 2 === 1);
			return gaps.length > 0 && gaps.every((gap) => gap === 0);
		};
		await expect.poll(solidAtRest, { timeout: 10_000 }).toBe(true);

		// Legend markers differ by shape, not just color: circle marker for
		// the solid unresolved series, dashed plainline marker for resolved.
		const unresolvedLegend = page.locator("li.recharts-legend-item", {
			hasText: "Engineering unresolved",
		});
		const resolvedLegend = page.locator("li.recharts-legend-item", {
			hasText: "Resolved by Engineering",
		});
		await expect(unresolvedLegend.locator("path")).toHaveCount(1);
		await expect(unresolvedLegend.locator("line")).toHaveCount(0);
		const resolvedIcon = resolvedLegend.locator("line.recharts-legend-icon");
		await expect(resolvedIcon).toHaveCount(1);
		await expect(resolvedIcon).toHaveAttribute(
			"stroke-dasharray",
			/\d[\d.]*\s*(?:px)?[\s,]+\d/,
		);
		await expect(resolvedIcon).toHaveAttribute("stroke", "#15803d");

		// Mobile viewport: the chart must not create horizontal page overflow.
		await page.setViewportSize({ width: 375, height: 800 });
		await page.goto(HARNESS_URL);
		await expect(page.getByRole("table")).toBeAttached();
		const overflow = await page.evaluate(
			() =>
				document.documentElement.scrollWidth - document.documentElement.clientWidth,
		);
		expect(overflow).toBeLessThanOrEqual(1);
	});
});
