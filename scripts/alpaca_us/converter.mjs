import { nyDayKey } from './common.mjs'

function toNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function frameKey(frame) {
  return `${frame.instrument?.symbol || ''}|${frame.interval || ''}|${frame.window?.start_ts_ms || 0}`
}

function dedupeAndSort(frames) {
  const byKey = new Map()
  for (const f of frames || []) {
    if (!f?.instrument?.symbol || !f?.interval) continue
    if (!Number.isFinite(Number(f?.window?.start_ts_ms))) continue
    byKey.set(frameKey(f), f)
  }
  const out = Array.from(byKey.values())
  out.sort((a, b) => a.window.start_ts_ms - b.window.start_ts_ms)
  for (let i = 0; i < out.length; i++) {
    out[i].seq = i + 1
  }
  return out
}

export function alpacaBarsToFrames({ barsBySymbol, interval }) {
  const safeInterval = interval === '1d' ? '1d' : '1m'
  const stepMs = safeInterval === '1d' ? 24 * 60 * 60_000 : 60_000
  const frames = []

  for (const [symbol, bars] of Object.entries(barsBySymbol || {})) {
    const sym = String(symbol || '').trim().toUpperCase()
    if (!sym) continue
    const rows = Array.isArray(bars) ? bars : []
    for (const row of rows) {
      const startTsMs = Date.parse(String(row?.t || ''))
      if (!Number.isFinite(startTsMs)) continue
      const endTsMs = startTsMs + stepMs

      const open = toNumber(row?.o)
      const high = toNumber(row?.h, open)
      const low = toNumber(row?.l, open)
      const close = toNumber(row?.c, open)
      const volume = toNumber(row?.v)
      const vwap = toNumber(row?.vw, close)
      const turnover = volume > 0 ? volume * close : 0

      frames.push({
        schema_version: 'market.bar.v1',
        market: 'US',
        mode: 'real',
        provider: 'alpaca-iex',
        feed: 'bars',
        seq: 0,
        event_ts_ms: endTsMs,
        ingest_ts_ms: endTsMs + 250,
        instrument: {
          symbol: sym,
          exchange: 'NASDAQ',
          timezone: 'America/New_York',
          currency: 'USD',
        },
        interval: safeInterval,
        window: {
          start_ts_ms: startTsMs,
          end_ts_ms: endTsMs,
          trading_day: nyDayKey(startTsMs),
        },
        session: {
          phase: 'regular',
          is_halt: false,
          is_partial: false,
        },
        bar: {
          open: Number(open.toFixed(4)),
          high: Number(high.toFixed(4)),
          low: Number(low.toFixed(4)),
          close: Number(close.toFixed(4)),
          volume_shares: Number(volume.toFixed(2)),
          // Note: schema field name is CN-specific; value here is USD turnover for now.
          turnover_cny: Number(turnover.toFixed(2)),
          vwap: Number(vwap.toFixed(4)),
        },
      })
    }
  }

  return dedupeAndSort(frames)
}
