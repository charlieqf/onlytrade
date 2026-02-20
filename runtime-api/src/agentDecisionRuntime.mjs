function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function toSafeNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeTradingStyle(trader) {
  const explicit = String(trader?.trading_style || '').trim().toLowerCase()
  if (explicit) return explicit

  const strategy = String(trader?.strategy_name || '').trim().toLowerCase()
  if (strategy.includes('momentum')) return 'momentum_trend'
  if (strategy.includes('reversion') || strategy.includes('value')) return 'mean_reversion'
  if (strategy.includes('event')) return 'event_driven'
  if (strategy.includes('macro')) return 'macro_swing'
  return 'balanced'
}

function normalizeRiskProfile(trader) {
  const risk = String(trader?.risk_profile || '').trim().toLowerCase()
  if (risk === 'conservative' || risk === 'aggressive' || risk === 'balanced') {
    return risk
  }
  return 'balanced'
}

function decideAction(context, traderProfile = {}) {
  const ret5 = toSafeNumber(context?.intraday?.feature_snapshot?.ret_5, 0)
  const ret20 = toSafeNumber(context?.intraday?.feature_snapshot?.ret_20, 0)
  const volRatio20 = toSafeNumber(context?.intraday?.feature_snapshot?.vol_ratio_20, 1)
  const rsi14 = toSafeNumber(context?.daily?.feature_snapshot?.rsi_14, 50)
  const sma20 = toSafeNumber(context?.daily?.feature_snapshot?.sma_20, 0)
  const sma60 = toSafeNumber(context?.daily?.feature_snapshot?.sma_60, 0)
  const style = String(traderProfile?.tradingStyle || 'balanced').trim().toLowerCase()

  const bullishTrend = sma20 > 0 && sma60 > 0 && sma20 >= sma60
  const bearishTrend = sma20 > 0 && sma60 > 0 && sma20 < sma60

  if (style === 'mean_reversion') {
    if (rsi14 >= 72 || (ret5 >= 0.0032 && !bullishTrend)) return 'sell'
    if ((ret5 <= -0.0022 && rsi14 <= 47 && !bearishTrend) || (ret20 <= -0.0045 && rsi14 <= 42)) return 'buy'
    return 'hold'
  }

  if (style === 'event_driven') {
    if (volRatio20 >= 1.35 && (ret5 <= -0.003 || ret20 <= -0.004 || bearishTrend || rsi14 >= 73)) return 'sell'
    if (volRatio20 >= 1.2 && (ret5 >= 0.0022 || ret20 >= 0.004) && bullishTrend && rsi14 <= 70) return 'buy'
    return 'hold'
  }

  if (style === 'macro_swing') {
    if (bearishTrend || rsi14 >= 75 || ret20 <= -0.006 || ret5 <= -0.0045) return 'sell'
    if (bullishTrend && rsi14 >= 44 && rsi14 <= 70 && ret20 >= -0.002) return 'buy'
    return 'hold'
  }

  if (ret5 <= -0.0014 || ret20 <= -0.003 || rsi14 >= 72 || bearishTrend) return 'sell'
  if ((ret5 >= 0.0012 || ret20 >= 0.003) && bullishTrend && rsi14 <= 72) return 'buy'
  return 'hold'
}

function confidenceFromContext(context, action, traderProfile = {}) {
  const ret5Abs = Math.abs(toSafeNumber(context?.intraday?.feature_snapshot?.ret_5, 0))
  const rsi14 = toSafeNumber(context?.daily?.feature_snapshot?.rsi_14, 50)
  const style = String(traderProfile?.tradingStyle || 'balanced').trim().toLowerCase()
  const risk = String(traderProfile?.riskProfile || 'balanced').trim().toLowerCase()
  let base = 0.56 + clamp(ret5Abs * 18, 0, 0.2)

  if (action === 'buy' && rsi14 < 65) base += 0.04
  if (action === 'sell' && rsi14 > 70) base += 0.04

  if (style === 'event_driven') base += 0.02
  if (style === 'macro_swing') base -= 0.01

  if (risk === 'conservative') base -= 0.02
  if (risk === 'aggressive') base += 0.02

  return Number(clamp(base, 0.51, 0.92).toFixed(2))
}

