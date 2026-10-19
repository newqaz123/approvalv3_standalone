/**
 * Pure (no I/O) contract of the retention admin API routes that the
 * admin HTTP-security harness exercises (test-only).
 *
 * The authorized controls deliberately stop at the routes' validation-error
 * paths (never the destructive success actions). This module pins the EXACT
 * responses those paths produce so the spec cannot drift from the app —
 * the original harness asserted the wrong validation branch for an empty
 * backup list ("Select between 1 and…" instead of the actual "Select at
 * least one request"), deterministically failing the serial suite (Astra
 * finding 2). tests/regression/admin-retention-api-contract.test.ts
 * statically validates these strings against the real route/lib sources.
 */
export const ADMIN_RETENTION_API_EXPECTATIONS = {
  backup: {
    /** POST { requestIds: [] } → 400 with this message (validation error, NOT a zip). */
    emptyRequestIdsMessage: 'Select at least one request',
  },
  hardDelete: {
    /**
     * POST { requestIds: [] } passes the route's Array.isArray check and is
     * rejected by the lib guard in src/lib/retention-hard-delete.ts with this
     * message (no deletion).
     */
    emptyRequestIdsMessage: 'Select at least one archived request',
  },
  /** Both routes answer 401 with exactly this JSON body before validation. */
  unauthorizedBody: { error: 'Unauthorized' } as const,
} as const
