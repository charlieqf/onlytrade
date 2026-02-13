import type {
  AccountInfo,
  CompetitionData,
  DecisionRecord,
  Position,
  PositionHistoryResponse,
  Statistics,
  SystemStatus,
  TraderInfo,
} from '../types'
import type { MarketBarFrameBatchV1, MarketBarFrameV1 } from '../contracts/marketData'
import { generateMockFrameBatch, generateMockLegacyKlines } from './mockMarketData'

let replayBatchCache: MarketBarFrameBatchV1 | null = null
let replayBatchPromise: Promise<MarketBarFrameBatchV1 | null> | null = null

async function loadReplayBatch(): Promise<MarketBarFrameBatchV1 | null> {
  if (replayBatchCache) return replayBatchCache
  if (replayBatchPromise) return replayBatchPromise

  replayBatchPromise = fetch('/replay/cn-a/latest/frames.1m.json')
    .then(async (res) => {
      if (!res.ok) return null
      const data = (await res.json()) as MarketBarFrameBatchV1
      if (!data || !Array.isArray(data.frames)) return null
      replayBatchCache = data
      return data
    })
    .catch(() => null)
    .finally(() => {
      replayBatchPromise = null
    })

  return replayBatchPromise
}

function replayFramesForSymbol(
  frames: MarketBarFrameV1[],
  symbol: string,
  limit: number
): MarketBarFrameV1[] {
  const filtered = frames.filter((f) => f.instrument.symbol === symbol)
  const sorted = [...filtered].sort((a, b) => a.window.start_ts_ms - b.window.start_ts_ms)
  const safeLimit = Math.max(1, Math.min(limit, 2000))
  return sorted.slice(-safeLimit)
}

export type DemoMode = 'static' | 'mock-live' | 'live'

const DEMO_MODE_RAW = (import.meta.env.VITE_DEMO_MODE || 'live').toLowerCase()
const DEMO_MODE_ALLOWED = (import.meta.env.VITE_ALLOW_DEMO_MODE || 'false').toLowerCase() === 'true'
const DEMO_BOOT_TS = Date.now()
const MOCK_LIVE_STEP_MS = 8000

export function getDemoMode(): DemoMode {
  if (!DEMO_MODE_ALLOWED) return 'live'
  if (DEMO_MODE_RAW === 'live') return 'live'
  if (DEMO_MODE_RAW === 'mock-live' || DEMO_MODE_RAW === 'mocklive') return 'mock-live'
  return 'static'
}

export function isStaticDemoMode(): boolean {
  return getDemoMode() !== 'live'
}

export function isMockLiveDemoMode(): boolean {
  return getDemoMode() === 'mock-live'
}

function getMockTick(): number {
  if (!isMockLiveDemoMode()) return 0
  return Math.floor((Date.now() - DEMO_BOOT_TS) / MOCK_LIVE_STEP_MS)
}

const TRADERS: TraderInfo[] = [
  {
    trader_id: 't_001',
    trader_name: 'HS300 Momentum',
    ai_model: 'qwen',
    exchange_id: 'sim-cn',
    is_running: true,
    show_in_competition: true,
  },
  {
    trader_id: 't_002',
    trader_name: 'Value Rebound',
    ai_model: 'deepseek',
    exchange_id: 'sim-cn',
    is_running: true,
    show_in_competition: true,
  },
  {
    trader_id: 't_003',
    trader_name: 'Mei Lin Alpha',
    ai_model: 'gpt-4o-mini',
    exchange_id: 'sim-cn',
    is_running: true,
    show_in_competition: true,
  },
  {
    trader_id: 't_004',
    trader_name: 'Blonde Macro',
    ai_model: 'gpt-4o-mini',
    exchange_id: 'sim-cn',
    is_running: true,
    show_in_competition: true,
  },
]

const BASE_COMPETITION: CompetitionData = {
  count: 4,
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
      trader_name: 'Mei Lin Alpha',
      ai_model: 'gpt-4o-mini',
      exchange: 'sim',
      total_equity: 98790.44,
      total_pnl: -1209.56,
      total_pnl_pct: -1.21,
      position_count: 1,
      margin_used_pct: 0,
      is_running: true,
    },
    {
      trader_id: 't_004',
      trader_name: 'Blonde Macro',
      ai_model: 'gpt-4o-mini',
      exchange: 'sim',
      total_equity: 100512.63,
      total_pnl: 512.63,
      total_pnl_pct: 0.51,
      position_count: 2,
      margin_used_pct: 0,
      is_running: true,
    },
  ],
}

