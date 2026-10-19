'use server'

// Client-callable approval-chain admin actions. Thin wrappers only: the
// test-injectable cores live in '@/lib/approval-routes/chains-admin' (not a
// server-action module). Wrappers never accept or forward a db argument, so
// every call runs the production store factory and its requireChainsAdmin check.

import * as core from '@/lib/approval-routes/chains-admin'

export type {
  ApprovalChainsData,
  ApprovalChainsReadDb,
  ApprovalChainsRouteVersion,
  ApprovalChainsWriteDb,
  ApprovalChainsWriteTx,
  PublishRouteOutcome,
  RouteLimitConflict,
  RouteStepInput,
  SaveRouteInput,
  StrandedAttemptSummary,
  SubmitterTestResult,
  SubmitterTestStep,
} from '@/lib/approval-routes/chains-admin'

export async function publishRoute(input: Parameters<typeof core.publishRoute>[0]) {
  return core.publishRoute(input)
}

export async function deleteRouteException(input: Parameters<typeof core.deleteRouteException>[0]) {
  return core.deleteRouteException(input)
}

export async function getApprovalChainsData() {
  return core.getApprovalChainsData()
}

export async function testWithSubmitter(input: Parameters<typeof core.testWithSubmitter>[0]) {
  return core.testWithSubmitter(input)
}
