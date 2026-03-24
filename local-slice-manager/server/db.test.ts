import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, test } from 'vitest'
import { mkdtempSync } from 'node:fs'

import { listSegments, listTables, openSliceManagerDb, upsertSegment } from './db'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { force: true, recursive: true })
  }
})

test('initializes schema and creates the sqlite file automatically', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'slice-manager-db-'))
  tempDirs.push(tempDir)
  const dbPath = join(tempDir, 'slice_manager.db')

  expect(existsSync(dbPath)).toBe(false)

  const db = await openSliceManagerDb(dbPath)

  expect(existsSync(dbPath)).toBe(true)
  expect(listTables(db)).toEqual(
    expect.arrayContaining(['segment_publish_targets', 'segments']),
  )

  db.close()
})

test('lists segments by latest sync time first', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'slice-manager-db-'))
  tempDirs.push(tempDir)
  const dbPath = join(tempDir, 'slice_manager.db')
  const db = await openSliceManagerDb(dbPath)

  upsertSegment(db, {
    id: 'seg-older',
    roomId: 't_022',
    programSlug: 'china-bigtech',
    topicId: 'topic-older',
    title: 'Older segment',
    summary: null,
    videoPath: 'C:/videos/seg-older.mp4',
    posterPath: null,
    durationSeconds: 30,
    syncMtimeMs: 1_710_000_000_000,
  })

  upsertSegment(db, {
    id: 'seg-newer',
    roomId: 't_022',
    programSlug: 'china-bigtech',
    topicId: 'topic-newer',
    title: 'Newer segment',
    summary: null,
    videoPath: 'C:/videos/seg-newer.mp4',
    posterPath: null,
    durationSeconds: 30,
    syncMtimeMs: 1_710_000_100_000,
  })

  upsertSegment(db, {
    id: 'seg-older',
    roomId: 't_022',
    programSlug: 'china-bigtech',
    topicId: 'topic-older',
    title: 'Older segment refreshed',
    summary: null,
    videoPath: 'C:/videos/seg-older.mp4',
    posterPath: null,
    durationSeconds: 30,
    syncMtimeMs: 1_710_000_200_000,
  })

  const listed = listSegments(db, { page: 1, pageSize: 20 })

  expect(listed.rows[0]?.id).toBe('seg-older')
  expect(listed.rows[0]?.createdAt).toBe(new Date(1_710_000_200_000).toISOString())
  expect(listed.rows[1]?.id).toBe('seg-newer')

  db.close()
})
