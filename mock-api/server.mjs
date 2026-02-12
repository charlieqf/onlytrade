import express from 'express'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMarketDataService } from './src/marketProxy.mjs'
import { buildAgentMarketContext, buildPositionState } from './src/agentMarketContext.mjs'
import { createInMemoryAgentRuntime } from './src/agentDecisionRuntime.mjs'
import { createReplayEngine } from './src/replayEngine.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '..')

const PORT = Number(process.env.PORT || 8080)
const BOOT_TS = Date.now()
const STEP_MS = 8000
const MARKET_PROVIDER = (process.env.MARKET_PROVIDER || 'mock').toLowerCase() === 'real' ? 'real' : 'mock'
const MARKET_UPSTREAM_URL = process.env.MARKET_UPSTREAM_URL || ''
const MARKET_UPSTREAM_API_KEY = process.env.MARKET_UPSTREAM_API_KEY || ''
const MARKET_STREAM_POLL_MS = Math.max(300, Number(process.env.MARKET_STREAM_POLL_MS || 500))
const AGENT_RUNTIME_CYCLE_MS = Math.max(3000, Number(process.env.AGENT_RUNTIME_CYCLE_MS || 15000))
const AGENT_DECISION_EVERY_BARS = Math.max(1, Number(process.env.AGENT_DECISION_EVERY_BARS || 1))
const REPLAY_SPEED = Math.max(0.1, Number(process.env.REPLAY_SPEED || 60))
const REPLAY_WARMUP_BARS = Math.max(1, Number(process.env.REPLAY_WARMUP_BARS || 120))
const REPLAY_TICK_MS = Math.max(100, Number(process.env.REPLAY_TICK_MS || 250))
const REPLAY_LOOP = String(process.env.REPLAY_LOOP || 'true').toLowerCase() !== 'false'
const MARKET_DAILY_HISTORY_DAYS = (() => {
  const parsed = Number(process.env.MARKET_DAILY_HISTORY_DAYS || 90)
  if (!Number.isFinite(parsed)) return 90
  return Math.max(20, Math.min(Math.floor(parsed), 365))
})()

const REPLAY_PATH = path.join(
  ROOT_DIR,
  'onlytrade-web',
  'public',
  'replay',
  'cn-a',
  'latest',
  'frames.1m.json'
)

const DAILY_HISTORY_PATH = path.join(
  ROOT_DIR,
  'onlytrade-web',
  'public',
  'replay',
  'cn-a',
  'history',
  `frames.1d.${MARKET_DAILY_HISTORY_DAYS}.json`
)

const TRADERS = [
  {
    trader_id: 't_001',
    trader_name: 'HS300 Momentum',
    ai_model: 'qwen',
    exchange_id: 'sim-cn',
    is_running: true,
    show_in_competition: true,
    strategy_name: 'Momentum + trend confirmation',
  },
  {
    trader_id: 't_002',
    trader_name: 'Value Rebound',
    ai_model: 'deepseek',
    exchange_id: 'sim-cn',
    is_running: true,
    show_in_competition: true,
    strategy_name: 'Mean reversion + support zones',
  },
  {
    trader_id: 't_003',
    trader_name: 'Event Flow',
    ai_model: 'gpt-4o-mini',
    exchange_id: 'sim-cn',
    is_running: true,
    show_in_competition: true,
    strategy_name: 'Event-driven + risk controls',
  },
]

const CN_STOCK_NAME_BY_SYMBOL = {
  '600519.SH': '贵州茅台',
  '601318.SH': '中国平安',
  '600036.SH': '招商银行',
  '300750.SZ': '宁德时代',
  '000858.SZ': '五粮液',
}

const BASE_COMPETITION = {
  count: 3,
  traders: [
    {
      trader_id: 't_001',
      trader_name: 'HS300 Momentum',
      ai_model: 'qwen',
      exchange: 'sim',
      total_equity: 102345.12,
      total_pnl: 2345.12,
      total_pnl_pct: 2.35,
      position_count: 3,
      margin_used_pct: 0,
      is_running: true,
    },
    {
      trader_id: 't_002',
      trader_name: 'Value Rebound',
      ai_model: 'deepseek',
      exchange: 'sim',
      total_equity: 100845.88,
      total_pnl: 845.88,
      total_pnl_pct: 0.85,
      position_count: 2,
      margin_used_pct: 0,
      is_running: true,
    },
    {
      trader_id: 't_003',
      trader_name: 'Event Flow',
      ai_model: 'gpt-4o-mini',
      exchange: 'sim',
      total_equity: 98790.44,
      total_pnl: -1209.56,
      total_pnl_pct: -1.21,
      position_count: 1,
      margin_used_pct: 0,
      is_running: true,
    },
  ],
}

