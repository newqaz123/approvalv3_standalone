/**
 * Pure (no I/O) fixture definition for the isolated admin HTTP-security
 * harness (test-only).
 *
 * Closes the four outstanding items of the Astra admin-action-guard review
 * with real HTTP traffic against an owned app/database:
 *   1. direct unauthorized Server Action POSTs + admin API calls denied
 *      without mutation; authorized equivalents still work;
 *   2. role-aware denial destinations (Engineering ROLE vs engineering
 *      MEMBERSHIP vs everyone else);
 *   3. same-origin/session preservation on 127.0.0.1 without login bounce;
 *   4. anonymous denial + authorized-admin page access.
 *
 * Persona/record contract (the seeder and the DB evidence lock the same ids):
 * - user-admin: the ONLY persona authorized for admin actions/pages.
 * - user-admin-standby: signs in while ACTIVE (real credentials flow), then
 *   is deactivated through the real admin UI by user-admin — an app-driven
 *   "session issued while active, denied once inactive" admin. requireAdmin
 *   re-checks the database role/isActive on every request, so replaying
 *   guarded actions from this context must deny.
 * - user-engineering (engineering ROLE, engineering unit assignment):
 *   /admin/* denial must land on /engineering.
 * - user-general (general_dept ROLE, non-engineering unit): lands on /requests.
 * - user-eng-member-general (general_dept ROLE, ENGINEERING unit assignment):
 *   engineering MEMBERSHIP without the engineering role must still land on
 *   /requests — role, not membership, decides.
 * - user-target: disposable target of the authorized user controls
 *   (deactivate → activate → reset password).
 * - templates: template-anchor (seeded default, never control-touched),
 *   template-toggle (authorized toggle target), template-default (authorized
 *   setDefault target), template-delete (authorized delete target),
 *   template-guard (NEVER touched by any authorized control — the shared
 *   witness for the setTemplateDefault/deleteTemplate/getTemplate denial
 *   replays, whose mutations are monotonic and always visible in final
 *   state), plus ONE INDEPENDENT toggle witness per unauthorized persona
 *   (ADMIN_DENIAL_TOGGLE_WITNESS_TEMPLATES): toggleTemplateStatus is
 *   self-inverse, so four unauthorized personas toggling ONE shared template
 *   could cancel out and hide a broken guard; one dedicated template per
 *   persona makes every single unauthorized flip visible in final state.
 * - request-archived-guard: archived request used as the REAL id in
 *   unauthorized retention backup/hard-delete posts; it must survive the
 *   whole run untouched (durable non-mutation evidence).
 */

export const ADMIN_SECURITY_FIXTURE_ID = 'admin-http-security-test-only'

export interface AdminFixtureUser {
  id: string
  email: string
  name: string
  role: 'admin' | 'general_dept' | 'engineering'
  isActive: boolean
  /** Optional single active assignment (engineering membership cases). */
  assignment: { id: string; unitId: string; positionId: string } | null
}

export const ADMIN_SECURITY_POSITIONS = {
  staff: 'position-admin-security-staff',
} as const

export const ADMIN_SECURITY_UNITS = {
  company: 'unit-admin-security-company',
  general: 'unit-admin-security-general',
  engineering: 'unit-admin-security-engineering',
} as const

export interface AdminFixtureTemplate {
  id: string
  name: string
  title: string
  description: string
  isDefault: boolean
  isActive: boolean
}

export interface AdminFixtureRequest {
  id: string
  title: string
  description: string
  requesterId: string
  organizationUnitId: string
}

export interface AdminSecurityFixture {
  id: typeof ADMIN_SECURITY_FIXTURE_ID
  users: readonly AdminFixtureUser[]
  templates: readonly AdminFixtureTemplate[]
  request: AdminFixtureRequest
}

const user = (
  id: string,
  name: string,
  role: AdminFixtureUser['role'],
  isActive = true,
  assignment: AdminFixtureUser['assignment'] = null,
): AdminFixtureUser => ({
  id,
  email: `${id}@admin-security.test`,
  name,
  role,
  isActive,
  assignment,
})

