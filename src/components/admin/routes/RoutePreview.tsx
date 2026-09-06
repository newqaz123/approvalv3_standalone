'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { OrganizationPositionLevel } from '@/lib/organization/types'
import type { ApprovalPhase, ApprovalRouteStepDefinition } from '@/lib/approval-routes/types'
import type { RoutePreview as RoutePreviewResult } from '@/server-actions/approval-routes'
import { previewApprovalRoute } from '@/server-actions/approval-routes'
import { ROUTE_POSITION_LABELS } from './RouteStepList'
import type { AdminRouteUnit, AdminRouteUser } from './RouteEditor'

const DRAFT_PREVIEW_VERSION_ID = 'DRAFT'

interface RoutePreviewProps {
  units: AdminRouteUnit[]
  users: AdminRouteUser[]
  scopeUnitId: string
  phase: ApprovalPhase
  maximumPositionLevel: OrganizationPositionLevel
  steps: ApprovalRouteStepDefinition[]
}

/**
 * Read-only route preview for a selected origin user. It always previews the
 * editor's current unsaved definition through the server action's explicit
 * draft override and displays the nearest resolved scope, the resulting
 * ceiling, per-step candidate names and counts, vacant-step warnings, and an
 * explicit auto-approval indication. Previewing never publishes and never
 * persists candidate snapshots.
 */
export function RoutePreview({ units, users, scopeUnitId, phase, maximumPositionLevel, steps }: RoutePreviewProps) {
  const [originUserId, setOriginUserId] = useState('')
  const [pending, startTransition] = useTransition()
  const [preview, setPreview] = useState<RoutePreviewResult | null>(null)

  function runPreview() {
    if (!originUserId || !scopeUnitId) return
    startTransition(async () => {
      try {
        const result = await previewApprovalRoute({
          scopeUnitId,
          phase,
          originUserId,
          draft: { scopeUnitId, phase, maximumPositionLevel, steps },
        })
        setPreview(result)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'The route preview failed')
      }
    })
  }

  const scopeName = preview
    ? units.find((unit) => unit.id === preview.scopeUnitId)?.name ?? preview.scopeUnitId
    : null
  const isDraftPreview = preview?.routeVersionId === DRAFT_PREVIEW_VERSION_ID

  return (
    <section className="rounded-lg border bg-card p-6 space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Route preview</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Read-only. Shows the steps the selected origin user would face, including candidate names,
          counts, and vacant-step warnings. Previewing never saves or publishes anything.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="route-origin">Origin user</Label>
        <div className="flex gap-2">
          <Select value={originUserId} onValueChange={setOriginUserId}>
            <SelectTrigger id="route-origin" className="w-full">
              <SelectValue placeholder="Select the origin user" />
            </SelectTrigger>
            <SelectContent>
              {users.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" onClick={runPreview} disabled={pending || !originUserId || !scopeUnitId}>
            {pending ? 'Previewing…' : 'Preview route'}
          </Button>
        </div>
      </div>

      {preview ? (
        <div className="space-y-4" aria-live="polite">
          <dl className="grid grid-cols-2 gap-2 rounded-md border p-3 text-sm">
            <dt className="text-muted-foreground">Nearest scope</dt>
            <dd className="font-medium">{scopeName}</dd>
            <dt className="text-muted-foreground">Phase</dt>
            <dd className="font-medium">{preview.phase}</dd>
            <dt className="text-muted-foreground">Resulting ceiling</dt>
            <dd className="font-medium">Level {preview.maximumPositionLevel}</dd>
            <dt className="text-muted-foreground">Route source</dt>
            <dd className="font-medium">
              {isDraftPreview ? 'Unsaved draft (not published)' : `Published version ${preview.routeVersionId}`}
            </dd>
          </dl>

          {preview.autoApproved ? (
            <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm font-medium text-green-700">
              The origin position is at or above the ceiling: this request is auto-approved and has no
              approval steps.
            </p>
          ) : (
            <ul className="space-y-2">
              {preview.steps.map((step) => (
                <li key={step.position} className="rounded-md border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {step.order}. {ROUTE_POSITION_LABELS[step.position]}
                    </span>
                    <span className="text-muted-foreground">
                      {step.candidateCount} candidate{step.candidateCount === 1 ? '' : 's'}
                    </span>
                  </div>
                  {step.candidates.length > 0 ? (
                    <p className="mt-1 text-muted-foreground">
                      {step.candidates.map((candidate) => candidate.name).join(', ')}
                    </p>
                  ) : null}
                  {step.skipped ? (
                    <p role="alert" className="mt-1 font-medium text-amber-600">
                      {step.skipReason === 'VACANT_POSITION'
                        ? 'Vacant position: no active holder is staffed for this step, so it is skipped at runtime.'
                        : `Skipped (${String(step.skipReason)}).`}
                    </p>
                  ) : null}
                </li>
              ))}
              {preview.steps.length === 0 ? (
                <li className="text-sm text-muted-foreground">
                  No steps remain for this origin: every configured position is at or below the
                  origin&apos;s own position.
                </li>
              ) : null}
            </ul>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Select an origin user and run the preview to see the resolved steps.
        </p>
      )}
    </section>
  )
}