const DECISION_SCRIPT = [
  {
    action: 'open_long',
    symbol: '600519.SH',
    price: 1510.2,
    stop_loss: 1480,
    take_profit: 1568,
    confidence: 74,
    reasoning: 'Trend and volume remain supportive; keep position sizing conservative.',
    input_prompt: 'HS300 momentum snapshot',
    execution_log: 'virtual fill applied at next bar open',
  },
  {
    action: 'hold',
    symbol: '300750.SZ',
    price: 182.8,
    confidence: 68,
    reasoning: 'No clear downside break; hold and wait for confirmation.',
    input_prompt: 'risk review',
    execution_log: 'no new order emitted',
  },
  {
    action: 'open_long',
    symbol: '601318.SH',
    price: 48.6,
    stop_loss: 47.2,
    take_profit: 50.9,
    confidence: 71,
    reasoning: 'Relative strength improving with low drawdown risk.',
    input_prompt: 'rotation check',
    execution_log: 'virtual order queued and filled',
  },
  {
    action: 'close_long',
    symbol: '600519.SH',
    price: 1528.0,
    confidence: 66,
    reasoning: 'Target reached on schedule; lock gains and reduce concentration.',
    input_prompt: 'take-profit rule',
    execution_log: 'partial close executed',
  },
  {
    action: 'hold',
    symbol: '601318.SH',
    price: 49.1,
    confidence: 63,
    reasoning: 'Still inside trend channel; no adjustment needed.',
    input_prompt: 'channel monitor',
    execution_log: 'no action',
  },
]

function tick() {
  return Math.floor((Date.now() - BOOT_TS) / STEP_MS)
}

function ok(data) {
  return { success: true, data }
}

function fail(error, status = 500) {
  return { success: false, error, status }
}

function getCompetitionData() {
  const t = tick()
  const initial = 100000

  const traders = BASE_COMPETITION.traders.map((trader, idx) => {
    const phase = idx * 2.1
    const wave = Math.sin((t + phase) / 2.8) * 0.55
    const drift = (idx === 0 ? 0.015 : idx === 1 ? 0.004 : -0.006) * t
    const pct = Number((trader.total_pnl_pct + wave + drift).toFixed(2))
    const pnl = Number(((initial * pct) / 100).toFixed(2))
    const equity = Number((initial + pnl).toFixed(2))

    return {
      ...trader,
      total_pnl_pct: pct,
      total_pnl: pnl,
      total_equity: equity,
      position_count: 1 + ((t + idx) % 3),
    }
  })

  return {
    count: traders.length,
    traders,
  }
}

function getTraderById(traderId) {
  return TRADERS.find((t) => t.trader_id === traderId) || TRADERS[0]
}

function getStatus(traderId) {
  const t = tick()
  const trader = getTraderById(traderId)
  const runtimeCallCount = agentRuntime?.getCallCount(traderId) || 0
  const callCount = runtimeCallCount > 0 ? runtimeCallCount : 128 + t
  const replaySpeed = replayEngine?.getStatus?.().speed || REPLAY_SPEED
  const secPerBar = 60 / Math.max(0.1, replaySpeed)
  const scanIntervalSec = Math.max(1, Math.round(secPerBar * agentDecisionEveryBars))
  const runtimeRunning = !!agentRuntime?.getState?.().running
  return {
    trader_id: trader.trader_id,
    trader_name: trader.trader_name,
    ai_model: trader.ai_model,
    is_running: runtimeRunning,
    start_time: new Date(Date.now() - 1000 * 60 * (95 + t)).toISOString(),
    runtime_minutes: 95 + t,
    call_count: callCount,
    initial_balance: 100000,
    scan_interval: `${scanIntervalSec}s (~${agentDecisionEveryBars} bars)`,
    stop_until: '',
    last_reset_time: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    ai_provider: 'mock-runtime',
    strategy_type: 'ai_trading',
  }
}

function getAccount(traderId) {
  const competition = getCompetitionData()
  const rank = competition.traders.find((t) => t.trader_id === traderId) || competition.traders[0]
  const floating = Number((Math.sin(tick() / 3) * 800).toFixed(2))

  return {
    total_equity: rank.total_equity,
    wallet_balance: rank.total_equity - Math.max(0, floating),
    unrealized_profit: floating,
    available_balance: rank.total_equity * 0.92,
    total_pnl: rank.total_pnl,
    total_pnl_pct: rank.total_pnl_pct,
    initial_balance: 100000,
    daily_pnl: rank.total_pnl * 0.28,
    position_count: rank.position_count,
    margin_used: 0,
    margin_used_pct: 0,
  }
}

function getPositions(traderId) {
  const t = tick()
  const drift = Math.sin((t + 1) / 2)
  const base = [
    {
      symbol: '600519.SH',
      side: 'LONG',
      entry_price: 1498.2,
      mark_price: Number((1512.4 + drift * 4.5).toFixed(2)),
      quantity: 100,
      leverage: 1,
      unrealized_pnl: Number((1420 + drift * 480).toFixed(2)),
      unrealized_pnl_pct: Number((0.95 + drift * 0.32).toFixed(2)),
      liquidation_price: 0,
      margin_used: 0,
    },
    {
      symbol: '300750.SZ',
      side: 'LONG',
      entry_price: 186.3,
      mark_price: Number((182.8 - drift * 1.2).toFixed(2)),
      quantity: 300,
      leverage: 1,
      unrealized_pnl: Number((-1050 - drift * 220).toFixed(2)),
      unrealized_pnl_pct: Number((-1.88 - drift * 0.25).toFixed(2)),
      liquidation_price: 0,
      margin_used: 0,
    },
  ]

  if (traderId === 't_003') return base.slice(0, 1)
  return base
}

