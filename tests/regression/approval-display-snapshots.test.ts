import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { withApprovalDisplay } from '../../src/lib/approval-display'
import { transformRequestToModalData } from '../../src/lib/modal-data-adapters'

const date = new Date('2026-10-08T14:00:00Z')
const approval = (id: string, order: number, name: string, position: string, rank: number) => ({
  id, order, status: 'pending', createdAt: date, isFinalApproval: false,
  routingMode: 'SNAPSHOT_GROUP', requiredPositionRef: { name: position, rank },
  candidateGroup: { members: [{ userId: id, capturedDisplayName: name }] },
})
const request = (approvals: ReturnType<typeof withApprovalDisplay>[]) => ({
  id: 'request-pd1', title: 'PD1 request', description: 'Test', status: 'ImprovementRequest',
  createdAt: date, updatedAt: date,
  requester: { id: 'h1-staff1', name: 'H1 Staff 1', email: 'h1-staff1@demo.test' },
  fileAttachments: [], activities: [], approvals: approvals as any,
})

test('pending snapshot approvals display captured candidates and named positions in the real modal adapter', () => {
  const rows = [
    approval('sup', 1, 'H1 Supervisor', 'Supervisor', 2),
    approval('sec', 2, 'PD1 Section Manager', 'Section Manager', 3),
    approval('dept', 3, 'Production Department Manager', 'Department Manager', 4),
  ].map(withApprovalDisplay)
  const steps = transformRequestToModalData(request(rows)).stages[0].steps
  assert.deepEqual(steps.map(step => step.name), ['H1 Supervisor', 'PD1 Section Manager', 'Production Department Manager'])
  assert.deepEqual(steps.map(step => step.role), ['Supervisor', 'Section Manager', 'Department Manager'])
})

test('any-one display retains all saved candidates, not a current organization lookup', () => {
  const row = withApprovalDisplay({ ...approval('sup', 1, 'Saved Supervisor A', 'Supervisor', 2),
    candidateGroup: { members: [
      { userId: 'a', capturedDisplayName: 'Saved Supervisor A' },
      { userId: 'b', capturedDisplayName: 'Saved Supervisor B' },
    ] },
  })
  assert.equal(transformRequestToModalData(request([row])).stages[0].steps[0].name, 'Saved Supervisor A or Saved Supervisor B')
})

test('decided snapshot approval displays the actual actor ahead of the saved pool', () => {
  const row = withApprovalDisplay({ ...approval('sup', 1, 'Saved Supervisor', 'Supervisor', 2),
    status: 'approved', approver: { name: 'Actual Approver', email: 'actual@demo.test' },
  })
  assert.equal(transformRequestToModalData(request([row])).stages[0].steps[0].name, 'Actual Approver')
})

test('custom-person display keeps the required person and ordered custom role', () => {
  const row = withApprovalDisplay({ id: 'custom', order: 1, status: 'pending', createdAt: date,
    isFinalApproval: false, routingMode: 'CUSTOM_PERSON', requiredPositionRef: null, candidateGroup: null,
    requiredApprover: { name: 'Cross-check Person' },
  })
  const step = transformRequestToModalData(request([row])).stages[0].steps[0]
  assert.equal(step.name, 'Cross-check Person')
  assert.equal(step.role, 'Custom Level 1')
})

// Business flow test finding: after a Section manager rejection and a
// resubmit, the Approval Flow drew the superseded attempt next to the new
// one, so every step appeared twice.
test('approval flow shows only the current attempt after a rejected request is resubmitted', () => {
  const superseded = { instanceId: 'attempt-1', instance: { supersededAt: date } }
  const current = { instanceId: 'attempt-2', instance: { supersededAt: null } }
  const rows = [
    { ...approval('old-sup', 1, 'H1 Supervisor', 'Supervisor', 2), ...superseded, status: 'approved' },
    { ...approval('old-sec', 2, 'PD1 Section Manager', 'Section Manager', 3), ...superseded, status: 'rejected', comments: 'test reject' },
    { ...approval('old-dept', 3, 'Production Department Manager', 'Department Manager', 4), ...superseded, status: 'rejected' },
    { ...approval('new-sup', 1, 'H1 Supervisor', 'Supervisor', 2), ...current },
    { ...approval('new-sec', 2, 'PD1 Section Manager', 'Section Manager', 3), ...current },
    { ...approval('new-dept', 3, 'Production Department Manager', 'Department Manager', 4), ...current },
  ].map(withApprovalDisplay)
  const steps = transformRequestToModalData(request(rows)).stages[0].steps
  assert.deepEqual(steps.map(step => step.id), ['new-sup', 'new-sec', 'new-dept'])
  assert.deepEqual(steps.map(step => step.status), ['pending', 'pending', 'pending'])
})

