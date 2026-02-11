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

export function isStaticDemoMode(): boolean {
  return (import.meta.env.VITE_DEMO_MODE || 'static').toLowerCase() !== 'live'
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
    trader_name: 'Event Flow',
    ai_model: 'gpt-4o-mini',
    exchange_id: 'sim-cn',
    is_running: true,
    show_in_competition: true,
  },
]

const COMPETITION: CompetitionData = {
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

function getStatus(traderId = 't_001'): SystemStatus {
  const trader = TRADERS.find((t) => t.trader_id === traderId) || TRADERS[0]
  return {
    trader_id: trader.trader_id,
    trader_name: trader.trader_name,
    ai_model: trader.ai_model,
    is_running: true,
    start_time: new Date(Date.now() - 1000 * 60 * 95).toISOString(),
    runtime_minutes: 95,
    call_count: 128,
    initial_balance: 100000,
    scan_interval: '10s',
    stop_until: '',
    last_reset_time: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    ai_provider: 'openai-compatible',
    strategy_type: 'ai_trading',
  }
}

function getAccount(traderId = 't_001'): AccountInfo {
  const rank = COMPETITION.traders.find((t) => t.trader_id === traderId) || COMPETITION.traders[0]
  return {
    total_equity: rank.total_equity,
    wallet_balance: rank.total_equity - 1200,
    unrealized_profit: 1200,
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
  const base: Position[] = [
    {
      symbol: '600519.SH',
      side: 'LONG',
      entry_price: 1498.2,
      mark_price: 1512.4,
      quantity: 100,
      leverage: 1,
      unrealized_pnl: 1420,
      unrealized_pnl_pct: 0.95,
      liquidation_price: 0,
      margin_used: 0,
    },
    {
      symbol: '300750.SZ',
      side: 'LONG',
      entry_price: 186.3,
      mark_price: 182.8,
      quantity: 300,
      leverage: 1,
      unrealized_pnl: -1050,
      unrealized_pnl_pct: -1.88,
      liquidation_price: 0,
      margin_used: 0,
    },
  ]
  if (traderId === 't_003') {
    return base.slice(0, 1)
  }
  return base
}

function getDecisions(): DecisionRecord[] {
  const now = Date.now()
  return [
    {
      timestamp: new Date(now - 1000 * 60 * 5).toISOString(),
      cycle_number: 128,
      system_prompt: 'demo',
      input_prompt: 'HS300 momentum snapshot',
      cot_trace: 'compressed-demo-rationale',
      decision_json: '{"action":"hold"}',
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
          action: 'open_long',
          symbol: '600519.SH',
          quantity: 100,
          leverage: 1,
          price: 1510.2,
          stop_loss: 1480,
          take_profit: 1568,
          confidence: 74,
          reasoning: 'Trend and volume remain supportive; keep position sizing conservative.',
          order_id: 100128,
          timestamp: new Date(now - 1000 * 60 * 5).toISOString(),
          success: true,
        },
      ],
      execution_log: ['virtual fill applied at next bar open'],
      success: true,
      error_message: '',
    },
    {
      timestamp: new Date(now - 1000 * 60 * 15).toISOString(),
      cycle_number: 127,
      system_prompt: 'demo',
      input_prompt: 'risk review',
      cot_trace: 'compressed-demo-rationale',
      decision_json: '{"action":"hold"}',
      account_state: {
        total_balance: 101980.23,
        available_balance: 93220,
        total_unrealized_profit: 280,
        position_count: 2,
        margin_used_pct: 0,
      },
      positions: [],
      candidate_coins: ['600519.SH'],
      decisions: [
        {
          action: 'hold',
          symbol: '600519.SH',
          quantity: 0,
          leverage: 1,
          price: 1502.0,
          confidence: 68,
          reasoning: 'No clear downside break; hold and wait for confirmation.',
          order_id: 100127,
          timestamp: new Date(now - 1000 * 60 * 15).toISOString(),
          success: true,
        },
      ],
      execution_log: ['no new order emitted'],
      success: true,
      error_message: '',
    },
  ]
}

function getStatistics(): Statistics {
  return {
    total_cycles: 128,
    successful_cycles: 122,
    failed_cycles: 6,
    total_open_positions: 37,
    total_close_positions: 35,
  }
}

function hashSymbol(symbol: string): number {
  let hash = 0
  for (let i = 0; i < symbol.length; i++) {
    hash = (hash << 5) - hash + symbol.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

function intervalMs(interval: string): number {
  switch (interval) {
    case '1m': return 60_000
    case '5m': return 5 * 60_000
    case '15m': return 15 * 60_000
    case '30m': return 30 * 60_000
    case '1h': return 60 * 60_000
    case '4h': return 4 * 60 * 60_000
    case '1d': return 24 * 60 * 60_000
    default: return 5 * 60_000
  }
}

function generateKlines(symbol: string, interval: string, limit: number) {
  const seed = hashSymbol(symbol)
  const base = 80 + (seed % 1500)
  const step = intervalMs(interval)
  const now = Date.now()
  const bars: Array<{
    openTime: number
    open: number
    high: number
    low: number
    close: number
    volume: number
    quoteVolume: number
  }> = []

  let prev = base
  for (let i = limit - 1; i >= 0; i--) {
    const openTime = now - i * step
    const drift = Math.sin((limit - i) / 12) * (base * 0.001)
    const noise = ((seed + i * 17) % 11 - 5) * (base * 0.0006)
    const open = prev
    const close = Math.max(0.1, open + drift + noise)
    const high = Math.max(open, close) * 1.004
    const low = Math.min(open, close) * 0.996
    const volume = 5000 + ((seed + i * 29) % 9000)
    bars.push({
      openTime,
      open: Number(open.toFixed(4)),
      high: Number(high.toFixed(4)),
      low: Number(low.toFixed(4)),
      close: Number(close.toFixed(4)),
      volume,
      quoteVolume: Number((volume * close).toFixed(2)),
    })
    prev = close
  }

  return bars
}

function generateEquityHistory(traderId: string, points = 72) {
  const base = 100000
  const rank = COMPETITION.traders.find((t) => t.trader_id === traderId)
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

export function getStaticApiData(url: string, method: string, body?: any): any | undefined {
  if (!isStaticDemoMode()) return undefined
  const parsed = parseUrl(url)
  const path = parsed.pathname
  const traderId = parsed.searchParams.get('trader_id') || TRADERS[0].trader_id

  if (method === 'GET' && path === '/api/traders') return TRADERS
  if (method === 'GET' && path === '/api/competition') return COMPETITION
  if (method === 'GET' && path === '/api/top-traders') return COMPETITION.traders.slice(0, 3)
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

  if (method === 'GET' && path === '/api/klines') {
    const symbol = parsed.searchParams.get('symbol') || '600519.SH'
    const interval = parsed.searchParams.get('interval') || '5m'
    const limit = Number(parsed.searchParams.get('limit') || '800')
    return generateKlines(symbol, interval, Number.isFinite(limit) ? Math.min(limit, 1500) : 800)
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
