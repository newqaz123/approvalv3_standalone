import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ADMIN_GUARDED_ACTION_EXPORTS } from '../support/admin-security/admin-action-wire'
import {
  ADMIN_DENIAL_TOGGLE_WITNESS_TEMPLATES,
  adminSensitiveLeakMarkers,
  adminTemplateRowMatchesInternalName,
  adminTemplateRowNonStatusText,
  createAdminSecurityFixture,
  expectedFinalTemplateStates,
} from '../support/admin-security/admin-security-fixture'

/**
 * Regression (Astra admin-harness review, findings 4 and 5): the fixture is
 * the shared contract between the spec (denial replays), the seeder, and the
 * runner's DB evidence. Locks:
 *
 *  (P1) every admin templates-page row locator key selects EXACTLY ONE row
 *      over the COMPLETE fixture (base templates plus all four
 *      template-toggle-guard-* witnesses): every witness name CONTAINS the
 *      template-toggle control target, so substring row matching selects
 *      five rows and trips Playwright strict mode before any coverage runs
 *      (Astra harness repair review P1). Row selection must stay an exact
 *      Internal Name match (adminTemplateRowMatchesInternalName).
 *  (5) one INDEPENDENT toggleTemplateStatus witness per unauthorized
 *      persona, so repeated unauthorized toggles can never cancel out and
 *      hide a broken guard; every witness is seeded, never touched by
 *      authorized controls, and evaluated in the final-state evidence.
 *  (4) the sensitive-leak marker set used by EVERY unauthorized persona's
 *      read-body checks: fixture emails, template identifiers AND content,
 *      request identifiers and content.
 */

describe('admin-security fixture: independent per-persona toggle witnesses', () => {
  const fixture = createAdminSecurityFixture()

  it('defines exactly one distinct witness per unauthorized persona', () => {
    const entries = Object.entries(ADMIN_DENIAL_TOGGLE_WITNESS_TEMPLATES)
    assert.equal(entries.length, 4)
    assert.deepEqual(
      entries.map(([persona]) => persona).sort(),
      ['engineering-member', 'engineering-role', 'general-dept', 'inactive-admin']
    )
    const ids = entries.map(([, id]) => id)
    assert.equal(new Set(ids).size, ids.length, 'witness template ids must be distinct')
  })

  it('seeds every witness (active, non-default) and expects it untouched at the end', () => {
    for (const templateId of Object.values(ADMIN_DENIAL_TOGGLE_WITNESS_TEMPLATES)) {
      const seeded = fixture.templates.find((t) => t.id === templateId)
      assert.ok(seeded, `${templateId} must be seeded`)
      assert.equal(seeded.isActive, true)
      assert.equal(seeded.isDefault, false)
      const expected = expectedFinalTemplateStates().find((t) => t.id === templateId)
      assert.deepEqual(
        expected,
        { id: templateId, present: true, isActive: true, isDefault: false },
        `${templateId} must be expected present/active/non-default in final state`
      )
    }
  })

  it('witness ids are not confusable with the shared template-guard marker', () => {
    for (const templateId of Object.values(ADMIN_DENIAL_TOGGLE_WITNESS_TEMPLATES)) {
      assert.ok(
        !templateId.includes('template-guard'),
        `${templateId} must not contain the template-guard marker substring`
      )
    }
  })

  it('every guarded action the personas replay has a real denial target in the fixture', () => {
    const templateIds = new Set(fixture.templates.map((t) => t.id))
    const userIds = new Set(fixture.users.map((u) => u.id))
    for (const templateId of Object.values(ADMIN_DENIAL_TOGGLE_WITNESS_TEMPLATES)) {
      assert.ok(templateIds.has(templateId))
    }
    assert.ok(templateIds.has('template-guard'))
    assert.ok(userIds.has('user-eng-member-general'))
    assert.ok(userIds.has('user-admin-standby'))
    assert.equal(ADMIN_GUARDED_ACTION_EXPORTS.length, 10)
  })
})