function getScriptedDecisions(limit = 5) {
  const now = Date.now()
  const t = tick()
  const count = Math.max(1, Math.min(limit, Math.min(DECISION_SCRIPT.length, 2 + (t % DECISION_SCRIPT.length))))

  return Array.from({ length: count }).map((_, idx) => {
    const scriptIndex = (t + idx) % DECISION_SCRIPT.length
    const script = DECISION_SCRIPT[scriptIndex]
    const ts = new Date(now - idx * 1000 * 60 * 5).toISOString()
    const cycle = 128 + t - idx

    return {
      timestamp: ts,
      cycle_number: cycle,
      system_prompt: 'demo',
      input_prompt: script.input_prompt,
      cot_trace: 'compressed-demo-rationale',
      decision_json: JSON.stringify({ action: script.action, symbol: script.symbol }),
      account_state: {
        total_balance: 102345.12,
        available_balance: 94123.4,
        total_unrealized_profit: 370,
        position_count: 2,
        margin_used_pct: 0,
      },
      positions: [],
      candidate_coins: ['600519.SH', '300750.SZ', '601318.SH'],
      decisions: [
        {
          action: script.action,
          symbol: script.symbol,
          quantity: script.action === 'hold' ? 0 : 100,
          leverage: 1,
          price: script.price,
          stop_loss: script.stop_loss,
          take_profit: script.take_profit,
          confidence: script.confidence,
          reasoning: script.reasoning,
          order_id: 100000 + cycle,
          timestamp: ts,
          success: true,
        },
      ],
      execution_log: [script.execution_log],
      success: true,
      error_message: '',
    }
  })
}

function getStatistics() {
  const t = tick()
  const runtimeMetrics = agentRuntime?.getMetrics() || { totalCycles: 0, successfulCycles: 0, failedCycles: 0 }
  const totalCycles = Math.max(128 + t, runtimeMetrics.totalCycles)
  const failedCycles = Math.max(6, runtimeMetrics.failedCycles)
  return {
    total_cycles: totalCycles,
    successful_cycles: Math.max(totalCycles - failedCycles, runtimeMetrics.successfulCycles),
    failed_cycles: failedCycles,
    total_open_positions: 37 + Math.floor(t / 2),
    total_close_positions: 35 + Math.floor(t / 3),
  }
}

