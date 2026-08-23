"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { GitBranch, Lock, LogOut, User } from "lucide-react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { cn } from "@/lib/utils";

/**
 * Shared avatar + dropdown user menu used by both navigation shells
 * (desktop Navbar and mobile MobileNav) so the two cannot drift.
 *
 * Pass the desktop trigger as children (e.g. <UserAvatar />) or render the
 * default initial circle via variant="mobile".
 */
export function UserMenu({
	variant = "desktop",
	children,
}: {
	variant?: "desktop" | "mobile";
	children?: React.ReactNode;
}) {
	const { data: session } = useSession();
	const user = session?.user;
	const [menuOpen, setMenuOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);

	const isMobile = variant === "mobile";
	const userInitial = user?.name?.[0] || user?.email?.[0] || "U";

	// Close menu when clicking outside
	useEffect(() => {
		function handleClickOutside(event: MouseEvent) {
			if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
				setMenuOpen(false);
			}
		}
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, []);

	// Sign out always redirects to the relative /sign-in route so the browser
	// stays on the configured trusted origin — no absolute environment URL is
	// baked into client code. Errors are logged without inventing a fallback
	// origin.
	const handleSignOut = async () => {
		setMenuOpen(false);
		try {
			await signOut({ callbackUrl: "/sign-in" });
		} catch (error) {
			console.error("Sign out failed:", error);
		}
	};

	return (
		<div className="relative" ref={menuRef}>
			<button
				onClick={() => setMenuOpen(!menuOpen)}
				className={cn(
					"flex items-center justify-center rounded-full transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2",
					isMobile
						? // Touch target: full 44px so the avatar is tappable on phones.
							"h-11 min-h-[44px] min-w-[44px] bg-blue-600 text-sm font-semibold text-white hover:ring-2 hover:ring-blue-500 hover:ring-offset-2"
						: "hover:ring-2 hover:ring-blue-500 hover:ring-offset-2",
				)}
				title="User menu"
				aria-label="Open user menu"
				aria-expanded={menuOpen}
			>
				{children ??
					(isMobile ? userInitial : <UserAvatar name={user?.name} size="lg" />)}
			</button>

			{menuOpen && (
				<div className="absolute right-0 mt-2 w-56 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 z-50">
					<div className="py-1">
						<Link
							href="/profile"
							onClick={() => setMenuOpen(false)}
							className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
						>
							<User className="h-4 w-4" />
							Profile
						</Link>
						<Link
							href="/approval-chain"
							onClick={() => setMenuOpen(false)}
							className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
						>
							<GitBranch className="h-4 w-4" />
							Approval Chain
						</Link>
						<Link
							href="/change-password"
							onClick={() => setMenuOpen(false)}
							className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
						>
							<Lock className="h-4 w-4" />
							Change Password
						</Link>
						<button
							onClick={handleSignOut}
							className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 text-left"
						>
							<LogOut className="h-4 w-4" />
							Sign Out
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
