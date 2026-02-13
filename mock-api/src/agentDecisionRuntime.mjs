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

function toLotQuantity(quantity, lotSize = 100) {
  const safeLot = Math.max(1, Math.floor(toSafeNumber(lotSize, 100)))
  const raw = Math.max(0, Math.floor(toSafeNumber(quantity, 0)))
  return Math.floor(raw / safeLot) * safeLot
}

function round(value, digits = 2) {
  const factor = 10 ** digits
  return Math.round(toSafeNumber(value, 0) * factor) / factor
}

function buildPortfolioFromContext(context, symbol, markPrice) {
  const holdingsMap = new Map()
  const memoryHoldings = Array.isArray(context?.memory_state?.holdings)
    ? context.memory_state.holdings
    : []

  for (const holding of memoryHoldings) {
    const holdingSymbol = String(holding?.symbol || '').trim()
    if (!holdingSymbol) continue

    const shares = Math.max(0, Math.floor(toSafeNumber(holding?.shares, 0)))
    if (!shares) continue

    holdingsMap.set(holdingSymbol, {
      symbol: holdingSymbol,
      shares,
      avg_cost: round(toSafeNumber(holding?.avg_cost, 0), 4),
      mark_price: round(toSafeNumber(holding?.mark_price, markPrice), 4),
    })
  }

  if (!holdingsMap.size) {
    const shares = Math.max(0, Math.floor(toSafeNumber(context?.position_state?.shares, 0)))
    if (shares > 0) {
      holdingsMap.set(symbol, {
        symbol,
        shares,
        avg_cost: round(toSafeNumber(context?.position_state?.avg_cost, markPrice), 4),
        mark_price: round(markPrice, 4),
      })
    }
  }

  return holdingsMap
}

