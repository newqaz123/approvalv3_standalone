import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

describe('engineering sub-task schema', () => {
  const schema = () => readFileSync('prisma/schema.prisma', 'utf8')
  const migration = () => readFileSync('prisma/migrations/20260606000000_add_engineering_sub_tasks/migration.sql', 'utf8')

  it('adds request sub-task, stage, and subcontractor models', () => {
    const source = schema()

    assert.match(source, /model request_sub_tasks \{/)
    assert.match(source, /model sub_task_stages \{/)
    assert.match(source, /model sub_contractors \{/)
    assert.match(source, /workRequisitionReceived\s+Boolean\s+@default\(false\)/)
    assert.match(source, /workRequisitionReceivedAt\s+DateTime\?/)
    assert.match(source, /workRequisitionReceivedById\s+String\?/)
  })

  it('creates tables, indexes, and default sub-task stages in SQL migration', () => {
    const sql = migration()

    assert.match(sql, /CREATE TABLE "sub_task_stages"/)
    assert.match(sql, /CREATE TABLE "sub_contractors"/)
    assert.match(sql, /CREATE TABLE "request_sub_tasks"/)
    assert.match(sql, /CREATE INDEX "request_sub_tasks_requestId_idx"/)
    assert.match(sql, /CREATE INDEX "request_sub_tasks_updatedAt_idx"/)
    assert.match(sql, /INSERT INTO "sub_task_stages"/)
    for (const stage of ['Design', 'Site survey', 'Waiting user data', 'Waiting quotation', 'Waiting WR', 'Completed', 'Others']) {
      assert.match(sql, new RegExp(stage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    }
  })
})
