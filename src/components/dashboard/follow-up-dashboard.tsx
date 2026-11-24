"use client";

import { useTranslations } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import { useMemo, useState, type ElementType } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Drawer } from "vaul";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useMediaQuery } from "@/hooks/use-media-query";
import { RequestModalRouter } from "@/components/requests/request-modal-router";
import { StatusBadge } from "@/components/requests/status-badge";
import { SubmitterModal } from "@/components/requests/submitter-modal";
import { cn } from "@/lib/utils";
import {
	formatActivityTime,
	formatAwaitingStatusLine,
	formatCompletedNoWrLabel,
	type FollowUpDashboardData,
	type FollowUpRow,
} from "@/lib/follow-up-dashboard";
import { createRequest } from "@/server-actions/requests";

type DrawerKey =
	| "active"
	| "eng"
	| "attn"
	| "done"
	| "req"
	| "sol"
	| "doneNoWr";

function preview(rows: FollowUpRow[], limit = 3) {
	return {
		shown: rows.slice(0, limit),
		more: Math.max(rows.length - limit, 0),
	};
}

export function FollowUpDashboard({ data }: { data: FollowUpDashboardData }) {
	const t = useTranslations();
	const router = useRouter();
	const [showNewRequestModal, setShowNewRequestModal] = useState(false);
	const [drawerSelection, setDrawer] = useState<{
		key: DrawerKey;
		titleKey: MessageKey;
		copyKey: MessageKey;
	} | null>(null);
	const [selected, setSelected] = useState<FollowUpRow | null>(null);
	const [showAllActivity, setShowAllActivity] = useState(false);
	// Pointer type decides which list surface mounts. CSS-only hiding left the
	// Vaul sheet mounted and open on fine-pointer devices, where it stole the
	// clicks meant for the visible rows — requests stopped opening entirely.
	const isFinePointer = useMediaQuery("(pointer: fine)");

	const handleSubmitRequest = async (form: {
		title: string;
		description: string;
		templateId?: string;
		stagedAttachmentIds: string[];
		inlineImageSessionId: string;
	}): Promise<{ success: boolean; error?: string }> => {
		try {
			const result = await createRequest({
				title: form.title,
				description: form.description,
				inlineImageSessionId: form.inlineImageSessionId,
				stagedAttachmentIds: form.stagedAttachmentIds,
			});

			if (result.success) {
				toast.success(t('requests.requestCreated'));
				router.refresh();
				return { success: true };
			}

			const error = t(result.errorKey ?? "requests.error.create");
			toast.error(error);
			return { success: false, error };
		} catch (cause) {
			console.error("Failed to create request:", cause);
			const error = t("requests.error.createUnexpected");
			toast.error(error);
			return { success: false, error };
		}
	};

	const lists = useMemo(
		() => ({
			active: [
				...data.awaitingRequestApproval,
				...data.awaitingOthers,
				...data.engineerSolutionReady,
			],
			eng: data.awaitingOthers,
			attn: data.needsAttention,
			done: data.completedRecently,
			req: data.awaitingRequestApproval,
			sol: data.engineerSolutionReady,
			doneNoWr: data.completedNoWr,
		}),
		[data],
	);

	const drawer = drawerSelection ? { ...drawerSelection, rows: lists[drawerSelection.key] } : null;
	const openDrawer = (key: DrawerKey, titleKey: MessageKey, copyKey: MessageKey) =>
		setDrawer({ key, titleKey, copyKey });

	return (
		<div className="follow-up-board mx-auto max-w-[1280px] pb-14">
			<header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<p className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-slate-500">
						{t('dashboard.intro')}
					</p>
					<h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
						{t('dashboard.heading', { department: data.departmentName })}
					</h1>
				</div>
				<Button
					className="w-full bg-slate-950 text-white hover:bg-slate-800 sm:w-auto"
					onClick={() => setShowNewRequestModal(true)}
				>
					<Plus className="mr-2 h-4 w-4" />
					{t('requests.newRequest')}
				</Button>
			</header>

			<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
				<Kpi
					label={t('dashboard.active')}
					value={data.kpis.active}
					note={t('dashboard.open')}
					delta={data.deltaLabels.active}
					onClick={() =>
						openDrawer(
							"active",
							'dashboard.activeDrawer',
							'dashboard.requestVisibility',
						)
					}
				/>
				<Kpi
					label={t('dashboard.withEngineering')}
					value={data.kpis.withEngineering}
					note={t('dashboard.engineeringSteps')}
					delta={data.deltaLabels.withEngineering}
					onClick={() =>
						openDrawer(
							"eng",
							'dashboard.withEngineering',
							'dashboard.engineeringDrawer',
						)
					}
				/>
				<Kpi
					label={t('dashboard.attention')}
					value={data.kpis.needsAttention}
					note={t('dashboard.noUpdate')}
					delta={data.deltaLabels.needsAttention}
					warn
					onClick={() =>
						openDrawer(
							"attn",
							'dashboard.attention',
							'dashboard.noUpdateDrawer',
						)
					}
				/>
				<Kpi
					label={t('dashboard.completed30d')}
					value={data.kpis.completed30d}
					note={t('dashboard.closedThisMonth')}
					delta={data.deltaLabels.completed30d}
					onClick={() =>
						openDrawer(
							"done",
							'dashboard.completed30d',
							'dashboard.closed30d',
						)
					}
				/>
			</div>

			<p className="mb-2 mt-8 font-mono text-[11px] uppercase tracking-[0.1em] text-slate-500">
				{t('dashboard.queues')}
			</p>
			<div className="grid gap-3 lg:grid-cols-3">
				<Card
					title={t('dashboard.awaitingApproval')}
					count={data.awaitingRequestApproval.length}
					copy={t('dashboard.awaitingApprovalIntro')}
					delta={data.deltaLabels.awaitingApproval}
				>
					{preview(data.awaitingRequestApproval).shown.map((row) => (
						<Row
							key={row.id}
							title={row.title}
							mine={row.isMine}
							sub={formatAwaitingStatusLine({
								status: row.status,
								nextLabel: row.nextLabel,
							})}
							status={row.status}
							hasRejection={row.hasRejection}
							meta={<Pill>{t('insights.duration.day', { value: row.waitingDays })}</Pill>}
							onClick={() => setSelected(row)}
						/>
					))}
					{preview(data.awaitingRequestApproval).more > 0 && (
						<button
							type="button"
							className="mt-3 rounded-full px-3 py-2 text-sm text-slate-500"
							onClick={() =>
								openDrawer(
									"req",
									'dashboard.awaitingApproval',
									'dashboard.awaitingApprovalDrawer',
								)
							}
						>
							{t('insights.more', { count: preview(data.awaitingRequestApproval).more })}
						</button>
					)}
				</Card>
				<Card
					title={t('dashboard.completedNoWr')}
					count={data.completedNoWr.length}
					copy={t('dashboard.completedNoWrIntro')}
					delta={data.deltaLabels.completedNoWr}
				>
					{preview(data.completedNoWr).shown.map((row) => (
						<Row
							key={row.id}
							title={row.title}
							mine={row.isMine}
							sub={formatCompletedNoWrLabel(row.updatedAt)}
							meta={<Pill tone="warn">No WR</Pill>}
							onClick={() => setSelected(row)}
						/>
					))}
					{preview(data.completedNoWr).more > 0 && (
						<button
							type="button"
							className="mt-3 rounded-full px-3 py-2 text-sm text-slate-500"
							onClick={() =>
								openDrawer(
									"doneNoWr",
									'dashboard.completedNoWr',
									'dashboard.completedNoWrDrawer',
								)
							}
						>
							{t('insights.more', { count: preview(data.completedNoWr).more })}
						</button>
					)}
				</Card>
				<Card
					title={t('dashboard.solutionReady')}
					count={data.engineerSolutionReady.length}
					copy={t('dashboard.solutionReadyIntro')}
					delta={data.deltaLabels.solutionReady}
				>
					{preview(data.engineerSolutionReady).shown.map((row) => (
						<Row
							key={row.id}
							title={row.title}
							sub={row.estimateLabel || "Solution ready"}
							meta={<Pill tone="accent">Ready</Pill>}
							onClick={() => setSelected(row)}
						/>
					))}
					{preview(data.engineerSolutionReady).more > 0 && (
						<button
							type="button"
							className="mt-3 rounded-full px-3 py-2 text-sm text-slate-500"
							onClick={() =>
								openDrawer(
									"sol",
									'dashboard.solutionReady',
									'dashboard.solutionReadyDrawer',
								)
							}
						>
							{t('insights.more', { count: preview(data.engineerSolutionReady).more })}
						</button>
					)}
				</Card>
			</div>

			<p className="mb-2 mt-8 font-mono text-[11px] uppercase tracking-[0.1em] text-slate-500">
				{t('dashboard.recentActivity')}
			</p>
			<Card copy={t('dashboard.latestEvents')}>
				{(showAllActivity
					? data.recentActivity
					: data.recentActivity.slice(0, 8)
				).map((item) => (
					<div
						key={item.id}
						className="flex items-start justify-between gap-3 border-t border-slate-100 py-2.5 first:border-t-0"
					>
						<p className="text-sm text-slate-700">
							{item.action} · {item.title}
						</p>
						<span className="shrink-0 text-xs text-slate-400">
							{formatActivityTime(item.createdAt)}
						</span>
					</div>
				))}
				{data.recentActivity.length > 8 && (
					<button
						type="button"
						className="mt-3 min-h-11 rounded-full px-3 py-2 text-sm text-slate-500"
						onClick={() => setShowAllActivity((open) => !open)}
					>
						{showAllActivity ? t('dashboard.showLess') : t('dashboard.showMore')}
					</button>
				)}
			</Card>

			{!isFinePointer && (
				<Drawer.Root
					handleOnly
					open={!!drawer}
					onOpenChange={(open) => {
						if (!open) setDrawer(null);
					}}
				>
					<Drawer.Portal>
						<Drawer.Overlay className="fixed inset-0 z-50 bg-slate-900/20" />
						<Drawer.Content className="fixed inset-x-0 bottom-0 z-50 flex h-[88svh] flex-col overflow-hidden rounded-t-[28px] border border-slate-200 bg-white outline-none">
							{drawer && (
								<FollowUpDrawerPanel
									drawer={drawer}
									handle={
										<Drawer.Handle className="mx-auto mt-3 mb-1 h-1.5 w-12 shrink-0 rounded-full bg-slate-300" />
									}
									onClose={() => setDrawer(null)}
									onSelect={(row) => {
										setDrawer(null);
										setSelected(row);
									}}
									titleAs={Drawer.Title}
									descriptionAs={Drawer.Description}
								/>
							)}
						</Drawer.Content>
					</Drawer.Portal>
				</Drawer.Root>
			)}

			{isFinePointer && drawer && (
				<div className="fixed inset-0 z-50">
					<button
						type="button"
						className="absolute inset-0 bg-slate-900/20"
						aria-label={t('dashboard.closeDrawer')}
						onClick={() => setDrawer(null)}
					/>
					<aside className="absolute inset-y-3 right-3 flex w-[min(420px,calc(100vw-24px))] flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl">
						<FollowUpDrawerPanel
							drawer={drawer}
							onClose={() => setDrawer(null)}
							onSelect={(row) => {
								setDrawer(null);
								setSelected(row);
							}}
						/>
					</aside>
				</div>
			)}

			<SubmitterModal
				mode="request"
				open={showNewRequestModal}
				onOpenChange={setShowNewRequestModal}
				onSubmitRequest={handleSubmitRequest}
			/>

			{selected && (
				<RequestModalRouter
					requestId={selected.id}
					open
					viewOnly={selected.status !== "SendBackToRequester"}
					onOpenChange={(open) => {
						if (!open) setSelected(null);
					}}
				/>
			)}
		</div>
	);
}

