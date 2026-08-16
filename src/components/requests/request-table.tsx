"use client";

import React, { useState, useMemo, useCallback, useEffect } from "react";
import {
	ColumnDef,
	flexRender,
	getCoreRowModel,
	useReactTable,
} from "@tanstack/react-table";
import { format } from "date-fns";
import { FileText, Clock } from "lucide-react";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "./status-badge";
import { RequestModalRouter } from "./request-modal-router";
import { RejectedBadge } from "./rejected-badge";
import {
	RequestCard,
	RequestCardsEmptyState,
} from "@/components/mobile/request-card";
import { ApprovalStatusBadge } from "./approval-status-badge";
import { UserAvatar } from "@/components/ui/user-avatar";
import { cn } from "@/lib/utils";

export type RequestListRow = {
	id: string;
	title: string;
	status: string;
	createdAt: Date;
	workRequisitionReceived?: boolean;
	requesterId: string;
	department: { name: string } | null;
	requester: { id: string; name: string } | null;
	_count: { fileAttachments: number };
	hasRejection?: boolean;
	engineerAssignments?: Array<{
		engineer: { id: string; name: string };
	}>;
	approvals?: Array<{
		id: string;
		status: "pending" | "approved" | "rejected";
		approver?: { name: string } | null;
		requiredLevel: number;
		order: number;
		approvedAt?: Date | null;
	}>;
};

interface RequestTableProps {
	initialData: RequestListRow[];
	onDataRefresh?: () => void;
}

