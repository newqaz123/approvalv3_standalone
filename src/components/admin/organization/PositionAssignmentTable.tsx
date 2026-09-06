'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type {
  OrganizationPositionAssignment,
  OrganizationPositionCode,
  OrganizationUnitNode,
  ReportingGroupNode,
} from '@/lib/organization/types'
import { savePositionAssignment } from '@/server-actions/organization'

export const POSITION_LABELS: Record<OrganizationPositionCode, string> = {
  STAFF: 'Staff (1)',
  SUPERVISOR: 'Supervisor (2)',
  SECTION_MANAGER: 'Section Manager (3)',
  DEPARTMENT_MANAGER: 'Department Manager (4)',
  DIVISION_MANAGER: 'Division Manager (5)',
  FACTORY_MANAGER: 'Factory Manager (6)',
}

const POSITION_UNIT: Record<OrganizationPositionCode, OrganizationUnitNode['unitType']> = {
  STAFF: 'SECTION',
  SUPERVISOR: 'SECTION',
  SECTION_MANAGER: 'SECTION',
  DEPARTMENT_MANAGER: 'DEPARTMENT',
  DIVISION_MANAGER: 'DIVISION',
  FACTORY_MANAGER: 'FACTORY',
}

const PARENT_MANAGER_POSITIONS = new Set<OrganizationPositionCode>([
  'DEPARTMENT_MANAGER',
  'DIVISION_MANAGER',
  'FACTORY_MANAGER',
])

export interface OrganizationAdminUser {
  id: string
  name: string
  role: string
}

export interface PositionAssignmentTableProps {
  users: OrganizationAdminUser[]
  units: OrganizationUnitNode[]
  assignments: OrganizationPositionAssignment[]
  reportingGroups: ReportingGroupNode[]
  onSaved: () => void
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  general_dept: 'General Dept',
  engineering: 'Engineering',
}

export function PositionAssignmentTable({
  users,
  units,
  assignments,
  reportingGroups,
  onSaved,
}: PositionAssignmentTableProps) {
  const [pending, startTransition] = useTransition()
  const [userId, setUserId] = useState(users[0]?.id ?? '')
  const [positionCode, setPositionCode] = useState<OrganizationPositionCode>('STAFF')
  const [unitId, setUnitId] = useState('')
  const [reportingGroupId, setReportingGroupId] = useState('__none__')
  const [isPrimary, setIsPrimary] = useState(true)
  const [isActive, setIsActive] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const unitsForPosition = units.filter((unit) => unit.unitType === POSITION_UNIT[positionCode] && unit.isActive)
  const selectedUnit = units.find((unit) => unit.id === unitId)
  const groupOptions = selectedUnit?.unitType === 'SECTION'
    ? reportingGroups.filter((group) => group.unitId === selectedUnit.id && group.isActive)
    : []
  const parentManager = PARENT_MANAGER_POSITIONS.has(positionCode)

  function save() {
    startTransition(async () => {
      setError(null)
      try {
        await savePositionAssignment({
          userId,
          unitId,
          positionCode,
          reportingGroupId: parentManager || reportingGroupId === '__none__' ? null : reportingGroupId,
          isPrimary,
          isActive,
        })
        onSaved()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save assignment')
      }
    })
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Position assignments</h2>
        <p className="text-sm text-muted-foreground">
          System role is independent of position and unit scope. Parent managers stay on the parent unit.
        </p>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>System role</TableHead>
              <TableHead>Position</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>Primary</TableHead>
              <TableHead>Active</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {assignments.map((assignment) => {
              const user = users.find((candidate) => candidate.id === assignment.userId)
              const unit = units.find((candidate) => candidate.id === assignment.unitId)
              return (
                <TableRow key={assignment.id}>
                  <TableCell>{user?.name ?? assignment.userId}</TableCell>
                  <TableCell>{ROLE_LABELS[user?.role ?? ''] ?? user?.role ?? '—'}</TableCell>
                  <TableCell>{POSITION_LABELS[assignment.positionCode]}</TableCell>
                  <TableCell>{unit?.name ?? assignment.unitId}</TableCell>
                  <TableCell>{assignment.isPrimary ? 'Yes' : 'No'}</TableCell>
                  <TableCell>{assignment.isActive ? 'Active' : 'Inactive'}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="assign-user">User</Label>
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger id="assign-user">
              <SelectValue placeholder="Select user" />
            </SelectTrigger>
            <SelectContent>
              {users.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.name} ({ROLE_LABELS[user.role] ?? user.role})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="assign-position">Position</Label>
          <Select value={positionCode} onValueChange={(value) => {
            setPositionCode(value as OrganizationPositionCode)
            setUnitId('')
            setReportingGroupId('__none__')
          }}>
            <SelectTrigger id="assign-position">
              <SelectValue placeholder="Select position" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(POSITION_LABELS).map(([code, label]) => (
                <SelectItem key={code} value={code}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="assign-unit">Unit</Label>
          <Select value={unitId} onValueChange={setUnitId}>
            <SelectTrigger id="assign-unit">
              <SelectValue placeholder="Select unit" />
            </SelectTrigger>
            <SelectContent>
              {unitsForPosition.map((unit) => (
                <SelectItem key={unit.id} value={unit.id}>
                  {unit.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="assign-group">Reporting group</Label>
          <Select
            value={reportingGroupId}
            onValueChange={setReportingGroupId}
            disabled={parentManager || groupOptions.length === 0}
          >
            <SelectTrigger id="assign-group">
              <SelectValue placeholder="None" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {groupOptions.map((group) => (
                <SelectItem key={group.id} value={group.id}>
                  {group.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2 pt-6">
          <Switch id="assign-primary" checked={isPrimary} onCheckedChange={setIsPrimary} />
          <Label htmlFor="assign-primary">Primary</Label>
        </div>
        <div className="flex items-center gap-2 pt-6">
          <Switch id="assign-active" checked={isActive} onCheckedChange={setIsActive} />
          <Label htmlFor="assign-active">Active</Label>
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="button" onClick={save} disabled={pending || !userId || !unitId}>
        {pending ? 'Saving...' : 'Save assignment'}
      </Button>
    </div>
  )
}