function FollowUpDrawerPanel({
	drawer,
	handle,
	onClose,
	onSelect,
	titleAs: Title = "h2",
	descriptionAs: Description = "p",
}: {
	drawer: {
		key: DrawerKey;
		titleKey: MessageKey;
		copyKey: MessageKey;
		rows: FollowUpRow[];
	};
	handle?: React.ReactNode;
	onClose: () => void;
	onSelect: (row: FollowUpRow) => void;
	titleAs?: ElementType;
	descriptionAs?: ElementType;
}) {
	const t = useTranslations();
	return (
		<>
			{handle}
			<div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 bg-white p-5">
				<div>
					<p className="font-mono text-[11px] uppercase tracking-[0.08em] text-slate-500">
						{t(`dashboard.drawer.${drawer.key}`)}
					</p>
					<Title className="text-xl font-semibold">{t(drawer.titleKey)}</Title>
					<Description className="mt-1 text-sm text-slate-500">
						{t(drawer.copyKey)}
					</Description>
				</div>
				<button
					type="button"
					className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200"
					aria-label={t('dashboard.closeDrawer')}
					onClick={onClose}
				>
					<X className="h-4 w-4" />
				</button>
			</div>
			<div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-4">
				{drawer.rows.length === 0 ? (
					<p className="p-4 text-sm text-slate-500">{t('dashboard.noneHere')}</p>
				) : (
					drawer.rows.map((row) => (
						<Row
							key={row.id}
							title={row.title}
							mine={row.isMine}
							sub={
								drawer.key === "req"
									? formatAwaitingStatusLine({
											status: row.status,
											nextLabel: row.nextLabel,
										})
									: row.nextLabel
							}
							status={drawer.key === "req" ? row.status : undefined}
							hasRejection={drawer.key === "req" ? row.hasRejection : undefined}
							meta={<Pill>{t('insights.duration.day', { value: row.waitingDays })}</Pill>}
							onClick={() => onSelect(row)}
						/>
					))
				)}
			</div>
		</>
	);
}

