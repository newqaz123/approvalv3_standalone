"use client";

import { useState, useEffect } from "react";
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
	AlertTriangle,
	RotateCcw,
	Trash2,
	Send,
	FileUp,
} from "lucide-react";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { RichTextEditor } from "@/components/rich-text/rich-text-editor-lazy";
import {
	inlineImageBlockingMessage,
	useInlineDescriptionImages,
} from "@/hooks/use-inline-description-images";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { CancelRequestDialog } from "./cancel-request-dialog";

const ACCEPTED_UPLOAD_EXTENSIONS =
	".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.gif";
const ACCEPTED_UPLOAD_TYPES = "PDF, Word, Excel, PowerPoint, Images";

// Types
interface FileAttachment {
	id: string;
	fileName: string;
	fileType: "pdf" | "image" | "docx" | "xlsx" | string;
	description?: string;
}

interface RequestResubmitModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	initialData: {
		title: string;
		description: string;
		rejectionReason: string;
		rejectedBy: string;
		rejectedAt: string;
		files: FileAttachment[];
	};
	onResubmit?: (data: {
		title: string;
		description: string;
		files: File[];
		deletedFileIds?: string[];
		inlineImageSessionId: string;
	}) => Promise<{ success: boolean; error?: string }>;
	showCancel?: boolean;
	requestId?: string;
	requestTitle?: string;
	onCancelled?: () => void;
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

