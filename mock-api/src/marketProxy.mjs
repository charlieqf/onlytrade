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

function safeNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function safeLimit(limit) {
  const parsed = Number(limit)
  if (!Number.isFinite(parsed)) return 800
  return Math.max(1, Math.min(parsed, 2000))
}

function toCanonicalFrame(entry, context, seq = 0) {
  const symbol = context.symbol
  const interval = context.interval
  const provider = context.provider || 'upstream-proxy'
  const mode = context.mode || 'real'

  if (
    entry &&
    entry.schema_version === 'market.bar.v1' &&
    entry.window &&
    entry.bar &&
    entry.instrument
  ) {
    return {
      ...entry,
      mode,
      provider,
      instrument: {
        ...entry.instrument,
        symbol: entry.instrument.symbol || symbol,
        exchange: entry.instrument.exchange || exchangeFromSymbol(symbol),
        timezone: entry.instrument.timezone || 'Asia/Shanghai',
        currency: entry.instrument.currency || 'CNY',
      },
      interval: entry.interval || interval,
      seq: safeNumber(entry.seq, seq + 1),
      event_ts_ms: safeNumber(entry.event_ts_ms, entry.window.end_ts_ms),
      ingest_ts_ms: safeNumber(entry.ingest_ts_ms, safeNumber(entry.event_ts_ms, Date.now())),
    }
  }

  const startTs = safeNumber(
    entry?.openTime ?? entry?.start_ts_ms ?? entry?.timestamp ?? entry?.ts_ms,
    NaN
  )
  if (!Number.isFinite(startTs)) return null

  const step = intervalMs(interval)
  const endTs = startTs + step
  const open = safeNumber(entry?.open ?? entry?.o)
  const high = safeNumber(entry?.high ?? entry?.h, open)
  const low = safeNumber(entry?.low ?? entry?.l, open)
  const close = safeNumber(entry?.close ?? entry?.c, open)
  const volumeShares = safeNumber(entry?.volume ?? entry?.v)
  const turnoverCny = safeNumber(entry?.quoteVolume ?? entry?.turnover ?? entry?.amount, volumeShares * close)
  const vwap = volumeShares > 0 ? turnoverCny / volumeShares : close

  return {
    schema_version: 'market.bar.v1',
    market: 'CN-A',
    mode,
    provider,
    feed: 'bars',
    seq: seq + 1,
    event_ts_ms: endTs,
    ingest_ts_ms: endTs + 120,
    instrument: {
      symbol,
      exchange: exchangeFromSymbol(symbol),
      timezone: 'Asia/Shanghai',
      currency: 'CNY',
    },
    interval,
    window: {
      start_ts_ms: startTs,
      end_ts_ms: endTs,
      trading_day: tradingDayString(startTs),
    },
    session: {
      phase: sessionPhase(startTs),
      is_halt: false,
      is_partial: false,
    },
    bar: {
      open: Number(open.toFixed(4)),
      high: Number(high.toFixed(4)),
      low: Number(low.toFixed(4)),
      close: Number(close.toFixed(4)),
      volume_shares: Number(volumeShares.toFixed(2)),
      turnover_cny: Number(turnoverCny.toFixed(2)),
      vwap: Number(vwap.toFixed(4)),
    },
  }
}

function frameWindowKey(frame) {
  return `${frame.instrument?.symbol || 'UNKNOWN'}|${frame.interval || '1m'}|${frame.window?.start_ts_ms || 0}`
}

export function dedupeAndSortFrames(frames) {
  const byWindow = new Map()
  for (const frame of frames || []) {
    if (!Number.isFinite(frame?.window?.start_ts_ms)) continue
    byWindow.set(frameWindowKey(frame), frame)
  }

  return [...byWindow.values()].sort((a, b) => a.window.start_ts_ms - b.window.start_ts_ms)
}

export function normalizePayloadToFrames(payload, context) {
  const root = payload?.data ?? payload
  const rawFrames = Array.isArray(root?.frames)
    ? root.frames
    : Array.isArray(root)
      ? root
      : []

  const mapped = rawFrames
    .map((entry, idx) => toCanonicalFrame(entry, context, idx))
    .filter(Boolean)

  return dedupeAndSortFrames(mapped)
}

