function round(value, digits = 6) {
  if (!Number.isFinite(value)) return null
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function sortedFrames(frames) {
  return [...(frames || [])].sort((a, b) => a.window.start_ts_ms - b.window.start_ts_ms)
}

function latestClose(frames) {
  const series = sortedFrames(frames)
  const latest = series[series.length - 1]
  return Number(latest?.bar?.close)
}

function computeReturn(frames, lookback) {
  const series = sortedFrames(frames)
  if (series.length <= lookback) return null
  const latest = Number(series[series.length - 1]?.bar?.close)
  const base = Number(series[series.length - 1 - lookback]?.bar?.close)
  if (!Number.isFinite(latest) || !Number.isFinite(base) || base === 0) return null
  return round(latest / base - 1)
}

function computeSma(frames, period) {
  const series = sortedFrames(frames)
  if (series.length < period) return null
  const window = series.slice(-period)
  const sum = window.reduce((acc, frame) => acc + Number(frame.bar?.close || 0), 0)
  return round(sum / period, 4)
}

function computeRsi(frames, period = 14) {
  const series = sortedFrames(frames)
  if (series.length < period + 1) return null

  let gains = 0
  let losses = 0
  for (let i = series.length - period; i < series.length; i++) {
    const prevClose = Number(series[i - 1]?.bar?.close)
    const close = Number(series[i]?.bar?.close)
    if (!Number.isFinite(prevClose) || !Number.isFinite(close)) return null

    const diff = close - prevClose
    if (diff > 0) {
      gains += diff
    } else {
      losses += Math.abs(diff)
    }
  }

  const avgGain = gains / period
  const avgLoss = losses / period
  if (avgLoss === 0) return 100

  const rs = avgGain / avgLoss
  return round(100 - (100 / (1 + rs)), 4)
}

function computeAtr(frames, period = 14) {
  const series = sortedFrames(frames)
  if (series.length < period + 1) return null

  const trValues = []
  for (let i = series.length - period; i < series.length; i++) {
    const current = series[i]
    const prev = series[i - 1]
    const high = Number(current?.bar?.high)
    const low = Number(current?.bar?.low)
    const prevClose = Number(prev?.bar?.close)
    if (![high, low, prevClose].every(Number.isFinite)) return null

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    )
    trValues.push(tr)
  }

  const total = trValues.reduce((acc, value) => acc + value, 0)
  return round(total / period, 4)
}

function computeVolumeRatio(frames, period = 20) {
  const series = sortedFrames(frames)
  if (series.length < period + 1) return null

  const latestVolume = Number(series[series.length - 1]?.bar?.volume_shares)
  if (!Number.isFinite(latestVolume)) return null

  const lookback = series.slice(-(period + 1), -1)
  const avgVolume = lookback.reduce((acc, frame) => acc + Number(frame.bar?.volume_shares || 0), 0) / period
  if (!Number.isFinite(avgVolume) || avgVolume === 0) return null

  return round(latestVolume / avgVolume, 4)
}

function computeRangePct(frames, period = 20) {
  const series = sortedFrames(frames)
  if (series.length < period) return null

  const lookback = series.slice(-period)
  const highs = lookback.map((frame) => Number(frame.bar?.high)).filter(Number.isFinite)
  const lows = lookback.map((frame) => Number(frame.bar?.low)).filter(Number.isFinite)
  const latest = latestClose(series)
  if (!highs.length || !lows.length || !Number.isFinite(latest) || latest === 0) return null

  const range = Math.max(...highs) - Math.min(...lows)
  return round(range / latest, 6)
}

export function buildPositionState({ symbol, account, positions }) {
  const matched = (positions || []).find((position) => position.symbol === symbol)
  return {
    shares: Number(matched?.quantity || 0),
    avg_cost: Number(matched?.entry_price || 0),
    unrealized_pnl: Number(matched?.unrealized_pnl || 0),
    cash_cny: Number(account?.available_balance || 0),
    max_gross_exposure_pct: 1.0,
  }
}

export function buildAgentMarketContext({
  symbol,
  asOfTsMs,
  intradayBatch,
  dailyBatch,
  positionState,
}) {
  const intradayFrames = sortedFrames(intradayBatch?.frames || [])
  const dailyFrames = sortedFrames(dailyBatch?.frames || [])

  return {
    schema_version: 'agent.market_context.v1',
    as_of_ts_ms: asOfTsMs,
    symbol,
    market: 'CN-A',
    constraints: {
      lot_size: 100,
      t_plus_one: true,
      currency: 'CNY',
    },
    intraday: {
      interval: intradayBatch?.frames?.[0]?.interval || '1m',
      mode: intradayBatch?.mode || 'mock',
      provider: intradayBatch?.provider || 'unknown',
      frames: intradayFrames,
      feature_snapshot: {
        ret_5: computeReturn(intradayFrames, 5),
        ret_20: computeReturn(intradayFrames, 20),
        atr_14: computeAtr(intradayFrames, 14),
        vol_ratio_20: computeVolumeRatio(intradayFrames, 20),
      },
    },
    daily: {
      interval: dailyBatch?.frames?.[0]?.interval || '1d',
      mode: dailyBatch?.mode || 'mock',
      provider: dailyBatch?.provider || 'unknown',
      frames: dailyFrames,
      feature_snapshot: {
        sma_20: computeSma(dailyFrames, 20),
        sma_60: computeSma(dailyFrames, 60),
        rsi_14: computeRsi(dailyFrames, 14),
        range_20d_pct: computeRangePct(dailyFrames, 20),
      },
    },
    position_state: positionState,
  }
}