function portfolioPositions(holdingsMap) {
  const rows = []

  for (const holding of holdingsMap.values()) {
    if (!holding.shares) continue
    const unrealized = (holding.mark_price - holding.avg_cost) * holding.shares
    rows.push({
      symbol: holding.symbol,
      side: 'LONG',
      entry_price: round(holding.avg_cost, 4),
      mark_price: round(holding.mark_price, 4),
      quantity: holding.shares,
      leverage: 1,
      unrealized_pnl: round(unrealized, 2),
      unrealized_pnl_pct: holding.avg_cost > 0
        ? round(((holding.mark_price - holding.avg_cost) / holding.avg_cost) * 100, 4)
        : 0,
      liquidation_price: 0,
      margin_used: 0,
    })
  }

  return rows
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
  const llmDecision = context?.llm_decision || null
  const action = String(llmDecision?.action || decideAction(context)).toLowerCase()
  const symbol = context?.symbol || '600519.SH'
  const price = latestPrice(context)
  const confidence = Number.isFinite(Number(llmDecision?.confidence))
    ? Number(clamp(Number(llmDecision.confidence), 0.51, 0.95).toFixed(2))
    : confidenceFromContext(context, action)
  const quantity = Number.isFinite(Number(llmDecision?.quantity))
    ? Math.max(0, Math.floor(Number(llmDecision.quantity)))
    : (action === 'hold' ? 0 : 100)
  const lotSize = Math.max(1, Math.floor(toSafeNumber(context?.constraints?.lot_size, 100)))
  const requestedQuantity = action === 'hold' ? 0 : toLotQuantity(quantity, lotSize)
  const commissionRate = Math.max(0, toSafeNumber(context?.runtime_config?.commission_rate, 0.0003))

  let cashCny = Math.max(0, toSafeNumber(context?.position_state?.cash_cny, 0))
  const holdingsMap = buildPortfolioFromContext(context, symbol, price)

  if (!holdingsMap.has(symbol)) {
    holdingsMap.set(symbol, {
      symbol,
      shares: 0,
      avg_cost: round(price, 4),
      mark_price: round(price, 4),
    })
  }

  const symbolHolding = holdingsMap.get(symbol)
  symbolHolding.mark_price = round(price, 4)

  let executed = false
  let filledQuantity = 0
  let filledNotional = 0
  let feePaid = 0
  let executionError = ''

  if (action === 'buy') {
    const maxAffordableShares = Math.floor(cashCny / (price * (1 + commissionRate)))
    const affordableQuantity = toLotQuantity(maxAffordableShares, lotSize)
    filledQuantity = Math.max(0, Math.min(requestedQuantity, affordableQuantity))

    if (filledQuantity > 0) {
      filledNotional = round(filledQuantity * price, 2)
      feePaid = round(filledNotional * commissionRate, 2)
      const previousValue = symbolHolding.shares * symbolHolding.avg_cost
      const nextValue = previousValue + filledNotional
      symbolHolding.shares += filledQuantity
      symbolHolding.avg_cost = symbolHolding.shares > 0
        ? round(nextValue / symbolHolding.shares, 4)
        : symbolHolding.avg_cost
      cashCny = round(Math.max(0, cashCny - filledNotional - feePaid), 2)
      executed = true
    } else {
      executionError = requestedQuantity > 0 ? 'insufficient_cash' : 'invalid_quantity'
    }
  } else if (action === 'sell') {
    const availableQuantity = toLotQuantity(symbolHolding.shares, lotSize)
    filledQuantity = Math.max(0, Math.min(requestedQuantity, availableQuantity))

    if (filledQuantity > 0) {
      filledNotional = round(filledQuantity * price, 2)
      feePaid = round(filledNotional * commissionRate, 2)
      symbolHolding.shares = Math.max(0, symbolHolding.shares - filledQuantity)
      cashCny = round(cashCny + filledNotional - feePaid, 2)
      executed = true

      if (!symbolHolding.shares) {
        holdingsMap.delete(symbol)
      }
    } else {
      executionError = requestedQuantity > 0 ? 'insufficient_shares' : 'invalid_quantity'
    }
  }

  const portfolio = portfolioPositions(holdingsMap)
  const marketValue = portfolio.reduce((acc, position) => acc + position.mark_price * position.quantity, 0)
  const totalUnrealizedProfit = portfolio.reduce((acc, position) => acc + position.unrealized_pnl, 0)
  const totalBalance = round(cashCny + marketValue, 2)

  const reasoning = llmDecision?.reasoning || buildReasoning(action, context)
  const decisionSource = llmDecision?.source === 'openai' ? 'llm.openai' : 'rule.heuristic'
  const actionSuccess = action === 'hold' ? true : executed
  const decisionSuccess = actionSuccess
  const executionLog = action === 'hold'
    ? `${new Date(timestampIso).toISOString()} | ${trader.trader_name} -> HOLD ${symbol} @ ${price.toFixed(2)} (no order emitted)`
    : actionSuccess
      ? `${new Date(timestampIso).toISOString()} | ${trader.trader_name} -> ${action.toUpperCase()} ${symbol} qty=${filledQuantity} @ ${price.toFixed(2)} fee=${feePaid.toFixed(2)}`
      : `${new Date(timestampIso).toISOString()} | ${trader.trader_name} -> ${action.toUpperCase()} ${symbol} rejected (${executionError})`

  const stopLoss = action === 'buy'
    ? Number((price * 0.985).toFixed(2))
    : Number((price * 1.015).toFixed(2))
  const takeProfit = action === 'buy'
    ? Number((price * 1.02).toFixed(2))
    : Number((price * 0.98).toFixed(2))

  const decision = {
    timestamp: timestampIso,
    cycle_number: cycleNumber,
    system_prompt: llmDecision?.model
      ? `agent.market_context.v1+${llmDecision.model}`
      : 'agent.market_context.v1',
    input_prompt: `Evaluate ${symbol} using intraday + daily context`,
    cot_trace: 'compressed-mock-runtime-rationale',
    decision_json: JSON.stringify({ action, symbol }),
    decision_source: decisionSource,
    account_state: {
      total_balance: totalBalance,
      available_balance: round(cashCny, 2),
      total_unrealized_profit: round(totalUnrealizedProfit, 2),
      position_count: portfolio.length,
      margin_used_pct: 0,
    },
    positions: portfolio,
    candidate_coins: [symbol],
    decisions: [
      {
        action,
        symbol,
        quantity: filledQuantity,
        requested_quantity: requestedQuantity,
        executed,
        filled_quantity: filledQuantity,
        filled_notional: filledNotional,
        fee_paid: feePaid,
        leverage: 1,
        price: Number(price.toFixed(2)),
        stop_loss: action === 'hold' ? undefined : stopLoss,
        take_profit: action === 'hold' ? undefined : takeProfit,
        confidence,
        reasoning,
        order_id: 100000 + cycleNumber,
        timestamp: timestampIso,
        success: actionSuccess,
        error: actionSuccess ? undefined : executionError,
      },
    ],
    execution_log: [executionLog],
    success: decisionSuccess,
    error_message: decisionSuccess ? '' : executionError,
  }

  return decision
}

