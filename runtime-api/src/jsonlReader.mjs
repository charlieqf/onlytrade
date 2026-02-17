import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

function parseLineRecords(lines) {
  const out = []
  const rows = Array.isArray(lines) ? lines : []
  for (const line of rows) {
    try {
      const parsed = JSON.parse(line)
      if (parsed && typeof parsed === 'object') {
        out.push(parsed)
      }
    } catch {
      // ignore malformed line
    }
  }
  return out
}

function ringBufferToArray(ring, count, start) {
  const size = Number(count || 0)
  if (!Array.isArray(ring) || size <= 0) return []
  const safeStart = Number(start || 0)
  if (size < ring.length) {
    return ring.slice(0, size)
  }
  return ring.slice(safeStart).concat(ring.slice(0, safeStart))
}

export async function readJsonlRecordsStreaming(filePath, { limit = 100, fromEnd = true } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 2000))
  if (!filePath) return []

  let input = null
  let rl = null
  try {
    input = createReadStream(filePath, { encoding: 'utf8' })
    rl = createInterface({ input, crlfDelay: Infinity })

    if (fromEnd) {
      const ring = []
      let start = 0
      let count = 0

      for await (const line of rl) {
        if (!line) continue
        if (count < safeLimit) {
          ring[count] = line
          count += 1
          continue
        }
        ring[start] = line
        start = (start + 1) % safeLimit
      }

      const selected = ringBufferToArray(ring, count, start)
      return parseLineRecords(selected)
    }

    const selected = []
    for await (const line of rl) {
      if (!line) continue
      selected.push(line)
      if (selected.length >= safeLimit) {
        rl.close()
        if (input && !input.destroyed) {
          input.destroy()
        }
        break
      }
    }
    return parseLineRecords(selected)
  } catch {
    return []
  } finally {
    try {
      rl?.close()
    } catch {
      // ignore
    }
    try {
      if (input && !input.destroyed) {
        input.destroy()
      }
    } catch {
      // ignore
    }
  }
}
