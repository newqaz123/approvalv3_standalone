// L10: reject paths re-check approval eligibility INSIDE the transaction and
// write requests.status only through the expected-status guard
// (updateRequestStatusExpecting -> updateMany id+status, 0 rows -> conflict
// + rollback), so a stale or double reject cannot overwrite a newer state.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function fnBody(path: string, name: string): string {
  const source = readFileSync(path, 'utf8')
  const match = source.match(new RegExp(`export async function ${name}\\([\\s\\S]*?\\n\\}\\n`))
  assert.ok(match, `${path} missing ${name}`)
  return match[0]
}

function txSlice(body: string, opener: RegExp): string {
  const at = body.search(opener)
  assert.ok(at >= 0, `transaction opener ${opener} not found`)
  return body.slice(at)
}

const cases = [
  {
    name: 'rejectRequest',
    path: 'src/server-actions/approvals.ts',
    opener: /prisma\.\$transaction\(async \(tx\)/,
    eligibility: /canUserApproveRequest\(\s*createPrismaApprovalTransactionDb\(tx\)/,
    expected: /expectedStatuses:\s*\[\s*'ImprovementRequest'\s*\]/,
  },
  {
    name: 'rejectSolution',
    path: 'src/server-actions/solutions.ts',
    opener: /runSolutionTransactionWithNotifications\(async \(tx, notifications\)/,
    eligibility: /engineCanUserApproveSolution\(\s*createPrismaApprovalTransactionDb\(tx\)/,
    expected: /expectedStatuses:\s*\[\s*RequestStatus\.DesignCostEstimationApproval\s*\]/,
  },
  {
    name: 'rejectFinalApproval',
    path: 'src/server-actions/solutions.ts',
    opener: /runSolutionTransactionWithNotifications\(async \(tx, notifications\)/,
    eligibility: /engineCanUserApproveFinal\(\s*createPrismaApprovalTransactionDb\(tx\)/,
    expected: /expectedStatuses:\s*\[\s*RequestStatus\.FinalApproval\s*\]/,
  },
] as const

describe('reject paths are race-safe', () => {
  for (const c of cases) {
    it(`${c.name} re-checks eligibility inside the transaction`, () => {
      const tx = txSlice(fnBody(c.path, c.name), c.opener)
      assert.match(tx, c.eligibility)
      assert.match(tx, /if \(!(?:txEligibility)\.canApprove\)/)
    })

    it(`${c.name} guards the requests row on the expected current status`, () => {
      const tx = txSlice(fnBody(c.path, c.name), c.opener)
      assert.match(tx, /updateRequestStatusExpecting\(tx,/)
      assert.match(tx, c.expected)
      assert.doesNotMatch(tx, /tx\.requests\.update\(/)
    })

    it(`${c.name} documents why it does not route through the engine REJECT branch`, () => {
      assert.match(fnBody(c.path, c.name), /engine REJECT branch/)
    })
  }
})
