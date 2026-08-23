"use client";

import type { ReactNode } from "react";
import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface RequestModalSubmitter {
	name: string;
	role?: string;
	email: string;
	initials: string;
}

/**
 * Shared request-modal header: title + status badge + submitter identity.
 *
 * Phones stack the blocks vertically (title wraps, badges flow under it) and
 * every line clears the built-in close button with pr-10; md restores the
 * desktop side-by-side row. Callers must NOT render their own X button —
 * DialogContent already provides one, and a second one stacked on top of it on
 * phones caused the overlapping-header bug.
 */
export function RequestModalHeader({
	title,
	badge,
	submitter,
	className,
}: {
	title: ReactNode;
	badge?: ReactNode;
	submitter?: RequestModalSubmitter;
	className?: string;
}) {
	return (
		<DialogHeader
			className={cn(
				"sticky top-0 z-20 flex-shrink-0 border-b border-slate-100 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900",
				className,
			)}
		>
			<div className="flex flex-col gap-3 pr-10 md:flex-row md:items-start md:justify-between">
				<div className="flex min-w-0 flex-col gap-2 md:flex-row md:items-center md:gap-3">
					<DialogTitle className="m-0 break-words text-base font-bold leading-tight tracking-tight text-slate-900 dark:text-slate-100 md:truncate md:text-lg">
						{title}
					</DialogTitle>
					{badge}
				</div>
				{submitter && (
					<div className="flex min-w-0 items-center gap-2 md:border-l md:border-slate-100 md:pl-4 dark:md:border-slate-800">
						<div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-500 dark:bg-slate-700 dark:text-slate-400">
							{submitter.initials}
						</div>
						<div className="flex min-w-0 flex-col leading-tight">
							<span className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">
								{submitter.name}
							</span>
							<span className="break-words text-xs text-slate-500 dark:text-slate-400">
								{submitter.role ? `${submitter.role} • ` : ""}
								{submitter.email}
							</span>
						</div>
					</div>
				)}
			</div>
		</DialogHeader>
	);
}
