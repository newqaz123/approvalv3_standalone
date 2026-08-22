import { z } from 'zod'

export const CANCELLATION_REASON_MIN_LENGTH = 5
export const CANCELLATION_REASON_MAX_LENGTH = 500

/**
 * Shared cancellation-reason validation used by BOTH the client dialog
 * (cancel-request-dialog) and the authoritative server action
 * (`cancelRequest`), so the two rules cannot drift.
 *
 * Whitespace is not meaningful text: the value is trimmed before the length
 * check, so whitespace-only or padded-short input is rejected on both sides.
 */
export const cancellationReasonSchema = z
  .string()
  .trim()
  .min(
    CANCELLATION_REASON_MIN_LENGTH,
    `Reason must be at least ${CANCELLATION_REASON_MIN_LENGTH} characters`,
  )
  .max(CANCELLATION_REASON_MAX_LENGTH, 'Reason too long')
