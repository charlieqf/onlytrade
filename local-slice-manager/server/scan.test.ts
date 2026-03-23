import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, test } from 'vitest'
import { mkdtempSync } from 'node:fs'

import { openSliceManagerDb } from './db'
import { scanAndUpsertSegments } from './scan'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { force: true, recursive: true })
  }
})

test('indexes retained manifest segments with existing local video files and upserts by segment id', async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'slice-manager-scan-'))
  tempDirs.push(repoRoot)

  const contentRoot = join(repoRoot, 'data', 'live', 'onlytrade')
  const manifestDir = join(contentRoot, 'content_factory')
  const videoDir = join(contentRoot, 'content_videos', 't_022')
  const posterDir = join(contentRoot, 'content_posters', 't_022')
  const dbPath = join(repoRoot, 'data', 'local_slice_manager', 'slice_manager.db')

  mkdirSync(manifestDir, { recursive: true })
  mkdirSync(videoDir, { recursive: true })
  mkdirSync(posterDir, { recursive: true })

  writeFileSync(join(videoDir, 'segment-a.mp4'), 'video-a')
  writeFileSync(join(posterDir, 'segment-a.jpg'), 'poster-a')

  writeFileSync(
    join(manifestDir, 'retained.json'),
    JSON.stringify(
      {
        room_id: 't_022',
        program_slug: 'china-bigtech',
        as_of: '2026-03-21T10:00:00Z',
        segments: [
          {
            id: 'segment-a',
            topic_id: 'topic-a',
            title: 'Original title',
            summary: 'Original summary',
            video_file: 'segment-a.mp4',
            poster_file: 'segment-a.jpg',
          },
          {
            id: 'segment-missing',
            topic_id: 'topic-missing',
            title: 'Missing video',
            summary: 'Should be skipped',
            video_file: 'segment-missing.mp4',
            poster_file: 'segment-missing.jpg',
          },
        ],
      },
      null,
      2,
    ),
  )

  const firstScan = await scanAndUpsertSegments({ dbPath, repoRoot })

  expect(firstScan).toBe(1)

  const db = await openSliceManagerDb(dbPath)
  const firstRows = db.database.exec(`
    SELECT id, room_id, program_slug, topic_id, title, summary, video_path, poster_path
    FROM segments
    ORDER BY id
  `)

  expect(firstRows).toHaveLength(1)
  expect(firstRows[0].values).toEqual([
    [
      'segment-a',
      't_022',
      'china-bigtech',
      'topic-a',
      'Original title',
      'Original summary',
      join(videoDir, 'segment-a.mp4'),
      join(posterDir, 'segment-a.jpg'),
    ],
  ])
  expect(existsSync(join(videoDir, 'segment-a.mp4'))).toBe(true)
  db.close()

  writeFileSync(
    join(manifestDir, 'retained.json'),
    JSON.stringify(
      {
        room_id: 't_022',
        program_slug: 'china-bigtech',
        as_of: '2026-03-21T10:05:00Z',
        segments: [
          {
            id: 'segment-a',
            topic_id: 'topic-a',
            title: 'Updated title',
            summary: 'Updated summary',
            video_file: 'segment-a.mp4',
            poster_file: 'segment-a.jpg',
          },
        ],
      },
      null,
      2,
    ),
  )

  const secondScan = await scanAndUpsertSegments({ dbPath, repoRoot })

  expect(secondScan).toBe(1)

  const reopenedDb = await openSliceManagerDb(dbPath)
  const updatedRows = reopenedDb.database.exec(`
    SELECT id, title, summary
    FROM segments
    ORDER BY id
  `)
  const countRows = reopenedDb.database.exec('SELECT COUNT(*) FROM segments')

  expect(updatedRows[0].values).toEqual([
    ['segment-a', 'Updated title', 'Updated summary'],
  ])
  expect(countRows[0].values).toEqual([[1]])

  reopenedDb.close()
})

test('skips manifest rows that attempt to escape the room asset directory', async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'slice-manager-scan-'))
  tempDirs.push(repoRoot)

  const contentRoot = join(repoRoot, 'data', 'live', 'onlytrade')
  const manifestDir = join(contentRoot, 'content_factory')
  const videoDir = join(contentRoot, 'content_videos', 't_022')
  const outsideDir = join(contentRoot, 'outside')
  const dbPath = join(repoRoot, 'data', 'local_slice_manager', 'slice_manager.db')

  mkdirSync(manifestDir, { recursive: true })
  mkdirSync(videoDir, { recursive: true })
  mkdirSync(outsideDir, { recursive: true })

  writeFileSync(join(outsideDir, 'escape.mp4'), 'outside-video')

  writeFileSync(
    join(manifestDir, 'retained.json'),
    JSON.stringify(
      {
        room_id: 't_022',
        program_slug: 'china-bigtech',
        segments: [
          {
            id: 'segment-escape',
            topic_id: 'topic-escape',
            title: 'Escaped path',
            video_file: '../outside/escape.mp4',
          },
        ],
      },
      null,
      2,
    ),
  )

  const indexed = await scanAndUpsertSegments({ dbPath, repoRoot })
  expect(indexed).toBe(0)

  const db = await openSliceManagerDb(dbPath)
  const countRows = db.database.exec('SELECT COUNT(*) FROM segments')
  expect(countRows[0].values).toEqual([[0]])
  db.close()
})

