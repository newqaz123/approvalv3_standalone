import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("mobile Safari dialog sheet", () => {
	it("renders DialogContent as a bottom sheet on phones and centers it from sm up", () => {
		const dialog = read("src/components/ui/dialog.tsx");

		// Phone: full-width bottom sheet capped at the SMALL viewport height.
		// svh is stable when iOS toolbars collapse/expand; dvh changes height
		// mid-interaction, making the sheet jump up and hide its handle.
		assert.match(dialog, /inset-x-0 bottom-0/);
		assert.match(dialog, /rounded-t-2xl/);
		assert.match(dialog, /max-h-\[92svh\]/);
		assert.doesNotMatch(dialog, /dvh/);

		// Sheet-vs-card is keyed to POINTER, not width: a phone in landscape
		// (844px) or pinch-zoomed out (980px) is still a touch device and must
		// keep the bottom sheet + handle. Mouse devices get the centered card.
		assert.match(dialog, /pointer-fine:inset-x-auto/);
		assert.match(dialog, /pointer-fine:bottom-auto/);
		assert.match(dialog, /pointer-fine:left-1\/2 pointer-fine:top-1\/2/);
		assert.match(
			dialog,
			/pointer-fine:-translate-x-1\/2 pointer-fine:-translate-y-1\/2/,
		);
		assert.doesNotMatch(dialog, /sm:inset-x-auto|sm:bottom-auto|sm:-translate/);
	});

	it("keeps caller size utilities authoritative on desktop", () => {
		/*
		 * tailwind-merge cannot dedupe `sm:max-w-lg` against a caller's
		 * unprefixed `max-w-5xl` — the sm: variant would win at desktop and
		 * squeeze every large modal into a 512px card. All caps must be
		 * unprefixed in the base so callers override them via cn().
		 */
		const dialog = read("src/components/ui/dialog.tsx");
		const bases = [
			...dialog.matchAll(/className=\{cn\(\s*\n?\s*"([^"]*)/g),
		].map((m) => m[1]);
		const base = bases.find((b) => b.includes("inset-x-0 bottom-0")) ?? "";

		assert.ok(/(?:^|\s)max-w-lg(?:\s|$)/.test(base), "unprefixed max-w-lg");
		assert.doesNotMatch(base, /sm:max-w-/);
		assert.doesNotMatch(base, /sm:max-h-/);
		assert.doesNotMatch(base, /sm:rounded-/);
		// Same tailwind-merge trap for pointer-fine variants.
		assert.doesNotMatch(base, /pointer-fine:max-w-/);
		assert.doesNotMatch(base, /pointer-fine:max-h-/);
		// Individual modal callers still pass desktop vh caps. On touch devices
		// the shared sheet cap must win so iOS cannot place the header behind
		// Safari's toolbar.
		assert.match(base, /pointer-coarse:max-h-\[92svh\]/);
	});

	it("adds a mobile-only drag handle to the sheet", () => {
		const dialog = read("src/components/ui/dialog.tsx");

		// Solid, visible pill that floats ABOVE sticky z-20 headers (p-0 modals)
		// and captures its own gesture.
		assert.match(
			dialog,
			/z-30[^"“]*pointer-fine:hidden|pointer-fine:hidden[^"“]*z-30/,
		);
		assert.match(dialog, /pointer-events-auto/);
		assert.match(dialog, /bg-slate-300/);
		assert.match(dialog, /rounded-full/);
		assert.doesNotMatch(dialog, /muted-foreground\/30/);
		// Hidden only on pointer-fine (mouse) devices — never by width.
		assert.match(dialog, /pointer-fine:hidden/);
		assert.doesNotMatch(dialog, /sm:hidden/);
	});

	it("only closes the sheet when the handle is swiped down", () => {
		const dialog = read("src/components/ui/dialog.tsx");

		// Gesture capture: the swipe must not be eaten by content scrolling.
		assert.match(dialog, /touch-none/);
		assert.match(dialog, /onTouchStart/);
		assert.match(dialog, /onTouchMove/);
		assert.match(dialog, /onTouchEnd/);
		assert.match(dialog, /touchMovedRef/);
		assert.match(dialog, /touchMovedRef\.current/);
		assert.match(dialog, /clientY - start > 60/);
		// Tap must NOT close — only a downward drag does. A click handler fires
		// on every touch release, which made a mere touch dismiss the sheet.
		assert.doesNotMatch(dialog, /onClick=\{closeSheet\}/);

		// Programmatic close needs a bridge from Dialog root's onOpenChange.
		assert.match(dialog, /DialogCloseContext/);
		assert.match(dialog, /props\.onOpenChange\?\.\(false\)/);
	});

	it("uses Vaul's handle-only drag contract for the request drawer", () => {
		const drawer = read("src/components/mobile/request-drawer.tsx");

		// Vaul must receive the real Drawer.Handle. A decorative div leaves
		// Content responsible for pointer-up velocity, where a fast iPhone tap
		// can be misread as a downward dismissal.
		assert.match(drawer, /<Drawer\.Root[^>]*handleOnly/);
		assert.match(drawer, /<Drawer\.Handle[^>]*preventCycle/);
		assert.match(drawer, /data-testid="request-drawer-handle"/);
		assert.doesNotMatch(drawer, /mx-auto w-12 h-1\.5/);
	});

	it("keeps every mobile sheet at stable svh height so iOS toolbar changes never resize it", () => {
		const requestDrawer = read("src/components/mobile/request-drawer.tsx");
		const followUp = read("src/components/dashboard/follow-up-dashboard.tsx");

		assert.match(requestDrawer, /max-h-\[96svh\]/);
		assert.match(followUp, /h-\[88svh\]/);
		assert.doesNotMatch(requestDrawer, /dvh/);
		assert.doesNotMatch(followUp, /dvh/);

		// Mounting is JS-gated on pointer type so the Vaul sheet and the desktop
		// aside are never both open at once. CSS-only hiding left the Vaul sheet
		// open and it stole pointer events from the visible list, so tapping a
		// request never opened the detail modal.
		assert.doesNotMatch(followUp, /md:hidden/);
		assert.match(followUp, /useMediaQuery\(["']\(pointer: fine\)["']\)/);
		assert.match(followUp, /\{!isFinePointer && \(/);
		assert.match(followUp, /\{isFinePointer && drawer && \(/);
	});

	it("lets dialog children shrink instead of overflowing the sheet", () => {
		const css = read("src/app/globals.css");
		const dialog = read("src/components/ui/dialog.tsx");

		// :where() keeps specificity at zero so utility classes still win.
		assert.match(css, /:where\(\[role="dialog"\]\s*\*\)\s*\{/);
		assert.match(css, /min-width:\s*0/);
		assert.match(css, /overflow-wrap:\s*break-word/);

		// Belt and braces: nothing may poke out of the sheet horizontally.
		assert.match(dialog, /overflow-x-hidden/);
	});
});

describe("mobile modal content budgets", () => {
	const scrollAreas = [
		["src/components/requests/approver-modal.tsx", "140"],
		["src/components/requests/request-resubmit-modal.tsx", "180"],
		["src/components/requests/submitter-modal.tsx", "180"],
		["src/components/requests/completed-request-modal.tsx", "260"],
		["src/components/requests/completed-solution-modal.tsx", "140"],
		["src/components/requests/completed-final-modal.tsx", "260"],
		["src/components/requests/final-approval-modal.tsx", "140"],
		["src/components/requests/final-approval-resubmit-modal.tsx", "180"],
		["src/components/requests/solution-modal.tsx", "140"],
		["src/components/requests/status-modal.tsx", "140"],
		["src/components/requests/submit-final-approval-modal.tsx", "180"],
	] as const;

	for (const [file, offset] of scrollAreas) {
		it(`keeps the scroll area and footer inside the stable mobile sheet in ${file}`, () => {
			const source = read(file);

			assert.match(source, /min-h-0/);
			assert.match(
				source,
				new RegExp(`max-h-\\[calc\\(92svh-${offset}px\\)\\]`),
			);
			assert.match(
				source,
				new RegExp(`pointer-fine:max-h-\\[calc\\(90vh-${offset}px\\)\\]`),
			);
			assert.doesNotMatch(source, /style=\{\{\s*maxHeight:\s*["']calc\(90vh/);
		});
	}

	it("stacks the completed-final export footer on phones so Export Report stays on screen", () => {
		const source = read("src/components/requests/completed-final-modal.tsx");

		assert.match(
			source,
			/flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between/,
		);
		assert.match(source, /w-full sm:w-auto/);
	});

	it("stacks the completed-request footer so Submit Solution stays on screen", () => {
		const source = read("src/components/requests/completed-request-modal.tsx");
		const router = read("src/components/requests/request-modal-router.tsx");

		assert.match(
			source,
			/flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between/,
		);
		assert.match(source, /Submit Solution[\s\S]*?w-full sm:w-auto|w-full sm:w-auto[\s\S]*?Submit Solution/);
		assert.match(source, /canUserSubmitSolution/);
		assert.match(source, /userRole/);
		assert.match(router, /userRole=\{user\?\.role/);
	});
});

describe("mobile Safari input zoom", () => {
	it("keeps the rich text editor at 16px on phones so iOS does not auto-zoom", () => {
		const editor = read("src/components/rich-text/rich-text-editor.tsx");
		const editorClass =
			editor.match(/class:\s*\n?\s*["']([^"']*)["']/)?.[1] ?? "";
		const tokens = editorClass.split(/\s+/);

		assert.ok(tokens.includes("text-base"));
		assert.ok(tokens.includes("md:text-sm"));
		assert.ok(!tokens.includes("text-sm"));
	});
});

describe("mobile Safari date filters", () => {
	const files = [
		"src/components/requests/request-filters.tsx",
		"src/components/dashboard/table-filters.tsx",
	];

	for (const file of files) {
		it(`always renders native date inputs in ${file}`, () => {
			const source = read(file);

			assert.match(source, /type="date"/);
			assert.doesNotMatch(source, /showPicker/);
			assert.doesNotMatch(source, /type=\{filters\.date/);
		});

		it(`clips the native date control behind a matching filter box in ${file}`, () => {
			const source = read(file);

			// iOS date inputs keep an intrinsic width CSS cannot shrink. The visible
			// box must clip that chrome; the native input stays an invisible overlay
			// so the picker still works.
			assert.match(source, /date-filter-field/);
			assert.match(source, /overflow-hidden/);
			assert.match(source, /opacity-0/);
			assert.match(source, /absolute inset-0/);
		});
	}

	it("clips native date chrome inside the visible filter field", () => {
		const css = read("src/app/globals.css");

		assert.match(css, /\.date-filter-field\s*\{[^}]*overflow:\s*hidden/);
		assert.match(css, /clip-path:\s*inset\(0\)/);
		assert.match(
			css,
			/\.date-filter-field\s+input\[type="date"\]\s*\{[^}]*opacity:\s*0/,
		);
		assert.match(
			css,
			/input\[type="date"\]\s*\{[^}]*min-width:\s*0[^}]*max-width:\s*100%/,
		);
		assert.match(css, /-webkit-min-logical-width:\s*0/);
		assert.match(
			css,
			/input\[type="date"\]::-webkit-date-and-time-value\s*\{[\s\S]*?min-height:[\s\S]*?line-height:/,
		);
		// The edit fields themselves must stay on one line with no padding —
		// otherwise iOS wraps "16 Aug 2026" onto two lines and the box looks
		// taller than the sibling selects (WebKit renders these internals
		// even when the outer input has a fixed height).
		assert.match(css, /::-webkit-datetime-edit-fields-wrapper\s*\{/);
		assert.match(css, /white-space:\s*nowrap/);
		assert.match(
			css,
			/::-webkit-datetime-edit[^{]*\{[^}]*line-height:\s*1\.5rem/,
		);
	});
});

describe("attachment preview sheet budget", () => {
	it("keeps the file preview inside the mobile sheet instead of forcing vh heights", () => {
		const dialog = read("src/components/requests/file-preview-dialog.tsx");

		// The shared bottom sheet owns the height on touch devices; the preview
		// must not fight it with an unprefixed 88vh card or a 70vh iframe floor.
		assert.doesNotMatch(dialog, /(?<![-:\w])h-\[88vh\]/);
		assert.doesNotMatch(dialog, /(?<![-:\w])min-h-\[70vh\]/);

		// Desktop keeps its tall card; phones get an svh-scoped budget that
		// clears the sheet header while the preview area scrolls itself.
		assert.match(dialog, /pointer-fine:h-\[88vh\]/);
		assert.match(dialog, /pointer-fine:max-h-\[88vh\]/);
		assert.match(dialog, /max-h-\[calc\(92svh-180px\)\]/);
		assert.match(dialog, /pointer-fine:max-h-none/);
		assert.doesNotMatch(dialog, /min-h-\[60svh\]/);
		assert.match(dialog, /pointer-fine:min-h-\[70vh\]|pointer-fine:h-full/);
	});

	it("stacks the preview header so the filename and Download do not collide with close", () => {
		const dialog = read("src/components/requests/file-preview-dialog.tsx");

		assert.match(
			dialog,
			/flex flex-col gap-3[\s\S]*?sm:flex-row|flex-col[\s\S]*?Download/,
		);
		assert.match(dialog, /break-words|break-all/);
		assert.doesNotMatch(dialog, /DialogTitle className="truncate"/);
		assert.match(dialog, /w-full sm:w-auto/);
	});
});

describe("sign-in mobile layout", () => {
	it("uses dynamic viewport height and hides the decorative circles on phones", () => {
		const page = read("src/app/(auth)/sign-in/[[...sign-in]]/page.tsx");

		assert.match(page, /min-h-dvh/);
		assert.match(page, /hidden sm:block/);
	});
});

describe("middleware redirect origin", () => {
	it("builds redirects from request headers so proxies and dev ports stay on-host", () => {
		const middleware = read("src/middleware.ts");

		/*
		 * The origin must come from x-forwarded-host / host headers, never
		 * from req.url, whose origin Next dev synthesizes as localhost:3000
		 * regardless of the actual port — bouncing users to the wrong app.
		 */
		assert.match(middleware, /x-forwarded-host/);
		assert.match(middleware, /x-forwarded-proto/);
		assert.match(middleware, /"host"/);
		assert.doesNotMatch(middleware, /, req\.url\)/);
	});

	it("sends unauthenticated / visitors straight to the sign-in page", () => {
		const home = read("src/app/page.tsx");

		assert.match(home, /redirect\(['"]\/sign-in['"]\)/);
	});
});
