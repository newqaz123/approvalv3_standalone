/**
 * Display-only normalization for the shared ApproverModal header badge.
 * Maps raw persisted request statuses to the modal's UI status keys.
 * Display boundary ONLY: never used for authorization, capability, phase,
 * current-instance or persistence decisions.
 */
export type ApproverHeaderStatus =
  | "request"
  | "solution"
  | "solution_rejected"
  | "final_approval"
  | "final_rejected";

const UI_KEYS: ReadonlySet<string> = new Set([
  "request",
  "solution",
  "solution_rejected",
  "final_approval",
  "final_rejected",
]);

// Raw persisted status -> header key, via explicit equality branches (no plain-
// object lookup: inherited prototype keys like 'constructor' must never map).
// Approved 2026-10-11-final-pending-header-fix scope: only the two Final-domain
// raw statuses are mapped; every other raw status falls back to 'request'.
export function resolveApproverHeaderStatus(rawStatus: string): ApproverHeaderStatus {
  if (rawStatus === "FinalApproval") return "final_approval"
  if (rawStatus === "FinalRejected") return "final_rejected"
  if (UI_KEYS.has(rawStatus)) return rawStatus as ApproverHeaderStatus
  return "request"
}
