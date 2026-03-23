import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, test } from 'vitest'
import { mkdtempSync } from 'node:fs'

import { listTables, openSliceManagerDb } from './db'

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