function baseQuantityFromProfile(action, lotSize, confidence, traderProfile = {}) {
  if (action === 'hold') return 0

  const style = String(traderProfile?.tradingStyle || 'balanced').trim().toLowerCase()
  const risk = String(traderProfile?.riskProfile || 'balanced').trim().toLowerCase()
  let lots = 1

  if (risk === 'aggressive') lots = 2
  if (risk === 'conservative') lots = 1

  if (style === 'event_driven' && risk === 'aggressive') {
    lots = Math.max(lots, 2)
  }
  if (style === 'macro_swing' && risk !== 'aggressive') {
    lots = 1
  }
  if (confidence >= 0.82 && risk !== 'conservative') {
    lots += 1
  }

  return Math.max(1, Math.floor(toSafeNumber(lotSize, 100))) * Math.max(1, lots)
}

function candidateItems(context) {
  const raw = Array.isArray(context?.candidate_set?.items) ? context.candidate_set.items : []
  return raw
    .map((row) => ({
      symbol: String(row?.symbol || '').trim(),
      latest_price: toSafeNumber(row?.latest_price, 0),
      ret_5: row?.ret_5,
      ret_20: row?.ret_20,
      vol_ratio_20: row?.vol_ratio_20,
      atr_14: row?.atr_14,
      rsi_14: row?.rsi_14,
      sma_20: row?.sma_20,
      sma_60: row?.sma_60,
      range_20d_pct: row?.range_20d_pct,
      position_shares: row?.position_shares,
    }))
    .filter((row) => row.symbol)
}

function candidateItemBySymbol(context, symbol) {
  const target = String(symbol || '').trim()
  if (!target) return null
  const rows = candidateItems(context)
  return rows.find((row) => row.symbol === target) || null
}

function latestPrice(context, symbol = '') {
  const fromCandidate = candidateItemBySymbol(context, symbol)
  const candidatePrice = toSafeNumber(fromCandidate?.latest_price, 0)
  if (candidatePrice > 0) return candidatePrice

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

function buildReasoning(action, context, traderProfile = {}) {
  const ret5 = toSafeNumber(context?.intraday?.feature_snapshot?.ret_5, 0)
  const rsi14 = toSafeNumber(context?.daily?.feature_snapshot?.rsi_14, 50)
  const sma20 = toSafeNumber(context?.daily?.feature_snapshot?.sma_20, 0)
  const sma60 = toSafeNumber(context?.daily?.feature_snapshot?.sma_60, 0)
  const style = String(traderProfile?.tradingStyle || 'balanced').trim().toLowerCase()
  const risk = String(traderProfile?.riskProfile || 'balanced').trim().toLowerCase()
  const marketOverviewBrief = String(context?.market_overview?.brief || '').trim()
  const newsTitles = Array.isArray(context?.news_digest?.titles)
    ? context.news_digest.titles.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 2)
    : []

  const macroBits = []
  if (marketOverviewBrief) macroBits.push(`market=${marketOverviewBrief.slice(0, 96)}`)
  if (newsTitles.length) macroBits.push(`news=${newsTitles.join(' / ').slice(0, 96)}`)
  const macroSuffix = macroBits.length ? ` ${macroBits.join('; ')}` : ''

  if (action === 'buy') {
    return `${style} buy setup (ret5=${ret5.toFixed(4)}, RSI=${rsi14.toFixed(1)}, SMA20=${sma20.toFixed(2)}, SMA60=${sma60.toFixed(2)}, risk=${risk}).${macroSuffix}`
  }
  if (action === 'sell') {
    return `${style} sell/risk-off setup (ret5=${ret5.toFixed(4)}, RSI=${rsi14.toFixed(1)}, trend ${sma20.toFixed(2)} vs ${sma60.toFixed(2)}, risk=${risk}).${macroSuffix}`
  }
  return `${style} no strong edge (ret5=${ret5.toFixed(4)}, RSI=${rsi14.toFixed(1)}, risk=${risk}), hold.${macroSuffix}`
}

