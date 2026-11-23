"use client";

import type { MessageKey } from '@/lib/i18n/messages'
import { useTranslations } from '@/lib/i18n/client'
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { SubmitterModal } from "./submitter-modal";
import { ApproverModal } from "./approver-modal";
import { CompletedRequestModal } from "./completed-request-modal";
import { CompletedSolutionModal } from "./completed-solution-modal";
import { SolutionModal } from "./solution-modal";
import { CompletedFinalModal } from "./completed-final-modal";
import { RequestResubmitModal } from "./request-resubmit-modal";
import { FinalApprovalResubmitModal } from "./final-approval-resubmit-modal";
import { SubmitFinalApprovalModal } from "./submit-final-approval-modal";
import { getRequest, resubmitRequest } from "@/server-actions/requests";
import { getRequestActionCapabilities } from "@/server-actions/request-action-capabilities";
import { getEngineeringSubTaskOptions } from "@/server-actions/engineering-sub-tasks";
import {
	canUserApprove,
	approveRequest,
	rejectRequest,
} from "@/server-actions/approvals";
import {
	approveSolution,
	rejectSolution,
	submitSolution,
	resubmitSolution,
	initiateFinalApproval,
} from "@/server-actions/solutions";
import { transformRequestToModalData } from "@/lib/modal-data-adapters";
import { isSubTaskVisibleForRequestStatus } from "@/lib/engineering-sub-tasks";
import {
	getModalTypeForStatus,
} from "@/lib/permission-checks";
import { isCurrentInstanceApproval } from "@/lib/approval-engine/current-instance";
import {
	shouldShowActionButton,
	type ActionDecision,
	type RequestAction,
} from "@/lib/action-permissions";
import {
	evaluateRequesterCancelControl,
} from "@/lib/cancellation-policy";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FilePreviewDialog } from "@/components/requests/file-preview-dialog";
import { getFileDownloadUrl, getFilePreviewUrl } from "@/lib/file-preview";
import type { ExportPackageRequestItem } from "@/lib/export-package";
import { SubTasksSection } from "./sub-tasks-section";
import { RequestDetailSkeleton } from "@/components/loading/request-detail-skeleton";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

interface RequestModalRouterProps {
	requestId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onActionComplete?: () => void;
	onLoadStateChange?: (loading: boolean) => void;
	onLoadError?: (errorKey: MessageKey) => void;
	viewOnly?: boolean;
}

function downloadFailureKey(status: number): MessageKey {
	switch (status) {
		case 401: return 'requests.error.downloadSignIn';
		case 403: return 'requests.error.downloadForbidden';
		case 404: return 'requests.error.fileUnavailable';
		default: return 'requests.error.download';
	}
}

/**
 * Smart modal router that displays the appropriate modal variant
 * based on request status, user permissions, and current state
 */
export function RequestModalRouter(props: RequestModalRouterProps) {
	return <RequestModalRouterContent key={props.requestId} {...props} />;
}