function hashSymbol(symbol) {
  let hash = 0
  for (let i = 0; i < symbol.length; i++) {
    hash = (hash << 5) - hash + symbol.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

function intervalMs(interval) {
  switch (interval) {
    case '1m': return 60_000
    case '5m': return 5 * 60_000
    case '15m': return 15 * 60_000
    case '30m': return 30 * 60_000
    case '60m':
    case '1h': return 60 * 60_000
    case '4h': return 4 * 60 * 60_000
    case '1d': return 24 * 60 * 60_000
    default: return 5 * 60_000
  }
}

function tradingDayString(tsMs) {
  return new Date(tsMs).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
}

function sessionPhase(tsMs) {
  const hm = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(tsMs))
  const [hh, mm] = hm.split(':').map(Number)
  const mins = hh * 60 + mm

  if (mins >= 555 && mins < 570) return 'pre_open'
  if (mins >= 570 && mins < 690) return 'continuous_am'
  if (mins >= 690 && mins < 780) return 'lunch_break'
  if (mins >= 780 && mins < 900) return 'continuous_pm'
  if (mins >= 900 && mins < 915) return 'close_auction'
  return 'closed'
}

function exchangeFromSymbol(symbol) {
  if (symbol.endsWith('.SH')) return 'SSE'
  if (symbol.endsWith('.SZ')) return 'SZSE'
  return 'OTHER'
}

function generateFrames({ symbol, interval, limit, mode = 'mock', provider = 'mock-api-generated' }) {
  const seed = hashSymbol(symbol)
  const base = 80 + (seed % 1500)
  const step = intervalMs(interval)
  const safeLimit = Math.max(1, Math.min(limit, 2000))
  const frames = []
  let prev = base
  const now = Date.now()
  const startSeq = Math.floor(now / step) - safeLimit

  for (let i = safeLimit - 1; i >= 0; i--) {
    const start = now - i * step
    const end = start + step

    const drift = Math.sin((safeLimit - i) / 12) * (base * 0.001)
    const noise = ((seed + i * 17) % 11 - 5) * (base * 0.0006)

    const open = prev
    const close = Math.max(0.1, open + drift + noise)
    const high = Math.max(open, close) * 1.004
    const low = Math.min(open, close) * 0.996
    const volumeShares = 5000 + ((seed + i * 29) % 9000)
    const turnoverCny = Number((volumeShares * close).toFixed(2))

    frames.push({
      schema_version: 'market.bar.v1',
      market: 'CN-A',
      mode,
      provider,
      feed: 'bars',
      seq: startSeq + (safeLimit - i),
      event_ts_ms: end,
      ingest_ts_ms: end + 120,
      instrument: {
        symbol,
        exchange: exchangeFromSymbol(symbol),
        timezone: 'Asia/Shanghai',
        currency: 'CNY',
      },
      interval,
      window: {
        start_ts_ms: start,
        end_ts_ms: end,
        trading_day: tradingDayString(start),
      },
      session: {
        phase: sessionPhase(start),
        is_halt: false,
        is_partial: i === 0,
      },
      bar: {
        open: Number(open.toFixed(4)),
        high: Number(high.toFixed(4)),
        low: Number(low.toFixed(4)),
        close: Number(close.toFixed(4)),
        volume_shares: volumeShares,
        turnover_cny: turnoverCny,
        vwap: Number((turnoverCny / volumeShares).toFixed(4)),
      },
    })

    prev = close
  }

  return frames
}

function framesToKlines(frames) {
  return frames.map((frame) => ({
    openTime: frame.window.start_ts_ms,
    open: frame.bar.open,
    high: frame.bar.high,
    low: frame.bar.low,
    close: frame.bar.close,
    volume: frame.bar.volume_shares,
    quoteVolume: frame.bar.turnover_cny,
  }))
}

function generateEquityHistory(traderId, hours = 0) {
  const competition = getCompetitionData()
  const rank = competition.traders.find((t) => t.trader_id === traderId) || competition.traders[0]
  const targetPct = (rank?.total_pnl_pct ?? 0) / 100

  const points = hours > 0 ? Math.max(12, Math.min(hours * 6, 1000)) : 96
  const now = Date.now()
  const step = 10 * 60_000
  const base = 100000

  return Array.from({ length: points }).map((_, idx) => {
    const p = (idx + 1) / points
    const wave = Math.sin(idx / 6) * 0.002
    const equity = base * (1 + targetPct * p + wave)
    return {
      timestamp: new Date(now - (points - idx) * step).toISOString(),
      total_equity: Number(equity.toFixed(2)),
      pnl: Number((equity - base).toFixed(2)),
      pnl_pct: Number((((equity - base) / base) * 100).toFixed(4)),
      total_pnl_pct: Number((((equity - base) / base) * 100).toFixed(4)),
      cycle_number: idx + 1,
    }
  })
}

function getPositionHistory(traderId, limit = 100) {
  const now = Date.now()
  const positions = [
    {
      id: 1,
      trader_id: traderId,
      exchange_id: 'sim-cn',
      exchange_type: 'sim',
      symbol: '600519.SH',
      side: 'LONG',
      quantity: 100,
      entry_quantity: 100,
      entry_price: 1480,
      entry_order_id: 'demo-entry-1',
      entry_time: new Date(now - 1000 * 60 * 200).toISOString(),
      exit_price: 1510,
      exit_order_id: 'demo-exit-1',
      exit_time: new Date(now - 1000 * 60 * 140).toISOString(),
      realized_pnl: 3000,
      fee: 45,
      leverage: 1,
      status: 'closed',
      close_reason: 'take_profit',
      created_at: new Date(now - 1000 * 60 * 200).toISOString(),
      updated_at: new Date(now - 1000 * 60 * 140).toISOString(),
    },
  ].slice(0, Math.max(1, Math.min(limit, 1000)))

  return {
    positions,
    stats: {
      total_trades: 12,
      win_trades: 8,
      loss_trades: 4,
      win_rate: 66.67,
      profit_factor: 1.84,
      sharpe_ratio: 1.2,
      total_pnl: 8450,
      total_fee: 390,
      avg_win: 1560,
      avg_loss: -890,
      max_drawdown_pct: 4.8,
    },
    symbol_stats: [
      {
        symbol: '600519.SH',
        total_trades: 7,
        win_trades: 5,
        win_rate: 71.43,
        total_pnl: 6200,
        avg_pnl: 885.7,
        avg_hold_mins: 95,
      },
    ],
    direction_stats: [
      {
        side: 'LONG',
        trade_count: 12,
        win_rate: 66.67,
        total_pnl: 8450,
        avg_pnl: 704.1,
      },
    ],
  }
}

let replayBatch = null
let dailyHistoryBatch = null
let agentRuntime = null
let replayEngine = null
let replayEngineTimer = null
let agentDecisionEveryBars = AGENT_DECISION_EVERY_BARS
let replayBarsSinceAgentDecision = 0
let queuedAgentDecisionSteps = 0
let agentDispatchInFlight = false
let marketDataService = createMarketDataService({
  provider: MARKET_PROVIDER,
  upstreamBaseUrl: MARKET_UPSTREAM_URL,
  upstreamApiKey: MARKET_UPSTREAM_API_KEY,
  replayBatch,
  dailyHistoryBatch,
  replayFrameProvider: ({ symbol, interval, limit }) => {
    if (interval !== '1m' || !replayEngine) return []
    return replayEngine.getVisibleFrames(symbol, limit)
  },
})

function syncMarketDataService() {
  marketDataService = createMarketDataService({
    provider: MARKET_PROVIDER,
    upstreamBaseUrl: MARKET_UPSTREAM_URL,
    upstreamApiKey: MARKET_UPSTREAM_API_KEY,
    replayBatch,
    dailyHistoryBatch,
    replayFrameProvider: ({ symbol, interval, limit }) => {
      if (interval !== '1m' || !replayEngine) return []
      return replayEngine.getVisibleFrames(symbol, limit)
    },
  })
}

function resetReplayEngine() {
  if (replayEngineTimer) {
    clearInterval(replayEngineTimer)
    replayEngineTimer = null
  }
  replayEngine = null

  if (!replayBatch?.frames?.length) {
    syncMarketDataService()
    return
  }

  replayEngine = createReplayEngine({
    replayBatch,
    initialSpeed: REPLAY_SPEED,
    initialRunning: true,
    warmupBars: REPLAY_WARMUP_BARS,
    loop: REPLAY_LOOP,
  })

  let lastTickMs = Date.now()
  replayEngineTimer = setInterval(() => {
    const now = Date.now()
    const elapsed = now - lastTickMs
    lastTickMs = now
    const advanced = replayEngine?.tick(elapsed) || []
    if (advanced.length) {
      scheduleAgentDecisionsForReplayBars(advanced.length).catch(() => {})
    }
  }, REPLAY_TICK_MS)

  syncMarketDataService()
}

async function flushQueuedAgentDecisions() {
  if (!agentRuntime || agentDispatchInFlight) return

  agentDispatchInFlight = true
  try {
    while (queuedAgentDecisionSteps > 0) {
      queuedAgentDecisionSteps -= 1
      await agentRuntime.stepOnce()
    }
  } finally {
    agentDispatchInFlight = false
  }
}

async function scheduleAgentDecisionsForReplayBars(advancedBars, forceSingleStep = false) {
  if (!agentRuntime) return

  const bars = Math.max(0, Number(advancedBars) || 0)
  if (bars === 0 && !forceSingleStep) return

  const runtimeRunning = !!agentRuntime.getState?.().running
  if (!runtimeRunning && !forceSingleStep) return

  replayBarsSinceAgentDecision += bars
  let steps = 0

  while (replayBarsSinceAgentDecision >= agentDecisionEveryBars) {
    replayBarsSinceAgentDecision -= agentDecisionEveryBars
    steps += 1
  }

  if (forceSingleStep && steps === 0) {
    steps = 1
  }

  if (steps <= 0) return
  queuedAgentDecisionSteps += steps
  await flushQueuedAgentDecisions()
}

async function loadReplayBatch() {
  try {
    const content = await readFile(REPLAY_PATH, 'utf8')
    const parsed = JSON.parse(content)
    if (!parsed || !Array.isArray(parsed.frames)) return null
    replayBatch = parsed
    resetReplayEngine()
    return replayBatch
  } catch {
    replayBatch = null
    resetReplayEngine()
    return null
  }
}

async function loadDailyHistoryBatch() {
  try {
    const content = await readFile(DAILY_HISTORY_PATH, 'utf8')
    const parsed = JSON.parse(content)
    if (!parsed || !Array.isArray(parsed.frames)) return null
    dailyHistoryBatch = parsed
    syncMarketDataService()
    return dailyHistoryBatch
  } catch {
    syncMarketDataService()
    return null
  }
}

function symbolList() {
  const sourceFrames = replayBatch?.frames?.length
    ? replayBatch.frames
    : (dailyHistoryBatch?.frames?.length ? dailyHistoryBatch.frames : null)

  if (!sourceFrames) {
    return [
      { symbol: '600519.SH', name: CN_STOCK_NAME_BY_SYMBOL['600519.SH'], category: 'stock' },
      { symbol: '601318.SH', name: CN_STOCK_NAME_BY_SYMBOL['601318.SH'], category: 'stock' },
      { symbol: '300750.SZ', name: CN_STOCK_NAME_BY_SYMBOL['300750.SZ'], category: 'stock' },
    ]
  }

  const set = new Set(sourceFrames.map((f) => f.instrument?.symbol).filter(Boolean))
  return Array.from(set)
    .sort()
    .map((symbol) => ({
      symbol,
      name: CN_STOCK_NAME_BY_SYMBOL[symbol] || symbol,
      category: 'stock',
    }))
}

function pickTraderSymbol(traderId, cycleNumber = 1) {
  const symbols = symbolList().map((item) => item.symbol)
  if (!symbols.length) return '600519.SH'
  const idx = Math.abs(hashSymbol(traderId) + cycleNumber) % symbols.length
  return symbols[idx]
}

async function evaluateTraderContext(trader, { cycleNumber }) {
  const symbol = pickTraderSymbol(trader.trader_id, cycleNumber)
  const [intradayBatch, dailyBatch] = await Promise.all([
    marketDataService.getFrames({
      symbol,
      interval: '1m',
      limit: 180,
    }),
    marketDataService.getFrames({
      symbol,
      interval: '1d',
      limit: 90,
    }),
  ])

  const account = getAccount(trader.trader_id)
  const positions = getPositions(trader.trader_id)
  const positionState = buildPositionState({ symbol, account, positions })
  const latestEventTs = intradayBatch.frames[intradayBatch.frames.length - 1]?.event_ts_ms
  const context = buildAgentMarketContext({
    symbol,
    asOfTsMs: Number.isFinite(latestEventTs) ? latestEventTs : Date.now(),
    intradayBatch,
    dailyBatch,
    positionState,
  })

  return {
    context,
    cycleNumber,
  }
}

const app = express()
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'onlytrade-mock-api', uptime_s: Math.round((Date.now() - BOOT_TS) / 1000) })
})