export function RequestTable({
	initialData,
	onDataRefresh,
}: RequestTableProps) {
	const [data, setData] = useState<RequestListRow[]>(initialData);
	const [selectedRequestId, setSelectedRequestId] = useState<string | null>(
		null,
	);
	const [isModalOpen, setIsModalOpen] = useState(false);

	useEffect(() => {
		setData(initialData);
	}, [initialData]);

	// Memoize event handler to prevent unnecessary re-renders
	const handleRowClick = useCallback((requestId: string) => {
		setSelectedRequestId(requestId);
		setIsModalOpen(true);
	}, []);

	const handleRowKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLTableRowElement>, requestId: string) => {
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				handleRowClick(requestId);
			}
		},
		[handleRowClick],
	);

	// Memoize column definitions to prevent recreation on every render
	const columns: ColumnDef<RequestListRow>[] = useMemo(
		() => [
			{
				accessorKey: "title",
				header: "Title",
				size: 380,
				cell: ({ row }) => (
					<div className="relative flex min-w-0 items-center gap-2">
						<span
							aria-hidden
							className="absolute -left-2 top-1/2 h-8 w-[3px] -translate-y-1/2 rounded-full bg-blue-500 opacity-0 transition-all duration-200 ease-out group-hover/row:opacity-100 motion-safe:scale-y-0 motion-safe:group-hover/row:scale-y-100"
						/>
						<span className="line-clamp-2 break-words font-medium leading-5 transition-all duration-200 ease-out group-hover/row:text-gray-950 motion-safe:group-hover/row:translate-x-0.5 motion-reduce:transform-none">
							{row.getValue("title")}
						</span>
						{row.original.hasRejection &&
							(row.original.status === "ImprovementRequest" ||
								row.original.status === "SentToEngineer") && (
								<RejectedBadge size="sm" showText={false} />
							)}
					</div>
				),
			},
			{
				accessorKey: "requester",
				header: "Requester",
				size: 150,
				cell: ({ row }) => (
					<span className="inline-block text-gray-500 transition-all duration-200 ease-out group-hover/row:text-gray-600 motion-safe:group-hover/row:translate-x-0.5 motion-reduce:transform-none">
						{row.original.requester?.name || "—"}
					</span>
				),
			},
			{
				accessorKey: "status",
				header: "Status",
				size: 130,
				cell: ({ row }) => (
					<div className="flex min-w-0 items-center">
						<span className="inline-flex rounded-full transition-all duration-200 ease-out motion-safe:group-hover/row:translate-x-0.5 motion-safe:group-hover/row:shadow-sm motion-reduce:transform-none">
							<StatusBadge
								status={row.getValue("status") as any}
								hasRejection={
									row.original.hasRejection &&
									(row.original.status === "ImprovementRequest" ||
										row.original.status === "SentToEngineer")
								}
							/>
						</span>
					</div>
				),
			},
			{
				id: "approvalStatus",
				header: "Approval Status",
				size: 150,
				cell: ({ row }) => (
					<div className="flex items-center justify-center transition-all duration-200 ease-out motion-safe:group-hover/row:translate-x-0.5 motion-reduce:transform-none">
						<ApprovalStatusBadge
							key={`approvals-${row.original.id}-${row.original.approvals?.map((a) => a.status).join("-")}`}
							approvals={row.original.approvals || []}
							requestStatus={row.original.status}
							size="sm"
						/>
					</div>
				),
			},
			{
				id: "pic",
				header: "PIC",
				size: 140,
				cell: ({ row }) => {
					const assignments = row.original.engineerAssignments;
					if (!assignments || assignments.length === 0)
						return (
							<span className="inline-block text-gray-300 transition-all duration-200 ease-out group-hover/row:text-gray-500 motion-safe:group-hover/row:translate-x-0.5 motion-reduce:transform-none">
								—
							</span>
						);
					const visibleAssignments = assignments;
					const first = visibleAssignments.slice(0, 1)[0];
					const remainingCount = assignments.length - 1;
					return (
						<div
							className="flex min-w-0 items-center gap-1.5 transition-all duration-200 ease-out motion-safe:group-hover/row:translate-x-0.5 motion-reduce:transform-none"
							title={assignments.map((a) => a.engineer.name).join(", ")}
						>
							<UserAvatar
								name={first.engineer.name}
								size="md"
								className="shadow-sm"
							/>
							<span className="truncate text-sm text-gray-700 transition-colors duration-200 ease-out group-hover/row:text-gray-900">
								{first.engineer.name.split(" ")[0]}
								{remainingCount > 0 && (
									<span className="ml-1 text-gray-400">+{remainingCount}</span>
								)}
							</span>
						</div>
					);
				},
			},
			{
				accessorKey: "department",
				header: "Department",
				size: 130,
				cell: ({ row }) => (
					<span className="inline-block text-gray-500 transition-all duration-200 ease-out group-hover/row:text-gray-600 motion-safe:group-hover/row:translate-x-0.5 motion-reduce:transform-none">
						{row.original.department?.name || "—"}
					</span>
				),
			},
			{
				accessorKey: "_count.fileAttachments",
				header: "Files",
				size: 70,
				cell: ({ row }) => {
					const count = row.original._count.fileAttachments;
					return count > 0 ? (
						<div className="flex items-center gap-1 text-gray-400 transition-all duration-200 ease-out group-hover/row:text-gray-500 motion-safe:group-hover/row:translate-x-0.5 motion-reduce:transform-none">
							<FileText className="h-4 w-4 flex-shrink-0" />
							<span>{count}</span>
						</div>
					) : null;
				},
			},
			{
				accessorKey: "createdAt",
				header: "Created",
				size: 130,
				cell: ({ row }) => {
					const date = new Date(row.getValue("createdAt"));
					return (
						<div className="flex items-center gap-1 whitespace-nowrap text-sm text-gray-400 transition-all duration-200 ease-out group-hover/row:text-gray-500 motion-safe:group-hover/row:translate-x-0.5 motion-reduce:transform-none">
							<Clock className="h-3 w-3 flex-shrink-0" />
							{format(date, "MMM d, yyyy")}
						</div>
					);
				},
			},
		],
		[],
	);

	const table = useReactTable({
		data,
		columns,
		getCoreRowModel: getCoreRowModel(),
	});

	return (
		<>
			{/* Mobile card view */}
			<div className="md:hidden space-y-3">
				{data.length > 0 ? (
					data.map((request) => (
						<RequestCard
							key={request.id}
							request={request}
							onTap={handleRowClick}
						/>
					))
				) : (
					<RequestCardsEmptyState />
				)}
			</div>

			{/* Desktop table view */}
			<div className="hidden md:block border rounded-md">
				<Table className="min-w-[1220px] table-fixed">
					<TableHeader>
						{table.getHeaderGroups().map((headerGroup) => (
							<TableRow key={headerGroup.id}>
								{headerGroup.headers.map((header) => (
									<TableHead
										key={header.id}
										style={{ width: header.getSize() }}
									>
										{header.isPlaceholder
											? null
											: flexRender(
													header.column.columnDef.header,
													header.getContext(),
												)}
									</TableHead>
								))}
							</TableRow>
						))}
					</TableHeader>
					<TableBody>
						{table.getRowModel().rows?.length ? (
							table.getRowModel().rows.map((row) => (
								<TableRow
									key={row.id}
									tabIndex={0}
									aria-label={`Open request ${row.original.title}`}
									className={cn(
										"group/row cursor-pointer transition-colors duration-200 ease-out hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500",
										row.original.workRequisitionReceived &&
											"bg-sky-50 hover:bg-sky-100/60",
									)}
									onClick={() => handleRowClick(row.original.id)}
									onKeyDown={(event) =>
										handleRowKeyDown(event, row.original.id)
									}
								>
									{row.getVisibleCells().map((cell) => (
										<TableCell
											key={cell.id}
											className="h-[60px] py-3"
											style={{ width: cell.column.getSize() }}
										>
											{flexRender(
												cell.column.columnDef.cell,
												cell.getContext(),
											)}
										</TableCell>
									))}
								</TableRow>
							))
						) : (
							<TableRow>
								<TableCell
									colSpan={columns.length}
									className="h-24 text-center"
								>
									<div className="flex flex-col items-center justify-center text-gray-500">
										<FileText className="h-8 w-8 mb-2 opacity-50" />
										<p>No requests found</p>
										<p className="text-sm">
											Create your first request to get started
										</p>
									</div>
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</div>

			{selectedRequestId && (
				<RequestModalRouter
					requestId={selectedRequestId}
					open={isModalOpen}
					onOpenChange={setIsModalOpen}
					onActionComplete={onDataRefresh}
				/>
			)}
		</>
	);
}
