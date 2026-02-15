import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteOrNull(value) {
  return value === null || Number.isFinite(Number(value))
}

export async function validateMarketOverviewFile(filePath) {
  const text = await readFile(filePath, 'utf8')
  const payload = JSON.parse(text)

  assert(isObject(payload), 'payload_not_object')
  assert(payload.schema_version === 'market.overview.v1', 'schema_version_mismatch')
  assert(payload.market === 'US', 'market_mismatch')
  assert(typeof payload.provider === 'string' && payload.provider, 'provider_missing')
  assert(Number.isFinite(Number(payload.as_of_ts_ms)), 'as_of_ts_ms_invalid')

  const benchmarks = Array.isArray(payload.benchmarks) ? payload.benchmarks : []
  const sectors = Array.isArray(payload.sectors) ? payload.sectors : []
  assert(benchmarks.length > 0, 'benchmarks_empty')
  assert(sectors.length > 0, 'sectors_empty')

  for (const row of benchmarks) {
    assert(isObject(row), 'benchmark_row_not_object')
    assert(typeof row.symbol === 'string' && row.symbol, 'benchmark_symbol_missing')
    assert(isFiniteOrNull(row.ret_5), 'benchmark_ret_5_invalid')
    assert(isFiniteOrNull(row.ret_20), 'benchmark_ret_20_invalid')
  }

  for (const row of sectors) {
    assert(isObject(row), 'sector_row_not_object')
    assert(typeof row.symbol === 'string' && row.symbol, 'sector_symbol_missing')
    assert(typeof row.name === 'string' && row.name, 'sector_name_missing')
    assert(isFiniteOrNull(row.ret_5), 'sector_ret_5_invalid')
    assert(isFiniteOrNull(row.ret_20), 'sector_ret_20_invalid')
  }

  return {
    ok: true,
    benchmarks: benchmarks.map((b) => b.symbol),
    sectors: sectors.length,
    as_of_ts_ms: payload.as_of_ts_ms,
    provider: payload.provider,
  }
}

async function main() {
  const filePath = process.argv[2] || 'data/live/onlytrade/market_overview.us.json'
  const summary = await validateMarketOverviewFile(filePath)
  process.stdout.write(`${JSON.stringify(summary)}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: String(err?.message || err) })}\n`)
    process.exitCode = 1
  })
}
