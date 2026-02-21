import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

import { createAgentMemoryStore } from '../src/agentMemoryStore.mjs'

test('agent memory store records and persists trader snapshot', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'onlytrade-memory-'))
  const traders = [
    { trader_id: 't_001', trader_name: 'HS300 Momentum' },
  ]

  const store = createAgentMemoryStore({ rootDir, traders })
  await store.hydrate()

  await store.recordSnapshot({
    trader: traders[0],
    decision: {
      timestamp: '2026-02-12T00:00:00.000Z',
      cycle_number: 5,
      decisions: [{ action: 'buy', symbol: '600519.SH', price: 1500.2 }],
      account_state: { total_balance: 101000, available_balance: 90000, total_unrealized_profit: 400 },
    },
    account: {
      total_equity: 101000,
      available_balance: 90000,
      unrealized_profit: 400,
    },
    positions: [
      {
        symbol: '600519.SH',
        quantity: 100,
        entry_price: 1498,
        mark_price: 1500,
        unrealized_pnl: 200,
      },
    ],
    replayStatus: {
      trading_day: '2026-02-12',
      day_index: 1,
      day_count: 3,
      cursor_index: 20,
      is_day_start: false,
      is_day_end: false,
    },
  })

  const snapshot = store.getSnapshot('t_001')
  assert.ok(snapshot)
  assert.equal(snapshot.stats.latest_total_balance, 101000)
  assert.equal(snapshot.stats.decisions, 1)
  assert.equal(snapshot.holdings.length, 1)
  assert.equal(snapshot.replay.day_count, 3)
})

test('agent memory store resetAll recreates clean defaults', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'onlytrade-memory-reset-'))
  const traders = [{ trader_id: 't_001', trader_name: 'HS300 Momentum' }]
  const store = createAgentMemoryStore({ rootDir, traders })
  await store.hydrate()

  await store.recordSnapshot({
    trader: traders[0],
    decision: {
      timestamp: '2026-02-12T00:00:00.000Z',
      cycle_number: 2,
      decisions: [{ action: 'buy', symbol: '600519.SH', price: 1500 }],
      account_state: { total_balance: 101000, available_balance: 90000, total_unrealized_profit: 100 },
    },
    account: {
      total_equity: 101000,
      available_balance: 90000,
      unrealized_profit: 100,
    },
    positions: [],
    replayStatus: {
      trading_day: '2026-02-12',
      day_index: 1,
      day_count: 3,
      cursor_index: 5,
      is_day_start: false,
      is_day_end: false,
    },
  })

  assert.equal(store.getSnapshot('t_001').stats.decisions, 1)
  await store.resetAll()
  const snapshot = store.getSnapshot('t_001')
  assert.equal(snapshot.stats.decisions, 0)
  assert.equal(snapshot.stats.initial_balance, 100000)
  assert.equal(snapshot.replay.day_index, 0)
})

test('agent memory store deducts commission fee on buy/sell decisions', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'onlytrade-memory-fee-'))
  const traders = [{ trader_id: 't_001', trader_name: 'HS300 Momentum' }]
  const store = createAgentMemoryStore({ rootDir, traders, commissionRate: 0.001 })
  await store.hydrate()

  await store.recordSnapshot({
    trader: traders[0],
    decision: {
      timestamp: '2026-02-12T00:00:00.000Z',
      cycle_number: 1,
      decisions: [{ action: 'buy', symbol: '600519.SH', price: 10, quantity: 100, executed: true, filled_notional: 1000, fee_paid: 1 }],
      account_state: { total_balance: 100000, available_balance: 100000, total_unrealized_profit: 0 },
    },
    account: {
      total_equity: 100000,
      available_balance: 100000,
      unrealized_profit: 0,
    },
    positions: [],
    replayStatus: {
      trading_day: '2026-02-12',
      day_index: 1,
      day_count: 3,
      cursor_index: 1,
      is_day_start: true,
      is_day_end: false,
    },
  })

  const snapshot = store.getSnapshot('t_001')
  assert.equal(snapshot.stats.total_fees_paid, 1)
  assert.equal(snapshot.stats.latest_total_balance, 100000)
  assert.equal(snapshot.stats.buy_trades, 1)
  assert.equal(snapshot.recent_actions[0].fee_paid, 1)
})

