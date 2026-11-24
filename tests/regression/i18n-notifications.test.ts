import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'
import { notificationDisplayFields, renderNotificationDisplay } from '@/lib/notification-display'
import { runTransactionWithPostCommitNotifications, type UserNotification } from '@/lib/post-commit-notifications'

const requestTitle = 'Request {reason} — ชื่อเดิม'
const solutionTitle = 'Solution {reason} — ชื่อเดิม'
const reason = 'Rework <b>this</b> — เหตุผลเดิม'
const request = { id: 'request-1', title: requestTitle, requesterId: 'requester' }
const english = {
  title: 'Request Rejected',
  message: `❌ Request Rejected: Your request "${requestTitle}" has been rejected. Reason: "${reason}"`,
}

test('notification display renders the same persisted metadata in both locales without reinterpreting values', () => {
  const row = { ...english, ...notificationDisplayFields({ key: 'requestRejected', values: { requestTitle, reason } }) }
  assert.deepEqual(renderNotificationDisplay('en', row), english)
  assert.deepEqual(renderNotificationDisplay('th', row), {
    title: 'ไม่อนุมัติ Request',
    message: `❌ ไม่อนุมัติ Request "${requestTitle}" เหตุผล: "${reason}"`,
  })
})

test('legacy, unknown, incomplete and malformed metadata keep the exact stored pair', () => {
  for (const [displayKey, displayValues] of [
    [null, null], ['unknown', { requestTitle, reason }], ['constructor', { requestTitle, reason }],
    ['requestRejected', null], ['requestRejected', []], ['requestRejected', { requestTitle }],
    ['requestRejected', { requestTitle, reason: 42 }],
    ['requestRejected', Object.create({ requestTitle, reason })],
  ] as const) {
    for (const locale of ['en', 'th'] as const) {
      assert.deepEqual(renderNotificationDisplay(locale, { ...english, displayKey, displayValues }), english)
    }
  }
})

type DisplayRow = Parameters<typeof renderNotificationDisplay>[1]
type ProducerPayload = Pick<UserNotification, 'type' | 'title' | 'message' | 'requestId'> & Record<string, unknown>
type ActionFile = 'approvals' | 'notifications' | 'requests' | 'solutions'
function actionFunction(file: ActionFile, name: string) {
  const path = `src/server-actions/${file}.ts`
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
  assert.ok(declaration, `${path}: ${name}`)
  return declaration
}

function execute<T>(code: string, context: Record<string, unknown>) {
  return new Function(...Object.keys(context), code)(...Object.values(context)) as T
}

function executeAction<T>(file: ActionFile, name: string, context: Record<string, unknown>) {
  const declaration = actionFunction(file, name).getText().replace(/^export /, '')
  const { outputText } = ts.transpileModule(declaration, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } })
  return execute<T>(`${outputText}\nreturn ${name};`, context)
}

// Read the actual writer payloads, not a second implementation of the branching logic.
function producerPayloads(file: ActionFile, name: string, context: Record<string, unknown> = {}) {
  const payloads: ProducerPayload[] = []
  function walk(node: ts.Node) {
    if (ts.isObjectLiteralExpression(node)) {
      const names = node.properties.map(property => property.name?.getText())
      if (['type', 'title', 'message', 'requestId'].every(key => names.includes(key))) {
        payloads.push(execute(`return (${node.getText()});`, {
          request, requestId: request.id, userId: 'recipient', recipientId: 'recipient',
          currentStepId: 'recipient', orderedApprovers: ['recipient'], comments: reason,
          rejectedRequest: request, change: { toStatus: 'SentToEngineer' },
          validated: { requestId: request.id }, solution: { requestId: request.id },
          solutionData: { title: solutionTitle },
          nextApproval: { request, solution: { title: solutionTitle, requestId: request.id }, isFinalApproval: false },
          notificationDisplayFields,
          ...context,
        }))
      }
    }
    ts.forEachChild(node, walk)
  }
  walk(actionFunction(file, name))
  return payloads
}

