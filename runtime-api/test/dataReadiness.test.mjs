import test from 'node:test'
import assert from 'node:assert/strict'

import { evaluateDataReadiness } from '../src/dataReadiness.mjs'

test('readiness is ERROR when frames are insufficient', () => {
  const readiness = evaluateDataReadiness({
    context: {
      as_of_ts_ms: Date.now(),
      intraday: { feature_snapshot: { ret_5: 0, ret_20: 0, atr_14: 1, vol_ratio_20: 1 } },
      daily: { feature_snapshot: { sma_20: 1, sma_60: 1, rsi_14: 50 } },
    },
    intradayFrames: new Array(10).fill({}),
    dailyFrames: new Array(10).fill({}),
  })

  assert.equal(readiness.level, 'ERROR')
  assert.ok(readiness.reasons.includes('intraday_frames_insufficient'))
  assert.ok(readiness.reasons.includes('daily_frames_insufficient'))
})

test('readiness is WARN when data is stale but not too stale', () => {
  const now = Date.now()
  const readiness = evaluateDataReadiness({
    context: {
      as_of_ts_ms: now - 200_000,
      intraday: { feature_snapshot: { ret_5: 0.001, ret_20: 0.002, atr_14: 1, vol_ratio_20: 1 } },
      daily: { feature_snapshot: { sma_20: 1, sma_60: 1, rsi_14: 50 } },
    },
    intradayFrames: new Array(60).fill({}),
    dailyFrames: new Array(90).fill({}),
    nowMs: now,
    freshnessWarnMs: 150_000,
    freshnessErrorMs: 330_000,
  })

  assert.equal(readiness.level, 'WARN')
  assert.ok(readiness.reasons.includes('data_stale'))
})

test('readiness is WARN in opening phase when only long-lookback intraday features are pending', () => {
  const now = Date.now()
  const readiness = evaluateDataReadiness({
    context: {
      as_of_ts_ms: now,
      intraday: { feature_snapshot: { ret_5: 0.001, ret_20: null, atr_14: null, vol_ratio_20: null } },
      daily: { feature_snapshot: { sma_20: 1, sma_60: 1, rsi_14: 50 } },
    },
    intradayFrames: new Array(6).fill({}),
    dailyFrames: new Array(90).fill({}),
    nowMs: now,
    minIntradayFrames: 21,
    minDailyFrames: 61,
    openingPhaseEnabled: true,
    openingPhaseMinIntradayFrames: 2,
  })

  assert.equal(readiness.level, 'WARN')
  assert.equal(readiness.opening_phase_active, true)
  assert.ok(readiness.reasons.includes('opening_phase_limited_intraday_history'))
  assert.ok(readiness.reasons.some((r) => String(r).startsWith('feature_pending:intraday.ret_20')))
})

test('readiness stays ERROR when core intraday feature is missing during opening phase', () => {
  const now = Date.now()
  const readiness = evaluateDataReadiness({
    context: {
      as_of_ts_ms: now,
      intraday: { feature_snapshot: { ret_5: null, ret_20: null, atr_14: null, vol_ratio_20: null } },
      daily: { feature_snapshot: { sma_20: 1, sma_60: 1, rsi_14: 50 } },
    },
    intradayFrames: new Array(6).fill({}),
    dailyFrames: new Array(90).fill({}),
    nowMs: now,
    minIntradayFrames: 21,
    minDailyFrames: 61,
    openingPhaseEnabled: true,
    openingPhaseMinIntradayFrames: 2,
  })

  assert.equal(readiness.level, 'ERROR')
  assert.equal(readiness.opening_phase_active, false)
  assert.ok(readiness.reasons.some((r) => String(r).startsWith('feature_missing:intraday.ret_5')))
})

test('readiness is ERROR when required features are missing', () => {
  const readiness = evaluateDataReadiness({
    context: {
      as_of_ts_ms: Date.now(),
      intraday: { feature_snapshot: { ret_5: null, ret_20: null } },
      daily: { feature_snapshot: { sma_20: 1, sma_60: 1, rsi_14: 50 } },
    },
    intradayFrames: new Array(60).fill({}),
    dailyFrames: new Array(90).fill({}),
  })

  assert.equal(readiness.level, 'ERROR')
  assert.ok(readiness.reasons.some((r) => String(r).startsWith('feature_missing:intraday.ret_5')))
})
