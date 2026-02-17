import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { readJsonlRecordsStreaming } from '../src/jsonlReader.mjs'

test('readJsonlRecordsStreaming preserves raw-line limit semantics from end', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'runtime-api-jsonl-'))
  t.after(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const fp = path.join(dir, 'sample.jsonl')
  await writeFile(fp, [
    JSON.stringify({ id: 1, label: 'first' }),
    '{ malformed',
    JSON.stringify({ id: 2, label: 'second' }),
    '',
    JSON.stringify({ id: 3, label: 'third' }),
    '',
  ].join('\n'), 'utf8')

  const rows = await readJsonlRecordsStreaming(fp, { limit: 3, fromEnd: true })
  assert.deepEqual(rows.map((row) => Number(row.id)), [2, 3])
})

test('readJsonlRecordsStreaming preserves raw-line limit semantics from start', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'runtime-api-jsonl-'))
  t.after(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const fp = path.join(dir, 'sample.jsonl')
  await writeFile(fp, [
    JSON.stringify({ id: 1, label: 'first' }),
    '{ malformed',
    JSON.stringify({ id: 2, label: 'second' }),
    JSON.stringify({ id: 3, label: 'third' }),
  ].join('\n'), 'utf8')

  const rows = await readJsonlRecordsStreaming(fp, { limit: 2, fromEnd: false })
  assert.deepEqual(rows.map((row) => Number(row.id)), [1])
})