function contextForSymbol(context, symbol, fallbackPrice) {
  const snapshot = candidateItemBySymbol(context, symbol)
  if (!snapshot) return context

  const next = {
    ...context,
    symbol,
    intraday: {
      ...(context?.intraday || {}),
      feature_snapshot: {
        ...(context?.intraday?.feature_snapshot || {}),
      },
    },
    daily: {
      ...(context?.daily || {}),
      feature_snapshot: {
        ...(context?.daily?.feature_snapshot || {}),
      },
    },
    position_state: {
      ...(context?.position_state || {}),
    },
  }

  const intradaySnapshot = next.intraday.feature_snapshot
  const dailySnapshot = next.daily.feature_snapshot
  if (snapshot.ret_5 != null) intradaySnapshot.ret_5 = toSafeNumber(snapshot.ret_5, intradaySnapshot.ret_5)
  if (snapshot.ret_20 != null) intradaySnapshot.ret_20 = toSafeNumber(snapshot.ret_20, intradaySnapshot.ret_20)
  if (snapshot.atr_14 != null) intradaySnapshot.atr_14 = toSafeNumber(snapshot.atr_14, intradaySnapshot.atr_14)
  if (snapshot.vol_ratio_20 != null) intradaySnapshot.vol_ratio_20 = toSafeNumber(snapshot.vol_ratio_20, intradaySnapshot.vol_ratio_20)
  if (snapshot.rsi_14 != null) dailySnapshot.rsi_14 = toSafeNumber(snapshot.rsi_14, dailySnapshot.rsi_14)
  if (snapshot.sma_20 != null) dailySnapshot.sma_20 = toSafeNumber(snapshot.sma_20, dailySnapshot.sma_20)
  if (snapshot.sma_60 != null) dailySnapshot.sma_60 = toSafeNumber(snapshot.sma_60, dailySnapshot.sma_60)
  if (snapshot.range_20d_pct != null) dailySnapshot.range_20d_pct = toSafeNumber(snapshot.range_20d_pct, dailySnapshot.range_20d_pct)

  if (snapshot.position_shares != null) {
    next.position_state.shares = toSafeNumber(snapshot.position_shares, next.position_state.shares)
  }
  next.position_state.mark_price = toSafeNumber(snapshot.latest_price, fallbackPrice)

  return next
}

function candidateSymbolsFromContext(context) {
  const explicit = Array.isArray(context?.candidate_set?.symbols)
    ? context.candidate_set.symbols.map((item) => String(item || '').trim()).filter(Boolean)
    : []
  if (explicit.length) return explicit

  const fromItems = candidateItems(context).map((item) => item.symbol)
  if (fromItems.length) return fromItems

  return [String(context?.symbol || '600519.SH').trim() || '600519.SH']
}

function buildDecisionInputPrompt(context, symbol, cycleNumber) {
  const payload = {
    cycle_number: cycleNumber,
    symbol,
    intraday: {
      ret_5: toSafeNumber(context?.intraday?.feature_snapshot?.ret_5, 0),
      ret_20: toSafeNumber(context?.intraday?.feature_snapshot?.ret_20, 0),
      atr_14: toSafeNumber(context?.intraday?.feature_snapshot?.atr_14, 0),
      vol_ratio_20: toSafeNumber(context?.intraday?.feature_snapshot?.vol_ratio_20, 0),
    },
    daily: {
      sma_20: toSafeNumber(context?.daily?.feature_snapshot?.sma_20, 0),
      sma_60: toSafeNumber(context?.daily?.feature_snapshot?.sma_60, 0),
      rsi_14: toSafeNumber(context?.daily?.feature_snapshot?.rsi_14, 50),
      range_20d_pct: toSafeNumber(context?.daily?.feature_snapshot?.range_20d_pct, 0),
    },
    position_state: {
      shares: toSafeNumber(context?.position_state?.shares, 0),
      avg_cost: toSafeNumber(context?.position_state?.avg_cost, 0),
      cash_cny: toSafeNumber(context?.position_state?.cash_cny, 0),
    },
    market_overview: {
      brief: String(context?.market_overview?.brief || '').slice(0, 240),
    },
    news_digest: {
      titles: Array.isArray(context?.news_digest?.titles)
        ? context.news_digest.titles.map((item) => String(item || '').slice(0, 96)).filter(Boolean).slice(0, 3)
        : [],
    },
  }
  return JSON.stringify(payload)
}