function Delta({ label, warn }: { label: string; warn?: boolean }) {
	const up = label.startsWith("+");
	const down = label.startsWith("-");
	return (
		<p
			className={cn(
				"mt-2 text-xs font-semibold",
				warn && up && "text-amber-800",
				!warn && up && "text-emerald-700",
				down && "text-slate-500",
				!up && !down && "font-medium text-slate-500",
			)}
		>
			{label}
		</p>
	);
}

function Kpi({
	label,
	value,
	note,
	delta,
	warn,
	onClick,
}: {
	label: string;
	value: number;
	note: string;
	delta: string;
	warn?: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"min-h-[132px] rounded-[18px] border border-slate-200 bg-white p-4 text-left shadow-sm transition duration-160 hover:-translate-y-0.5 hover:shadow-lg",
				warn && "bg-amber-50/70",
			)}
		>
			<p className="font-mono text-[11px] uppercase tracking-[0.08em] text-slate-500">
				{label}
			</p>
			<p className="mt-2 text-4xl font-semibold tabular-nums tracking-tight">
				{value}
			</p>
			<p className="mt-2 text-sm text-slate-500">{note}</p>
			<Delta label={delta} warn={warn} />
		</button>
	);
}

function Card({
	title,
	count,
	copy,
	delta,
	className,
	children,
}: {
	title?: string;
	count?: number;
	copy?: string;
	delta?: string;
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<section
			className={cn(
				"rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm",
				className,
			)}
		>
			{(title || typeof count === "number") && (
				<div className="flex items-start justify-between gap-3">
					{title && (
						<h2 className="text-lg font-semibold tracking-tight">{title}</h2>
					)}
					{typeof count === "number" && (
						<span className="text-base tabular-nums text-slate-500">
							{count}
						</span>
					)}
				</div>
			)}
			{copy && <p className="mt-1 text-sm text-slate-500">{copy}</p>}
			{delta && <Delta label={delta} />}
			<div className="mt-3">{children}</div>
		</section>
	);
}

