import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import initSqlJs, { type Database } from 'sql.js'

import { sliceManagerConfig } from './config'

export type SliceManagerDb = {
  close: () => void
  database: Database
  path: string
}

export type SegmentUpsertRecord = {
  id: string
  roomId: string
  programSlug: string
  topicId: string
  title: string
  summary: string | null
  videoPath: string
  posterPath: string | null
  durationSeconds: number | null
  syncMtimeMs: number | null
}

export type SegmentListRow = {
  id: string
  roomId: string
  programSlug: string
  topicId: string
  title: string
  status: string
  durationSeconds: number | null
  hasPoster: boolean
  createdAt: string | null
}

export type SegmentDetail = {
  id: string
  roomId: string
  programSlug: string
  topicId: string
  title: string
  summary: string | null
  status: string
  notes: string | null
  durationSeconds: number | null
  videoPath: string
  posterPath: string | null
}

let sqliteModulePromise: ReturnType<typeof initSqlJs> | undefined

export function getSliceManagerDbPath(): string {
  return sliceManagerConfig.dbPath
}

export async function openSliceManagerDb(
  dbPath = getSliceManagerDbPath(),
): Promise<SliceManagerDb> {
  mkdirSync(dirname(dbPath), { recursive: true })

  const SQL = await getSqliteModule()
  const db = existsSync(dbPath)
    ? new SQL.Database(readFileSync(dbPath))
    : new SQL.Database()

  db.exec('PRAGMA foreign_keys = ON;')
  initializeSchema(db)
  persistDatabase(db, dbPath)

  return {
    close() {
      persistDatabase(db, dbPath)
      db.close()
    },
    database: db,
    path: dbPath,
  }
}

export function listTables(db: SliceManagerDb): string[] {
  const result = db.database.exec(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
    ORDER BY name
  `)

  if (result.length === 0) {
    return []
  }

  return result[0].values.map(([name]: unknown[]) => String(name))
}

export function upsertSegment(
  db: SliceManagerDb,
  record: SegmentUpsertRecord,
): void {
  db.database.run(
    `
      INSERT INTO segments (
        id,
        room_id,
        program_slug,
        topic_id,
        title,
        summary,
        video_path,
        poster_path,
        duration_seconds,
        sync_mtime_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        room_id = excluded.room_id,
        program_slug = excluded.program_slug,
        topic_id = excluded.topic_id,
        title = excluded.title,
        summary = excluded.summary,
        video_path = excluded.video_path,
        poster_path = excluded.poster_path,
        duration_seconds = excluded.duration_seconds,
        sync_mtime_ms = excluded.sync_mtime_ms,
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      record.id,
      record.roomId,
      record.programSlug,
      record.topicId,
      record.title,
      record.summary,
      record.videoPath,
      record.posterPath,
      record.durationSeconds,
      record.syncMtimeMs ?? null,
    ],
  )
}

export function listSegments(
  db: SliceManagerDb,
  options: { page: number; pageSize: number },
): { rows: SegmentListRow[]; total: number } {
  const totalResult = db.database.exec('SELECT COUNT(*) AS total FROM segments')
  const total = Number(totalResult[0]?.values[0]?.[0] ?? 0)
  const offset = Math.max(0, (options.page - 1) * options.pageSize)

  const rows = db.database.exec(
    `
      SELECT
        id,
        room_id,
        program_slug,
        topic_id,
        title,
        status,
        duration_seconds,
        poster_path IS NOT NULL,
        sync_mtime_ms,
        created_at
      FROM segments
      ORDER BY sync_mtime_ms DESC, created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `,
    [options.pageSize, offset],
  )

  return {
    rows: mapRows(rows, (value) => ({
      id: String(value[0]),
      roomId: String(value[1]),
      programSlug: String(value[2]),
      topicId: String(value[3]),
      title: String(value[4]),
      status: String(value[5]),
      durationSeconds: value[6] == null ? null : Number(value[6]),
      hasPoster: Boolean(value[7]),
      createdAt:
        value[8] == null
          ? value[9] == null
            ? null
            : String(value[9])
          : new Date(Number(value[8])).toISOString(),
    })),
    total,
  }
}

export function getSegmentById(db: SliceManagerDb, id: string): SegmentDetail | null {
  const rows = db.database.exec(
    `
      SELECT
        id,
        room_id,
        program_slug,
        topic_id,
        title,
        summary,
        status,
        notes,
        duration_seconds,
        video_path,
        poster_path
      FROM segments
      WHERE id = ?
    `,
    [id],
  )

  return mapFirstRow(rows, (value) => ({
    id: String(value[0]),
    roomId: String(value[1]),
    programSlug: String(value[2]),
    topicId: String(value[3]),
    title: String(value[4]),
    summary: value[5] == null ? null : String(value[5]),
    status: String(value[6]),
    notes: value[7] == null ? null : String(value[7]),
    durationSeconds: value[8] == null ? null : Number(value[8]),
    videoPath: String(value[9]),
    posterPath: value[10] == null ? null : String(value[10]),
  }))
}

export function updateSegmentStatus(
  db: SliceManagerDb,
  id: string,
  status: string,
): boolean {
  db.database.run(
    `
      UPDATE segments
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [status, id],
  )

  return getChangedRowCount(db) > 0
}

export function updateSegmentNotes(
  db: SliceManagerDb,
  id: string,
  notes: string,
): boolean {
  db.database.run(
    `
      UPDATE segments
      SET notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [notes, id],
  )

  return getChangedRowCount(db) > 0
}

function initializeSchema(db: Database): void {
  db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'))
  ensureColumn(db, 'segments', 'notes', 'TEXT')
  ensureColumn(db, 'segments', 'sync_mtime_ms', 'INTEGER')
}

function persistDatabase(db: Database, dbPath: string): void {
  writeFileSync(dbPath, Buffer.from(db.export()))
}

function getSqliteModule() {
  sqliteModulePromise ??= initSqlJs({
    locateFile(file: string) {
      return resolve(
        sliceManagerConfig.appRoot,
        'node_modules',
        'sql.js',
        'dist',
        file,
      )
    },
  })

  return sqliteModulePromise
}

function ensureColumn(db: Database, tableName: string, columnName: string, columnSql: string): void {
  const result = db.exec(`PRAGMA table_info(${tableName})`)
  const columns = new Set((result[0]?.values ?? []).map((value: unknown[]) => String(value[1])))
  if (!columns.has(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnSql}`)
  }
}

function getChangedRowCount(db: SliceManagerDb): number {
  const result = db.database.exec('SELECT changes()')
  return Number(result[0]?.values[0]?.[0] ?? 0)
}

function mapFirstRow<T>(
  result: { values: unknown[][] }[],
  mapValue: (value: unknown[]) => T,
): T | null {
  return result[0]?.values[0] ? mapValue(result[0].values[0]) : null
}

function mapRows<T>(
  result: { values: unknown[][] }[],
  mapValue: (value: unknown[]) => T,
): T[] {
  return result[0]?.values.map(mapValue) ?? []
}
