import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

function toNumber(value, fallback = NaN) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function intervalStepMs(interval) {
  return interval === '1d' ? 24 * 60 * 60_000 : 60_000
}

export async function validateFramesFile(filePath) {
  const text = await readFile(filePath, 'utf8')
  const payload = JSON.parse(text)

  assert(isObject(payload), 'payload_not_object')
  assert(payload.schema_version === 'market.frames.v1', 'schema_version_mismatch')
  assert(payload.market === 'US', 'market_mismatch')
  assert(Array.isArray(payload.frames), 'frames_not_array')

  const frames = payload.frames
  assert(frames.length > 0, 'frames_empty')

  let prevKey = ''
  for (const f of frames) {
    assert(isObject(f), 'frame_not_object')
    assert(f.schema_version === 'market.bar.v1', 'frame_schema_version_mismatch')
    assert(f.market === 'US', 'frame_market_mismatch')
    assert(typeof f.interval === 'string', 'frame_interval_missing')
    assert(f.interval === '1m' || f.interval === '1d', 'frame_interval_invalid')

    assert(isObject(f.instrument), 'frame_instrument_missing')
    assert(typeof f.instrument.symbol === 'string' && f.instrument.symbol.trim(), 'frame_symbol_missing')
    assert(f.instrument.currency === 'USD', 'frame_currency_mismatch')
    assert(f.instrument.timezone === 'America/New_York', 'frame_timezone_mismatch')

    assert(isObject(f.window), 'frame_window_missing')
    const start = toNumber(f.window.start_ts_ms)
    const end = toNumber(f.window.end_ts_ms)
    assert(Number.isFinite(start) && Number.isFinite(end), 'frame_window_ts_invalid')
    const expectedEnd = start + intervalStepMs(f.interval)
    assert(end === expectedEnd, 'frame_window_step_mismatch')

    assert(isObject(f.bar), 'frame_bar_missing')
    const open = toNumber(f.bar.open)
    const high = toNumber(f.bar.high)
    const low = toNumber(f.bar.low)
    const close = toNumber(f.bar.close)
    assert([open, high, low, close].every(Number.isFinite), 'frame_ohlc_invalid')
    assert(high >= Math.max(open, close), 'frame_high_invariant')
    assert(low <= Math.min(open, close), 'frame_low_invariant')

    const key = `${f.window.start_ts_ms}|${f.instrument.symbol}|${f.interval}`
    if (prevKey) {
      assert(key >= prevKey, 'frames_not_sorted')
    }
    prevKey = key
  }

  return {
    ok: true,
    frames: frames.length,
    intervals: Array.from(new Set(frames.map((f) => f.interval))).sort(),
    symbols: Array.from(new Set(frames.map((f) => f.instrument.symbol))).sort(),
  }
}

async function main() {
  const filePath = process.argv[2] || 'data/live/us/frames.us.json'
  const summary = await validateFramesFile(filePath)
  process.stdout.write(`${JSON.stringify(summary)}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: String(err?.message || err) })}\n`)
    process.exitCode = 1
  })
}
