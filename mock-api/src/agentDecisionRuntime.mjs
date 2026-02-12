function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function toSafeNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function decideAction(context) {
  const ret5 = toSafeNumber(context?.intraday?.feature_snapshot?.ret_5, 0)
  const rsi14 = toSafeNumber(context?.daily?.feature_snapshot?.rsi_14, 50)
  const sma20 = toSafeNumber(context?.daily?.feature_snapshot?.sma_20, 0)
  const sma60 = toSafeNumber(context?.daily?.feature_snapshot?.sma_60, 0)

  const bullishTrend = sma20 > 0 && sma60 > 0 && sma20 >= sma60
  const bearishTrend = sma20 > 0 && sma60 > 0 && sma20 < sma60

  if (ret5 <= -0.002 || rsi14 >= 72 || bearishTrend) {
    return 'sell'
  }

  if (ret5 >= 0.002 && bullishTrend && rsi14 <= 70) {
    return 'buy'
  }

  return 'hold'
}

function confidenceFromContext(context, action) {
  const ret5 = Math.abs(toSafeNumber(context?.intraday?.feature_snapshot?.ret_5, 0))
  const rsi14 = toSafeNumber(context?.daily?.feature_snapshot?.rsi_14, 50)
  let base = 0.56 + clamp(ret5 * 18, 0, 0.2)

  if (action === 'buy' && rsi14 < 65) {
    base += 0.04
  }
  if (action === 'sell' && rsi14 > 70) {
    base += 0.04
  }

  return Number(clamp(base, 0.51, 0.92).toFixed(2))
}

function latestPrice(context) {
  const frames = context?.intraday?.frames || []
  const latest = frames[frames.length - 1]
  const close = toSafeNumber(latest?.bar?.close, 0)
  return close > 0 ? close : 100
}

function buildReasoning(action, context) {
  const ret5 = toSafeNumber(context?.intraday?.feature_snapshot?.ret_5, 0)
  const rsi14 = toSafeNumber(context?.daily?.feature_snapshot?.rsi_14, 50)
  const sma20 = toSafeNumber(context?.daily?.feature_snapshot?.sma_20, 0)
  const sma60 = toSafeNumber(context?.daily?.feature_snapshot?.sma_60, 0)

  if (action === 'buy') {
    return `Momentum positive (ret5=${ret5.toFixed(4)}), trend supportive (SMA20 ${sma20.toFixed(2)} >= SMA60 ${sma60.toFixed(2)}), RSI=${rsi14.toFixed(1)}.`
  }
  if (action === 'sell') {
    return `Risk-off signal (ret5=${ret5.toFixed(4)}, RSI=${rsi14.toFixed(1)}, trend ${sma20.toFixed(2)} vs ${sma60.toFixed(2)}).`
  }
  return `No strong edge (ret5=${ret5.toFixed(4)}, RSI=${rsi14.toFixed(1)}), hold for confirmation.`
}

function sortByCycleDesc(a, b) {
  return toSafeNumber(b?.cycle_number, 0) - toSafeNumber(a?.cycle_number, 0)
}

export function createDecisionFromContext({ trader, cycleNumber, context, timestampIso }) {
  const action = decideAction(context)
  const symbol = context?.symbol || '600519.SH'
  const price = latestPrice(context)
  const confidence = confidenceFromContext(context, action)
  const quantity = action === 'hold' ? 0 : 100

  const stopLoss = action === 'buy'
    ? Number((price * 0.985).toFixed(2))
    : Number((price * 1.015).toFixed(2))
  const takeProfit = action === 'buy'
    ? Number((price * 1.02).toFixed(2))
    : Number((price * 0.98).toFixed(2))

  const decision = {
    timestamp: timestampIso,
    cycle_number: cycleNumber,
    system_prompt: 'agent.market_context.v1',
    input_prompt: `Evaluate ${symbol} using intraday + daily context`,
    cot_trace: 'compressed-mock-runtime-rationale',
    decision_json: JSON.stringify({ action, symbol }),
    account_state: {
      total_balance: toSafeNumber(context?.position_state?.cash_cny, 0) + toSafeNumber(context?.position_state?.shares, 0) * price,
      available_balance: toSafeNumber(context?.position_state?.cash_cny, 0),
      total_unrealized_profit: toSafeNumber(context?.position_state?.unrealized_pnl, 0),
      position_count: toSafeNumber(context?.position_state?.shares, 0) > 0 ? 1 : 0,
      margin_used_pct: 0,
    },
    positions: [],
    candidate_coins: [symbol],
    decisions: [
      {
        action,
        symbol,
        quantity,
        leverage: 1,
        price: Number(price.toFixed(2)),
        stop_loss: stopLoss,
        take_profit: takeProfit,
        confidence,
        reasoning: buildReasoning(action, context),
        order_id: 100000 + cycleNumber,
        timestamp: timestampIso,
        success: true,
      },
    ],
    execution_log: [
      `${new Date(timestampIso).toISOString()} | ${trader.trader_name} -> ${action.toUpperCase()} ${symbol} @ ${price.toFixed(2)}`,
    ],
    success: true,
    error_message: '',
  }

  return decision
}

