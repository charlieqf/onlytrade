import { appendFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

function sanitizeId(value) {
  const safe = String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_')
  return safe || 'unknown'
}

function toSafeLimit(limit) {
  const parsed = Number(limit)
  if (!Number.isFinite(parsed)) return 20
  return Math.max(1, Math.min(Math.floor(parsed), 500))
}

function toSafeBeforeTs(beforeTsMs) {
  if (beforeTsMs == null || beforeTsMs === '') return null
  const parsed = Number(beforeTsMs)
  return Number.isFinite(parsed) ? parsed : null
}

function parseJsonLines(content) {
  if (!content) return []

  const lines = content.split(/\r?\n/)
  const messages = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed && typeof parsed === 'object') {
        messages.push(parsed)
      }
    } catch {
      // Corrupted line should not block healthy messages.
    }
  }
  return messages
}

function filterByWindow(messages, limit, beforeTsMs) {
  const safeLimit = toSafeLimit(limit)
  const safeBeforeTs = toSafeBeforeTs(beforeTsMs)

  const filtered = messages.filter((message) => {
    if (safeBeforeTs == null) return true
    const ts = Number(message?.created_ts_ms)
    if (!Number.isFinite(ts)) return false
    return ts < safeBeforeTs
  })

  return filtered.slice(-safeLimit)
}

function buildFilePaths(baseDir, roomId, userSessionId) {
  const safeRoomId = sanitizeId(roomId)
  const safeUserSessionId = sanitizeId(userSessionId)

  return {
    publicPath: path.join(baseDir, 'rooms', safeRoomId, 'public.jsonl'),
    privatePath: path.join(baseDir, 'rooms', safeRoomId, 'dm', `${safeUserSessionId}.jsonl`),
  }
}

async function appendJsonLine(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await appendFile(filePath, `${JSON.stringify(payload)}\n`, 'utf8')
}

async function readJsonLines(filePath) {
  try {
    const content = await readFile(filePath, 'utf8')
    return parseJsonLines(content)
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return []
    }
    throw error
  }
}

export function createChatFileStore({
  baseDir = path.resolve(process.cwd(), 'data', 'chat'),
  nowMs = () => Date.now(),
} = {}) {
  function withDefaults(message) {
    const ts = Number(message?.created_ts_ms)
    return {
      ...message,
      created_ts_ms: Number.isFinite(ts) ? ts : nowMs(),
    }
  }

  return {
    async appendPublic(roomId, message) {
      const paths = buildFilePaths(baseDir, roomId)
      await appendJsonLine(paths.publicPath, withDefaults(message))
    },

    async appendPrivate(roomId, userSessionId, message) {
      const paths = buildFilePaths(baseDir, roomId, userSessionId)
      await appendJsonLine(paths.privatePath, withDefaults(message))
    },

    async readPublic(roomId, limit = 20, beforeTsMs = null) {
      const paths = buildFilePaths(baseDir, roomId)
      const messages = await readJsonLines(paths.publicPath)
      return filterByWindow(messages, limit, beforeTsMs)
    },

    async readPrivate(roomId, userSessionId, limit = 20, beforeTsMs = null) {
      const paths = buildFilePaths(baseDir, roomId, userSessionId)
      const messages = await readJsonLines(paths.privatePath)
      return filterByWindow(messages, limit, beforeTsMs)
    },
  }
}