export function RequestResubmitModal({
	open,
	onOpenChange,
	initialData,
	onResubmit,
	showCancel,
	requestId,
	requestTitle,
	onCancelled,
}: RequestResubmitModalProps) {
	const canResubmit = Boolean(onResubmit);
	// One inline image coordinator per mounted modal; the editor uploads
	// through it and the submit/close lifecycle below claims or cleans it.
	const inlineImages = useInlineDescriptionImages();
	const inlineImageBlockingGuidance = inlineImageBlockingMessage(
		inlineImages.blockingReason,
	);
	const [title, setTitle] = useState(initialData.title);
	const [description, setDescription] = useState(initialData.description);
	const [existingFiles, setExistingFiles] = useState<FileAttachment[]>(
		initialData.files,
	);
	const [deletedFileIds, setDeletedFileIds] = useState<string[]>([]);
	const [newFiles, setNewFiles] = useState<File[]>([]);
	const [fileDescriptions, setFileDescriptions] = useState<
		Record<string, string>
	>({});

	const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		if (e.target.files) {
			const files = Array.from(e.target.files);
			setNewFiles((prev: File[]) => [...prev, ...files]);
		}
	};

	const removeFile = (index: number) => {
		setNewFiles((prev: File[]) =>
			prev.filter((_: File, i: number) => i !== index),
		);
	};

	const removeExistingFile = (fileId: string) => {
		setExistingFiles((prev) => prev.filter((f) => f.id !== fileId));
		setDeletedFileIds((prev) => [...prev, fileId]);
	};

	const updateFileDescription = (fileName: string, desc: string) => {
		setFileDescriptions((prev: Record<string, string>) => ({
			...prev,
			[fileName]: desc,
		}));
	};

	const [submitError, setSubmitError] = useState<string | null>(null);
	const [isBusy, setIsBusy] = useState(false);

	const handleSubmit = async () => {
		if (!onResubmit) return;
		if (inlineImages.hasBlockingOperations) {
			setSubmitError(inlineImageBlockingMessage(inlineImages.blockingReason));
			return;
		}
		setIsBusy(true);
		setSubmitError(null);
		try {
			// Await the caller's server action; only a confirmed success may
			// clear the draft session and close the modal.
			const result = await onResubmit({
				title,
				description,
				files: newFiles,
				deletedFileIds,
				inlineImageSessionId: inlineImages.uploadSessionId,
			});
			if (!result.success) {
				setSubmitError(result.error || "Failed to resubmit request");
				return;
			}
			inlineImages.clear();
			onOpenChange(false);
		} catch (error) {
			setSubmitError(
				error instanceof Error ? error.message : "An error occurred",
			);
		} finally {
			setIsBusy(false);
		}
	};

	// Every close path routes through one awaited cleanup so uncommitted
	// inline image drafts are deleted before the modal closes. A cleanup
	// failure keeps the modal open with a visible error for retry.
	const requestClose = () => {
		void handleCloseWithCleanup();
	};

	const handleCloseWithCleanup = async () => {
		setIsBusy(true);
		setSubmitError(null);
		try {
			await inlineImages.reset();
			onOpenChange(false);
		} catch (error) {
			setSubmitError(
				error instanceof Error
					? error.message
					: "Failed to clean up draft images",
			);
		} finally {
			setIsBusy(false);
		}
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
							<RotateCcw className="w-5 h-5 text-amber-600" />
							<DialogTitle className="text-lg font-bold text-slate-900 dark:text-slate-100 tracking-tight m-0">
								{canResubmit ? "Resubmit Request" : "Rejected Request"}
							</DialogTitle>
						</div>
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
					{/* Rejection Banner */}
					<div className="bg-red-50 dark:bg-red-900/10 rounded-xl p-4 border border-red-200 dark:border-red-800/30">
						<div className="flex items-start gap-3">
							<AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
							<div>
								<h4 className="text-sm font-bold text-red-900 dark:text-red-400">
									Request Was Rejected
								</h4>
								<p className="text-xs text-red-600 dark:text-red-300 mt-1">
									Rejected by {initialData.rejectedBy} on{" "}
									{format(new Date(initialData.rejectedAt), "MMM d, yyyy")}
								</p>
								<div className="mt-2 p-2 bg-white dark:bg-slate-900 rounded border border-red-100 dark:border-red-800/30">
									<p className="text-xs text-slate-700 dark:text-slate-300 italic">
										&ldquo;{initialData.rejectionReason}&rdquo;
									</p>
								</div>
							</div>
						</div>
					</div>

					{/* Form Fields */}
					<div className="space-y-4">
						<div>
							<Label htmlFor="title" className="text-sm font-bold">
								Request Title <span className="text-red-500">*</span>
							</Label>
							<Input
								id="title"
								value={title}
								disabled={!canResubmit}
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
								disabled={!canResubmit}
								minHeight={140}
								inlineImages={inlineImages}
							/>
						</div>
					</div>

					<Separator />

					{/* Existing Files (with delete option) */}
					{existingFiles.length > 0 && (
						<section>
							<h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-3 flex items-center gap-2">
								<Paperclip className="w-4 h-4 text-slate-400" />
								Existing Attachments ({existingFiles.length})
							</h3>
							<div className="space-y-2">
								{existingFiles.map((file) => (
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
										{canResubmit ? (
											<button
												onClick={() => removeExistingFile(file.id)}
												className="p-1 text-slate-400 hover:text-red-500 transition-colors"
												title="Remove file"
											>
												<Trash2 className="w-4 h-4" />
											</button>
										) : null}
									</div>
								))}
							</div>
							{canResubmit ? (
								<p className="text-xs text-slate-400 mt-2 italic">
									Removed files will be deleted when you resubmit
								</p>
							) : null}
						</section>
					)}

					{/* New File Upload */}
					{canResubmit ? (
						<section>
							<h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-3 flex items-center gap-2">
								<FileUp className="w-4 h-4" />
								Add New Attachments
							</h3>

							<div className="mb-4">
								<label className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
									<FileUp className="w-5 h-5 text-slate-400" />
									<span className="text-sm font-medium text-slate-600 dark:text-slate-400">
										Click to upload additional files
									</span>
									<input
										type="file"
										multiple
										onChange={handleFileChange}
										accept={ACCEPTED_UPLOAD_EXTENSIONS}
										className="hidden"
									/>
								</label>
								<p className="mt-2 text-xs text-slate-500">
									Allowed: {ACCEPTED_UPLOAD_TYPES}. Maximum size: 10MB per file.
								</p>
							</div>

							{newFiles.length > 0 && (
								<div className="space-y-2">
									{newFiles.map((file: File, index: number) => (
										<div
											key={`${file.name}-${index}`}
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
									))}
								</div>
							)}
						</section>
					) : null}
				</div>

				{/* Footer Actions */}
				<div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							onClick={requestClose}
							disabled={isBusy}
						>
							{canResubmit ? "Cancel" : "Close"}
						</Button>
						{canResubmit && showCancel && requestId && requestTitle ? (
							<CancelRequestDialog
								requestId={requestId}
								requestTitle={requestTitle}
								onCancelled={onCancelled}
							/>
						) : null}
					</div>
					{canResubmit ? (
						<div className="flex items-center gap-3">
							{inlineImageBlockingGuidance && (
								<p className="text-sm text-amber-700">
									{inlineImageBlockingGuidance}
								</p>
							)}
							<Button
								onClick={() => void handleSubmit()}
								disabled={
									!title.trim() ||
									!description.trim() ||
									isBusy ||
									inlineImages.hasBlockingOperations
								}
								className="bg-amber-600 hover:bg-amber-700 text-white"
							>
								<RotateCcw className="w-4 h-4 mr-1.5" />
								Resubmit Request
							</Button>
						</div>
					) : null}
					{submitError && (
						<p className="text-sm text-red-600 flex-1 pr-4">{submitError}</p>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
