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
 * Mobile is a 2-line strip: title + badge on one row (title truncates, chip
 * stays), then avatar + name · email on one truncated line. md restores the
 * desktop side-by-side row with stacked submitter. Callers must NOT render
 * their own X button — DialogContent already provides one, and a second one
 * stacked on top of it on phones caused the overlapping-header bug.
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
				"sticky top-0 z-20 flex-shrink-0 border-b border-slate-100 bg-white px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900 md:px-6 md:py-4",
				className,
			)}
		>
			<div className="flex flex-col gap-1.5 pr-10 md:flex-row md:items-start md:justify-between md:gap-3">
				<div className="flex min-w-0 items-center gap-2 md:gap-3">
					<DialogTitle className="m-0 min-w-0 flex-1 truncate text-base font-bold leading-tight tracking-tight text-slate-900 dark:text-slate-100 md:text-lg">
						{title}
					</DialogTitle>
					{badge ? <div className="shrink-0">{badge}</div> : null}
				</div>
				{submitter && (
					<>
						<div className="flex min-w-0 items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 md:hidden">
							<div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[9px] font-bold text-slate-500 dark:bg-slate-700 dark:text-slate-400">
								{submitter.initials}
							</div>
							<span
								className="min-w-0 truncate"
								title={`${submitter.name} · ${submitter.email}`}
							>
								{submitter.name} · {submitter.email}
							</span>
						</div>
						<div className="hidden min-w-0 items-center gap-2 md:flex md:border-l md:border-slate-100 md:pl-4 dark:md:border-slate-800">
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
					</>
				)}
			</div>
		</DialogHeader>
	);
}
