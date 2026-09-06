'use client'

import { useMemo, useState, useTransition } from 'react'
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
  OrganizationPositionCode,
  OrganizationUnitNode,
  ReportingGroupNode,
} from '@/lib/organization/types'
import type { OrganizationAdminUser } from './PositionAssignmentTable'
import { saveReportingGroup } from '@/server-actions/organization'

const PARENT_MANAGER_POSITIONS = new Set<OrganizationPositionCode>([
  'DEPARTMENT_MANAGER',
  'DIVISION_MANAGER',
  'FACTORY_MANAGER',
])

const SECTION_POSITIONS = new Set<OrganizationPositionCode>([
  'STAFF',
  'SUPERVISOR',
  'SECTION_MANAGER',
])

export interface ReportingGroupMember {
  reportingGroupId: string
  userId: string
}

export interface ReportingGroupEditorProps {
  units: OrganizationUnitNode[]
  groups: ReportingGroupNode[]
  members: ReportingGroupMember[]
  users: OrganizationAdminUser[]
  assignments: OrganizationPositionAssignment[]
  onSaved: () => void
}

export function ReportingGroupEditor({
  units,
  groups,
  members,
  users,
  assignments,
  onSaved,
}: ReportingGroupEditorProps) {
  const [pending, startTransition] = useTransition()
  const sections = units.filter((unit) => unit.unitType === 'SECTION')
  const [groupId, setGroupId] = useState(groups[0]?.id ?? '')
  const selected = groups.find((group) => group.id === groupId)
  const [name, setName] = useState(selected?.name ?? '')
  const [unitId, setUnitId] = useState(selected?.unitId ?? sections[0]?.id ?? '')
  const [parentGroupId, setParentGroupId] = useState(selected?.parentGroupId ?? '__none__')
  const [memberUserIds, setMemberUserIds] = useState<string[]>(
    members.filter((member) => member.reportingGroupId === selected?.id).map((member) => member.userId),
  )
  const [error, setError] = useState<string | null>(null)

  const parentManagers = useMemo(() => {
    return new Set(
      assignments
        .filter((assignment) => assignment.isActive && PARENT_MANAGER_POSITIONS.has(assignment.positionCode))
        .map((assignment) => assignment.userId),
    )
  }, [assignments])

  const eligibleMembers = useMemo(() => {
    const eligible = new Set(
      assignments
        .filter((assignment) =>
          assignment.isActive &&
          assignment.unitId === unitId &&
          SECTION_POSITIONS.has(assignment.positionCode) &&
          !parentManagers.has(assignment.userId),
        )
        .map((assignment) => assignment.userId),
    )
    return users.filter((user) => eligible.has(user.id))
  }, [assignments, parentManagers, unitId, users])

  const parentOptions = groups.filter((group) => group.unitId === unitId && group.id !== groupId)

  function loadGroup(nextId: string) {
    const next = groups.find((group) => group.id === nextId)
    setGroupId(nextId)
    setName(next?.name ?? '')
    setUnitId(next?.unitId ?? unitId)
    setParentGroupId(next?.parentGroupId ?? '__none__')
    setMemberUserIds(members.filter((member) => member.reportingGroupId === nextId).map((member) => member.userId))
  }

  function toggleMember(userId: string) {
    setMemberUserIds((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    )
  }

  function save(createNew: boolean) {
    startTransition(async () => {
      setError(null)
      try {
        await saveReportingGroup({
          id: createNew ? undefined : groupId || undefined,
          unitId,
          parentGroupId: parentGroupId === '__none__' ? null : parentGroupId,
          name,
          memberUserIds,
        })
        onSaved()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save reporting group')
      }
    })
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Reporting groups</h2>
        <p className="text-sm text-muted-foreground">
          Branch membership stays on the section. Parent managers are not added to descendant sections.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="group-select">Existing group</Label>
          <Select value={groupId} onValueChange={loadGroup}>
            <SelectTrigger id="group-select">
              <SelectValue placeholder="Select a group" />
            </SelectTrigger>
            <SelectContent>
              {groups.map((group) => (
                <SelectItem key={group.id} value={group.id}>
                  {group.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="group-name">Name</Label>
          <Input id="group-name" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="group-unit">Section</Label>
          <Select value={unitId} onValueChange={(value) => {
            setUnitId(value)
            setParentGroupId('__none__')
            setMemberUserIds([])
          }}>
            <SelectTrigger id="group-unit">
              <SelectValue placeholder="Select section" />
            </SelectTrigger>
            <SelectContent>
              {sections.map((unit) => (
                <SelectItem key={unit.id} value={unit.id}>
                  {unit.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="group-parent">Parent group</Label>
          <Select value={parentGroupId} onValueChange={setParentGroupId}>
            <SelectTrigger id="group-parent">
              <SelectValue placeholder="None" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {parentOptions.map((group) => (
                <SelectItem key={group.id} value={group.id}>
                  {group.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Section members</Label>
        <div className="flex flex-wrap gap-2">
          {eligibleMembers.length === 0 && (
            <p className="text-sm text-muted-foreground">No section-scoped members available.</p>
          )}
          {eligibleMembers.map((user) => {
            const checked = memberUserIds.includes(user.id)
            return (
              <Button
                key={user.id}
                type="button"
                size="sm"
                variant={checked ? 'default' : 'outline'}
                onClick={() => toggleMember(user.id)}
              >
                {user.name}
              </Button>
            )
          })}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" onClick={() => save(false)} disabled={pending || !name || !unitId}>
          {pending ? 'Saving...' : 'Save group'}
        </Button>
        <Button type="button" variant="outline" onClick={() => save(true)} disabled={pending || !name || !unitId}>
          Create group
        </Button>
      </div>
    </div>
  )
}
