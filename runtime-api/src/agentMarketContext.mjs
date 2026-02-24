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

function average(values) {
  const nums = Array.isArray(values) ? values.filter((value) => Number.isFinite(value)) : []
  if (!nums.length) return null
  return nums.reduce((acc, value) => acc + value, 0) / nums.length
}

function pctText(value) {
  if (!Number.isFinite(value)) return 'n/a'
  const pct = value * 100
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(2)}%`
}

function priceVolumeReferenceForHorizon(frames, { key, label, lookbackDays }) {
  const series = sortedFrames(frames)
  const total = series.length
  if (total < 2) {
    return {
      key,
      label,
      lookback_days: lookbackDays,
      effective_lookback_days: Math.max(0, total - 1),
      description: `${label}: insufficient daily bars (${total}) for reliable price/volume reference.`,
    }
  }

  const latest = series[total - 1]
  const latestClose = Number(latest?.bar?.close)
  const latestVolume = Number(latest?.bar?.volume_shares)
  const effectiveLookback = Math.max(1, Math.min(lookbackDays, total - 1))
  const anchorIndex = Math.max(0, total - 1 - effectiveLookback)
  const anchorClose = Number(series[anchorIndex]?.bar?.close)

  const priceChangePct = (Number.isFinite(latestClose) && Number.isFinite(anchorClose) && anchorClose !== 0)
    ? round(latestClose / anchorClose - 1, 6)
    : null

  const recentStart = Math.max(0, total - effectiveLookback)
  const recentVolumes = series.slice(recentStart).map((item) => Number(item?.bar?.volume_shares))
  const recentAvgVolume = average(recentVolumes)
  const span = Math.max(1, total - recentStart)
  const previousStart = Math.max(0, recentStart - span)
  const previousVolumes = series.slice(previousStart, recentStart).map((item) => Number(item?.bar?.volume_shares))
  const previousAvgVolume = average(previousVolumes)

  const volumeChangePct = (Number.isFinite(recentAvgVolume) && Number.isFinite(previousAvgVolume) && previousAvgVolume !== 0)
    ? round(recentAvgVolume / previousAvgVolume - 1, 6)
    : null
  const latestVsRecentRatio = (Number.isFinite(latestVolume) && Number.isFinite(recentAvgVolume) && recentAvgVolume !== 0)
    ? round(latestVolume / recentAvgVolume, 4)
    : null

  const volumeClause = Number.isFinite(volumeChangePct)
    ? `recent average volume ${pctText(volumeChangePct)} vs prior window`
    : (Number.isFinite(latestVsRecentRatio)
      ? `latest volume ${latestVsRecentRatio.toFixed(2)}x of window average`
      : 'volume trend unavailable')

  const closeClause = (Number.isFinite(anchorClose) && Number.isFinite(latestClose))
    ? `${anchorClose.toFixed(2)} -> ${latestClose.toFixed(2)}`
    : 'price path unavailable'
  const sampleClause = effectiveLookback < lookbackDays
    ? ` (using ${effectiveLookback} trading days)`
    : ''

  return {
    key,
    label,
    lookback_days: lookbackDays,
    effective_lookback_days: effectiveLookback,
    start_close: Number.isFinite(anchorClose) ? round(anchorClose, 4) : null,
    latest_close: Number.isFinite(latestClose) ? round(latestClose, 4) : null,
    latest_volume: Number.isFinite(latestVolume) ? round(latestVolume, 4) : null,
    recent_avg_volume: Number.isFinite(recentAvgVolume) ? round(recentAvgVolume, 4) : null,
    previous_avg_volume: Number.isFinite(previousAvgVolume) ? round(previousAvgVolume, 4) : null,
    price_change_pct: priceChangePct,
    volume_change_pct: volumeChangePct,
    latest_vs_recent_volume_ratio: latestVsRecentRatio,
    description: `${label}${sampleClause}: price ${pctText(priceChangePct)} (${closeClause}), ${volumeClause}.`,
  }
}

function buildPriceVolumeReferences(frames) {
  const specs = [
    { key: 'past_6m', label: 'past 6 months', lookbackDays: 126 },
    { key: 'past_1m', label: 'past 1 month', lookbackDays: 21 },
    { key: 'past_1w', label: 'past 1 week', lookbackDays: 5 },
    { key: 'past_1d', label: 'past 1 day', lookbackDays: 1 },
  ]

  const windows = {}
  const descriptions = {}
  const lines = []

  for (const spec of specs) {
    const row = priceVolumeReferenceForHorizon(frames, spec)
    windows[spec.key] = {
      lookback_days: row.lookback_days,
      effective_lookback_days: row.effective_lookback_days,
      start_close: row.start_close ?? null,
      latest_close: row.latest_close ?? null,
      latest_volume: row.latest_volume ?? null,
      recent_avg_volume: row.recent_avg_volume ?? null,
      previous_avg_volume: row.previous_avg_volume ?? null,
      price_change_pct: row.price_change_pct ?? null,
      volume_change_pct: row.volume_change_pct ?? null,
      latest_vs_recent_volume_ratio: row.latest_vs_recent_volume_ratio ?? null,
    }
    descriptions[spec.key] = String(row.description || '').trim()
    if (descriptions[spec.key]) {
      lines.push(descriptions[spec.key])
    }
  }

  return {
    windows,
    descriptions,
    lines,
  }
}

export function buildPositionState({ symbol, account, positions }) {
  const matched = (positions || []).find((position) => position.symbol === symbol)
  return {
    shares: Number(matched?.quantity || 0),
    avg_cost: Number(matched?.entry_price || 0),
    unrealized_pnl: Number(matched?.unrealized_pnl || 0),
    cash_cny: Number(account?.available_balance || 0),
    total_balance_cny: Number(account?.total_equity || 0),
    total_unrealized_pnl_cny: Number(account?.unrealized_profit || 0),
    max_gross_exposure_pct: 1.0,
  }
}

export function buildAgentMarketContext({
  symbol,
  asOfTsMs,
  intradayBatch,
  dailyBatch,
  positionState,
  marketSpec,
}) {
  const spec = marketSpec || {}
  const intradayFrames = sortedFrames(intradayBatch?.frames || [])
  const dailyFrames = sortedFrames(dailyBatch?.frames || [])
  const priceVolumeRefs = buildPriceVolumeReferences(dailyFrames)

  return {
    schema_version: 'agent.market_context.v1',
    as_of_ts_ms: asOfTsMs,
    symbol,
    market: spec.market || 'CN-A',
    constraints: {
      lot_size: Number.isFinite(Number(spec.lot_size)) ? Number(spec.lot_size) : 100,
      t_plus_one: spec.t_plus_one !== undefined ? !!spec.t_plus_one : true,
      currency: spec.currency || 'CNY',
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
      price_volume_windows: priceVolumeRefs.windows,
      price_volume_descriptions: priceVolumeRefs.descriptions,
      price_volume_reference_lines: priceVolumeRefs.lines,
      price_volume_reference_text: priceVolumeRefs.lines.join(' '),
    },
    position_state: positionState,
  }
}
