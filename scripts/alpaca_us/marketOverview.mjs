import { fetchAlpacaBars } from './alpacaClient.mjs'

function toNumber(value, fallback = NaN) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function sortedBars(bars) {
  const rows = Array.isArray(bars) ? bars : []
  return [...rows].sort((a, b) => Date.parse(String(a?.t || '')) - Date.parse(String(b?.t || '')))
}

function computeReturnFromBars(bars, lookback) {
  const series = sortedBars(bars)
  const n = Math.max(0, Math.floor(Number(lookback) || 0))
  if (series.length <= n) return null
  const latest = toNumber(series[series.length - 1]?.c, NaN)
  const base = toNumber(series[series.length - 1 - n]?.c, NaN)
  if (!Number.isFinite(latest) || !Number.isFinite(base) || base === 0) return null
  return Number((latest / base - 1).toFixed(6))
}

function lastBarTsMs(bars, stepMs = 60_000) {
  const series = sortedBars(bars)
  const latest = series[series.length - 1]
  const startTs = Date.parse(String(latest?.t || ''))
  if (!Number.isFinite(startTs)) return null
  return startTs + Math.max(1, Number(stepMs) || 60_000)
}

function safeText(value, maxLen = 80) {
  const text = String(value || '').trim()
  if (!text) return ''
  return text.slice(0, maxLen)
}

export async function buildUsMarketOverview({
  baseUrl,
  feed,
  adjustment,
  tickers,
  limit1m = 80,
} = {}) {
  const symbols = Array.isArray(tickers) ? tickers : []
  if (!symbols.length) {
    throw new Error('no_tickers')
  }

  const barsBySymbol = await fetchAlpacaBars({
    symbols,
    timeframe: '1Min',
    limit: Math.max(25, Math.min(Number(limit1m) || 80, 1000)),
    feed,
    adjustment,
    baseUrl,
  })

  const nameBySymbol = {
    SPY: 'S&P 500',
    QQQ: 'Nasdaq 100',
    IWM: 'Russell 2000',
    XLC: 'Communication Services',
    XLY: 'Consumer Discretionary',
    XLP: 'Consumer Staples',
    XLE: 'Energy',
    XLF: 'Financials',
    XLV: 'Health Care',
    XLI: 'Industrials',
    XLB: 'Materials',
    XLK: 'Technology',
    XLU: 'Utilities',
    XLRE: 'Real Estate',
  }

  const benchmarksSet = new Set(['SPY', 'QQQ', 'IWM'])
  const benchmarks = []
  const sectors = []

  for (const symbolRaw of symbols) {
    const symbol = safeText(symbolRaw).toUpperCase()
    const bars = barsBySymbol?.[symbol] || []
    const record = {
      symbol,
      name: nameBySymbol[symbol] || symbol,
      ret_5: computeReturnFromBars(bars, 5),
      ret_20: computeReturnFromBars(bars, 20),
      last_bar_ts_ms: lastBarTsMs(bars, 60_000),
    }

    if (benchmarksSet.has(symbol)) {
      benchmarks.push(record)
    } else {
      sectors.push({
        name: record.name,
        symbol: record.symbol,
        ret_5: record.ret_5,
        ret_20: record.ret_20,
      })
    }
  }

  return {
    schema_version: 'market.overview.v1',
    market: 'US',
    mode: 'real',
    provider: 'alpaca-iex',
    as_of_ts_ms: Date.now(),
    benchmarks,
    sectors,
    summary: '',
  }
}
