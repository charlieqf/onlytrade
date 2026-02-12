import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { mkdtemp, mkdir, rename, writeFile } from 'node:fs/promises'

import { createLiveFileFrameProvider } from '../src/liveFileFrameProvider.mjs'

function frame({ symbol = '600519.SH', ts = 1_700_000_000_000, close = 10 }) {
  return {
    schema_version: 'market.bar.v1',
    market: 'CN-A',
    mode: 'real',
    provider: 'akshare',
    feed: 'bars',
    seq: 1,
    event_ts_ms: ts + 60_000,
    ingest_ts_ms: ts + 60_250,
    instrument: {
      symbol,
      exchange: symbol.endsWith('.SH') ? 'SSE' : 'SZSE',
      timezone: 'Asia/Shanghai',
      currency: 'CNY',
    },
    interval: '1m',
    window: {
      start_ts_ms: ts,
      end_ts_ms: ts + 60_000,
      trading_day: '2026-02-12',
    },
    session: {
      phase: 'continuous_am',
      is_halt: false,
      is_partial: false,
    },
    bar: {
      open: close,
      high: close,
      low: close,
      close,
      volume_shares: 100,
      turnover_cny: close * 100,
      vwap: close,
    },
  }
}

async function writeCanonicalAtomic(filePath, payload) {
  const dir = path.dirname(filePath)
  await mkdir(dir, { recursive: true })
  const tempPath = `${filePath}.tmp`
  await writeFile(tempPath, JSON.stringify(payload), 'utf8')
  await rename(tempPath, filePath)
}

test('provider reloads when file mtime changes', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'onlytrade-live-provider-'))
  const filePath = path.join(tempDir, 'frames.1m.json')

  await writeCanonicalAtomic(filePath, {
    schema_version: 'market.frames.v1',
    market: 'CN-A',
    mode: 'real',
    provider: 'akshare',
    frames: [frame({ ts: 1_700_000_000_000, close: 10 })],
  })

  const provider = createLiveFileFrameProvider({ filePath, refreshMs: 10 })
  const rows1 = await provider.getFrames({ symbol: '600519.SH', interval: '1m', limit: 10 })
  assert.equal(rows1.length, 1)
  assert.equal(rows1[0].bar.close, 10)

  await new Promise((resolve) => setTimeout(resolve, 15))
  await writeCanonicalAtomic(filePath, {
    schema_version: 'market.frames.v1',
    market: 'CN-A',
    mode: 'real',
    provider: 'akshare',
    frames: [
      frame({ ts: 1_700_000_000_000, close: 10 }),
      frame({ ts: 1_700_000_060_000, close: 11 }),
    ],
  })

  await provider.refresh(true)
  const rows2 = await provider.getFrames({ symbol: '600519.SH', interval: '1m', limit: 10 })
  assert.equal(rows2.length, 2)
  assert.equal(rows2[1].bar.close, 11)
  assert.deepEqual(provider.getSymbols('1m'), ['600519.SH'])
})

test('provider keeps last good cache on read/parse failure', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'onlytrade-live-provider-'))
  const filePath = path.join(tempDir, 'frames.1m.json')

  await writeCanonicalAtomic(filePath, {
    schema_version: 'market.frames.v1',
    market: 'CN-A',
    mode: 'real',
    provider: 'akshare',
    frames: [frame({ ts: 1_700_000_000_000, close: 20 })],
  })

  const provider = createLiveFileFrameProvider({ filePath, refreshMs: 10 })
  const rows1 = await provider.getFrames({ symbol: '600519.SH', interval: '1m', limit: 10 })
  assert.equal(rows1.length, 1)
  assert.equal(rows1[0].bar.close, 20)

  await writeFile(filePath, '{ invalid json', 'utf8')
  await provider.refresh(true)
  const rows2 = await provider.getFrames({ symbol: '600519.SH', interval: '1m', limit: 10 })
  assert.equal(rows2.length, 1)
  assert.equal(rows2[0].bar.close, 20)
  assert.ok(provider.getStatus().last_error)

})
