const NY_TZ = 'America/New_York'

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function partsForTimeZone(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  const parts = dtf.formatToParts(date)
  const out = {}
  for (const part of parts) {
    if (!part?.type || part.type === 'literal') continue
    out[part.type] = part.value
  }
  return out
}

function toInt(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  return Math.floor(parsed)
}

function minutesSinceMidnight(parts) {
  const hh = toInt(parts.hour)
  const mm = toInt(parts.minute)
  if (hh === null || mm === null) return null
  return hh * 60 + mm
}

function weekdayIndex(parts) {
  const label = String(parts.weekday || '').trim()
  const idx = WEEKDAY_SHORT.indexOf(label)
  return idx >= 0 ? idx : null
}

function isoLike(parts) {
  const year = String(parts.year || '').trim()
  const month = String(parts.month || '').trim()
  const day = String(parts.day || '').trim()
  const hour = String(parts.hour || '').trim()
  const minute = String(parts.minute || '').trim()
  const second = String(parts.second || '').trim()
  if (!year || !month || !day || !hour || !minute || !second) return null
  // Offset is unknown from parts (DST). Treat this as display-only.
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`
}

export function getUsMarketSessionStatus(nowMs = Date.now()) {
  const date = new Date(Number(nowMs))
  const parts = partsForTimeZone(date, NY_TZ)
  const weekday = weekdayIndex(parts)
  const minutes = minutesSinceMidnight(parts)
  const nowNy = isoLike(parts)

  const out = {
    market: 'US',
    timezone: NY_TZ,
    now_local: nowNy,
    weekday,
    minutes_since_midnight: minutes,
    is_open: false,
    phase: 'closed',
    reason: null,
  }

  if (weekday === null || minutes === null) {
    out.reason = 'session_time_parse_failed'
    return out
  }

  if (weekday === 0 || weekday === 6) {
    out.reason = 'weekend'
    return out
  }

  // Regular session (New York): 09:30-16:00
  const open = 9 * 60 + 30
  const close = 16 * 60

  if (minutes < open) {
    out.reason = 'pre_open'
    return out
  }

  if (minutes > close) {
    out.reason = 'after_close'
    return out
  }

  out.is_open = true
  out.phase = 'regular'
  return out
}