app.get('/api/config', (_req, res) => {
  res.json({ beta_mode: true, registration_enabled: false })
})

app.get('/api/traders', (_req, res) => {
  res.json(ok(TRADERS))
})

app.get('/api/competition', (_req, res) => {
  res.json(ok(getCompetitionData()))
})

app.get('/api/top-traders', (_req, res) => {
  const top = [...getCompetitionData().traders]
    .sort((a, b) => b.total_pnl_pct - a.total_pnl_pct)
    .slice(0, 3)
  res.json(ok(top))
})

app.get('/api/status', (req, res) => {
  const traderId = String(req.query.trader_id || TRADERS[0].trader_id)
  res.json(ok(getStatus(traderId)))
})

app.get('/api/account', (req, res) => {
  const traderId = String(req.query.trader_id || TRADERS[0].trader_id)
  res.json(ok(getAccount(traderId)))
})

app.get('/api/positions', (req, res) => {
  const traderId = String(req.query.trader_id || TRADERS[0].trader_id)
  res.json(ok(getPositions(traderId)))
})

app.get('/api/decisions/latest', (req, res) => {
  const traderId = String(req.query.trader_id || '')
  const limit = Number(req.query.limit || 5)
  const safeLimit = Number.isFinite(limit) ? limit : 5
  const runtimeDecisions = agentRuntime?.getLatestDecisions(traderId || undefined, safeLimit) || []

  if (runtimeDecisions.length) {
    res.json(ok(runtimeDecisions))
    return
  }

  res.json(ok(getScriptedDecisions(safeLimit)))
})

