import { nyIsRegularSessionOpen } from './common.mjs'
import { runMarketOverviewCycle } from './run_market_overview_cycle.mjs'
import { parseSymbolList } from './common.mjs'
import { pathToFileURL } from 'node:url'

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

async function main() {
  const nowMs = Date.now()
  const open = nyIsRegularSessionOpen(nowMs)
  if (!open) {
    process.stdout.write(`${JSON.stringify({ ok: true, status: 'skip', reason: 'outside_us_regular_session', now_ms: nowMs })}\n`)
    return
  }

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
  process.stdout.write(`${JSON.stringify({ ok: true, status: 'ran', ...summary })}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: String(err?.message || err) })}\n`)
    process.exitCode = 1
  })
}
