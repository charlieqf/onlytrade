function requireEnv(name) {
  const value = String(process.env[name] || '').trim()
  if (!value) {
    throw new Error(`missing_env_${name}`)
  }
  return value
}

export async function fetchAlpacaBars({
  symbols,
  timeframe,
  limit,
  feed = 'iex',
  adjustment = 'raw',
  baseUrl = 'https://data.alpaca.markets',
} = {}) {
  const keyId = requireEnv('APCA_API_KEY_ID')
  const secret = requireEnv('APCA_API_SECRET_KEY')
  const symbolList = Array.isArray(symbols) ? symbols : []
  if (!symbolList.length) return {}

  const url = new URL('/v2/stocks/bars', baseUrl)
  url.searchParams.set('symbols', symbolList.join(','))
  url.searchParams.set('timeframe', String(timeframe || '1Min'))
  url.searchParams.set('limit', String(Math.max(1, Math.min(Number(limit) || 200, 10000))))
  url.searchParams.set('feed', String(feed || 'iex'))
  url.searchParams.set('adjustment', String(adjustment || 'raw'))

  const response = await fetch(url.toString(), {
    headers: {
      'APCA-API-KEY-ID': keyId,
      'APCA-API-SECRET-KEY': secret,
    },
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`alpaca_http_${response.status}:${text.slice(0, 200)}`)
  }

  const payload = JSON.parse(text)
  const bars = payload?.bars && typeof payload.bars === 'object' ? payload.bars : {}
  return bars
}