test('agent memory store counts buy/sell trades only when orders execute', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'onlytrade-memory-exec-count-'))
  const traders = [{ trader_id: 't_001', trader_name: 'HS300 Momentum' }]
  const store = createAgentMemoryStore({ rootDir, traders, commissionRate: 0.001 })
  await store.hydrate()

  await store.recordSnapshot({
    trader: traders[0],
    decision: {
      timestamp: '2026-02-12T00:00:00.000Z',
      cycle_number: 1,
      decisions: [{ action: 'buy', symbol: '600519.SH', price: 10, quantity: 100, executed: false, success: false }],
      account_state: { total_balance: 100000, available_balance: 100000, total_unrealized_profit: 0 },
    },
    account: {
      total_equity: 100000,
      available_balance: 100000,
      unrealized_profit: 0,
    },
    positions: [],
    replayStatus: {
      trading_day: '2026-02-12',
      day_index: 1,
      day_count: 3,
      cursor_index: 1,
      is_day_start: true,
      is_day_end: false,
    },
  })

  const snapshot = store.getSnapshot('t_001')
  assert.equal(snapshot.stats.buy_trades, 0)
  assert.equal(snapshot.stats.sell_trades, 0)
})

test('agent memory store updates wins/losses only from executed sell realized pnl', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'onlytrade-memory-winloss-'))
  const traders = [{ trader_id: 't_001', trader_name: 'HS300 Momentum' }]
  const store = createAgentMemoryStore({ rootDir, traders })
  await store.hydrate()

  await store.recordSnapshot({
    trader: traders[0],
    decision: {
      timestamp: '2026-02-12T00:00:00.000Z',
      cycle_number: 1,
      decisions: [{ action: 'hold', symbol: '600519.SH', price: 10 }],
      account_state: { total_balance: 100200, available_balance: 100000, total_unrealized_profit: 200 },
    },
    account: {
      total_equity: 100200,
      available_balance: 100000,
      unrealized_profit: 200,
    },
    positions: [],
    replayStatus: {
      trading_day: '2026-02-12',
      day_index: 1,
      day_count: 3,
      cursor_index: 1,
      is_day_start: true,
      is_day_end: false,
    },
  })

  await store.recordSnapshot({
    trader: traders[0],
    decision: {
      timestamp: '2026-02-12T00:01:00.000Z',
      cycle_number: 2,
      decisions: [{ action: 'sell', symbol: '600519.SH', price: 10.5, executed: true, realized_pnl: 120 }],
      account_state: { total_balance: 100320, available_balance: 100320, total_unrealized_profit: 0 },
    },
    account: {
      total_equity: 100320,
      available_balance: 100320,
      unrealized_profit: 0,
    },
    positions: [],
    replayStatus: {
      trading_day: '2026-02-12',
      day_index: 1,
      day_count: 3,
      cursor_index: 2,
      is_day_start: false,
      is_day_end: false,
    },
  })

  await store.recordSnapshot({
    trader: traders[0],
    decision: {
      timestamp: '2026-02-12T00:02:00.000Z',
      cycle_number: 3,
      decisions: [{ action: 'sell', symbol: '600519.SH', price: 9.5, executed: true, realized_pnl: -80 }],
      account_state: { total_balance: 100240, available_balance: 100240, total_unrealized_profit: 0 },
    },
    account: {
      total_equity: 100240,
      available_balance: 100240,
      unrealized_profit: 0,
    },
    positions: [],
    replayStatus: {
      trading_day: '2026-02-12',
      day_index: 1,
      day_count: 3,
      cursor_index: 3,
      is_day_start: false,
      is_day_end: false,
    },
  })

  const snapshot = store.getSnapshot('t_001')
  assert.equal(snapshot.stats.wins, 1)
  assert.equal(snapshot.stats.losses, 1)
})

