'use client'

import React, { useMemo, useState } from 'react'
import { Users } from 'lucide-react'
import { ExceptionBranchBadges } from '@/components/organization/ExceptionBranchBadges'
import { InTreeModal } from '@/components/organization/InTreeModal'
import { OrganizationTree } from '@/components/organization/OrganizationTree'
import { PersonAssignmentPanel } from '@/components/organization/PersonAssignmentPanel'
import { TeamPanel } from '@/components/organization/TeamPanel'
import { UnassignedPeopleList } from '@/components/organization/UnassignedPeopleList'
import { UnitSidePanel } from '@/components/organization/UnitSidePanel'
import { ZoomableFlowchart } from '@/components/organization/ZoomableFlowchart'
import type { AssignmentNode, OrganizationUnitNode, TeamNode } from '@/lib/organization/model'
import type { WorkspaceSnapshot } from '@/server-actions/organization'

type UnitPatch = Partial<Pick<OrganizationUnitNode, 'shareRequests' | 'canWorkOnSolutions' | 'managerUserId' | 'isActive'>>

export function OrganizationWorkspace({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null)
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(null)
  const [selectedUnassignedUserId, setSelectedUnassignedUserId] = useState<string | null>(null)
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)
  const [creatingTeamUnitId, setCreatingTeamUnitId] = useState<string | null>(null)
  // Owner-approved: the bottom unassigned dock is gone; the toolbar's
  // Unassigned chip opens the list as a manage drawer.
  const [unassignedPanelOpen, setUnassignedPanelOpen] = useState(false)
  const [overrides, setOverrides] = useState<Record<string, UnitPatch>>({})
  const [assignmentRows, setAssignmentRows] = useState<AssignmentNode[] | null>(null)
  const [teamRows, setTeamRows] = useState<TeamNode[] | null>(null)
  const [unassignedRows, setUnassignedRows] = useState<WorkspaceSnapshot['unassignedUsers'] | null>(null)

  const viewSnapshot = useMemo(() => {
    const units = snapshot.units.map((unit) => {
      const patch = overrides[unit.id]
      return patch ? { ...unit, ...patch } : unit
    })
    return {
      ...snapshot,
      units,
      assignments: assignmentRows ?? snapshot.assignments,
      teams: teamRows ?? snapshot.teams,
      unassignedUsers: unassignedRows ?? snapshot.unassignedUsers,
    }
  }, [snapshot, overrides, assignmentRows, teamRows, unassignedRows])

  const selectedUnit = viewSnapshot.units.find((unit) => unit.id === selectedUnitId) ?? null

  function selectUnit(unitId: string) {
    setSelectedUnitId(unitId)
    setSelectedAssignmentId(null)
    setSelectedUnassignedUserId(null)
    setSelectedTeamId(null)
    setCreatingTeamUnitId(null)
    setUnassignedPanelOpen(false)
  }

  function selectPerson(assignmentId: string) {
    setSelectedAssignmentId(assignmentId)
    setSelectedUnitId(null)
    setSelectedUnassignedUserId(null)
    setSelectedTeamId(null)
    setCreatingTeamUnitId(null)
    setUnassignedPanelOpen(false)
  }

  function selectUnassigned(userId: string) {
    setSelectedUnassignedUserId(userId)
    setSelectedAssignmentId(null)
    setSelectedUnitId(null)
    setSelectedTeamId(null)
    setCreatingTeamUnitId(null)
    // The assignment drawer takes over; the unassigned panel closes.
    setUnassignedPanelOpen(false)
  }

  function selectTeam(teamId: string) {
    setSelectedTeamId(teamId)
    setCreatingTeamUnitId(null)
    setSelectedUnitId(null)
    setSelectedAssignmentId(null)
    setSelectedUnassignedUserId(null)
    setUnassignedPanelOpen(false)
  }

  function startCreateTeam(unitId: string) {
    setCreatingTeamUnitId(unitId)
    setSelectedTeamId(null)
    setSelectedUnitId(null)
    setSelectedAssignmentId(null)
    setSelectedUnassignedUserId(null)
    setUnassignedPanelOpen(false)
  }

  function toggleUnassignedPanel() {
    // Exactly one management drawer: opening Unassigned is a selection, so it
    // clears unit/person/team selections — mirroring the select* helpers,
    // which close this panel in return.
    if (!unassignedPanelOpen) {
      setSelectedUnitId(null)
      setSelectedAssignmentId(null)
      setSelectedUnassignedUserId(null)
      setSelectedTeamId(null)
      setCreatingTeamUnitId(null)
    }
    setUnassignedPanelOpen(!unassignedPanelOpen)
  }

  const currentAssignments = assignmentRows ?? snapshot.assignments
  const currentUnassigned = unassignedRows ?? snapshot.unassignedUsers
  const currentTeams = teamRows ?? snapshot.teams

  function closeManageDrawer() {
    setSelectedUnitId(null)
    setSelectedAssignmentId(null)
    setSelectedUnassignedUserId(null)
    setSelectedTeamId(null)
    setCreatingTeamUnitId(null)
    setUnassignedPanelOpen(false)
  }

  const manageOpen = unassignedPanelOpen
    || selectedUnit !== null
    || creatingTeamUnitId !== null
    || selectedTeamId !== null
    || selectedAssignmentId !== null
    || selectedUnassignedUserId !== null

  const selectedTeam = selectedTeamId
    ? viewSnapshot.teams.find((team) => team.id === selectedTeamId) ?? null
    : null
  const selectedPerson = selectedAssignmentId
    ? viewSnapshot.assignments.find((assignment) => assignment.id === selectedAssignmentId)
    : null
  const selectedPersonName = selectedPerson
    ? viewSnapshot.users.find((user) => user.id === selectedPerson.userId)?.name
    : null
  const manageTitle = selectedUnit ? (
    <span className="flex min-w-0 items-center gap-2">
      <span className="truncate">{selectedUnit.name}</span>
      <ExceptionBranchBadges
        snapshot={viewSnapshot}
        unitId={selectedUnit.id}
        unitName={selectedUnit.name}
        compact
      />
    </span>
  ) : creatingTeamUnitId ? 'Create team'
    : selectedTeam ? selectedTeam.name
      : selectedPersonName ?? (selectedUnassignedUserId ? 'Assign person' : 'Manage organization')

  return (
    <div data-testid="organization-workspace" className="flex flex-col items-stretch">
      {/* Zoom owns the flowchart canvas only: the sticky toolbar, the manage
          drawers, and the unassigned panel live outside the scaled surface.
          The bottom unassigned dock is gone: the toolbar's Unassigned chip
          opens the list as a manage drawer. */}
      <div className="min-w-0 flex-1 space-y-8">
        <ZoomableFlowchart
          toolbarExtras={
            <button
              type="button"
              data-testid="unassigned-dock-toggle"
              aria-expanded={unassignedPanelOpen}
              aria-label="Unassigned people"
              onClick={toggleUnassignedPanel}
              className={`inline-flex h-8 max-w-full items-center gap-1.5 rounded-md border px-2.5 text-sm font-medium shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                unassignedPanelOpen
                  ? 'border-slate-400 bg-accent text-accent-foreground'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-accent'
              }`}
            >
              <Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">Unassigned · {viewSnapshot.unassignedUsers.length}</span>
            </button>
          }
        >
          <OrganizationTree
            snapshot={viewSnapshot}
            onSelectUnit={selectUnit}
            onSelectPerson={selectPerson}
            onSelectTeam={selectTeam}
          />
        </ZoomableFlowchart>
      </div>
      <InTreeModal
        open={manageOpen}
        onClose={closeManageDrawer}
        testId="organization-manage-drawer"
        title={manageTitle}
        titleId="organization-manage-title"
        overlayZ="z-40"
        className="organization-manage-drawer max-w-[800px]"
      >
      {unassignedPanelOpen ? (
          <UnassignedPeopleList
            users={viewSnapshot.unassignedUsers}
            onSelectUser={selectUnassigned}
          />
      ) : null}
      {selectedUnit ? (
          <UnitSidePanel
          unit={selectedUnit}
          snapshot={viewSnapshot}
          showTitle={false}
          inModal
          onSettingsSaved={(patch) => {
            setOverrides((current) => ({
              ...current,
              [selectedUnit.id]: { ...current[selectedUnit.id], ...patch },
            }))
            // Owner-approved modal UX: a saved unit dialog closes itself.
            closeManageDrawer()
          }}
          onManagerSaved={(managerUserId) => {
            setOverrides((current) => ({
              ...current,
              [selectedUnit.id]: { ...current[selectedUnit.id], managerUserId },
            }))
          }}
          onCreateTeam={startCreateTeam}
          onDeactivated={(unitId) => {
            // Deactivate-not-delete: flip the local row so the tree hides the
            // unit immediately; the panel closes because nothing is selected.
            setOverrides((current) => ({
              ...current,
              [unitId]: { ...current[unitId], isActive: false },
            }))
            setSelectedUnitId(null)
          }}
        />
      ) : null}
      {creatingTeamUnitId || selectedTeamId ? (
          <TeamPanel
          snapshot={viewSnapshot}
          unitId={
            creatingTeamUnitId
            ?? viewSnapshot.teams.find((row) => row.id === selectedTeamId)?.unitId
            ?? ''
          }
          teamId={selectedTeamId}
          onCreated={(team, memberAssignmentIds) => {
            setTeamRows([...(teamRows ?? snapshot.teams), team])
            setAssignmentRows(currentAssignments.map((row) => (
              memberAssignmentIds.includes(row.id) ? { ...row, teamId: team.id } : row
            )))
            setSelectedTeamId(team.id)
            setCreatingTeamUnitId(null)
          }}
          onUpdated={(patch) => {
            setTeamRows(currentTeams.map((row) => (
              row.id === patch.id
                ? { ...row, name: patch.name, reportsToAssignmentId: patch.reportsToAssignmentId }
                : row
            )))
            setAssignmentRows(currentAssignments.map((row) => {
              if (patch.memberAssignmentIds.includes(row.id)) return { ...row, teamId: patch.id }
              if (row.teamId === patch.id) return { ...row, teamId: null }
              return row
            }))
          }}
          onDeactivated={(teamId) => {
            // Deactivate-not-delete: flip the local row so the tree hides the
            // team group immediately; the panel closes because nothing is selected.
            setTeamRows((teamRows ?? snapshot.teams).map((row) => (
              row.id === teamId ? { ...row, isActive: false } : row
            )))
            setSelectedTeamId(null)
          }}
        />
      ) : null}
      {selectedAssignmentId || selectedUnassignedUserId ? (
          <PersonAssignmentPanel
          snapshot={viewSnapshot}
          assignmentId={selectedAssignmentId}
          userId={selectedUnassignedUserId}
          onAssigned={(row) => {
            setAssignmentRows([...currentAssignments, row])
            setUnassignedRows(currentUnassigned.filter((user) => user.id !== row.userId))
            // Owner-approved modal UX: a completed assign closes the dialog
            // instead of flipping to the move view (no assign→save→move loop).
            closeManageDrawer()
          }}
          onMoved={(patch) => {
            setAssignmentRows(currentAssignments.map((row) => (
              row.id === patch.assignmentId
                ? { ...row, unitId: patch.unitId, positionId: patch.positionId, teamId: patch.teamId }
                : row
            )))
            if (patch.teamReportsToCorrections.length > 0) {
              const byId = new Map(
                patch.teamReportsToCorrections.map((row) => [row.teamId, row.reportsToAssignmentId]),
              )
              setTeamRows(currentTeams.map((team) => {
                const nextReportsTo = byId.get(team.id)
                return nextReportsTo ? { ...team, reportsToAssignmentId: nextReportsTo } : team
              }))
            }
            // Owner-approved modal UX: a confirmed move closes the dialog.
            closeManageDrawer()
          }}
          onRemoved={({ assignmentId, userId }) => {
            setAssignmentRows(currentAssignments.map((row) => (
              row.id === assignmentId ? { ...row, isActive: false } : row
            )))
            const account = snapshot.users.find((row) => row.id === userId)
            if (account && account.isActive) {
              const already = currentUnassigned.some((row) => row.id === userId)
              if (!already) {
                setUnassignedRows([
                  ...currentUnassigned,
                  { id: account.id, name: account.name, email: account.email },
                ])
              }
            }
            // Owner-approved modal UX: remove closes the dialog; the account
            // reappears under the Unassigned chip.
            closeManageDrawer()
          }}
        />
      ) : null}
      </InTreeModal>
    </div>
  )
}
