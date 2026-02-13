import test from 'node:test'
import assert from 'node:assert/strict'

import { createDecisionFromContext, createInMemoryAgentRuntime } from '../src/agentDecisionRuntime.mjs'

const trader = {
  trader_id: 't_001',
  trader_name: 'HS300 Momentum',
  ai_model: 'qwen',
}

function makeContext({ ret5 = 0, rsi14 = 50, sma20 = 100, sma60 = 100, price = 101 }) {
  return {
    symbol: '600519.SH',
    intraday: {
      feature_snapshot: {
        ret_5: ret5,
      },
      frames: [{ bar: { close: price } }],
    },
    daily: {
      feature_snapshot: {
        rsi_14: rsi14,
        sma_20: sma20,
        sma_60: sma60,
      },
    },
    position_state: {
      shares: 100,
      avg_cost: 100,
      unrealized_pnl: 50,
      cash_cny: 90_000,
      max_gross_exposure_pct: 1,
    },
  }
}

test('createDecisionFromContext emits buy when intraday momentum and daily trend are positive', () => {
  const decision = createDecisionFromContext({
    trader,
    cycleNumber: 3,
    context: makeContext({ ret5: 0.004, rsi14: 58, sma20: 105, sma60: 100, price: 108 }),
    timestampIso: '2026-02-12T00:00:00.000Z',
  })

  assert.equal(decision.decisions[0].action, 'buy')
  assert.equal(decision.decisions[0].symbol, '600519.SH')
  assert.equal(decision.decisions[0].quantity, 100)
})

test('createDecisionFromContext emits sell when overbought or negative momentum', () => {
  const decision = createDecisionFromContext({
    trader,
    cycleNumber: 9,
    context: makeContext({ ret5: -0.005, rsi14: 78, sma20: 99, sma60: 101, price: 96 }),
    timestampIso: '2026-02-12T00:01:00.000Z',
  })

  assert.equal(decision.decisions[0].action, 'sell')
  assert.equal(decision.decisions[0].quantity, 100)
  assert.equal(typeof decision.decisions[0].realized_pnl, 'number')
})

test('createDecisionFromContext honors trader trading_style from manifest metadata', () => {
  const weakPullbackContext = makeContext({
    ret5: -0.004,
    rsi14: 40,
    sma20: 106,
    sma60: 100,
    price: 98,
  })

  const momentumDecision = createDecisionFromContext({
    trader: {
      trader_id: 'x_momo',
      trader_name: 'Momentum Trader',
      ai_model: 'qwen',
      trading_style: 'momentum_trend',
      risk_profile: 'balanced',
    },
    cycleNumber: 11,
    context: weakPullbackContext,
    timestampIso: '2026-02-12T00:02:00.000Z',
  })

  const meanReversionDecision = createDecisionFromContext({
    trader: {
      trader_id: 'x_revert',
      trader_name: 'Reversion Trader',
      ai_model: 'qwen',
      trading_style: 'mean_reversion',
      risk_profile: 'balanced',
    },
    cycleNumber: 11,
    context: weakPullbackContext,
    timestampIso: '2026-02-12T00:02:00.000Z',
  })

  assert.equal(momentumDecision.decisions[0].action, 'sell')
  assert.equal(meanReversionDecision.decisions[0].action, 'buy')
})

test('in-memory runtime stores per-trader latest decisions and metrics', async () => {
  const runtime = createInMemoryAgentRuntime({
    traders: [trader],
    maxHistory: 5,
    nowFn: () => new Date('2026-02-12T00:02:00.000Z').getTime(),
    evaluateTrader: async () => ({
      context: makeContext({ ret5: 0.001, rsi14: 55, sma20: 104, sma60: 103, price: 110 }),
      cycleNumber: 1,
    }),
  })

  await runtime.runCycleOnce()
  await runtime.runCycleOnce()

  const latest = runtime.getLatestDecisions('t_001', 2)
  assert.equal(latest.length, 2)
  assert.equal(latest[0].cycle_number, 2)
  assert.equal(latest[1].cycle_number, 1)

  const metrics = runtime.getMetrics()
  assert.equal(metrics.totalCycles, 2)
  assert.equal(metrics.successfulCycles, 2)
  assert.equal(metrics.failedCycles, 0)
  assert.equal(runtime.getCallCount('t_001'), 2)
})