export function generateMockFrames({ symbol, interval, limit, mode = 'mock', provider = 'mock-api-generated' }) {
  const seed = hashSymbol(symbol)
  const base = 80 + (seed % 1500)
  const step = intervalMs(interval)
  const maxItems = safeLimit(limit)
  const frames = []
  let prev = base
  const now = Date.now()
  const startSeq = Math.floor(now / step) - maxItems

  for (let i = maxItems - 1; i >= 0; i--) {
    const start = now - i * step
    const end = start + step
    const drift = Math.sin((maxItems - i) / 12) * (base * 0.001)
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
      seq: startSeq + (maxItems - i),
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

function pickBatchFrames(batch, { symbol, interval, limit }) {
  if (!batch?.frames?.length) return []
  const maxItems = safeLimit(limit)
  return batch.frames
    .filter((frame) => frame.instrument?.symbol === symbol && (!frame.interval || frame.interval === interval))
    .sort((a, b) => a.window.start_ts_ms - b.window.start_ts_ms)
    .slice(-maxItems)
}

async function fetchUpstreamFrames({ baseUrl, apiKey, symbol, interval, limit, fetchImpl }) {
  const url = new URL(baseUrl)
  url.searchParams.set('symbol', symbol)
  url.searchParams.set('interval', interval)
  url.searchParams.set('limit', String(safeLimit(limit)))

  const headers = {}
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  const response = await fetchImpl(url.toString(), { headers })
  if (!response.ok) {
    throw new Error(`upstream_http_${response.status}`)
  }

  const payload = await response.json()
  return normalizePayloadToFrames(payload, {
    symbol,
    interval,
    provider: 'upstream-proxy',
    mode: 'real',
  })
}

export function framesToKlines(frames) {
  return (frames || []).map((frame) => ({
    openTime: frame.window.start_ts_ms,
    open: frame.bar.open,
    high: frame.bar.high,
    low: frame.bar.low,
    close: frame.bar.close,
    volume: frame.bar.volume_shares,
    quoteVolume: frame.bar.turnover_cny,
  }))
}

export function createMarketDataService({
  provider = 'mock',
  upstreamBaseUrl = '',
  upstreamApiKey = '',
  replayBatch = null,
  dailyHistoryBatch = null,
  replayFrameProvider = null,
  fetchImpl = fetch,
} = {}) {
  const providerMode = provider === 'real' ? 'real' : 'mock'

  async function getFrames({ symbol = '600519.SH', interval = '5m', limit = 800, source = '' } = {}) {
    const maxItems = safeLimit(limit)
    const forceMock = source === 'mock'

    if (!forceMock && providerMode === 'real' && upstreamBaseUrl) {
      try {
        const upstreamFrames = await fetchUpstreamFrames({
          baseUrl: upstreamBaseUrl,
          apiKey: upstreamApiKey,
          symbol,
          interval,
          limit: maxItems,
          fetchImpl,
        })

        if (upstreamFrames.length) {
          return {
            schema_version: 'market.frames.v1',
            market: 'CN-A',
            mode: 'real',
            provider: 'upstream-proxy',
            frames: upstreamFrames.slice(-maxItems),
          }
        }
      } catch {
        // Fall through to replay/mock fallback to preserve availability.
      }
    }

    if (!forceMock && interval === '1d') {
      const dailyFrames = pickBatchFrames(dailyHistoryBatch, { symbol, interval, limit: maxItems })
      if (dailyFrames.length) {
        return {
          schema_version: 'market.frames.v1',
          market: 'CN-A',
          mode: dailyHistoryBatch?.mode || 'real',
          provider: dailyHistoryBatch?.provider || 'daily-history',
          frames: dedupeAndSortFrames(dailyFrames).slice(-maxItems),
        }
      }
    }

    if (!forceMock && interval === '1m') {
      if (typeof replayFrameProvider === 'function') {
        const liveReplayFrames = await Promise.resolve(
          replayFrameProvider({ symbol, interval, limit: maxItems })
        )
        if (Array.isArray(liveReplayFrames) && liveReplayFrames.length) {
          const mode = liveReplayFrames.some((frame) => frame?.mode === 'real') ? 'real' : 'mock'
          const providerSet = new Set(liveReplayFrames.map((frame) => frame?.provider).filter(Boolean))
          const provider = providerSet.size === 1
            ? liveReplayFrames[0].provider
            : (replayBatch?.provider || 'replay-stream')
          return {
            schema_version: 'market.frames.v1',
            market: 'CN-A',
            mode,
            provider,
            frames: dedupeAndSortFrames(liveReplayFrames).slice(-maxItems),
          }
        }
      }

      const replayFrames = pickBatchFrames(replayBatch, { symbol, interval, limit: maxItems })
      if (replayFrames.length) {
        return {
          schema_version: 'market.frames.v1',
          market: 'CN-A',
          mode: 'mock',
          provider: replayBatch?.provider || 'replay-stream',
          frames: dedupeAndSortFrames(replayFrames).slice(-maxItems),
        }
      }
    }

    return {
      schema_version: 'market.frames.v1',
      market: 'CN-A',
      mode: 'mock',
      provider: 'mock-api-generated',
      frames: generateMockFrames({
        symbol,
        interval,
        limit: maxItems,
        mode: 'mock',
        provider: 'mock-api-generated',
      }),
    }
  }

  async function getKlines(options = {}) {
    const batch = await getFrames(options)
    return framesToKlines(batch.frames)
  }

  return {
    getFrames,
    getKlines,
  }
}