function makeWriter(stored: DisplayRow[], mail: unknown[]) {
  return executeAction<(notification: UserNotification) => Promise<unknown>>('notifications', 'createNotification', {
    notificationDisplayFields,
    prisma: {
      notifications: { create: async ({ data }: { data: DisplayRow }) => { stored.push(data); return data } },
      user: { findUnique: async () => ({ email: 'fixture@example.invalid' }) },
    },
    sendEmailNotification: async (data: unknown, email: string) => { mail.push({ data, email }) },
  })
}

const requestValues = { requestTitle }
const solutionValues = { solutionTitle }
const producers = [
  ['requests', 'createRequest', [['requestSubmitted', requestValues]]],
  ['requests', 'assignEngineers', [['requestAssigned', requestValues]]],
  ['approvals', 'rejectRequest', [['requestRejected', { requestTitle, reason }]]],
  ['approvals', 'notifyNextApprover', [['requestApprovalNeeded', requestValues]]],
  ['solutions', 'submitSolution', [['solutionSubmitted', requestValues], ['solutionAutoReady', requestValues], ['solutionSubmitted', requestValues]]],
  ['solutions', 'approveSolution', [['solutionReady', requestValues]]],
  ['solutions', 'rejectSolution', [['solutionRejected', { solutionTitle, reason }]]],
  ['solutions', 'queueNextSolutionApproverNotifications', [['solutionApprovalNeeded', solutionValues]]],
  ['solutions', 'approveFinalApproval', [['requestCompleted', requestValues]]],
  ['solutions', 'queueNextFinalApproverNotifications', [['finalApprovalNeeded', requestValues]]],
  ['solutions', 'rejectFinalApproval', [['finalApprovalRejected', { requestTitle, reason }]]],
  ['solutions', 'resubmitSolution', [['solutionRevisionReady', requestValues], ['solutionResubmitted', requestValues]]],
] as const

for (const [file, name, expected] of producers) {
  test(`${file}.${name} persists event-specific display metadata without changing SMTP inputs`, async () => {
    const payloads = producerPayloads(file, name)
    assert.equal(payloads.length, expected.length)
    const stored: DisplayRow[] = []
    const mail: unknown[] = []
    const write = makeWriter(stored, mail)
    for (const payload of payloads) {
      await write({ userId: 'recipient', ...payload } as unknown as UserNotification)
    }
    assert.deepEqual(stored, payloads.map(({ display: _display, ...payload }, index) => ({
      userId: 'recipient', ...payload, displayKey: expected[index][0], displayValues: expected[index][1],
    })))
    assert.deepEqual(mail, payloads.map(({ type, title, message, requestId }) => ({
      email: 'fixture@example.invalid', data: { type, title, message, requestId },
    })))
    for (const row of stored) {
      assert.deepEqual(renderNotificationDisplay('en', row), { title: row.title, message: row.message }, 'English matches the legacy bytes')
      assert.notDeepEqual(renderNotificationDisplay('th', row), { title: row.title, message: row.message })
    }
  })
}

test('approvals.notifyNextApprover uses a phase-specific template even on the legacy final branch', async () => {
  const [payload] = producerPayloads('approvals', 'notifyNextApprover', { nextApproval: { request, isFinalApproval: true } })
  const stored: DisplayRow[] = []
  await makeWriter(stored, [])(payload as unknown as UserNotification)
  assert.equal(stored[0].displayKey, 'finalApprovalNeededFromRequest')
  assert.deepEqual(stored[0].displayValues, requestValues)
  assert.deepEqual(renderNotificationDisplay('en', stored[0]), { title: payload.title, message: payload.message })
  assert.match(renderNotificationDisplay('th', stored[0]).message, /รอบ Final/)
})

test('approvals.notifyRequestStatusChange writes display metadata directly and preserves the Status value', async () => {
  const stored: DisplayRow[] = []
  const notify = executeAction<(id: string, change: { requesterId: string; toStatus: string }) => Promise<void>>('approvals', 'notifyRequestStatusChange', {
    mapEventRecipients: ({ requesterId }: { requesterId: string }) => [requesterId],
    notificationDisplayFields,
    prisma: { notifications: { create: async ({ data }: { data: typeof stored[number] }) => { stored.push(data) } } },
  })
  await notify(request.id, { requesterId: request.requesterId, toStatus: 'SentToEngineer' })
  assert.deepEqual(stored, [{
    userId: 'requester', type: 'status_changed', title: 'Request Status Changed', message: 'Your request status changed to SentToEngineer',
    requestId: request.id, displayKey: 'requestStatusChanged', displayValues: { status: 'SentToEngineer' },
  }])
  assert.match(renderNotificationDisplay('th', stored[0]).message, /SentToEngineer$/)
})

