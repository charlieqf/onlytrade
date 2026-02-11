export type MarketMode = 'mock' | 'real'

export type CnSessionPhase =
  | 'pre_open'
  | 'continuous_am'
  | 'lunch_break'
  | 'continuous_pm'
  | 'close_auction'
  | 'closed'

export type CnBarInterval = '1m' | '5m' | '15m' | '30m' | '60m' | '1h' | '4h' | '1d'

export interface MarketBarFrameV1 {
  schema_version: 'market.bar.v1'
  market: 'CN-A'
  mode: MarketMode
  provider: string
  feed: 'bars'
  seq: number
  event_ts_ms: number
  ingest_ts_ms: number
  instrument: {
    symbol: string
    exchange: 'SSE' | 'SZSE' | 'OTHER'
    timezone: 'Asia/Shanghai'
    currency: 'CNY'
  }
  interval: CnBarInterval
  window: {
    start_ts_ms: number
    end_ts_ms: number
    trading_day: string
  }
  session: {
    phase: CnSessionPhase
    is_halt: boolean
    is_partial: boolean
  }
  bar: {
    open: number
    high: number
    low: number
    close: number
    volume_shares: number
    turnover_cny: number
    vwap?: number
  }
}

export interface MarketBarFrameBatchV1 {
  schema_version: 'market.frames.v1'
  market: 'CN-A'
  mode: MarketMode
  provider: string
  frames: MarketBarFrameV1[]
}

// Compatibility shape used by current chart components.
export interface LegacyKline {
  openTime: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  quoteVolume: number
}

export function exchangeFromSymbol(symbol: string): 'SSE' | 'SZSE' | 'OTHER' {
  if (symbol.endsWith('.SH')) return 'SSE'
  if (symbol.endsWith('.SZ')) return 'SZSE'
  return 'OTHER'
}

export function barFrameToLegacyKline(frame: MarketBarFrameV1): LegacyKline {
  return {
    openTime: frame.window.start_ts_ms,
    open: frame.bar.open,
    high: frame.bar.high,
    low: frame.bar.low,
    close: frame.bar.close,
    volume: frame.bar.volume_shares,
    quoteVolume: frame.bar.turnover_cny,
  }
}

export function barFramesToLegacyKlines(frames: MarketBarFrameV1[]): LegacyKline[] {
  return frames.map(barFrameToLegacyKline)
}