function getCompetitionData(): CompetitionData {
  if (!isMockLiveDemoMode()) {
    return BASE_COMPETITION
  }

  const tick = getMockTick()
  const initial = 100000

  const traders = BASE_COMPETITION.traders.map((trader, idx) => {
    const phase = idx * 2.1
    const wave = Math.sin((tick + phase) / 2.8) * 0.55
    const drift = (
      idx === 0 ? 0.015
        : idx === 1 ? 0.004
          : idx === 2 ? -0.006
            : 0.0025
    ) * tick
    const pct = Number((trader.total_pnl_pct + wave + drift).toFixed(2))
    const pnl = Number(((initial * pct) / 100).toFixed(2))
    const equity = Number((initial + pnl).toFixed(2))

    return {
      ...trader,
      total_pnl_pct: pct,
      total_pnl: pnl,
      total_equity: equity,
      position_count: 1 + ((tick + idx) % 3),
    }
  })

  return {
    count: traders.length,
    traders,
  }
}

function getStatus(traderId = 't_001'): SystemStatus {
  const tick = getMockTick()
  const trader = TRADERS.find((t) => t.trader_id === traderId) || TRADERS[0]
  return {
    trader_id: trader.trader_id,
    trader_name: trader.trader_name,
    ai_model: trader.ai_model,
    is_running: true,
    start_time: new Date(Date.now() - 1000 * 60 * (95 + tick)).toISOString(),
    runtime_minutes: 95 + tick,
    call_count: 128 + tick,
    initial_balance: 100000,
    scan_interval: '10s',
    stop_until: '',
    last_reset_time: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    ai_provider: 'openai-compatible',
    strategy_type: 'ai_trading',
  }
}

