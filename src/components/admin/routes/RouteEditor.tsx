'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
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
import { ORGANIZATION_POSITION_LEVEL } from '@/lib/organization/types'
import type { OrganizationPositionCode, OrganizationPositionLevel } from '@/lib/organization/types'
import type { ApprovalPhase, ApprovalRouteStepDefinition } from '@/lib/approval-routes/types'
import { publishApprovalRoute, saveApprovalRouteDraft } from '@/server-actions/approval-routes'
import { ROUTE_POSITION_LABELS, RouteStepList } from './RouteStepList'
import { RoutePreview } from './RoutePreview'

const APPROVAL_PHASE_LABELS: Record<ApprovalPhase, string> = {
  REQUEST: 'Request',
  SOLUTION: 'Solution',
  FINAL: 'Final',
}

const APPROVAL_PHASES: ApprovalPhase[] = ['REQUEST', 'SOLUTION', 'FINAL']

const CEILING_OPTIONS: OrganizationPositionLevel[] = [1, 2, 3, 4, 5, 6]

export interface AdminRouteUnit {
  id: string
  name: string
  unitType: string
}

export interface AdminRouteUser {
  id: string
  name: string
}

export interface AdminPublishedRoute {
  id: string
  scopeUnitId: string
  phase: ApprovalPhase
  version: number
  maximumPositionLevel: number
}

interface RouteEditorProps {
  units: AdminRouteUnit[]
  users: AdminRouteUser[]
  publishedRoutes: AdminPublishedRoute[]
}

/**
 * Admin route editor. Submits ONLY the scope unit, the phase, the maximum
 * position level ceiling, and the ordered position list — no free-form rule
 * fields. Save Draft stores an immutable draft version; Publish retires the
 * current published version and inserts the new one in a single server
 * transaction. The current published routes are listed for context.
 */