/**
 * Unauthorized personas whose denial replays reach the admin guard (the
 * anonymous persona is redirected by middleware before any action executes,
 * so it needs no witness). Keys are the canonical persona labels the spec's
 * denialPersonas use; values are the dedicated toggle-witness template ids.
 */
export const ADMIN_DENIAL_TOGGLE_WITNESS_TEMPLATES = {
  'general-dept': 'template-toggle-guard-general-dept',
  'engineering-role': 'template-toggle-guard-engineering-role',
  'engineering-member': 'template-toggle-guard-engineering-member',
  'inactive-admin': 'template-toggle-guard-inactive-admin',
} as const

export type AdminDenialPersonaKey = keyof typeof ADMIN_DENIAL_TOGGLE_WITNESS_TEMPLATES

/**
 * Row-selection semantics shared by the admin templates-page row locators in
 * tests/admin-e2e/admin-http-security.spec.ts (authorized visibility, toggle
 * control, final read-back) and locked by
 * tests/regression/admin-security-fixture.test.ts: a row is selected by its
 * EXACT Internal Name, never by substring — every template-toggle-guard-*
 * witness name CONTAINS the template-toggle control target, so substring row
 * matching selects five rows and trips Playwright strict mode (Astra harness
 * repair review P1).
 */
export function adminTemplateRowMatchesInternalName(
  template: AdminFixtureTemplate,
  internalName: string,
): boolean {
  return template.name === internalName
}

/**
 * Non-status text rendered inside one desktop templates-table row (the
 * Internal Name, display-name, and description cells of
 * src/components/admin/template-table.tsx). Shared by
 * tests/regression/admin-security-fixture.test.ts to lock the spec's
 * in-row status assertion (final read-back): the status pill must be
 * matched EXACTLY, because every template-toggle-guard-inactive-admin
 * witness name/title/description contains "inactive" and therefore also
 * substring-matches 'Active'/'Inactive' (browser strict-mode violation on
 * row.getByText). Exact matching stays unambiguous only while no
 * non-status row text ever equals a status word.
 */
export function adminTemplateRowNonStatusText(template: AdminFixtureTemplate): readonly string[] {
  return [template.name, template.title, template.description]
}

/** Every sensitive fixture marker that must NEVER appear in a denial body. */
export function adminSensitiveLeakMarkers(
  fixture: AdminSecurityFixture,
): Array<{ marker: string; kind: 'user-email' | 'template' | 'request' }> {
  const markers: Array<{ marker: string; kind: 'user-email' | 'template' | 'request' }> = []
  for (const user of fixture.users) {
    markers.push({ marker: user.email, kind: 'user-email' })
  }
  for (const template of fixture.templates) {
    markers.push({ marker: template.id, kind: 'template' })
    markers.push({ marker: template.name, kind: 'template' })
    markers.push({ marker: template.title, kind: 'template' })
    markers.push({ marker: template.description, kind: 'template' })
  }
  markers.push({ marker: fixture.request.id, kind: 'request' })
  markers.push({ marker: fixture.request.title, kind: 'request' })
  markers.push({ marker: fixture.request.description, kind: 'request' })
  return markers
}

