import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createMarketDataService,
  dedupeAndSortFrames,
  normalizePayloadToFrames,
} from '../src/marketProxy.mjs'

const SYMBOL = '600519.SH'
const INTERVAL = '1m'

test('normalizePayloadToFrames converts legacy kline payload to canonical frames', () => {
  const payload = [
    {
      openTime: 1_700_000_120_000,
      open: 11,
      high: 11.3,
      low: 10.8,
      close: 11.1,
      volume: 1200,
      quoteVolume: 13_320,
    },
    {
      openTime: 1_700_000_060_000,
      open: 10,
      high: 10.4,
      low: 9.8,
      close: 10.1,
      volume: 1000,
      quoteVolume: 10_100,
    },
  ]

  const frames = normalizePayloadToFrames(payload, {
    symbol: SYMBOL,
    interval: INTERVAL,
    provider: 'upstream-proxy',
    mode: 'real',
  })

  assert.equal(frames.length, 2)
  assert.equal(frames[0].schema_version, 'market.bar.v1')
  assert.equal(frames[0].window.start_ts_ms, 1_700_000_060_000)
  assert.equal(frames[1].window.start_ts_ms, 1_700_000_120_000)
  assert.equal(frames[1].instrument.symbol, SYMBOL)
  assert.equal(frames[1].bar.close, 11.1)
})

test('dedupeAndSortFrames removes duplicate windows and sorts ascending', () => {
  const frames = [
    {
      schema_version: 'market.bar.v1',
      market: 'CN-A',
      mode: 'mock',
      provider: 'test',
      feed: 'bars',
      seq: 2,
      event_ts_ms: 102,
      ingest_ts_ms: 102,
      instrument: { symbol: SYMBOL, exchange: 'SSE', timezone: 'Asia/Shanghai', currency: 'CNY' },
      interval: INTERVAL,
      window: { start_ts_ms: 60_000, end_ts_ms: 120_000, trading_day: '2026-02-11' },
      session: { phase: 'continuous_am', is_halt: false, is_partial: false },
      bar: { open: 10, high: 11, low: 9.9, close: 10.5, volume_shares: 100, turnover_cny: 1050, vwap: 10.5 },
    },
    {
      schema_version: 'market.bar.v1',
      market: 'CN-A',
      mode: 'mock',
      provider: 'test',
      feed: 'bars',
      seq: 3,
      event_ts_ms: 102,
      ingest_ts_ms: 102,
      instrument: { symbol: SYMBOL, exchange: 'SSE', timezone: 'Asia/Shanghai', currency: 'CNY' },
      interval: INTERVAL,
      window: { start_ts_ms: 60_000, end_ts_ms: 120_000, trading_day: '2026-02-11' },
      session: { phase: 'continuous_am', is_halt: false, is_partial: false },
      bar: { open: 10.2, high: 11.2, low: 10, close: 10.7, volume_shares: 101, turnover_cny: 1080, vwap: 10.7 },
    },
    {
      schema_version: 'market.bar.v1',
      market: 'CN-A',
      mode: 'mock',
      provider: 'test',
      feed: 'bars',
      seq: 1,
      event_ts_ms: 42,
      ingest_ts_ms: 42,
      instrument: { symbol: SYMBOL, exchange: 'SSE', timezone: 'Asia/Shanghai', currency: 'CNY' },
      interval: INTERVAL,
      window: { start_ts_ms: 0, end_ts_ms: 60_000, trading_day: '2026-02-11' },
      session: { phase: 'continuous_am', is_halt: false, is_partial: false },
      bar: { open: 9.8, high: 10.2, low: 9.6, close: 10, volume_shares: 98, turnover_cny: 980, vwap: 10 },
    },
  ]

  const deduped = dedupeAndSortFrames(frames)
  assert.equal(deduped.length, 2)
  assert.deepEqual(
    deduped.map((frame) => frame.window.start_ts_ms),
    [0, 60_000]
  )
})

test('createMarketDataService uses upstream proxy in real mode and falls back to replay', async () => {
  const expectedStart = 1_700_000_060_000
  const replayFrame = {
    schema_version: 'market.bar.v1',
    market: 'CN-A',
    mode: 'mock',
    provider: 'replay-stream',
    feed: 'bars',
    seq: 1,
    event_ts_ms: expectedStart + 60_000,
    ingest_ts_ms: expectedStart + 60_100,
    instrument: { symbol: SYMBOL, exchange: 'SSE', timezone: 'Asia/Shanghai', currency: 'CNY' },
    interval: INTERVAL,
    window: { start_ts_ms: expectedStart, end_ts_ms: expectedStart + 60_000, trading_day: '2026-02-11' },
    session: { phase: 'continuous_am', is_halt: false, is_partial: false },
    bar: { open: 10, high: 10.2, low: 9.9, close: 10.1, volume_shares: 1000, turnover_cny: 10100, vwap: 10.1 },
  }

  const fetchOk = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        data: [
          {
            openTime: expectedStart,
            open: 12,
            high: 12.5,
            low: 11.9,
            close: 12.1,
            volume: 900,
            quoteVolume: 10_890,
          },
        ],
      }
    },
  })

  const serviceReal = createMarketDataService({
    provider: 'real',
    upstreamBaseUrl: 'https://example.invalid/frames',
    upstreamApiKey: 'token',
    replayBatch: { frames: [replayFrame] },
    fetchImpl: fetchOk,
  })

  const realBatch = await serviceReal.getFrames({ symbol: SYMBOL, interval: INTERVAL, limit: 2 })
  assert.equal(realBatch.mode, 'real')
  assert.equal(realBatch.provider, 'upstream-proxy')
  assert.equal(realBatch.frames.length, 1)
  assert.equal(realBatch.frames[0].bar.close, 12.1)

  const fetchFail = async () => {
    throw new Error('provider_down')
  }

  const serviceFallback = createMarketDataService({
    provider: 'real',
    upstreamBaseUrl: 'https://example.invalid/frames',
    replayBatch: { frames: [replayFrame] },
    fetchImpl: fetchFail,
  })

  const fallbackBatch = await serviceFallback.getFrames({ symbol: SYMBOL, interval: INTERVAL, limit: 2 })
  assert.equal(fallbackBatch.mode, 'mock')
  assert.equal(fallbackBatch.provider, 'replay-stream')
  assert.equal(fallbackBatch.frames.length, 1)
  assert.equal(fallbackBatch.frames[0].window.start_ts_ms, expectedStart)
})

