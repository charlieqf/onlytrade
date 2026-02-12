import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_SYMBOLS = [
  '600519.SS',
  '601318.SS',
  '600036.SS',
  '000858.SZ',
  '300750.SZ',
]

const TARGET_DATE = process.env.REPLAY_DATE || getPreviousTradingDateShanghai()
const REPLAY_DAYS = Math.max(1, Math.min(Number(process.env.REPLAY_DAYS || 3), 10))
const SYMBOLS = (process.env.SYMBOLS || DEFAULT_SYMBOLS.join(','))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const INTERVAL = '1m'
const PROVIDER = 'yahoo-finance'

function getPreviousTradingDateShanghai() {
  const now = new Date()
  const shanghai = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }))
  shanghai.setDate(shanghai.getDate() - 1)

  while (shanghai.getDay() === 0 || shanghai.getDay() === 6) {
    shanghai.setDate(shanghai.getDate() - 1)
  }

  const y = shanghai.getFullYear()
  const m = String(shanghai.getMonth() + 1).padStart(2, '0')
  const d = String(shanghai.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function addDays(yyyyMmDd, days) {
  const [y, m, d] = yyyyMmDd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d, 0, 0, 0))
  dt.setUTCDate(dt.getUTCDate() + days)
  const ny = dt.getUTCFullYear()
  const nm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const nd = String(dt.getUTCDate()).padStart(2, '0')
  return `${ny}-${nm}-${nd}`
}

function isWeekendShanghai(yyyyMmDd) {
  const dt = new Date(`${yyyyMmDd}T00:00:00+08:00`)
  const day = dt.getDay()
  return day === 0 || day === 6
}

function getRecentTradingDatesShanghai(endDate, count) {
  const dates = []
  let cursor = endDate

  while (dates.length < count) {
    if (!isWeekendShanghai(cursor)) {
      dates.push(cursor)
    }
    cursor = addDays(cursor, -1)
  }

  return dates.reverse()
}

function shanghaiHourMinute(tsMs) {
  const hhmm = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(tsMs))
  const [hh, mm] = hhmm.split(':').map(Number)
  return hh * 60 + mm
}

function isCnTradingMinute(tsMs) {
  const minutes = shanghaiHourMinute(tsMs)
  const inMorning = minutes >= 570 && minutes < 690
  const inAfternoon = minutes >= 780 && minutes < 900
  return inMorning || inAfternoon
}

function sessionPhase(tsMs) {
  const minutes = shanghaiHourMinute(tsMs)
  if (minutes >= 555 && minutes < 570) return 'pre_open'
  if (minutes >= 570 && minutes < 690) return 'continuous_am'
  if (minutes >= 690 && minutes < 780) return 'lunch_break'
  if (minutes >= 780 && minutes < 900) return 'continuous_pm'
  if (minutes >= 900 && minutes < 915) return 'close_auction'
  return 'closed'
}

function toTradingDay(tsMs) {
  return new Date(tsMs).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
}

function exchangeFromYahooSymbol(symbol) {
  if (symbol.endsWith('.SS')) return 'SSE'
  if (symbol.endsWith('.SZ')) return 'SZSE'
  return 'OTHER'
}

function onlyTradeSymbol(symbol) {
  if (symbol.endsWith('.SS')) return symbol.replace('.SS', '.SH')
  return symbol
}

function toEpochSecShanghai(yyyyMmDd, hh, mm, ss = 0) {
  const date = `${yyyyMmDd}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}+08:00`
  return Math.floor(new Date(date).getTime() / 1000)
}

async function fetchYahooBars(symbol, tradingDate) {
  // Pull a wide enough window around the target date.
  const period1 = toEpochSecShanghai(tradingDate, 0, 0)
  const period2 = toEpochSecShanghai(tradingDate, 23, 59, 59)
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${period1}&period2=${period2}&interval=1m&includePrePost=true&events=div%2Csplits`

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Yahoo fetch failed for ${symbol}: ${res.status}`)
  }

  const json = await res.json()
  const result = json?.chart?.result?.[0]
  const timestamps = result?.timestamp || []
  const quote = result?.indicators?.quote?.[0] || {}

  const bars = []
  for (let i = 0; i < timestamps.length; i++) {
    const tsSec = timestamps[i]
    const tsMs = tsSec * 1000
    if (toTradingDay(tsMs) !== tradingDate) continue
    if (!isCnTradingMinute(tsMs)) continue

    const open = quote?.open?.[i]
    const high = quote?.high?.[i]
    const low = quote?.low?.[i]
    const close = quote?.close?.[i]
    const volume = quote?.volume?.[i]

    if (![open, high, low, close, volume].every(Number.isFinite)) continue

    bars.push({
      tsMs,
      open,
      high,
      low,
      close,
      volume,
      turnover: Number((volume * close).toFixed(2)),
    })
  }

  return bars
}

