import test from 'node:test'
import assert from 'node:assert/strict'

import {
  resolveProactiveCadence,
  selectNewsBurstSignal,
} from '../src/chat/newsBurst.mjs'

test('selectNewsBurstSignal picks freshest high-priority headline', () => {
  const now = Date.now()
  const signal = selectNewsBurstSignal({
    headlines: [
      { title: '半导体景气延续', category: 'tech', published_ts_ms: now - 60_000, score: 2 },
      { title: '中东局势升级影响油价', category: 'geopolitics', published_ts_ms: now - 120_000, score: 1 },
      { title: '旧AI新闻', category: 'ai', published_ts_ms: now - 3_600_000, score: 5 },
    ],
    nowMs: now,
    freshWindowMs: 15 * 60_000,
    minPriority: 2,
  })

  assert.equal(signal?.category, 'geopolitics')
  assert.equal(typeof signal?.key, 'string')
  assert.equal(Boolean(signal?.title), true)
})

test('selectNewsBurstSignal ignores stale and low-priority headlines', () => {
  const now = Date.now()
  const signal = selectNewsBurstSignal({
    headlines: [
      { title: '市场情绪回暖', category: 'markets_cn', published_ts_ms: now - 30_000, score: 3 },
      { title: '旧宏观标题', category: 'global_macro', published_ts_ms: now - 5 * 3_600_000, score: 1 },
    ],
    nowMs: now,
    freshWindowMs: 20 * 60_000,
    minPriority: 3,
  })

  assert.equal(signal, null)
})

test('resolveProactiveCadence enters burst on fresh signal and enforces cooldown', () => {
  const now = Date.now()
  const signal = {
    key: 'geopolitics|1',
    category: 'geopolitics',
    priority: 4,
    title: '地缘冲突升级',
    published_ts_ms: now - 30_000,
  }

  const entered = resolveProactiveCadence({
    nowMs: now,
    defaultIntervalMs: 18_000,
    burstIntervalMs: 9_000,
    burstDurationMs: 120_000,
    cooldownMs: 480_000,
    previousState: null,
    burstSignal: signal,
  })

  assert.equal(entered.triggered, true)
  assert.equal(entered.activeBurst, true)
  assert.equal(entered.intervalMs, 9_000)

  const duringCooldown = resolveProactiveCadence({
    nowMs: now + 180_000,
    defaultIntervalMs: 18_000,
    burstIntervalMs: 9_000,
    burstDurationMs: 120_000,
    cooldownMs: 480_000,
    previousState: entered.state,
    burstSignal: signal,
  })

  assert.equal(duringCooldown.triggered, false)
  assert.equal(duringCooldown.activeBurst, false)
  assert.equal(duringCooldown.intervalMs, 18_000)

  const afterCooldown = resolveProactiveCadence({
    nowMs: now + 500_000,
    defaultIntervalMs: 18_000,
    burstIntervalMs: 9_000,
    burstDurationMs: 120_000,
    cooldownMs: 480_000,
    previousState: duringCooldown.state,
    burstSignal: {
      ...signal,
      key: 'geopolitics|2',
      title: '地缘风险继续发酵',
      published_ts_ms: now + 490_000,
    },
  })

  assert.equal(afterCooldown.triggered, true)
  assert.equal(afterCooldown.activeBurst, true)
  assert.equal(afterCooldown.intervalMs, 9_000)
})