test('runtime supports pause/resume/step and cycle speed controls', async () => {
  const runtime = createInMemoryAgentRuntime({
    traders: [trader],
    maxHistory: 5,
    nowFn: () => new Date('2026-02-12T00:03:00.000Z').getTime(),
    evaluateTrader: async ({ trader_id }, { cycleNumber }) => ({
      context: makeContext({ ret5: trader_id === 't_001' ? 0.003 : 0, rsi14: 54, sma20: 103, sma60: 100, price: 112 }),
      cycleNumber,
    }),
  })

  const initial = runtime.getState()
  assert.equal(initial.running, false)
  assert.equal(initial.cycle_ms, 15000)

  runtime.setCycleMs(9000)
  assert.equal(runtime.getState().cycle_ms, 9000)

  runtime.resume()
  assert.equal(runtime.getState().running, true)

  runtime.pause()
  assert.equal(runtime.getState().running, false)

  await runtime.stepOnce()
  assert.equal(runtime.getCallCount('t_001'), 1)
})

test('runtime supports external-clock mode with running state but no internal timer', async () => {
  const runtime = createInMemoryAgentRuntime({
    traders: [trader],
    autoTimer: false,
    maxHistory: 5,
    nowFn: () => new Date('2026-02-12T00:04:00.000Z').getTime(),
    evaluateTrader: async () => ({
      context: makeContext({ ret5: 0.002, rsi14: 55, sma20: 105, sma60: 101, price: 113 }),
      cycleNumber: 1,
    }),
  })

  assert.equal(runtime.getState().running, false)
  runtime.resume()
  assert.equal(runtime.getState().running, true)
  assert.equal(runtime.getCallCount('t_001'), 0)

  await runtime.runCycleOnce()
  assert.equal(runtime.getCallCount('t_001'), 1)

  runtime.pause()
  assert.equal(runtime.getState().running, false)
})

test('runtime invokes onDecision callback with trader and decision payload', async () => {
  const recorded = []
  const runtime = createInMemoryAgentRuntime({
    traders: [trader],
    autoTimer: false,
    maxHistory: 5,
    nowFn: () => new Date('2026-02-12T00:05:00.000Z').getTime(),
    evaluateTrader: async () => ({
      context: makeContext({ ret5: 0.003, rsi14: 57, sma20: 106, sma60: 100, price: 115 }),
      cycleNumber: 1,
    }),
    onDecision: async (payload) => {
      recorded.push(payload)
    },
  })

  runtime.resume()
  await runtime.runCycleOnce()

  assert.equal(recorded.length, 1)
  assert.equal(recorded[0].trader.trader_id, 't_001')
  assert.equal(recorded[0].decision.cycle_number, 1)
  assert.equal(recorded[0].decision.decisions[0].symbol, '600519.SH')
})

test('runtime reset clears decisions, call counts, and metrics', async () => {
  const runtime = createInMemoryAgentRuntime({
    traders: [trader],
    autoTimer: false,
    maxHistory: 5,
    nowFn: () => new Date('2026-02-12T00:06:00.000Z').getTime(),
    evaluateTrader: async () => ({
      context: makeContext({ ret5: 0.003, rsi14: 57, sma20: 106, sma60: 100, price: 115 }),
      cycleNumber: 1,
    }),
  })

  runtime.resume()
  await runtime.runCycleOnce()
  await runtime.runCycleOnce()

  assert.equal(runtime.getLatestDecisions('t_001', 5).length, 2)
  assert.equal(runtime.getCallCount('t_001'), 2)
  assert.equal(runtime.getMetrics().totalCycles, 2)

  const resetPayload = runtime.reset()
  assert.equal(resetPayload.metrics.totalCycles, 0)
  assert.equal(runtime.getLatestDecisions('t_001', 5).length, 0)
  assert.equal(runtime.getCallCount('t_001'), 0)
})

test('runtime supports replacing trader set at runtime', async () => {
  const traderA = {
    trader_id: 't_001',
    trader_name: 'HS300 Momentum',
    ai_model: 'qwen',
  }
  const traderB = {
    trader_id: 't_002',
    trader_name: 'Value Rebound',
    ai_model: 'deepseek',
  }

  const runtime = createInMemoryAgentRuntime({
    traders: [traderA],
    autoTimer: false,
    maxHistory: 5,
    nowFn: () => new Date('2026-02-12T00:07:00.000Z').getTime(),
    evaluateTrader: async ({ trader_id }, { cycleNumber }) => ({
      context: makeContext({
        ret5: trader_id === 't_001' ? 0.003 : 0.002,
        rsi14: 56,
        sma20: 106,
        sma60: 101,
        price: trader_id === 't_001' ? 111 : 109,
      }),
      cycleNumber,
    }),
  })

  await runtime.stepOnce()
  assert.equal(runtime.getCallCount('t_001'), 1)
  assert.equal(runtime.getCallCount('t_002'), 0)

  runtime.setTraders([traderA, traderB])
  await runtime.stepOnce()
  assert.equal(runtime.getCallCount('t_001'), 2)
  assert.equal(runtime.getCallCount('t_002'), 1)

  runtime.setTraders([traderB])
  await runtime.stepOnce()
  assert.equal(runtime.getCallCount('t_001'), 0)
  assert.equal(runtime.getCallCount('t_002'), 2)
})
