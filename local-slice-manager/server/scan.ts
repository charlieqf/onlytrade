import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

import { sliceManagerConfig } from './config'
import { openSliceManagerDb, upsertSegment } from './db'

type ScanOptions = {
  dbPath?: string
  repoRoot?: string
}

type ManifestSegment = {
  id?: string
  topic_id?: string
  title?: string
  summary?: string
  duration_sec?: number
  video_file?: string
  poster_file?: string
}

type RetainedManifest = {
  room_id?: string
  program_slug?: string
  segments?: ManifestSegment[]
}

type TopicPackage = {
  topic_id?: string
  id?: string
  entity_key?: string
  title?: string
  screen_title?: string
  summary_facts?: string
  commentary_script?: string
  published_at?: string
  script_estimated_seconds?: number
  room_program?: string
}

type TopicPackageFeed = {
  program_slug?: string
  packages?: TopicPackage[]
}

export async function scanAndUpsertSegments(
  options: ScanOptions = {},
): Promise<number> {
  const repoRoot = options.repoRoot ?? resolve(sliceManagerConfig.appRoot, '..')
  const manifestDir = join(repoRoot, 'data', 'live', 'onlytrade', 'content_factory')
  const topicPackageDir = join(repoRoot, 'data', 'live', 'onlytrade', 'topic_packages')
  const videoRoot = join(repoRoot, 'data', 'live', 'onlytrade', 'content_videos')
  const posterRoot = join(repoRoot, 'data', 'live', 'onlytrade', 'content_posters')
  const manifestFileNames = getJsonFileNames(manifestDir)
  const db = await openSliceManagerDb(options.dbPath)

  let indexedCount = 0

  try {
    if (manifestFileNames.length > 0) {
      indexedCount += scanRetainedManifests({
        db,
        manifestDir,
        manifestFileNames,
        videoRoot,
        posterRoot,
      })
    } else {
      indexedCount += scanTopicPackageFallback({
        db,
        topicPackageDir,
        videoRoot,
        posterRoot,
      })
    }

    return indexedCount
  } finally {
    db.close()
  }
}

function scanRetainedManifests(options: {
  db: Awaited<ReturnType<typeof openSliceManagerDb>>
  manifestDir: string
  manifestFileNames: string[]
  videoRoot: string
  posterRoot: string
}): number {
  let indexedCount = 0

  for (const fileName of options.manifestFileNames) {
    const manifest = readManifest(join(options.manifestDir, fileName))
    if (!manifest) {
      continue
    }
    const roomId = normalizeRoomId(manifest.room_id)
    const programSlug = normalizeText(manifest.program_slug)

    if (!roomId || !programSlug || !Array.isArray(manifest.segments)) {
      continue
    }

    for (const segment of manifest.segments) {
      if (!segment.id || !segment.topic_id || !segment.title || !segment.video_file) {
        continue
      }

      const videoPath = resolveSegmentAssetPath(options.videoRoot, roomId, segment.video_file)
      if (!videoPath || !existsSync(videoPath)) {
        continue
      }

      const posterPath = segment.poster_file
        ? resolveSegmentAssetPath(options.posterRoot, roomId, segment.poster_file)
        : null

      upsertSegment(options.db, {
        id: segment.id,
        roomId,
        programSlug,
        topicId: segment.topic_id,
        title: segment.title,
        summary: normalizeText(segment.summary),
        videoPath,
        posterPath: posterPath && existsSync(posterPath) ? posterPath : null,
        durationSeconds:
          typeof segment.duration_sec === 'number'
            ? Math.round(segment.duration_sec)
            : null,
        syncMtimeMs: Math.round(statSync(videoPath).mtimeMs),
      })
      indexedCount += 1
    }
  }

  return indexedCount
}

