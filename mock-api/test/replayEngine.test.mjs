import test from 'node:test'
import assert from 'node:assert/strict'

import { createReplayEngine } from '../src/replayEngine.mjs'

function makeFrame({ symbol = '600519.SH', startTsMs, seq }) {
  return {
    schema_version: 'market.bar.v1',
    market: 'CN-A',
    mode: 'mock',
    provider: 'replay-test',
    feed: 'bars',
    seq,
    event_ts_ms: startTsMs + 60_000,
    ingest_ts_ms: startTsMs + 60_100,
    instrument: {
      symbol,
      exchange: symbol.endsWith('.SH') ? 'SSE' : 'SZSE',
      timezone: 'Asia/Shanghai',
      currency: 'CNY',
    },
    interval: '1m',
    window: {
      start_ts_ms: startTsMs,
      end_ts_ms: startTsMs + 60_000,
      trading_day: '2026-02-10',
    },
    session: {
      phase: 'continuous_am',
      is_halt: false,
      is_partial: false,
    },
    bar: {
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume_shares: 1000,
      turnover_cny: 100000,
      vwap: 100,
    },
  }
}

test('replay engine advances one 1m bar per second at 60x speed', () => {
  const base = 1_700_000_000_000
  const batch = {
    schema_version: 'market.frames.v1',
    frames: [
      makeFrame({ symbol: '600519.SH', startTsMs: base, seq: 1 }),
      makeFrame({ symbol: '600519.SH', startTsMs: base + 60_000, seq: 2 }),
      makeFrame({ symbol: '600519.SH', startTsMs: base + 120_000, seq: 3 }),
    ],
  }

  const engine = createReplayEngine({
    replayBatch: batch,
    initialSpeed: 60,
    initialRunning: true,
    warmupBars: 1,
    loop: false,
  })

  assert.equal(engine.getStatus().cursor_index, 0)

  const advanced = engine.tick(1000)
  assert.equal(advanced.length, 1)
  assert.equal(engine.getStatus().cursor_index, 1)

  const visible = engine.getVisibleFrames('600519.SH', 10)
  assert.equal(visible.length, 2)
  assert.equal(visible[1].window.start_ts_ms, base + 60_000)
})

test('replay engine pause/resume and setSpeed work', () => {
  const base = 1_700_000_000_000
  const batch = {
    schema_version: 'market.frames.v1',
    frames: [
      makeFrame({ symbol: '600519.SH', startTsMs: base, seq: 1 }),
      makeFrame({ symbol: '600519.SH', startTsMs: base + 60_000, seq: 2 }),
      makeFrame({ symbol: '600519.SH', startTsMs: base + 120_000, seq: 3 }),
      makeFrame({ symbol: '600519.SH', startTsMs: base + 180_000, seq: 4 }),
    ],
  }

  const engine = createReplayEngine({
    replayBatch: batch,
    initialSpeed: 60,
    initialRunning: false,
    warmupBars: 1,
    loop: false,
  })

  assert.equal(engine.getStatus().running, false)
  assert.equal(engine.tick(2000).length, 0)

  engine.resume()
  assert.equal(engine.getStatus().running, true)
  engine.setSpeed(120)
  assert.equal(engine.getStatus().speed, 120)

  const advanced = engine.tick(1000)
  assert.equal(advanced.length, 2)
  assert.equal(engine.getStatus().cursor_index, 2)

  engine.pause()
  assert.equal(engine.getStatus().running, false)
})

test('replay engine step advances by one bar while paused', () => {
  const base = 1_700_000_000_000
  const batch = {
    schema_version: 'market.frames.v1',
    frames: [
      makeFrame({ symbol: '600519.SH', startTsMs: base, seq: 1 }),
      makeFrame({ symbol: '600519.SH', startTsMs: base + 60_000, seq: 2 }),
      makeFrame({ symbol: '600519.SH', startTsMs: base + 120_000, seq: 3 }),
    ],
  }

  const engine = createReplayEngine({
    replayBatch: batch,
    initialSpeed: 60,
    initialRunning: false,
    warmupBars: 1,
    loop: false,
  })

  assert.equal(engine.getStatus().cursor_index, 0)
  const stepFrames = engine.step(1)
  assert.equal(stepFrames.length, 1)
  assert.equal(engine.getStatus().cursor_index, 1)
  assert.equal(engine.getStatus().running, false)
})

test('replay engine status includes trading-day boundary fields', () => {
  const day1 = 1_700_000_000_000
  const day2 = day1 + 24 * 60 * 60 * 1000
  const batch = {
    schema_version: 'market.frames.v1',
    frames: [
      { ...makeFrame({ symbol: '600519.SH', startTsMs: day1, seq: 1 }), window: { start_ts_ms: day1, end_ts_ms: day1 + 60_000, trading_day: '2026-02-10' } },
      { ...makeFrame({ symbol: '600519.SH', startTsMs: day1 + 60_000, seq: 2 }), window: { start_ts_ms: day1 + 60_000, end_ts_ms: day1 + 120_000, trading_day: '2026-02-10' } },
      { ...makeFrame({ symbol: '600519.SH', startTsMs: day2, seq: 3 }), window: { start_ts_ms: day2, end_ts_ms: day2 + 60_000, trading_day: '2026-02-11' } },
    ],
  }

  const engine = createReplayEngine({
    replayBatch: batch,
    initialSpeed: 60,
    initialRunning: false,
    warmupBars: 1,
    loop: false,
  })

  const status1 = engine.getStatus()
  assert.equal(status1.day_count, 2)
  assert.equal(status1.day_index, 1)
  assert.equal(status1.is_day_start, true)
  assert.equal(status1.is_day_end, false)

  engine.step(1)
  const status2 = engine.getStatus()
  assert.equal(status2.day_index, 1)
  assert.equal(status2.is_day_end, true)

  engine.step(1)
  const status3 = engine.getStatus()
  assert.equal(status3.day_index, 2)
  assert.equal(status3.is_day_start, true)
})
