'use server'

import type { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { ORGANIZATION_POSITION_LEVEL } from '@/lib/organization/types'
import type { OrganizationPositionCode, OrganizationPositionLevel, OrganizationUnitType } from '@/lib/organization/types'
import type {
  ApprovalPhase,
  ApprovalRouteStatus,
  ApprovalRouteStepDefinition,
  ApprovalRouteVersionDefinition,
} from '@/lib/approval-routes/types'
import { ApprovalRouteConfigurationError, validateRouteDefinition } from '@/lib/approval-routes/validation'
import { selectNearestPublishedRoute } from '@/lib/approval-routes/resolver'
import { stepScopeUnitId } from '@/lib/approval-engine/candidate-groups'
import { createApprovalEngineDb } from '@/lib/approval-engine/instances'
import { resolveReportingBranch } from '@/lib/organization/repository'

/**
 * Admin server actions for approval route publication and route preview
 * (Task 6). Every action derives its actor from the existing `requireAdmin`
 * guard, validates the unit type and the position order/ceiling with
 * `validateRouteDefinition` before any write, and treats drafts and
 * published versions as immutable rows: publishing never edits a version,
 * it retires the current published version and inserts a new one inside a
 * single transaction. The Task 2 partial unique index
 * `approval_routes_one_published_scope_phase` rejects a concurrent
 * publisher, and the aborted transaction rolls back so the previous
 * published version survives. Vacant positions are a runtime skip, never a
 * submission blocker, and drafts never affect route resolution.
 */

const APPROVAL_PHASES: readonly ApprovalPhase[] = ['REQUEST', 'SOLUTION', 'FINAL']

/** Valid route scopes: every organization unit type on the position ladder. */
const ROUTE_UNIT_TYPES: readonly OrganizationUnitType[] = ['SECTION', 'DEPARTMENT', 'DIVISION', 'FACTORY']

/** Version id sentinel marking a preview of an unsaved draft definition. */
const DRAFT_PREVIEW_VERSION_ID = 'DRAFT'

export interface SaveApprovalRouteDraftInput {
  scopeUnitId: string
  phase: ApprovalPhase
  maximumPositionLevel: OrganizationPositionLevel
  steps: ApprovalRouteStepDefinition[]
}

export interface PreviewApprovalRouteInput {
  scopeUnitId: string
  phase: ApprovalPhase
  originUserId: string
  draft?: SaveApprovalRouteDraftInput
}

export interface RoutePreview {
  /** Published version id, or `DRAFT` when previewing an unsaved draft. */
  routeVersionId: string
  scopeUnitId: string
  phase: ApprovalPhase
  maximumPositionLevel: OrganizationPositionLevel
  /** True when the origin sits at or above the ceiling: no approval steps. */
  autoApproved: boolean
  steps: Array<{
    order: number
    position: OrganizationPositionCode
    candidateCount: number
    candidates: Array<{ id: string; name: string }>
    skipped: boolean
    skipReason?: 'VACANT_POSITION'
  }>
}

async function requireRouteAdmin(): Promise<string> {
  const adminId = await requireAdmin()
  if (!adminId) {
    throw new Error('Admin authorization is required for approval route actions')
  }
  return adminId
}

async function validateScopeUnit(scopeUnitId: string): Promise<void> {
  if (!scopeUnitId || typeof scopeUnitId !== 'string') {
    throw new ApprovalRouteConfigurationError('Route scope unit is required')
  }
  const unit = await prisma.organization_units.findUnique({
    where: { id: scopeUnitId },
    select: { unitType: true },
  })
  if (!unit || !ROUTE_UNIT_TYPES.includes(unit.unitType)) {
    throw new ApprovalRouteConfigurationError(
      `Route scope unit '${scopeUnitId}' does not exist or is not a valid route scope (SECTION, DEPARTMENT, DIVISION, or FACTORY)`,
    )
  }
}

function validatedPhase(phase: ApprovalPhase): ApprovalPhase {
  if (!APPROVAL_PHASES.includes(phase)) {
    throw new ApprovalRouteConfigurationError(`Route phase '${String(phase)}' is not a valid approval phase`)
  }
  return phase
}

/**
 * Runs the shared route definition validator over the write-shaped input
 * BEFORE any read or write so configuration failures never touch storage.
 */
function validatedDefinition(input: SaveApprovalRouteDraftInput, status: ApprovalRouteStatus): ApprovalRouteVersionDefinition {
  const definition: ApprovalRouteVersionDefinition = {
    id: 'route-definition-input',
    scopeUnitId: input.scopeUnitId,
    phase: validatedPhase(input.phase),
    version: 0,
    maximumPositionLevel: input.maximumPositionLevel,
    status,
    steps: input.steps,
  }
  validateRouteDefinition(definition)
  return definition
}

async function nextVersionNumber(
  tx: Prisma.TransactionClient,
  scopeUnitId: string,
  phase: ApprovalPhase,
): Promise<number> {
  const latest = await tx.approval_route_versions.findFirst({
    where: { scopeUnitId, phase },
    orderBy: { version: 'desc' },
    select: { version: true },
  })
  return (latest?.version ?? 0) + 1
}

async function insertRouteVersion(
  tx: Prisma.TransactionClient,
  input: SaveApprovalRouteDraftInput,
  meta: { status: ApprovalRouteStatus; version: number; adminId: string; publishedAt: Date | null },
): Promise<{ id: string }> {
  const route = await tx.approval_route_versions.create({
    data: {
      scopeUnitId: input.scopeUnitId,
      phase: input.phase,
      version: meta.version,
      maximumPositionLevel: input.maximumPositionLevel,
      status: meta.status,
      createdById: meta.adminId,
      publishedAt: meta.publishedAt,
    },
  })
  // Zero-step routes are valid: an empty route approves every eligible
  // origin above it, so no step rows are written.
  if (input.steps.length > 0) {
    await tx.approval_route_steps.createMany({
      data: input.steps.map((step) => ({
        routeVersionId: route.id,
        stepOrder: step.order,
        positionCode: step.position,
      })),
    })
  }
  return route
}

function definitionFromInput(
  input: SaveApprovalRouteDraftInput,
  row: { id: string },
  meta: { status: ApprovalRouteStatus; version: number },
): ApprovalRouteVersionDefinition {
  return {
    id: row.id,
    scopeUnitId: input.scopeUnitId,
    phase: input.phase,
    version: meta.version,
    maximumPositionLevel: input.maximumPositionLevel,
    status: meta.status,
    steps: input.steps.map((step) => ({ ...step })),
  }
}

/**
 * Saves a new immutable DRAFT version for the scope/phase. Drafts never
 * retire a published version and never affect route resolution.
 */
export async function saveApprovalRouteDraft(input: SaveApprovalRouteDraftInput): Promise<ApprovalRouteVersionDefinition> {
  const adminId = await requireRouteAdmin()
  await validateScopeUnit(input.scopeUnitId)
  validatedDefinition(input, 'DRAFT')

  const created = await prisma.$transaction(async (tx) => {
    const version = await nextVersionNumber(tx, input.scopeUnitId, validatedPhase(input.phase))
    const meta = { status: 'DRAFT' as const, version, adminId, publishedAt: null }
    return { row: await insertRouteVersion(tx, input, meta), meta }
  })
  revalidatePath('/admin/routes')
  return definitionFromInput(input, created.row, created.meta)
}

/**
 * Publishes a new immutable version for the scope/phase in ONE transaction:
 * retire the current published version, then insert the new PUBLISHED
 * version. The partial unique index rejects a concurrent publisher; the
 * failing transaction rolls back and the previous published version is
 * preserved unchanged.
 */
export async function publishApprovalRoute(input: SaveApprovalRouteDraftInput): Promise<ApprovalRouteVersionDefinition> {
  const adminId = await requireRouteAdmin()
  await validateScopeUnit(input.scopeUnitId)
  validatedDefinition(input, 'PUBLISHED')

  const created = await prisma.$transaction(async (tx) => {
    await tx.approval_route_versions.updateMany({
      where: { scopeUnitId: input.scopeUnitId, phase: validatedPhase(input.phase), status: 'PUBLISHED' },
      data: { status: 'RETIRED' },
    })
    const version = await nextVersionNumber(tx, input.scopeUnitId, input.phase)
    const meta = { status: 'PUBLISHED' as const, version, adminId, publishedAt: new Date() }
    return { row: await insertRouteVersion(tx, input, meta), meta }
  })
  revalidatePath('/admin/routes')
  return definitionFromInput(input, created.row, created.meta)
}

interface StoredRouteVersionRow {
  id: string
  scopeUnitId: string
  phase: ApprovalPhase
  version: number
  maximumPositionLevel: number
  status: ApprovalRouteStatus
}

/**
 * Loads route versions with their ordered steps for the given scopes.
 * Mirrors the engine's stored-route mapping; the ceiling and the step
 * definition are re-validated fail-closed by `validateRouteDefinition`.
 */
async function loadRouteVersions(
  scopeUnitIds: readonly string[],
  phase: ApprovalPhase,
): Promise<ApprovalRouteVersionDefinition[]> {
  const ids = [...scopeUnitIds]
  if (ids.length === 0) return []
  const versions = (await prisma.approval_route_versions.findMany({
    where: { scopeUnitId: { in: ids }, phase },
  })) as StoredRouteVersionRow[]
  if (versions.length === 0) return []
  const steps = await prisma.approval_route_steps.findMany({
    where: { routeVersionId: { in: versions.map((version) => version.id) } },
    orderBy: { stepOrder: 'asc' },
  })
  return versions.map((version) => ({
    id: version.id,
    scopeUnitId: version.scopeUnitId,
    phase: version.phase,
    version: version.version,
    maximumPositionLevel: version.maximumPositionLevel as OrganizationPositionLevel,
    status: version.status,
    steps: steps
      .filter((step) => step.routeVersionId === version.id)
      .map((step) => ({ order: step.stepOrder, position: step.positionCode as OrganizationPositionCode })),
  }))
}

async function loadCandidateNames(userIds: readonly string[]): Promise<Array<{ id: string; name: string }>> {
  const ids = [...new Set(userIds)]
  if (ids.length === 0) return []
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  })
  const names = new Map(users.map((user) => [user.id, user.name]))
  return ids.map((id) => ({ id, name: names.get(id) ?? id }))
}

