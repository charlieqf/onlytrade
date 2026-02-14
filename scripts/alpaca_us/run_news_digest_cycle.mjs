import { atomicWriteJson, nyDayKey, parseSymbolList } from './common.mjs'
import { fetchAlpacaNews } from './alpacaClient.mjs'

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

function safeText(value, maxLen = 200) {
  const text = String(value || '').trim()
  if (!text) return ''
  return text.slice(0, maxLen)
}

function normalizeNewsItem(item) {
  const title = safeText(item?.headline || item?.title)
  if (!title) return null
  return {
    title,
    source: safeText(item?.source, 60) || null,
    published_at: safeText(item?.created_at || item?.updated_at || item?.timestamp, 40) || null,
    url: safeText(item?.url, 240) || null,
  }
}

async function buildDigest({ symbols, limit, baseUrl }) {
  try {
    const payload = await fetchAlpacaNews({ symbols, limit, baseUrl })
    const raw = Array.isArray(payload?.news)
      ? payload.news
      : (Array.isArray(payload) ? payload : (Array.isArray(payload?.data) ? payload.data : []))

    const headlines = raw.map(normalizeNewsItem).filter(Boolean).slice(0, Math.max(1, Math.min(Number(limit) || 20, 50)))
    return { ok: true, headlines }
  } catch (err) {
    // Best-effort: if Alpaca news is unavailable for the account, write an empty digest.
    return { ok: false, error: String(err?.message || err), headlines: [] }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const symbols = parseSymbolList(args.symbols || 'SPY,QQQ,IWM')
  const canonicalPath = String(args['canonical-path'] || 'data/live/onlytrade/news_digest.us.json')
  const baseUrl = String(args['base-url'] || process.env.APCA_DATA_BASE_URL || 'https://data.alpaca.markets')
  const limit = Math.max(1, Math.min(Number(args.limit || 20), 50))

  const nowMs = Date.now()
  const digest = await buildDigest({ symbols, limit, baseUrl })
  const payload = {
    schema_version: 'news.digest.v1',
    market: 'US',
    mode: 'real',
    provider: digest.ok ? 'alpaca-news' : 'alpaca-news-unavailable',
    day_key: nyDayKey(nowMs),
    as_of_ts_ms: nowMs,
    symbols,
    headline_count: digest.headlines.length,
    headlines: digest.headlines,
    error: digest.ok ? null : digest.error,
  }

  await atomicWriteJson(canonicalPath, payload)
  process.stdout.write(`${JSON.stringify({ ok: true, output_path: canonicalPath, headline_count: digest.headlines.length })}\n`)
}

main().catch((err) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: String(err?.message || err) })}\n`)
  process.exitCode = 1
})
