import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { createDecisionAuditStore } from '../src/decisionAuditStore.mjs'

test('decision audit store appends jsonl records', async () => {
  const baseDir = path.join('test', 'tmp-audit-store')
  await mkdir(baseDir, { recursive: true })
  const store = createDecisionAuditStore({ baseDir, timeZone: 'Asia/Shanghai' })

  const ok = await store.appendAudit({
    traderId: 't_001',
    audit: { cycle_number: 1, note: 'hello' },
    nowMs: 1700000000000,
  })
  assert.equal(ok, true)

  const dayKey = new Date(1700000000000).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
  const fp = path.join(baseDir, 't_001', `${dayKey}.jsonl`)
  const content = await readFile(fp, 'utf8')
  assert.ok(content.includes('agent.decision_audit.v1'))
  assert.ok(content.includes('"note":"hello"'))
})
