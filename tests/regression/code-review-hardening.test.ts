// Code-review hardening: verified findings H4-H8 and L12.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

function exportedFunctionBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`)
  assert.notEqual(start, -1, `${name} must be exported`)
  const next = source.indexOf('\nexport ', start + 1)
  return source.slice(start, next === -1 ? undefined : next)
}

describe('H4: getRequestApprovals is gated by session and request visibility', () => {
  const source = read('src/server-actions/approvals.ts')
  const body = exportedFunctionBody(source, 'getRequestApprovals')

  it('requires an authenticated session before reading approvals', () => {
    const authAt = body.indexOf('await auth()')
    assert.ok(authAt > -1, 'must call auth()')
    assert.match(body, /throw new Error\('Unauthorized'\)/)
    assert.ok(authAt < body.indexOf('request_approvals.findMany'))
  })

  it('checks canUserViewRequest and returns an empty list when denied', () => {
    assert.match(source, /import \{ canUserViewRequest \} from '@\/lib\/request-visibility\/scope'/)
    const gate = body.match(/if \(!\(await canUserViewRequest\(userId, requestId\)\)\) \{\s*return \[\]\s*\}/)
    assert.ok(gate, 'denied callers must get []')
    assert.ok(body.indexOf(gate[0]) < body.indexOf('request_approvals.findMany'))
  })
})

describe('H7: initiateFinalApproval uses the real user.isActive', () => {
  const body = exportedFunctionBody(read('src/server-actions/solutions.ts'), 'initiateFinalApproval')

  it('loads isActive and denies inactive users before evaluating the action', () => {
    assert.match(body, /select: \{[^}]*isActive: true[^}]*\}/)
    const deny = body.indexOf('if (!user.isActive)')
    assert.ok(deny > -1, 'must deny inactive users explicitly')
    assert.ok(deny < body.indexOf("evaluateRequestAction('INITIATE_FINAL_APPROVAL'"))
  })

  it('never hard-codes isActive: true into the actor or the decision input', () => {
    const evaluation = body.slice(body.indexOf("evaluateRequestAction('INITIATE_FINAL_APPROVAL'"))
    const actorBlock = evaluation.slice(0, evaluation.indexOf('if (!initiateAction.allowed)'))
    assert.doesNotMatch(actorBlock, /isActive: true/)
    assert.equal((actorBlock.match(/isActive: user\.isActive/g) ?? []).length, 2)
  })
})

describe('H8: client-callable admin actions cannot skip requireAdmin via an injected db', () => {
  const pairs = [
    { wrapper: 'src/server-actions/organization.ts', core: 'src/lib/organization/workspace-admin.ts' },
    { wrapper: 'src/server-actions/approval-routes.ts', core: 'src/lib/approval-routes/chains-admin.ts' },
  ] as const

  for (const { wrapper, core } of pairs) {
    it(`${wrapper} exports thin wrappers that never accept or forward a db`, () => {
      const source = read(wrapper)
      assert.match(source, /^'use server'/)
      assert.doesNotMatch(source, /db \?\?/)
      assert.doesNotMatch(source, /createProduction\w*Db/)
      const exported = [...source.matchAll(/export async function (\w+)\(([^)]*)\)/g)]
      assert.ok(exported.length >= 4, 'wrappers must exist')
      for (const [, name, params] of exported) {
        assert.doesNotMatch(params, /\bdb\b/, `${name} must not accept a db argument`)
        const body = exportedFunctionBody(source, name)
        assert.match(body, new RegExp(`return core\\.${name}\\((input)?\\)`), `${name} must forward only its input`)
      }
    })

    it(`${core} is not a server-action module and its production stores require admin`, () => {
      const source = read(core)
      assert.doesNotMatch(source, /^'use server'/m)
      const factories = [...source.matchAll(/async function (createProduction\w*Db)\(\)[^{]*\{([\s\S]*?)\n\}/g)]
      assert.ok(factories.length > 0)
      for (const [, name, body] of factories) {
        assert.match(body, /await (requireAdmin|requireChainsAdmin)\(\)/, `${name} must require admin`)
      }
    })
  }
})
