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
    const prev = snapshots.get(traderId) || defaultSnapshot(trader)

    const totalBalance = toNumber(account?.total_equity ?? decision?.account_state?.total_balance, prev.stats.latest_total_balance)
    const availableBalance = toNumber(account?.available_balance ?? decision?.account_state?.available_balance, prev.stats.latest_available_balance)
    const unrealized = toNumber(account?.unrealized_profit ?? decision?.account_state?.total_unrealized_profit, prev.stats.latest_unrealized_profit)
    const initialBalance = Math.max(1, toNumber(prev.stats.initial_balance, 100000))
    const tradingDay = replayStatus?.trading_day || prev.replay.trading_day || 'unknown'
    const decisionFee = commissionFeeFromDecision(decision, safeCommissionRate)
    const netTotalBalance = round(Math.max(0, totalBalance - decisionFee), 2)
    const netAvailableBalance = round(Math.max(0, availableBalance - decisionFee), 2)

    const action = String(decision?.decisions?.[0]?.action || 'hold').toLowerCase()
    const holds = prev.stats.holds + (action === 'hold' ? 1 : 0)
    const wins = prev.stats.wins + (unrealized > 0 ? 1 : 0)
    const losses = prev.stats.losses + (unrealized < 0 ? 1 : 0)
    const buyTrades = toNumber(prev.stats.buy_trades, 0) + (action === 'buy' ? 1 : 0)
    const sellTrades = toNumber(prev.stats.sell_trades, 0) + (action === 'sell' ? 1 : 0)
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
          buys: toNumber(item.buys, 0) + (action === 'buy' ? 1 : 0),
          sells: toNumber(item.sells, 0) + (action === 'sell' ? 1 : 0),
          holds: toNumber(item.holds, 0) + (action === 'hold' ? 1 : 0),
          end_balance: netTotalBalance,
          peak_balance: round(Math.max(toNumber(item.peak_balance, netTotalBalance), netTotalBalance), 2),
          trough_balance: round(Math.min(toNumber(item.trough_balance, netTotalBalance), netTotalBalance), 2),
          fees_paid: round(toNumber(item.fees_paid, 0) + decisionFee, 2),
          last_action: action,
          updated_at: new Date().toISOString(),
        }
      })
      : [
        {
          trading_day: tradingDay,
          day_index: toNumber(replayStatus?.day_index, 0),
          decisions: 1,
          buys: action === 'buy' ? 1 : 0,
          sells: action === 'sell' ? 1 : 0,
          holds: action === 'hold' ? 1 : 0,
          start_balance: netTotalBalance,
          end_balance: netTotalBalance,
          peak_balance: netTotalBalance,
          trough_balance: netTotalBalance,
          fees_paid: decisionFee,
          last_action: action,
          updated_at: new Date().toISOString(),
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
        updated_at: new Date().toISOString(),
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
      updated_at: new Date().toISOString(),
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
      recent_actions: [
        {
          cycle_number: toNumber(decision?.cycle_number, 0),
          action,
          symbol: decision?.decisions?.[0]?.symbol || null,
          price: toNumber(decision?.decisions?.[0]?.price, 0),
          ts: decision?.timestamp || new Date().toISOString(),
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
