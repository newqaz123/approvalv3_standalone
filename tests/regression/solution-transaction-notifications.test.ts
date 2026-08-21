import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as ts from 'typescript'

/**
 * Safety rule prompted by a real Prisma P2028 incident: global notification
 * helpers perform database work and await SMTP, so they must never execute
 * inside an interactive transaction callback. Direct `tx.notifications`
 * writes remain valid because they use the transaction client and perform no
 * external I/O.
 *
 * Production change this catches: adding any forbidden helper call back to a
 * `prisma.$transaction(...)` callback or to the enqueue-only callback managed
 * by `runSolutionTransactionWithNotifications(...)`.
 */

describe('solution workflow transaction notification boundaries', () => {
  it('keeps global notification and SMTP helpers out of transaction callbacks', () => {
    const filePath = resolve(process.cwd(), 'src/server-actions/solutions.ts')
    const sourceText = readFileSync(filePath, 'utf8')
    const source = ts.createSourceFile(
      filePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    )

    const forbiddenCalls = new Set([
      'createNotification',
      'notifyUsersInDepartment',
      'sendEmailNotification',
      'notifyNextSolutionApprover',
      'notifyNextFinalApprover',
    ])
    const transactionBoundaries = new Set([
      '$transaction',
      'runSolutionTransactionWithNotifications',
    ])
    const violations: string[] = []

    const calledName = (expression: ts.LeftHandSideExpression): string | null => {
      if (ts.isIdentifier(expression)) return expression.text
      if (ts.isPropertyAccessExpression(expression)) return expression.name.text
      return null
    }

    const inspectTransactionCallback = (callback: ts.Node) => {
      const inspect = (node: ts.Node) => {
        if (ts.isCallExpression(node)) {
          const name = calledName(node.expression)
          if (name && forbiddenCalls.has(name)) {
            const position = source.getLineAndCharacterOfPosition(node.getStart(source))
            violations.push(`${name} at line ${position.line + 1}`)
          }
        }
        ts.forEachChild(node, inspect)
      }
      inspect(callback)
    }

    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const boundaryName = calledName(node.expression)
        const callback = node.arguments[0]
        if (
          boundaryName &&
          transactionBoundaries.has(boundaryName) &&
          callback &&
          (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
        ) {
          inspectTransactionCallback(callback.body)
        }
      }
      ts.forEachChild(node, visit)
    }

    visit(source)

    assert.deepEqual(
      violations,
      [],
      `Unsafe notification work found inside transaction callbacks:\n${violations.join('\n')}`,
    )
  })

  it('preserves post-commit notification contracts for every affected workflow', () => {
    const filePath = resolve(process.cwd(), 'src/server-actions/solutions.ts')
    const sourceText = readFileSync(filePath, 'utf8')
    const source = ts.createSourceFile(
      filePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    )

    const functions = new Map<string, string>()
    const functionDeclarations = new Map<string, ts.FunctionDeclaration>()
    const collectFunctions = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) && node.name) {
        functions.set(
          node.name.text,
          sourceText.slice(node.getStart(source), node.getEnd()),
        )
        functionDeclarations.set(node.name.text, node)
      }
      ts.forEachChild(node, collectFunctions)
    }
    collectFunctions(source)

    const body = (name: string): string => {
      const value = functions.get(name)
      assert.ok(value, `Expected function ${name} to exist`)
      return value
    }

    const approveSolution = body('approveSolution')
    assert.match(approveSolution, /runSolutionTransactionWithNotifications/)
    assert.match(
      approveSolution,
      /notifications\.department\(request\.departmentId,[\s\S]*?type:\s*'solution_ready'/,
    )
    assert.match(approveSolution, /queueNextSolutionApproverNotifications/)

    const rejectSolution = body('rejectSolution')
    assert.match(rejectSolution, /runSolutionTransactionWithNotifications/)
    assert.match(
      rejectSolution,
      /notifications\.user\(\{[\s\S]*?userId:\s*solutionData\.submittedById[\s\S]*?type:\s*'approval_rejected'[\s\S]*?requestId:\s*solution\.requestId/,
    )

    const initiateFinalApproval = body('initiateFinalApproval')
    assert.match(
      initiateFinalApproval,
      /runSolutionTransactionWithNotifications/,
    )
    assert.match(initiateFinalApproval, /queueNextFinalApproverNotifications/)

    const approveFinalApproval = body('approveFinalApproval')
    assert.match(
      approveFinalApproval,
      /runSolutionTransactionWithNotifications/,
    )
    assert.match(
      approveFinalApproval,
      /notifications\.department\([\s\S]*?request\.departmentId[\s\S]*?type:\s*'approval_granted'[\s\S]*?engineeringUserIds/,
    )
    assert.match(approveFinalApproval, /queueNextFinalApproverNotifications/)

    const rejectFinalApproval = body('rejectFinalApproval')
    assert.match(
      rejectFinalApproval,
      /runSolutionTransactionWithNotifications/,
    )
    assert.equal(
      (rejectFinalApproval.match(/notifications\.department\(/g) ?? []).length,
      2,
      'final rejection must notify engineering and the requester department',
    )
    assert.match(
      rejectFinalApproval,
      /notifications\.department\([\s\S]*?engineeringDept\.id[\s\S]*?type:\s*'approval_rejected'[\s\S]*?\[userId\]/,
    )
    assert.match(
      rejectFinalApproval,
      /notifications\.department\([\s\S]*?request\.departmentId[\s\S]*?type:\s*'status_changed'[\s\S]*?\[userId\]/,
    )

    const resubmitSolution = body('resubmitSolution')
    assert.match(resubmitSolution, /runSolutionTransactionWithNotifications/)

    const resubmitDeclaration = functionDeclarations.get('resubmitSolution')
    assert.ok(resubmitDeclaration, 'Expected resubmitSolution declaration')
    let autoApprovedBranch = ''
    const findAutoApprovedBranch = (node: ts.Node) => {
      if (
        ts.isIfStatement(node) &&
        node.expression.getText(source) === 'isAutoApproved'
      ) {
        autoApprovedBranch = sourceText.slice(
          node.thenStatement.getStart(source),
          node.thenStatement.getEnd(),
        )
      }
      ts.forEachChild(node, findAutoApprovedBranch)
    }
    findAutoApprovedBranch(resubmitDeclaration)

    assert.match(
      autoApprovedBranch,
      /notifications\.department\(request\.department\.id,[\s\S]*?type:\s*'solution_ready'/,
      'auto-approved resubmission must queue its requester-department notification inside the isAutoApproved branch',
    )

    const queueNextSolution = body('queueNextSolutionApproverNotifications')
    assert.match(
      queueNextSolution,
      /userId:\s*nextApproval\.requiredApproverId[\s\S]*?type:\s*'approval_needed'/,
    )
    assert.match(
      queueNextSolution,
      /userId:\s*approver\.id[\s\S]*?type:\s*'approval_needed'/,
    )

    const queueNextFinal = body('queueNextFinalApproverNotifications')
    assert.match(
      queueNextFinal,
      /userId:\s*nextApproval\.requiredApproverId[\s\S]*?type:\s*'final_approval_needed'/,
    )
    assert.match(
      queueNextFinal,
      /userId:\s*approver\.id[\s\S]*?type:\s*'final_approval_needed'/,
    )
  })
})
