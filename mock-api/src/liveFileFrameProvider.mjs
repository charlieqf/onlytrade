import { readFile, stat } from 'node:fs/promises'

function safeLimit(limit) {
  const parsed = Number(limit)
  if (!Number.isFinite(parsed)) return 800
  return Math.max(1, Math.min(Math.floor(parsed), 2000))
}

function frameKey(frame) {
  return `${frame?.instrument?.symbol || ''}|${frame?.interval || ''}|${frame?.window?.start_ts_ms || ''}`
}

function indexFrames(frames) {
  const deduped = new Map()
  for (const frame of frames || []) {
    const symbol = frame?.instrument?.symbol
    const interval = frame?.interval
    const startTs = Number(frame?.window?.start_ts_ms)
    if (!symbol || !interval || !Number.isFinite(startTs)) continue
    deduped.set(frameKey(frame), frame)
  }

  const bySymbolInterval = new Map()
  for (const frame of deduped.values()) {
    const key = `${frame.instrument.symbol}|${frame.interval}`
    if (!bySymbolInterval.has(key)) bySymbolInterval.set(key, [])
    bySymbolInterval.get(key).push(frame)
  }

  for (const rows of bySymbolInterval.values()) {
    rows.sort((a, b) => a.window.start_ts_ms - b.window.start_ts_ms)
  }

  return bySymbolInterval
}

export function createLiveFileFrameProvider({ filePath, refreshMs = 10000, staleAfterMs = 180000 } = {}) {
  if (!filePath) {
    throw new Error('live_file_path_required')
  }

  const minRefreshMs = Math.max(250, Number(refreshMs) || 10000)
  const staleWindowMs = Math.max(minRefreshMs * 6, Number(staleAfterMs) || 180000)
  let lastAttemptTsMs = 0
  let lastLoadTsMs = null
  let lastMtimeMs = null
  let lastError = null
  let lastErrorTsMs = null
  let mode = 'real'
  let provider = 'akshare'
  let bySymbolInterval = new Map()

  async function refresh(force = false) {
    const now = Date.now()
    if (!force && now - lastAttemptTsMs < minRefreshMs) return
    lastAttemptTsMs = now

    try {
      const fileStat = await stat(filePath)
      const nextMtimeMs = Number(fileStat.mtimeMs || 0)
      if (!force && Number.isFinite(lastMtimeMs) && nextMtimeMs === lastMtimeMs) {
        return
      }

      const content = await readFile(filePath, 'utf8')
      const parsed = JSON.parse(content)
      const frames = Array.isArray(parsed?.frames) ? parsed.frames : []

      bySymbolInterval = indexFrames(frames)
      lastMtimeMs = nextMtimeMs
      lastLoadTsMs = now
      lastError = null
      lastErrorTsMs = null
      mode = String(parsed?.mode || mode || 'real')
      provider = String(parsed?.provider || provider || 'akshare')
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      lastErrorTsMs = now
    }
  }

  async function getFrames({ symbol, interval = '1m', limit = 800 } = {}) {
    await refresh(false)
    const key = `${symbol}|${interval}`
    const rows = bySymbolInterval.get(key) || []
    const maxItems = safeLimit(limit)
    return rows.slice(Math.max(0, rows.length - maxItems))
  }

  function getSymbols(interval = '1m') {
    const out = new Set()
    for (const key of bySymbolInterval.keys()) {
      const [symbol, itemInterval] = key.split('|')
      if (itemInterval === interval && symbol) out.add(symbol)
    }
    return Array.from(out).sort()
  }

  function getStatus() {
    let frameCount = 0
    for (const rows of bySymbolInterval.values()) {
      frameCount += rows.length
    }
    return {
      file_path: filePath,
      refresh_ms: minRefreshMs,
      stale_after_ms: staleWindowMs,
      mode,
      provider,
      symbols_1m: getSymbols('1m'),
      frame_count: frameCount,
      last_load_ts_ms: lastLoadTsMs,
      last_attempt_ts_ms: lastAttemptTsMs,
      last_mtime_ms: lastMtimeMs,
      last_error: lastError,
      last_error_ts_ms: lastErrorTsMs,
      stale: !lastLoadTsMs || Date.now() - lastLoadTsMs > staleWindowMs,
    }
  }

  return {
    refresh,
    getFrames,
    getSymbols,
    getStatus,
  }
}