function buildHeuristicTrace(action, reasoning, context, traderProfile = {}) {
  const ret5 = toSafeNumber(context?.intraday?.feature_snapshot?.ret_5, 0)
  const rsi14 = toSafeNumber(context?.daily?.feature_snapshot?.rsi_14, 50)
  const sma20 = toSafeNumber(context?.daily?.feature_snapshot?.sma_20, 0)
  const sma60 = toSafeNumber(context?.daily?.feature_snapshot?.sma_60, 0)
  const style = String(traderProfile?.tradingStyle || 'balanced').trim().toLowerCase()
  const risk = String(traderProfile?.riskProfile || 'balanced').trim().toLowerCase()
  return [
    `decision_path=heuristic action=${action} style=${style} risk=${risk}`,
    `features: ret5=${ret5.toFixed(4)}, rsi14=${rsi14.toFixed(2)}, sma20=${sma20.toFixed(2)}, sma60=${sma60.toFixed(2)}`,
    `reasoning: ${reasoning}`,
  ].join('\n')
}

function sortByCycleDesc(a, b) {
  return toSafeNumber(b?.cycle_number, 0) - toSafeNumber(a?.cycle_number, 0)
}

import { buildViewerReasoningStepsCn } from './reasoningChain.mjs'

export function createDecisionFromContext({ trader, cycleNumber, context, timestampIso }) {
  const llmDecision = context?.llm_decision || null
  const traderProfile = {
    tradingStyle: normalizeTradingStyle(trader),
    riskProfile: normalizeRiskProfile(trader),
  }

  const candidateSymbols = candidateSymbolsFromContext(context)
  const requestedSymbolRaw = String(llmDecision?.symbol || context?.symbol || candidateSymbols[0] || '600519.SH').trim()
  const symbol = candidateSymbols.includes(requestedSymbolRaw)
    ? requestedSymbolRaw
    : (candidateSymbols[0] || '600519.SH')
  const price = latestPrice(context, symbol)
  const decisionContext = contextForSymbol(context, symbol, price)
  const lotSize = Math.max(1, Math.floor(toSafeNumber(context?.constraints?.lot_size, 100)))

  const flatEntryEnabled = String(context?.runtime_config?.flat_entry_enabled || '').trim()
    ? String(context.runtime_config.flat_entry_enabled).toLowerCase() === 'true'
    : (String(process.env.AGENT_FLAT_ENTRY_ENABLED || 'false').toLowerCase() === 'true')
  const flatEntryMinCycles = Math.max(1, Math.floor(toSafeNumber(
    context?.runtime_config?.flat_entry_min_cycles,
    toSafeNumber(process.env.AGENT_FLAT_ENTRY_MIN_CYCLES, 6)
  )))
  const flatEntryLots = Math.max(1, Math.floor(toSafeNumber(
    context?.runtime_config?.flat_entry_lots,
    toSafeNumber(process.env.AGENT_FLAT_ENTRY_LOTS, 1)
  )))
  const flatEntryMaxRsi = clamp(
    toSafeNumber(context?.runtime_config?.flat_entry_max_rsi, toSafeNumber(process.env.AGENT_FLAT_ENTRY_MAX_RSI, 70)),
    50,
    85
  )
  const conservativeProbeEnabled = String(
    context?.runtime_config?.conservative_probe_enabled
    ?? process.env.AGENT_CONSERVATIVE_PROBE_ENABLED
    ?? 'true'
  ).toLowerCase() !== 'false'
  const conservativeProbeMinCycles = Math.max(1, Math.floor(toSafeNumber(
    context?.runtime_config?.conservative_probe_min_cycles,
    toSafeNumber(process.env.AGENT_CONSERVATIVE_PROBE_MIN_CYCLES, 8)
  )))
  const conservativeProbeMaxRsi = clamp(
    toSafeNumber(
      context?.runtime_config?.conservative_probe_max_rsi,
      toSafeNumber(process.env.AGENT_CONSERVATIVE_PROBE_MAX_RSI, 62)
    ),
    35,
    72
  )
  const conservativeProbeRet5Max = toSafeNumber(
    context?.runtime_config?.conservative_probe_ret5_max,
    toSafeNumber(process.env.AGENT_CONSERVATIVE_PROBE_RET5_MAX, -0.003)
  )
  const conservativeProbeRet20Max = toSafeNumber(
    context?.runtime_config?.conservative_probe_ret20_max,
    toSafeNumber(process.env.AGENT_CONSERVATIVE_PROBE_RET20_MAX, -0.006)
  )
  const conservativeProbeLots = Math.max(1, Math.floor(toSafeNumber(
    context?.runtime_config?.conservative_probe_lots,
    toSafeNumber(process.env.AGENT_CONSERVATIVE_PROBE_LOTS, 1)
  )))
  const openingPhaseMode = String(context?.runtime_config?.opening_phase_mode || '').trim().toLowerCase() === 'true'
  const openingPhaseMaxLots = Math.max(1, Math.floor(toSafeNumber(context?.runtime_config?.opening_phase_max_lots, 1)))
  const openingPhaseMaxConfidence = clamp(
    toSafeNumber(context?.runtime_config?.opening_phase_max_confidence, 0.72),
    0.51,
    0.95
  )

  const holdings = Array.isArray(context?.memory_state?.holdings) ? context.memory_state.holdings : []
  const hasAnyHoldings = holdings.some((holding) => toSafeNumber(holding?.shares, 0) > 0)
  const isFlat = !hasAnyHoldings && toSafeNumber(context?.position_state?.shares, 0) <= 0
  const symbolSharesInMemory = holdings
    .filter((holding) => String(holding?.symbol || '') === symbol)
    .reduce((sum, holding) => sum + toSafeNumber(holding?.shares, 0), 0)
  const symbolShares = Math.max(
    toSafeNumber(context?.position_state?.shares, 0),
    symbolSharesInMemory,
  )
  const hasSymbolShares = symbolShares > 0
  const ret5 = toSafeNumber(decisionContext?.intraday?.feature_snapshot?.ret_5, 0)
  const ret20 = toSafeNumber(decisionContext?.intraday?.feature_snapshot?.ret_20, 0)
  const rsi14 = toSafeNumber(decisionContext?.daily?.feature_snapshot?.rsi_14, 50)
  const sma20 = toSafeNumber(decisionContext?.daily?.feature_snapshot?.sma_20, 0)
  const sma60 = toSafeNumber(decisionContext?.daily?.feature_snapshot?.sma_60, 0)
  const bearishTrend = sma20 > 0 && sma60 > 0 && sma20 < sma60
  const style = String(traderProfile?.tradingStyle || 'balanced').trim().toLowerCase()
  const risk = String(traderProfile?.riskProfile || 'balanced').trim().toLowerCase()

  const originalAction = String(llmDecision?.action || decideAction(decisionContext, traderProfile)).toLowerCase()
  let action = originalAction
  let sellGuardedWithoutSymbolShares = false
  // Guardrail: never attempt to sell when flat in this virtual long-only market.
  if (action === 'sell' && !hasSymbolShares) {
    action = 'hold'
    sellGuardedWithoutSymbolShares = true
  }

  // Anti-stall: when fully in cash for too long, open a small starter position.
  // This reduces "empty portfolio" situations where agents never enter.
  const forcedFlatEntry = (
    flatEntryEnabled
    && isFlat
    && action === 'hold'
    && Number.isFinite(Number(cycleNumber))
    && Number(cycleNumber) >= flatEntryMinCycles
    && !bearishTrend
    && rsi14 <= flatEntryMaxRsi
  )

  if (forcedFlatEntry) {
    action = 'buy'
  }

  const conservativeProbeEntry = (
    conservativeProbeEnabled
    && isFlat
    && action === 'hold'
    && style === 'mean_reversion'
    && risk === 'conservative'
    && Number.isFinite(Number(cycleNumber))
    && Number(cycleNumber) >= conservativeProbeMinCycles
    && !bearishTrend
    && rsi14 <= conservativeProbeMaxRsi
    && (ret5 <= conservativeProbeRet5Max || ret20 <= conservativeProbeRet20Max)
  )

  if (conservativeProbeEntry) {
    action = 'buy'
  }

  let confidence = Number.isFinite(Number(llmDecision?.confidence))
    ? Number(clamp(Number(llmDecision.confidence), 0.51, 0.95).toFixed(2))
    : confidenceFromContext(decisionContext, action, traderProfile)
  if (openingPhaseMode) {
    confidence = Number(Math.min(confidence, openingPhaseMaxConfidence).toFixed(2))
  }
  const quantity = Number.isFinite(Number(llmDecision?.quantity))
    ? Math.max(0, Math.floor(Number(llmDecision.quantity)))
    : baseQuantityFromProfile(action, lotSize, confidence, traderProfile)
  const conservativeProbeQuantity = conservativeProbeEntry
    ? lotSize * conservativeProbeLots
    : null
  const forcedFlatEntryQuantity = action === 'buy' && isFlat && flatEntryEnabled && Number(cycleNumber) >= flatEntryMinCycles
    ? lotSize * flatEntryLots
    : null
  let requestedQuantity = action === 'hold'
    ? 0
    : toLotQuantity(conservativeProbeQuantity ?? forcedFlatEntryQuantity ?? quantity, lotSize)
  if (openingPhaseMode && action !== 'hold' && requestedQuantity > 0) {
    const maxOpeningQuantity = lotSize * openingPhaseMaxLots
    requestedQuantity = Math.min(requestedQuantity, maxOpeningQuantity)
  }
  const commissionRate = Math.max(0, toSafeNumber(context?.runtime_config?.commission_rate, 0.0003))
  const maxPositionCount = Math.max(1, Math.floor(toSafeNumber(context?.runtime_config?.max_position_count, 4)))
  const maxSymbolConcentrationPct = clamp(
    toSafeNumber(context?.runtime_config?.max_symbol_concentration_pct, 0.45),
    0.1,
    1,
  )
  const minCashReservePct = clamp(
    toSafeNumber(context?.runtime_config?.min_cash_reserve_pct, 0.08),
    0,
    0.9,
  )
  const turnoverThrottlePct = clamp(
    toSafeNumber(context?.runtime_config?.turnover_throttle_pct, 1),
    0.01,
    1,
  )

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

  const portfolioBefore = portfolioPositions(holdingsMap)
  const marketValueBefore = portfolioBefore.reduce((acc, position) => acc + position.mark_price * position.quantity, 0)
  const totalBalanceBefore = round(cashCny + marketValueBefore, 2)
  const currentSymbolValue = round(symbolHolding.shares * price, 2)
  const openingNewPosition = action === 'buy' && symbolHolding.shares <= 0
  const guardrailNotes = []
  let buyGuardedInsufficientCash = false

  if (action === 'buy' && requestedQuantity > 0) {
    const maxAffordableSharesPreview = Math.floor(cashCny / (price * (1 + commissionRate)))
    const affordableQuantityPreview = toLotQuantity(maxAffordableSharesPreview, lotSize)
    if (affordableQuantityPreview <= 0) {
      action = 'hold'
      requestedQuantity = 0
      buyGuardedInsufficientCash = true
    }
  }

  if (action !== 'hold' && requestedQuantity > 0) {
    const maxNotionalPerCycle = Math.max(0, totalBalanceBefore * turnoverThrottlePct)
    const maxTurnoverQty = toLotQuantity(maxNotionalPerCycle / Math.max(price, 0.0001), lotSize)
    if (maxTurnoverQty <= 0) {
      action = 'hold'
      requestedQuantity = 0
      guardrailNotes.push(`turnover throttle disabled order (max_notional=${maxNotionalPerCycle.toFixed(2)})`)
    } else if (requestedQuantity > maxTurnoverQty) {
      requestedQuantity = maxTurnoverQty
      guardrailNotes.push(`turnover throttle clipped quantity to ${requestedQuantity}`)
    }
  }

  if (action === 'buy' && requestedQuantity > 0 && openingNewPosition && portfolioBefore.length >= maxPositionCount) {
    action = 'hold'
    requestedQuantity = 0
    guardrailNotes.push(`max position count reached (${portfolioBefore.length}/${maxPositionCount})`)
  }

  if (action === 'buy' && requestedQuantity > 0) {
    const maxSymbolValue = Math.max(0, totalBalanceBefore * maxSymbolConcentrationPct)
    const maxAdditionalByConcentration = Math.max(0, maxSymbolValue - currentSymbolValue)
    const maxQtyByConcentration = toLotQuantity(maxAdditionalByConcentration / Math.max(price, 0.0001), lotSize)
    if (maxQtyByConcentration <= 0) {
      action = 'hold'
      requestedQuantity = 0
      guardrailNotes.push(`symbol concentration limit reached (${maxSymbolConcentrationPct.toFixed(2)})`)
    } else if (requestedQuantity > maxQtyByConcentration) {
      requestedQuantity = maxQtyByConcentration
      guardrailNotes.push(`concentration clipped quantity to ${requestedQuantity}`)
    }
  }

  if (action === 'buy' && requestedQuantity > 0) {
    const reserveTargetCash = Math.max(0, totalBalanceBefore * minCashReservePct)
    const reserveBudget = Math.max(0, cashCny - reserveTargetCash)
    const maxQtyByReserve = toLotQuantity(
      reserveBudget / Math.max(price * (1 + commissionRate), 0.0001),
      lotSize,
    )
    if (maxQtyByReserve <= 0) {
      action = 'hold'
      requestedQuantity = 0
      guardrailNotes.push(`min cash reserve prevents entry (${minCashReservePct.toFixed(2)})`)
    } else if (requestedQuantity > maxQtyByReserve) {
      requestedQuantity = maxQtyByReserve
      guardrailNotes.push(`cash reserve clipped quantity to ${requestedQuantity}`)
    }
  }

  if (action === 'buy' && requestedQuantity > 0) {
    const maxAffordableSharesPreview = Math.floor(cashCny / (price * (1 + commissionRate)))
    const affordableQuantityPreview = toLotQuantity(maxAffordableSharesPreview, lotSize)
    if (affordableQuantityPreview <= 0) {
      action = 'hold'
      requestedQuantity = 0
      buyGuardedInsufficientCash = true
    }
  }

  let executed = false
  let filledQuantity = 0
  let filledNotional = 0
  let feePaid = 0
  let realizedPnl = 0
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
      const avgCost = round(symbolHolding.avg_cost, 4)
      filledNotional = round(filledQuantity * price, 2)
      feePaid = round(filledNotional * commissionRate, 2)
      realizedPnl = round((price - avgCost) * filledQuantity - feePaid, 2)
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

  let reasoning = llmDecision?.reasoning || buildReasoning(action, decisionContext, traderProfile)
  if (guardrailNotes.length) {
    reasoning = `guardrail: ${guardrailNotes.join('; ')}. ${reasoning}`
  }
  if (buyGuardedInsufficientCash) {
    reasoning = `guardrail: skip buy on ${symbol}, insufficient cash for one lot (lot=${lotSize}, cash=${cashCny.toFixed(2)}, price=${price.toFixed(2)}). ${reasoning}`
  } else if (conservativeProbeEntry) {
    reasoning = `conservative probe-entry -> starter buy ${lotSize * conservativeProbeLots} shares on pullback (ret5=${ret5.toFixed(4)}, ret20=${ret20.toFixed(4)}, rsi=${rsi14.toFixed(1)}). ${reasoning}`
  } else if (forcedFlatEntry) {
    reasoning = `flat-entry (in cash too long) -> starter buy ${lotSize * flatEntryLots} shares. ${reasoning}`
  } else if (originalAction === 'sell' && action === 'hold' && sellGuardedWithoutSymbolShares) {
    reasoning = isFlat
      ? `guardrail: ignore sell while flat (no shares). ${reasoning}`
      : `guardrail: ignore sell without holdings on ${symbol}. ${reasoning}`
  }
  if (openingPhaseMode && action !== 'hold') {
    reasoning = `opening-phase cap (max ${openingPhaseMaxLots} lot, conf<=${openingPhaseMaxConfidence.toFixed(2)}). ${reasoning}`
  }
  const decisionSource = llmDecision?.source === 'openai' ? 'llm.openai' : 'rule.heuristic'
  const systemPrompt = llmDecision?.system_prompt
    || (llmDecision?.model ? `agent.market_context.v1+${llmDecision.model}` : 'agent.market_context.rule_engine.v1')
  const inputPrompt = llmDecision?.input_prompt || buildDecisionInputPrompt(context, symbol, cycleNumber)
  const cotTrace = llmDecision?.cot_trace || buildHeuristicTrace(action, reasoning, decisionContext, traderProfile)
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
    system_prompt: systemPrompt,
    input_prompt: inputPrompt,
    cot_trace: cotTrace,
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
    candidate_coins: candidateSymbols,
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
        realized_pnl: realizedPnl,
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

  try {
    decision.reasoning_steps_cn = buildViewerReasoningStepsCn({ trader, context, decision })
  } catch {
    decision.reasoning_steps_cn = []
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