/**
 * Read-only route preview for a selected origin user. It never persists
 * snapshots and never publishes. The origin branch comes from the
 * organization repository, the scope selection is the nearest published
 * route for the phase, and candidate pools use the production engine
 * adapter so preview counts use the exact runtime identity semantics
 * (active primary requiredPosition holders on the group path or the unit
 * ancestor scope). An explicit, validated draft override replaces the
 * stored published route. Origins at or above the ceiling preview as
 * auto-approved with zero steps, matching the engine builder.
 */
export async function previewApprovalRoute(input: PreviewApprovalRouteInput): Promise<RoutePreview> {
  await requireRouteAdmin()
  await validateScopeUnit(input.scopeUnitId)
  const phase = validatedPhase(input.phase)

  const branch = await resolveReportingBranch(input.originUserId, prisma)
  if (!branch) {
    throw new ApprovalRouteConfigurationError(
      'No unambiguous origin reporting branch for the selected origin user',
    )
  }

  let routeVersionId: string
  let scopeUnitId: string
  let maximumPositionLevel: OrganizationPositionLevel
  let steps: ApprovalRouteStepDefinition[]

  if (input.draft) {
    await validateScopeUnit(input.draft.scopeUnitId)
    const draftDefinition = validatedDefinition(input.draft, 'DRAFT')
    routeVersionId = DRAFT_PREVIEW_VERSION_ID
    scopeUnitId = draftDefinition.scopeUnitId
    maximumPositionLevel = draftDefinition.maximumPositionLevel
    steps = draftDefinition.steps.map((step) => ({ ...step }))
  } else {
    const routes = await loadRouteVersions(branch.unitPath, phase)
    const selected = selectNearestPublishedRoute(branch.unitPath, routes, phase)
    validateRouteDefinition(selected)
    routeVersionId = selected.id
    scopeUnitId = selected.scopeUnitId
    maximumPositionLevel = selected.maximumPositionLevel
    steps = selected.steps.map((step) => ({ ...step }))
  }

  const originLevel = ORGANIZATION_POSITION_LEVEL[branch.primaryPosition]
  if (originLevel >= maximumPositionLevel) {
    return { routeVersionId, scopeUnitId, phase, maximumPositionLevel, autoApproved: true, steps: [] }
  }

  // Read-only engine adapter over the client: same candidate pools as the
  // runtime builder, no writes of any kind.
  const engine = createApprovalEngineDb(prisma)
  const previewSteps: RoutePreview['steps'] = []
  for (const step of steps) {
    const level = ORGANIZATION_POSITION_LEVEL[step.position]
    // Positions at or below the initiator never route; identical to the
    // engine builder's exclusion.
    if (level <= originLevel || level > maximumPositionLevel) continue
    const stepScope = stepScopeUnitId(branch, step.position)
    const found = await engine.findCandidates({
      branch,
      requiredPosition: step.position,
      scopeUnitId: stepScope,
    })
    const activeIds = [...new Set(found.filter((candidate) => candidate.isActive).map((candidate) => candidate.id))]
    const candidates = await loadCandidateNames(activeIds)
    previewSteps.push({
      order: step.order,
      position: step.position,
      candidateCount: candidates.length,
      candidates,
      skipped: candidates.length === 0,
      ...(candidates.length === 0 ? { skipReason: 'VACANT_POSITION' as const } : {}),
    })
  }

  return { routeVersionId, scopeUnitId, phase, maximumPositionLevel, autoApproved: false, steps: previewSteps }
}
