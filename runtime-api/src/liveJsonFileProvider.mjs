import { readFile, stat } from 'node:fs/promises'

function toSafeNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toSafeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

export function createLiveJsonFileProvider({
  filePath,
  refreshMs = 10_000,
  staleAfterMs = 180_000,
} = {}) {
  if (!filePath) {
    throw new Error('live_json_file_path_required')
  }

  const minRefreshMs = Math.max(250, toSafeNumber(refreshMs, 10_000))
  // Staleness describes how long since last successful load. Keep it at least
  // as large as refresh interval to avoid immediate staleness flapping.
  const staleWindowMs = Math.max(minRefreshMs, toSafeNumber(staleAfterMs, 180_000))

  let lastAttemptTsMs = 0
  let lastLoadTsMs = null
  let lastMtimeMs = null
  let lastError = null
  let lastErrorTsMs = null
  let lastGoodPayload = null

  async function refresh(force = false) {
    const now = Date.now()
    if (!force && now - lastAttemptTsMs < minRefreshMs) return
    lastAttemptTsMs = now

    try {
      const fileStat = await stat(filePath)
      const nextMtimeMs = toSafeNumber(fileStat.mtimeMs, 0)
      if (!force && Number.isFinite(lastMtimeMs) && nextMtimeMs === lastMtimeMs) {
        return
      }

      const content = await readFile(filePath, 'utf8')
      const parsed = JSON.parse(content)
      const payload = toSafeObject(parsed)
      if (!payload) {
        throw new Error('invalid_json_payload')
      }

      lastGoodPayload = payload
      lastMtimeMs = nextMtimeMs
      lastLoadTsMs = now
      lastError = null
      lastErrorTsMs = null
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      lastErrorTsMs = now
    }
  }

  async function getPayload({ forceRefresh = false } = {}) {
    await refresh(!!forceRefresh)
    return lastGoodPayload
  }

  function getStatus() {
    return {
      file_path: filePath,
      refresh_ms: minRefreshMs,
      stale_after_ms: staleWindowMs,
      last_load_ts_ms: lastLoadTsMs,
      last_attempt_ts_ms: lastAttemptTsMs,
      last_mtime_ms: lastMtimeMs,
      last_error: lastError,
      last_error_ts_ms: lastErrorTsMs,
      stale: !lastLoadTsMs || Date.now() - lastLoadTsMs > staleWindowMs,
      has_last_good: !!lastGoodPayload,
    }
  }

  return {
    refresh,
    getPayload,
    getStatus,
  }
}