function RequestModalRouterContent({
	requestId,
	open,
	onOpenChange,
	onActionComplete,
	onLoadStateChange,
	onLoadError,
	viewOnly = false,
}: RequestModalRouterProps) {
	const t = useTranslations();
	const { data: session } = useSession();
	const user = session?.user;
	const router = useRouter();
	const [loading, setLoading] = useState(true);
	const [requestData, setRequestData] = useState<any>(null);
	const [canApprove, setCanApprove] = useState(false);
	const [actionCapabilities, setActionCapabilities] = useState<Record<
		RequestAction,
		ActionDecision
	> | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [showSolutionModal, setShowSolutionModal] = useState(false);
	const [showResubmitSolutionModal, setShowResubmitSolutionModal] =
		useState(false);
	const [showSubmitFinalApprovalModal, setShowSubmitFinalApprovalModal] =
		useState(false);
	const [previewFile, setPreviewFile] = useState<any>(null);
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const [previewOpen, setPreviewOpen] = useState(false);
	const [subTaskOptions, setSubTaskOptions] = useState<{
		stages: Array<{ id: string; name: string; isOthers: boolean }>;
		subcontractors: Array<{ id: string; name: string }>;
	} | null>(null);

	const [availableUsers, setAvailableUsers] = useState<
		Array<{
			id: string;
			name: string;
			email: string;
			role: string;
			unitPathNames: string[];
		}>
	>([]);

	useEffect(() => {
		if (open && requestId) {
			loadRequestData();
		}
	}, [open, requestId]);

	const loadRequestData = async () => {
		setLoading(true);
		onLoadStateChange?.(true);
		try {
			// Fetch request with all related data
			const request = await getRequest(requestId);

			if (!request) {
				onLoadError?.('requests.error.notFoundOrNoAccess');
				if (!onLoadError) toast.error(t('requests.error.notFoundOrNoAccess'));
				setActionCapabilities(null);
				setLoading(false);
				onLoadStateChange?.(false);
				return;
			}

			if (isSubTaskVisibleForRequestStatus(request.status)) {
				setSubTaskOptions(await getEngineeringSubTaskOptions());
			} else {
				setSubTaskOptions(null);
			}

			// Check if user can approve - use appropriate check based on status
			let approvalCheck = { canApprove: false };

			if (
				request.solutions?.[0] &&
				request.status === "DesignCostEstimationApproval"
			) {
				// Check solution approval permissions
				const { canUserApproveSolution } = await import(
					"@/server-actions/solutions"
				);
				approvalCheck = await canUserApproveSolution(request.solutions[0].id);
			} else if (request.status === "FinalApproval") {
				// Check final approval permissions
				const { canUserApproveFinalApproval } = await import(
					"@/server-actions/solutions"
				);
				approvalCheck = await canUserApproveFinalApproval(requestId);
			} else {
				// Check request approval permissions
				approvalCheck = await canUserApprove(requestId);
			}

			setCanApprove(approvalCheck.canApprove);
			setActionCapabilities(await getRequestActionCapabilities(requestId));

			// Fetch available users for custom approval hierarchy
			const usersResponse = await fetch("/api/users?active=true");
			if (usersResponse.ok) {
				const usersData = await usersResponse.json();
				// Filter out current user and transform null to undefined
				const filteredUsers = usersData
					.filter((u: any) => u.id !== user?.id)
					.map((u: any) => ({
						...u,
						unitPathNames: Array.isArray(u.unitPathNames) ? u.unitPathNames : [],
					}));
				setAvailableUsers(filteredUsers);
			}

			setRequestData(request);
		} catch (error) {
			console.error("Failed to load request data:", error);
			onLoadError?.('requests.error.openRequest');
			if (!onLoadError) toast.error(t('requests.error.openRequest'));
		} finally {
			setLoading(false);
			onLoadStateChange?.(false);
		}
	};

	if (loading && !requestData) {
		return (
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent className="max-w-5xl w-full max-h-[90vh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>{t('requests.loadingRequest')}</DialogTitle>
						<DialogDescription className="sr-only">
							{t('requests.loadingRequestDescription')}
						</DialogDescription>
					</DialogHeader>
					<RequestDetailSkeleton />
				</DialogContent>
			</Dialog>
		);
	}
	if (!requestData) {
		return null;
	}

	// Transform data for modals
	const modalData = transformRequestToModalData(requestData, t);

	// Determine permissions. Action buttons come from session-derived
	// capabilities; canView/engineering/admin read is never a substitute.
	const canAct = (action: RequestAction) =>
		Boolean(
			actionCapabilities &&
				shouldShowActionButton(action, actionCapabilities[action]),
		);
	const approveAction: RequestAction =
		requestData.status === "FinalApproval"
			? "APPROVE_FINAL"
			: requestData.status === "DesignCostEstimationApproval"
				? "APPROVE_SOLUTION"
				: "APPROVE_REQUEST";
	const rejectAction: RequestAction =
		requestData.status === "FinalApproval"
			? "REJECT_FINAL"
			: requestData.status === "DesignCostEstimationApproval"
				? "REJECT_SOLUTION"
				: "REJECT_REQUEST";

	// Check for rejections - only consider rejections relevant to current workflow stage
	const hasRequestRejection =
		(requestData.status === "ImprovementRequest" ||
			requestData.status === "RequestRejected") &&
		requestData.approvals?.some(
			(a: any) =>
				a.status === "rejected" &&
				!a.isFinalApproval &&
				isCurrentInstanceApproval(a),
		);

	const hasSolutionRejection =
		(requestData.status === "SentToEngineer" ||
			requestData.status === "DesignCostEstimationApproval") &&
		requestData.solutions?.[0]?.approvals?.some(
			(a: any) => a.status === "rejected" && isCurrentInstanceApproval(a),
		);

	const hasFinalRejection =
		(requestData.status === "FinalApproval" ||
			requestData.status === "FinalRejected") &&
		requestData.approvals?.some(
			(a: any) =>
				a.status === "rejected" &&
				a.isFinalApproval &&
				isCurrentInstanceApproval(a),
		);

	// Special case: Final approval rejection that sent request back to engineering
	const hasFinalRejectionInEngineering =
		requestData.status === "SentToEngineer" &&
		requestData.approvals?.some(
			(a: any) =>
				a.status === "rejected" &&
				a.isFinalApproval &&
				isCurrentInstanceApproval(a),
		);

	const hasRejection =
		hasRequestRejection ||
		hasSolutionRejection ||
		hasFinalRejection ||
		hasFinalRejectionInEngineering;

	// Check if current user can cancel (requester only, while the request is
	// in SentToEngineer, SendBackToRequester, or a rejected ImprovementRequest
	// with no request/final or solution approval still pending; authoritative
	// re-checks run in cancelRequest). Cancellation visibility follows the policy
	// alone - viewOnly (read-only views such as the follow-up dashboard for
	// SentToEngineer requests) only suppresses other workflow actions, never
	// the requester's cancel control. Pending solution approvals come from
	// the server-computed all-solutions aggregate on the getRequest payload.
	const canCancel =
		canAct("CANCEL_REQUEST") &&
		evaluateRequesterCancelControl({
			userId: user?.id,
			request: requestData,
			viewOnly,
		}).canCancel;
	const allowActions = !viewOnly;

	const canManageSubTasks = canAct("MANAGE_SUB_TASKS");
	const subTasksElement =
		isSubTaskVisibleForRequestStatus(requestData.status) && subTaskOptions ? (
			<SubTasksSection
				key={`${requestData.id}-${open ? "open" : "closed"}`}
				requestId={requestData.id}
				subTasks={requestData.subTasks ?? []}
				workRequisitionReceived={requestData.workRequisitionReceived}
				stages={subTaskOptions.stages}
				subcontractors={subTaskOptions.subcontractors}
				canManage={canManageSubTasks}
				onChanged={async () => {
					await loadRequestData();
					window.dispatchEvent(new Event("approvalapp:request-data-changed"));
				}}
			/>
		) : undefined;

	// Determine modal type
	const modalConfig = getModalTypeForStatus(
		requestData.status,
		hasRejection,
		!!requestData.solutions?.[0],
		requestData.approvals?.some((a: any) => a.isFinalApproval),
		allowActions && canAct(approveAction),
		allowActions && canAct("INITIATE_FINAL_APPROVAL"),
		allowActions && canAct("SUBMIT_SOLUTION"),
	);

	// Common handlers
	const handleClose = () => {
		onOpenChange(false);
		window.dispatchEvent(new Event("approvalapp:request-data-changed"));
		onActionComplete?.();
	};

	const handleDownloadFile = async (fileId: string) => {
		try {
			const file = requestData.fileAttachments?.find(
				(f: any) => f.id === fileId,
			);

			if (!file) {
				toast.error(t('requests.error.fileNotFound'));
				return;
			}

			const downloadUrl = getFileDownloadUrl(file.id);
			if (!downloadUrl) {
				toast.error(t('requests.error.fileUnavailable'));
				return;
			}

			const res = await fetch(downloadUrl);

			if (!res.ok) {
				toast.error(t(downloadFailureKey(res.status)));
				return;
			}

			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = file.fileName;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		} catch (error) {
			console.error("Download error:", error);
			toast.error(t('requests.error.download'));
		}
	};

	const handleDownloadSolutionFile = async (fileId: string) => {
		try {
			const file = requestData.solutions?.[0]?.fileAttachments?.find(
				(f: any) => f.id === fileId,
			);

			if (!file) {
				toast.error(t('requests.error.fileNotFound'));
				return;
			}

			const downloadUrl = getFileDownloadUrl(file.id);
			if (!downloadUrl) {
				toast.error(t('requests.error.fileUnavailable'));
				return;
			}

			const res = await fetch(downloadUrl);

			if (!res.ok) {
				toast.error(t(downloadFailureKey(res.status)));
				return;
			}

			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = file.fileName;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		} catch (error) {
			console.error("Download error:", error);
			toast.error(t('requests.error.download'));
		}
	};

	const handlePreviewFile = (fileId: string) => {
		const file = requestData.fileAttachments?.find((f: any) => f.id === fileId);

		if (!file) {
			toast.error(t('requests.error.fileNotFound'));
			return;
		}

		setPreviewFile(file);
		setPreviewUrl(getFilePreviewUrl(file.id));
		setPreviewOpen(true);
	};

	const handlePreviewSolutionFile = (fileId: string) => {
		const file = requestData.solutions?.[0]?.fileAttachments?.find(
			(f: any) => f.id === fileId,
		);

		if (!file) {
			toast.error(t('requests.error.fileNotFound'));
			return;
		}

		setPreviewFile(file);
		setPreviewUrl(getFilePreviewUrl(file.id));
		setPreviewOpen(true);
	};

	const downloadBase64File = (
		data: string,
		contentType: string,
		filename: string,
	) => {
		const byteCharacters = atob(data);
		const byteNumbers = new Array(byteCharacters.length);
		for (let i = 0; i < byteCharacters.length; i++) {
			byteNumbers[i] = byteCharacters.charCodeAt(i);
		}
		const byteArray = new Uint8Array(byteNumbers);
		const blob = new Blob([byteArray], { type: contentType });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	};

	const handleExportReport = async () => {
		try {
			const { exportRequestAsPDF } = await import("@/server-actions/reports");
			const result = await exportRequestAsPDF(requestId);

			if (!result.success || !result.data) {
				toast.error(t('requests.error.generatePdf'));
				return;
			}

			downloadBase64File(
				result.data,
				result.contentType || "application/pdf",
				result.filename || `request-${requestId}.pdf`,
			);
			toast.success(t('requests.pdfExported'));
		} catch (error) {
			console.error("PDF export error:", error);
			toast.error(t('requests.error.exportPdf'));
		}
	};

	const handleExportPackage = async (items: ExportPackageRequestItem[]) => {
		const { exportRequestPackageAsPDF } = await import(
			"@/server-actions/reports"
		);
		const result = await exportRequestPackageAsPDF(requestId, items);

		if (!result.success || !result.data) {
			throw new Error(t('requests.error.exportPackage'));
		}

		downloadBase64File(
			result.data,
			result.contentType || "application/pdf",
			result.filename || `approval-package-${requestId}.pdf`,
		);
		toast.success(t('requests.packetExported'));
	};

	const handleApprove = async (comment: string) => {
		if (isSubmitting) return;
		setIsSubmitting(true);

		try {
			// Determine which approval action to call based on status
			const hasSolution = !!requestData.solutions?.[0];

			let result;
			if (requestData.status === "FinalApproval") {
				// Final approval
				const { approveFinalApproval } = await import(
					"@/server-actions/solutions"
				);
				result = await approveFinalApproval(requestId, comment);
			} else if (
				hasSolution &&
				requestData.status === "DesignCostEstimationApproval"
			) {
				// Solution approval
				const solutionId = requestData.solutions[0].id;
				result = await approveSolution(solutionId, comment);
			} else {
				// Request approval
				result = await approveRequest(requestId, comment);
			}

			if (result.success) {
				toast.success(t('requests.approved'));
				handleClose();
				router.refresh();
			} else {
				toast.error(t(result.errorKey ?? 'requests.error.approve'));
			}
		} catch (error) {
			console.error("Approval error:", error);
			toast.error(t('requests.error.approveUnexpected'));
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleReject = async (reason: string) => {
		if (isSubmitting) return;
		setIsSubmitting(true);

		try {
			// Determine which rejection action to call based on status
			const hasSolution = !!requestData.solutions?.[0];

			let result;
			if (requestData.status === "FinalApproval") {
				// Final approval rejection
				const { rejectFinalApproval } = await import(
					"@/server-actions/solutions"
				);
				result = await rejectFinalApproval(requestId, reason);
			} else if (
				hasSolution &&
				requestData.status === "DesignCostEstimationApproval"
			) {
				// Solution rejection
				const solutionId = requestData.solutions[0].id;
				result = await rejectSolution(solutionId, reason);
			} else {
				// Request rejection
				result = await rejectRequest(requestId, reason);
			}

			if (result.success) {
				toast.success(t('requests.rejected'));
				handleClose();
				router.refresh();
			} else {
				toast.error(t(result.errorKey ?? 'requests.error.reject'));
			}
		} catch (error) {
			console.error("Rejection error:", error);
			toast.error(t('requests.error.rejectUnexpected'));
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleSubmitFinalApproval = async (data: {
		useCustomChain: boolean;
		customApproverIds?: string[];
	}) => {
		if (isSubmitting) return;
		setIsSubmitting(true);

		try {
			const result = await initiateFinalApproval(
				requestId,
				data.useCustomChain,
				data.customApproverIds,
			);

			if (result.success) {
				toast.success(t('requests.finalStarted'));
				handleClose();
				router.refresh();
			} else {
				toast.error(t('requests.error.startFinal'));
			}
		} catch (error) {
			console.error("Final approval error:", error);
			toast.error(t('requests.error.startFinalUnexpected'));
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleResubmitRequest = async (data: {
		title: string;
		description: string;
		inlineImageSessionId: string;
	}): Promise<{ success: boolean; error?: string }> => {
		if (isSubmitting) return { success: false, error: t('requests.error.submissionBusy') };
		setIsSubmitting(true);

		try {
			const result = await resubmitRequest({
				requestId,
				title: data.title,
				description: data.description,
				inlineImageSessionId: data.inlineImageSessionId,
			});

			if (result.success) {
				toast.success(t('requests.requestResubmitted'));
				handleClose();
				router.refresh();
				return { success: true };
			}
			toast.error(t('requests.error.resubmitRequest'));
			return { success: false, error: t('requests.error.resubmitRequest') };
		} catch (error) {
			console.error("Resubmit request error:", error);
			toast.error(t('requests.error.resubmitRequestUnexpected'));
			return {
				success: false,
				error: t('requests.error.resubmitRequest'),
			};
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleRestartFinalApproval = async (data: {
		useCustomChain: boolean;
		customApproverIds?: string[];
	}) => {
		if (isSubmitting) return;
		setIsSubmitting(true);

		try {
			// Restart final approval is the same as initiating it again
			const result = await initiateFinalApproval(
				requestId,
				data.useCustomChain,
				data.customApproverIds,
			);

			if (result.success) {
				toast.success(t('requests.finalRestarted'));
				handleClose();
				router.refresh();
			} else {
				toast.error(t('requests.error.restartFinal'));
			}
		} catch (error) {
			console.error("Restart final approval error:", error);
			toast.error(t('requests.error.restartFinalUnexpected'));
		} finally {
			setIsSubmitting(false);
		}
	};

	// Render appropriate modal based on config
	let modalContent: React.ReactNode = null;

	switch (modalConfig.modalType) {
		case "approver":
			modalContent = (
				<ApproverModal
					mode={modalConfig.mode as "request" | "solution" | "final"}
					open={open}
					onOpenChange={onOpenChange}
					data={{
						...modalData,
						status: requestData.status,
					}}
					canApprove={allowActions && canAct(approveAction)}
					isSubmitting={isSubmitting}
					onApprove={allowActions && canAct(approveAction) ? handleApprove : undefined}
					onReject={allowActions && canAct(rejectAction) ? handleReject : undefined}
					onPreviewFile={handlePreviewFile}
					onPreviewSolutionFile={handlePreviewSolutionFile}
					onDownloadRequestFile={handleDownloadFile}
					onDownloadSolutionFile={handleDownloadSolutionFile}
					showCancel={canCancel}
					requestId={requestData.id}
					requestTitle={requestData.title}
					onCancelled={handleClose}
					subTasksElement={subTasksElement}
				/>
			);
			break;

		case "solution":
			if (!modalData.solution) return null;
			modalContent = (
				<SolutionModal
					open={open && !showResubmitSolutionModal}
					onOpenChange={onOpenChange}
					isSubmitting={isSubmitting}
					data={{
						...modalData,
						status:
							(hasSolutionRejection ||
								hasFinalRejection ||
								hasFinalRejectionInEngineering) &&
							!canApprove
								? hasSolutionRejection ? "solution_rejected" : "final_rejected"
								: "solution",
						solution: {
							...modalData.solution,
							files: modalData.solution?.files || [],
						},
						rejection:
							hasSolutionRejection ||
							hasFinalRejection ||
							hasFinalRejectionInEngineering
								? {
										reason: modalData.rejection?.reason || "",
										rejectedBy: modalData.rejection?.rejectedBy || "",
										rejectedAt: modalData.rejection?.rejectedAt || "",
									}
								: undefined,
					}}
					onApprove={
						allowActions && canAct(approveAction) ? () => handleApprove("") : undefined
					}
					onReject={
						allowActions && canAct(rejectAction)
							? (reason: string) => handleReject(reason)
							: undefined
					}
					onResubmit={
						allowActions && canAct("RESUBMIT_SOLUTION")
							? () => {
									setShowResubmitSolutionModal(true);
								}
							: undefined
					}
					showCancel={canCancel}
					onCancelled={handleClose}
					onDownloadFile={handleDownloadFile}
					onDownloadSolutionFile={handleDownloadSolutionFile}
					onPreviewFile={handlePreviewFile}
					onPreviewSolutionFile={handlePreviewSolutionFile}
					subTasksElement={subTasksElement}
				/>
			);
			break;

		case "resubmit-solution":
			if (!modalData.solution) return null;
			modalContent = (
				<SubmitterModal
					mode="resubmit"
					open={open}
					onOpenChange={onOpenChange}
					initialData={{
						solution: modalData.solution,
						existingFiles: modalData.solution?.files,
						rejectionReason: modalData.rejection?.reason,
						rejectedBy: modalData.rejection?.rejectedBy,
						rejectedAt: modalData.rejection?.rejectedAt,
						requestId: requestData?.id,
						requestTitle: requestData?.title,
						requestDescription: requestData?.description,
					}}
					availableUsers={availableUsers}
					onResubmit={async (data) => {
						setIsSubmitting(true);
						try {
							const result = await resubmitSolution({
								requestId: requestData.id,
								title: data.title || modalData.solution?.title || "",
								description: data.description,
								inlineImageSessionId: data.inlineImageSessionId,
								cost: data.cost,
								currency: (data.currency as "THB" | "USD" | "EUR") || "THB",
								timeline: data.timeline,
								newFileIds: data.fileIds,
								deletedFileIds: data.deletedFileIds,
								useCustomHierarchy: data.useCustomHierarchy || false,
								customApprovers: data.customApprovers || [],
							});

							if (result.success) {
								toast.success(t('requests.solutionResubmitted'));
								onOpenChange(false);
								window.dispatchEvent(
									new Event("approvalapp:request-data-changed"),
								);
								onActionComplete?.();
								router.refresh();
								return { success: true };
							}
							return { success: false, error: t('requests.error.resubmitSolution') };
						} catch (error) {
							return {
								success: false,
								error: t('requests.error.resubmitSolution'),
							};
						} finally {
							setIsSubmitting(false);
						}
					}}
				/>
			);
			break;

		case "completed-request":
			modalContent = (
				<CompletedRequestModal
					open={open}
					onOpenChange={onOpenChange}
					data={{
						...modalData,
						status: "completed_request",
						sentToEngineerAt: requestData.updatedAt.toISOString(),
						engineerAssigned: t('requests.engineeringTeam'),
					}}
					onSubmitSolution={
						allowActions && canAct("SUBMIT_SOLUTION")
							? () => setShowSolutionModal(true)
							: undefined
					}
					showCancel={canCancel}
					onCancelled={handleClose}
					onDownloadFile={handleDownloadFile}
					onPreviewFile={handlePreviewFile}
					subTasksElement={subTasksElement}
				/>
			);
			break;

		case "completed-solution":
			if (!modalData.solution) return null;
			modalContent = (
				<CompletedSolutionModal
					open={open}
					onOpenChange={onOpenChange}
					data={{
						...modalData,
						solution: modalData.solution,
						status: "completed_solution",
						sentToRequesterAt: requestData.updatedAt.toISOString(),
						requesterName: requestData.requester.name,
					}}
					isRequesterDepartment={canAct("INITIATE_FINAL_APPROVAL")}
					onSubmitFinalApproval={
						allowActions && canAct("INITIATE_FINAL_APPROVAL")
							? () => setShowSubmitFinalApprovalModal(true)
							: undefined
					}
					showCancel={canCancel}
					onCancelled={handleClose}
					onDownloadRequestFile={handleDownloadFile}
					onDownloadSolutionFile={handleDownloadSolutionFile}
					onPreviewFile={handlePreviewFile}
					onPreviewSolutionFile={handlePreviewSolutionFile}
					subTasksElement={subTasksElement}
				/>
			);
			break;

		case "completed-final":
			if (!modalData.solution) return null;
			modalContent = (
				<CompletedFinalModal
					open={open}
					onOpenChange={onOpenChange}
					data={{
						...modalData,
						solution: modalData.solution,
						status: "completed",
						completedAt: requestData.updatedAt.toISOString(),
						finalApprovers: requestData.approvals
							?.filter((a: any) => a.isFinalApproval && a.status === "approved")
							.map((a: any) => a.approver?.name || "Unknown"),
					}}
					onDownloadRequestFile={handleDownloadFile}
					onDownloadSolutionFile={handleDownloadSolutionFile}
					onPreviewFile={handlePreviewFile}
					onPreviewSolutionFile={handlePreviewSolutionFile}
					onExport={canAct("EXPORT_PDF") ? handleExportReport : undefined}
					onExportPackage={handleExportPackage}
					subTasksElement={subTasksElement}
				/>
			);
			break;

		case "resubmit-request":
			modalContent = (
				<RequestResubmitModal
					open={open}
					onOpenChange={onOpenChange}
					initialData={{
						title: requestData.title,
						description: requestData.description,
						rejectionReason: modalData.rejection?.reason || "",
						rejectedBy: modalData.rejection?.rejectedBy || "",
						rejectedAt: modalData.rejection?.rejectedAt || "",
						files: modalData.requestFiles,
					}}
					onResubmit={
						allowActions && canAct("RESUBMIT_REQUEST")
							? handleResubmitRequest
							: undefined
					}
					showCancel={canCancel}
					requestId={requestData.id}
					requestTitle={requestData.title}
					onCancelled={handleClose}
				/>
			);
			break;

		case "resubmit-final":
			if (!modalData.solution) return null;
			modalContent = (
				<FinalApprovalResubmitModal
					open={open}
					onOpenChange={onOpenChange}
					data={{
						...modalData,
						solution: modalData.solution,
						rejection: {
							reason: modalData.rejection?.reason || "",
							rejectedBy: modalData.rejection?.rejectedBy || "",
							rejectedAt: modalData.rejection?.rejectedAt || "",
							rejectedAtLevel: 1, // TODO: Calculate from approvals
						},
					}}
					availableUsers={[]} // TODO: Fetch available users
					isSubmitting={isSubmitting}
					onRestart={(data) =>
						handleRestartFinalApproval({
							useCustomChain: data.useCustomHierarchy,
							customApproverIds: data.customApprovers,
						})
					}
					subTasksElement={subTasksElement}
				/>
			);
			break;

		case "submit-final":
			if (!modalData.solution) return null;
			modalContent = (
				<SubmitFinalApprovalModal
					open={open}
					onOpenChange={onOpenChange}
					data={{
						...modalData,
						solution: modalData.solution,
					}}
					availableUsers={[]} // TODO: Fetch available users
					isSubmitting={isSubmitting}
					onSubmit={(data) =>
						handleSubmitFinalApproval({
							useCustomChain: data.useCustomHierarchy,
							customApproverIds: data.customApprovers,
						})
					}
					onDownloadRequestFile={handleDownloadFile}
					onDownloadSolutionFile={handleDownloadSolutionFile}
					onPreviewFile={handlePreviewFile}
					onPreviewSolutionFile={handlePreviewSolutionFile}
					subTasksElement={subTasksElement}
				/>
			);
			break;

		default:
			return null;
	}

	// Solution submission modal
	return (
		<>
			{modalContent}
			<SubmitterModal
				mode="solution"
				open={showSolutionModal}
				onOpenChange={setShowSolutionModal}
				initialData={{
					requestId: requestData?.id,
					requestTitle: requestData?.title,
					requestDescription: requestData?.description,
				}}
				availableUsers={availableUsers}
				onSubmitSolution={async (data) => {
					setIsSubmitting(true);
					try {
						const result = await submitSolution({
							requestId: requestData.id,
							title: data.title,
							description: data.description,
							inlineImageSessionId: data.inlineImageSessionId,
							costEstimate: data.cost,
							currency: data.currency as "THB" | "USD" | "EUR",
							timeline: data.timeline,
							fileIds: data.fileIds,
							useCustomApprovals: data.useCustomHierarchy,
							customApproverIds: data.customApprovers,
						});

						if (result.success) {
							toast.success(t('requests.solutionSubmitted'));
							onOpenChange(false);
							window.dispatchEvent(
								new Event("approvalapp:request-data-changed"),
							);
							onActionComplete?.();
							router.refresh();
							return { success: true };
						}
						return { success: false, error: t('requests.error.submitSolution') };
					} catch (error) {
						return {
							success: false,
							error: t('requests.error.submitSolution'),
						};
					} finally {
						setIsSubmitting(false);
					}
				}}
			/>
			{modalData.solution && (
				<SubmitterModal
					mode="resubmit"
					open={showResubmitSolutionModal}
					onOpenChange={setShowResubmitSolutionModal}
					initialData={{
						solution: modalData.solution,
						existingFiles: modalData.solution?.files,
						rejectionReason: modalData.rejection?.reason,
						rejectedBy: modalData.rejection?.rejectedBy,
						rejectedAt: modalData.rejection?.rejectedAt,
						requestId: requestData?.id,
						requestTitle: requestData?.title,
						requestDescription: requestData?.description,
					}}
					availableUsers={availableUsers}
					onResubmit={async (data) => {
						setIsSubmitting(true);
						try {
							const result = await resubmitSolution({
								requestId: requestData.id,
								title: data.title || modalData.solution?.title || "",
								description: data.description,
								inlineImageSessionId: data.inlineImageSessionId,
								cost: data.cost,
								currency: (data.currency as "THB" | "USD" | "EUR") || "THB",
								timeline: data.timeline,
								newFileIds: data.fileIds,
								deletedFileIds: data.deletedFileIds,
								useCustomHierarchy: data.useCustomHierarchy || false,
								customApprovers: data.customApprovers || [],
							});

							if (result.success) {
								toast.success(t('requests.solutionResubmitted'));
								onOpenChange(false);
								window.dispatchEvent(
									new Event("approvalapp:request-data-changed"),
								);
								onActionComplete?.();
								router.refresh();
								return { success: true };
							}
							return { success: false, error: t('requests.error.resubmitSolution') };
						} catch (error) {
							return {
								success: false,
								error: t('requests.error.resubmitSolution'),
							};
						} finally {
							setIsSubmitting(false);
						}
					}}
				/>
			)}
			{modalData.solution && (
				<SubmitFinalApprovalModal
					open={showSubmitFinalApprovalModal}
					onOpenChange={setShowSubmitFinalApprovalModal}
					data={{
						...modalData,
						solution: modalData.solution,
					}}
					availableUsers={availableUsers}
					isSubmitting={isSubmitting}
					onSubmit={async (data) => {
						if (isSubmitting) return;
						setIsSubmitting(true);
						try {
							const result = await initiateFinalApproval(
								requestId,
								data.useCustomHierarchy,
								data.customApprovers,
							);

							if (result.success) {
								toast.success(t('requests.finalStarted'));
								setShowSubmitFinalApprovalModal(false);
								onOpenChange(false);
								window.dispatchEvent(
									new Event("approvalapp:request-data-changed"),
								);
								onActionComplete?.();
								router.refresh();
							} else {
								toast.error(t('requests.error.startFinal'));
							}
						} catch (error) {
							console.error("Final approval error:", error);
							toast.error(t('requests.error.startFinalUnexpected'));
						} finally {
							setIsSubmitting(false);
						}
					}}
					onDownloadRequestFile={handleDownloadFile}
					onDownloadSolutionFile={handleDownloadSolutionFile}
					onPreviewFile={handlePreviewFile}
					onPreviewSolutionFile={handlePreviewSolutionFile}
					subTasksElement={subTasksElement}
				/>
			)}
			<FilePreviewDialog
				file={previewFile}
				url={previewUrl}
				open={previewOpen}
				onOpenChange={setPreviewOpen}
				onDownload={(file) => handleDownloadFile(file.id)}
			/>
		</>
	);
}
