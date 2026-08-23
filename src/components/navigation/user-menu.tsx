"use client";

import { useState } from "react";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { GitBranch, Lock, LogOut, User } from "lucide-react";
import { UserAvatar } from "@/components/ui/user-avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * Shared avatar + dropdown user menu used by both navigation shells
 * (desktop Navbar and mobile MobileNav) so the two cannot drift.
 *
 * The panel is portaled to document.body (Radix DropdownMenuContent) so it
 * is not trapped under the fixed mobile nav / page layer on iOS.
 */
export function UserMenu({
	variant = "desktop",
	onOpenChange,
	children,
}: {
	variant?: "desktop" | "mobile";
	onOpenChange?: (open: boolean) => void;
	children?: React.ReactNode;
}) {
	const { data: session } = useSession();
	const user = session?.user;
	const [menuOpen, setMenuOpen] = useState(false);

	const setOpen = (next: boolean) => {
		setMenuOpen(next);
		onOpenChange?.(next);
	};

	const isMobile = variant === "mobile";
	const userInitial = user?.name?.[0] || user?.email?.[0] || "U";

	// Sign out always redirects to the relative /sign-in route so the browser
	// stays on the configured trusted origin — no absolute environment URL is
	// baked into client code. Errors are logged without inventing a fallback
	// origin.
	const handleSignOut = async () => {
		setOpen(false);
		try {
			await signOut({ callbackUrl: "/sign-in" });
		} catch (error) {
			console.error("Sign out failed:", error);
		}
	};

	return (
		<DropdownMenu open={menuOpen} onOpenChange={setOpen}>
			<DropdownMenuTrigger asChild>
				<button
					className={cn(
						"flex items-center justify-center rounded-full transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2",
						isMobile
							? "h-11 min-h-[44px] min-w-[44px] bg-blue-600 text-sm font-semibold text-white hover:ring-2 hover:ring-blue-500 hover:ring-offset-2"
							: "hover:ring-2 hover:ring-blue-500 hover:ring-offset-2",
					)}
					title="User menu"
					aria-label="Open user menu"
					aria-expanded={menuOpen}
				>
					{children ??
						(isMobile ? userInitial : <UserAvatar name={user?.name} size="lg" />)}
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
				sideOffset={8}
				className="z-[100] w-56 p-1"
			>
				<DropdownMenuItem asChild>
					<Link
						href="/profile"
						className="flex min-h-[44px] cursor-pointer items-center gap-2"
					>
						<User className="h-4 w-4" />
						Profile
					</Link>
				</DropdownMenuItem>
				<DropdownMenuItem asChild>
					<Link
						href="/approval-chain"
						className="flex min-h-[44px] cursor-pointer items-center gap-2"
					>
						<GitBranch className="h-4 w-4" />
						Approval Chain
					</Link>
				</DropdownMenuItem>
				<DropdownMenuItem asChild>
					<Link
						href="/change-password"
						className="flex min-h-[44px] cursor-pointer items-center gap-2"
					>
						<Lock className="h-4 w-4" />
						Change Password
					</Link>
				</DropdownMenuItem>
				<DropdownMenuItem
					onSelect={() => {
						void handleSignOut();
					}}
					className="min-h-[44px] cursor-pointer"
				>
					<LogOut className="h-4 w-4" />
					Sign Out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