test('approval flow keeps a rejected attempt visible until it is resubmitted', () => {
  const current = { instanceId: 'attempt-1', instance: { supersededAt: null } }
  const rows = [
    { ...approval('sup', 1, 'H1 Supervisor', 'Supervisor', 2), ...current, status: 'approved' },
    { ...approval('sec', 2, 'PD1 Section Manager', 'Section Manager', 3), ...current, status: 'rejected', comments: 'test reject',
      approver: { name: 'PD1 Section Manager', email: 'sec@demo.test' }, approvedAt: date },
  ].map(withApprovalDisplay)
  const steps = transformRequestToModalData(request(rows)).stages[0].steps
  assert.deepEqual(steps.map(step => step.status), ['approved', 'rejected'])
  assert.equal(steps[1].comment, 'test reject')
})

// Business flow test finding: when one approver rejects, the engine closes the
// later steps as "rejected" too. Those people never acted, so the flow must
// not put "Rejected" under their names.
test('a step closed by an earlier rejection is shown as not reached, not rejected', () => {
  const rows = [
    { ...approval('sup', 1, 'H1 Supervisor', 'Supervisor', 2), status: 'approved',
      approver: { name: 'H1 Supervisor', email: 'sup@demo.test' }, approvedAt: date },
    { ...approval('sec', 2, 'PD1 Section Manager', 'Section Manager', 3), status: 'rejected', comments: 'reject',
      approver: { name: 'PD1 Section Manager', email: 'sec@demo.test' }, approvedAt: date },
    { ...approval('dept', 3, 'Production Department Manager', 'Department Manager', 4), status: 'rejected' },
  ].map(withApprovalDisplay)
  const steps = transformRequestToModalData(request(rows)).stages[0].steps
  assert.deepEqual(steps.map(step => step.status), ['approved', 'rejected', 'not_reached'])
  assert.equal(steps[1].comment, 'reject')
  assert.equal(steps[2].name, 'Production Department Manager')
  assert.equal(steps[2].comment, 'Rejected at an earlier step')
  assert.equal(steps[2].timestamp, '-')
})

test('every request detail modal can draw a not-reached step', () => {
  const modals = [
    'approver-modal', 'solution-modal',
    'final-approval-resubmit-modal', 'submit-final-approval-modal',
    'completed-request-modal', 'completed-solution-modal', 'completed-final-modal',
  ]
  for (const modal of modals) {
    const source = readFileSync(`src/components/requests/${modal}.tsx`, 'utf8')
    assert.match(source, /status: "submitted" \| "approved" \| "pending" \| "rejected" \| "not_reached";/, modal)
    assert.match(source, /not_reached: \{\s*label: "not reached"/i, modal)
  }
})

test('the rejection banner names the person who rejected, not a step that was never reached', () => {
  const rows = [
    { ...approval('dept', 3, 'Production Department Manager', 'Department Manager', 4), status: 'rejected' },
    { ...approval('sec', 2, 'PD1 Section Manager', 'Section Manager', 3), status: 'rejected', comments: 'reject',
      approver: { name: 'PD1 Section Manager', email: 'sec@demo.test' }, approvedAt: date },
  ].map(withApprovalDisplay)
  const rejection = transformRequestToModalData(request(rows)).rejection
  assert.equal(rejection?.rejectedBy, 'PD1 Section Manager')
  assert.equal(rejection?.reason, 'reject')
})
