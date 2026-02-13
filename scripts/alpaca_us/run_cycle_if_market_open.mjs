import { nyIsRegularSessionOpen } from './common.mjs'
import { runCycle } from './run_cycle.mjs'
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
  const nowMs = Date.now()
  const open = nyIsRegularSessionOpen(nowMs)

  if (!open) {
    process.stdout.write(`${JSON.stringify({ ok: true, status: 'skip', reason: 'outside_us_regular_session', now_ms: nowMs })}\n`)
    return
  }

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

  process.stdout.write(`${JSON.stringify({ ok: true, status: 'ran', ...summary })}\n`)
}

main().catch((err) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: String(err?.message || err) })}\n`)
  process.exitCode = 1
})