function getAccount(traderId = 't_001'): AccountInfo {
  const competition = getCompetitionData()
  const rank = competition.traders.find((t) => t.trader_id === traderId) || competition.traders[0]
  const floating = Number((Math.sin(getMockTick() / 3) * 800).toFixed(2))
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

function getPositions(traderId = 't_001'): Position[] {
  const tick = getMockTick()
  const drift = Math.sin((tick + 1) / 2)
  const base: Position[] = [
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
  if (traderId === 't_003') {
    return base.slice(0, 1)
  }
  if (traderId === 't_004') {
    return base.slice(1)
  }
  return base
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

function getDecisions(): DecisionRecord[] {
  const now = Date.now()
  const tick = getMockTick()
  const count = isMockLiveDemoMode()
    ? Math.min(DECISION_SCRIPT.length, 2 + (tick % DECISION_SCRIPT.length))
    : 2

  return Array.from({ length: count }).map((_, idx) => {
    const scriptIndex = (tick + idx) % DECISION_SCRIPT.length
    const script = DECISION_SCRIPT[scriptIndex]
    const ts = new Date(now - idx * 1000 * 60 * 5).toISOString()
    const cycle = 128 + tick - idx

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

function getStatistics(): Statistics {
  const tick = getMockTick()
  return {
    total_cycles: 128 + tick,
    successful_cycles: 122 + tick,
    failed_cycles: 6,
    total_open_positions: 37 + Math.floor(tick / 2),
    total_close_positions: 35 + Math.floor(tick / 3),
  }
}

function generateEquityHistory(traderId: string, points = 72) {
  const base = 100000
  const rank = getCompetitionData().traders.find((t) => t.trader_id === traderId)
  const targetPct = (rank?.total_pnl_pct ?? 0) / 100
  const now = Date.now()
  const step = 10 * 60_000

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

function getPositionHistory(traderId: string): PositionHistoryResponse {
  const now = Date.now()
  return {
    positions: [
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
    ],
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

function parseUrl(input: string): URL {
  if (input.startsWith('http://') || input.startsWith('https://')) {
    return new URL(input)
  }
  return new URL(input, 'http://localhost')
}

export async function getStaticApiData(url: string, method: string, body?: any): Promise<any | undefined> {
  if (!isStaticDemoMode()) return undefined
  const parsed = parseUrl(url)
  const path = parsed.pathname
  const traderId = parsed.searchParams.get('trader_id') || TRADERS[0].trader_id
  const competition = getCompetitionData()

  if (method === 'GET' && path === '/api/traders') return TRADERS
  if (method === 'GET' && path === '/api/competition') return competition
  if (method === 'GET' && path === '/api/top-traders') return competition.traders.slice(0, 3)
  if (method === 'GET' && path === '/api/status') return getStatus(traderId)
  if (method === 'GET' && path === '/api/account') return getAccount(traderId)
  if (method === 'GET' && path === '/api/positions') return getPositions(traderId)
  if (method === 'GET' && path === '/api/decisions/latest') return getDecisions()
  if (method === 'GET' && path === '/api/statistics') return getStatistics()
  if (method === 'GET' && path === '/api/equity-history') return generateEquityHistory(traderId, 96)

  if (method === 'POST' && path === '/api/equity-history-batch') {
    const ids: string[] = Array.isArray(body?.trader_ids) ? body.trader_ids : TRADERS.map((t) => t.trader_id)
    const histories = Object.fromEntries(ids.map((id) => [id, generateEquityHistory(id, 96)]))
    return { histories }
  }

  if (method === 'GET' && path === '/api/positions/history') return getPositionHistory(traderId)

  if (method === 'GET' && path === '/api/market/frames') {
    const symbol = parsed.searchParams.get('symbol') || '600519.SH'
    const interval = (parsed.searchParams.get('interval') || '5m') as '1m' | '5m' | '15m' | '30m' | '60m' | '1h' | '4h' | '1d'
    const limit = Number(parsed.searchParams.get('limit') || '800')

    const replaySource = parsed.searchParams.get('source')
    const allowReplay = replaySource !== 'mock'
    if (allowReplay && interval === '1m') {
      const replay = await loadReplayBatch()
      if (replay?.frames?.length) {
        return {
          ...replay,
          mode: isMockLiveDemoMode() ? 'real' : replay.mode,
          provider: isMockLiveDemoMode() ? 'replay-stream' : replay.provider,
          frames: replayFramesForSymbol(
            replay.frames,
            symbol,
            Number.isFinite(limit) ? Math.min(limit, 1500) : 800
          ),
        }
      }
    }

    return generateMockFrameBatch({
      symbol,
      interval,
      limit: Number.isFinite(limit) ? Math.min(limit, 1500) : 800,
      mode: isMockLiveDemoMode() ? 'real' : 'mock',
      provider: isMockLiveDemoMode() ? 'mock-replay-stream' : 'static-mock-feed',
    })
  }

  if (method === 'GET' && path === '/api/klines') {
    const symbol = parsed.searchParams.get('symbol') || '600519.SH'
    const interval = (parsed.searchParams.get('interval') || '5m') as '1m' | '5m' | '15m' | '30m' | '60m' | '1h' | '4h' | '1d'
    const limit = Number(parsed.searchParams.get('limit') || '800')

    const replaySource = parsed.searchParams.get('source')
    const allowReplay = replaySource !== 'mock'
    if (allowReplay && interval === '1m') {
      const replay = await loadReplayBatch()
      if (replay?.frames?.length) {
        return replayFramesForSymbol(
          replay.frames,
          symbol,
          Number.isFinite(limit) ? Math.min(limit, 1500) : 800
        ).map((frame) => ({
          openTime: frame.window.start_ts_ms,
          open: frame.bar.open,
          high: frame.bar.high,
          low: frame.bar.low,
          close: frame.bar.close,
          volume: frame.bar.volume_shares,
          quoteVolume: frame.bar.turnover_cny,
        }))
      }
    }

    return generateMockLegacyKlines({
      symbol,
      interval,
      limit: Number.isFinite(limit) ? Math.min(limit, 1500) : 800,
      mode: isMockLiveDemoMode() ? 'real' : 'mock',
      provider: isMockLiveDemoMode() ? 'mock-replay-stream' : 'static-mock-feed',
    })
  }

  if (method === 'GET' && path === '/api/orders') return []
  if (method === 'GET' && path === '/api/open-orders') return []
  if (method === 'GET' && path === '/api/symbols') {
    return {
      symbols: [
        { symbol: '600519.SH', name: 'Kweichow Moutai', category: 'stock' },
        { symbol: '601318.SH', name: 'Ping An', category: 'stock' },
        { symbol: '300750.SZ', name: 'CATL', category: 'stock' },
      ],
    }
  }

  const traderConfigMatch = path.match(/^\/api\/traders\/([^/]+)\/config$/)
  if (method === 'GET' && traderConfigMatch) {
    const id = traderConfigMatch[1]
    const trader = TRADERS.find((t) => t.trader_id === id) || TRADERS[0]
    return {
      trader_id: trader.trader_id,
      trader_name: trader.trader_name,
      ai_model: trader.ai_model,
      exchange_id: trader.exchange_id,
      strategy_name: 'HS300 baseline strategy',
      is_running: true,
      initial_balance: 100000,
      scan_interval_minutes: 1,
      show_in_competition: true,
      is_cross_margin: false,
    }
  }

  const closePositionMatch = path.match(/^\/api\/traders\/([^/]+)\/close-position$/)
  if (method === 'POST' && closePositionMatch) {
    return {
      message: 'Virtual position close queued in demo mode',
    }
  }

  return undefined
}
