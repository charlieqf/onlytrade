import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_SYMBOLS = [
  '600519.SS',
  '601318.SS',
  '600036.SS',
  '000858.SZ',
  '300750.SZ',
]

const PROVIDER = 'yahoo-finance'
const INTERVAL = '1d'
const HISTORY_DAYS = clampLookbackDays(process.env.HISTORY_DAYS || 90)
const SYMBOLS = (process.env.SYMBOLS || DEFAULT_SYMBOLS.join(','))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const DATA_HISTORY_DIR = path.join('data', 'replay', 'cn-a', 'history')
const PUBLIC_HISTORY_DIR = path.join('onlytrade-web', 'public', 'replay', 'cn-a', 'history')
const FRAMES_FILE = `frames.1d.${HISTORY_DAYS}.json`
const META_FILE = `meta.1d.${HISTORY_DAYS}.json`

function clampLookbackDays(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 90
  return Math.max(20, Math.min(Math.floor(parsed), 365))
}

function toTradingDay(tsMs) {
  return new Date(tsMs).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
}

function dayStartMsShanghai(yyyyMmDd) {
  return new Date(`${yyyyMmDd}T00:00:00+08:00`).getTime()
}

function dayEndMsShanghai(yyyyMmDd) {
  return new Date(`${yyyyMmDd}T23:59:59+08:00`).getTime()
}

function dayToEpochSecShanghai(yyyyMmDd, hh, mm, ss = 0) {
  return Math.floor(new Date(`${yyyyMmDd}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}+08:00`).getTime() / 1000)
}

function addDays(yyyyMmDd, days) {
  const base = new Date(`${yyyyMmDd}T00:00:00+08:00`)
  base.setUTCDate(base.getUTCDate() + days)
  return new Date(base.getTime()).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
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

function bootstrapStartDay(today, historyDays) {
  const calendarLookback = Math.max(historyDays * 2, historyDays + 60)
  return addDays(today, -calendarLookback)
}

function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? Number(value) : fallback
}