app.get('/api/agent/runtime/status', (_req, res) => {
  const state = agentRuntime?.getState?.() || {
    running: false,
    cycle_ms: AGENT_RUNTIME_CYCLE_MS,
    in_flight: false,
    last_cycle_started_ms: null,
    last_cycle_completed_ms: null,
  }
  const metrics = agentRuntime?.getMetrics?.() || {
    totalCycles: 0,
    successfulCycles: 0,
    failedCycles: 0,
  }

  res.json(ok({
    ...state,
    metrics,
    decision_every_bars: agentDecisionEveryBars,
    traders: TRADERS.map((trader) => ({
      trader_id: trader.trader_id,
      call_count: agentRuntime?.getCallCount?.(trader.trader_id) || 0,
    })),
  }))
})

app.post('/api/agent/runtime/control', async (req, res) => {
  const action = String(req.body?.action || '').trim().toLowerCase()
  if (!agentRuntime) {
    res.status(503).json({ success: false, error: 'agent_runtime_unavailable' })
    return
  }

  if (action === 'pause') {
    agentRuntime.pause()
  } else if (action === 'resume') {
    agentRuntime.resume()
  } else if (action === 'step') {
    await agentRuntime.stepOnce()
  } else if (action === 'set_cycle_ms') {
    const cycleMs = Number(req.body?.cycle_ms)
    if (!Number.isFinite(cycleMs)) {
      res.status(400).json({ success: false, error: 'invalid_cycle_ms' })
      return
    }
    const replaySpeed = replayEngine?.getStatus?.().speed || REPLAY_SPEED
    const bars = Math.max(1, Math.round((cycleMs * Math.max(0.1, replaySpeed)) / 60_000))
    agentDecisionEveryBars = bars
  } else {
    res.status(400).json({ success: false, error: 'invalid_action' })
    return
  }

  res.json(ok({
    action,
    state: agentRuntime.getState(),
    metrics: agentRuntime.getMetrics(),
    decision_every_bars: agentDecisionEveryBars,
  }))
})

app.get('/api/replay/runtime/status', (_req, res) => {
  const replayState = replayEngine?.getStatus?.() || {
    running: false,
    speed: REPLAY_SPEED,
    loop: REPLAY_LOOP,
    warmup_bars: REPLAY_WARMUP_BARS,
    cursor_index: -1,
    timeline_length: 0,
    current_ts_ms: null,
  }

  res.json(ok({
    ...replayState,
    symbols: symbolList().map((item) => item.symbol),
  }))
})

