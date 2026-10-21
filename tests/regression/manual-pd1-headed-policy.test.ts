import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateManualDemoAccess, assertTopicCanContinue, validateTopicOneRecheck } from '../support/manual-pd1-headed-policy'

const access = {
  runId: 'business-test-20261008t142631-49828577',
  root: '/private/tmp/approval-manual-demo/business-test-20261008t142631-49828577-example',
  databasePort: 50666,
  postmasterPid: 5028,
  password: 'business-e2e-test-only-password',
}

test('headed walkthrough accepts the explicitly isolated demo identity', () => {
  assert.doesNotThrow(() => validateManualDemoAccess(access))
})

for (const [name, patch] of [
  ['shared database port', { databasePort: 5432 }],
  ['app port used as database', { databasePort: 3100 }],
  ['malformed port', { databasePort: '50666' }],
  ['non-owned run', { runId: 'production' }],
  ['foreign runtime directory', { root: '/Users/example/production' }],
  ['different run directory', { root: '/private/tmp/business-test-20261008t142631-other-data' }],
  ['missing postmaster identity', { postmasterPid: 0 }],
  ['non-demo password', { password: 'real-password' }],
] as const) {
  test(`headed walkthrough refuses ${name} before browser actions`, () => {
    assert.throws(() => validateManualDemoAccess({ ...access, ...patch }), /SAFETY/)
  })
}

test('continue accepts exactly the next topic of a paused run', () => {
  assert.doesNotThrow(() => assertTopicCanContinue({ status: 'paused', nextTopic: 2 }, 2))
})
for (const [status, nextTopic, requested] of [
  ['running', 2, 2], ['failed', 2, 2], ['completed', null, 2],
  ['paused', 2, 3], ['paused', 2, 1],
] as const) {
  test(`continue refuses ${status} topic ${requested} when next is ${nextTopic}`, () => {
    assert.throws(() => assertTopicCanContinue({ status, nextTopic }, requested), /Cannot continue/)
  })
}

const expiredTopicOne = {
  status: 'failed', currentTopic: 1, runId: access.runId,
  requestTitle: 'Headed PD1 H1 saved request', pageErrors: [],
  results: [{ topic: 1, status: 'passed' }],
}
test('an expired pause may recheck its existing request without skipping any test', () => {
  assert.doesNotThrow(() => validateTopicOneRecheck(expiredTopicOne, access.runId))
})
for (const [label, patch] of [
  ['failed test', { results: [{ topic: 1, status: 'failed' }] }],
  ['different database run', { runId: 'business-test-20261008t142631-other' }],
  ['later mutation topic', { currentTopic: 3 }],
  ['active runner', { status: 'running' }],
  ['browser exception', { pageErrors: ['Unhandled error'] }],
  ['missing request identity', { requestTitle: '' }],
  ['extra completed topic', { results: [{ topic: 1, status: 'passed' }, { topic: 2, status: 'passed' }] }],
] as const) {
  test(`recheck refuses ${label}`, () => {
    assert.throws(() => validateTopicOneRecheck({ ...expiredTopicOne, ...patch }, access.runId), /Cannot recheck/)
  })
}
