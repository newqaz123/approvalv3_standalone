import { strict as assert } from 'node:assert'
import { test } from 'node:test'

/**
 * Human-friendly formatting of organization validation errors (follow-up on
 * accepted a663e706): user-facing panel messages must quote unit display
 * names (unit-labels lib) and person names — never raw unit slugs (cs-*) or
 * UUIDs. The detailed id-bearing strings stay available to the CLI/readiness
 * layer, which consumes validateOrganization's own messages.
 *
 * Raw strings below were captured from the live workspace (2026-09-13,
 * app_cleanstart_dev) while the owner's org carried the deactivated
 * "Line A" team.
 */
import {
  formatOrganizationErrorForUser,
  type ErrorFormatSnapshot,
} from '@/lib/organization/error-formatting'
import type { AssignmentNode, OrganizationUnitNode, PositionNode, TeamNode } from '@/lib/organization/model'

const units: OrganizationUnitNode[] = [
  { id: 'cs-unit-company', name: 'Factory', parentId: null, isActive: true, shareRequests: true, canWorkOnSolutions: false, managerUserId: '5854bf6f-b56b-4fb3-86f8-f2484332d878' },
  { id: 'cs-unit-operations', name: 'Production Division', parentId: 'cs-unit-company', isActive: true, shareRequests: true, canWorkOnSolutions: false, managerUserId: null },
  { id: 'cs-unit-section-a', name: 'Production Department', parentId: 'cs-unit-operations', isActive: true, shareRequests: true, canWorkOnSolutions: false, managerUserId: null },
]
const positions: PositionNode[] = [
  { id: 'cs-pos-staff', name: 'Staff', rank: 1, isActive: true },
  { id: 'cs-pos-lead', name: 'Supervisor', rank: 2, isActive: true },
  { id: 'cs-pos-manager', name: 'Section manager', rank: 3, isActive: true },
]
const teams: TeamNode[] = [
  { id: 'cs-team-section-a-line', unitId: 'cs-unit-section-a', name: 'Line A', reportsToAssignmentId: 'cs-asg-riley', isActive: false },
]
const assignments: AssignmentNode[] = [
  { id: '93489dcf-1506-4499-a8a7-b123bac7c04b', userId: 'casey-id', unitId: 'cs-unit-section-a', positionId: 'cs-pos-lead', teamId: 'cs-team-section-a-line', isActive: true },
  { id: 'cs-asg-alice', userId: 'alice-id', unitId: 'cs-unit-section-a', positionId: 'cs-pos-staff', teamId: null, isActive: true },
]
const users = [
  { id: 'casey-id', name: 'Casey' },
  { id: 'alice-id', name: 'Alice' },
  { id: '5854bf6f-b56b-4fb3-86f8-f2484332d878', name: 'Dana' },
]

const snapshot: ErrorFormatSnapshot = { units, positions, assignments, teams, users }

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

test('rule-6 message quotes person, unit display name, and team name — no slugs or UUIDs', () => {
  const raw = 'active assignment "93489dcf-1506-4499-a8a7-b123bac7c04b" (unit "cs-unit-section-a") references inactive team "cs-team-section-a-line" (unit "cs-unit-section-a"); active membership requires an active team'
  const friendly = formatOrganizationErrorForUser(raw, snapshot)
  assert.ok(friendly.includes('Casey'), `person name missing: ${friendly}`)
  assert.ok(friendly.includes('Production Department'), `unit display name missing: ${friendly}`)
  assert.ok(friendly.includes('Line A'), `team name missing: ${friendly}`)
  assert.ok(!UUID.test(friendly), `UUID leaked: ${friendly}`)
  assert.ok(!/cs-/.test(friendly), `raw slug leaked: ${friendly}`)
})

test('unit display name uses the unit-labels path (unit › parent … root)', () => {
  const raw = 'active assignment "93489dcf-1506-4499-a8a7-b123bac7c04b" references inactive unit "cs-unit-section-a"'
  const friendly = formatOrganizationErrorForUser(raw, snapshot)
  assert.ok(
    friendly.includes('Production Department › Production Division › Factory'),
    `full unit path expected: ${friendly}`,
  )
})

test('not-found guard messages resolve ids to display names', () => {
  const unitMissing = formatOrganizationErrorForUser(
    'organization unit "cs-unit-section-a" was not found', snapshot,
  )
  assert.ok(unitMissing.includes('Production Department'), unitMissing)
  assert.ok(!/cs-/.test(unitMissing), unitMissing)

  const positionMissing = formatOrganizationErrorForUser(
    'position "cs-pos-lead" was not found', snapshot,
  )
  assert.ok(positionMissing.includes('Supervisor'), positionMissing)
})

test('rule-1 (duplicate active assignment) names the person, not the user id', () => {
  const raw = 'more than one active assignment for user "casey-id": "cs-asg-alice", "93489dcf-1506-4499-a8a7-b123bac7c04b" — exactly one active assignment per user is allowed'
  const friendly = formatOrganizationErrorForUser(raw, snapshot)
  assert.ok(friendly.includes('Casey'), friendly)
  assert.ok(!UUID.test(friendly), `UUID leaked: ${friendly}`)
})

test('rule-3 (manager without direct assignment) names unit path and person', () => {
  const raw = 'unit "cs-unit-company" manager "5854bf6f-b56b-4fb3-86f8-f2484332d878" has no active assignment directly in that unit (active assignment "cs-asg-alice" is in unit "cs-unit-section-a")'
  const friendly = formatOrganizationErrorForUser(raw, snapshot)
  assert.ok(friendly.includes('Factory'), friendly)
  assert.ok(friendly.includes('Dana'), friendly)
  assert.ok(!UUID.test(friendly), `UUID leaked: ${friendly}`)
})

