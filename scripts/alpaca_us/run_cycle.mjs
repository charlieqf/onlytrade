import { fetchAlpacaBars } from './alpacaClient.mjs'
import { alpacaBarsToFrames } from './converter.mjs'
import { atomicWriteJson, parseSymbolList } from './common.mjs'

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token?.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      out[key] = next
      i += 1
    } else {
      out[key] = 'true'
    }
  }
  return out
}

export async function runCycle({
  symbols,
  canonicalPath,
  baseUrl,
  feed,
  adjustment,
  limit1m,
  limit1d,
} = {}) {
  const symbolList = Array.isArray(symbols) ? symbols : []
  if (!symbolList.length) {
    throw new Error('no_symbols')
  }

  const [bars1m, bars1d] = await Promise.all([
    fetchAlpacaBars({
      symbols: symbolList,
      timeframe: '1Min',
      limit: limit1m,
      feed,
      adjustment,
      baseUrl,
    }),
    fetchAlpacaBars({
      symbols: symbolList,
      timeframe: '1Day',
      limit: limit1d,
      feed,
      adjustment,
      baseUrl,
    }),
  ])

  const frames = [
    ...alpacaBarsToFrames({ barsBySymbol: bars1m, interval: '1m' }),
    ...alpacaBarsToFrames({ barsBySymbol: bars1d, interval: '1d' }),
  ]

  // De-dupe and re-seq across both intervals.
  const byKey = new Map()
  for (const f of frames) {
    const key = `${f.instrument.symbol}|${f.interval}|${f.window.start_ts_ms}`
    byKey.set(key, f)
  }
  const merged = Array.from(byKey.values())
  merged.sort((a, b) => {
    if (a.window.start_ts_ms !== b.window.start_ts_ms) return a.window.start_ts_ms - b.window.start_ts_ms
    if (a.instrument.symbol !== b.instrument.symbol) return a.instrument.symbol.localeCompare(b.instrument.symbol)
    return String(a.interval).localeCompare(String(b.interval))
  })
  for (let i = 0; i < merged.length; i++) merged[i].seq = i + 1

  const payload = {
    schema_version: 'market.frames.v1',
    market: 'US',
    mode: 'real',
    provider: 'alpaca-iex',
    frames: merged,
  }

  await atomicWriteJson(canonicalPath, payload)
  return {
    symbols: symbolList,
    frames_total: merged.length,
    output_path: canonicalPath,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const symbols = parseSymbolList(args.symbols || 'AAPL,MSFT,AMZN,GOOGL,META,NVDA,TSLA')
  const canonicalPath = String(args['canonical-path'] || 'data/live/us/frames.us.json')
  const baseUrl = String(args['base-url'] || process.env.APCA_DATA_BASE_URL || 'https://data.alpaca.markets')
  const feed = String(args.feed || process.env.APCA_DATA_FEED || 'iex')
  const adjustment = String(args.adjustment || 'raw')
  const limit1m = Math.max(50, Math.min(Number(args['limit-1m'] || 220), 1000))
  const limit1d = Math.max(60, Math.min(Number(args['limit-1d'] || 180), 1000))

  const summary = await runCycle({
    symbols,
    canonicalPath,
    baseUrl,
    feed,
    adjustment,
    limit1m,
    limit1d,
  })

  process.stdout.write(`${JSON.stringify({ ok: true, ...summary })}\n`)
}

main().catch((err) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: String(err?.message || err) })}\n`)
  process.exitCode = 1
})