function Row({
	title,
	sub,
	meta,
	mine,
	status,
	hasRejection,
	onClick,
}: {
	title: string;
	sub?: string;
	meta?: React.ReactNode;
	mine?: boolean;
	status?: string;
	hasRejection?: boolean;
	onClick: () => void;
}) {
	const t = useTranslations();
	return (
		<button
			type="button"
			onClick={onClick}
			className="flex w-full items-start justify-between gap-3 rounded-2xl border border-transparent px-2 py-3 text-left transition duration-160 first:mt-0 motion-safe:hover:-translate-y-0.5 motion-safe:hover:border-slate-200 motion-safe:hover:bg-white motion-safe:hover:shadow-md motion-safe:active:translate-y-0 motion-reduce:transform-none"
		>
			<span>
				<span className="block font-medium text-slate-900">
					{title}{" "}
					{mine && (
						<span className="text-[11px] font-bold text-emerald-700">
							{t('dashboard.mine')}
						</span>
					)}
				</span>
				{(status || sub) && (
					<span className="mt-1 inline-flex flex-wrap items-center gap-1.5 text-sm text-slate-500">
						{status && (
							<StatusBadge
								status={status as never}
								hasRejection={hasRejection}
							/>
						)}
						{sub}
					</span>
				)}
			</span>
			{meta}
		</button>
	);
}

function Pill({
	children,
	tone,
}: {
	children: React.ReactNode;
	tone?: "accent" | "warn";
}) {
	return (
		<span
			className={cn(
				"inline-flex min-h-7 items-center rounded-full px-2.5 text-xs font-semibold",
				tone === "accent" && "bg-emerald-50 text-emerald-800",
				tone === "warn" && "bg-amber-50 text-amber-800",
				!tone && "bg-indigo-50 text-indigo-800",
			)}
		>
			{children}
		</span>
	);
}