app.post('/api/replay/runtime/control', (req, res) => {
  const action = String(req.body?.action || '').trim().toLowerCase()
  if (!replayEngine) {
    res.status(503).json({ success: false, error: 'replay_unavailable' })
    return
  }

  if (action === 'pause') {
    replayEngine.pause()
  } else if (action === 'resume') {
    replayEngine.resume()
  } else if (action === 'step') {
    const bars = Number(req.body?.bars || 1)
    const advanced = replayEngine.step(Number.isFinite(bars) ? bars : 1)
    scheduleAgentDecisionsForReplayBars(advanced.length, true).catch(() => {})
  } else if (action === 'set_speed') {
    const speed = Number(req.body?.speed)
    if (!Number.isFinite(speed)) {
      res.status(400).json({ success: false, error: 'invalid_speed' })
      return
    }
    replayEngine.setSpeed(speed)
  } else if (action === 'set_cursor') {
    const cursor = Number(req.body?.cursor_index)
    if (!Number.isFinite(cursor)) {
      res.status(400).json({ success: false, error: 'invalid_cursor_index' })
      return
    }
    replayEngine.setCursor(cursor)
  } else {
    res.status(400).json({ success: false, error: 'invalid_action' })
    return
  }

  res.json(ok({
    action,
    state: replayEngine.getStatus(),
  }))
})

app.get('/api/statistics', (_req, res) => {
  res.json(ok(getStatistics()))
})

app.get('/api/equity-history', (req, res) => {
  const traderId = String(req.query.trader_id || TRADERS[0].trader_id)
  const hours = Number(req.query.hours || 0)
  res.json(ok(generateEquityHistory(traderId, Number.isFinite(hours) ? hours : 0)))
})

app.post('/api/equity-history-batch', (req, res) => {
  const ids = Array.isArray(req.body?.trader_ids)
    ? req.body.trader_ids
    : TRADERS.map((t) => t.trader_id)
  const hours = Number(req.body?.hours || 0)
  const histories = Object.fromEntries(
    ids.map((id) => [id, generateEquityHistory(String(id), Number.isFinite(hours) ? hours : 0)])
  )
  res.json(ok({ histories }))
})

app.get('/api/positions/history', (req, res) => {
  const traderId = String(req.query.trader_id || TRADERS[0].trader_id)
  const limit = Number(req.query.limit || 100)
  res.json(ok(getPositionHistory(traderId, Number.isFinite(limit) ? limit : 100)))
})

app.get('/api/symbols', (_req, res) => {
  // Historical compatibility: this endpoint is intentionally unwrapped.
  res.json({ symbols: symbolList() })
})

app.get('/api/agent/market-context', async (req, res) => {
  const symbol = String(req.query.symbol || '600519.SH')
  const intradayInterval = String(req.query.intraday_interval || '1m')
  const intradayLimit = Number(req.query.intraday_limit || 180)
  const dailyLimit = Number(req.query.daily_limit || 90)
  const source = String(req.query.source || '')
  const traderId = String(req.query.trader_id || TRADERS[0].trader_id)

  try {
    const [intradayBatch, dailyBatch] = await Promise.all([
      marketDataService.getFrames({
        symbol,
        interval: intradayInterval,
        limit: Number.isFinite(intradayLimit) ? intradayLimit : 180,
        source,
      }),
      marketDataService.getFrames({
        symbol,
        interval: '1d',
        limit: Number.isFinite(dailyLimit) ? dailyLimit : 90,
        source,
      }),
    ])

    const account = getAccount(traderId)
    const positions = getPositions(traderId)
    const positionState = buildPositionState({ symbol, account, positions })
    const latestEventTs = intradayBatch.frames[intradayBatch.frames.length - 1]?.event_ts_ms
    const payload = buildAgentMarketContext({
      symbol,
      asOfTsMs: Number.isFinite(latestEventTs) ? latestEventTs : Date.now(),
      intradayBatch,
      dailyBatch,
      positionState,
    })

    res.json(ok(payload))
  } catch (error) {
    res.status(502).json({ success: false, error: error?.message || 'agent_context_error' })
  }
})

app.get('/api/market/frames', async (req, res) => {
  const symbol = String(req.query.symbol || '600519.SH')
  const interval = String(req.query.interval || '5m')
  const limit = Number(req.query.limit || 800)
  const source = String(req.query.source || '')

  try {
    const payload = await marketDataService.getFrames({
      symbol,
      interval,
      limit: Number.isFinite(limit) ? limit : 800,
      source,
    })

    res.json(ok(payload))
  } catch (error) {
    res.status(502).json({ success: false, error: error?.message || 'market_proxy_error' })
  }
})

app.get('/api/klines', async (req, res) => {
  const symbol = String(req.query.symbol || '600519.SH')
  const interval = String(req.query.interval || '5m')
  const limit = Number(req.query.limit || 800)
  const source = String(req.query.source || '')

  try {
    const payload = await marketDataService.getKlines({
        symbol,
        interval,
        limit: Number.isFinite(limit) ? limit : 800,
        source,
      })

    res.json(ok(payload))
  } catch (error) {
    res.status(502).json({ success: false, error: error?.message || 'market_proxy_error' })
  }
})