export function createAdminSecurityFixture(): AdminSecurityFixture {
  const staff = ADMIN_SECURITY_POSITIONS.staff
  const users: AdminFixtureUser[] = [
    user('user-admin', 'Primary Admin', 'admin'),
    user('user-admin-standby', 'Standby Admin', 'admin'),
    user('user-engineering', 'Engineering Role User', 'engineering', true, {
      id: 'assignment-admin-security-engineering',
      unitId: ADMIN_SECURITY_UNITS.engineering,
      positionId: staff,
    }),
    user('user-general', 'General Role User', 'general_dept', true, {
      id: 'assignment-admin-security-general',
      unitId: ADMIN_SECURITY_UNITS.general,
      positionId: staff,
    }),
    user('user-eng-member-general', 'Engineering Member General Role', 'general_dept', true, {
      id: 'assignment-admin-security-eng-member',
      unitId: ADMIN_SECURITY_UNITS.engineering,
      positionId: staff,
    }),
    user('user-target', 'Disposable Target User', 'general_dept'),
  ]
  const templates: AdminFixtureTemplate[] = [
    {
      id: 'template-anchor',
      // Internal Name doubles as the UI row locator: the admin templates
      // table renders `name`, and the spec targets rows by these ids.
      name: 'template-anchor',
      title: 'Anchor template',
      description: '<p>Seeded default; never touched by authorized controls.</p>',
      isDefault: true,
      isActive: true,
    },
    {
      id: 'template-toggle',
      name: 'template-toggle',
      title: 'Toggle target template',
      description: '<p>Authorized toggleTemplateStatus target.</p>',
      isDefault: false,
      isActive: true,
    },
    {
      id: 'template-default',
      name: 'template-default',
      title: 'Default target template',
      description: '<p>Authorized setTemplateDefault target.</p>',
      isDefault: false,
      isActive: true,
    },
    {
      id: 'template-delete',
      name: 'template-delete',
      title: 'Delete target template',
      description: '<p>Authorized deleteTemplate target.</p>',
      isDefault: false,
      isActive: true,
    },
    {
      id: 'template-guard',
      name: 'template-guard',
      title: 'Guard template',
      description: '<p>Never touched by authorized controls; denial replays target it.</p>',
      isDefault: false,
      isActive: true,
    },
    // One independent toggleTemplateStatus denial witness per unauthorized
    // persona (see ADMIN_DENIAL_TOGGLE_WITNESS_TEMPLATES): seeded active and
    // non-default, never touched by any authorized control.
    ...Object.entries(ADMIN_DENIAL_TOGGLE_WITNESS_TEMPLATES).map(([persona, id]) => ({
      id,
      name: id,
      title: `Toggle witness (${persona})`,
      description: `<p>Independent toggle denial witness for ${persona}; never touched by authorized controls.</p>`,
      isDefault: false,
      isActive: true,
    })),
  ]
  return {
    id: ADMIN_SECURITY_FIXTURE_ID,
    users,
    templates,
    request: {
      id: 'request-archived-guard',
      title: 'Admin security archived guard request',
      description: '<p>Archived fixture request; unauthorized retention calls must never touch it.</p>',
      requesterId: 'user-target',
      organizationUnitId: ADMIN_SECURITY_UNITS.general,
    },
  }
}

/** Actor emails keyed by persona name (mirrors BUSINESS_ACTOR_EMAILS). */
export function adminActorEmails(fixture: AdminSecurityFixture): Record<string, string> {
  const emails: Record<string, string> = {}
  for (const actor of fixture.users) emails[actor.id] = actor.email
  return emails
}

/** Final-state expectations after the authorized controls and denial replays. */
export interface ExpectedTemplateState {
  id: string
  present: boolean
  isActive: boolean
  isDefault: boolean
}

export function expectedFinalTemplateStates(): readonly ExpectedTemplateState[] {
  // Authorized controls run exactly once each:
  //   toggleTemplateStatus(template-toggle)  -> isActive false
  //   setTemplateDefault(template-default)   -> the ONLY default afterwards
  //   deleteTemplate(template-delete)        -> row absent
  // Denial replays (all personas) must change nothing; template-guard stays
  // exactly as seeded, and every per-persona toggle witness stays active —
  // the strongest non-mutation witness for the template actions (a witness
  // flipped by an unauthorized toggleTemplateStatus replay fails its check).
  return [
    { id: 'template-anchor', present: true, isActive: true, isDefault: false },
    { id: 'template-toggle', present: true, isActive: false, isDefault: false },
    { id: 'template-default', present: true, isActive: true, isDefault: true },
    { id: 'template-delete', present: false, isActive: false, isDefault: false },
    { id: 'template-guard', present: true, isActive: true, isDefault: false },
    ...Object.values(ADMIN_DENIAL_TOGGLE_WITNESS_TEMPLATES).map((id) => ({
      id,
      present: true,
      isActive: true,
      isDefault: false,
    })),
  ]
}
