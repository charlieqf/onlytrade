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
  assert.equal(snapshot.stats.latest_total_balance, 99999)
  assert.equal(snapshot.stats.buy_trades, 1)
  assert.equal(snapshot.recent_actions[0].fee_paid, 1)
})