test('continues scanning when one manifest is malformed', async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'slice-manager-scan-'))
  tempDirs.push(repoRoot)

  const contentRoot = join(repoRoot, 'data', 'live', 'onlytrade')
  const manifestDir = join(contentRoot, 'content_factory')
  const videoDir = join(contentRoot, 'content_videos', 't_022')
  const dbPath = join(repoRoot, 'data', 'local_slice_manager', 'slice_manager.db')

  mkdirSync(manifestDir, { recursive: true })
  mkdirSync(videoDir, { recursive: true })

  writeFileSync(join(videoDir, 'segment-a.mp4'), 'video-a')
  writeFileSync(join(manifestDir, 'bad.json'), '{not-json')
  writeFileSync(
    join(manifestDir, 'good.json'),
    JSON.stringify(
      {
        room_id: 't_022',
        program_slug: 'china-bigtech',
        segments: [
          {
            id: 'segment-a',
            topic_id: 'topic-a',
            title: 'Good row',
            video_file: 'segment-a.mp4',
          },
        ],
      },
      null,
      2,
    ),
  )

  const indexed = await scanAndUpsertSegments({ dbPath, repoRoot })
  expect(indexed).toBe(1)

  const db = await openSliceManagerDb(dbPath)
  const rows = db.database.exec('SELECT id, title FROM segments ORDER BY id')
  expect(rows[0].values).toEqual([['segment-a', 'Good row']])
  db.close()
})

test('rejects manifests whose room_id escapes the room directory root', async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'slice-manager-scan-'))
  tempDirs.push(repoRoot)

  const contentRoot = join(repoRoot, 'data', 'live', 'onlytrade')
  const manifestDir = join(contentRoot, 'content_factory')
  const outsideDir = join(contentRoot, 'outside')
  const dbPath = join(repoRoot, 'data', 'local_slice_manager', 'slice_manager.db')

  mkdirSync(manifestDir, { recursive: true })
  mkdirSync(outsideDir, { recursive: true })
  writeFileSync(join(outsideDir, 'segment-a.mp4'), 'outside-video')

  writeFileSync(
    join(manifestDir, 'retained.json'),
    JSON.stringify(
      {
        room_id: '../outside',
        program_slug: 'china-bigtech',
        segments: [
          {
            id: 'segment-outside-room',
            topic_id: 'topic-outside-room',
            title: 'Escaped room id',
            video_file: 'segment-a.mp4',
          },
        ],
      },
      null,
      2,
    ),
  )

  const indexed = await scanAndUpsertSegments({ dbPath, repoRoot })
  expect(indexed).toBe(0)

  const db = await openSliceManagerDb(dbPath)
  const countRows = db.database.exec('SELECT COUNT(*) FROM segments')
  expect(countRows[0].values).toEqual([[0]])
  db.close()
})

test('falls back to topic package feeds when retained manifests are absent', async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'slice-manager-scan-'))
  tempDirs.push(repoRoot)

  const contentRoot = join(repoRoot, 'data', 'live', 'onlytrade')
  const topicPackageDir = join(contentRoot, 'topic_packages')
  const videoDir = join(contentRoot, 'content_videos', 't_022')
  const posterDir = join(contentRoot, 'content_posters', 't_022')
  const dbPath = join(repoRoot, 'data', 'local_slice_manager', 'slice_manager.db')

  mkdirSync(topicPackageDir, { recursive: true })
  mkdirSync(videoDir, { recursive: true })
  mkdirSync(posterDir, { recursive: true })

  writeFileSync(join(videoDir, 'cf_xiaomi_20202614_806415.mp4'), 'video-xiaomi')
  writeFileSync(join(posterDir, 'cf_xiaomi_20202614_806415.jpg'), 'poster-xiaomi')

  writeFileSync(
    join(topicPackageDir, 'china_bigtech_packages.verify.json'),
    JSON.stringify(
      {
        schema_version: 'topic.package.feed.v1',
        room_id: 't_019',
        program_slug: 'china-bigtech',
        packages: [
          {
            topic_id: 'china_bigtech_xiaomi_Fri,_20_Mar_2026_fe84c6',
            id: 'china_bigtech_xiaomi_Fri,_20_Mar_2026_fe84c6',
            entity_key: 'xiaomi',
            title: 'Original title',
            screen_title: 'Rendered screen title',
            summary_facts: 'Fact-only summary',
            commentary_script: 'Commentary body',
            published_at: 'Fri, 20 Mar 2026 14:54:19 GMT',
            script_estimated_seconds: 39.9,
          },
          {
            topic_id: 'china_bigtech_tencent_Fri,_20_Mar_2026_123456',
            id: 'china_bigtech_tencent_Fri,_20_Mar_2026_123456',
            entity_key: 'tencent',
            title: 'Missing render',
            screen_title: 'Missing render',
            summary_facts: 'Should be skipped because video is absent',
            published_at: 'Fri, 20 Mar 2026 10:00:00 GMT',
          },
        ],
      },
      null,
      2,
    ),
  )

  const indexed = await scanAndUpsertSegments({ dbPath, repoRoot })
  expect(indexed).toBe(1)

  const db = await openSliceManagerDb(dbPath)
  const rows = db.database.exec(`
    SELECT id, room_id, program_slug, topic_id, title, summary, video_path, poster_path, duration_seconds
    FROM segments
    ORDER BY id
  `)

  expect(rows).toHaveLength(1)
  expect(rows[0].values).toEqual([
    [
      'cf_xiaomi_20202614_806415',
      't_022',
      'china-bigtech',
      'china_bigtech_xiaomi_Fri,_20_Mar_2026_fe84c6',
      'Rendered screen title',
      'Fact-only summary',
      join(videoDir, 'cf_xiaomi_20202614_806415.mp4'),
      join(posterDir, 'cf_xiaomi_20202614_806415.jpg'),
      40,
    ],
  ])

  db.close()
})
