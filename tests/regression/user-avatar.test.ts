import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("shared UserAvatar component", () => {
	const avatar = read("src/components/ui/user-avatar.tsx");

	it("exports a UserAvatar that hashes the user name to a stable gradient", () => {
		assert.match(avatar, /export function UserAvatar/);
		assert.match(avatar, /interface UserAvatarProps/);
		assert.match(avatar, /getAvatarGradient/);
		assert.match(avatar, /linear-gradient\(135deg/);
		// deterministic: same name always gets the same gradient
		assert.match(avatar, /for \(let i = 0; i < key\.length; i\+\+\)/);
	});

	it("derives up to two uppercase initials from the name", () => {
		assert.match(avatar, /split\(" "\)/);
		assert.match(avatar, /slice\(0, 2\)/);
		assert.match(avatar, /toUpperCase\(\)/);
	});

	it("supports sizes and an optional status ring with reduced-motion pulse", () => {
		assert.match(avatar, /sm: "h-5 w-5 text-\[9px\]"/);
		assert.match(avatar, /md: "h-6 w-6 text-\[10px\]"/);
		assert.match(avatar, /lg: "h-10 w-10 text-sm"/);
		assert.match(avatar, /xl: "h-14 w-14 text-xl"/);
		assert.match(avatar, /status\?\.approved/);
		assert.match(avatar, /ring-emerald-400/);
		assert.match(avatar, /ring-amber-400/);
		// pulse only on the current step, not every pending one
		assert.match(avatar, /current\?: boolean/);
		assert.match(
			avatar,
			/status\?\.pending &&\s*status\?\.current &&\s*"animate-pulse motion-reduce:animate-none"/,
		);
		// fallback for missing names
		assert.match(avatar, /\|\| "\?"/);
	});
});

describe("avatar surfaces", () => {
	it("navbar shows the gradient avatar instead of the gray initial circle", () => {
		const navbar = read("src/components/navigation/navbar.tsx");
		assert.match(navbar, /import \{ UserAvatar \} from/);
		assert.match(navbar, /<UserAvatar/);
		assert.match(navbar, /name=\{user\?\.name\}/);
		// the old gray circle is gone
		assert.doesNotMatch(
			navbar,
			/rounded-full bg-gray-200 text-sm font-medium text-gray-700/,
		);
	});

	it("profile page renders a big avatar header beside the account details", () => {
		const form = read("src/components/profile/profile-form.tsx");
		assert.match(form, /import \{ UserAvatar \} from/);
		assert.match(form, /<UserAvatar/);
		assert.match(form, /size="xl"/);
	});

	it("approving timeline uses ring avatars as the step markers", () => {
		const badge = read("src/components/requests/approval-status-badge.tsx");
		assert.match(badge, /import \{ UserAvatar \} from/);
		// the avatar IS the step marker, carrying the status ring
		assert.match(badge, /status=\{\{/);
		assert.match(badge, /approved: isApproved/);
		assert.match(badge, /pending: isPending/);
		assert.match(badge, /rejected: isRejected/);
		assert.match(badge, /current: isCurrent/);
		assert.match(badge, /relative z-10/);
		// exactly one avatar per step — no second one beside the name
		const avatarCount = (badge.match(/<UserAvatar/g) || []).length;
		assert.ok(
			avatarCount === 1,
			`expected 1 UserAvatar usage, got ${avatarCount}`,
		);
		// standalone step dots are gone
		assert.doesNotMatch(badge, /bg-emerald-500/);
		assert.doesNotMatch(badge, /bg-red-500/);
		assert.doesNotMatch(badge, /XCircle/);
		// connector line stays
		assert.match(badge, /absolute left-\[9px\]/);
		assert.match(badge, /bg-emerald-300/);
	});

	it("renders the timeline body once and shares it across hover and mobile popovers", () => {
		const badge = read("src/components/requests/approval-status-badge.tsx");
		// one shared timeline component
		assert.match(badge, /function ApprovalTimeline/);
		// the pill spreads Radix trigger props — without this, hover/tap handlers never reach the DOM
		assert.match(badge, /function ApprovalPill\(\{\s*size,\s*\.\.\.props\s*\}/);
		assert.match(badge, /variant="default"\s*\{\.\.\.props\}/);
		// both triggers bind directly to the pill — no wrapper button (avoids button-in-button)
		assert.match(badge, /PopoverTrigger asChild>\s*<ApprovalPill/);
		assert.match(badge, /HoverCardTrigger asChild>\s*<ApprovalPill/);
		assert.doesNotMatch(badge, /<button[^>]*Show approval chain/);
		// desktop keeps the hover card
		assert.match(badge, /<HoverCard openDelay=\{200\}>/);
		// mobile tap popover stops the card tap-through
		assert.match(badge, /<Popover[\s>]/);
		assert.match(badge, /onClick=\{\(event\) => event\.stopPropagation\(\)\}/);
	});

	it("PIC column reuses UserAvatar so colors match across surfaces", () => {
		const table = read("src/components/requests/request-table.tsx");
		assert.match(table, /import \{ UserAvatar \} from/);
		assert.match(table, /<UserAvatar/);
		// the local gradient helper is retired
		assert.doesNotMatch(table, /PIC_GRADIENTS/);
		assert.doesNotMatch(table, /function getAvatarGradient/);
	});
});