describe('admin-security fixture: exact Internal Name row selection (harness repair P1)', () => {
  const fixture = createAdminSecurityFixture()

  it('every row-locator key selects exactly one row over the COMPLETE fixture, retaining its intended target', () => {
    // Complete fixture = the base five templates PLUS all four
    // template-toggle-guard-* witness rows the admin templates table
    // renders. The keys cover every locator site of the spec: the authorized
    // visibility loop (fixture.templates names), the three authorized
    // control targets, and every final read-back id.
    const locatorKeys = new Set<string>([
      ...fixture.templates.map((t) => t.name),
      ...expectedFinalTemplateStates().map((expected) => expected.id),
      'template-toggle',
      'template-default',
      'template-delete',
    ])
    assert.ok(locatorKeys.size >= 9, 'the complete fixture (base templates + four witnesses) must be covered')
    for (const key of locatorKeys) {
      const selected = fixture.templates.filter((template) => adminTemplateRowMatchesInternalName(template, key))
      assert.equal(
        selected.length,
        1,
        `row-locator key ${JSON.stringify(key)} must select exactly one row over the complete fixture, got ${selected.length}: [${selected.map((t) => t.name).join(', ')}]`
      )
      assert.equal(
        selected[0].name,
        key,
        `row-locator key ${JSON.stringify(key)} must retain its intended target row`
      )
    }
  })

  it('keeps all four template-toggle-guard-* rows in the complete fixture, making substring matching provably ambiguous', () => {
    const witnesses = Object.values(ADMIN_DENIAL_TOGGLE_WITNESS_TEMPLATES)
    assert.equal(witnesses.length, 4)
    for (const witness of witnesses) {
      assert.ok(fixture.templates.some((t) => t.name === witness), `${witness} must be a seeded row of the complete fixture`)
    }
    // Substring semantics — what the spec's row locators used before the
    // exact Internal Name fix — select five rows for the toggle control
    // target. The collision is part of the contract (witnesses must stay
    // named after their persona), so row selection must survive it.
    assert.equal(
      fixture.templates.filter((t) => t.name.includes('template-toggle')).length,
      5,
      'complete fixture must keep template-toggle plus all four witnesses (the substring ambiguity the exact match must survive)'
    )
  })
})

describe('admin-security fixture: exact in-row status text (templates final read-back)', () => {
  const fixture = createAdminSecurityFixture()

  it('inactive-admin witness name/content collides with substring status matching, so the spec must match the status text exactly', () => {
    // What the spec's final read-back used before the exactness fix:
    // row.getByText('Active') WITHOUT { exact: true } matches
    // case-insensitive substrings, so the correctly selected
    // template-toggle-guard-inactive-admin row matched FOUR elements
    // (Internal Name cell, display-name cell, description div, status
    // pill) and tripped browser strict mode before visibility could pass.
    const witness = fixture.templates.find((t) => t.name === 'template-toggle-guard-inactive-admin')
    assert.ok(witness, 'inactive-admin witness must be seeded')
    const nonStatusText = adminTemplateRowNonStatusText(witness)
    const colliding = nonStatusText.filter((text) => text.toLowerCase().includes('active'))
    assert.deepEqual(
      colliding,
      nonStatusText,
      'name, title, and description must all substring-match "active" — the Active vs Inactive/name-content collision the exact status match must survive'
    )
  })

  it('no non-status row text equals a status word for any final read-back row, keeping exact matching unambiguous', () => {
    // The status pill is the only element of a desktop templates-table row
    // whose EXACT text is 'Active'/'Inactive'. That holds only while no
    // name/title/description ever equals a status word — lock it over the
    // COMPLETE final read-back set (absent rows excluded: no row, no
    // status assertion).
    for (const expected of expectedFinalTemplateStates()) {
      if (!expected.present) continue
      const template = fixture.templates.find((t) => t.id === expected.id)
      assert.ok(template, `${expected.id} must be seeded`)
      for (const text of adminTemplateRowNonStatusText(template)) {
        assert.ok(
          text !== 'Active' && text !== 'Inactive',
          `non-status text of ${expected.id} must never equal a status word (would break the exact status match): ${JSON.stringify(text)}`
        )
      }
    }
  })
})

describe('admin-security fixture: sensitive leak markers (finding 4)', () => {
  const fixture = createAdminSecurityFixture()
  const markers = adminSensitiveLeakMarkers(fixture)

  it('covers every fixture user email', () => {
    for (const user of fixture.users) {
      assert.ok(
        markers.some((m) => m.marker === user.email && m.kind === 'user-email'),
        `${user.email} must be a leak marker`
      )
    }
  })

  it('covers every template identifier and content field', () => {
    for (const template of fixture.templates) {
      for (const field of [template.id, template.name, template.title, template.description]) {
        assert.ok(
          markers.some((m) => m.marker === field && m.kind === 'template'),
          `template field ${JSON.stringify(field)} must be a leak marker`
        )
      }
    }
  })

  it('covers the archived guard request identifiers and content', () => {
    for (const field of [fixture.request.id, fixture.request.title, fixture.request.description]) {
      assert.ok(
        markers.some((m) => m.marker === field && m.kind === 'request'),
        `request field ${JSON.stringify(field)} must be a leak marker`
      )
    }
  })

  it('marker values cannot false-positive on the guard error signatures', () => {
    // name === id for every template by fixture design (the admin UI rows
    // are located by name), so raw entries repeat — dedupe before use.
    const values = [...new Set(markers.map((m) => m.marker))]
    for (const spec of ADMIN_GUARDED_ACTION_EXPORTS) {
      for (const marker of values) {
        assert.ok(
          !spec.guardMessage.includes(marker),
          `guard message ${JSON.stringify(spec.guardMessage)} must not contain marker ${JSON.stringify(marker)} (denial bodies carry the guard signature)`
        )
      }
    }
  })
})
