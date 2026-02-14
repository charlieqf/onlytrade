function toSafeNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function ensureArray(value) {
  return Array.isArray(value) ? value : []
}

function readinessLevelRank(level) {
  if (level === 'ERROR') return 3
  if (level === 'WARN') return 2
  return 1
}

function bump(level, next) {
  return readinessLevelRank(next) > readinessLevelRank(level) ? next : level
}

export function evaluateDataReadiness({
  context,
  intradayFrames,
  dailyFrames,
  nowMs = Date.now(),
  minIntradayFrames = 21,
  minDailyFrames = 61,
  freshnessWarnMs = 150_000,
  freshnessErrorMs = 330_000,
} = {}) {
  const intraday = ensureArray(intradayFrames)
  const daily = ensureArray(dailyFrames)
  const asOf = toSafeNumber(context?.as_of_ts_ms, NaN)

  const reasons = []
  let level = 'OK'

  if (intraday.length < Math.max(1, Math.floor(toSafeNumber(minIntradayFrames, 21)))) {
    level = bump(level, 'ERROR')
    reasons.push('intraday_frames_insufficient')
  }

  if (daily.length < Math.max(1, Math.floor(toSafeNumber(minDailyFrames, 61)))) {
    level = bump(level, 'ERROR')
    reasons.push('daily_frames_insufficient')
  }

  const intradayFeatures = context?.intraday?.feature_snapshot || {}
  const dailyFeatures = context?.daily?.feature_snapshot || {}
  const required = [
    ['intraday.ret_5', intradayFeatures.ret_5],
    ['intraday.ret_20', intradayFeatures.ret_20],
    ['intraday.atr_14', intradayFeatures.atr_14],
    ['intraday.vol_ratio_20', intradayFeatures.vol_ratio_20],
    ['daily.sma_20', dailyFeatures.sma_20],
    ['daily.sma_60', dailyFeatures.sma_60],
    ['daily.rsi_14', dailyFeatures.rsi_14],
  ]

  for (const [key, value] of required) {
    if (value == null || !Number.isFinite(Number(value))) {
      level = bump(level, 'ERROR')
      reasons.push(`feature_missing:${key}`)
    }
  }

  if (Number.isFinite(asOf)) {
    const age = Math.max(0, Number(nowMs) - asOf)
    if (age > Math.max(0, toSafeNumber(freshnessErrorMs, 330_000))) {
      level = bump(level, 'ERROR')
      reasons.push('data_too_stale')
    } else if (age > Math.max(0, toSafeNumber(freshnessWarnMs, 150_000))) {
      level = bump(level, 'WARN')
      reasons.push('data_stale')
    }
  }

  return {
    schema_version: 'agent.data_readiness.v1',
    level,
    reasons,
    as_of_ts_ms: Number.isFinite(asOf) ? asOf : null,
    now_ts_ms: Number(nowMs),
    metrics: {
      intraday_frames: intraday.length,
      daily_frames: daily.length,
    },
  }
}
