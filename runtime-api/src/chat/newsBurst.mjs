const CATEGORY_PRIORITY = {
  ai: 5,
  geopolitics: 4,
  global_macro: 3,
  tech: 2,
  markets_cn: 1,
}

const CATEGORY_ALIAS = {
  geopolitic: 'geopolitics',
  geo: 'geopolitics',
  macro: 'global_macro',
  globalmacro: 'global_macro',
  technology: 'tech',
  market: 'markets_cn',
}

function toFiniteNumber(value, fallback = null) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toTimestampMs(value) {
  const numeric = toFiniteNumber(value, null)
  if (numeric != null) {
    if (numeric > 10_000_000_000) return Math.floor(numeric)
    if (numeric > 0) return Math.floor(numeric * 1000)
  }

  const text = String(value || '').trim()
  if (!text) return null
  const parsed = Date.parse(text)
  return Number.isFinite(parsed) ? parsed : null
}

function titleKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，,。.!！?？:：;；~`'"“”‘’\-_=+()\[\]{}<>\/\\]/g, '')
    .slice(0, 96)
}

export function normalizeNewsCategory(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/\s+/g, '_')
  if (!normalized) return ''
  return CATEGORY_ALIAS[normalized] || normalized
}

export function normalizeDigestHeadlines(headlines, { limit = 24 } = {}) {
  const out = []
  const seen = new Set()

  const safeRows = Array.isArray(headlines) ? headlines : []
  for (const row of safeRows) {
    const title = String(row?.title || row?.headline || row?.text || '').trim()
    if (!title) continue

    const dedupe = titleKey(title)
    if (!dedupe || seen.has(dedupe)) continue
    seen.add(dedupe)

    const category = normalizeNewsCategory(row?.category || row?.topic || row?.tag || '')
    const score = toFiniteNumber(row?.score, 0) || 0
    const publishedTs = toTimestampMs(
      row?.published_ts_ms
      ?? row?.publish_ts_ms
      ?? row?.ts_ms
      ?? row?.published_at
      ?? row?.pub_date
      ?? row?.date
    )

    out.push({
      title,
      category: category || null,
      score,
      published_ts_ms: publishedTs,
    })

    if (out.length >= Math.max(1, Math.floor(Number(limit) || 24))) break
  }

  return out
}

export function selectNewsBurstSignal({
  headlines,
  nowMs = Date.now(),
  freshWindowMs = 20 * 60_000,
  minPriority = 3,
} = {}) {
  const normalized = normalizeDigestHeadlines(headlines)
  const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now()
  const freshness = Math.max(10_000, Number(freshWindowMs) || (20 * 60_000))
  const threshold = Math.max(1, Math.floor(Number(minPriority) || 3))
  const maxFutureSkewMs = 5 * 60_000

  const candidates = normalized
    .map((item) => {
      const category = normalizeNewsCategory(item?.category || '')
      const priority = Number(CATEGORY_PRIORITY[category] || 0)
      const published = toFiniteNumber(item?.published_ts_ms, null)
      const ageMs = published == null ? null : (now - published)

      return {
        title: String(item?.title || '').trim(),
        category,
        priority,
        published_ts_ms: published,
        age_ms: ageMs,
        score: toFiniteNumber(item?.score, 0) || 0,
      }
    })
    .filter((item) => {
      if (!item.title) return false
      if (!item.category || item.priority < threshold) return false
      if (!Number.isFinite(item.published_ts_ms)) return false
      if (!Number.isFinite(item.age_ms)) return false
      if (item.age_ms < -maxFutureSkewMs) return false
      return item.age_ms <= freshness
    })
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority
      if (b.published_ts_ms !== a.published_ts_ms) return b.published_ts_ms - a.published_ts_ms
      if (b.score !== a.score) return b.score - a.score
      return a.title.localeCompare(b.title)
    })

  const best = candidates[0]
  if (!best) return null

  return {
    key: `${best.category}|${best.published_ts_ms}|${titleKey(best.title)}`,
    title: best.title,
    category: best.category,
    priority: best.priority,
    score: best.score,
    published_ts_ms: best.published_ts_ms,
    age_ms: Math.max(0, Math.floor(Number(best.age_ms) || 0)),
  }
}

export function resolveProactiveCadence({
  nowMs = Date.now(),
  defaultIntervalMs = 18_000,
  burstIntervalMs = 9_000,
  burstDurationMs = 120_000,
  cooldownMs = 480_000,
  previousState = null,
  burstSignal = null,
} = {}) {
  const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now()
  const baseInterval = Math.max(3_000, Math.floor(Number(defaultIntervalMs) || 18_000))
  const burstInterval = Math.max(2_000, Math.floor(Number(burstIntervalMs) || 9_000))
  const duration = Math.max(0, Math.floor(Number(burstDurationMs) || 120_000))
  const cooldown = Math.max(0, Math.floor(Number(cooldownMs) || 480_000))
  const burstFeatureEnabled = duration > 0 && burstInterval < baseInterval

  const state = {
    burst_until_ms: Number.isFinite(Number(previousState?.burst_until_ms))
      ? Math.floor(Number(previousState.burst_until_ms))
      : 0,
    cooldown_until_ms: Number.isFinite(Number(previousState?.cooldown_until_ms))
      ? Math.floor(Number(previousState.cooldown_until_ms))
      : 0,
    last_trigger_key: String(previousState?.last_trigger_key || '').trim(),
    last_trigger_ts_ms: Number.isFinite(Number(previousState?.last_trigger_ts_ms))
      ? Math.floor(Number(previousState.last_trigger_ts_ms))
      : 0,
    last_signal_published_ts_ms: Number.isFinite(Number(previousState?.last_signal_published_ts_ms))
      ? Math.floor(Number(previousState.last_signal_published_ts_ms))
      : 0,
  }

  let triggered = false
  if (burstFeatureEnabled) {
    const signalKey = String(burstSignal?.key || '').trim()
    const signalPublishedTs = Number.isFinite(Number(burstSignal?.published_ts_ms))
      ? Math.floor(Number(burstSignal.published_ts_ms))
      : 0

    const signalChanged = signalKey && (
      signalKey !== state.last_trigger_key
      || (signalPublishedTs > 0 && signalPublishedTs > state.last_signal_published_ts_ms)
    )

    if (signalChanged && now >= state.cooldown_until_ms) {
      state.burst_until_ms = now + duration
      state.cooldown_until_ms = now + cooldown
      state.last_trigger_key = signalKey
      state.last_trigger_ts_ms = now
      state.last_signal_published_ts_ms = signalPublishedTs > 0 ? signalPublishedTs : now
      triggered = true
    }
  }

  const activeBurst = burstFeatureEnabled && now < state.burst_until_ms
  return {
    intervalMs: activeBurst ? burstInterval : baseInterval,
    activeBurst,
    triggered,
    state,
  }
}
