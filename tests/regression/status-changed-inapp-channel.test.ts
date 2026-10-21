import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as ts from 'typescript'

/**
 * SOURCE CONTRACT — NOT BEHAVIORAL (Task45, owner decision 2026-09-25).
 *
 * status_changed is an IN-APP ONLY channel: `notifyRequestStatusChange`
 * (src/server-actions/approvals.ts) persists the requester's row with a raw
 * `prisma.notifications.create` and never enters the email path
 * (`createNotification` in server-actions/notifications.ts is what email
 * dispatches). The owner decided to PRESERVE that product channel policy, so
 * this test pins the seam at the source level:
 *
 *  - This file does NOT execute the function (it is module-private and
 *    exporting it would be a product change). It is a source contract.
 *  - Behavioral proof is the COMBINATION of (a) the existing live-browser
 *    T12 segment `notification-status-changed-requester`
 *    (tests/business-e2e/business-notifications.spec.ts) proving the
 *    requester's bell row persists and renders, and (b) the T13 runner-owned
 *    capture negative `Business T12A/status-changed-in-app-only-no-email`
 *    (capture-workflow-mail-evidence.ts) proving no email is dispatched for
 *    the correlated request in the real run.
 *
 * Production change this catches: routing this seam through
 * `createNotification`/`sendEmailNotification` (or any other email producer)
 * without an explicit owner-approved channel-policy change — both this
 * contract and the capture negative would fail loudly.
 */

const FORBIDDEN_EMAIL_CALLS = new Set([
  'createNotification',
  'notifyUser',
  'notifyUsersInDepartment',
  'sendEmailNotification',
  'notifyNextApprover',
  'notifyNextSolutionApprover',
  'notifyNextFinalApprover',
])

function loadNotifyRequestStatusChange() {
  const filePath = resolve(process.cwd(), 'src/server-actions/approvals.ts')
  const sourceText = readFileSync(filePath, 'utf8')
  const source = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let fn: ts.FunctionDeclaration | null = null
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'notifyRequestStatusChange') fn = node
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(fn, 'notifyRequestStatusChange must exist in src/server-actions/approvals.ts')
  return { source, fn: fn as ts.FunctionDeclaration }
}

function callName(expression: ts.LeftHandSideExpression): string | null {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  return null
}

function collectCalls(fn: ts.FunctionDeclaration): ts.CallExpression[] {
  const calls: ts.CallExpression[] = []
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) calls.push(node)
    ts.forEachChild(node, visit)
  }
  visit(fn)
  return calls
}

function stringPropertyValue(obj: ts.ObjectLiteralExpression, key: string): ts.Expression | null {
  for (const property of obj.properties) {
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === key) {
      return property.name
    }
    if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === key) {
      return property.initializer
    }
  }
  return null
}

describe('status_changed notification channel (source contract, not behavioral)', () => {
  it('persists the requester row through raw prisma.notifications.create with the exact in-app payload', () => {
    const { source, fn } = loadNotifyRequestStatusChange()
    const createCalls = collectCalls(fn).filter(
      (call) => callName(call.expression) === 'create' && ts.isPropertyAccessExpression(call.expression) &&
        ts.isPropertyAccessExpression(call.expression.expression) &&
        call.expression.expression.name.text === 'notifications',
    )
    assert.equal(createCalls.length, 1, 'exactly one prisma.notifications.create call writes the row')
    const arg = createCalls[0]?.arguments[0]
    assert.ok(arg && ts.isObjectLiteralExpression(arg), 'create takes an object literal argument')
    const data = stringPropertyValue(arg, 'data')
    assert.ok(data && ts.isObjectLiteralExpression(data), 'the argument carries a data object literal')
    const type = stringPropertyValue(data, 'type')
    assert.ok(type && ts.isStringLiteral(type) && type.text === 'status_changed')
    const title = stringPropertyValue(data, 'title')
    assert.ok(title && ts.isStringLiteral(title) && title.text === 'Request Status Changed')
    const message = stringPropertyValue(data, 'message')
    assert.ok(
      message && ts.isTemplateExpression(message) &&
        message.head.text === 'Your request status changed to ' &&
        ts.isPropertyAccessExpression(message.templateSpans[0]?.expression) &&
        message.templateSpans[0]?.expression.name.text === 'toStatus',
      'message template matches the T12 bell-visible wording "Your request status changed to <toStatus>"',
    )
    assert.ok(stringPropertyValue(data, 'userId'), 'the row targets a userId (the requester recipient)')
    assert.ok(stringPropertyValue(data, 'requestId'), 'the row links its requestId')
    void source
  })

  it('maps recipients through mapEventRecipients with type status_changed (requester only)', () => {
    const { fn } = loadNotifyRequestStatusChange()
    const mapCalls = collectCalls(fn).filter((call) => callName(call.expression) === 'mapEventRecipients')
    assert.equal(mapCalls.length, 1, 'recipients come from the participants-only policy seam')
    const arg = mapCalls[0]?.arguments[0]
    assert.ok(arg && ts.isObjectLiteralExpression(arg))
    const type = stringPropertyValue(arg, 'type')
    assert.ok(type && ts.isStringLiteral(type) && type.text === 'status_changed')
    const requesterId = stringPropertyValue(arg, 'requesterId')
    assert.ok(
      requesterId && ts.isPropertyAccessExpression(requesterId) && requesterId.name.text === 'requesterId',
      'the requester id is the change row requester',
    )
  })

  it('never calls an email-dispatching helper — in-app only (owner decision 2026-09-25)', () => {
    const { fn } = loadNotifyRequestStatusChange()
    const offenders = collectCalls(fn)
      .map((call) => callName(call.expression))
      .filter((name): name is string => name != null && FORBIDDEN_EMAIL_CALLS.has(name))
    assert.deepEqual(offenders, [], 'no email producer may be reachable from notifyRequestStatusChange')
  })
})
