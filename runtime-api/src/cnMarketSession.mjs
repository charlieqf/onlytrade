const SH_TZ = 'Asia/Shanghai'

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
  return `${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`
}

export function getCnAMarketSessionStatus(nowMs = Date.now()) {
  const date = new Date(Number(nowMs))
  const parts = partsForTimeZone(date, SH_TZ)
  const weekday = weekdayIndex(parts)
  const minutes = minutesSinceMidnight(parts)
  const nowShanghai = isoLike(parts)

  const out = {
    market: 'CN-A',
    timezone: SH_TZ,
    now_shanghai: nowShanghai,
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

  // Weekend gate
  if (weekday === 0 || weekday === 6) {
    out.reason = 'weekend'
    return out
  }

  // Session windows (Shanghai local): 09:30-11:30, 13:00-15:00
  const morningOpen = 9 * 60 + 30
  const morningClose = 11 * 60 + 30
  const afternoonOpen = 13 * 60
  const afternoonClose = 15 * 60

  if (minutes >= morningOpen && minutes <= morningClose) {
    out.is_open = true
    out.phase = 'continuous_am'
    return out
  }

  if (minutes >= afternoonOpen && minutes <= afternoonClose) {
    out.is_open = true
    out.phase = 'continuous_pm'
    return out
  }

  out.reason = 'outside_cn_a_session'
  return out
}
