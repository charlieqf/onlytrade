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
  openingPhaseEnabled = true,
  openingPhaseMinIntradayFrames = 2,
} = {}) {
  const intraday = ensureArray(intradayFrames)
  const daily = ensureArray(dailyFrames)
  const asOf = toSafeNumber(context?.as_of_ts_ms, NaN)
  const requiredIntradayFrames = Math.max(1, Math.floor(toSafeNumber(minIntradayFrames, 21)))
  const requiredDailyFrames = Math.max(1, Math.floor(toSafeNumber(minDailyFrames, 61)))
  const openingMinFrames = Math.max(
    1,
    Math.min(requiredIntradayFrames, Math.floor(toSafeNumber(openingPhaseMinIntradayFrames, 2)))
  )

  let reasons = []
  let level = 'OK'

  if (intraday.length < requiredIntradayFrames) {
    level = bump(level, 'ERROR')
    reasons.push('intraday_frames_insufficient')
  }

  if (daily.length < requiredDailyFrames) {
    level = bump(level, 'ERROR')
    reasons.push('daily_frames_insufficient')
  }

  const intradayFeatures = context?.intraday?.feature_snapshot || {}
  const dailyFeatures = context?.daily?.feature_snapshot || {}
  const requiredCore = [
    ['intraday.ret_5', intradayFeatures.ret_5],
    ['daily.sma_20', dailyFeatures.sma_20],
    ['daily.sma_60', dailyFeatures.sma_60],
    ['daily.rsi_14', dailyFeatures.rsi_14],
  ]
  const requiredOpeningFlexible = [
    ['intraday.ret_20', intradayFeatures.ret_20],
    ['intraday.atr_14', intradayFeatures.atr_14],
    ['intraday.vol_ratio_20', intradayFeatures.vol_ratio_20],
  ]

  const coreMissing = []
  const openingFlexibleMissing = []

  for (const [key, value] of requiredCore) {
    if (value == null || !Number.isFinite(Number(value))) {
      level = bump(level, 'ERROR')
      const reason = `feature_missing:${key}`
      reasons.push(reason)
      coreMissing.push(reason)
    }
  }

  for (const [key, value] of requiredOpeningFlexible) {
    if (value == null || !Number.isFinite(Number(value))) {
      level = bump(level, 'ERROR')
      const reason = `feature_missing:${key}`
      reasons.push(reason)
      openingFlexibleMissing.push(reason)
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

  let openingPhaseActive = false
  const openingPhaseAllowed = (
    openingPhaseEnabled
    && intraday.length >= openingMinFrames
    && intraday.length < requiredIntradayFrames
  )

  if (openingPhaseAllowed && level === 'ERROR') {
    const hasFatalReason = (
      reasons.includes('daily_frames_insufficient')
      || reasons.includes('data_too_stale')
      || intraday.length < openingMinFrames
      || coreMissing.length > 0
    )

    if (!hasFatalReason) {
      const openingFlexibleMissingSet = new Set(openingFlexibleMissing)
      const transformed = []
      for (const reason of reasons) {
        if (reason === 'intraday_frames_insufficient') continue
        if (openingFlexibleMissingSet.has(reason)) continue
        transformed.push(reason)
      }

      transformed.unshift('opening_phase_limited_intraday_history')
      for (const reason of openingFlexibleMissing) {
        transformed.push(reason.replace('feature_missing:', 'feature_pending:'))
      }

      reasons = Array.from(new Set(transformed))
      level = 'WARN'
      openingPhaseActive = true
    }
  }

  return {
    schema_version: 'agent.data_readiness.v1',
    level,
    reasons,
    opening_phase_active: openingPhaseActive,
    as_of_ts_ms: Number.isFinite(asOf) ? asOf : null,
    now_ts_ms: Number(nowMs),
    metrics: {
      intraday_frames: intraday.length,
      daily_frames: daily.length,
      required_intraday_frames: requiredIntradayFrames,
      required_daily_frames: requiredDailyFrames,
      opening_phase_min_intraday_frames: openingMinFrames,
    },
  }
}
