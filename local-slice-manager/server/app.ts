import { existsSync } from 'node:fs'
import type { Server } from 'node:http'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import express from 'express'

import { sliceManagerConfig } from './config'
import {
  getSegmentById,
  listSegments,
  openSliceManagerDb,
  updateSegmentNotes,
  updateSegmentStatus,
} from './db'
import { scanAndUpsertSegments } from './scan'

type CreateSliceManagerAppOptions = {
  dbPath?: string
  repoRoot?: string
}

type StartSliceManagerServerOptions = CreateSliceManagerAppOptions & {
  autoScan?: boolean
  host?: string
  port?: number
}

const defaultRepoRoot = sliceManagerConfig.repoRoot
const frontendDistDir = resolve(sliceManagerConfig.appRoot, 'dist')
const frontendIndexPath = resolve(frontendDistDir, 'index.html')
const frontendRoutePattern = /^\/(?!api(?:\/|$)|media(?:\/|$)).*/

export function createSliceManagerApp(options: CreateSliceManagerAppOptions = {}) {
  const app = express()
  const dbPath = options.dbPath
  const repoRoot = options.repoRoot ?? defaultRepoRoot
  const videoRoot = options.repoRoot ? resolve(repoRoot, 'data', 'live', 'onlytrade', 'content_videos') : sliceManagerConfig.videoDir
  const posterRoot = options.repoRoot ? resolve(repoRoot, 'data', 'live', 'onlytrade', 'content_posters') : sliceManagerConfig.posterDir

  app.use(express.json())
  app.use(express.static(frontendDistDir, { index: false }))

  app.get('/api/segments', async (req, res) => {
    const page = parsePositiveInteger(req.query.page, 1)
    const pageSize = parsePositiveInteger(req.query.pageSize, 20)
    const db = await openSliceManagerDb(dbPath)

    try {
      const result = listSegments(db, { page, pageSize })
      res.json({
        page,
        pageSize,
        total: result.total,
        rows: result.rows,
      })
    } finally {
      db.close()
    }
  })

  app.get('/api/segments/:id', async (req, res) => {
    const db = await openSliceManagerDb(dbPath)

    try {
      const segment = getSegmentById(db, req.params.id)

      if (!segment) {
        res.status(404).json({ error: 'Segment not found' })
        return
      }

      res.json({
        id: segment.id,
        roomId: segment.roomId,
        programSlug: segment.programSlug,
        topicId: segment.topicId,
        title: segment.title,
        summary: segment.summary,
        status: segment.status,
        notes: segment.notes,
        durationSeconds: segment.durationSeconds,
        media: {
          posterUrl: segment.posterPath ? `/media/poster/${segment.id}` : null,
          videoUrl: `/media/video/${segment.id}`,
        },
      })
    } finally {
      db.close()
    }
  })

  app.patch('/api/segments/:id/status', async (req, res) => {
    const status = typeof req.body?.status === 'string' ? req.body.status.trim() : ''

    if (!status) {
      res.status(400).json({ error: 'Status is required' })
      return
    }

    const db = await openSliceManagerDb(dbPath)

    try {
      if (!updateSegmentStatus(db, req.params.id, status)) {
        res.status(404).json({ error: 'Segment not found' })
        return
      }

      res.json({
        id: req.params.id,
        status,
      })
    } finally {
      db.close()
    }
  })

  app.patch('/api/segments/:id/notes', async (req, res) => {
    const notes = typeof req.body?.notes === 'string' ? req.body.notes : ''
    const db = await openSliceManagerDb(dbPath)

    try {
      if (!updateSegmentNotes(db, req.params.id, notes)) {
        res.status(404).json({ error: 'Segment not found' })
        return
      }

      res.json({
        id: req.params.id,
        notes,
      })
    } finally {
      db.close()
    }
  })

  app.post('/api/segments/rescan', async (_req, res) => {
    const indexed = await scanAndUpsertSegments({ dbPath, repoRoot })
    res.json({ indexed })
  })

  app.get('/media/video/:id', async (req, res) => {
    await streamSegmentAsset({
      dbPath,
      id: req.params.id,
      pathField: 'videoPath',
      allowedRoot: videoRoot,
      res,
      contentType: 'video/mp4',
      download: shouldDownloadAsset(req.query.download),
    })
  })

  app.get('/media/poster/:id', async (req, res) => {
    await streamSegmentAsset({
      dbPath,
      id: req.params.id,
      pathField: 'posterPath',
      allowedRoot: posterRoot,
      res,
      contentType: 'image/jpeg',
      download: shouldDownloadAsset(req.query.download),
    })
  })

  app.get('/', (_req, res) => {
    serveFrontend(res)
  })

  app.get(frontendRoutePattern, (_req, res) => {
    serveFrontend(res)
  })

  return app
}

export async function startSliceManagerServer(
  options: StartSliceManagerServerOptions = {},
): Promise<Server> {
  if (options.autoScan) {
    await scanAndUpsertSegments({
      dbPath: options.dbPath,
      repoRoot: options.repoRoot ?? defaultRepoRoot,
    })
  }

  const app = createSliceManagerApp(options)
  const host = options.host ?? sliceManagerConfig.host
  const port = options.port ?? sliceManagerConfig.port

  return await new Promise<Server>((resolveServer) => {
    const server = app.listen(port, host, () => resolveServer(server))
  })
}

function serveFrontend(res: express.Response) {
  if (existsSync(frontendIndexPath)) {
    res.sendFile(frontendIndexPath)
    return
  }

  res
    .status(200)
    .type('html')
    .send('<!doctype html><html><head><meta charset="utf-8"><title>Local Slice Manager</title></head><body><div id="app">Local Slice Manager</div></body></html>')
}

async function streamSegmentAsset(options: {
  dbPath?: string
  id: string
  pathField: 'posterPath' | 'videoPath'
  allowedRoot: string
  res: express.Response
  contentType: string
  download: boolean
}) {
  const db = await openSliceManagerDb(options.dbPath)

  try {
    const segment = getSegmentById(db, options.id)
    const assetPath = segment?.[options.pathField]

    if (!assetPath || !existsSync(assetPath)) {
      options.res.status(404).json({ error: 'Media not found' })
      return
    }

    const safeAssetPath = resolve(assetPath)
    const safeAllowedRoot = resolve(options.allowedRoot)
    if (
      safeAssetPath !== safeAllowedRoot &&
      !safeAssetPath.startsWith(safeAllowedRoot + '\\') &&
      !safeAssetPath.startsWith(safeAllowedRoot + '/')
    ) {
      options.res.status(404).json({ error: 'Media not found' })
      return
    }

    if (options.download) {
      options.res.attachment(basename(safeAssetPath))
    }

    options.res.type(options.contentType)
    await new Promise<void>((resolveSend) => {
      options.res.sendFile(safeAssetPath, (error) => {
        if (error && !options.res.headersSent) {
          options.res.status(404).json({ error: 'Media not found' })
        }
        resolveSend()
      })
    })
  } finally {
    db.close()
  }
}

function shouldDownloadAsset(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false
  }

  return ['1', 'true', 'yes'].includes(value.trim().toLowerCase())
}

function parsePositiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const autoScan = process.env.SLICE_MANAGER_AUTO_SCAN !== '0'
  const host = sliceManagerConfig.host
  const port = sliceManagerConfig.port

  startSliceManagerServer({ autoScan, host, port }).then(() => {
    process.stdout.write(`Local slice manager API listening on http://${host}:${port}\n`)
  })
}
