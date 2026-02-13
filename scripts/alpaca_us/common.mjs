import { mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

export async function ensureParentDir(filePath) {
  const dir = path.dirname(filePath)
  await mkdir(dir, { recursive: true })
}

export async function atomicWriteJson(filePath, payload) {
  await ensureParentDir(filePath)
  const tmpPath = `${filePath}.tmp`
  await writeFile(tmpPath, JSON.stringify(payload), 'utf8')
  await rename(tmpPath, filePath)
}

export function parseSymbolList(raw) {
  const text = String(raw || '').trim()
  if (!text) return []
  return text
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
}

export function nyParts(now = new Date()) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = dtf.formatToParts(now)
  const out = {}
  for (const part of parts) {
    if (!part?.type || part.type === 'literal') continue
    out[part.type] = part.value
  }
  return out
}

export function nyIsRegularSessionOpen(nowMs = Date.now()) {
  const parts = nyParts(new Date(Number(nowMs)))
  const weekday = String(parts.weekday || '').trim()
  if (weekday === 'Sat' || weekday === 'Sun') return false

  const hh = Number(parts.hour)
  const mm = Number(parts.minute)
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return false
  const mins = hh * 60 + mm

  // Regular session only: 09:30-16:00
  return mins >= 570 && mins <= 960
}

export function nyDayKey(tsMs) {
  return new Date(Number(tsMs)).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}
