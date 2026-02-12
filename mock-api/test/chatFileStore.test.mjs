import test from 'node:test'
import assert from 'node:assert/strict'
import { appendFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createChatFileStore } from '../src/chat/chatFileStore.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const TMP_DIR = path.join(__dirname, 'tmp-chat-test')

test('chat store appends and reads public/private history', async (t) => {
  await rm(TMP_DIR, { recursive: true, force: true })
  t.after(async () => {
    await rm(TMP_DIR, { recursive: true, force: true })
  })

  const store = createChatFileStore({ baseDir: TMP_DIR })
  await store.appendPublic('t_001', { id: 'm1', text: 'hello', created_ts_ms: 1700000000000 })
  await store.appendPrivate('t_001', 'usr_sess_1', { id: 'm2', text: 'hi agent', created_ts_ms: 1700000001000 })

  const pub = await store.readPublic('t_001', 20)
  const priv = await store.readPrivate('t_001', 'usr_sess_1', 20)

  assert.equal(pub.length, 1)
  assert.equal(priv.length, 1)
  assert.equal(pub[0].id, 'm1')
  assert.equal(priv[0].id, 'm2')
})

test('chat store ignores malformed jsonl lines', async (t) => {
  await rm(TMP_DIR, { recursive: true, force: true })
  t.after(async () => {
    await rm(TMP_DIR, { recursive: true, force: true })
  })

  const store = createChatFileStore({ baseDir: TMP_DIR })
  await store.appendPublic('t_001', { id: 'm1', text: 'ok', created_ts_ms: 1700000000000 })

  const filePath = path.join(TMP_DIR, 'rooms', 't_001', 'public.jsonl')
  await appendFile(filePath, '{malformed-json}\n', 'utf8')

  const pub = await store.readPublic('t_001', 20)
  assert.equal(pub.length, 1)
  assert.equal(pub[0].id, 'm1')
})
