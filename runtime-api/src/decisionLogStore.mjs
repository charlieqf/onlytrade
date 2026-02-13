import { mkdir, readFile, writeFile, appendFile, stat } from 'node:fs/promises'
import path from 'node:path'

function safeLimit(limit) {
  const parsed = Number(limit)
  if (!Number.isFinite(parsed)) return 20
  return Math.max(1, Math.min(Math.floor(parsed), 500))
}

export function dayKeyInTimeZone(tsMs, timeZone = 'Asia/Shanghai') {
  return new Date(Number(tsMs)).toLocaleDateString('en-CA', { timeZone })
}

function ensureString(value, fallback = '') {
  const out = typeof value === 'string' ? value : String(value ?? '')
  return out || fallback
}

function parseJsonl(content) {
  const lines = String(content || '').split(/\r?\n/)
  const out = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed && typeof parsed === 'object') {
        out.push(parsed)
      }
    } catch {
      // ignore malformed lines
    }
  }
  return out
}

export function createDecisionLogStore({ baseDir, timeZone = 'Asia/Shanghai' } = {}) {
  if (!baseDir) {
    throw new Error('decision_log_base_dir_required')
  }

  async function ensureDir(dir) {
    await mkdir(dir, { recursive: true })
  }

  function filePath(traderId, dayKey) {
    return path.join(baseDir, traderId, `${dayKey}.jsonl`)
  }

  async function appendDecision({ traderId, decision, nowMs = Date.now(), timeZone: timeZoneOverride } = {}) {
    const safeTraderId = ensureString(traderId).trim()
    if (!safeTraderId) return false
    if (!decision || typeof decision !== 'object') return false

    const ts = ensureString(decision.timestamp, new Date(nowMs).toISOString())
    const tz = String(timeZoneOverride || timeZone || 'Asia/Shanghai')
    const dayKey = dayKeyInTimeZone(Date.parse(ts) || nowMs, tz)
    const dir = path.join(baseDir, safeTraderId)
    await ensureDir(dir)
    const payload = {
      trader_id: safeTraderId,
      day_key: dayKey,
      saved_ts_ms: nowMs,
      ...decision,
      timestamp: ts,
    }
    await appendFile(filePath(safeTraderId, dayKey), `${JSON.stringify(payload)}\n`, 'utf8')
    return true
  }

  async function listLatest({ traderId, limit = 20, nowMs = Date.now(), timeZone: timeZoneOverride } = {}) {
    const safeTraderId = ensureString(traderId).trim()
    if (!safeTraderId) return []
    const maxItems = safeLimit(limit)
    const tz = String(timeZoneOverride || timeZone || 'Asia/Shanghai')
    const dayKey = dayKeyInTimeZone(nowMs, tz)
    const fp = filePath(safeTraderId, dayKey)

    try {
      const content = await readFile(fp, 'utf8')
      const items = parseJsonl(content)
      items.sort((a, b) => {
        const at = Date.parse(a?.timestamp || '') || 0
        const bt = Date.parse(b?.timestamp || '') || 0
        return bt - at
      })
      return items.slice(0, maxItems)
    } catch {
      return []
    }
  }

  async function getFileStatus({ traderId, nowMs = Date.now(), timeZone: timeZoneOverride } = {}) {
    const safeTraderId = ensureString(traderId).trim()
    if (!safeTraderId) return null
    const tz = String(timeZoneOverride || timeZone || 'Asia/Shanghai')
    const dayKey = dayKeyInTimeZone(nowMs, tz)
    const fp = filePath(safeTraderId, dayKey)
    try {
      const st = await stat(fp)
      return { trader_id: safeTraderId, day_key: dayKey, path: fp, size_bytes: st.size, mtime_ms: st.mtimeMs }
    } catch {
      return { trader_id: safeTraderId, day_key: dayKey, path: fp, size_bytes: 0, mtime_ms: null }
    }
  }

  return {
    appendDecision,
    listLatest,
    getFileStatus,
  }
}