test('agent memory store records closed positions and equity curve from executed trades', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'onlytrade-memory-ledger-'))
  const traders = [{ trader_id: 't_001', trader_name: 'HS300 Momentum' }]
  const store = createAgentMemoryStore({ rootDir, traders, commissionRate: 0.001 })
  await store.hydrate()

  await store.recordSnapshot({
    trader: traders[0],
    decision: {
      timestamp: '2026-02-12T09:30:00.000Z',
      cycle_number: 1,
      decisions: [{ action: 'buy', symbol: '600519.SH', price: 10, filled_quantity: 100, executed: true, fee_paid: 1, order_id: 100001 }],
      account_state: { total_balance: 99999, available_balance: 98999, total_unrealized_profit: 0 },
    },
    account: {
      total_equity: 99999,
      available_balance: 98999,
      unrealized_profit: 0,
    },
    positions: [
      {
        symbol: '600519.SH',
        quantity: 100,
        entry_price: 10,
        mark_price: 10,
        unrealized_pnl: 0,
      },
    ],
    replayStatus: {
      trading_day: '2026-02-12',
      day_index: 1,
      day_count: 3,
      cursor_index: 1,
      is_day_start: true,
      is_day_end: false,
    },
  })

  await store.recordSnapshot({
    trader: traders[0],
    decision: {
      timestamp: '2026-02-12T09:35:00.000Z',
      cycle_number: 2,
      decisions: [{ action: 'sell', symbol: '600519.SH', price: 10.5, filled_quantity: 100, executed: true, fee_paid: 1.05, order_id: 100002 }],
      account_state: { total_balance: 100047.95, available_balance: 100047.95, total_unrealized_profit: 0 },
    },
    account: {
      total_equity: 100047.95,
      available_balance: 100047.95,
      unrealized_profit: 0,
    },
    positions: [],
    replayStatus: {
      trading_day: '2026-02-12',
      day_index: 1,
      day_count: 3,
      cursor_index: 2,
      is_day_start: false,
      is_day_end: false,
    },
  })

  const snapshot = store.getSnapshot('t_001')
  assert.equal(Array.isArray(snapshot.open_lots), true)
  assert.equal(snapshot.open_lots.length, 0)
  assert.equal(Array.isArray(snapshot.closed_positions), true)
  assert.equal(snapshot.closed_positions.length, 1)
  assert.equal(snapshot.closed_positions[0].symbol, '600519.SH')
  assert.equal(snapshot.closed_positions[0].entry_order_id, '100001')
  assert.equal(snapshot.closed_positions[0].exit_order_id, '100002')
  assert.equal(Array.isArray(snapshot.equity_curve), true)
  assert.equal(snapshot.equity_curve.length >= 3, true)
  assert.equal(snapshot.equity_curve[snapshot.equity_curve.length - 1].total_equity, 100047.95)
})

test('agent memory store resetTrader scopes reset to one trader', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'onlytrade-memory-reset-trader-'))
  const traders = [
    { trader_id: 't_001', trader_name: 'HS300 Momentum' },
    { trader_id: 't_002', trader_name: 'Value Rebound' },
  ]
  const store = createAgentMemoryStore({ rootDir, traders })
  await store.hydrate()

  await store.recordSnapshot({
    trader: traders[0],
    decision: {
      timestamp: '2026-02-12T09:30:00.000Z',
      cycle_number: 1,
      decisions: [{ action: 'buy', symbol: '600519.SH', price: 10, filled_quantity: 100, executed: true }],
      account_state: { total_balance: 100000, available_balance: 99000, total_unrealized_profit: 0 },
    },
    account: {
      total_equity: 100000,
      available_balance: 99000,
      unrealized_profit: 0,
    },
    positions: [
      {
        symbol: '600519.SH',
        quantity: 100,
        entry_price: 10,
        mark_price: 10,
        unrealized_pnl: 0,
      },
    ],
    replayStatus: {
      trading_day: '2026-02-12',
      day_index: 1,
      day_count: 3,
      cursor_index: 1,
      is_day_start: true,
      is_day_end: false,
    },
  })

  await store.recordSnapshot({
    trader: traders[1],
    decision: {
      timestamp: '2026-02-12T09:31:00.000Z',
      cycle_number: 1,
      decisions: [{ action: 'hold', symbol: '300750.SZ', price: 20 }],
      account_state: { total_balance: 100200, available_balance: 100200, total_unrealized_profit: 0 },
    },
    account: {
      total_equity: 100200,
      available_balance: 100200,
      unrealized_profit: 0,
    },
    positions: [],
    replayStatus: {
      trading_day: '2026-02-12',
      day_index: 1,
      day_count: 3,
      cursor_index: 2,
      is_day_start: false,
      is_day_end: false,
    },
  })

  const beforeT2 = store.getSnapshot('t_002')
  assert.equal(beforeT2.stats.decisions, 1)

  const resetT1 = await store.resetTrader('t_001', {
    resetMemory: false,
    resetPositions: true,
    resetStats: false,
    persistSnapshot: false,
  })

  assert.equal(Array.isArray(resetT1.holdings), true)
  assert.equal(resetT1.holdings.length, 0)
  assert.equal(Array.isArray(resetT1.open_lots), true)
  assert.equal(resetT1.open_lots.length, 0)

  const afterT2 = store.getSnapshot('t_002')
  assert.equal(afterT2.stats.decisions, 1)
  assert.equal(afterT2.stats.latest_total_balance, 100200)

  const resetStatsOnly = await store.resetTrader('t_001', {
    resetMemory: false,
    resetPositions: false,
    resetStats: true,
    persistSnapshot: false,
  })

  assert.equal(resetStatsOnly.stats.decisions, 0)
  assert.equal(resetStatsOnly.stats.buy_trades, 0)
  assert.equal(Array.isArray(resetStatsOnly.daily_journal), true)
  assert.equal(resetStatsOnly.daily_journal.length, 0)
})
