import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

function toNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function round(value, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function commissionFeeFromDecision(decision, commissionRate) {
  const actionPayload = decision?.decisions?.[0] || {}
  const action = String(actionPayload?.action || '').toLowerCase()
  if (action !== 'buy' && action !== 'sell') return 0

  const executed = actionPayload?.executed === true || actionPayload?.success === true
  if (!executed) return 0

  const explicitFee = toNumber(actionPayload?.fee_paid, NaN)
  if (Number.isFinite(explicitFee) && explicitFee >= 0) {
    return round(explicitFee, 2)
  }

  const filledNotional = toNumber(actionPayload?.filled_notional, NaN)
  if (Number.isFinite(filledNotional) && filledNotional > 0) {
    return round(filledNotional * commissionRate, 2)
  }

  const quantity = Math.max(0, toNumber(actionPayload?.filled_quantity ?? actionPayload?.quantity, 0))
  const price = Math.max(0, toNumber(actionPayload?.price, 0))
  if (!quantity || !price || !commissionRate) return 0

  return round(quantity * price * commissionRate, 2)
}

function defaultSnapshot(trader, commissionRate) {
  const nowIso = new Date().toISOString()
  return {
    schema_version: 'agent.memory.v2',
    meta: {
      run_id: `run-${nowIso.replace(/[-:.TZ]/g, '').slice(0, 14)}-${trader.trader_id}`,
      created_at: nowIso,
      updated_at: nowIso,
      next_position_id: 1,
    },
    config: {
      market: 'CN-A',
      currency: 'CNY',
      lot_size: 100,
      initial_balance: 100000,
      decision_every_bars: 10,
      llm_model: null,
      commission_rate: commissionRate,
    },
    trader_id: trader.trader_id,
    trader_name: trader.trader_name,
    updated_at: null,
    replay: {
      trading_day: null,
      day_index: 0,
      day_count: 0,
      bar_cursor: -1,
      is_day_start: false,
      is_day_end: false,
    },
    stats: {
      initial_balance: 100000,
      latest_total_balance: 100000,
      latest_available_balance: 100000,
      latest_unrealized_profit: 0,
      return_rate_pct: 0,
      peak_balance: 100000,
      trough_balance: 100000,
      decisions: 0,
      wins: 0,
      losses: 0,
      holds: 0,
      buy_trades: 0,
      sell_trades: 0,
      total_fees_paid: 0,
    },
    daily_journal: [],
    holdings: [],
    open_lots: [],
    closed_positions: [],
    equity_curve: [
      {
        timestamp: nowIso,
        total_equity: 100000,
        pnl: 0,
        pnl_pct: 0,
        total_pnl_pct: 0,
        cycle_number: 0,
      },
    ],
    recent_actions: [],
  }
}

function normalizeHoldings(positions, totalBalance) {
  const safeTotal = Math.max(1, toNumber(totalBalance, 1))
  return (positions || []).map((position) => {
    const shares = toNumber(position.quantity, 0)
    const mark = toNumber(position.mark_price, 0)
    const value = shares * mark
    return {
      symbol: position.symbol,
      shares,
      avg_cost: toNumber(position.entry_price, 0),
      mark_price: mark,
      unrealized_pnl: toNumber(position.unrealized_pnl, 0),
      value,
      weight_pct: round((value / safeTotal) * 100, 2),
    }
  })
}

function normalizeOpenLots(openLotsRaw, fallbackTs) {
  if (!Array.isArray(openLotsRaw)) return []

  return openLotsRaw
    .map((lot) => {
      const remainingQty = Math.max(0, Math.floor(toNumber(lot?.remaining_qty, 0)))
      const entryQty = Math.max(remainingQty, Math.floor(toNumber(lot?.entry_qty, remainingQty)))
      return {
        symbol: String(lot?.symbol || '').trim(),
        side: 'LONG',
        remaining_qty: remainingQty,
        entry_qty: entryQty,
        entry_price: round(toNumber(lot?.entry_price, 0), 4),
        entry_time: String(lot?.entry_time || fallbackTs),
        entry_order_id: String(lot?.entry_order_id || 'seed'),
        entry_fee_remaining: round(Math.max(0, toNumber(lot?.entry_fee_remaining, 0)), 4),
      }
    })
    .filter((lot) => lot.symbol && lot.remaining_qty > 0)
}

function normalizeClosedPositions(positionsRaw) {
  if (!Array.isArray(positionsRaw)) return []
  return positionsRaw.filter((row) => row && typeof row === 'object' && row.symbol).slice(0, 2000)
}

function normalizeEquityCurve(curveRaw, initialBalance, fallbackTs) {
  const curve = Array.isArray(curveRaw) ? curveRaw : []
  const normalized = curve
    .map((point) => {
      const equity = round(toNumber(point?.total_equity, initialBalance), 2)
      const pnl = round(toNumber(point?.pnl, equity - initialBalance), 2)
      const pct = round(toNumber(point?.pnl_pct, ((equity - initialBalance) / Math.max(1, initialBalance)) * 100), 4)
      return {
        timestamp: String(point?.timestamp || fallbackTs),
        total_equity: equity,
        pnl,
        pnl_pct: pct,
        total_pnl_pct: round(toNumber(point?.total_pnl_pct, pct), 4),
        cycle_number: Math.max(0, Math.floor(toNumber(point?.cycle_number, 0))),
      }
    })
    .filter((point) => point.timestamp)

  if (normalized.length) return normalized.slice(-5000)

  return [
    {
      timestamp: fallbackTs,
      total_equity: round(initialBalance, 2),
      pnl: 0,
      pnl_pct: 0,
      total_pnl_pct: 0,
      cycle_number: 0,
    },
  ]
}

export function createAgentMemoryStore({ rootDir, traders, commissionRate = 0.0003 }) {
  const memoryDir = path.join(rootDir, 'data', 'agent-memory')
  const safeCommissionRate = Math.max(0, toNumber(commissionRate, 0.0003))
  const snapshots = new Map((traders || []).map((trader) => [trader.trader_id, defaultSnapshot(trader, safeCommissionRate)]))

  function filePath(traderId) {
    return path.join(memoryDir, `${traderId}.json`)
  }

  async function hydrate() {
    await mkdir(memoryDir, { recursive: true })
    for (const trader of traders || []) {
      const traderId = trader.trader_id
      try {
        const raw = await readFile(filePath(traderId), 'utf8')
        const parsed = JSON.parse(raw)
        if (parsed && parsed.trader_id === traderId) {
          const base = defaultSnapshot(trader, safeCommissionRate)
          snapshots.set(traderId, {
            ...base,
            ...parsed,
            trader_id: traderId,
            trader_name: trader.trader_name,
            config: {
              ...base.config,
              ...(parsed.config || {}),
            },
          })
        }
      } catch {
        // keep defaults when file is missing/corrupted
      }
    }
  }

  async function resetAll({ persistDefaults = true } = {}) {
    snapshots.clear()
    for (const trader of traders || []) {
      snapshots.set(trader.trader_id, defaultSnapshot(trader, safeCommissionRate))
    }

    await mkdir(memoryDir, { recursive: true })
    const files = await readdir(memoryDir)
    await Promise.all(
      files
        .filter((name) => name.endsWith('.json'))
        .map((name) => unlink(path.join(memoryDir, name)).catch(() => {}))
    )

    if (persistDefaults) {
      await Promise.all(
        Array.from(snapshots.keys()).map((traderId) => persist(traderId))
      )
    }
  }

  async function persist(traderId) {
    const snapshot = snapshots.get(traderId)
    if (!snapshot) return
    await mkdir(memoryDir, { recursive: true })
    await writeFile(filePath(traderId), JSON.stringify(snapshot, null, 2), 'utf8')
  }

  async function recordSnapshot({ trader, decision, account, positions, replayStatus }) {
    if (!trader?.trader_id) return
    const traderId = trader.trader_id
    const prev = snapshots.get(traderId) || defaultSnapshot(trader, safeCommissionRate)

    const decisionTimestamp = decision?.timestamp || new Date().toISOString()
    const totalBalance = toNumber(account?.total_equity ?? decision?.account_state?.total_balance, prev.stats.latest_total_balance)
    const availableBalance = toNumber(account?.available_balance ?? decision?.account_state?.available_balance, prev.stats.latest_available_balance)
    const unrealized = toNumber(account?.unrealized_profit ?? decision?.account_state?.total_unrealized_profit, prev.stats.latest_unrealized_profit)
    const initialBalance = Math.max(1, toNumber(prev.stats.initial_balance, 100000))
    const tradingDay = replayStatus?.trading_day || prev.replay.trading_day || 'unknown'
    const actionPayload = decision?.decisions?.[0] || {}
    const action = String(actionPayload?.action || 'hold').toLowerCase()
    const orderExecuted = actionPayload?.executed === true || actionPayload?.success === true
    const isExecutedBuy = orderExecuted && action === 'buy'
    const isExecutedSell = orderExecuted && action === 'sell'
    const realizedPnl = toNumber(actionPayload?.realized_pnl, NaN)
    const decisionFee = commissionFeeFromDecision(decision, safeCommissionRate)
    const netTotalBalance = round(Math.max(0, totalBalance), 2)
    const netAvailableBalance = round(Math.max(0, availableBalance), 2)

    const actionSymbol = String(actionPayload?.symbol || '').trim()
    const actionPrice = round(Math.max(0, toNumber(actionPayload?.price, 0)), 4)
    const filledQuantity = Math.max(0, Math.floor(toNumber(actionPayload?.filled_quantity ?? actionPayload?.quantity, 0)))
    const actionOrderId = String(actionPayload?.order_id || `order-${toNumber(decision?.cycle_number, 0)}`)

    let openLots = normalizeOpenLots(prev.open_lots, decisionTimestamp)
    if (!openLots.length && Array.isArray(prev.holdings)) {
      const seededLots = prev.holdings
        .map((holding) => {
          const shares = Math.max(0, Math.floor(toNumber(holding?.shares, 0)))
          return {
            symbol: String(holding?.symbol || '').trim(),
            side: 'LONG',
            remaining_qty: shares,
            entry_qty: shares,
            entry_price: round(toNumber(holding?.avg_cost, 0), 4),
            entry_time: String(prev.updated_at || decisionTimestamp),
            entry_order_id: 'seed',
            entry_fee_remaining: 0,
          }
        })
        .filter((lot) => lot.symbol && lot.remaining_qty > 0)
      openLots = normalizeOpenLots(seededLots, decisionTimestamp)
    }

    let closedPositions = normalizeClosedPositions(prev.closed_positions)
    let nextPositionId = Math.max(1, Math.floor(toNumber(prev?.meta?.next_position_id, closedPositions.length + 1)))

    if (isExecutedBuy && actionSymbol && filledQuantity > 0 && actionPrice > 0) {
      openLots.push({
        symbol: actionSymbol,
        side: 'LONG',
        remaining_qty: filledQuantity,
        entry_qty: filledQuantity,
        entry_price: actionPrice,
        entry_time: decisionTimestamp,
        entry_order_id: actionOrderId,
        entry_fee_remaining: round(Math.max(0, decisionFee), 4),
      })
    }

    if (isExecutedSell && actionSymbol && filledQuantity > 0 && actionPrice > 0) {
      let remainingToClose = filledQuantity
      let remainingSellFee = round(Math.max(0, decisionFee), 4)

      for (const lot of openLots) {
        if (!remainingToClose) break
        if (lot.symbol !== actionSymbol || lot.remaining_qty <= 0) continue

        const closeQty = Math.min(remainingToClose, lot.remaining_qty)
        if (closeQty <= 0) continue

        const lotQtyBefore = lot.remaining_qty
        const entryFeeShare = lot.entry_fee_remaining > 0
          ? round(lot.entry_fee_remaining * (closeQty / lotQtyBefore), 4)
          : 0
        const sellFeeShare = round(Math.min(remainingSellFee, Math.max(0, decisionFee) * (closeQty / filledQuantity)), 4)
        const totalFee = round(entryFeeShare + sellFeeShare, 4)
        const closedPnl = round((actionPrice - lot.entry_price) * closeQty - totalFee, 2)

        closedPositions.unshift({
          id: nextPositionId,
          trader_id: traderId,
          exchange_id: 'sim-cn',
          exchange_type: 'sim',
          symbol: actionSymbol,
          side: 'LONG',
          quantity: closeQty,
          entry_quantity: closeQty,
          entry_price: lot.entry_price,
          entry_order_id: lot.entry_order_id,
          entry_time: lot.entry_time,
          exit_price: actionPrice,
          exit_order_id: actionOrderId,
          exit_time: decisionTimestamp,
          realized_pnl: closedPnl,
          fee: totalFee,
          leverage: 1,
          status: 'closed',
          close_reason: 'signal_sell',
          created_at: lot.entry_time,
          updated_at: decisionTimestamp,
        })
        nextPositionId += 1

        lot.remaining_qty = Math.max(0, lot.remaining_qty - closeQty)
        lot.entry_fee_remaining = round(Math.max(0, lot.entry_fee_remaining - entryFeeShare), 4)
        remainingSellFee = round(Math.max(0, remainingSellFee - sellFeeShare), 4)
        remainingToClose -= closeQty
      }
    }

    openLots = openLots.filter((lot) => lot.remaining_qty > 0)
    closedPositions = closedPositions.slice(0, 2000)

    let equityCurve = normalizeEquityCurve(prev.equity_curve, initialBalance, decisionTimestamp)
    const equityPoint = {
      timestamp: decisionTimestamp,
      total_equity: netTotalBalance,
      pnl: round(netTotalBalance - initialBalance, 2),
      pnl_pct: round(((netTotalBalance - initialBalance) / initialBalance) * 100, 4),
      total_pnl_pct: round(((netTotalBalance - initialBalance) / initialBalance) * 100, 4),
      cycle_number: Math.max(0, Math.floor(toNumber(decision?.cycle_number, toNumber(prev.stats.decisions, 0) + 1))),
    }
    const lastPoint = equityCurve[equityCurve.length - 1]
    if (lastPoint && lastPoint.timestamp === equityPoint.timestamp) {
      equityCurve[equityCurve.length - 1] = equityPoint
    } else {
      equityCurve.push(equityPoint)
    }
    equityCurve = equityCurve.slice(-5000)

    const holds = prev.stats.holds + (action === 'hold' ? 1 : 0)
    const wins = toNumber(prev.stats.wins, 0)
      + (isExecutedSell && Number.isFinite(realizedPnl) && realizedPnl > 0 ? 1 : 0)
    const losses = toNumber(prev.stats.losses, 0)
      + (isExecutedSell && Number.isFinite(realizedPnl) && realizedPnl < 0 ? 1 : 0)
    const buyTrades = toNumber(prev.stats.buy_trades, 0) + (isExecutedBuy ? 1 : 0)
    const sellTrades = toNumber(prev.stats.sell_trades, 0) + (isExecutedSell ? 1 : 0)
    const totalFeesPaid = round(toNumber(prev.stats.total_fees_paid, 0) + decisionFee, 2)

    const prevDaily = Array.isArray(prev.daily_journal) ? prev.daily_journal : []
    const existingDay = prevDaily.find((item) => item.trading_day === tradingDay)
    const nextDaily = existingDay
      ? prevDaily.map((item) => {
        if (item.trading_day !== tradingDay) return item
        return {
          ...item,
          day_index: toNumber(replayStatus?.day_index, item.day_index),
          decisions: toNumber(item.decisions, 0) + 1,
          buys: toNumber(item.buys, 0) + (isExecutedBuy ? 1 : 0),
          sells: toNumber(item.sells, 0) + (isExecutedSell ? 1 : 0),
          holds: toNumber(item.holds, 0) + (action === 'hold' ? 1 : 0),
          end_balance: netTotalBalance,
          peak_balance: round(Math.max(toNumber(item.peak_balance, netTotalBalance), netTotalBalance), 2),
          trough_balance: round(Math.min(toNumber(item.trough_balance, netTotalBalance), netTotalBalance), 2),
          fees_paid: round(toNumber(item.fees_paid, 0) + decisionFee, 2),
          last_action: action,
          updated_at: decisionTimestamp,
        }
      })
      : [
        {
          trading_day: tradingDay,
          day_index: toNumber(replayStatus?.day_index, 0),
          decisions: 1,
          buys: isExecutedBuy ? 1 : 0,
          sells: isExecutedSell ? 1 : 0,
          holds: action === 'hold' ? 1 : 0,
          start_balance: netTotalBalance,
          end_balance: netTotalBalance,
          peak_balance: netTotalBalance,
          trough_balance: netTotalBalance,
          fees_paid: decisionFee,
          last_action: action,
          updated_at: decisionTimestamp,
        },
        ...prevDaily,
      ]

    const runtimeMeta = decision?.runtime_meta || {}
    const decisionEveryBars = toNumber(runtimeMeta.decision_every_bars, prev.config?.decision_every_bars || 10)
    const llmModel = runtimeMeta.llm_model || prev.config?.llm_model || null

    const next = {
      ...prev,
      schema_version: 'agent.memory.v2',
      meta: {
        ...(prev.meta || {}),
        updated_at: decisionTimestamp,
        next_position_id: nextPositionId,
      },
      config: {
        ...(prev.config || {}),
        initial_balance: initialBalance,
        decision_every_bars: Math.max(1, Math.floor(decisionEveryBars)),
        llm_model: llmModel,
        commission_rate: safeCommissionRate,
      },
      trader_id: traderId,
      trader_name: trader.trader_name,
      updated_at: decisionTimestamp,
      replay: {
        trading_day: replayStatus?.trading_day || prev.replay.trading_day,
        day_index: toNumber(replayStatus?.day_index, prev.replay.day_index),
        day_count: toNumber(replayStatus?.day_count, prev.replay.day_count),
        bar_cursor: toNumber(replayStatus?.cursor_index, prev.replay.bar_cursor),
        is_day_start: !!replayStatus?.is_day_start,
        is_day_end: !!replayStatus?.is_day_end,
      },
      stats: {
        initial_balance: initialBalance,
        latest_total_balance: netTotalBalance,
        latest_available_balance: netAvailableBalance,
        latest_unrealized_profit: round(unrealized, 2),
        return_rate_pct: round(((netTotalBalance - initialBalance) / initialBalance) * 100, 4),
        peak_balance: round(Math.max(toNumber(prev.stats.peak_balance, netTotalBalance), netTotalBalance), 2),
        trough_balance: round(Math.min(toNumber(prev.stats.trough_balance, netTotalBalance), netTotalBalance), 2),
        decisions: toNumber(prev.stats.decisions, 0) + 1,
        wins,
        losses,
        holds,
        buy_trades: buyTrades,
        sell_trades: sellTrades,
        total_fees_paid: totalFeesPaid,
      },
      daily_journal: nextDaily.slice(0, 30),
      holdings: normalizeHoldings(positions, netTotalBalance),
      open_lots: openLots,
      closed_positions: closedPositions,
      equity_curve: equityCurve,
      recent_actions: [
        {
          cycle_number: toNumber(decision?.cycle_number, 0),
          action,
          symbol: decision?.decisions?.[0]?.symbol || null,
          price: toNumber(decision?.decisions?.[0]?.price, 0),
          ts: decisionTimestamp,
          source: decision?.decision_source || 'rule.heuristic',
          fee_paid: decisionFee,
        },
        ...(prev.recent_actions || []),
      ].slice(0, 30),
    }

    snapshots.set(traderId, next)
    await persist(traderId)
  }

  function getSnapshot(traderId) {
    return snapshots.get(traderId) || null
  }

  function getAllSnapshots() {
    return Array.from(snapshots.values())
  }

  return {
    hydrate,
    resetAll,
    recordSnapshot,
    getSnapshot,
    getAllSnapshots,
  }
}