test('assignment ids render as "person in unit"', () => {
  const friendly = formatOrganizationErrorForUser(
    'active assignment "cs-asg-alice" references missing unit id "nowhere"', snapshot,
  )
  assert.ok(friendly.includes('Alice in Production Department'), friendly)
})

test('unknown UUIDs never leak — replaced with an unavailable marker', () => {
  const friendly = formatOrganizationErrorForUser(
    'team "11111111-2222-3333-4444-555555555555" (unit "99999999-8888-7777-6666-555555555555") reports-to references missing assignment id "00000000-0000-0000-0000-000000000000"', snapshot,
  )
  assert.ok(!UUID.test(friendly), `UUID leaked: ${friendly}`)
  assert.ok(!/cs-/.test(friendly), friendly)
  assert.ok(friendly.includes('unavailable'), friendly)
})

test('non-id quoted text (names like "Line A") passes through unchanged', () => {
  const friendly = formatOrganizationErrorForUser(
    'duplicate team name "Line A" among active teams in unit "cs-unit-section-a"', snapshot,
  )
  assert.ok(friendly.includes('"Line A"'), friendly)
  assert.ok(friendly.includes('Production Department'), friendly)
})

test('deactivation guard offenders drop the redundant parenthetical ids', () => {
  const raw = 'Unit "Production Department" has active child units: "Engineering Section" (b4d9679e-5009-4d35-ba06-deb3e06c5084), "Maintenance Section" (e2cac18e-c058-4686-90e8-b6196087935e); deactivate children first'
  const friendly = formatOrganizationErrorForUser(raw, snapshot)
  assert.ok(friendly.includes('"Engineering Section"'), friendly)
  assert.ok(friendly.includes('"Maintenance Section"'), friendly)
  assert.ok(!UUID.test(friendly), `UUID leaked: ${friendly}`)
  assert.ok(!/\([^)]*[0-9a-f]{8}-/i.test(friendly), `parenthetical id leaked: ${friendly}`)
})

test('people/team member guard offenders keep the person name, drop the assignment id', () => {
  const unitPeople = formatOrganizationErrorForUser(
    'Unit "Production Department" has people still assigned: "Casey" (93489dcf-1506-4499-a8a7-b123bac7c04b); move or remove people first', snapshot,
  )
  assert.ok(unitPeople.includes('"Casey"'), unitPeople)
  assert.ok(!UUID.test(unitPeople), `UUID leaked: ${unitPeople}`)

  const teamMembers = formatOrganizationErrorForUser(
    'Team "Line A" has members still assigned: "Casey" (93489dcf-1506-4499-a8a7-b123bac7c04b); move or remove members first', snapshot,
  )
  assert.ok(teamMembers.includes('"Casey"'), teamMembers)
  assert.ok(!UUID.test(teamMembers), `UUID leaked: ${teamMembers}`)
})

test('route-version guard ids outside the org snapshot become the unavailable marker', () => {
  const raw = 'Unit "Factory" has approval route versions scoped to it: 11111111-2222-3333-4444-555555555555 (REQUEST published); retire or move them first'
  const friendly = formatOrganizationErrorForUser(raw, snapshot)
  assert.ok(!UUID.test(friendly), `UUID leaked: ${friendly}`)
  assert.ok(friendly.includes('unavailable'), friendly)
  assert.ok(friendly.includes('(REQUEST published)'), friendly)
})

test('bare seeded slugs never leak either', () => {
  const friendly = formatOrganizationErrorForUser(
    'Unit "Production Department" has active teams: "Line A" (cs-team-ghost); deactivate or remove them first', snapshot,
  )
  assert.ok(!/cs-/.test(friendly), friendly)
  assert.ok(friendly.includes('"Line A"'), friendly)
})

test('panels route server-action errors through the formatter (source contract)', () => {
  const { readFileSync } = require('node:fs') as typeof import('node:fs')
  const panels = [
    'src/components/organization/PersonAssignmentPanel.tsx',
    'src/components/organization/UnitSidePanel.tsx',
    'src/components/organization/TeamPanel.tsx',
  ]
  for (const path of panels) {
    const source = readFileSync(path, 'utf8')
    const raw = (source.match(/err instanceof Error \? err\.message : String\(err\)/g) ?? []).length
    const formatted = (source.match(/formatOrganizationErrorForUser\(/g) ?? []).length
    assert.ok(
      raw === 0 && formatted >= 1,
      `${path}: ${raw} raw err.message sites remain; ${formatted} formatted sites`,
    )
  }
})

test('UnassignedPeopleList truncates long names without overlapping at narrow widths (source contract)', () => {
  const { readFileSync } = require('node:fs') as typeof import('node:fs')
  const source = readFileSync('src/components/organization/UnassignedPeopleList.tsx', 'utf8')
  assert.ok(/min-w-0/.test(source), 'list/chips need min-w-0 so flex children may shrink')
  assert.ok(/truncate/.test(source), 'chips need text truncation for names wider than the container')
  assert.ok(/max-w-full/.test(source), 'chips must never exceed the container width')
  assert.ok(/whitespace-nowrap/.test(source), 'chip text must not wrap mid-name')
  assert.ok(/title=\{user\.name\}/.test(source), 'full name stays reachable via the title tooltip')
})
