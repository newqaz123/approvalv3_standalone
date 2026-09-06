'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type {
  OrganizationPositionAssignment,
  OrganizationUnitNode,
  OrganizationUnitType,
  ReportingGroupNode,
} from '@/lib/organization/types'
import { createOrganizationUnit } from '@/server-actions/organization'
import { OrganizationUnitTree } from './OrganizationUnitTree'
import { PositionAssignmentTable, type OrganizationAdminUser } from './PositionAssignmentTable'
import { ReportingGroupEditor, type ReportingGroupMember } from './ReportingGroupEditor'

interface MappingCoverage {
  mappedDepartmentCount: number
  mappedUserCount: number
  mappedExternalApproverCount: number
  unmappedDepartmentIds: string[]
  unmappedUserIds: string[]
  blockingReasons: string[]
  wouldCreateUnits: number
  wouldCreateAssignments: number
  wouldCreateReportingGroups: number
}

const UNIT_TYPES: OrganizationUnitType[] = ['FACTORY', 'DIVISION', 'DEPARTMENT', 'SECTION']
const EXPECTED_PARENT: Record<OrganizationUnitType, OrganizationUnitType | null> = {
  FACTORY: null,
  DIVISION: 'FACTORY',
  DEPARTMENT: 'DIVISION',
  SECTION: 'DEPARTMENT',
}

export interface OrganizationEditorProps {
  units: OrganizationUnitNode[]
  assignments: OrganizationPositionAssignment[]
  reportingGroups: ReportingGroupNode[]
  members: ReportingGroupMember[]
  users: OrganizationAdminUser[]
  mappingCoverage: MappingCoverage
  pendingInstanceCounts: Record<string, number>
}

export function OrganizationEditor({
  units,
  assignments,
  reportingGroups,
  members,
  users,
  mappingCoverage,
  pendingInstanceCounts,
}: OrganizationEditorProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState('')
  const [unitType, setUnitType] = useState<OrganizationUnitType>('SECTION')
  const [parentId, setParentId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const expectedParent = EXPECTED_PARENT[unitType]
  const parentOptions = expectedParent
    ? units.filter((unit) => unit.unitType === expectedParent && unit.isActive)
    : []
  const hasMappingBlockers = mappingCoverage.blockingReasons.length > 0
  const mappingEmpty =
    mappingCoverage.mappedDepartmentCount === 0 &&
    mappingCoverage.mappedUserCount === 0 &&
    mappingCoverage.mappedExternalApproverCount === 0

  function refresh() {
    router.refresh()
  }

  function createUnit() {
    startTransition(async () => {
      setError(null)
      try {
        await createOrganizationUnit({
          name,
          unitType,
          parentId: expectedParent === null ? null : parentId || null,
        })
        setName('')
        refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create unit')
      }
    })
  }

  return (
    <div className="space-y-8">
      <section className="rounded-lg border bg-card p-6 space-y-3">
        <h2 className="text-lg font-semibold">Reviewed mapping coverage</h2>
        <p className="text-sm text-muted-foreground">
          Mapping status comes from the reviewed dry-run report type. Coverage may be empty or unmapped until ingest.
        </p>
        <dl className="grid gap-2 sm:grid-cols-3 text-sm">
          <div>Mapped departments: {mappingCoverage.mappedDepartmentCount}</div>
          <div>Mapped users: {mappingCoverage.mappedUserCount}</div>
          <div>Mapped external approvers: {mappingCoverage.mappedExternalApproverCount}</div>
          <div>Would create units: {mappingCoverage.wouldCreateUnits}</div>
          <div>Would create assignments: {mappingCoverage.wouldCreateAssignments}</div>
          <div>Would create reporting groups: {mappingCoverage.wouldCreateReportingGroups}</div>
        </dl>
        {mappingEmpty && (
          <p className="text-sm text-muted-foreground">Mapping coverage is empty/unmapped until ingest.</p>
        )}
        {hasMappingBlockers ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <p className="font-medium">NEW mode is blocked while the dry-run report has blockers.</p>
            <ul className="mt-2 list-disc pl-5">
              {mappingCoverage.blockingReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            The rollout gate blocks NEW mode when the dry-run report has blockers.
          </p>
        )}
        <div className="flex flex-wrap gap-3 text-sm">
          <Link href="/admin/routes" className="text-primary underline">
            Edit approval routes and preview
          </Link>
        </div>
      </section>

      <section className="rounded-lg border bg-card p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Create unit</h2>
          <p className="text-sm text-muted-foreground">Parent type is validated; cycles are rejected.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-unit-name">Name</Label>
            <Input id="new-unit-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-unit-type">Type</Label>
            <Select value={unitType} onValueChange={(value) => {
              setUnitType(value as OrganizationUnitType)
              setParentId('')
            }}>
              <SelectTrigger id="new-unit-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UNIT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-unit-parent">Parent</Label>
            <Select
              value={parentId}
              onValueChange={setParentId}
              disabled={expectedParent === null}
            >
              <SelectTrigger id="new-unit-parent">
                <SelectValue placeholder={expectedParent === null ? 'None' : 'Select parent'} />
              </SelectTrigger>
              <SelectContent>
                {parentOptions.map((unit) => (
                  <SelectItem key={unit.id} value={unit.id}>
                    {unit.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="button" onClick={createUnit} disabled={pending || !name || (expectedParent !== null && !parentId)}>
          {pending ? 'Creating...' : 'Create unit'}
        </Button>
      </section>

      <section className="rounded-lg border bg-card p-6">
        <OrganizationUnitTree
          units={units}
          pendingInstanceCounts={pendingInstanceCounts}
          onSaved={refresh}
        />
      </section>

      <section className="rounded-lg border bg-card p-6">
        <PositionAssignmentTable
          users={users}
          units={units}
          assignments={assignments}
          reportingGroups={reportingGroups}
          onSaved={refresh}
        />
      </section>

      <section className="rounded-lg border bg-card p-6">
        <ReportingGroupEditor
          units={units}
          groups={reportingGroups}
          members={members}
          users={users}
          assignments={assignments}
          onSaved={refresh}
        />
      </section>
    </div>
  )
}
