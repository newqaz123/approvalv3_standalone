import type { AttachmentUploadItem } from "./upload-batch";

/**
 * Progress snapshot for the request-mode submit flow. The caller owns the
 * create→upload→finalize sequence (uploads need the requestId returned by
 * createRequest), so the modal learns about phases through this shape.
 */
export interface RequestUploadProgress {
	phase: "creating" | "uploading" | "finalizing";
	/** Files finished (uploaded, whether the server accepted them or not). */
	uploaded: number;
	/** Total files planned for upload. */
	total: number;
	/** File currently uploading. */
	fileName?: string;
	/**
	 * Indices of files whose upload failed. The count in `uploaded` includes
	 * them (the loop continues past failures), so consumers must render these
	 * as errors, never as successes.
	 */
	failedIndices?: number[];
}

export interface UploadProgressSummary {
	/** True when at least one item is currently uploading. */
	active: boolean;
	/** Items in a terminal state (success or error). */
	doneCount: number;
	/** All items in the batch. */
	totalCount: number;
	/** File name of the first uploading item, if any. */
	currentName?: string;
	/**
	 * Honest count-based label, e.g. "Uploading 2/3 — invoice.pdf".
	 * Null when nothing is uploading.
	 */
	label: string | null;
}

/**
 * Derive a count-based progress summary from batch item statuses. The upload
 * coordinator has no byte-level progress events, so we never render a fake
 * percentage — only how many files are done and which file is in flight.
 */
export function describeUploadProgress(
	items: AttachmentUploadItem[],
): UploadProgressSummary {
	const total = items.length;
	const uploading = items.find((entry) => entry.status === "uploading");
	const done = items.filter(
		(entry) => entry.status === "success" || entry.status === "error",
	).length;

	if (!uploading) {
		return {
			active: false,
			doneCount: done,
			totalCount: total,
			label: null,
		};
	}

	const currentName = uploading.file.name;
	const currentIndex = items.indexOf(uploading) + 1;

	return {
		active: true,
		doneCount: done,
		totalCount: total,
		currentName,
		label: `Uploading ${currentIndex}/${total} — ${currentName}`,
	};
}

/**
 * Human label for the request-mode submit phases. Mirrors the count-based
 * honesty of describeUploadProgress.
 */
export function requestPhaseLabel(
	progress: RequestUploadProgress | null,
): string | null {
	if (!progress) return null;

	switch (progress.phase) {
		case "creating":
			return "Creating request...";
		case "uploading":
			if (progress.total === 0) return "Uploading files...";
			return `Uploading ${Math.min(progress.uploaded + 1, progress.total)}/${progress.total}${
				progress.fileName ? ` — ${progress.fileName}` : ""
			}`;
		case "finalizing":
			return "Finalizing...";
	}
}
