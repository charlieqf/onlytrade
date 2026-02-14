import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { createLiveJsonFileProvider } from '../src/liveJsonFileProvider.mjs'

function tmpDir() {
  return path.join('test', 'tmp-live-json')
}

test('provider reloads when file mtime changes', async () => {
  const dir = tmpDir()
  await mkdir(dir, { recursive: true })
  const fp = path.join(dir, 'payload.json')
  await writeFile(fp, JSON.stringify({ ok: 1 }), 'utf8')

  const provider = createLiveJsonFileProvider({ filePath: fp, refreshMs: 10 })
  const first = await provider.getPayload({ forceRefresh: true })
  assert.equal(first.ok, 1)

  await writeFile(fp, JSON.stringify({ ok: 2 }), 'utf8')
  const second = await provider.getPayload({ forceRefresh: true })
  assert.equal(second.ok, 2)
})

test('provider keeps last good cache on read/parse failure', async () => {
  const dir = tmpDir()
  await mkdir(dir, { recursive: true })
  const fp = path.join(dir, 'payload-bad.json')
  await writeFile(fp, JSON.stringify({ ok: true, version: 1 }), 'utf8')

  const provider = createLiveJsonFileProvider({ filePath: fp, refreshMs: 10 })
  const first = await provider.getPayload({ forceRefresh: true })
  assert.equal(first.version, 1)

  await writeFile(fp, '{not json', 'utf8')
  const second = await provider.getPayload({ forceRefresh: true })
  assert.equal(second.version, 1)
  const status = provider.getStatus()
  assert.equal(Boolean(status.last_error), true)
  assert.equal(status.has_last_good, true)
})

test('provider stale window honors staleAfterMs override', async () => {
  const dir = tmpDir()
  await mkdir(dir, { recursive: true })
  const fp = path.join(dir, 'payload-stale.json')
  await writeFile(fp, JSON.stringify({ ok: true }), 'utf8')

  const provider = createLiveJsonFileProvider({ filePath: fp, refreshMs: 10, staleAfterMs: 50 })
  await provider.getPayload({ forceRefresh: true })
  assert.equal(provider.getStatus().stale, false)

  // stale window is clamped to at least min refresh (250ms)
  await new Promise((r) => setTimeout(r, 320))
  assert.equal(provider.getStatus().stale, true)
})
