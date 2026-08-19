"use client";

import * as React from "react";
import { Drawer } from "vaul";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface RequestDrawerProps {
	requestId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onActionComplete?: () => void;
	children: React.ReactNode;
	footer?: React.ReactNode;
}

export function RequestDrawer({
	requestId,
	open,
	onOpenChange,
	onActionComplete,
	children,
	footer,
}: RequestDrawerProps) {
	const handleOpenChange = (open: boolean) => {
		if (!open) {
			onActionComplete?.();
		}
		onOpenChange(open);
	};

	return (
		<Drawer.Root handleOnly open={open} onOpenChange={handleOpenChange}>
			<Drawer.Portal>
				<Drawer.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
				<Drawer.Content
					data-request-id={requestId}
					className={cn(
						"fixed bottom-0 left-0 right-0 z-50 flex flex-col",
						"h-[96%] max-h-[96svh]",
						"bg-white rounded-t-[10px]",
						"outline-none",
						"data-[state=open]:animate-in data-[state=closed]:animate-out",
						"data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
						"data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
						"duration-300 ease-in-out",
					)}
				>
					{/* Vaul owns this handle so only a downward drag can dismiss. */}
					<Drawer.Handle
						preventCycle
						data-testid="request-drawer-handle"
						className="mx-auto mt-1 flex h-8 w-20 shrink-0 touch-none items-center justify-center rounded-full"
					>
						<span className="h-1.5 w-12 rounded-full bg-zinc-300" />
					</Drawer.Handle>

					{/* Close button */}
					<button
						onClick={() => handleOpenChange(false)}
						className="absolute right-4 top-3 z-10 rounded-md p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 active:bg-gray-200 transition-colors"
						aria-label="Close"
					>
						<X className="h-5 w-5" />
					</button>

					{/* Scrollable content area */}
					<div className="flex-1 overflow-y-auto px-4 pb-[env(safe-area-inset-bottom)]">
						{children}
					</div>

					{/* Sticky footer - rendered outside scrollable area */}
					{footer && (
						<div className="flex-shrink-0 bg-white border-t border-gray-200 px-4 pt-3 pb-[env(safe-area-inset-bottom)]">
							{footer}
						</div>
					)}
				</Drawer.Content>
			</Drawer.Portal>
		</Drawer.Root>
	);
}

// Drawer footer component for sticky action bars
export function RequestDrawerFooter({
	children,
	className,
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex-shrink-0 sticky bottom-0",
				"bg-white border-t border-gray-200",
				"pb-[env(safe-area-inset-bottom)]",
				"px-4 pt-3",
				className,
			)}
		>
			{children}
		</div>
	);
}