function toFrame({ symbol, tradingDate, bar, seq }) {
  return {
    schema_version: 'market.bar.v1',
    market: 'CN-A',
    mode: 'real',
    provider: PROVIDER,
    feed: 'bars',
    seq,
    event_ts_ms: bar.tsMs + 60_000,
    ingest_ts_ms: bar.tsMs + 60_250,
    instrument: {
      symbol: onlyTradeSymbol(symbol),
      exchange: exchangeFromYahooSymbol(symbol),
      timezone: 'Asia/Shanghai',
      currency: 'CNY',
    },
    interval: INTERVAL,
    window: {
      start_ts_ms: bar.tsMs,
      end_ts_ms: bar.tsMs + 60_000,
      trading_day: tradingDate,
    },
    session: {
      phase: sessionPhase(bar.tsMs),
      is_halt: false,
      is_partial: false,
    },
    bar: {
      open: Number(bar.open.toFixed(4)),
      high: Number(bar.high.toFixed(4)),
      low: Number(bar.low.toFixed(4)),
      close: Number(bar.close.toFixed(4)),
      volume_shares: Number(bar.volume),
      turnover_cny: bar.turnover,
      vwap: Number((bar.turnover / Math.max(1, bar.volume)).toFixed(4)),
    },
  }
}

async function main() {
  const allFrames = []
  let seq = 1
  const replayDates = getRecentTradingDatesShanghai(TARGET_DATE, REPLAY_DAYS)

  console.log(`Building replay pack ending ${TARGET_DATE} (${REPLAY_DAYS} trading days)`)
  console.log(`Trading days: ${replayDates.join(', ')}`)
  console.log(`Symbols: ${SYMBOLS.join(', ')}`)

  for (const tradingDate of replayDates) {
    for (const symbol of SYMBOLS) {
      try {
        const bars = await fetchYahooBars(symbol, tradingDate)
        const frames = bars.map((bar) => toFrame({ symbol, tradingDate, bar, seq: seq++ }))
        allFrames.push(...frames)
        console.log(`${tradingDate} ${symbol}: ${frames.length} bars`)
      } catch (err) {
        console.warn(`${tradingDate} ${symbol}: failed -> ${err.message}`)
      }
    }
  }

  allFrames.sort((a, b) => {
    if (a.instrument.symbol === b.instrument.symbol) {
      return a.window.start_ts_ms - b.window.start_ts_ms
    }
    return a.instrument.symbol.localeCompare(b.instrument.symbol)
  })

  const dayDir = path.join('data', 'replay', 'cn-a', TARGET_DATE)
  const latestPublicDir = path.join('onlytrade-web', 'public', 'replay', 'cn-a', 'latest')

  await mkdir(dayDir, { recursive: true })
  await mkdir(latestPublicDir, { recursive: true })

  const jsonl = allFrames.map((f) => JSON.stringify(f)).join('\n') + (allFrames.length ? '\n' : '')
  await writeFile(path.join(dayDir, 'frames.1m.jsonl'), jsonl, 'utf8')

  const batch = {
    schema_version: 'market.frames.v1',
    market: 'CN-A',
    mode: 'real',
    provider: PROVIDER,
    frames: allFrames,
  }

  await writeFile(path.join(dayDir, 'frames.1m.json'), JSON.stringify(batch, null, 2), 'utf8')
  await writeFile(path.join(latestPublicDir, 'frames.1m.json'), JSON.stringify(batch), 'utf8')

  const meta = {
    trading_day: TARGET_DATE,
    trading_day_start: replayDates[0],
    trading_day_end: replayDates[replayDates.length - 1],
    trading_days: replayDates,
    trading_day_count: replayDates.length,
    provider: PROVIDER,
    interval: INTERVAL,
    symbols: [...new Set(allFrames.map((f) => f.instrument.symbol))],
    frame_count: allFrames.length,
    generated_at: new Date().toISOString(),
    source_note: 'Yahoo Finance 1m bars replay pack for frontend mock/replay use (multi-day)',
  }
  await writeFile(path.join(dayDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8')
  await writeFile(path.join(latestPublicDir, 'meta.json'), JSON.stringify(meta), 'utf8')

  console.log(`Wrote ${allFrames.length} frames to ${dayDir}`)
  console.log(`Updated frontend replay source at ${latestPublicDir}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
