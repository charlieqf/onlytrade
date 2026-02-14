import { mkdir, appendFile } from 'node:fs/promises'
import path from 'node:path'

function ensureString(value, fallback = '') {
  const out = typeof value === 'string' ? value : String(value ?? '')
  return out || fallback
}

function dayKeyInTimeZone(tsMs, timeZone = 'Asia/Shanghai') {
  return new Date(Number(tsMs)).toLocaleDateString('en-CA', { timeZone })
}

export function createDecisionAuditStore({ baseDir, timeZone = 'Asia/Shanghai' } = {}) {
  if (!baseDir) {
    throw new Error('decision_audit_base_dir_required')
  }

  async function ensureDir(dir) {
    await mkdir(dir, { recursive: true })
  }

  function filePath(traderId, dayKey) {
    return path.join(baseDir, traderId, `${dayKey}.jsonl`)
  }

  async function appendAudit({ traderId, audit, nowMs = Date.now(), timeZone: timeZoneOverride } = {}) {
    const safeTraderId = ensureString(traderId).trim()
    if (!safeTraderId) return false
    if (!audit || typeof audit !== 'object') return false

    const tz = String(timeZoneOverride || timeZone || 'Asia/Shanghai')
    const dayKey = dayKeyInTimeZone(nowMs, tz)
    const dir = path.join(baseDir, safeTraderId)
    await ensureDir(dir)

    const payload = {
      schema_version: 'agent.decision_audit.v1',
      trader_id: safeTraderId,
      day_key: dayKey,
      saved_ts_ms: nowMs,
      ...audit,
    }

    await appendFile(filePath(safeTraderId, dayKey), `${JSON.stringify(payload)}\n`, 'utf8')
    return true
  }

  return {
    appendAudit,
  }
}
