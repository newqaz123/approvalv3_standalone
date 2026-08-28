import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as ts from 'typescript'

type ActionFile = {
  path: string
  descriptionWriters: string[]
}

const ACTION_FILES: ActionFile[] = [
  {
    path: 'src/server-actions/requests.ts',
    descriptionWriters: ['createRequest', 'resubmitRequest'],
  },
  {
    path: 'src/server-actions/solutions.ts',
    descriptionWriters: ['submitSolution', 'resubmitSolution'],
  },
  {
    path: 'src/server-actions/templates.ts',
    descriptionWriters: ['createTemplate', 'updateTemplate'],
  },
]

function calledName(expression: ts.LeftHandSideExpression): string | null {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  return null
}

function functionBody(source: ts.SourceFile, name: string): ts.Block {
  let body: ts.Block | undefined
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      body = node.body
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(body, `Expected ${name} to be a function declaration`)
  return body
}

function hasReconciliationInsideTransaction(body: ts.Block): boolean {
  const transactionBoundaries = new Set(['$transaction', 'runSolutionTransactionWithNotifications'])

  const containsReconciliation = (node: ts.Node): boolean => {
    let found = false
    const visit = (current: ts.Node) => {
      if (ts.isCallExpression(current) && calledName(current.expression) === 'reconcileInlineDescriptionImages') {
        found = true
      }
      ts.forEachChild(current, visit)
    }
    visit(node)
    return found
  }

  let reconcilesInTransaction = false
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && transactionBoundaries.has(calledName(node.expression) ?? '')) {
      const callback = node.arguments[0]
      if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
        reconcilesInTransaction ||= containsReconciliation(callback.body)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(body)
  return reconcilesInTransaction
}

describe('inline image save action wiring', () => {
  it('prepares and reconciles every owner description write inside its transaction', () => {
    for (const actionFile of ACTION_FILES) {
      const path = resolve(process.cwd(), actionFile.path)
      const text = readFileSync(path, 'utf8')
      const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

      assert.match(text, /from ['"]@\/lib\/inline-images\/references['"]/)
      for (const name of actionFile.descriptionWriters) {
        const body = functionBody(source, name)
        const bodyText = text.slice(body.getStart(source), body.getEnd())
        assert.match(bodyText, /prepareInlineDescription/, `${name} must prepare its description before saving`)
        assert.match(bodyText, /prepared\.html/, `${name} must persist canonical prepared HTML`)
        assert.equal(
          hasReconciliationInsideTransaction(body),
          true,
          `${name} must reconcile inline image references inside its transaction`,
        )
      }
    }
  })

  it('accepts an upload session for every description save, with request resubmission conditional on a description update', () => {
    const requests = readFileSync(resolve(process.cwd(), 'src/server-actions/requests.ts'), 'utf8')
    const solutions = readFileSync(resolve(process.cwd(), 'src/server-actions/solutions.ts'), 'utf8')
    const templates = readFileSync(resolve(process.cwd(), 'src/server-actions/templates.ts'), 'utf8')
    const solutionSchemas = readFileSync(resolve(process.cwd(), 'src/lib/schemas/solution-schemas.ts'), 'utf8')

    assert.match(requests, /inlineImageSessionId/)
    assert.match(requests, /input\.description !== undefined/)
    assert.match(solutions, /inlineImageSessionId/)
    assert.match(templates, /inlineImageSessionId/)
    assert.match(solutionSchemas, /submitSolutionSchema[\s\S]*?inlineImageSessionId:\s*z\.string\(\)\.uuid\(\)/)
    assert.match(solutionSchemas, /resubmitSolutionSchema[\s\S]*?inlineImageSessionId:\s*z\.string\(\)\.uuid\(\)/)
  })
})
