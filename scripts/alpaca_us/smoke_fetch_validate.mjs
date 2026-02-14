import { runCycle } from './run_cycle.mjs'
import { runMarketOverviewCycle } from './run_market_overview_cycle.mjs'
import { validateFramesFile } from './validate_frames.mjs'
import { validateMarketOverviewFile } from './validate_market_overview.mjs'
import { parseSymbolList } from './common.mjs'

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
  const args = parseArgs(process.argv.slice(2))
  const framesPath = String(args['frames-path'] || 'data/live/us/frames.us.json')
  const overviewPath = String(
    args['overview-path'] || 'data/live/onlytrade/market_overview.us.json'
  )

  const symbols = parseSymbolList(args.symbols || 'AAPL,MSFT')
  const tickers = parseSymbolList(args.tickers || 'SPY,QQQ,IWM,XLK,XLF')

  const baseUrl = String(args['base-url'] || process.env.APCA_DATA_BASE_URL || 'https://data.alpaca.markets')
  const feed = String(args.feed || process.env.APCA_DATA_FEED || 'iex')
  const adjustment = String(args.adjustment || 'raw')
  const limit1m = Math.max(50, Math.min(Number(args['limit-1m'] || 120), 1000))
  const limit1d = Math.max(60, Math.min(Number(args['limit-1d'] || 120), 1000))

  const overview = await runMarketOverviewCycle({
    tickers,
    canonicalPath: overviewPath,
    baseUrl,
    feed,
    adjustment,
    limit1m,
  })

  const frames = await runCycle({
    symbols,
    canonicalPath: framesPath,
    baseUrl,
    feed,
    adjustment,
    limit1m,
    limit1d,
  })

  const overviewValidation = await validateMarketOverviewFile(overviewPath)
  const framesValidation = await validateFramesFile(framesPath)

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      overview,
      frames,
      overview_validation: overviewValidation,
      frames_validation: framesValidation,
    })}\n`
  )
}

main().catch((err) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: String(err?.message || err) })}\n`)
  process.exitCode = 1
})