export function RouteEditor({ units, users, publishedRoutes }: RouteEditorProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [scopeUnitId, setScopeUnitId] = useState(units[0]?.id ?? '')
  const [phase, setPhase] = useState<ApprovalPhase>('REQUEST')
  const [maximumPositionLevel, setMaximumPositionLevel] = useState<OrganizationPositionLevel>(4)
  const [steps, setSteps] = useState<ApprovalRouteStepDefinition[]>([])
  const [nextPosition, setNextPosition] = useState<OrganizationPositionCode | ''>('')
  const [orderError, setOrderError] = useState<string | null>(null)

  function addStep() {
    if (!nextPosition) return
    const position = nextPosition as OrganizationPositionCode
    if (steps.some((step) => step.position === position)) return
    const level = ORGANIZATION_POSITION_LEVEL[position]
    if (level > maximumPositionLevel) {
      setOrderError(
        `${ROUTE_POSITION_LABELS[position]} is above the configured ceiling ` +
          `of level ${maximumPositionLevel}. The position was not added.`,
      )
      return
    }
    const previous = steps[steps.length - 1]
    const previousLevel = previous ? ORGANIZATION_POSITION_LEVEL[previous.position] : 0
    if (level <= previousLevel) {
      setOrderError(
        `${ROUTE_POSITION_LABELS[position]} cannot be ordered below ` +
          `${ROUTE_POSITION_LABELS[previous.position]}: route steps must stay strictly ascending. ` +
          'The position was not added.',
      )
      return
    }
    setOrderError(null)
    setSteps([...steps, { order: steps.length + 1, position }])
    setNextPosition('')
  }

  function removeStep(position: OrganizationPositionCode) {
    setSteps(
      steps
        .filter((step) => step.position !== position)
        .map((step, index) => ({ ...step, order: index + 1 })),
    )
    setOrderError(null)
  }

  function submit(kind: 'draft' | 'publish') {
    startTransition(async () => {
      try {
        const input = { scopeUnitId, phase, maximumPositionLevel, steps }
        const saved =
          kind === 'draft'
            ? await saveApprovalRouteDraft(input)
            : await publishApprovalRoute(input)
        toast.success(
          kind === 'draft'
            ? `Draft version ${saved.version} saved`
            : `Published version ${saved.version} for the selected scope`,
        )
        router.refresh()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'The route action failed')
      }
    })
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-lg border bg-card p-6 space-y-5">
        <div>
          <h2 className="text-lg font-semibold">Route definition</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            A route is an ordered list of explicit upward positions for one scope and phase. Positions
            must ascend and stay at or below the ceiling. Positions at or below a submitter are skipped
            at resolution.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="route-scope">Scope unit</Label>
            <Select value={scopeUnitId} onValueChange={setScopeUnitId}>
              <SelectTrigger id="route-scope" className="w-full">
                <SelectValue placeholder="Select a scope" />
              </SelectTrigger>
              <SelectContent>
                {units.map((unit) => (
                  <SelectItem key={unit.id} value={unit.id}>
                    {unit.name} ({unit.unitType.toLowerCase()})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="route-phase">Phase</Label>
            <Select value={phase} onValueChange={(value) => setPhase(value as ApprovalPhase)}>
              <SelectTrigger id="route-phase" className="w-full">
                <SelectValue placeholder="Select a phase" />
              </SelectTrigger>
              <SelectContent>
                {APPROVAL_PHASES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {APPROVAL_PHASE_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="route-ceiling">Ceiling (maximum position level)</Label>
            <Select
              value={String(maximumPositionLevel)}
              onValueChange={(value) => setMaximumPositionLevel(Number(value) as OrganizationPositionLevel)}
            >
              <SelectTrigger id="route-ceiling" className="w-full">
                <SelectValue placeholder="Select a ceiling" />
              </SelectTrigger>
              <SelectContent>
                {CEILING_OPTIONS.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    Level {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="route-position">Add position</Label>
          <div className="flex gap-2">
            <Select value={nextPosition} onValueChange={(value) => setNextPosition(value as OrganizationPositionCode | '')}>
              <SelectTrigger id="route-position" className="w-full">
                <SelectValue placeholder="Select a position" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ROUTE_POSITION_LABELS) as OrganizationPositionCode[])
                  .filter((position) => !steps.some((step) => step.position === position))
                  .map((position) => (
                    <SelectItem key={position} value={position}>
                      {ROUTE_POSITION_LABELS[position]}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" onClick={addStep} disabled={!nextPosition}>
              Add
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Ordered positions (drag to reorder)</Label>
          <RouteStepList
            steps={steps}
            onReorder={(reordered) => {
              setSteps(reordered)
            }}
          />
          {orderError ? (
            <p role="alert" className="text-sm font-medium text-red-600">
              {orderError}
            </p>
          ) : null}
          {steps.length > 0 ? (
            <ul className="space-y-1">
              {steps.map((step) => (
                <li key={step.position} className="flex items-center justify-between text-sm">
                  <span>
                    {step.order}. {ROUTE_POSITION_LABELS[step.position]}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeStep(step.position)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => submit('draft')} disabled={pending || !scopeUnitId}>
            Save draft
          </Button>
          <Button type="button" onClick={() => submit('publish')} disabled={pending || !scopeUnitId}>
            Publish route
          </Button>
        </div>

        <div className="space-y-2 border-t pt-4">
          <h3 className="text-sm font-semibold">Currently published routes</h3>
          {publishedRoutes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No routes are published yet.</p>
          ) : (
            <ul className="space-y-1 text-sm text-muted-foreground">
              {publishedRoutes.map((route) => (
                <li key={route.id}>
                  {units.find((unit) => unit.id === route.scopeUnitId)?.name ?? route.scopeUnitId} ·{' '}
                  {APPROVAL_PHASE_LABELS[route.phase]} · v{route.version} · ceiling level{' '}
                  {route.maximumPositionLevel}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <RoutePreview
        units={units}
        users={users}
        scopeUnitId={scopeUnitId}
        phase={phase}
        maximumPositionLevel={maximumPositionLevel}
        steps={steps}
      />
    </div>
  )
}
