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
  assert.equal(Array.isArray(decision.reasoning_steps_cn), true)
  assert.equal(decision.reasoning_steps_cn.length >= 2, true)
  assert.equal(decision.reasoning_steps_cn.length <= 4, true)
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

test('createDecisionFromContext guards sell when no holdings on target symbol', () => {
  const context = makeContext({ ret5: -0.005, rsi14: 78, sma20: 99, sma60: 101, price: 96 })
  context.position_state.shares = 0
  context.memory_state = {
    holdings: [
      {
        symbol: '300750.SZ',
        shares: 200,
        avg_cost: 300,
        mark_price: 305,
      },
    ],
  }

  const decision = createDecisionFromContext({
    trader,
    cycleNumber: 9,
    context,
    timestampIso: '2026-02-12T00:01:30.000Z',
  })

  assert.equal(decision.decisions[0].action, 'hold')
  assert.equal(decision.success, true)
  assert.equal(decision.error_message, '')
  assert.match(decision.decisions[0].reasoning, /ignore sell without holdings/)
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

test('createDecisionFromContext reasoning includes market overview and news digest context', () => {
  const context = makeContext({ ret5: 0.003, rsi14: 56, sma20: 106, sma60: 100, price: 108 })
  context.market_overview = { brief: '两市成交回暖，权重与科技轮动。' }
  context.news_digest = { titles: ['央行公开市场操作平稳', '海外股指夜盘走强'] }

  const decision = createDecisionFromContext({
    trader,
    cycleNumber: 12,
    context,
    timestampIso: '2026-02-12T00:02:30.000Z',
  })

  assert.match(decision.decisions[0].reasoning, /market=/)
  assert.match(decision.decisions[0].reasoning, /news=/)
})

test('createDecisionFromContext allows conservative probe buy on controlled pullback', () => {
  const context = makeContext({ ret5: -0.0042, rsi14: 60, sma20: 106, sma60: 100, price: 98 })
  context.position_state.shares = 0
  context.position_state.cash_cny = 100_000
  context.memory_state = { holdings: [] }
  context.llm_decision = {
    source: 'openai',
    action: 'hold',
    symbol: '600519.SH',
    confidence: 0.61,
    quantity: 0,
    reasoning: '信号一般，先观察。',
  }

  const decision = createDecisionFromContext({
    trader: {
      trader_id: 'x_revert_cons',
      trader_name: 'Conservative Reversion',
      ai_model: 'deepseek',
      trading_style: 'mean_reversion',
      risk_profile: 'conservative',
    },
    cycleNumber: 12,
    context,
    timestampIso: '2026-02-12T00:02:40.000Z',
  })

  assert.equal(decision.decisions[0].action, 'buy')
  assert.equal(decision.decisions[0].requested_quantity, 100)
  assert.equal(decision.decisions[0].quantity, 100)
  assert.match(decision.decisions[0].reasoning, /conservative probe-entry/)
})

test('createDecisionFromContext guards unaffordable buy to hold without failure', () => {
  const context = makeContext({ ret5: 0.005, rsi14: 55, sma20: 106, sma60: 100, price: 2000 })
  context.position_state.cash_cny = 100_000
  context.runtime_config = {
    max_symbol_concentration_pct: 1,
  }

  const decision = createDecisionFromContext({
    trader,
    cycleNumber: 15,
    context,
    timestampIso: '2026-02-12T00:03:00.000Z',
  })

  assert.equal(decision.decisions[0].action, 'hold')
  assert.equal(decision.decisions[0].success, true)
  assert.equal(decision.success, true)
  assert.equal(decision.error_message, '')
  assert.match(decision.decisions[0].reasoning, /insufficient cash for one lot/)
})

test('createDecisionFromContext applies opening-phase quantity and confidence caps', () => {
  const context = makeContext({ ret5: 0.004, rsi14: 58, sma20: 106, sma60: 100, price: 108 })
  context.runtime_config = {
    opening_phase_mode: 'true',
    opening_phase_max_lots: 1,
    opening_phase_max_confidence: 0.62,
  }
  context.llm_decision = {
    source: 'openai',
    action: 'buy',
    confidence: 0.93,
    quantity: 900,
    reasoning: 'opening move confirmation',
  }

  const decision = createDecisionFromContext({
    trader,
    cycleNumber: 16,
    context,
    timestampIso: '2026-02-12T00:03:30.000Z',
  })

  assert.equal(decision.decisions[0].action, 'buy')
  assert.equal(decision.decisions[0].requested_quantity, 100)
  assert.equal(decision.decisions[0].confidence, 0.62)
  assert.match(decision.decisions[0].reasoning, /opening-phase cap/)
})

test('createDecisionFromContext executes llm-selected symbol from candidate set', () => {
  const context = makeContext({ ret5: 0.001, rsi14: 56, sma20: 106, sma60: 100, price: 108 })
  context.candidate_set = {
    symbols: ['600519.SH', '300750.SZ'],
    selected_symbol: '600519.SH',
    items: [
      { symbol: '600519.SH', latest_price: 108, ret_5: 0.001, ret_20: 0.002, rank_score: 2 },
      { symbol: '300750.SZ', latest_price: 220, ret_5: -0.004, ret_20: -0.008, rank_score: 1 },
    ],
  }
  context.memory_state = {
    holdings: [
      {
        symbol: '300750.SZ',
        shares: 200,
        avg_cost: 230,
        mark_price: 220,
      },
    ],
  }
  context.llm_decision = {
    source: 'openai',
    action: 'sell',
    symbol: '300750.SZ',
    confidence: 0.77,
    quantity: 100,
    reasoning: '候选股走弱，优先减仓。',
  }

  const decision = createDecisionFromContext({
    trader,
    cycleNumber: 17,
    context,
    timestampIso: '2026-02-12T00:04:00.000Z',
  })

  assert.equal(decision.decisions[0].symbol, '300750.SZ')
  assert.equal(decision.decisions[0].action, 'sell')
  assert.equal(decision.decisions[0].quantity, 100)
  assert.deepEqual(decision.candidate_coins, ['600519.SH', '300750.SZ'])
})

test('createDecisionFromContext blocks new buy when max position count reached', () => {
  const context = makeContext({ ret5: 0.003, rsi14: 55, sma20: 106, sma60: 100, price: 108 })
  context.symbol = '600519.SH'
  context.memory_state = {
    holdings: [
      { symbol: '000001.SZ', shares: 100, avg_cost: 10, mark_price: 10 },
      { symbol: '300750.SZ', shares: 100, avg_cost: 220, mark_price: 220 },
      { symbol: '601318.SH', shares: 100, avg_cost: 50, mark_price: 50 },
    ],
  }
  context.runtime_config = {
    max_position_count: 3,
  }
  context.llm_decision = {
    source: 'openai',
    action: 'buy',
    symbol: '600519.SH',
    confidence: 0.8,
    quantity: 300,
    reasoning: '尝试开新仓。',
  }

  const decision = createDecisionFromContext({
    trader,
    cycleNumber: 18,
    context,
    timestampIso: '2026-02-12T00:04:30.000Z',
  })

  assert.equal(decision.decisions[0].action, 'hold')
  assert.match(decision.decisions[0].reasoning, /max position count/i)
})

test('createDecisionFromContext clips quantity by concentration and reserve guardrails', () => {
  const context = makeContext({ ret5: 0.004, rsi14: 58, sma20: 106, sma60: 100, price: 100 })
  context.position_state.shares = 0
  context.position_state.cash_cny = 100_000
  context.memory_state = {
    holdings: [],
  }
  context.runtime_config = {
    max_symbol_concentration_pct: 0.2,
    min_cash_reserve_pct: 0.5,
    turnover_throttle_pct: 1,
  }
  context.llm_decision = {
    source: 'openai',
    action: 'buy',
    symbol: '600519.SH',
    confidence: 0.82,
    quantity: 1000,
    reasoning: '放量突破，计划加仓。',
  }

  const decision = createDecisionFromContext({
    trader,
    cycleNumber: 19,
    context,
    timestampIso: '2026-02-12T00:05:00.000Z',
  })

  assert.equal(decision.decisions[0].action, 'buy')
  assert.equal(decision.decisions[0].requested_quantity, 200)
  assert.equal(decision.decisions[0].quantity, 200)
  assert.match(decision.decisions[0].reasoning, /concentration|cash reserve/i)
})

test('createDecisionFromContext clips turnover for oversized sell orders', () => {
  const context = makeContext({ ret5: -0.004, rsi14: 74, sma20: 99, sma60: 101, price: 100 })
  context.position_state.shares = 1000
  context.position_state.cash_cny = 0
  context.memory_state = {
    holdings: [
      { symbol: '600519.SH', shares: 1000, avg_cost: 95, mark_price: 100 },
    ],
  }
  context.runtime_config = {
    turnover_throttle_pct: 0.1,
  }
  context.llm_decision = {
    source: 'openai',
    action: 'sell',
    symbol: '600519.SH',
    confidence: 0.84,
    quantity: 800,
    reasoning: '风险上升，计划快速降仓。',
  }

  const decision = createDecisionFromContext({
    trader,
    cycleNumber: 20,
    context,
    timestampIso: '2026-02-12T00:05:30.000Z',
  })

  assert.equal(decision.decisions[0].action, 'sell')
  assert.equal(decision.decisions[0].requested_quantity, 100)
  assert.equal(decision.decisions[0].quantity, 100)
  assert.match(decision.decisions[0].reasoning, /turnover throttle/i)
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