test('solutions.initiateFinalApproval rolls back both paths and dispatches custom Final metadata only after commit', async () => {
  for (const useCustomChain of [false, true]) {
    for (const rollback of [true, false]) {
      const stored: DisplayRow[] = []
      const mail: unknown[] = []
      const prisma = {
        user: { findUnique: async () => ({ id: request.requesterId, isActive: true }) },
        requests: { findUnique: async () => ({ ...request, status: 'SendBackToRequester' }) },
        $transaction: async (work: (tx: unknown) => Promise<void>) => {
          const uncommitted: DisplayRow[] = []
          await work({
            notifications: { create: async ({ data }: { data: DisplayRow }) => { uncommitted.push(data) } },
            request_activities: { create: async () => {} },
          })
          assert.equal(uncommitted.length, useCustomChain ? 0 : 1)
          assert.equal(stored.length, 0)
          assert.equal(mail.length, 0)
          if (rollback) throw new Error('rollback')
          stored.push(...uncommitted)
        },
      }
      const runSolutionTransactionWithNotifications = executeAction('solutions', 'runSolutionTransactionWithNotifications', {
        prisma,
        runTransactionWithPostCommitNotifications,
        translateAttemptConflict: (error: unknown) => { throw error },
        require: (name: string) => {
          assert.equal(name, './notifications')
          return { createNotification: makeWriter(stored, mail) }
        },
      })
      const initiate = executeAction<(id: string, custom: boolean, approvers: string[]) => Promise<unknown>>('solutions', 'initiateFinalApproval', {
        prisma, notificationDisplayFields, runSolutionTransactionWithNotifications,
        auth: async () => ({ user: { id: request.requesterId } }),
        RequestStatus: { SendBackToRequester: 'SendBackToRequester', Completed: 'Completed' },
        APPROVAL_ENGINE_TRANSACTION_ISOLATION: 'Serializable',
        loadActiveAssignment: async () => null,
        loadOrganizationUnitNodes: async () => [],
        existingInitiateFinalApprovalDecision: () => ({ allowed: true }),
        evaluateRequestAction: () => ({ allowed: true }),
        createCleanStartPhaseAttemptTx: (tx: unknown) => tx,
        sanitizeCustomChainOrder: (ids: string[]) => ids,
        assertCustomApproversExist: async () => {},
        createCustomPersonAttempt: async () => ({ statusChange: { to: 'FinalApproval' } }),
        createFinalApprovalAttempt: async () => ({ statusChange: { to: 'Completed' }, completedWithoutSteps: true }),
        updateRequestStatusExpecting: async () => {},
        revalidateRequestViews: () => {},
      })
      const result = initiate(request.id, useCustomChain, ['recipient'])
      if (rollback) {
        await assert.rejects(result, /rollback/)
        assert.deepEqual(stored, [])
        assert.deepEqual(mail, [])
        continue
      }
      assert.deepEqual(await result, { success: true })
      assert.deepEqual(stored, [useCustomChain ? {
        userId: 'recipient', type: 'final_approval_needed', title: 'Final Approval Needed',
        message: `Request "${requestTitle}" needs your final approval.`, requestId: request.id,
        displayKey: 'finalApprovalNeeded', displayValues: requestValues,
      } : {
        userId: 'requester', type: 'status_changed', title: 'Request Completed',
        message: `Your request "${requestTitle}" has been completed.`, requestId: request.id,
        displayKey: 'requestAutoCompleted', displayValues: requestValues,
      }])
      const [row] = stored
      assert.deepEqual(renderNotificationDisplay('en', row), { title: row.title, message: row.message })
      assert.notDeepEqual(renderNotificationDisplay('th', row), { title: row.title, message: row.message })
      assert.equal(mail.length, useCustomChain ? 1 : 0)
    }
  }
})