async function fetchYahooDailyBars(symbol, period1Sec, period2Sec) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${period1Sec}&period2=${period2Sec}&interval=1d&includePrePost=false&events=div%2Csplits`
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
    const open = quote?.open?.[i]
    const high = quote?.high?.[i]
    const low = quote?.low?.[i]
    const close = quote?.close?.[i]
    const volume = quote?.volume?.[i]

    if (![open, high, low, close, volume].every(Number.isFinite)) continue

    const turnover = Number((volume * close).toFixed(2))
    bars.push({
      tsMs,
      tradingDay: toTradingDay(tsMs),
      open,
      high,
      low,
      close,
      volume,
      turnover,
    })
  }

  bars.sort((a, b) => a.tsMs - b.tsMs)
  return bars
}

function toFrame({ symbol, tradingDay, bar, seq }) {
  const startTsMs = dayStartMsShanghai(tradingDay)
  const endTsMs = dayEndMsShanghai(tradingDay) + 1
  return {
    schema_version: 'market.bar.v1',
    market: 'CN-A',
    mode: 'real',
    provider: PROVIDER,
    feed: 'bars',
    seq,
    event_ts_ms: endTsMs,
    ingest_ts_ms: endTsMs + 250,
    instrument: {
      symbol: onlyTradeSymbol(symbol),
      exchange: exchangeFromYahooSymbol(symbol),
      timezone: 'Asia/Shanghai',
      currency: 'CNY',
    },
    interval: INTERVAL,
    window: {
      start_ts_ms: startTsMs,
      end_ts_ms: endTsMs,
      trading_day: tradingDay,
    },
    session: {
      phase: 'closed',
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

function frameKey(frame) {
  const symbol = frame?.instrument?.symbol || ''
  const interval = frame?.interval || ''
  const start = safeNumber(frame?.window?.start_ts_ms, -1)
  return `${symbol}|${interval}|${start}`
}

function sortFrames(a, b) {
  if (a.instrument.symbol === b.instrument.symbol) {
    return a.window.start_ts_ms - b.window.start_ts_ms
  }
  return a.instrument.symbol.localeCompare(b.instrument.symbol)
}

function trimFramesPerSymbol(frames, historyDays) {
  const grouped = new Map()
  for (const frame of frames) {
    const symbol = frame.instrument?.symbol
    if (!symbol) continue
    if (!grouped.has(symbol)) grouped.set(symbol, [])
    grouped.get(symbol).push(frame)
  }

  const trimmed = []
  for (const list of grouped.values()) {
    list.sort((a, b) => a.window.start_ts_ms - b.window.start_ts_ms)
    trimmed.push(...list.slice(-historyDays))
  }

  trimmed.sort(sortFrames)
  return trimmed.map((frame, idx) => ({ ...frame, seq: idx + 1 }))
}

async function loadExistingBatch(framesPath) {
  try {
    const content = await readFile(framesPath, 'utf8')
    const parsed = JSON.parse(content)
    if (!parsed || !Array.isArray(parsed.frames)) return null
    return parsed
  } catch {
    return null
  }
}

function symbolLastTradingDay(existingFrames, symbol) {
  const onlyTrade = onlyTradeSymbol(symbol)
  const rows = existingFrames
    .filter((f) => f.instrument?.symbol === onlyTrade)
    .sort((a, b) => a.window.start_ts_ms - b.window.start_ts_ms)
  const last = rows[rows.length - 1]
  return last?.window?.trading_day || null
}

function symbolFrameCount(existingFrames, symbol) {
  const onlyTrade = onlyTradeSymbol(symbol)
  return existingFrames.filter((f) => f.instrument?.symbol === onlyTrade).length
}

function todayShanghai() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
}

async function main() {
  const framesPath = path.join(DATA_HISTORY_DIR, FRAMES_FILE)
  const metaPath = path.join(DATA_HISTORY_DIR, META_FILE)
  const publicFramesPath = path.join(PUBLIC_HISTORY_DIR, FRAMES_FILE)
  const publicMetaPath = path.join(PUBLIC_HISTORY_DIR, META_FILE)
  const today = todayShanghai()

  await mkdir(DATA_HISTORY_DIR, { recursive: true })
  await mkdir(PUBLIC_HISTORY_DIR, { recursive: true })

  const existingBatch = await loadExistingBatch(framesPath)
  const existingFrames = Array.isArray(existingBatch?.frames) ? existingBatch.frames : []
  const merged = new Map(existingFrames.map((frame) => [frameKey(frame), frame]))
  let appendedCount = 0

  console.log(`Updating CN-A daily history (${HISTORY_DAYS} days)`)
  console.log(`Symbols: ${SYMBOLS.join(', ')}`)

  for (const symbol of SYMBOLS) {
    try {
      const lastDay = symbolLastTradingDay(existingFrames, symbol)
      const existingCount = symbolFrameCount(existingFrames, symbol)
      const needsBackfill = existingCount < HISTORY_DAYS
      const fetchStartDay = needsBackfill
        ? bootstrapStartDay(today, HISTORY_DAYS)
        : (lastDay ? addDays(lastDay, 1) : bootstrapStartDay(today, HISTORY_DAYS))

      if (fetchStartDay > today) {
        console.log(`${symbol}: already up to date (${lastDay})`)
        continue
      }

      const period1 = dayToEpochSecShanghai(fetchStartDay, 0, 0)
      const period2 = dayToEpochSecShanghai(today, 23, 59, 59)
      const bars = await fetchYahooDailyBars(symbol, period1, period2)
      const frames = bars.map((bar) => toFrame({ symbol, tradingDay: bar.tradingDay, bar, seq: 0 }))

      let symbolAppended = 0
      for (const frame of frames) {
        const key = frameKey(frame)
        if (!merged.has(key)) symbolAppended += 1
        merged.set(key, frame)
      }

      appendedCount += symbolAppended
      const suffix = needsBackfill ? ' (backfill)' : ''
      console.log(`${symbol}: fetched ${frames.length}, appended ${symbolAppended}${suffix}`)
    } catch (err) {
      console.warn(`${symbol}: failed -> ${err.message}`)
    }
  }

  const mergedFrames = Array.from(merged.values())
  const finalFrames = trimFramesPerSymbol(mergedFrames, HISTORY_DAYS)
  const tradingDays = finalFrames.map((f) => f.window.trading_day).filter(Boolean).sort()
  const uniqueSymbols = [...new Set(finalFrames.map((f) => f.instrument.symbol))].sort()

  const batch = {
    schema_version: 'market.frames.v1',
    market: 'CN-A',
    mode: 'real',
    provider: PROVIDER,
    frames: finalFrames,
  }

  const meta = {
    interval: INTERVAL,
    lookback_days: HISTORY_DAYS,
    provider: PROVIDER,
    symbols: uniqueSymbols,
    frame_count: finalFrames.length,
    trading_day_start: tradingDays[0] || null,
    trading_day_end: tradingDays[tradingDays.length - 1] || null,
    generated_at: new Date().toISOString(),
    append_count: appendedCount,
    source_note: 'Yahoo Finance daily bars for agent context warmup and replay decisions',
  }

  await writeFile(framesPath, JSON.stringify(batch, null, 2), 'utf8')
  await writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8')
  await writeFile(publicFramesPath, JSON.stringify(batch), 'utf8')
  await writeFile(publicMetaPath, JSON.stringify(meta), 'utf8')

  console.log(`Saved ${finalFrames.length} daily frames to ${framesPath}`)
  console.log(`Updated public history at ${publicFramesPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
