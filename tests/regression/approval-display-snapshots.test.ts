import assert from 'node:assert/strict'
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
