import { atomicWriteJson, parseSymbolList } from './common.mjs'
import { buildUsMarketOverview } from './marketOverview.mjs'

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

export async function runMarketOverviewCycle({
  tickers,
  canonicalPath,
  baseUrl,
  feed,
  adjustment,
  limit1m,
} = {}) {
  const symbols = Array.isArray(tickers) ? tickers : []
  if (!symbols.length) {
    throw new Error('no_tickers')
  }

  const payload = await buildUsMarketOverview({
    tickers: symbols,
    baseUrl,
    feed,
    adjustment,
    limit1m,
  })

  await atomicWriteJson(canonicalPath, payload)
  return {
    tickers: symbols,
    output_path: canonicalPath,
    as_of_ts_ms: payload.as_of_ts_ms,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const tickers = parseSymbolList(args.tickers || 'SPY,QQQ,IWM,XLC,XLY,XLP,XLE,XLF,XLV,XLI,XLB,XLK,XLU,XLRE')
  const canonicalPath = String(args['canonical-path'] || 'data/live/onlytrade/market_overview.us.json')
  const baseUrl = String(args['base-url'] || process.env.APCA_DATA_BASE_URL || 'https://data.alpaca.markets')
  const feed = String(args.feed || process.env.APCA_DATA_FEED || 'iex')
  const adjustment = String(args.adjustment || 'raw')
  const limit1m = Math.max(25, Math.min(Number(args['limit-1m'] || 120), 1000))

  const summary = await runMarketOverviewCycle({
    tickers,
    canonicalPath,
    baseUrl,
    feed,
    adjustment,
    limit1m,
  })

  process.stdout.write(`${JSON.stringify({ ok: true, ...summary })}\n`)
}

main().catch((err) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: String(err?.message || err) })}\n`)
  process.exitCode = 1
})