export function createInMemoryAgentRuntime({
  traders,
  evaluateTrader,
  onDecision,
  nowFn = Date.now,
  cycleMs = 15_000,
  maxHistory = 120,
  autoTimer = true,
} = {}) {
  const initialTraders = Array.isArray(traders) ? traders : []
  const historyLimit = clamp(toSafeNumber(maxHistory, 120), 20, 500)
  const decisionsByTrader = new Map()
  const callsByTrader = new Map()
  const evaluate = typeof evaluateTrader === 'function' ? evaluateTrader : async () => ({ context: null })
  const notifyDecision = typeof onDecision === 'function' ? onDecision : null
  let totalCycles = 0
  let successfulCycles = 0
  let failedCycles = 0
  let timer = null
  let running = false
  let cycleInFlight = false
  let lastCycleStartedMs = null
  let lastCycleCompletedMs = null
  let currentCycleMs = clamp(toSafeNumber(cycleMs, 15_000), 3_000, 120_000)
  let activeTraders = []

  function normalizeTraders(nextTradersRaw) {
    const nextTraders = Array.isArray(nextTradersRaw) ? nextTradersRaw : []
    const byId = new Map()

    for (const trader of nextTraders) {
      const traderId = String(trader?.trader_id || '').trim()
      if (!traderId) continue
      byId.set(traderId, trader)
    }

    return Array.from(byId.values())
  }

  function syncTraderState(nextTradersRaw) {
    const normalized = normalizeTraders(nextTradersRaw)
    const nextIds = new Set(normalized.map((trader) => trader.trader_id))

    for (const trader of normalized) {
      if (!decisionsByTrader.has(trader.trader_id)) {
        decisionsByTrader.set(trader.trader_id, [])
      }
      if (!callsByTrader.has(trader.trader_id)) {
        callsByTrader.set(trader.trader_id, 0)
      }
    }

    for (const traderId of Array.from(decisionsByTrader.keys())) {
      if (!nextIds.has(traderId)) {
        decisionsByTrader.delete(traderId)
      }
    }

    for (const traderId of Array.from(callsByTrader.keys())) {
      if (!nextIds.has(traderId)) {
        callsByTrader.delete(traderId)
      }
    }

    activeTraders = normalized
    return activeTraders.length
  }

  syncTraderState(initialTraders)

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

      if (notifyDecision) {
        try {
          await notifyDecision({
            trader,
            decision,
            context,
            cycleNumber: effectiveCycle,
          })
        } catch {
          // Keep runtime robust: decision generation succeeds even if sink fails.
        }
      }

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
      for (const trader of activeTraders) {
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

  function reset() {
    for (const traderId of Array.from(decisionsByTrader.keys())) {
      decisionsByTrader.set(traderId, [])
      callsByTrader.set(traderId, 0)
    }
    totalCycles = 0
    successfulCycles = 0
    failedCycles = 0
    cycleInFlight = false
    lastCycleStartedMs = null
    lastCycleCompletedMs = null
    return {
      state: getState(),
      metrics: getMetrics(),
    }
  }

  function setTraders(nextTraders) {
    return syncTraderState(nextTraders)
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
    reset,
    setTraders,
  }
}
