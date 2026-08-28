"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { format } from "date-fns";
import {
	X,
	Upload,
	Info,
	Paperclip,
	FileImage,
	FileSpreadsheet,
	File,
	FileText,
	Check,
	Send,
	AlertTriangle,
	RotateCcw,
	Users,
	Settings2,
	Plus,
	ArrowUp,
	ArrowDown,
	Trash2,
	CheckCircle2,
	DollarSign,
	Clock,
	FileUp,
} from "lucide-react";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { RichTextEditor } from "@/components/rich-text/rich-text-editor-lazy";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import {
	MAX_ATTACHMENT_BYTES,
	ATTACHMENT_EXTENSIONS,
	validateAttachmentMetadata,
} from "@/lib/attachments/policy";
import { useSolutionAttachments } from "@/hooks/use-solution-attachments";
import { useInlineDescriptionImages } from "@/hooks/use-inline-description-images";
import { ApproverSearchField } from "@/components/approvals/approver-search-field";
import { filterApproversByQuery } from "@/lib/approver-search";

const ACCEPTED_UPLOAD_TYPES = "PDF, Word, Excel, PowerPoint, Images";

interface FileAttachment {
	id: string;
	fileName: string;
	fileType: "pdf" | "image" | "docx" | "xlsx" | string;
	description?: string;
}

interface User {
	id: string;
	name: string;
	email: string;
	role: string;
	departmentName: string | null;
	level?: number;
}

interface SubmitterModalProps {
	mode: "request" | "solution" | "resubmit";
	open: boolean;
	onOpenChange: (open: boolean) => void;
	initialData?: {
		title?: string;
		description?: string;
		templateId?: string;
		requestId?: string;
		requestTitle?: string;
		requestDescription?: string;
		existingFiles?: FileAttachment[];
		solution?: {
			title?: string;
			description?: string;
			cost?: number;
			currency?: string;
			timeline?: string;
		};
		rejectionReason?: string;
		rejectedBy?: string;
		rejectedAt?: string;
	};
	availableUsers?: User[];
	onSubmitRequest?: (data: {
		title: string;
		description: string;
		templateId?: string;
		files: File[];
		inlineImageSessionId: string;
	}) => Promise<{ success: boolean; error?: string }>;
	onSubmitSolution?: (data: {
		title: string;
		description: string;
		cost: number;
		currency: string;
		timeline: string;
		fileIds: string[];
		useCustomHierarchy: boolean;
		customApprovers: string[];
		inlineImageSessionId: string;
	}) => Promise<{ success: boolean; error?: string }>;
	onResubmit?: (data: {
		title?: string;
		description: string;
		cost: number;
		currency: string;
		timeline: string;
		fileIds: string[];
		deletedFileIds: string[];
		useCustomHierarchy: boolean;
		customApprovers: string[];
		inlineImageSessionId: string;
	}) => Promise<{ success: boolean; error?: string }>;
}

// File icon helper
function getFileIcon(fileType: string) {
	switch (fileType) {
		case "pdf":
			return <FileText className="w-5 h-5 text-red-500" />;
		case "image":
			return <FileImage className="w-5 h-5 text-purple-500" />;
		case "xlsx":
			return <FileSpreadsheet className="w-5 h-5 text-emerald-500" />;
		case "docx":
			return <FileText className="w-5 h-5 text-blue-500" />;
		default:
			return <File className="w-5 h-5 text-slate-400" />;
	}
}