test('createMarketDataService serves 1d bars from daily history batch', async () => {
  const symbol = '600519.SH'
  const dailyHistoryFrames = [
    {
      schema_version: 'market.bar.v1',
      market: 'CN-A',
      mode: 'real',
      provider: 'yahoo-finance',
      feed: 'bars',
      seq: 1,
      event_ts_ms: 1_700_000_000_000,
      ingest_ts_ms: 1_700_000_000_250,
      instrument: { symbol, exchange: 'SSE', timezone: 'Asia/Shanghai', currency: 'CNY' },
      interval: '1d',
      window: { start_ts_ms: 1_699_913_600_000, end_ts_ms: 1_700_000_000_000, trading_day: '2023-11-14' },
      session: { phase: 'closed', is_halt: false, is_partial: false },
      bar: { open: 1500, high: 1510, low: 1490, close: 1505, volume_shares: 1000, turnover_cny: 1_505_000, vwap: 1505 },
    },
    {
      schema_version: 'market.bar.v1',
      market: 'CN-A',
      mode: 'real',
      provider: 'yahoo-finance',
      feed: 'bars',
      seq: 2,
      event_ts_ms: 1_700_086_400_000,
      ingest_ts_ms: 1_700_086_400_250,
      instrument: { symbol, exchange: 'SSE', timezone: 'Asia/Shanghai', currency: 'CNY' },
      interval: '1d',
      window: { start_ts_ms: 1_700_000_000_000, end_ts_ms: 1_700_086_400_000, trading_day: '2023-11-15' },
      session: { phase: 'closed', is_halt: false, is_partial: false },
      bar: { open: 1506, high: 1520, low: 1501, close: 1516, volume_shares: 1200, turnover_cny: 1_819_200, vwap: 1516 },
    },
  ]

  const service = createMarketDataService({
    provider: 'mock',
    dailyHistoryBatch: {
      schema_version: 'market.frames.v1',
      market: 'CN-A',
      mode: 'real',
      provider: 'yahoo-finance',
      frames: dailyHistoryFrames,
    },
  })

  const batch = await service.getFrames({ symbol, interval: '1d', limit: 2 })
  assert.equal(batch.mode, 'real')
  assert.equal(batch.provider, 'yahoo-finance')
  assert.equal(batch.frames.length, 2)
  assert.equal(batch.frames[1].bar.close, 1516)
})

test('createMarketDataService uses replay frame provider for advancing 1m replay', async () => {
  const symbol = '600519.SH'
  const replayFrames = [
    {
      schema_version: 'market.bar.v1',
      market: 'CN-A',
      mode: 'mock',
      provider: 'replay-stream',
      feed: 'bars',
      seq: 11,
      event_ts_ms: 1_700_086_460_000,
      ingest_ts_ms: 1_700_086_460_120,
      instrument: { symbol, exchange: 'SSE', timezone: 'Asia/Shanghai', currency: 'CNY' },
      interval: '1m',
      window: { start_ts_ms: 1_700_086_400_000, end_ts_ms: 1_700_086_460_000, trading_day: '2023-11-15' },
      session: { phase: 'continuous_am', is_halt: false, is_partial: false },
      bar: { open: 1510, high: 1511, low: 1509, close: 1510.5, volume_shares: 500, turnover_cny: 755250, vwap: 1510.5 },
    },
  ]

  const service = createMarketDataService({
    provider: 'mock',
    replayBatch: {
      schema_version: 'market.frames.v1',
      market: 'CN-A',
      mode: 'mock',
      provider: 'replay-stream',
      frames: [],
    },
    replayFrameProvider: () => replayFrames,
  })

  const batch = await service.getFrames({ symbol, interval: '1m', limit: 2 })
  assert.equal(batch.frames.length, 1)
  assert.equal(batch.frames[0].bar.close, 1510.5)
})

test('createMarketDataService throws in strict live mode when 1m live frames unavailable', async () => {
  const service = createMarketDataService({
    provider: 'real',
    strictLive: true,
    replayBatch: {
      schema_version: 'market.frames.v1',
      market: 'CN-A',
      mode: 'mock',
      provider: 'replay-stream',
      frames: [],
    },
    replayFrameProvider: () => [],
  })

  await assert.rejects(
    () => service.getFrames({ symbol: SYMBOL, interval: '1m', limit: 2 }),
    (error) => error?.message === 'live_frames_unavailable'
  )
})
