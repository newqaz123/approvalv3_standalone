import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import ts from 'typescript'
import { REQUEST_ACTIONS, evaluateRequestAction, type ActionPermissionContext, type ActionDecision } from '@/lib/action-permissions'

// The policy consumes activity and guard evidence, not a legacy identity role.
function context(over: {
  active?: boolean
  visible?: boolean
  canApprove?: boolean
  decisions?: ActionPermissionContext['existingActionDecisions']
} = {}) {
  return {
    actor: { id: 'person', isActive: over.active ?? true, assignmentUnitId: 'unit' },
    request: { requesterId: 'requester', organizationUnitId: 'unit', status: 'SentToEngineer' },
    canView: over.visible ?? true,
    approval: { canApprove: over.canApprove ?? false },
    assignedEngineer: false,
    existingActionDecisions: over.decisions ?? {},
  }
}

const allowed: ActionDecision = { allowed: true, reason: 'ALLOWED' }
const denied: ActionDecision = { allowed: false, reason: 'NOT_OWNER' }
const currentStepActions = new Set(['APPROVE_REQUEST', 'REJECT_REQUEST', 'APPROVE_SOLUTION', 'REJECT_SOLUTION', 'APPROVE_FINAL', 'REJECT_FINAL'])

describe('role-free request action context', () => {
  it('keeps activity, visibility, evidence and current-step denials identical for every action', () => {
    for (const action of REQUEST_ACTIONS) {
      const decisions = { [action]: allowed }
      assert.deepEqual(evaluateRequestAction(action, context({ active: false, decisions })), { allowed: false, reason: 'INACTIVE' })
      assert.deepEqual(evaluateRequestAction(action, context({ visible: false, decisions })), { allowed: false, reason: 'NOT_VISIBLE' })
      assert.deepEqual(evaluateRequestAction(action, context()), { allowed: false, reason: 'WRONG_ROLE' })
      assert.deepEqual(evaluateRequestAction(action, context({ canApprove: true, decisions: { [action]: denied } })), denied)
      assert.deepEqual(evaluateRequestAction(action, context({ canApprove: true, decisions })), allowed)
      assert.deepEqual(evaluateRequestAction(action, context({ decisions })), currentStepActions.has(action)
        ? { allowed: false, reason: 'NOT_PENDING_APPROVAL' } : allowed)
    }
  })

  it('cannot grant or remove action evidence through legacy role payloads', () => {
    for (const action of REQUEST_ACTIONS) for (const role of ['admin', 'engineering', 'general_dept', 'unexpected']) {
      const base = context({ decisions: { [action]: allowed } })
      const legacy = { ...base, actor: { ...base.actor, role } }
      assert.deepEqual(evaluateRequestAction(action, legacy), currentStepActions.has(action)
        ? { allowed: false, reason: 'NOT_PENDING_APPROVAL' } : allowed)
      assert.deepEqual(evaluateRequestAction(action, { ...legacy, existingActionDecisions: {} }), { allowed: false, reason: 'WRONG_ROLE' })
    }
  })

  it('does not require or forward an unused actor role', () => {
    const source = readFileSync('src/lib/action-permissions.ts', 'utf8')
    const file = ts.createSourceFile('action-permissions.ts', source, ts.ScriptTarget.Latest, true)
    const declaration = file.statements.find((node): node is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(node) && node.name.text === 'ActionPermissionContext')
    assert.ok(declaration)
    const actor = declaration.members.find(node => ts.isPropertySignature(node) && node.name.getText(file) === 'actor') as ts.PropertySignature
    assert.ok(actor.type && ts.isTypeLiteralNode(actor.type))
    assert.deepEqual(actor.type.members.map(node => node.name?.getText(file)), ['id', 'isActive', 'assignmentUnitId'])
  })

  it('removes the router-only department lookup while preserving navigation eligibility', () => {
    const router = readFileSync('src/components/requests/request-modal-router.tsx', 'utf8')
    assert.doesNotMatch(router, /userDepartmentType|userDepartmentId|fetch\("\/api\/user\/department"\)/)
    for (const path of ['src/components/navigation/navbar.tsx', 'src/components/mobile/mobile-nav.tsx']) {
      const navigation = readFileSync(path, 'utf8')
      assert.match(navigation, /\/api\/user\/department/)
      assert.match(navigation, /canWorkOnSolutions/)
    }
  })
})
