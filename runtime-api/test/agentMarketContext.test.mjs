import test from 'node:test'
import assert from 'node:assert/strict'

import { buildAgentMarketContext, buildPositionState } from '../src/agentMarketContext.mjs'

function makeFrame({
  symbol = '600519.SH',
  interval = '1m',
  index,
  close,
  volume = 1_000,
}) {
  const baseTs = 1_700_000_000_000
  const step = interval === '1d' ? 24 * 60 * 60 * 1000 : 60_000
  const start = baseTs + index * step
  return {
    schema_version: 'market.bar.v1',
    market: 'CN-A',
    mode: 'real',
    provider: 'test-feed',
    feed: 'bars',
    seq: index + 1,
    event_ts_ms: start + step,
    ingest_ts_ms: start + step + 100,
    instrument: {
      symbol,
      exchange: symbol.endsWith('.SH') ? 'SSE' : 'SZSE',
      timezone: 'Asia/Shanghai',
      currency: 'CNY',
    },
    interval,
    window: {
      start_ts_ms: start,
      end_ts_ms: start + step,
      trading_day: '2026-02-11',
    },
    session: {
      phase: 'continuous_am',
      is_halt: false,
      is_partial: false,
    },
    bar: {
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume_shares: volume,
      turnover_cny: close * volume,
      vwap: close,
    },
  }
}

test('buildPositionState maps account and symbol position', () => {
  const state = buildPositionState({
    symbol: '600519.SH',
    account: { available_balance: 91_000 },
    positions: [
      { symbol: '300750.SZ', quantity: 300, entry_price: 186.2, unrealized_pnl: -500 },
      { symbol: '600519.SH', quantity: 100, entry_price: 1501.1, unrealized_pnl: 300 },
    ],
  })

  assert.deepEqual(state, {
    shares: 100,
    avg_cost: 1501.1,
    unrealized_pnl: 300,
    cash_cny: 91_000,
    total_balance_cny: 0,
    total_unrealized_pnl_cny: 0,
    max_gross_exposure_pct: 1,
  })
})

test('buildAgentMarketContext returns feature snapshots for intraday and daily data', () => {
  const intradayFrames = Array.from({ length: 25 }, (_, i) =>
    makeFrame({ interval: '1m', index: i, close: 100 + i, volume: 1_000 })
  )
  const dailyFrames = Array.from({ length: 70 }, (_, i) =>
    makeFrame({ interval: '1d', index: i, close: 200 + i, volume: 2_000 })
  )

  const context = buildAgentMarketContext({
    symbol: '600519.SH',
    asOfTsMs: intradayFrames[intradayFrames.length - 1].event_ts_ms,
    intradayBatch: {
      schema_version: 'market.frames.v1',
      market: 'CN-A',
      mode: 'real',
      provider: 'replay-stream',
      frames: intradayFrames,
    },
    dailyBatch: {
      schema_version: 'market.frames.v1',
      market: 'CN-A',
      mode: 'real',
      provider: 'daily-history',
      frames: dailyFrames,
    },
    positionState: {
      shares: 100,
      avg_cost: 210,
      unrealized_pnl: 320,
      cash_cny: 80_000,
      max_gross_exposure_pct: 1,
    },
  })

  assert.equal(context.schema_version, 'agent.market_context.v1')
  assert.equal(context.symbol, '600519.SH')
  assert.equal(context.intraday.interval, '1m')
  assert.equal(context.daily.interval, '1d')
  assert.equal(context.intraday.frames.length, 25)
  assert.equal(context.daily.frames.length, 70)

  assert.equal(context.intraday.feature_snapshot.ret_5, 0.042017)
  assert.equal(context.intraday.feature_snapshot.ret_20, 0.192308)
  assert.equal(context.intraday.feature_snapshot.atr_14, 2)
  assert.equal(context.intraday.feature_snapshot.vol_ratio_20, 1)

  assert.equal(context.daily.feature_snapshot.sma_20, 259.5)
  assert.equal(context.daily.feature_snapshot.sma_60, 239.5)
  assert.equal(context.daily.feature_snapshot.rsi_14, 100)
  assert.equal(context.daily.feature_snapshot.range_20d_pct, 0.078067)

  assert.equal(typeof context.daily.price_volume_windows?.past_6m?.price_change_pct, 'number')
  assert.equal(typeof context.daily.price_volume_windows?.past_1m?.price_change_pct, 'number')
  assert.equal(typeof context.daily.price_volume_windows?.past_1w?.price_change_pct, 'number')
  assert.equal(typeof context.daily.price_volume_windows?.past_1d?.price_change_pct, 'number')
  assert.equal(Array.isArray(context.daily.price_volume_reference_lines), true)
  assert.equal(context.daily.price_volume_reference_lines.length, 4)
  assert.match(context.daily.price_volume_descriptions.past_6m, /past 6 months/i)
  assert.match(context.daily.price_volume_descriptions.past_1m, /past 1 month/i)
  assert.match(context.daily.price_volume_descriptions.past_1w, /past 1 week/i)
  assert.match(context.daily.price_volume_descriptions.past_1d, /past 1 day/i)
})
