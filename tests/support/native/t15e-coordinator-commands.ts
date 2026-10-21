/**
 * T15E coordinator fixed commands (Task93) — bounded connect/lock/rollback
 * slice. Not the deferred barrier echo (ARM/LOCK_ACQUIRE/RELEASE stay
 * templates). `requests.id` is TEXT; a canonical UUID is bound as a text
 * literal, never `::uuid`. The armed stage is `SendBackToRequester`.
 * No other column, enum, or identifier is interpolated.
 */

import { T15E_BACKEND_START_SQL_EXPR } from './t15e-backend-monitor'
import { T15E_SAFE_ERROR_MESSAGE, hex32SqlLiteral, uuidSqlLiteral } from './t15e-overlap-protocol'

/** Source: prisma RequestStatus.SendBackToRequester. Not a caller string. */
export const T15E_COORDINATOR_ARM_STAGE = 'SendBackToRequester' as const

export type T15ECoordinatorFixedCommand =
  | { kind: 'COORDINATOR_BEGIN' }
  | { kind: 'COORDINATOR_ROLLBACK' }
  | { kind: 'COORDINATOR_ARM_STAGE'; requestId: string }
  | { kind: 'COORDINATOR_LOCK_NO_KEY_UPDATE'; requestId: string }

const STAGE_LITERAL = `'${T15E_COORDINATOR_ARM_STAGE}'`

function framed(prefixSql: string, payloadExpr: string, nonceLiteral: string, seq: number): string {
  const begin = `select format('T15E_B1:%s:${seq}:', ${nonceLiteral});`
  const result = `select (${payloadExpr})::text;`
  const end = `select format('T15E_E1:%s:${seq}:%s:', ${nonceLiteral}, length((${payloadExpr})::text));`
  return `${prefixSql}${begin}\n${result}\n${end}\n`
}

function requestLiteral(requestId: string): string | null {
  return uuidSqlLiteral(requestId)
}

/**
 * Full stdin SQL for one coordinator command. UUID/nonce binding uses the
 * approved literal helpers only. Lock is a top-level `FOR NO KEY UPDATE`
 * (not a subquery, and not `FOR UPDATE`).
 */
export function buildCoordinatorFixedCommandSql(
  command: T15ECoordinatorFixedCommand,
  runNonce: string,
  seq: number,
): { ok: true; sql: string } | { ok: false; message: string } {
  const nonceLiteral = hex32SqlLiteral(runNonce)
  if (nonceLiteral === null || !Number.isInteger(seq) || seq < 0) {
    return { ok: false, message: T15E_SAFE_ERROR_MESSAGE }
  }
  if (command.kind === 'COORDINATOR_BEGIN') {
    return {
      ok: true,
      sql: framed('BEGIN;\n', "jsonb_build_object('begun', true)", nonceLiteral, seq),
    }
  }
  if (command.kind === 'COORDINATOR_ROLLBACK') {
    return {
      ok: true,
      sql: framed('ROLLBACK;\n', "jsonb_build_object('rolledBack', true)", nonceLiteral, seq),
    }
  }
  const uuidLiteral = requestLiteral(command.requestId)
  if (uuidLiteral === null) return { ok: false, message: T15E_SAFE_ERROR_MESSAGE }
  if (command.kind === 'COORDINATOR_ARM_STAGE') {
    // Earlier precheck only. The lock command re-reads status under the row lock.
    const payload =
      'coalesce((select jsonb_build_object(' +
      `'found', true, 'requestId', id::text, 'status', status::text, 'runNonce', ${nonceLiteral}, ` +
      `'stageMatches', (status::text = ${STAGE_LITERAL})) ` +
      `from requests where id = ${uuidLiteral}), jsonb_build_object('found', false, 'runNonce', ${nonceLiteral}))`
    return { ok: true, sql: framed('', payload, nonceLiteral, seq) }
  }
  const backendStart = `(select ${T15E_BACKEND_START_SQL_EXPR} from pg_stat_activity where pid = pg_backend_pid())`
  const databaseId = `(select oid from pg_database where datname = current_database())`
  const jsonExpr =
    'jsonb_build_object(' +
    `'found', true, 'requestId', id::text, 'status', status::text, 'runNonce', ${nonceLiteral}, ` +
    `'pid', pg_backend_pid(), 'backendStart', ${backendStart}, 'databaseId', ${databaseId})`
  // Top-level FOR NO KEY UPDATE. A missing row emits no JSON line; the frame
  // then fails and the adapter rolls back. The trailer length read is not a lock.
  const begin = `select format('T15E_B1:%s:${seq}:', ${nonceLiteral});`
  const lockSql =
    `${begin}\n` +
    `select ${jsonExpr}::text from requests where id = ${uuidLiteral} for no key update;\n` +
    `select format('T15E_E1:%s:${seq}:%s:', ${nonceLiteral}, length((select ${jsonExpr}::text from requests where id = ${uuidLiteral})));\n`
  return { ok: true, sql: lockSql }
}