// Custom Approval Hierarchy Picker (for submitter to configure)
function CustomApprovalPicker({
	availableUsers,
	selectedApprovers,
	onChange,
}: {
	availableUsers: User[];
	selectedApprovers: string[];
	onChange: (approvers: string[]) => void;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const searchInputRef = useRef<HTMLInputElement>(null);
	const unselectedUsers = availableUsers.filter(
		(user) => !selectedApprovers.includes(user.id),
	);
	const filteredUsers = filterApproversByQuery(unselectedUsers, searchQuery);

	const setPickerOpen = (nextOpen: boolean) => {
		setIsOpen(nextOpen);
		if (!nextOpen) {
			setSearchQuery("");
			return;
		}
		requestAnimationFrame(() => {
			searchInputRef.current?.focus();
		});
	};

	const addApprover = (userId: string) => {
		if (!selectedApprovers.includes(userId)) {
			onChange([...selectedApprovers, userId]);
		}
	};

	const removeApprover = (index: number) => {
		const newApprovers = [...selectedApprovers];
		newApprovers.splice(index, 1);
		onChange(newApprovers);
	};

	const moveUp = (index: number) => {
		if (index === 0) return;
		const newApprovers = [...selectedApprovers];
		[newApprovers[index], newApprovers[index - 1]] = [
			newApprovers[index - 1],
			newApprovers[index],
		];
		onChange(newApprovers);
	};

	const moveDown = (index: number) => {
		if (index === selectedApprovers.length - 1) return;
		const newApprovers = [...selectedApprovers];
		[newApprovers[index], newApprovers[index + 1]] = [
			newApprovers[index + 1],
			newApprovers[index],
		];
		onChange(newApprovers);
	};

	const getUserById = (id: string) => availableUsers.find((u) => u.id === id);

	return (
		<div className="space-y-3">
			{/* Selected Approvers */}
			<div className="space-y-2">
				{selectedApprovers.length === 0 && (
					<p className="text-sm text-slate-400 italic">
						No custom approvers selected
					</p>
				)}
				{selectedApprovers.map((userId, index) => {
					const user = getUserById(userId);
					if (!user) return null;
					return (
						<div
							key={`${userId}-${index}`}
							className="flex items-center gap-2 p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800"
						>
							<div className="flex-1 min-w-0">
								<p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
									Level {index + 1}: {user.name}
								</p>
								<p className="text-xs text-slate-400 truncate">
									{user.departmentName ?? "No department"} • {user.email}
								</p>
							</div>
							<div className="flex items-center gap-1">
								<button
									onClick={() => moveUp(index)}
									disabled={index === 0}
									className="p-1.5 text-slate-400 hover:text-slate-600 disabled:opacity-30 rounded"
								>
									<ArrowUp className="w-4 h-4" />
								</button>
								<button
									onClick={() => moveDown(index)}
									disabled={index === selectedApprovers.length - 1}
									className="p-1.5 text-slate-400 hover:text-slate-600 disabled:opacity-30 rounded"
								>
									<ArrowDown className="w-4 h-4" />
								</button>
								<button
									onClick={() => removeApprover(index)}
									className="p-1.5 text-slate-400 hover:text-red-500 rounded"
								>
									<Trash2 className="w-4 h-4" />
								</button>
							</div>
						</div>
					);
				})}
			</div>

			{/* Add Approver Dropdown */}
			<div className="relative">
				<button
					data-picker-open
					onClick={() => setPickerOpen(!isOpen)}
					className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-dashed border-slate-300 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
				>
					<Plus className="w-4 h-4" />
					Add Approver
				</button>

				{isOpen && (
					<div
						data-picker-root
						className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-lg z-50"
					>
						<div className="p-2">
							<ApproverSearchField
								value={searchQuery}
								onChange={setSearchQuery}
								resultCount={filteredUsers.length}
								inputRef={searchInputRef}
							/>
						</div>
						<div className="max-h-[260px] overflow-y-auto">
							{unselectedUsers.length === 0 ? (
								<p className="px-3 py-2 text-sm text-slate-400 italic">
									No more users available
								</p>
							) : filteredUsers.length === 0 ? (
								<p className="px-3 py-2 text-sm text-slate-400 italic">
									No approvers found
								</p>
							) : (
								filteredUsers.map((user) => (
									<button
										data-picker-item
										key={user.id}
										onClick={() => {
											addApprover(user.id);
											setPickerOpen(false);
										}}
										className="w-full text-left px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm"
									>
										<p className="font-medium text-slate-900 dark:text-slate-100">
											{user.name}
										</p>
										<p className="text-xs text-slate-500">
											{user.departmentName ?? "No department"} • {user.email}
										</p>
									</button>
								))
							)}
						</div>
					</div>
				)}
			</div>

			{/* Click outside to close */}
			{isOpen && (
				<div
					data-picker-close
					className="fixed inset-0 z-40"
					onClick={() => setPickerOpen(false)}
				/>
			)}
		</div>
	);
}

export { CustomApprovalPicker as SubmitterApprovalPickerHarness };

// Main Submitter Modal Component
export function SubmitterModal({
	mode,
	open,
	onOpenChange,
	initialData,
	availableUsers = [],
	onSubmitRequest,
	onSubmitSolution,
	onResubmit,
}: SubmitterModalProps) {
	// Form states
	const [title, setTitle] = useState(initialData?.title || "");
	const [description, setDescription] = useState(
		initialData?.description || "",
	);
	const [solutionTitle, setSolutionTitle] = useState(
		initialData?.solution?.title ||
			(mode === "solution" ? initialData?.requestTitle || "" : ""),
	);
	const [solutionDescription, setSolutionDescription] = useState(
		initialData?.solution?.description || "",
	);
	const [cost, setCost] = useState(
		initialData?.solution?.cost?.toString() || "",
	);
	const [currency, setCurrency] = useState(
		initialData?.solution?.currency || "THB",
	);
	const [timeline, setTimeline] = useState(
		initialData?.solution?.timeline || "",
	);
	const [files, setFiles] = useState<File[]>([]);
	const [fileDescriptions, setFileDescriptions] = useState<
		Record<string, string>
	>({});

	// Template selection state (for request mode)
	const [selectedTemplate, setSelectedTemplate] = useState(
		initialData?.templateId || "",
	);
	const [templates, setTemplates] = useState<
		Array<{ id: string; name: string; title: string; description: string }>
	>([]);
	const [loadingTemplates, setLoadingTemplates] = useState(false);

	// Fetch templates from database
	useEffect(() => {
		if (mode === "request" && open) {
			const fetchTemplates = async () => {
				setLoadingTemplates(true);
				try {
					const response = await fetch("/api/templates");
					if (response.ok) {
						const data = await response.json();
						setTemplates(data);
					}
				} catch (error) {
					console.error("Failed to fetch templates:", error);
				} finally {
					setLoadingTemplates(false);
				}
			};
			fetchTemplates();
		}
	}, [mode, open]);

	// Populate fields when template is selected
	useEffect(() => {
		if (selectedTemplate && templates.length > 0) {
			const template = templates.find((t) => t.id === selectedTemplate);
			if (template) {
				setTitle(template.title);
				setDescription(template.description);
			}
		}
	}, [selectedTemplate, templates]);

	// Reset every New Request field whenever request mode opens, so stale state
	// from a previous open never leaks into a fresh request. Solution/resubmit
	// fields are intentionally untouched here.
	const resetRequestDraft = useCallback(() => {
		setTitle("");
		setDescription("");
		setSelectedTemplate("");
		setFiles([]);
		setFileDescriptions({});
		setFileUploadError(null);
		setUseCustomHierarchy(false);
		setCustomApprovers([]);
		setDeletedFileIds([]);
	}, []);

	useEffect(() => {
		if (mode !== "request" || !open) return;
		resetRequestDraft();
	}, [mode, open, resetRequestDraft]);

	// Existing files state (for resubmit mode)
	const [existingFiles, setExistingFiles] = useState<FileAttachment[]>(
		initialData?.existingFiles || [],
	);
	const [deletedFileIds, setDeletedFileIds] = useState<string[]>([]);
	const [fileUploadError, setFileUploadError] = useState<string | null>(null);
	const [useCustomHierarchy, setUseCustomHierarchy] = useState(false);
	const [customApprovers, setCustomApprovers] = useState<string[]>([]);

	// Shared upload hook for solution/resubmit modes (request mode keeps its own
	// post-request file flow unchanged). The hook owns draft attachment state;
	// ensureUploaded() is the authoritative upload gate before metadata submit.
	const requestId = initialData?.requestId || "";
	const {
		items: attachmentItems,
		addFiles,
		removeItem,
		ensureUploaded,
		reset,
		clear,
	} = useSolutionAttachments({ requestId });
	// One inline image coordinator for both description editors (request and
	// solution/resubmit modes); every save path claims or cleans its session.
	const inlineImages = useInlineDescriptionImages();
	const [isBusy, setIsBusy] = useState(false);
	const [submitError, setSubmitError] = useState<string | null>(null);

	const isSolutionMode = mode === "solution" || mode === "resubmit";

	// Update solution data when initialData changes (for resubmit mode)
	useEffect(() => {
		if (mode === "resubmit" && initialData?.solution) {
			setSolutionTitle(initialData.solution.title || "");
			setSolutionDescription(initialData.solution.description || "");
			setCost(initialData.solution.cost?.toString() || "");
			setCurrency(initialData.solution.currency || "THB");
			setTimeline(initialData.solution.timeline || "");
		}
	}, [mode, initialData?.solution, initialData?.existingFiles]);

	useEffect(() => {
		if (mode === "solution" && open) {
			setSolutionTitle(initialData?.requestTitle || "");
			setCurrency(initialData?.solution?.currency || "THB");
		}
	}, [mode, open, initialData?.requestTitle, initialData?.solution?.currency]);

	// Handle file upload
	const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		if (e.target.files) {
			const selectedFiles = Array.from(e.target.files);
			const firstValidationError = selectedFiles
				.map((file) =>
					validateAttachmentMetadata({
						name: file.name,
						type: file.type,
						size: file.size,
					}),
				)
				.find((msg) => msg !== null);

			if (firstValidationError) {
				setFileUploadError(firstValidationError);
				e.target.value = "";
				return;
			}

			setFileUploadError(null);
			// Solution/resubmit modes route through the shared upload hook; request
			// mode keeps its own post-request file flow unchanged.
			if (isSolutionMode) {
				addFiles(selectedFiles);
			} else {
				setFiles((prev: File[]) => [...prev, ...selectedFiles]);
			}
		}
	};

	const removeFile = (index: number) => {
		setFiles((prev: File[]) =>
			prev.filter((_: File, i: number) => i !== index),
		);
	};

	const handleRemoveAttachment = async (id: string) => {
		try {
			await removeItem(id);
		} catch (error) {
			setSubmitError(
				error instanceof Error ? error.message : "Failed to remove file",
			);
		}
	};

	// Retry is upload-only: it re-runs the coordinator for the remaining
	// non-success items (reusing prior successes) so a failed file is retried in
	// isolation — never invoking the metadata submit.
	const handleRetryAttachment = async () => {
		if (isBusy) return;
		setIsBusy(true);
		setSubmitError(null);
		try {
			const result = await ensureUploaded();
			if (!result.success) {
				const remaining = result.items.filter(
					(entry) => entry.status === "error",
				);
				setSubmitError(
					remaining.length === 1
						? "1 file still failed to upload"
						: `${remaining.length} files still failed to upload`,
				);
			}
		} catch (error) {
			setSubmitError(
				error instanceof Error ? error.message : "An error occurred",
			);
		} finally {
			setIsBusy(false);
		}
	};

	const removeExistingFile = (fileId: string) => {
		setExistingFiles((prev) => prev.filter((f) => f.id !== fileId));
		setDeletedFileIds((prev) => [...prev, fileId]);
	};

	const updateFileDescription = (fileName: string, description: string) => {
		setFileDescriptions((prev: Record<string, string>) => ({
			...prev,
			[fileName]: description,
		}));
	};

	// Handle submission
	const handleSubmit = async () => {
		setSubmitError(null);

		if (mode === "request" && onSubmitRequest) {
			setIsBusy(true);
			try {
				// Await the caller's server action; only a confirmed success may
				// clear the draft session and close the modal.
				const result = await onSubmitRequest({
					title,
					description,
					templateId: selectedTemplate || undefined,
					files,
					inlineImageSessionId: inlineImages.uploadSessionId,
				});
				if (!result.success) {
					setSubmitError(result.error || "Failed to submit");
					return;
				}
				inlineImages.clear();
				onOpenChange(false);
			} catch (error) {
				setSubmitError(
					error instanceof Error
						? error.message
						: "An error occurred",
				);
			} finally {
				setIsBusy(false);
			}
			return;
		}

		if (isSolutionMode) {
			setIsBusy(true);
			try {
				// ensureUploaded() is authoritative: uploads pending/errored items,
				// reuses prior successes, and returns the final batch result.
				const result = await ensureUploaded();
				if (!result.success) {
					setSubmitError("Some files failed to upload");
					return;
				}

				if (mode === "solution" && onSubmitSolution) {
					const res = await onSubmitSolution({
						title: solutionTitle,
						description: solutionDescription,
						cost: parseFloat(cost) || 0,
						currency,
						timeline,
						fileIds: result.attachmentIds,
						useCustomHierarchy,
						customApprovers,
						inlineImageSessionId: inlineImages.uploadSessionId,
					});
					if (res.success) {
						// Drafts are now linked — clear without invoking cleanup.
						inlineImages.clear();
						clear();
						onOpenChange(false);
					} else {
						setSubmitError(res.error || "Failed to submit solution");
					}
				} else if (mode === "resubmit" && onResubmit) {
					const res = await onResubmit({
						title: undefined,
						description: solutionDescription,
						cost: parseFloat(cost) || 0,
						currency,
						timeline,
						fileIds: result.attachmentIds,
						deletedFileIds,
						useCustomHierarchy,
						customApprovers,
						inlineImageSessionId: inlineImages.uploadSessionId,
					});
					if (res.success) {
						inlineImages.clear();
						clear();
						onOpenChange(false);
					} else {
						setSubmitError(res.error || "Failed to resubmit solution");
					}
				}
			} catch (error) {
				setSubmitError(
					error instanceof Error ? error.message : "An error occurred",
				);
			} finally {
				setIsBusy(false);
			}
		}
	};

	// On close/cancel in any mode, await draft cleanup (solution attachments
	// via reset, plus the inline image coordinator) before closing. Cleanup
	// errors are surfaced and the modal stays open.
	const requestClose = () => {
		void handleCloseWithCleanup();
	};

	const handleCloseWithCleanup = async () => {
		setIsBusy(true);
		setSubmitError(null);
		try {
			await reset();
			await inlineImages.reset();
			onOpenChange(false);
		} catch (error) {
			setSubmitError(
				error instanceof Error
					? error.message
					: "Failed to clean up draft files",
			);
		} finally {
			setIsBusy(false);
		}
	};

	const isSubmitDisabled = () => {
		if (inlineImages.hasBlockingUploads) {
			return true;
		}
		if (mode === "request") {
			return !title.trim() || !description.trim();
		}
		return (
			!solutionTitle.trim() ||
			!solutionDescription.trim() ||
			!cost ||
			!timeline.trim()
		);
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) requestClose();
			}}
		>
			<DialogContent className="max-w-5xl w-full max-h-[90vh] p-0 gap-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl rounded-xl overflow-hidden">
				{/* Header */}
				<DialogHeader className="flex-shrink-0 px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-20">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							{mode === "request" && (
								<FileText className="w-5 h-5 text-blue-600" />
							)}
							{mode === "solution" && (
								<CheckCircle2 className="w-5 h-5 text-purple-600" />
							)}
							{mode === "resubmit" && (
								<RotateCcw className="w-5 h-5 text-amber-600" />
							)}
							<DialogTitle className="text-lg font-bold text-slate-900 dark:text-slate-100 tracking-tight m-0">
								{mode === "request" && "Submit New Request"}
								{mode === "solution" && "Submit Engineering Solution"}
								{mode === "resubmit" && "Resubmit Solution"}
							</DialogTitle>
						</div>
						<DialogDescription className="sr-only">
							{mode === "request" &&
								"Fill out the form to submit a new improvement request"}
							{mode === "solution" &&
								"Provide engineering solution details and cost estimate"}
							{mode === "resubmit" && "Update and resubmit your solution"}
						</DialogDescription>
						<button
							onClick={requestClose}
							className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-slate-600"
						>
							<X className="w-5 h-5" />
						</button>
					</div>
				</DialogHeader>
				{/* Scrollable Content */}
				<div className="min-h-0 flex-1 overflow-y-auto p-6 space-y-6 max-h-[calc(92svh-180px)] pointer-fine:max-h-[calc(90vh-180px)]">
					{/* Rejection Banner (only for resubmit mode) */}
					{mode === "resubmit" && initialData?.rejectionReason && (
						<div className="bg-red-50 dark:bg-red-900/10 rounded-xl p-4 border border-red-200 dark:border-red-800/30">
							<div className="flex items-start gap-3">
								<AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
								<div>
									<h4 className="text-sm font-bold text-red-900 dark:text-red-400">
										Solution Was Rejected
									</h4>
									<p className="text-xs text-red-600 dark:text-red-300 mt-1">
										Rejected by {initialData.rejectedBy} on{" "}
										{initialData.rejectedAt &&
											format(new Date(initialData.rejectedAt), "MMM d, yyyy")}
									</p>
									<div className="mt-2 p-2 bg-white dark:bg-slate-900 rounded border border-red-100 dark:border-red-800/30">
										<p className="text-xs text-slate-700 dark:text-slate-300 italic">
											&ldquo;{initialData.rejectionReason}&rdquo;
										</p>
									</div>
								</div>
							</div>
						</div>
					)}

					{/* Request Mode Fields */}
					{mode === "request" && (
						<div className="space-y-4">
							{/* Template Selection */}
							<div>
								<Label htmlFor="template" className="text-sm font-bold">
									Template
								</Label>
								<Select
									value={selectedTemplate}
									onValueChange={setSelectedTemplate}
									disabled={loadingTemplates}
								>
									<SelectTrigger className="mt-1.5">
										<SelectValue
											placeholder={
												loadingTemplates
													? "Loading templates..."
													: "Select a template (optional)"
											}
										/>
									</SelectTrigger>
									<SelectContent>
										{templates.length === 0 && !loadingTemplates && (
											<SelectItem value="none" disabled>
												No templates available
											</SelectItem>
										)}
										{templates.map((template) => (
											<SelectItem key={template.id} value={template.id}>
												{template.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<p className="text-xs text-slate-500 mt-1">
									Select a template to pre-fill common fields (optional)
								</p>
							</div>
							<div>
								<Label htmlFor="title" className="text-sm font-bold">
									Request Title <span className="text-red-500">*</span>
								</Label>
								<Input
									id="title"
									value={title}
									onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
										setTitle(e.target.value)
									}
									placeholder="Enter a clear title for your request..."
									className="mt-1.5"
								/>
							</div>
							<div>
								<Label htmlFor="description" className="text-sm font-bold">
									Description <span className="text-red-500">*</span>
								</Label>
								<RichTextEditor
									id="description"
									value={description}
									onChange={setDescription}
									minHeight={140}
									inlineImages={inlineImages}
								/>
							</div>
						</div>
					)}

					{/* Solution Mode Fields */}
					{(mode === "solution" || mode === "resubmit") && (
						<div className="space-y-4">
							{/* View Original Request Link (Stage 2.1) */}
							{mode === "solution" && initialData?.requestId && (
								<div className="bg-blue-50 dark:bg-blue-900/10 rounded-lg p-3 border border-blue-200 dark:border-blue-800/30">
									<a
										href={`/requests/${initialData.requestId}`}
										target="_blank"
										rel="noopener noreferrer"
										className="flex items-center gap-2 text-sm text-blue-700 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors"
									>
										<ExternalLink className="w-4 h-4" />
										<span className="font-medium">View Original Request</span>
										<span className="text-xs text-blue-500">
											({initialData.requestTitle || "Request Details"})
										</span>
									</a>
								</div>
							)}
							{mode === "solution" && (
								<div>
									<Label htmlFor="solutionTitle" className="text-sm font-bold">
										Solution Title <span className="text-red-500">*</span>
									</Label>
									<Input
										id="solutionTitle"
										value={solutionTitle}
										onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
											setSolutionTitle(e.target.value)
										}
										placeholder="Enter solution title..."
										className="mt-1.5"
									/>
								</div>
							)}
							<div>
								<Label
									htmlFor="solutionDescription"
									className="text-sm font-bold"
								>
									Solution Description <span className="text-red-500">*</span>
								</Label>
								<RichTextEditor
									id="solutionDescription"
									value={solutionDescription}
									onChange={setSolutionDescription}
									minHeight={140}
									inlineImages={inlineImages}
								/>
							</div>

							{/* Cost and Timeline */}
							<div className="grid grid-cols-2 gap-4">
								<div>
									<Label
										htmlFor="cost"
										className="text-sm font-bold flex items-center gap-1.5"
									>
										<DollarSign className="w-4 h-4" />
										Cost <span className="text-red-500">*</span>
									</Label>
									<div className="flex gap-2 mt-1.5">
										<select
											value={currency}
											onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
												setCurrency(e.target.value)
											}
											className="px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm"
										>
											<option value="USD">USD</option>
											<option value="EUR">EUR</option>
											<option value="GBP">GBP</option>
											<option value="JPY">JPY</option>
											<option value="THB">THB</option>
										</select>
										<Input
											id="cost"
											type="number"
											value={cost}
											onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
												setCost(e.target.value)
											}
											placeholder="0.00"
											className="flex-1"
										/>
									</div>
								</div>
								<div>
									<Label
										htmlFor="timeline"
										className="text-sm font-bold flex items-center gap-1.5"
									>
										<Clock className="w-4 h-4" />
										Timeline <span className="text-red-500">*</span>
									</Label>
									<Input
										id="timeline"
										value={timeline}
										onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
											setTimeline(e.target.value)
										}
										placeholder="e.g., 2 weeks, 3 months"
										className="mt-1.5"
									/>
								</div>
							</div>

							{/* Custom Approval Hierarchy Toggle - for solution and resubmit modes */}
							{(mode === "solution" || mode === "resubmit") && (
								<div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
									<div className="flex items-center justify-between mb-3">
										<div className="flex items-center gap-2">
											<Settings2 className="w-4 h-4 text-slate-500" />
											<span className="text-sm font-bold">
												Custom Approval Hierarchy
											</span>
										</div>
										<Switch
											checked={useCustomHierarchy}
											onCheckedChange={setUseCustomHierarchy}
										/>
									</div>
									<p className="text-xs text-slate-500 mb-3">
										Enable to define a custom approval chain instead of using
										the default hierarchy.
									</p>

									{useCustomHierarchy && (
										<div className="border-t border-slate-200 dark:border-slate-700 pt-3">
											<CustomApprovalPicker
												availableUsers={availableUsers}
												selectedApprovers={customApprovers}
												onChange={setCustomApprovers}
											/>
										</div>
									)}
								</div>
							)}
						</div>
					)}

					<Separator />

					{/* File Upload Section */}
					<section>
						<h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-3 flex items-center gap-2">
							<Paperclip className="w-4 h-4 text-slate-400" />
							Attachments
						</h3>

						{/* Existing Files (for resubmit mode) */}
						{mode === "resubmit" && existingFiles.length > 0 && (
							<div className="mb-4">
								<h4 className="text-xs font-bold text-slate-500 mb-2">
									Existing Attachments ({existingFiles.length})
								</h4>
								<div className="space-y-2">
									{existingFiles.map((file) => {
										return (
											<div
												key={file.id}
												className="flex items-start gap-3 p-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-800/50"
											>
												{getFileIcon(file.fileType)}
												<div className="flex-1 min-w-0">
													<p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
														{file.fileName}
													</p>
													{file.description && (
														<p className="text-xs text-slate-500 truncate">
															{file.description}
														</p>
													)}
												</div>
												<button
													onClick={() => removeExistingFile(file.id)}
													className="p-1 text-slate-400 hover:text-red-500 transition-colors"
													title="Remove file"
												>
													<Trash2 className="w-4 h-4" />
												</button>
											</div>
										);
									})}
								</div>
								<p className="text-xs text-slate-400 mt-2 italic">
									Removed files will be deleted when you resubmit
								</p>
							</div>
						)}

						{/* Upload Button */}
						<div className="mb-4">
							<label className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
								<FileUp className="w-5 h-5 text-slate-400" />
								<span className="text-sm font-medium text-slate-600 dark:text-slate-400">
									Click to upload files
								</span>
								<input
									type="file"
									multiple
									onChange={handleFileChange}
									accept={ATTACHMENT_EXTENSIONS.map((ext) => `.${ext}`).join(
										",",
									)}
									className="hidden"
								/>
							</label>
							<p className="mt-2 text-xs text-slate-500">
								Allowed: {ACCEPTED_UPLOAD_TYPES}. Maximum size:{" "}
								{Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB per file.
							</p>
							{fileUploadError && (
								<p className="mt-2 text-xs text-red-600">{fileUploadError}</p>
							)}
						</div>

						{/* File List */}
						{isSolutionMode && attachmentItems.length > 0 && (
							<div className="space-y-2">
								{attachmentItems.map((item) => (
									<div
										key={item.id}
										className="flex items-start gap-3 p-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900"
									>
										{getFileIcon(
											item.file.name.split(".").pop()?.toLowerCase() || "",
										)}
										<div className="flex-1 min-w-0">
											<div className="flex items-center justify-between">
												<p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
													{item.file.name}
												</p>
												<button
													onClick={() => handleRemoveAttachment(item.id)}
													disabled={isBusy || item.status === "uploading"}
													className="p-1 text-slate-400 hover:text-red-500 transition-colors disabled:opacity-30"
												>
													<Trash2 className="w-4 h-4" />
												</button>
											</div>
											{item.status === "uploading" && (
												<p className="text-xs text-slate-500 mt-1">
													Uploading...
												</p>
											)}
											{item.status === "success" && (
												<p className="text-xs text-green-600 mt-1">Uploaded</p>
											)}
											{item.status === "error" && item.error && (
												<p className="text-xs text-red-600 mt-1">
													{item.error}
												</p>
											)}
										</div>
										{/* Retry action beside errored items: re-upload via the
                        coordinator without touching metadata. */}
										{item.status === "error" && (
											<button
												onClick={handleRetryAttachment}
												disabled={isBusy}
												className="p-1 text-blue-600 hover:text-blue-700 transition-colors disabled:opacity-30 flex items-center gap-1 text-xs"
											>
												<RotateCcw className="w-4 h-4" />
												Retry
											</button>
										)}
									</div>
								))}
							</div>
						)}
						{!isSolutionMode && files.length > 0 && (
							<div className="space-y-2">
								{files.map((file: File, index: number) => {
									return (
										<div
											key={`new-${file.name}-${index}-${file.lastModified || Date.now()}`}
											className="flex items-start gap-3 p-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900"
										>
											{getFileIcon(
												file.name.split(".").pop()?.toLowerCase() || "",
											)}
											<div className="flex-1 min-w-0 space-y-2">
												<div className="flex items-center justify-between">
													<p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
														{file.name}
													</p>
													<button
														onClick={() => removeFile(index)}
														className="p-1 text-slate-400 hover:text-red-500 transition-colors"
													>
														<Trash2 className="w-4 h-4" />
													</button>
												</div>
												<input
													type="text"
													value={fileDescriptions[file.name] || ""}
													onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
														updateFileDescription(file.name, e.target.value)
													}
													placeholder="Add a description for this file..."
													className="w-full text-xs px-2 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded"
												/>
											</div>
										</div>
									);
								})}
							</div>
						)}
					</section>
				</div>
				{/* Footer Actions */}
				<div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
					{inlineImages.hasBlockingUploads ? (
						<p className="text-sm text-amber-700 flex-1 pr-4">
							Wait for image uploads, or retry/remove failed images.
						</p>
					) : (
						submitError && (
							<p className="text-sm text-red-600 flex-1 pr-4">{submitError}</p>
						)
					)}
					<Button
						variant="outline"
						onClick={requestClose}
						disabled={isBusy}
						className={submitError ? "" : "ml-auto"}
					>
						{isBusy ? "Cleaning up..." : "Cancel"}
					</Button>
					<Button
						onClick={handleSubmit}
						disabled={isSubmitDisabled() || isBusy}
						className={cn(
							"text-white ml-3",
							mode === "resubmit"
								? "bg-amber-600 hover:bg-amber-700"
								: "bg-emerald-600 hover:bg-emerald-700",
						)}
					>
						{mode === "request" && (
							<>
								<Send className="w-4 h-4 mr-1.5" />
								Submit Request
							</>
						)}
						{mode === "solution" && (
							<>
								<CheckCircle2 className="w-4 h-4 mr-1.5" />
								Submit Solution
							</>
						)}
						{mode === "resubmit" && (
							<>
								<RotateCcw className="w-4 h-4 mr-1.5" />
								Resubmit Solution
							</>
						)}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