export function createInMemoryAgentRuntime({
  traders,
  evaluateTrader,
  nowFn = Date.now,
  cycleMs = 15_000,
  maxHistory = 120,
  autoTimer = true,
} = {}) {
  const safeTraders = Array.isArray(traders) ? traders : []
  const historyLimit = clamp(toSafeNumber(maxHistory, 120), 20, 500)
  const decisionsByTrader = new Map(safeTraders.map((trader) => [trader.trader_id, []]))
  const callsByTrader = new Map(safeTraders.map((trader) => [trader.trader_id, 0]))
  const evaluate = typeof evaluateTrader === 'function' ? evaluateTrader : async () => ({ context: null })
  let totalCycles = 0
  let successfulCycles = 0
  let failedCycles = 0
  let timer = null
  let running = false
  let cycleInFlight = false
  let lastCycleStartedMs = null
  let lastCycleCompletedMs = null
  let currentCycleMs = clamp(toSafeNumber(cycleMs, 15_000), 3_000, 120_000)

  async function evaluateOne(trader) {
    const cycleNumber = toSafeNumber(callsByTrader.get(trader.trader_id), 0) + 1
    try {
      const payload = await evaluate(trader, { cycleNumber })
      const context = payload?.context
      if (!context) {
        throw new Error('missing_context')
      }

      const payloadCycle = toSafeNumber(payload?.cycleNumber, cycleNumber)
      const effectiveCycle = Math.max(cycleNumber, payloadCycle)
      const timestampIso = new Date(nowFn()).toISOString()
      const decision = createDecisionFromContext({
        trader,
        cycleNumber: effectiveCycle,
        context,
        timestampIso,
      })

      const list = decisionsByTrader.get(trader.trader_id) || []
      list.unshift(decision)
      decisionsByTrader.set(trader.trader_id, list.slice(0, historyLimit))
      callsByTrader.set(trader.trader_id, effectiveCycle)
      successfulCycles += 1
    } catch {
      failedCycles += 1
    } finally {
      totalCycles += 1
    }
  }

  async function runCycleOnce() {
    if (cycleInFlight) {
      return false
    }

    cycleInFlight = true
    lastCycleStartedMs = nowFn()
    try {
      for (const trader of safeTraders) {
        await evaluateOne(trader)
      }
      return true
    } finally {
      lastCycleCompletedMs = nowFn()
      cycleInFlight = false
    }
  }

  function getLatestDecisions(traderId, limit = 5) {
    const maxItems = clamp(toSafeNumber(limit, 5), 1, historyLimit)

    if (traderId) {
      const list = decisionsByTrader.get(traderId) || []
      return list.slice(0, maxItems)
    }

    return Array.from(decisionsByTrader.values())
      .flat()
      .sort(sortByCycleDesc)
      .slice(0, maxItems)
  }

  function getCallCount(traderId) {
    return toSafeNumber(callsByTrader.get(traderId), 0)
  }

  function getMetrics() {
    return {
      totalCycles,
      successfulCycles,
      failedCycles,
    }
  }

  function scheduleTimer() {
    if (!autoTimer || !running) return
    if (timer) {
      clearInterval(timer)
    }
    timer = setInterval(() => {
      runCycleOnce().catch(() => {})
    }, currentCycleMs)
  }

  function resume() {
    if (running) return false
    running = true
    scheduleTimer()
    return true
  }

  function pause() {
    if (!running) return false
    running = false
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    return true
  }

  function setCycleMs(nextCycleMs) {
    currentCycleMs = clamp(toSafeNumber(nextCycleMs, currentCycleMs), 3_000, 120_000)
    if (timer) {
      scheduleTimer()
    }
    return currentCycleMs
  }

  function getState() {
    return {
      running,
      cycle_ms: currentCycleMs,
      in_flight: cycleInFlight,
      last_cycle_started_ms: lastCycleStartedMs,
      last_cycle_completed_ms: lastCycleCompletedMs,
    }
  }

  async function stepOnce() {
    await runCycleOnce()
  }

  function start() {
    return resume()
  }

  function stop() {
    return pause()
  }

  return {
    start,
    stop,
    pause,
    resume,
    runCycleOnce,
    stepOnce,
    setCycleMs,
    getState,
    getLatestDecisions,
    getCallCount,
    getMetrics,
  }
}
