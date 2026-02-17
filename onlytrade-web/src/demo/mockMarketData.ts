import {
  type CnBarInterval,
  type CnSessionPhase,
  type MarketBarFrameBatchV1,
  type MarketBarFrameV1,
  type MarketMode,
  barFramesToLegacyKlines,
  exchangeFromSymbol,
} from '../contracts/marketData'

function hashSymbol(symbol: string): number {
  let hash = 0
  for (let i = 0; i < symbol.length; i++) {
    hash = (hash << 5) - hash + symbol.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

function intervalMs(interval: CnBarInterval): number {
  switch (interval) {
    case '1m':
      return 60_000
    case '5m':
      return 5 * 60_000
    case '15m':
      return 15 * 60_000
    case '30m':
      return 30 * 60_000
    case '60m':
      return 60 * 60_000
    case '1h':
      return 60 * 60_000
    case '4h':
      return 4 * 60 * 60_000
    case '1d':
      return 24 * 60 * 60_000
    default:
      return 5 * 60_000
  }
}

function tradingDayString(tsMs: number): string {
  return new Date(tsMs).toLocaleDateString('en-CA', {
    timeZone: 'Asia/Shanghai',
  })
}

function getCnSessionPhase(tsMs: number): CnSessionPhase {
  const hm = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(tsMs))

  const [hh, mm] = hm.split(':').map(Number)
  const mins = hh * 60 + mm

  if (mins >= 555 && mins < 570) return 'pre_open' // 09:15-09:30
  if (mins >= 570 && mins < 690) return 'continuous_am' // 09:30-11:30
  if (mins >= 690 && mins < 780) return 'lunch_break' // 11:30-13:00
  if (mins >= 780 && mins < 900) return 'continuous_pm' // 13:00-15:00
  if (mins >= 900 && mins < 915) return 'close_auction' // 15:00-15:15
  return 'closed'
}

export function generateMockBarFrames(params: {
  symbol: string
  interval: CnBarInterval
  limit: number
  mode?: MarketMode
  provider?: string
  nowMs?: number
}): MarketBarFrameV1[] {
  const {
    symbol,
    interval,
    limit,
    mode = 'mock',
    provider = 'onlytrade-mock-feed',
    nowMs = Date.now(),
  } = params

  const seed = hashSymbol(symbol)
  const base = 80 + (seed % 1500)
  const step = intervalMs(interval)
  const safeLimit = Math.max(1, Math.min(limit, 2000))
  const frames: MarketBarFrameV1[] = []

  let prev = base
  const startSeq = Math.floor(nowMs / step) - safeLimit

  for (let i = safeLimit - 1; i >= 0; i--) {
    const start = nowMs - i * step
    const end = start + step

    const drift = Math.sin((safeLimit - i) / 12) * (base * 0.001)
    const noise = (((seed + i * 17) % 11) - 5) * (base * 0.0006)

    const open = prev
    const close = Math.max(0.1, open + drift + noise)
    const high = Math.max(open, close) * 1.004
    const low = Math.min(open, close) * 0.996
    const volumeShares = 5000 + ((seed + i * 29) % 9000)
    const turnoverCny = Number((volumeShares * close).toFixed(2))

    const frame: MarketBarFrameV1 = {
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
        phase: getCnSessionPhase(start),
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
    }

    frames.push(frame)
    prev = close
  }

  return frames
}

export function generateMockFrameBatch(params: {
  symbol: string
  interval: CnBarInterval
  limit: number
  mode?: MarketMode
  provider?: string
}): MarketBarFrameBatchV1 {
  const mode = params.mode ?? 'mock'
  const provider = params.provider ?? 'onlytrade-mock-feed'
  const frames = generateMockBarFrames(params)

  return {
    schema_version: 'market.frames.v1',
    market: 'CN-A',
    mode,
    provider,
    frames,
  }
}

export function generateMockLegacyKlines(params: {
  symbol: string
  interval: CnBarInterval
  limit: number
  mode?: MarketMode
  provider?: string
}) {
  const frames = generateMockBarFrames(params)
  return barFramesToLegacyKlines(frames)
}