function scanTopicPackageFallback(options: {
  db: Awaited<ReturnType<typeof openSliceManagerDb>>
  topicPackageDir: string
  videoRoot: string
  posterRoot: string
}): number {
  let indexedCount = 0
  const roomId = sliceManagerConfig.roomId

  for (const fileName of getJsonFileNames(options.topicPackageDir)) {
    const feed = readTopicPackageFeed(join(options.topicPackageDir, fileName))
    if (!feed) {
      continue
    }

    const programSlug =
      normalizeText(feed.program_slug) ?? normalizeText(feed.packages[0]?.room_program) ?? 'china-bigtech'

    for (const topicPackage of feed.packages) {
      const topicId = normalizeText(topicPackage.topic_id) ?? normalizeText(topicPackage.id)
      if (!topicId) {
        continue
      }

      const segmentId = buildTopicPackageSegmentId(topicPackage)
      const videoFileName = `${segmentId}.mp4`
      const posterFileName = `${segmentId}.jpg`
      const videoPath = resolveSegmentAssetPath(options.videoRoot, roomId, videoFileName)

      if (!videoPath || !existsSync(videoPath)) {
        continue
      }

      const posterPath = resolveSegmentAssetPath(options.posterRoot, roomId, posterFileName)
      upsertSegment(options.db, {
        id: segmentId,
        roomId,
        programSlug,
        topicId,
        title: normalizeText(topicPackage.screen_title) ?? normalizeText(topicPackage.title) ?? topicId,
        summary:
          normalizeText(topicPackage.summary_facts) ?? normalizeText(topicPackage.commentary_script),
        videoPath,
        posterPath: posterPath && existsSync(posterPath) ? posterPath : null,
        durationSeconds:
          typeof topicPackage.script_estimated_seconds === 'number'
            ? Math.round(topicPackage.script_estimated_seconds)
            : null,
        syncMtimeMs: Math.round(statSync(videoPath).mtimeMs),
      })
      indexedCount += 1
    }
  }

  return indexedCount
}

function getJsonFileNames(directory: string): string[] {
  if (!existsSync(directory)) {
    return []
  }

  return readdirSync(directory).filter((fileName) => fileName.endsWith('.json'))
}

function readManifest(filePath: string): RetainedManifest | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as RetainedManifest
  } catch {
    return null
  }
}

function readTopicPackageFeed(filePath: string): { program_slug?: string; packages: TopicPackage[] } | null {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as TopicPackageFeed | TopicPackage[]
    if (Array.isArray(parsed)) {
      return {
        packages: parsed.filter((item): item is TopicPackage => Boolean(item && typeof item === 'object')),
      }
    }

    if (!parsed || !Array.isArray(parsed.packages)) {
      return null
    }

    return {
      program_slug: parsed.program_slug,
      packages: parsed.packages.filter((item): item is TopicPackage => Boolean(item && typeof item === 'object')),
    }
  } catch {
    return null
  }
}

function buildTopicPackageSegmentId(topicPackage: TopicPackage): string {
  const entityKey = sanitizeToken(topicPackage.entity_key, 'topic')
  const digest = createDigest(
    topicPackage.topic_id ?? topicPackage.id ?? topicPackage.title ?? entityKey,
  )
  return `cf_${entityKey}_${segmentDateToken(topicPackage)}_${digest}`
}

function segmentDateToken(topicPackage: TopicPackage): string {
  const publishedAt = String(topicPackage.published_at || '').trim()
  const digits = [...publishedAt].filter((char) => /\d/.test(char)).join('')
  return digits.length >= 8 ? digits.slice(0, 8) : fallbackDateToken()
}

function fallbackDateToken(): string {
  const now = new Date()
  const year = now.getUTCFullYear().toString().padStart(4, '0')
  const month = `${now.getUTCMonth() + 1}`.padStart(2, '0')
  const day = `${now.getUTCDate()}`.padStart(2, '0')
  return `${year}${month}${day}`
}

function sanitizeToken(value: unknown, fallback: string): string {
  const text = String(value || '').trim().toLowerCase()
  const sanitized = text
    .split('')
    .map((char) => (/^[a-z0-9]$/.test(char) ? char : '_'))
    .join('')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
  return sanitized || fallback
}

function createDigest(value: unknown): string {
  return createHash('sha1').update(String(value || ''), 'utf8').digest('hex').slice(0, 6)
}

function normalizeText(value: unknown): string | null {
  const text = String(value || '').trim()
  return text ? text : null
}

function normalizeRoomId(value: unknown): string | null {
  const roomId = String(value || '').trim()
  if (!roomId || basename(roomId) !== roomId) {
    return null
  }
  return /^[a-zA-Z0-9_-]+$/.test(roomId) ? roomId : null
}

function resolveSegmentAssetPath(rootDir: string, roomId: string, fileName: string): string | null {
  const safeRoomId = String(roomId || '').trim()
  const safeFileName = String(fileName || '').trim()
  if (!safeRoomId || !safeFileName || basename(safeFileName) !== safeFileName) {
    return null
  }

  const roomRoot = resolve(rootDir, safeRoomId)
  const target = resolve(roomRoot, safeFileName)
  return target.startsWith(roomRoot + '\\') || target.startsWith(roomRoot + '/') || target === roomRoot
    ? target
    : null
}