app.get('/api/market/stream', (req, res) => {
  const symbolsRaw = String(req.query.symbols || '600519.SH')
  const symbols = symbolsRaw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  const interval = String(req.query.interval || '1m')
  const limit = Number(req.query.limit || 2)
  const source = String(req.query.source || '')

  const safeSymbols = symbols.length ? symbols : ['600519.SH']
  const lastKeyBySymbol = new Map()

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  res.write(`event: ready\n`)
  res.write(`data: ${JSON.stringify({ ok: true, symbols: safeSymbols, interval })}\n\n`)

  let running = true

  const emitFrames = async () => {
    if (!running) return

    const frameBatch = []

    for (const symbol of safeSymbols) {
      const batch = await marketDataService.getFrames({ symbol, interval, limit, source })
      const latest = batch.frames[batch.frames.length - 1]
      if (!latest) continue

      const key = `${symbol}|${interval}|${latest.window.start_ts_ms}`
      if (lastKeyBySymbol.get(symbol) === key) continue

      lastKeyBySymbol.set(symbol, key)
      frameBatch.push(latest)
    }

    if (!frameBatch.length) return

    const mode = frameBatch.some((frame) => frame.mode === 'real') ? 'real' : 'mock'
    const providerSet = new Set(frameBatch.map((frame) => frame.provider))
    const provider = providerSet.size === 1 ? frameBatch[0].provider : 'mixed'
    const payload = {
      schema_version: 'market.frames.v1',
      market: 'CN-A',
      mode,
      provider,
      frames: frameBatch,
    }

    res.write(`event: frames\n`)
    res.write(`data: ${JSON.stringify(payload)}\n\n`)
  }

  emitFrames().catch(() => {
    if (running) {
      res.write(`event: error\n`)
      res.write(`data: ${JSON.stringify({ error: 'stream_emit_failed' })}\n\n`)
    }
  })

  const timer = setInterval(() => {
    emitFrames().catch(() => {
      if (running) {
        res.write(`event: error\n`)
        res.write(`data: ${JSON.stringify({ error: 'stream_emit_failed' })}\n\n`)
      }
    })
  }, MARKET_STREAM_POLL_MS)

  req.on('close', () => {
    running = false
    clearInterval(timer)
    res.end()
  })
})

app.get('/api/orders', (_req, res) => {
  res.json(ok([]))
})

app.get('/api/open-orders', (_req, res) => {
  res.json(ok([]))
})

app.get('/api/traders/:id/config', (req, res) => {
  const trader = getTraderById(req.params.id)
  res.json(ok({
    trader_id: trader.trader_id,
    trader_name: trader.trader_name,
    ai_model: trader.ai_model,
    exchange_id: trader.exchange_id,
    strategy_name: trader.strategy_name,
    is_running: trader.is_running,
    initial_balance: 100000,
    scan_interval_minutes: 1,
    show_in_competition: true,
    is_cross_margin: false,
  }))
})

app.post('/api/traders/:id/close-position', (_req, res) => {
  res.json(ok({ message: 'Virtual position close queued in mock-api mode' }))
})

app.use('/api', (_req, res) => {
  const payload = fail('not_found', 404)
  res.status(404).json({ success: false, error: payload.error })
})

await loadReplayBatch()
await loadDailyHistoryBatch()

agentRuntime = createInMemoryAgentRuntime({
  traders: TRADERS,
  evaluateTrader: evaluateTraderContext,
  cycleMs: AGENT_RUNTIME_CYCLE_MS,
  maxHistory: 120,
  autoTimer: false,
})
agentRuntime.start()

function handleShutdown() {
  agentRuntime?.stop()
  if (replayEngineTimer) {
    clearInterval(replayEngineTimer)
    replayEngineTimer = null
  }
}

process.on('SIGINT', handleShutdown)
process.on('SIGTERM', handleShutdown)

app.listen(PORT, () => {
  const replayInfo = replayBatch?.frames?.length
    ? `replay loaded (${replayBatch.frames.length} frames)`
    : 'no replay found (generated mock only)'
  const dailyHistoryInfo = dailyHistoryBatch?.frames?.length
    ? `daily history loaded (${dailyHistoryBatch.frames.length} frames, lookback=${MARKET_DAILY_HISTORY_DAYS}d)`
    : `no daily history found at ${DAILY_HISTORY_PATH}`
  const providerInfo = MARKET_PROVIDER === 'real'
    ? `provider=real upstream=${MARKET_UPSTREAM_URL || 'not-configured'}`
    : 'provider=mock'
  const runtimeInfo = `agent_runtime mode=event-driven decision_every_bars=${agentDecisionEveryBars}`
  const replayRuntimeInfo = replayEngine?.getStatus?.()
    ? `replay_runtime speed=${replayEngine.getStatus().speed}x tick_ms=${REPLAY_TICK_MS}`
    : 'replay_runtime unavailable'
  console.log(`[mock-api] listening on http://localhost:${PORT}`)
  console.log(`[mock-api] ${replayInfo}`)
  console.log(`[mock-api] ${dailyHistoryInfo}`)
  console.log(`[mock-api] ${providerInfo}`)
  console.log(`[mock-api] ${runtimeInfo}`)
  console.log(`[mock-api] ${replayRuntimeInfo}`)
})
